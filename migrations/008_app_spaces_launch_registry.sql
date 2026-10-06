-- 008_app_spaces_launch_registry.sql — WOS-58 dynamic app spaces + template launch registry

CREATE TABLE IF NOT EXISTS app_spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  visible_to_roles_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS template_launch_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES form_templates(id) ON DELETE CASCADE,
  template_version_id UUID NULL REFERENCES form_template_versions(id) ON DELETE SET NULL,
  space_key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  route_type TEXT NOT NULL DEFAULT 'template_runtime_placeholder',
  route_target TEXT NOT NULL,
  quick_action_enabled BOOLEAN NOT NULL DEFAULT false,
  visible_to_roles_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'hidden' CHECK (status IN ('active', 'hidden', 'archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (template_id, space_key)
);

ALTER TABLE template_launch_entries
  DROP CONSTRAINT IF EXISTS template_launch_entries_space_key_fk;

ALTER TABLE template_launch_entries
  ADD CONSTRAINT template_launch_entries_space_key_fk
  FOREIGN KEY (space_key) REFERENCES app_spaces(key) ON UPDATE CASCADE;

ALTER TABLE form_templates
  ADD COLUMN IF NOT EXISTS launch_config_json JSONB NOT NULL DEFAULT '{}'::jsonb;

INSERT INTO app_spaces (key, label, description, icon, status, sort_order, visible_to_roles_json)
VALUES
  ('forms', 'Forms', 'Form templates and quick form launches', 'form', 'active', 10, '["requester","employee","manager","admin","hub_admin"]'::jsonb),
  ('documents', 'Documents', 'Document-backed workflows and uploads', 'document', 'active', 20, '["requester","employee","manager","admin","hub_admin"]'::jsonb),
  ('workflows', 'Workflows', 'Operational workflow templates', 'workflow', 'active', 30, '["manager","admin","hub_admin"]'::jsonb),
  ('operations', 'Operations', 'Operations team launch area', 'operations', 'active', 40, '["manager","operations","admin","hub_admin"]'::jsonb),
  ('admin', 'Admin', 'Administrative launch area', 'admin', 'active', 50, '["admin","hub_admin"]'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_app_spaces_status_sort ON app_spaces(status, sort_order);
CREATE INDEX IF NOT EXISTS idx_template_launch_entries_space_status ON template_launch_entries(space_key, status, sort_order);
CREATE INDEX IF NOT EXISTS idx_template_launch_entries_template ON template_launch_entries(template_id);
