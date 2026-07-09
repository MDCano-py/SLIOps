-- 002_hub_extras.sql — additional hub columns and reference tables

ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS form_payload JSONB,
  ADD COLUMN IF NOT EXISTS archive_kind TEXT,
  ADD COLUMN IF NOT EXISTS archive_id TEXT,
  ADD COLUMN IF NOT EXISTS maintainx_status TEXT,
  ADD COLUMN IF NOT EXISTS maintainx_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS n8n_workflow_run_id TEXT;

CREATE INDEX IF NOT EXISTS idx_requests_archive ON requests(archive_kind, archive_id);
CREATE INDEX IF NOT EXISTS idx_web_documents_status ON web_documents(status);

CREATE TABLE IF NOT EXISTS hub_settings (
  key TEXT PRIMARY KEY,
  value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  site_code TEXT,
  address TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  asset_tag TEXT,
  location_id UUID NULL REFERENCES locations(id) ON DELETE SET NULL,
  maintainx_asset_id TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_equipment_location ON equipment(location_id);
CREATE INDEX IF NOT EXISTS idx_equipment_maintainx ON equipment(maintainx_asset_id);

CREATE TABLE IF NOT EXISTS request_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  document_id UUID NULL REFERENCES web_documents(id) ON DELETE SET NULL,
  workflow_step_id UUID NULL REFERENCES workflow_steps(id) ON DELETE SET NULL,
  file_name TEXT,
  file_url TEXT,
  storage_provider TEXT,
  document_type TEXT,
  mime_type TEXT,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_request_files_request ON request_files(request_id);
