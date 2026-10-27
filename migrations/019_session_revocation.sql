-- Additive session-revocation cutoff for employee logout.
-- Apply on staging before setting SLIOPS_SESSION_REVOCATION_STORE=postgres.
-- Does not rewrite or delete existing rows.

CREATE TABLE IF NOT EXISTS sliops_session_revocation (
  email text PRIMARY KEY,
  revoked_through_iat bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
