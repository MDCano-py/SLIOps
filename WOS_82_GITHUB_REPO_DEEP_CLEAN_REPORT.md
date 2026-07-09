# WOS-82 — GitHub Repo Deep Clean + Deployment Artifact Audit

**Date:** 2026-07-09  
**Card:** WOS-82  
**Scope:** Pre-GitHub inventory, cleanup, `.gitignore` hardening, secret scan, dependency audit, deployment artifact review, test validation.

---

## Executive summary

The repository was cleaned for GitHub publication and EC2 + Nginx + RDS deployment. **~1,870+ files** of vendored reference code (`OpnForm-main/`), IDE config (`.idea/`), an empty `db/` folder, and dead standalone `bol-generator.html` were removed. Seven root-level WOS reports were consolidated under `docs/reports/`. `.gitignore` was expanded, `.env.example` and `DEPLOYMENT_NOTES.md` were added, and the secret-scan ignore list was updated after reference-tree removal.

**Canonical migrations 001–011 remain intact.** All required npm test scripts from the WOS-82 acceptance list **passed**. No real secrets were found in first-party source; `.env.local` and `.env.local.postgres` exist on disk but are correctly gitignored.

**No git repository is initialized yet** — `git status` fails. A human must `git init`, review the commit checklist below, and confirm local env files are never staged before the first push.

### Final recommendation

**Ready after listed files are reviewed**

Blockers are operational, not functional:

1. Initialize git and verify `.env.local` / `.env.local.postgres` are never committed.
2. Review npm audit transitive advisories (`undici` via `@vercel/blob`, `uuid` via `@azure/msal-node`) — report-only today; no auto-upgrade applied.
3. Confirm team is comfortable deleting `OpnForm-main/` (already removed locally; irreversible without backup).

---

## Part A — File inventory by category

### 1. Required source code (KEEP — commit)

| Path | Notes |
|---|---|
| `index.html` | Main SPA shell (~26k lines); BOL UI inlined |
| `hub.js`, `hub.css` | Hub router, layout, styling |
| `hub-*.js`, `template-*.js`, `app-spaces-ui.js`, `rbac-client.js`, `vendor-dashboard-queues.js` | Feature modules |
| `action.html` | **Still used** — action-link landing page (`api/lib/hub/routes.js`) |

### 2. Required API/backend code (KEEP — commit)

| Path | Notes |
|---|---|
| `api/maintainx.js` | Main HTTP handler / legacy archive |
| `api/lib/hub/` | Requests, workflow, documents, worker, Postgres store |
| `api/lib/templates/` | Form builder, runtime, bindings |
| `api/lib/rbac/` | Role catalog, Postgres RBAC |
| `api/lib/vendor/` | Vendor master, workflow, documents |
| `api/lib/spaces/` | App spaces / launch registry |
| `api/lib/entra.js`, `saml.js`, `saml-org.js`, `sso-routes.js` | SSO (Entra + SAML) |
| `api/lib/auth.js`, `security-audit.js` | Session auth, audit redaction |

### 3. Required frontend/static files (KEEP — commit)

| Path | Notes |
|---|---|
| `streamline-logo.png`, `streamline-logo-light.png`, `streamline-double-leg.png`, `maintainx-logo.png` | Brand assets |
| Inline CSS/JS in `index.html` | No separate build step |

### 4. Required database migrations (KEEP — commit)

| Path | Notes |
|---|---|
| `migrations/001_init.sql` … `011_hub_rbac_roles.sql` | **11 canonical files** — do not delete |
| `migrations/README.md` | Migration docs |

No stale top-level `db/migrations/` folder exists.

### 5. Required scripts/tests (KEEP — commit)

| Path | Notes |
|---|---|
| `scripts/production-server.js`, `scripts/dev-server.js`, `scripts/server-core.js` | Production/dev servers |
| `scripts/hub-worker.js` | Outbox/email worker |
| `scripts/db/` | migrate, validate, seed (local only) |
| `scripts/security/` | secret-scan, staging-hardening, RBAC tests |
| `scripts/templates/`, `scripts/settings/`, `scripts/ui/` | UI/regression tests |
| `scripts/vendor-*.js` | Vendor module tests |

### 6. Required docs/reports (KEEP — commit)

| Path | Notes |
|---|---|
| `docs/reports/WOS_69` … `WOS_81` | Card completion reports |
| `docs/reports/ARCHIVE_ROUTE_HYDRATION_FIX_REPORT.md` | Fix report |
| `PENTEST_READINESS_PACKAGE.md` | Pentest checklist |
| `DEPLOYMENT_STAGING.md`, `DEPLOYMENT_NOTES.md` | Deploy runbooks |
| `ENTRA_SSO_SETUP.md`, `SAML_MULTI_TENANT_SETUP.md` | SSO setup |
| `README.md`, `LOCAL_POSTGRES_SETUP.md`, `RDS_POSTGRES_SETUP.md`, etc. | Operational docs |

### 7. Deployment/config examples (KEEP — commit)

| Path | Notes |
|---|---|
| `.env.example` | **Created** — generic env index |
| `.env.staging.example` | Staging template |
| `.env.local.postgres.example` | Local Postgres dev |
| `deploy/ecosystem.config.cjs` | PM2 config |
| `deploy/ops-hub-staging.service` | systemd unit |
| `deploy/nginx/ops-hub-staging.conf` | Nginx sample |
| `vercel.json` | Optional — Vercel crons/rewrites only; **not required on EC2** but harmless reference |

### 8. Local-only artifacts (IGNORE — do not commit)

| Path | Action |
|---|---|
| `.env.local` | **IGNORE** — real local secrets |
| `.env.local.postgres` | **IGNORE** — real local DB URL |
| `for-dev/local-hub-data/redis.json` | **IGNORE** — local JSON KV store |
| `node_modules/` | **IGNORE** |

### 9. Old prototypes/reference folders (REMOVED)

| Path | Decision |
|---|---|
| `OpnForm-main/` (~1,866 files) | **DELETED** — zero runtime imports; only comments/WOS-75 references |
| `updated version/` | Already absent |
| `bol-generator.html` | **DELETED** — content inlined in `index.html` (comments remain) |

### 10. Generated/build/cache files (IGNORE)

| Pattern | Action |
|---|---|
| `dist/`, `build/`, `.next/`, `out/`, `.vercel/` | Added to `.gitignore` |
| `coverage/`, `.nyc_output/`, `test-results/` | Added to `.gitignore` |
| `*.log`, `tmp/`, `temp/` | Added to `.gitignore` |

### 11. IDE/editor files (REMOVED / IGNORE)

| Path | Decision |
|---|---|
| `.idea/` (6 files) | **DELETED**; also in `.gitignore` |
| `.vscode/` | **IGNORE** via `.gitignore` |

### 12. Unused dependencies/assets (AUDIT — no removals)

All production dependencies are referenced. See Part F.

### 13. Possible secrets or sensitive files (PROTECTED)

| Path | Status |
|---|---|
| `.env.local`, `.env.local.postgres` | Present on disk; **gitignored**; secret-scan PASS |
| Hardcoded AWS/GitHub/Resend keys in app code | **None found** |
| Demo login / `_noauth` | Gated to local/dev only (staging-hardening-test PASS) |

---

## Part B — Protected files verification

| Required item | Status |
|---|---|
| `package.json` | Present |
| `package-lock.json` | Present |
| `index.html`, `hub.js`, `hub.css` | Present |
| `api/` | Present (75 JS files) |
| `scripts/` | Present (66 JS files) |
| `migrations/001`–`011` | All 11 present |
| `docs/reports/` | Present (16 reports) |
| Security/pentest docs | Present |
| Staging env examples | Present + new `.env.example` |
| Production server scripts | Present |

---

## Part C — Files/folders deleted

| Item | Reference check | npm/test dependency |
|---|---|---|
| `OpnForm-main/` | No `require()`/import in app; only WOS-75 report + comments | None |
| `.idea/` | IDE only | None |
| `bol-generator.html` | Inlined in `index.html`; no route | None |
| `db/` (empty root folder) | No references | None |

## Part C — Files/folders moved

| From (root) | To |
|---|---|
| `WOS_75_LAUNCH_PREP_CLEANUP_MIGRATION_AUDIT_REPORT.md` | `docs/reports/` |
| `WOS_76_DB_BRINGUP_STAGING_SAFE_VALIDATION_REPORT.md` | `docs/reports/` |
| `WOS_77_SHELL_ROUTE_CONSISTENCY_WORKFLOW_DARK_MODE_REPORT.md` | `docs/reports/` |
| `WOS_79_PENTEST_READINESS_STAGING_HARDENING_REPORT.md` | `docs/reports/` |
| `WOS_80_SECURITY_REMEDIATION_LEGACY_RBAC_AUTHZ_REPORT.md` | `docs/reports/` |
| `WOS_80_UNIFIED_ARCHIVE_RECORDS_ROLE_LIFECYCLE_REPORT.md` | `docs/reports/` |
| `WOS_81_ADMIN_HELP_CENTER_START_GUIDE_REPORT.md` | `docs/reports/` |

## Part C — Intentionally kept

- Full `api/`, `scripts/`, `migrations/`, `for-dev/` (local dev shim)
- `action.html`, `vercel.json` (reference)
- Root operational markdown (README, SSO, worker runbooks)
- Logo PNG assets
- `for-dev/local-hub-data/.gitignore` (keeps directory, ignores `*`)

---

## Part D — `.gitignore` changes

**Before:** Minimal — `node_modules/`, `.env`/`.env.*` with example exceptions, `redis.json`, `*.log`, `.DS_Store`.

**After:** Expanded coverage for:

- Logs, coverage, build/dist, `.vercel/`
- Local DB dumps (`*.sqlite`, `*.db`, `*.dump`)
- OS metadata (`Thumbs.db`, `Desktop.ini`)
- IDE folders (`.idea/`, `.vscode/`)
- Temp/scratch (`tmp/`, `*.bak`, `.cache/`)
- Local JSON stores under `for-dev/local-hub-data/`
- Optional screenshot scratch dirs

**Still allowed (not ignored):**

- `.env.example`, `.env.staging.example`, `.env.local.postgres.example`
- All `*.md`, migrations, source, tests

---

## Part E — Secret scan result

### Automated scan

```
npm run security:secret-scan → PASS
High-confidence secrets: 0
Warnings: 0
.env.local — gitignored OK
.env.local.postgres — gitignored OK
```

### Manual search

- No AWS access keys, GitHub tokens, Resend keys, or private key blocks in first-party source.
- Placeholder patterns only in `.env*.example` and documentation.
- `for-dev/local-hub-data/redis.json` contains local dev data — **gitignored**.

### If secrets were ever committed locally

Rotate: `SESSION_SECRET`, `DATABASE_URL` credentials, `ENTRA_CLIENT_SECRET`, `UPSTASH_*`, `BLOB_READ_WRITE_TOKEN`, `RESEND_API_KEY`, SAML certs, and any keys in `.env.local*`.

---

## Part F — Dependency cleanup result

**No packages removed.** Lockfile unchanged. Rationale:

| Package | Used by | Decision |
|---|---|---|
| `@vercel/blob` | `api/maintainx.js` (`put`, `list`, `del`) — legacy archive blob I/O via `BLOB_READ_WRITE_TOKEN` | **KEEP** — blob API works from EC2; not Vercel hosting |
| `@azure/msal-node` | `api/lib/entra.js` — Microsoft Entra OIDC | **KEEP** — identity, not hosting |
| `@node-saml/node-saml` | `api/lib/saml.js`, `saml-org.js` | **KEEP** — multi-tenant SAML SSO |
| `@upstash/redis` | `for-dev/redis-client.js` | **KEEP** — optional legacy KV |
| `jszip` | `api/maintainx.js` — document export | **KEEP** |
| `pg` | All Postgres stores | **KEEP** |

### npm audit (`npm run security:audit`)

Report-only (always exits 0). **4 advisories** in transitive deps:

| Advisory | Via | Severity | Notes |
|---|---|---|---|
| `undici` ≤6.26.0 | `@vercel/blob` | High | Fix requires `@vercel/blob@2.x` (breaking) |
| `uuid` <11.1.1 | `@azure/msal-node` | Moderate | Fix requires `@azure/msal-node@5.x` (breaking) |

Track upgrades in a follow-up; do not `npm audit fix --force` without regression testing.

---

## Part G — Deployment artifact recommendation

See **`DEPLOYMENT_NOTES.md`** (created) and **`DEPLOYMENT_STAGING.md`**.

### Ship to EC2

```
package.json, package-lock.json
index.html, hub.js, hub.css, *-ui.js modules
api/, scripts/, migrations/, deploy/, for-dev/
docs/, *.md, .env.example, .env.staging.example
```

### Create on server (never commit)

```
.env.staging or .env.production
node_modules/ (npm ci --omit=dev)
```

### Cron on EC2

Replace `vercel.json` cron with system cron or PM2 cron calling `/api/maintainx?path=/photo-cleanup`.

---

## Part H — Git status summary

**Repository is not a git repo** (`fatal: not a git repository`).

### Suggested first-commit checklist

**Commit:**

- All source, `api/`, `scripts/`, `migrations/`, `deploy/`, `docs/`
- `.gitignore`, `.env.example`, `.env.staging.example`, `.env.local.postgres.example`
- `DEPLOYMENT_NOTES.md`, operational markdown, logos

**Never commit:**

- `.env.local`, `.env.local.postgres`
- `node_modules/`
- `for-dev/local-hub-data/redis.json`

**Review before push:**

- Confirm no secrets in `for-dev/local-hub-data/redis.json` history if repo was ever partially tracked
- `vercel.json` — keep or document as non-EC2 reference
- npm audit advisories — accept or plan upgrade

**Do not run:** `git add .` without verifying ignore rules first.

---

## Part I — Tests run

| Command | Result |
|---|---|
| `npm run db:validate` | **PASS** — migrations 001–011 applied |
| `npm run security:secret-scan` | **PASS** |
| `npm run security:audit` | **PASS** (report-only; 4 advisories logged) |
| `npm run security:staging-hardening-test` | **PASS** (30 checks) |
| `npm run security:rbac-authz-test` | **PASS** (23 checks) |
| `npm run settings:ui-test` | **PASS** (14 checks) |
| `npm run templates:mvp-ia-test` | **PASS** (29 checks) |
| `npm run templates:new-request-registry-test` | **PASS** (59 checks) |
| `npm run templates:legacy-runtime-parity-test` | **PASS** (46 checks) |
| `npm run templates:forms-admin-rbac-readiness-test` | **PASS** (32 checks) |
| `npm run templates:archive-route-hydration-test` | **PASS** (51 checks) |
| `npm run templates:archive-dynamic-forms-test` | **PASS** (36 checks) |
| `npm run templates:role-lifecycle-guardrails-test` | **PASS** (33 checks) |
| `npm run templates:shell-route-consistency-test` | **PASS** (24 checks) |
| `npm run templates:workflow-tab-dark-mode-test` | **PASS** (20 checks) |
| `npm run templates:dark-mode-surface-consistency-test` | **PASS** (30 checks) |
| `npm run vendor-dashboard:test` | **PASS** (13 checks) |
| `npm run vendor-master:test` | **PASS** (20 checks) |
| `npm run vendor-workflow:test` | **PASS** (36 checks) |
| `npm run vendor-documents:test` | **PASS** (24 checks) |
| `npm run vendor-document-notifications:test` | **PASS** (21 checks) |
| `npm run vendor-rbac-ui:test` | **PASS** (31 checks) |
| `npm run vendor-dashboard-queues:test` | **PASS** (30 checks) |

All WOS-82 required tests exist and passed. **RDS migration was not run** (local Postgres validation only).

---

## Remaining cleanup risks

| Risk | Mitigation |
|---|---|
| `.env.local*` on disk | Verify never staged; rotate if ever committed |
| `for-dev/local-hub-data/redis.json` | Gitignored; may contain dev emails — do not commit |
| Transitive npm advisories | Track `@vercel/blob` / `@azure/msal-node` major upgrades |
| `vercel.json` confusion | Document EC2 uses Nginx + cron, not Vercel rewrites |
| No git history yet | First push establishes baseline — review checklist above |
| WOS-75 report still mentions `OpnForm-main/` | Historical; folder deleted per WOS-82 |
| `index.html` comments reference `bol-generator.html` | Harmless; optional comment cleanup later |

---

## Files created/updated in WOS-82

| File | Action |
|---|---|
| `.gitignore` | Expanded |
| `.env.example` | Created |
| `DEPLOYMENT_NOTES.md` | Created |
| `scripts/security/secret-scan.js` | Removed `OpnForm-main` ignore; added `.idea`/`.vscode` |
| `WOS_82_GITHUB_REPO_DEEP_CLEAN_REPORT.md` | This report |

---

## Recommendation

**Ready after listed files are reviewed**

The codebase is functionally clean: junk removed, migrations intact, tests green, secrets not in source, `.gitignore` hardened. Before GitHub push:

1. `git init` and selective first commit (not blind `git add .`).
2. Confirm `.env.local` / `.env.local.postgres` stay untracked.
3. Accept or schedule npm advisory upgrades.
4. Optionally archive `OpnForm-main/` externally if team wants reference copy.

**Not auto-committed or pushed** per WOS-82 acceptance criteria.
