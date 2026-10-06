-- WOS-85 — Staging test-user support on users table + extended workflow roles.
-- Idempotent: safe to re-run via db:migrate.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_staging_test_user BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_status_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_status_check
      CHECK (status IN ('active', 'inactive', 'archived'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_staging_test
  ON users (is_staging_test_user)
  WHERE is_staging_test_user = true;

-- Extended workflow roles used by staging test personas (system roles).
INSERT INTO roles (key, name, description, status, system_role, created_at, updated_at)
VALUES
  ('hr', 'HR Manager', 'Human resources review and people workflows', 'active', true, now(), now()),
  ('field_supervisor', 'Field Supervisor', 'Field crew supervision and field approvals', 'active', true, now(), now()),
  ('field_technician', 'Field Technician', 'Field execution and form completion', 'active', true, now(), now()),
  ('client', 'Client Representative', 'External client visibility into assigned work', 'active', true, now(), now()),
  ('vendor', 'External Vendor', 'External vendor portal access', 'active', true, now(), now())
ON CONFLICT (key) DO NOTHING;
