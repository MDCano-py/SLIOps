# Control Room Schema Delta (pre-migration)

**Date:** 2026-10-05  
**Baseline HEAD:** `1dc30915fa005d03373cea14b973113daa67918d`  
**Historical SHA `1e86af7…`:** unavailable — greenfield design  
**Existing migrations:** `001`–`014` — **no** control-room / shift / station tables found

## Decision

| Concept | Classification | Action |
| --- | --- | --- |
| Shift logs / board / tasks / handover / schedule | `MISSING_REQUIRED` | Create `cr_*` tables in `015_control_room.sql` |
| MaintainX assets/WOs | External | Store stable ID + display label only on CR rows |
| Hub `requests` / `audit_events` | `CURRENT_EXISTS` | **Do not** reuse for shift operational memory |
| Security audit logger | `CURRENT_EXISTS` | Keep separate; CR mutations also emit `control_room.*` security-audit lines |

## New tables (summary)

`cr_stations`, `cr_units`, `cr_shifts`, `cr_shift_assignments`, `cr_shift_logs`, `cr_shift_log_revisions`, `cr_acknowledgements`, `cr_board_items`, `cr_tasks`, `cr_handovers`, `cr_schedule_assignments`

No duplicate of existing hub request/workflow tables.  
**No production station/unit seed** in `015` — bootstrap real sites at deploy (`control-room-production-bootstrap.md`).
