# Control Room — Phase 2 Implementation Plan

**Date:** 2026-10-05 (updated after historical recovery attempt)  
**Status:** BLOCKED on Gates 1–3 completion review + historical source  
**Product boundary:** Operational memory and shift continuity inside SLIOps. Not MaintainX, Paycom, Snowflake, or a second RBAC system.

---

## Historical source recovery

| Check | Result |
| --- | --- |
| `git fetch --all --prune` | No remotes configured in this clone |
| `git branch -a` | `master`, `security-production-readiness` only |
| `git show 1e86af775ca4aa941ece8b4cd54e255fd9d0081a` | **fatal: bad object** — not in object store |
| `control-room-workspace` branch | **Not present** |

**Conclusion:** Historical Control Room commit **cannot be recovered from this repository**. Do not greenfield schema until an external archive (GitHub remote with that SHA, bundle, or zip) is provided — or an explicit business greenlight for net-new design is given.

---

## Current vs required delta

| Capability | Classification | Notes |
| --- | --- | --- |
| Operations → Control Room nav | `MISSING_REQUIRED` | No nav item in current SPA |
| Current Shift | `MISSING_REQUIRED` | |
| Quick Log + timeline | `MISSING_REQUIRED` | |
| Acknowledgements (append-only) | `MISSING_REQUIRED` | |
| Stations / units | `MISSING_REQUIRED` | No tables in migrations 001–014 |
| Handover | `MISSING_REQUIRED` | |
| Operating Board | `MISSING_REQUIRED` | |
| Operator Tasks | `MISSING_REQUIRED` | |
| Schedule foundation | `MISSING_REQUIRED` | |
| History | `MISSING_REQUIRED` | |
| Supervisor Overview / KPI | `MISSING_REQUIRED` | |
| `/hub/control-room/*` APIs | `MISSING_REQUIRED` | |
| Postgres CR schema | `MISSING_REQUIRED` | |
| Historical implementation | `UNKNOWN` / unreachable | Cannot classify `HISTORICAL_ONLY` without object |
| Signed-out boot test `#/control-room` string | `OBSOLETE` as product route | Test URL only; no page |

When historical source arrives, re-run inventory and mark each item `CURRENT_EXISTS` / `HISTORICAL_ONLY` / `MISSING_REQUIRED` / `OBSOLETE` / `CONFLICTS_WITH_CURRENT`.

---

## Permission strategy (capabilities only — no role assignment yet)

Candidate capabilities (not roles):

`control_room_view`, `control_room_log`, `control_room_acknowledge`, `control_room_handover`, `control_room_task_manage`, `control_room_board_manage`, `control_room_schedule_view`, `control_room_schedule_manage`, `control_room_supervisor`

Assume operational records may be **shared** unless an existing business rule says otherwise. Do **not** default to `created_by` ownership.

See `control-room-permissions.md` for open business questions.

---

## Prerequisites before coding Gate 4

1. Gate 1 remote exposure probes pass (`INFRASTRUCTURE_CHANGE_REQUIRED` until then).  
2. Gate 2 Critical/High code items reviewed (this branch).  
3. Gate 3 WOS regression accepted.  
4. Historical CR source **or** greenlight for greenfield schema.  
5. Business answers for resource scope.

---

## Explicitly deferred

Snowflake, Paycom, Samsara, AI, MaintainX WO replacement, major UI redesign, new microservices, CR migrations/UI in this execution.
