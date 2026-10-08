-- 016_template_action_links.sql
-- Reuse hub action_links for template (form_submissions) external secure actions.
-- Does not invent a new token scheme — same token_hash / used_at / revoked_at / expires_at.

ALTER TABLE action_links
  ALTER COLUMN request_id DROP NOT NULL;

ALTER TABLE action_links
  ADD COLUMN IF NOT EXISTS submission_id UUID NULL REFERENCES form_submissions(id) ON DELETE CASCADE;

ALTER TABLE action_links
  ADD COLUMN IF NOT EXISTS workflow_step_instance_id UUID NULL REFERENCES workflow_step_instances(id) ON DELETE CASCADE;

ALTER TABLE action_links DROP CONSTRAINT IF EXISTS action_links_runtime_target_chk;
ALTER TABLE action_links
  ADD CONSTRAINT action_links_runtime_target_chk CHECK (
    (request_id IS NOT NULL AND submission_id IS NULL)
    OR (request_id IS NULL AND submission_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_action_links_submission
  ON action_links (submission_id)
  WHERE submission_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_action_links_step_instance
  ON action_links (workflow_step_instance_id)
  WHERE workflow_step_instance_id IS NOT NULL;
