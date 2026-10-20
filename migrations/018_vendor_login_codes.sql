-- 018_vendor_login_codes.sql
-- Email verification codes for vendor contacts.
-- Additive. Does not alter vendor_master or historical rows.
-- Rollback: DROP TABLE IF EXISTS vendor_login_codes;

CREATE TABLE IF NOT EXISTS vendor_login_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendor_master(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES vendor_contacts(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  code_salt TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_login_codes_contact_active
  ON vendor_login_codes (contact_id, created_at DESC)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vendor_login_codes_vendor
  ON vendor_login_codes (vendor_id);
