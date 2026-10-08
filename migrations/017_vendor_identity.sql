-- 017_vendor_identity.sql
-- External vendor contact identity, magic-link invitations, and vendor sessions.
-- Extends vendor_master; does not duplicate vendor company records.

CREATE TABLE IF NOT EXISTS vendor_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendor_master(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'revoked')),
  invited_at TIMESTAMPTZ NULL,
  last_authenticated_at TIMESTAMPTZ NULL,
  disabled_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, email)
);

CREATE INDEX IF NOT EXISTS idx_vendor_contacts_vendor ON vendor_contacts(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_contacts_email ON vendor_contacts(lower(email));

CREATE TABLE IF NOT EXISTS vendor_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendor_master(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES vendor_contacts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL DEFAULT 'vendor_workspace_access',
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_vendor_invitations_contact ON vendor_invitations(contact_id);
CREATE INDEX IF NOT EXISTS idx_vendor_invitations_vendor ON vendor_invitations(vendor_id);

CREATE TABLE IF NOT EXISTS vendor_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendor_master(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES vendor_contacts(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL UNIQUE,
  verified_email TEXT NOT NULL,
  scopes_json JSONB NOT NULL DEFAULT '["vendor_workspace"]'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  idle_expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_sessions_contact ON vendor_sessions(contact_id);
CREATE INDEX IF NOT EXISTS idx_vendor_sessions_vendor ON vendor_sessions(vendor_id);

CREATE TABLE IF NOT EXISTS vendor_identity_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  vendor_id UUID NULL REFERENCES vendor_master(id) ON DELETE SET NULL,
  contact_id UUID NULL REFERENCES vendor_contacts(id) ON DELETE SET NULL,
  actor_kind TEXT NOT NULL DEFAULT 'system',
  actor_id TEXT NOT NULL DEFAULT '',
  detail TEXT,
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_identity_audit_vendor ON vendor_identity_audit(vendor_id, created_at DESC);
