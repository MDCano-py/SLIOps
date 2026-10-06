-- WOS-62 — Submission runtime audit trail (reuses hub event conventions, submission-scoped).
CREATE TABLE IF NOT EXISTS form_submission_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_email TEXT,
  detail TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_form_submission_events_submission_created
  ON form_submission_events(submission_id, created_at ASC);
