-- 004_integration_events_outbox.sql — WOS-35 Phase 1 durable outbox fields for integration_events

ALTER TABLE integration_events
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS locked_by TEXT NULL,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS source_system TEXT NULL,
  ADD COLUMN IF NOT EXISTS destination_system TEXT NULL;

-- Backfill timestamps for existing rows (preserve payloads and status values)
UPDATE integration_events
SET processed_at = sent_at
WHERE sent_at IS NOT NULL AND processed_at IS NULL;

UPDATE integration_events
SET processed_at = created_at
WHERE processed_at IS NULL
  AND status IN (
    'processed',
    'unmatched',
    'ambiguous',
    'invalid_token',
    'duplicate',
    'received'
  );

UPDATE integration_events
SET updated_at = COALESCE(sent_at, created_at)
WHERE updated_at IS NULL;

UPDATE integration_events
SET source_system = 'wos_hub'
WHERE source_system IS NULL;

UPDATE integration_events
SET destination_system = 'n8n'
WHERE destination_system IS NULL
  AND event_type NOT IN ('inbound_email')
  AND status IN ('pending', 'retrying', 'failed', 'sent', 'processing');

UPDATE integration_events
SET destination_system = 'inbound_audit'
WHERE destination_system IS NULL
  AND event_type = 'inbound_email';

CREATE INDEX IF NOT EXISTS idx_integration_events_pending_dispatch
  ON integration_events (status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'retrying');

CREATE INDEX IF NOT EXISTS idx_integration_events_locked
  ON integration_events (locked_at)
  WHERE locked_at IS NOT NULL;
