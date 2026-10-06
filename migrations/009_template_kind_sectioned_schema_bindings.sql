-- WOS-60 — template_kind, version snapshot, optional workflow bindings

ALTER TABLE form_templates
  ADD COLUMN IF NOT EXISTS template_kind TEXT NOT NULL DEFAULT 'form';

ALTER TABLE form_template_versions
  ADD COLUMN IF NOT EXISTS template_kind TEXT;

CREATE TABLE IF NOT EXISTS template_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_template_id UUID NOT NULL REFERENCES form_templates(id) ON DELETE CASCADE,
  source_template_version_id UUID REFERENCES form_template_versions(id) ON DELETE SET NULL,
  source_space_key TEXT,
  workflow_template_id UUID REFERENCES form_templates(id) ON DELETE SET NULL,
  workflow_template_version_id UUID REFERENCES form_template_versions(id) ON DELETE SET NULL,
  binding_status TEXT NOT NULL DEFAULT 'active',
  binding_mode TEXT NOT NULL DEFAULT 'none',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_template_bindings_source
  ON template_bindings (source_template_id);

CREATE INDEX IF NOT EXISTS idx_template_bindings_workflow
  ON template_bindings (workflow_template_id)
  WHERE workflow_template_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_template_bindings_source_active
  ON template_bindings (source_template_id)
  WHERE binding_status = 'active' AND archived_at IS NULL;

-- Backfill template_kind from launch_config_json.space_key where possible
UPDATE form_templates t
SET template_kind = CASE
  WHEN COALESCE(t.launch_config_json->>'space_key', '') = 'documents' THEN 'document'
  WHEN COALESCE(t.launch_config_json->>'space_key', '') = 'workflows' THEN 'workflow'
  WHEN COALESCE(t.launch_config_json->>'space_key', '') = 'forms' THEN 'form'
  WHEN t.key LIKE 'doc\_%' THEN 'document'
  WHEN t.key LIKE 'form\_%' THEN 'form'
  WHEN COALESCE(t.description, '') LIKE '%[document-backed]%' THEN 'document'
  WHEN COALESCE(t.description, '') LIKE '%[form-backed]%' THEN 'form'
  ELSE t.template_kind
END
WHERE t.template_kind = 'form';

UPDATE form_template_versions v
SET template_kind = t.template_kind
FROM form_templates t
WHERE v.template_id = t.id
  AND v.template_kind IS NULL
  AND v.status = 'published';
