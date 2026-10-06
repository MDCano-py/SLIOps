# Control Room Permissions — Final Mapping

**Date:** 2026-10-05  
**Status:** APPROVED for deployment (least privilege against documented roles)  
**Source of roles:** `docs/security/2026-auth-rbac-model.md` + `BUILT_IN_ROLES` in `api/maintainx.js`  
**Rule:** Control Room uses existing SLIOps authorization (`PERMISSION_CATALOG` + server gates). No second permissions DB. No invented organizational roles.

---

## Capabilities

| Permission | Action |
| --- | --- |
| `control_room_view` | Enter Control Room, read surfaces |
| `control_room_log` | Create/edit shift logs |
| `control_room_acknowledge` | Append acknowledgements |
| `control_room_task_manage` | Create/assign/complete tasks |
| `control_room_board_manage` | Create/update/resolve board items |
| `control_room_handover` | Submit/acknowledge handover |
| `control_room_schedule_view` | View schedule/coverage |
| `control_room_schedule_manage` | Edit schedule assignments |
| `control_room_supervisor` | Supervisor overview |

`control_room_admin` is **not** shipped (deferred). Station/unit bootstrap is SQL/ops, not a catalog capability.

---

## Capability packs

**Operator pack** (day-to-day floor ops):

`control_room_view`, `control_room_log`, `control_room_acknowledge`, `control_room_handover`, `control_room_task_manage`, `control_room_board_manage`, `control_room_schedule_view`

**Supervisor pack** (operator + privileged):

Operator pack + `control_room_schedule_manage` + `control_room_supervisor`

**Hub Admin / elevated:** any user with `admin` or `hub_admin` receives all Control Room capabilities via existing elevated short-circuit (`hasElevated` in `api/lib/control-room/permissions.js`). Management built-in role also lists the supervisor pack explicitly.

---

## Built-in portal role mapping (`BUILT_IN_ROLES`)

| Role | Control Room grant | Rationale |
| --- | --- | --- |
| `employee` | **Operator pack** | Normal operational users (SSO default / Employee) |
| `requester` | **None** | Vendor-submit extension of employee; not floor Control Room |
| `accounts_payable` | **None** | Vendor finance; not Control Room |
| `management` | **Supervisor pack** (+ `hub_admin` short-circuit) | Privileged operational/admin users |

Existing Redis roles pick up missing built-in permissions via idempotent `seedBuiltInRoles` merge on next role read/seed.

SSO auto-provision fallback `EMPLOYEE_PRESET_PERMISSIONS` includes the operator pack.

---

## Staging / Postgres workflow personas (test only)

| Persona `roleKey` | Control Room grant |
| --- | --- |
| `field_technician` | Operator pack |
| `field_supervisor` | Supervisor pack |
| `operations` | Supervisor pack |
| `hub_admin` | All CR (explicit + elevated) |
| `hr`, `ap`, `client`, `vendor` | None |

These are staging test users, not new production org roles.

---

## Resource authorization default (multi-station)

Until Streamline defines stricter station isolation:

1. Control Room operational records are **shared** with any authenticated user who holds the corresponding `control_room_*` capability for the action.
2. **Do not** use `created_by = currentUser` as an access model.
3. **Station isolation is not enforced** and must not be claimed in security reports.
4. Helpers accept optional `{ stationId, allowedStationIds }` and honor `CONTROL_ROOM_STATION_SCOPE=on` later without API redesign (`canAccessCrResource`).

Documented in code: `api/lib/control-room/permissions.js`.

---

## Production role grant checklist

1. Confirm live `role:employee` includes operator pack (merge runs automatically; verify in Role Management UI).
2. Confirm live `role:management` includes supervisor pack.
3. Confirm Hub Admin users have `hub_admin` and/or `admin`.
4. Do **not** grant CR to `accounts_payable` / `requester` unless product later expands scope.
5. Custom roles: grant operator or supervisor pack deliberately — never invent a new built-in role for CR alone.

---

## Vertical / horizontal test intent

| Case | Expect |
| --- | --- |
| User without CR capability → CR mutation | 403 |
| `employee` with operator pack → log/ack/task/board/handover/schedule view | allowed |
| `employee` → schedule manage / supervisor | 403 |
| `management` / Hub Admin → supervisor + schedule manage | allowed |
| UserA vs UserB on shared station logs | both allowed when both have capability (not a horizontal deny) |
