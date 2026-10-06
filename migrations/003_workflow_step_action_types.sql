-- 003_workflow_step_action_types.sql
-- Hub workflow steps use extended action types (send_to_maintainx, upload, close, intake, etc.).
-- The original CHECK allowed only fill/review/sign/approve, which breaks demo seed and MaintainX handoff steps.

ALTER TABLE workflow_steps DROP CONSTRAINT IF EXISTS workflow_steps_action_type_check;
