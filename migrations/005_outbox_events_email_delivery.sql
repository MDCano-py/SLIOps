-- 005_outbox_events_email_delivery.sql — WOS-36 internal email delivery outbox

CREATE TABLE IF NOT EXISTS outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key TEXT UNIQUE NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NULL,
  locked_at TIMESTAMPTZ NULL,
  locked_by TEXT NULL,
  processed_at TIMESTAMPTZ NULL,
  last_attempt_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  request_id UUID NULL REFERENCES requests(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbox_events_pending_dispatch
  ON outbox_events (status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'retrying');

CREATE INDEX IF NOT EXISTS idx_outbox_events_request
  ON outbox_events (request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbox_events_locked
  ON outbox_events (locked_at)
  WHERE locked_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_outbox_events_dedupe_key
  ON outbox_events (dedupe_key);
