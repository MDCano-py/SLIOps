-- 013_configurable_platform.sql — WOS-93 configuration-first platform foundation
-- Additive only. Existing form_templates / workflow_steps / requests remain intact.
-- Dual runtime: legacy + configurable (cfg_workflow_instances.runtime_type).

CREATE TABLE IF NOT EXISTS cfg_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'form', 'workflow', 'document', 'dashboard', 'request_type', 'variable', 'saved_view'
  )),
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived', 'deprecated')),
  current_published_version_id UUID NULL,
  current_draft_version_id UUID NULL,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ NULL,
  UNIQUE (kind, key)
);

CREATE TABLE IF NOT EXISTS cfg_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id UUID NOT NULL REFERENCES cfg_definitions(id) ON DELETE CASCADE,
  version_number INTEGER NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived', 'deprecated')),
  revision INTEGER NOT NULL DEFAULT 1,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  published_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ NULL,
  CONSTRAINT cfg_versions_version_number_positive
    CHECK (version_number IS NULL OR version_number > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cfg_versions_def_version_number
  ON cfg_versions (definition_id, version_number)
  WHERE version_number IS NOT NULL;

ALTER TABLE cfg_definitions
  DROP CONSTRAINT IF EXISTS cfg_definitions_published_fk;
ALTER TABLE cfg_definitions
  ADD CONSTRAINT cfg_definitions_published_fk
  FOREIGN KEY (current_published_version_id)
  REFERENCES cfg_versions(id)
  ON DELETE SET NULL;

ALTER TABLE cfg_definitions
  DROP CONSTRAINT IF EXISTS cfg_definitions_draft_fk;
ALTER TABLE cfg_definitions
  ADD CONSTRAINT cfg_definitions_draft_fk
  FOREIGN KEY (current_draft_version_id)
  REFERENCES cfg_versions(id)
  ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS cfg_variable_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NULL,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT,
  value_type TEXT NOT NULL DEFAULT 'string',
  value_json JSONB NOT NULL DEFAULT 'null'::jsonb,
  sensitive BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cfg_workflow_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NULL,
  definition_id UUID NOT NULL REFERENCES cfg_definitions(id) ON DELETE RESTRICT,
  version_id UUID NOT NULL REFERENCES cfg_versions(id) ON DELETE RESTRICT,
  runtime_type TEXT NOT NULL DEFAULT 'configurable' CHECK (runtime_type IN ('configurable', 'legacy')),
  related_request_id UUID NULL,
  related_submission_id UUID NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN (
    'pending', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'rejected'
  )),
  current_node_key TEXT,
  context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  failure_summary TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS cfg_node_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID NOT NULL REFERENCES cfg_workflow_instances(id) ON DELETE CASCADE,
  node_key TEXT NOT NULL,
  node_type TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN (
    'pending', 'ready', 'running', 'waiting', 'completed', 'failed', 'skipped', 'cancelled'
  )),
  attempt INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT NOT NULL,
  inputs_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  outputs_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  condition_result_json JSONB NULL,
  assignee_email TEXT,
  assignee_role TEXT,
  error_summary TEXT,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (instance_id, node_key, attempt)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cfg_node_exec_idempotency
  ON cfg_node_executions (idempotency_key);

CREATE TABLE IF NOT EXISTS cfg_workflow_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID NOT NULL REFERENCES cfg_workflow_instances(id) ON DELETE CASCADE,
  node_execution_id UUID NOT NULL REFERENCES cfg_node_executions(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'cancelled', 'failed')),
  assigned_user_email TEXT,
  assigned_role TEXT,
  due_at TIMESTAMPTZ NULL,
  outcome TEXT,
  form_submission_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  comment TEXT,
  completed_by TEXT,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cfg_generated_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id UUID REFERENCES cfg_definitions(id) ON DELETE SET NULL,
  version_id UUID REFERENCES cfg_versions(id) ON DELETE SET NULL,
  instance_id UUID REFERENCES cfg_workflow_instances(id) ON DELETE SET NULL,
  related_request_id UUID NULL,
  title TEXT NOT NULL,
  body_html TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  pdf_status TEXT NOT NULL DEFAULT 'unavailable',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cfg_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NULL,
  actor_email TEXT,
  action TEXT NOT NULL,
  definition_kind TEXT,
  definition_id UUID,
  version_id UUID,
  before_summary JSONB,
  after_summary JSONB,
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cfg_definitions_kind_status ON cfg_definitions (kind, status);
CREATE INDEX IF NOT EXISTS idx_cfg_definitions_published ON cfg_definitions (current_published_version_id);
CREATE INDEX IF NOT EXISTS idx_cfg_versions_def_status ON cfg_versions (definition_id, status);
CREATE INDEX IF NOT EXISTS idx_cfg_versions_updated ON cfg_versions (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cfg_wf_inst_state ON cfg_workflow_instances (state);
CREATE INDEX IF NOT EXISTS idx_cfg_wf_inst_request ON cfg_workflow_instances (related_request_id);
CREATE INDEX IF NOT EXISTS idx_cfg_wf_inst_def ON cfg_workflow_instances (definition_id, version_id);
CREATE INDEX IF NOT EXISTS idx_cfg_node_exec_inst_state ON cfg_node_executions (instance_id, state);
CREATE INDEX IF NOT EXISTS idx_cfg_node_exec_assignee ON cfg_node_executions (assignee_email);
CREATE INDEX IF NOT EXISTS idx_cfg_tasks_assignee ON cfg_workflow_tasks (assigned_user_email, status);
CREATE INDEX IF NOT EXISTS idx_cfg_tasks_role ON cfg_workflow_tasks (assigned_role, status);
CREATE INDEX IF NOT EXISTS idx_cfg_audit_def ON cfg_audit_events (definition_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cfg_audit_created ON cfg_audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cfg_variables_active ON cfg_variable_definitions (active);
