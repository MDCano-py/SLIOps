# Control Room + Security Baseline — Release Summary

**Do not deploy from this document alone — use `docs/security/ec2-final-validation-checklist.md`.**

| Field | Value |
| --- | --- |
| **Release branch** | `control-room-phase2-secure-base` |
| **Exact SHA** | `PLACEHOLDER_TIP_SHA` |
| **Baseline security SHA** | `1dc30915fa005d03373cea14b973113daa67918d` |
| **Migrations** | `015_control_room.sql` (additive `cr_*` only; no WOS table changes; **no** station/unit seed) |

---

## Required environment variables

Already required by staging/production SLIOps (unchanged):

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Postgres/RDS — required for CR persistence |
| `HUB_STORE_MODE=postgres` | Production/staging |
| `SESSION_SECRET` | ≥32 chars |
| `CLEANUP_SECRET` | ≥16 chars |
| `PORTAL_BASE_URL` / `APP_BASE_PATH` / `ALLOWED_ORIGIN` | Match public URL |
| `SSO_ENFORCEMENT=on` | Production |
| AuthBridge / Entra vars | As currently deployed |
| `MAINTAINX_API_KEY` | Optional — CR works without MaintainX |
| S3 vars | Optional — existing object storage |

Control Room–specific (optional):

| Variable | Default | Notes |
| --- | --- | --- |
| `CONTROL_ROOM_STORE` | unset → postgres when hub postgres | Set `memory` only for local tests |
| `CONTROL_ROOM_STATION_SCOPE` | off | Do **not** enable until product defines station allowlists |

---

## Required manual production values

You must supply during the EC2 session:

1. **Real station keys/names** (and units) for SQL bootstrap — see `control-room-production-bootstrap.md`
2. Confirmation that live `employee` / `management` roles received merged `control_room_*` grants
3. Which identities are Hub Admin (`hub_admin` / `admin`) for supervisor verification
4. Existing secrets already on the host (do not invent new ones in tickets)

---

## Required role grants

| Built-in role | Grant |
| --- | --- |
| `employee` | Operator pack |
| `management` | Supervisor pack |
| Hub Admin (`hub_admin` / `admin`) | All CR via elevated short-circuit |
| `requester`, `accounts_payable` | None |

Details: `docs/control-room/control-room-permissions.md`.

---

## Required station/unit data

At least one active `cr_stations` row (and units as needed). **Not** seeded by migration 015.

---

## Deployment order

1. Record `<PREV_SHA>`; checkout release branch/SHA; `npm ci --omit=dev`
2. Confirm env (postgres, SSO, secrets) — no CR-specific secrets required
3. `npm run db:migrate` → verify `015_control_room.sql` in `schema_migrations`
4. Update Nginx snippet if needed; reload
5. Restart PM2 apps; health check
6. Remote sensitive-path probe
7. Verify Control Room role grants (employee / management / Hub Admin)
8. Bootstrap real stations/units (SQL)
9. Postgres Control Room smoke (§16b checklist)
10. Login/logout + SSO Standard/Admin smoke
11. Final WOS + CR regression smoke on host
12. Sign session exit criteria

---

## Rollback order

1. Optional: DROP only `cr_*` tables (dependency-safe order in migration test / bootstrap docs) and `DELETE FROM schema_migrations WHERE id='015_control_room.sql'` if schema must be removed
2. `git checkout -f <PREV_SHA>` && `npm ci --omit=dev`
3. Restore nginx snippet backup if changed
4. `pm2 restart` + health
5. **Do not** drop `hub_*`, `users`, `roles`, or other WOS tables
6. Station/unit SQL rows are CR-only — safe to leave or drop with `cr_*`

---

## Resource authorization note

Until station isolation is product-defined: CR records are **shared by capability**. No `created_by` isolation. No claim of station isolation. Future hook: `CONTROL_ROOM_STATION_SCOPE=on` + `canAccessCrResource`.
