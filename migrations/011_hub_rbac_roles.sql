-- 011_hub_rbac_roles.sql — WOS-72 durable workflow role catalog + user assignments (Postgres)
-- Portal permission bundles remain in Redis until RDS migration sync; workflow onboarding roles live here.

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  system_role BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_email TEXT NOT NULL,
  role_key TEXT NOT NULL REFERENCES roles(key) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  PRIMARY KEY (user_email, role_key)
);

CREATE INDEX IF NOT EXISTS idx_roles_status_key ON roles(status, key);
CREATE INDEX IF NOT EXISTS idx_user_roles_email ON user_roles(user_email);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_key ON user_roles(role_key);

INSERT INTO roles (key, name, description, status, system_role)
VALUES
  ('admin', 'Admin', 'Full workflow administration and sign-off', 'active', true),
  ('requester', 'Requester', 'Submitter who fills and completes requester steps', 'active', true),
  ('manager', 'Manager', 'Review and approve manager-assigned steps', 'active', true),
  ('operations', 'Operations', 'Operations review and fulfillment steps', 'active', true),
  ('ap', 'Accounts Payable', 'AP review and approval steps', 'active', true),
  ('legal', 'Legal', 'Legal review and sign-off steps', 'active', true)
ON CONFLICT (key) DO NOTHING;
