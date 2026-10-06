-- WOS-44 Vendor Master List — centralized system of record (Postgres)

CREATE TABLE IF NOT EXISTS vendor_master (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_number TEXT UNIQUE NOT NULL,
  company_name TEXT NOT NULL DEFAULT '',
  entity_type TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  service_description TEXT NOT NULL DEFAULT '',
  requested_by TEXT NOT NULL DEFAULT '',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  overall_status TEXT NOT NULL DEFAULT 'pending_rebekah_review',
  admin_status TEXT NOT NULL DEFAULT 'pending_review',
  ap_status TEXT NOT NULL DEFAULT 'not_started',
  contract_status TEXT NOT NULL DEFAULT 'not_started',
  assigned_to TEXT NOT NULL DEFAULT 'rebekah',
  last_action_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  w9_status TEXT NOT NULL DEFAULT 'not_received',
  banking_status TEXT NOT NULL DEFAULT 'not_received',
  insurance_status TEXT NOT NULL DEFAULT 'not_received',
  msa_status TEXT NOT NULL DEFAULT 'not_required',
  nda_status TEXT NOT NULL DEFAULT 'not_required',
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  document_meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  history_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_master_overall_status ON vendor_master(overall_status);
CREATE INDEX IF NOT EXISTS idx_vendor_master_assigned_to ON vendor_master(assigned_to);
CREATE INDEX IF NOT EXISTS idx_vendor_master_requested_at ON vendor_master(requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_master_last_action_at ON vendor_master(last_action_at DESC);
