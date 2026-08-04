-- 014_workflow_runtime_notifications.sql — WOS-96 production runtime identity, claim, notifications

-- Task assignment identity + shared-queue claim
ALTER TABLE cfg_workflow_tasks
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS instructions TEXT,
  ADD COLUMN IF NOT EXISTS assignment_mode TEXT,
  ADD COLUMN IF NOT EXISTS assigned_user_id UUID,
  ADD COLUMN IF NOT EXISTS claimed_by_user_id UUID,
  ADD COLUMN IF NOT EXISTS claimed_by_email TEXT,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS related_request_id UUID,
  ADD COLUMN IF NOT EXISTS assignment_summary TEXT,
  ADD COLUMN IF NOT EXISTS fallback_applied TEXT;

ALTER TABLE cfg_workflow_tasks DROP CONSTRAINT IF EXISTS cfg_workflow_tasks_status_check;
ALTER TABLE cfg_workflow_tasks
  ADD CONSTRAINT cfg_workflow_tasks_status_check
  CHECK (status IN ('open', 'claimed', 'in_progress', 'completed', 'cancelled', 'expired', 'failed'));

ALTER TABLE cfg_node_executions
  ADD COLUMN IF NOT EXISTS assigned_user_id UUID,
  ADD COLUMN IF NOT EXISTS assignment_mode TEXT,
  ADD COLUMN IF NOT EXISTS assignment_error TEXT;

ALTER TABLE cfg_workflow_instances
  ADD COLUMN IF NOT EXISTS request_type_definition_id UUID,
  ADD COLUMN IF NOT EXISTS request_type_version_id UUID,
  ADD COLUMN IF NOT EXISTS form_template_id UUID,
  ADD COLUMN IF NOT EXISTS form_version_id UUID,
  ADD COLUMN IF NOT EXISTS started_by_user_id UUID;

-- Notifications: link to configurable tasks + dedupe
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS recipient_user_id UUID,
  ADD COLUMN IF NOT EXISTS cfg_workflow_task_id UUID,
  ADD COLUMN IF NOT EXISTS cfg_workflow_instance_id UUID,
  ADD COLUMN IF NOT EXISTS action_url TEXT,
  ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT,
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe_key
  ON notifications (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread
  ON notifications (recipient_email, read_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_user_unread
  ON notifications (recipient_user_id, read_at, created_at DESC)
  WHERE recipient_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cfg_tasks_user_status
  ON cfg_workflow_tasks (assigned_user_id, status);

CREATE INDEX IF NOT EXISTS idx_cfg_tasks_claimed
  ON cfg_workflow_tasks (claimed_by_user_id, status);

CREATE INDEX IF NOT EXISTS idx_cfg_tasks_request
  ON cfg_workflow_tasks (related_request_id);

CREATE INDEX IF NOT EXISTS idx_cfg_tasks_due
  ON cfg_workflow_tasks (due_at)
  WHERE due_at IS NOT NULL;

-- External secure participants (no privileged internal user insert)
CREATE TABLE IF NOT EXISTS cfg_external_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES cfg_workflow_tasks(id) ON DELETE CASCADE,
  instance_id UUID NOT NULL REFERENCES cfg_workflow_instances(id) ON DELETE CASCADE,
  related_request_id UUID NULL,
  display_name TEXT,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NULL,
  reminder_count INTEGER NOT NULL DEFAULT 0,
  last_reminded_at TIMESTAMPTZ NULL,
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cfg_ext_part_email ON cfg_external_participants (email);
CREATE INDEX IF NOT EXISTS idx_cfg_ext_part_task ON cfg_external_participants (task_id);
