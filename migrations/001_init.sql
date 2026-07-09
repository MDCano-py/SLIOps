-- 001_init.sql — Operations Workflow Hub schema (PostgreSQL)
-- Source of truth when HUB_STORE=postgres.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Per-request-type sequence numbers (for human-readable request_number).
CREATE TABLE IF NOT EXISTS request_sequences (
  request_type TEXT PRIMARY KEY,
  seq BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT,
  permissions JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number TEXT UNIQUE,
  request_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  requester_name TEXT,
  requester_email TEXT,
  requester_company TEXT,
  requester_type TEXT,
  location TEXT,
  department TEXT,
  priority TEXT,
  status TEXT,
  current_step_id UUID NULL,
  assigned_to_email TEXT NULL,
  assigned_team TEXT NULL,
  client_visible_status TEXT NULL,
  internal_notes TEXT,
  client_notes TEXT,
  maintainx_id TEXT NULL,
  maintainx_sequential_id TEXT NULL,
  external_storage_url TEXT NULL,
  demo BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  closed_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS web_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  document_type_key TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  content_json JSONB,
  rendered_html TEXT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_by_email TEXT,
  current_owner_email TEXT NULL,
  locked BOOLEAN NOT NULL DEFAULT false,
  locked_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  document_id UUID NULL REFERENCES web_documents(id) ON DELETE SET NULL,
  step_order INTEGER NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('fill','review','sign','approve')),
  assigned_user_email TEXT,
  assigned_user_name TEXT,
  assigned_role TEXT NULL,
  required BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL,
  instructions TEXT NULL,
  due_at TIMESTAMPTZ NULL,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  completed_by_email TEXT NULL,
  signature_required BOOLEAN NOT NULL DEFAULT false,
  review_required BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  label TEXT,
  applies_to_document_type TEXT,
  steps_json JSONB NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT,
  changed_by TEXT,
  changed_by_type TEXT,
  note TEXT,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  document_id UUID NULL REFERENCES web_documents(id) ON DELETE SET NULL,
  workflow_step_id UUID NULL REFERENCES workflow_steps(id) ON DELETE SET NULL,
  actor_email TEXT,
  actor_name TEXT,
  action TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT NULL,
  user_agent TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  document_id UUID NULL REFERENCES web_documents(id) ON DELETE SET NULL,
  workflow_step_id UUID NULL REFERENCES workflow_steps(id) ON DELETE SET NULL,
  author_email TEXT,
  author_name TEXT,
  body TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'internal',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  request_id UUID NULL REFERENCES requests(id) ON DELETE SET NULL,
  document_id UUID NULL REFERENCES web_documents(id) ON DELETE SET NULL,
  workflow_step_id UUID NULL REFERENCES workflow_steps(id) ON DELETE SET NULL,
  read_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS action_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  document_id UUID NULL REFERENCES web_documents(id) ON DELETE SET NULL,
  workflow_step_id UUID NULL REFERENCES workflow_steps(id) ON DELETE SET NULL,
  token_hash TEXT UNIQUE NOT NULL,
  recipient_email TEXT,
  action_type TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  document_id UUID NULL REFERENCES web_documents(id) ON DELETE SET NULL,
  workflow_step_id UUID NULL REFERENCES workflow_steps(id) ON DELETE SET NULL,
  signer_email TEXT,
  signer_name TEXT,
  signature_type TEXT NOT NULL CHECK (signature_type IN ('canvas','typed_acknowledgement')),
  signature_data TEXT NULL,
  acknowledgement_text TEXT NULL,
  ip_address TEXT NULL,
  user_agent TEXT NULL,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integration_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  request_id UUID NULL REFERENCES requests(id) ON DELETE SET NULL,
  document_id UUID NULL REFERENCES web_documents(id) ON DELETE SET NULL,
  workflow_step_id UUID NULL REFERENCES workflow_steps(id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  dedupe_key TEXT UNIQUE NULL,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS document_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  category TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  icon TEXT NULL,
  render_mode TEXT NOT NULL,
  custom_component TEXT NULL,
  requires_signature BOOLEAN NOT NULL DEFAULT false,
  requires_review BOOLEAN NOT NULL DEFAULT false,
  allow_custom_workflow BOOLEAN NOT NULL DEFAULT true,
  default_workflow_template_id UUID NULL,
  storage_destination TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS form_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type_key TEXT NOT NULL REFERENCES document_types(key) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  schema_json JSONB NOT NULL,
  ui_schema_json JSONB NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_type_key, version)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_request_type ON requests(request_type);
CREATE INDEX IF NOT EXISTS idx_requests_priority ON requests(priority);
CREATE INDEX IF NOT EXISTS idx_requests_requester_email ON requests(requester_email);
CREATE INDEX IF NOT EXISTS idx_requests_assigned_to_email ON requests(assigned_to_email);
CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests(created_at);
CREATE INDEX IF NOT EXISTS idx_requests_due_at ON requests(due_at);
CREATE INDEX IF NOT EXISTS idx_requests_maintainx_id ON requests(maintainx_id);

CREATE INDEX IF NOT EXISTS idx_workflow_steps_assignee_status ON workflow_steps(assigned_user_email, status);
CREATE INDEX IF NOT EXISTS idx_workflow_steps_request_order ON workflow_steps(request_id, step_order);
CREATE INDEX IF NOT EXISTS idx_web_documents_request_id ON web_documents(request_id);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_read ON notifications(recipient_email, read_at);
CREATE INDEX IF NOT EXISTS idx_action_links_token_hash ON action_links(token_hash);
CREATE INDEX IF NOT EXISTS idx_audit_events_request_created ON audit_events(request_id, created_at);
CREATE INDEX IF NOT EXISTS idx_integration_events_status_created ON integration_events(status, created_at);
CREATE INDEX IF NOT EXISTS idx_integration_events_dedupe_key ON integration_events(dedupe_key);

