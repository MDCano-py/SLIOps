# WOS-87 — Production-Readiness Hardening + Management Form Blocker

**Card:** WOS-87 — Demo Visibility, Portal Account Menu, Vercel Copy Cleanup, MaintainX Docs (Management Form Blocked)

**Status:** Partial complete — form objective **blocked** pending correct paper-form assets.

## 1. Management form — BLOCKED (do not invent fields)

### What was attached

The two images provided with the card request are **not a paper management form**. They show:

1. **Operations Dashboard** — work-order/request table with orange **DEMO** badges (e.g. WO-900040 “Replace hydraulic hose…”), matching seeded demo rows from `for-dev/hub-demo-seed.js`.
2. **Home / Guiding Principles** — portal home content with a sparse top-right identity control.

### Field inventory

| Section | Fields transcribed |
|---------|-------------------|
| *(none)* | **No paper-form fields can be inventoried.** Inventing legal/HR/ops form text would change meaning. |

### Decision

Per card instructions (“Stop and report any ambiguity that could change the form’s legal meaning instead of guessing”), **no native Forms template, migration, RBAC grant, or submission table for a new management form was added in WOS-87.**

### Resume when

Provide clear photos/PDF of the actual management paper form (both pages/sides). Then a follow-on card can:

- Inventory every field/section/checkbox/signature
- Add a published template with `visible_to_roles` for management roles only
- Enforce create/view/edit on backend via form-specific permissions
- Add PostgreSQL records + audit events
- Cover management vs technician/client/vendor RBAC in tests

### Intended roles (for the follow-on; not applied yet)

| Display name | Canonical role key |
|--------------|-------------------|
| Operations Manager | `operations` |
| HR Manager | `hr` |
| Accounting | `ap` |
| Field Supervisor | `field_supervisor` |
| Hub Admin | `hub_admin` |

**Deny (must not auto-receive):** `field_technician`, `client`, `vendor`

---

## 2. Summary of changes shipped in WOS-87

| Area | Change |
|------|--------|
| Demo visibility | `api/lib/hub/demo-visibility.js` — production never; staging only with `STAGING_DEMO_DATA_ENABLED`; callers cannot force-include demo when gated off |
| List/detail APIs | Postgres + Redis store filter `demo:true` rows when not visible |
| Portal user menu | Top-right accessible dropdown (`userMenuTrigger` / `userAccountMenu`) with display name, role, Escape/click-outside, Sign out → shared `portalSignOut` |
| Vercel copy | `ENTRA_SSO_SETUP.md`, `RDS_POSTGRES_SETUP.md`, `api/maintainx.js` / `api/lib/entra.js` headers updated to EC2/Nginx-neutral language; `@vercel/blob` package kept (used for blob I/O) |
| Staging seed docs | Explained why test users do not appear until explicit migrate + seed; demo rows separate from personas |
| MaintainX | Documented `MAINTAINX_API_KEY` / optional `MAINTAINX_ORG_ID`, where to set, restart + `/health` verification |

Sign-out session invalidation and hub account menu were already delivered in **WOS-86**; WOS-87 extends the **outer portal** top-right control to the same shared logout.

---

## 3. Demo / test data sources

| Source | Gating |
|--------|--------|
| Hub Admin seed/clear (`/hub/dev/seed-demo-data`, `clear-demo-data`) | Never production; staging requires `STAGING_DEMO_DATA_ENABLED=1` + hub_admin/admin |
| Existing `demo:true` request rows in Postgres | Hidden from list/get when visibility gate is off (rows not deleted) |
| Staging test users (`npm run db:seed-staging-test-users`) | Manual; requires migrate + `DATABASE_URL`; refused in production |
| Local JSON / `HUB_USE_LOCAL_STORE` | Dev convenience only — not for staging/production |
| Dev-login / `_noauth` | Not for staging leadership demos |

**No silent fake-data fallback** when the database is unavailable — store/API errors remain errors.

### Why staging test users were “not seeding”

1. Seed is **not** part of deploy/`pm2 restart`.
2. Requires `npm run db:migrate` (migration `012_staging_test_users.sql`) **and** `npm run db:seed-staging-test-users`.
3. Needs `DATABASE_URL` and non-production `NODE_ENV` (`staging` or local).
4. Login UI still needs `STAGING_TEST_LOGIN_ENABLED=1` + `STAGING_TEST_LOGIN_SECRET` (≥32).

### Exact staging seed commands

```bash
cd /var/www/ops-hub-staging
# Ensure .env.staging has DATABASE_URL and NODE_ENV=staging
npm run db:migrate
npm run db:seed-staging-test-users
pm2 restart ops-hub-staging ops-hub-staging-worker
```

Optional demo **request** rows (separate):

```bash
# .env.staging: STAGING_DEMO_DATA_ENABLED=1
# Then as Hub Admin in UI: Seed staging test data
# Or leave flag 0 so any leftover demo rows stay hidden in APIs
```

---

## 4. Roles and permissions (this card)

No new form permissions were granted (form blocked). Existing management/demo/admin RBAC unchanged.

---

## 5. Files changed

- `api/lib/hub/demo-visibility.js` (new)
- `api/lib/hub/db/postgres.js`
- `api/lib/hub/store.js`
- `api/lib/entra.js`
- `api/maintainx.js`
- `index.html` (portal account menu markup/CSS/JS)
- `ENTRA_SSO_SETUP.md`
- `RDS_POSTGRES_SETUP.md`
- `DEPLOYMENT_STAGING.md`
- `.env.staging.example`
- `scripts/security/staging-readiness-test.js`
- `docs/reports/WOS_87_PRODUCTION_READINESS_MANAGEMENT_FORM_BLOCKER_REPORT.md` (this file)

Untracked leftover (not part of this commit unless needed): `api/lib/hub/db/pool-config.js`.

---

## 6. Migration details

**None** for WOS-87 (no new form table). Staging personas continue to use migration `012_staging_test_users.sql` from WOS-85.

---

## 7. Tests executed

| Suite | Result |
|-------|--------|
| `npm run security:staging-readiness-test` | **49/49 PASS** |
| `npm run security:staging-hardening-test` | **34/34 PASS** |
| `npm run security:no-origin-auth-gate-test` | **10/10 PASS** |
| `npm run security:staging-test-login-test` | **45/45 PASS** |
| `npm run security:postgres-only-staging-health-test` | **26/26 PASS** |
| `npm run security:rbac-authz-test` | **23/23 PASS** |
| `npm run security:secret-scan` | **PASS** |

Form RBAC / persistence / audit tests for the management paper form: **N/A until form assets provided.**

---

## 8. Environment variables (placeholders only)

```bash
# Staging demo visibility + seed tools
STAGING_DEMO_DATA_ENABLED=0   # 1 only when intentionally showing/seeding demo requests

# Staging test personas (login)
STAGING_TEST_LOGIN_ENABLED=0
STAGING_TEST_LOGIN_SECRET=    # ≥32 chars when enabled

# MaintainX (server-only)
MAINTAINX_API_KEY=
# MAINTAINX_ORG_ID=

# CORS / portal
ALLOWED_ORIGIN=https://automation.streamlinescada.com
PORTAL_BASE_URL=https://automation.streamlinescada.com/ops-hub-staging/
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME
```

---

## 9. MaintainX configuration

| Env | Location |
|-----|----------|
| Local | `.env.local` / `.env.example` placeholders |
| Staging EC2 | `/var/www/ops-hub-staging/.env.staging` (or PM2 env) |
| Production EC2 | production env / PM2 env |

```bash
# After setting MAINTAINX_API_KEY on the server:
pm2 restart ops-hub-staging ops-hub-staging-worker
curl -s http://127.0.0.1:3010/health | jq '{ok, maintainx_configured}'
```

Integrations status returns `configured` / `not_configured` without exposing the secret. Missing key does not crash unrelated hub routes.

---

## 10. Remaining production blockers

1. **Management paper form** — blocked until correct screenshots/PDF are provided.
2. **Entra SSO** — still required for production; staging test login is temporary.
3. **MaintainX** — inactive until real `MAINTAINX_API_KEY` is set on the server (not in git).
4. **`ALLOWED_ORIGIN`** — must match browser origin on staging/production (no path).
5. Leftover demo rows in Postgres remain until Hub Admin clear (with flag on) or manual DB cleanup; with flag off they are API-hidden only.
