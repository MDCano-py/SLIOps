# WOS-76 — DB Bring-Up + Staging-Safe Validation Report

**Card:** WOS-76 — DB Bring-Up + Staging-Safe Validation  
**Date:** 2026-07-07  
**Scope:** Staging-safe `db:validate`, local demo validation split, fresh empty DB dry-run, migration path confirmation, staging env template, production safety guards  
**Constraints honored:** No RDS connection, no demo seed on staging path, no Start Guide/onboarding schema, no migration edits, no secrets committed.

---

## Executive summary

The database validation path is now **staging-safe**. `npm run db:validate` performs read-only schema checks and rolled-back smoke CRUD only — it no longer seeds or updates demo rows. Demo compatibility moved to **`npm run db:validate:demo`** (local-only, refuses staging/production).

A new **`npm run db:fresh-migration-check`** script verifies migrations `001`–`011` against an empty database using the Node `pg` package (no `psql` required). On Windows where the dev role lacks `CREATEDB`, it automatically falls back to an isolated schema (`wos76_migration_check`) in the current local database.

Production safety guards were tightened: `_noauth=1` works only on localhost/development, demo seed/clear API routes are disabled outside `NODE_ENV=development`, and staging startup fails loudly when `HUB_STORE_MODE=postgres` without `DATABASE_URL`.

### Final recommendation

**Ready for RDS staging migration**

Run `npm run db:migrate` and `npm run db:validate` on the empty RDS instance after filling `.env.staging` from `.env.staging.example`. No code blockers remain.

---

## Migration path verification (Part C)

| Check | Result |
|-------|--------|
| Canonical directory | **`migrations/`** at repo root |
| Runner script | `scripts/db/migrate.js` → `path.join(__dirname, '..', '..', 'migrations')` |
| Migrations present | `001_init.sql` through `011_hub_rbac_roles.sql` (11 files) |
| Stale `db/migrations/` | **Removed in WOS-75** — was never used by scripts |
| Duplicate paths in scripts | **None found** — all `db:*` scripts use `scripts/db/env.js` + root `migrations/` |
| Migration edits | **None** — existing migrations unchanged |

---

## Part A — `db:validate` staging-safe

### Before (WOS-19)

- Default `db:validate` ran `checkDemoSeedCompatibility()` which called `seedDemoData()` twice against the configured database, creating/updating persistent demo rows.

### After (WOS-76)

| Command | Behavior |
|---------|----------|
| `npm run db:validate` | Connect → verify migrations/tables/indexes/FKs → rolled-back smoke CRUD → **no demo seed** |
| `npm run db:validate:demo` | Local-only demo seed + archive seed compatibility; clears demo data after checks |

### Implementation

- Shared validation logic: `scripts/db/validate-core.js`
- Staging entry: `scripts/db/validate.js`
- Local demo entry: `scripts/db/validate-demo.js` (guarded by `assertLocalDemoValidationAllowed()`)

---

## Part B — Fresh empty DB dry-run

### Command

```bash
npm run db:fresh-migration-check
```

### Behavior

1. Attempts to create temp database `streamline_migration_check` (configurable via `TEMP_DATABASE_NAME`)
2. Runs `migrateDatabase()` against temp DB
3. Runs staging-safe `runStagingValidation()`
4. Drops temp database (unless `KEEP_DB=1`)

### Windows / no CREATEDB fallback

When temp database creation fails (e.g. `streamline` role without `CREATEDB`):

- Falls back to isolated schema `wos76_migration_check` in the current local database
- Migrates and validates in that schema
- Drops schema on success

### Env vars

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | (required) | Source connection settings |
| `DATABASE_URL_ADMIN` | — | Optional superuser for temp DB creation |
| `PGDATABASE_ADMIN` | `postgres` | Admin database name |
| `TEMP_DATABASE_NAME` | `streamline_migration_check` | Temp database name |
| `TEMP_DATABASE_SCHEMA` | `wos76_migration_check` | Schema fallback name |
| `KEEP_DB` | — | Set to `1` to preserve temp DB/schema |

### Result (this machine)

```
RESULT: PASS — fresh empty migration check succeeded.
Mode: Local schema fallback (user lacks CREATEDB)
Migrations 001–011 applied and validated
Temp schema dropped after success
```

---

## Part D — Staging env template

Updated **`.env.staging.example`** with placeholders only:

- `DATABASE_URL`, `PGSSLMODE=require`
- `HUB_STORE_MODE=postgres`, `VENDOR_STORE_MODE=postgres`, `HUB_USE_LOCAL_STORE=0`
- `SSO_ENFORCEMENT=on`, `DEMO_BYPASS=0`
- `INTEGRATION_DISPATCH_MODE=queued`, `EMAIL_DELIVERY_MODE=queued`
- Hub worker mode variables
- Redis/Upstash, Resend, Entra SSO, `PORTAL_BASE_URL`, `APP_BASE_PATH`
- Comments: empty DB, migrate before app start, do not run demo seed on staging

---

## Part E — Production safety guards

| Item | Before | After | Status |
|------|--------|-------|--------|
| `_noauth=1` | Worked on any host | **Localhost or `PORTAL_ENV=development` only** (`index.html`, `rbac-client.js`) | Safe |
| Demo seed API routes | Allowed when `NODE_ENV !== 'production'` or admin | **`NODE_ENV=development` only** (`hub-demo-seed.js`) | Safe |
| Demo clear API routes | Same as seed | **Development only** | Safe |
| `db:seed` / `db:seed-archives` | No env guard | **`assertLocalSeedAllowed()`** — refuses staging/production | Safe |
| `db:validate:demo` | N/A | **Refuses staging/production + non-local URL** | Safe |
| Local JSON on staging | Warned in health | `HUB_USE_LOCAL_STORE=0` in staging example; `shouldUseLocalStore()` false when deployed | Needs config |
| Postgres without `DATABASE_URL` | Threw on store access | **Server exits on staging/production startup** if postgres mode unset | Safe |
| Archive auto-seed on server start | Ran when `NODE_ENV !== 'production'` | **`NODE_ENV === 'development'` only** | Safe |
| Email/integration dispatch | Env-driven | Documented in `.env.staging.example` as `queued` | Needs config |
| Redis dependency | Optional with Postgres SoR | Upstash optional for legacy KV | Needs config |

---

## Files changed

| File | Change |
|------|--------|
| `scripts/db/validate-core.js` | **New** — shared staging-safe validation |
| `scripts/db/validate.js` | Staging-safe only; no demo seed |
| `scripts/db/validate-demo.js` | **New** — local-only demo validation |
| `scripts/db/fresh-migration-check.js` | **New** — empty DB dry-run (temp DB + schema fallback) |
| `scripts/db/migrate.js` | Export `migrateDatabase()`; optional schema `search_path` |
| `scripts/db/env.js` | Admin URL helpers, local seed/demo guards |
| `scripts/db/seed.js` | `assertLocalSeedAllowed()` |
| `scripts/db/seed-archives.js` | `assertLocalSeedAllowed()` |
| `package.json` | `db:validate:demo`, `db:fresh-migration-check` |
| `.env.staging.example` | Staging comments + full placeholder set |
| `.env.local.postgres.example` | Optional `DATABASE_URL_ADMIN` note |
| `migrations/README.md` | Full 001–011 table + validation commands |
| `LOCAL_POSTGRES_SETUP.md` | WOS-76 validation commands |
| `for-dev/hub-demo-seed.js` | `isDevDemoAllowed()` — development only |
| `api/lib/hub/routes.js` | Updated demo route error messages |
| `index.html` | `_noauth=1` localhost/dev only |
| `rbac-client.js` | `_noauth=1` localhost/dev only |
| `scripts/server-core.js` | Staging postgres config assert; archive seed dev-only |

---

## Tests run

| Command | Result |
|---------|--------|
| `npm run db:migrate` | **PASS** |
| `npm run db:validate` | **PASS** (no demo data written) |
| `npm run db:fresh-migration-check` | **PASS** (schema fallback on Windows) |
| `npm run settings:ui-test` | **PASS** |
| `npm run templates:mvp-ia-test` | **PASS** |
| `npm run templates:new-request-registry-test` | **PASS** |
| `npm run templates:legacy-runtime-parity-test` | **PASS** |
| `npm run templates:forms-admin-rbac-readiness-test` | **PASS** |
| `npm run templates:archive-route-hydration-test` | **PASS** (51 checks) |
| `npm run templates:dark-mode-surface-consistency-test` | **PASS** (30 checks) |
| `npm run vendor-dashboard:test` | **PASS** |
| `npm run vendor-master:test` | **PASS** |
| `npm run vendor-workflow:test` | **PASS** |
| `npm run vendor-documents:test` | **PASS** |
| `npm run vendor-document-notifications:test` | **PASS** |
| `npm run vendor-rbac-ui:test` | **PASS** |
| `npm run vendor-dashboard-queues:test` | **PASS** |

**17/17 PASS**

---

## Blockers

| Blocker | Type | Notes |
|---------|------|-------|
| RDS `DATABASE_URL` not provisioned | Operational | Fill `.env.staging` on EC2 |
| Staging secrets (SSO, Resend, Upstash) | Operational | Per `.env.staging.example` |
| Temp DB mode on RDS | N/A | `db:fresh-migration-check` uses temp DB when CREATEDB available; use empty RDS + `db:migrate` + `db:validate` on staging |

**No code blockers.**

---

## Recommendation summary

| Criterion | Status |
|-----------|--------|
| `db:validate` staging-safe | Done |
| Demo validation separate | `npm run db:validate:demo` |
| Fresh empty DB check without psql | `npm run db:fresh-migration-check` PASS |
| Canonical migration path confirmed | `migrations/` 001–011 |
| `.env.staging.example` updated | Done |
| No Start Guide / onboarding migration | Confirmed |
| Tests pass | 17/17 |

### RDS staging steps

1. Provision empty RDS PostgreSQL database
2. Copy `.env.staging.example` → `.env.staging`; fill `DATABASE_URL` and secrets
3. `npm run db:migrate`
4. `npm run db:validate` (safe on empty or populated staging DB)
5. Start app + worker via PM2; verify `/health`

**Final recommendation: Ready for RDS staging migration**
