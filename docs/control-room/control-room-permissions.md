# Control Room Permissions

**Date:** 2026-10-05  
**Status:** PROPOSALS ONLY — do not seed until business validates role mappings  
**Rule:** Control Room uses existing SLIOps authorization (`PERMISSION_CATALOG` + server `requirePermissions`). No second permissions DB.

---

## Candidate capabilities

| Permission | Action |
| --- | --- |
| `control_room_view` | Enter Control Room, read allowed surfaces |
| `control_room_log` | Create/edit own allowed shift logs |
| `control_room_acknowledge` | Append acknowledgements |
| `control_room_task_manage` | Create/assign/complete tasks |
| `control_room_board_manage` | Create/update board items |
| `control_room_handover` | Submit/acknowledge handover |
| `control_room_schedule_view` | View schedule/coverage |
| `control_room_schedule_manage` | Edit schedule assignments |
| `control_room_supervisor` | Supervisor overview + privileged ops actions |
| `control_room_admin` | CR configuration |

Reuse existing equivalents if discovery finds them — **none exist today**.

---

## Resource scope questions (MUST be answered by business)

| # | Question | Answer | Decider |
| --- | --- | --- | --- |
| 1 | Can any operator at a station see all station logs? | TBD | Ops / Dylan |
| 2 | Can all operators see all board items? | TBD | Ops |
| 3 | Are tasks visible to whole team or assignee + supervisors only? | TBD | Ops |
| 4 | Can operators acknowledge another shift's logs? | TBD | Ops |
| 5 | Can only supervisors resolve board items? | TBD | Ops |
| 6 | Is schedule editable by supervisors only? | TBD | Ops |
| 7 | Which existing portal roles get which `control_room_*`? | TBD | Ops + Eng |

Do **not** default to `created_by = currentUser` privacy for shared operational records.

---

## Mapping process

1. Define capability per action.  
2. Compare to existing catalog.  
3. Add only needed `control_room_*` IDs.  
4. Propose role mappings.  
5. Review against discovered business roles.  
6. Update migrations/seeds only after validation.  
7. Enforce server-side; align UI visibility last.

---

## Vertical / horizontal test intent

| Case | Expect |
| --- | --- |
| Standard without CR perms calling CR mutation | 403, no write |
| Standard with view-only calling resolve board | 403 |
| UserA vs UserB on **documented isolated** resource | per policy (do not manufacture denial on shared logs) |
| Supervisor mutation | 200 + audit |
