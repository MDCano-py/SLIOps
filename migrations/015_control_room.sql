-- 015_control_room.sql — Control Room operator MVP (shift continuity)
-- Greenfield: no prior cr_* tables in 001–014. Do not reuse hub request tables.

CREATE TABLE IF NOT EXISTS cr_stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cr_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES cr_stations(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (station_id, key)
);

CREATE TABLE IF NOT EXISTS cr_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES cr_stations(id),
  name TEXT NOT NULL DEFAULT 'Shift',
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_cr_shifts_station_time ON cr_shifts (station_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_cr_shifts_status ON cr_shifts (status, starts_at DESC);

CREATE TABLE IF NOT EXISTS cr_shift_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES cr_shifts(id) ON DELETE CASCADE,
  operator_email TEXT NOT NULL,
  role_context TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shift_id, operator_email)
);

CREATE INDEX IF NOT EXISTS idx_cr_shift_assignments_email ON cr_shift_assignments (operator_email);

CREATE TABLE IF NOT EXISTS cr_shift_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES cr_shifts(id),
  station_id UUID NOT NULL REFERENCES cr_stations(id),
  unit_id UUID REFERENCES cr_units(id),
  category TEXT NOT NULL DEFAULT 'Operations'
    CHECK (category IN ('Operations', 'Maintenance', 'Safety', 'Process', 'Communication', 'Other')),
  priority TEXT NOT NULL DEFAULT 'Normal'
    CHECK (priority IN ('Normal', 'Attention', 'Urgent')),
  summary TEXT NOT NULL,
  details TEXT,
  event_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  follow_up BOOLEAN NOT NULL DEFAULT false,
  carryover BOOLEAN NOT NULL DEFAULT false,
  maintainx_asset_id TEXT,
  maintainx_asset_label TEXT,
  maintainx_wo_id TEXT,
  maintainx_wo_label TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cr_shift_logs_shift_event ON cr_shift_logs (shift_id, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_cr_shift_logs_station_event ON cr_shift_logs (station_id, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_cr_shift_logs_priority ON cr_shift_logs (priority, event_at DESC);

CREATE TABLE IF NOT EXISTS cr_shift_log_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id UUID NOT NULL REFERENCES cr_shift_logs(id) ON DELETE CASCADE,
  revision_no INT NOT NULL,
  snapshot JSONB NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (log_id, revision_no)
);

CREATE TABLE IF NOT EXISTS cr_acknowledgements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type TEXT NOT NULL CHECK (target_type IN ('shift_log', 'handover', 'board_item')),
  target_id UUID NOT NULL,
  user_email TEXT NOT NULL,
  shift_id UUID REFERENCES cr_shifts(id),
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (target_type, target_id, user_email)
);

CREATE INDEX IF NOT EXISTS idx_cr_ack_target ON cr_acknowledgements (target_type, target_id);

CREATE TABLE IF NOT EXISTS cr_board_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES cr_stations(id),
  unit_id UUID REFERENCES cr_units(id),
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'Operations'
    CHECK (category IN ('Operations', 'Maintenance', 'Safety', 'Process', 'Communication', 'Other')),
  priority TEXT NOT NULL DEFAULT 'Normal'
    CHECK (priority IN ('Normal', 'Attention', 'Urgent')),
  status TEXT NOT NULL DEFAULT 'Open'
    CHECK (status IN ('Open', 'Monitoring', 'Blocked', 'Resolved')),
  owner_email TEXT,
  target_date TIMESTAMPTZ,
  linked_log_id UUID REFERENCES cr_shift_logs(id),
  maintainx_asset_id TEXT,
  maintainx_asset_label TEXT,
  maintainx_wo_id TEXT,
  maintainx_wo_label TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_cr_board_open ON cr_board_items (station_id, status) WHERE status <> 'Resolved';

CREATE TABLE IF NOT EXISTS cr_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES cr_stations(id),
  unit_id UUID REFERENCES cr_units(id),
  title TEXT NOT NULL,
  description TEXT,
  assignee_email TEXT,
  due_at TIMESTAMPTZ,
  priority TEXT NOT NULL DEFAULT 'Normal'
    CHECK (priority IN ('Normal', 'Attention', 'Urgent')),
  source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'Open'
    CHECK (status IN ('Open', 'In Progress', 'Completed', 'Cancelled')),
  linked_log_id UUID REFERENCES cr_shift_logs(id),
  linked_board_id UUID REFERENCES cr_board_items(id),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_by TEXT,
  completed_at TIMESTAMPTZ,
  completion_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_cr_tasks_assignee ON cr_tasks (assignee_email, status);
CREATE INDEX IF NOT EXISTS idx_cr_tasks_due ON cr_tasks (due_at) WHERE status IN ('Open', 'In Progress');

CREATE TABLE IF NOT EXISTS cr_handovers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outgoing_shift_id UUID NOT NULL REFERENCES cr_shifts(id),
  incoming_shift_id UUID REFERENCES cr_shifts(id),
  station_id UUID NOT NULL REFERENCES cr_stations(id),
  outgoing_note TEXT,
  outgoing_by TEXT NOT NULL,
  outgoing_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  incoming_ack_by TEXT,
  incoming_ack_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cr_handovers_station ON cr_handovers (station_id, outgoing_at DESC);

CREATE TABLE IF NOT EXISTS cr_schedule_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES cr_stations(id),
  operator_email TEXT NOT NULL,
  work_date DATE NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  role_context TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_cr_schedule_station_date ON cr_schedule_assignments (station_id, work_date);
CREATE INDEX IF NOT EXISTS idx_cr_schedule_operator ON cr_schedule_assignments (operator_email, work_date);

-- Seed a default station/unit so operators can log immediately after migrate
INSERT INTO cr_stations (key, name)
VALUES ('main', 'Main Station')
ON CONFLICT (key) DO NOTHING;

INSERT INTO cr_units (station_id, key, name)
SELECT s.id, 'unit-1', 'Unit 1'
FROM cr_stations s
WHERE s.key = 'main'
ON CONFLICT (station_id, key) DO NOTHING;
