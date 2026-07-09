-- 007_form_template_versions.sql — WOS-55 admin-authored template versioning
-- form_templates (logical) → form_template_versions (immutable published / editable draft)
-- form_submissions pin to template_version_id; workflow_step_instances track runtime steps.

CREATE TABLE IF NOT EXISTS form_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  current_published_version_id UUID NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS form_template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES form_templates(id) ON DELETE CASCADE,
  version_number INTEGER NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  schema_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  workflow_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  compiled_workflow_json JSONB NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ NULL,
  published_by TEXT NULL,
  retired_at TIMESTAMPTZ NULL,
  CONSTRAINT form_template_versions_version_number_positive
    CHECK (version_number IS NULL OR version_number > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_form_template_versions_template_version_number
  ON form_template_versions (template_id, version_number)
  WHERE version_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS form_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_version_id UUID NOT NULL REFERENCES form_template_versions(id) ON DELETE RESTRICT,
  data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'in_progress',
  current_step_index INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_step_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  step_type TEXT NOT NULL,
  assignee_role TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  acted_by TEXT NULL,
  acted_at TIMESTAMPTZ NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (submission_id, step_index)
);

ALTER TABLE form_templates
  DROP CONSTRAINT IF EXISTS form_templates_current_published_version_fk;

ALTER TABLE form_templates
  ADD CONSTRAINT form_templates_current_published_version_fk
  FOREIGN KEY (current_published_version_id)
  REFERENCES form_template_versions(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_form_templates_key ON form_templates(key);
CREATE INDEX IF NOT EXISTS idx_form_templates_status ON form_templates(status);
CREATE INDEX IF NOT EXISTS idx_form_template_versions_template_status
  ON form_template_versions(template_id, status);
CREATE INDEX IF NOT EXISTS idx_form_template_versions_template_version
  ON form_template_versions(template_id, version_number);
CREATE INDEX IF NOT EXISTS idx_form_submissions_template_version_status
  ON form_submissions(template_version_id, status);
CREATE INDEX IF NOT EXISTS idx_workflow_step_instances_submission_step_status
  ON workflow_step_instances(submission_id, step_index, status);
