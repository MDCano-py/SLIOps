# WOS-75 — Launch Prep Cleanup + Migration Audit Report

**Card:** WOS-75 — Launch Prep Cleanup + Migration Audit  
**Date:** 2026-07-07  
**Scope:** Repo cleanup, shell/route audit, migration inventory, schema flexibility, production safety, hosting readiness, test suite  
**Constraints honored:** No RDS cutover, no RDS connection in this card, no new features, no UI redesign, no migration edits, deletions only where proven unused.

---

## Executive summary

WOS-73 and WOS-74 left the hub in good shape for launch prep: hub-first shell on hard refresh, archive route hydration fixed, and dark-mode surfaces aligned. This pass removed proven-dead artifacts, archived sprint reports under `docs/reports/`, documented remaining legacy shell surfaces, inventoried all 11 canonical migrations, and ran the full WOS-75 test suite (**26/26 PASS**).

The codebase is **schema-ready** for a fresh RDS PostgreSQL database (`npm run db:validate` applies migrations 001–011 cleanly). Remaining gaps are operational configuration (SSO, secrets, RDS URL), deploy artifact bloat (`OpnForm-main/`), and a dual-store RBAC model (Postgres `roles`/`user_roles` plus Redis portal permission KV) that is acceptable for staging but should be unified before production.

### Final recommendation

**Ready after listed cleanup**

Proceed to RDS **staging** migration once:
1. `OpnForm-main/` is removed or excluded from deploy artifacts (team confirmation).
2. Staging `.env` is filled per `.env.staging.example` and `DEPLOYMENT_STAGING.md`.
3. `SSO_ENFORCEMENT=on`, `HUB_USE_LOCAL_STORE=0`, and demo seed routes are not exposed to leadership testers without admin gate.

No code blockers prevent `npm run db:migrate` against an empty RDS instance.

---

## Part A — Repo cleanup audit

### Files removed (proven unused)

| Path | Reason |
|------|--------|
| `updated version/` (9 files) | Stale snapshot of old portal shell, partial API copies, outdated `vercel.json`. Zero references in code, `package.json`, or deploy scripts. |
| `db/migrations/` | Self-documented stale duplicate of root `migrations/`. Not used by `npm run db:migrate`. |
| `scripts/db/seed-demo.js` | Orphaned wrapper; `package.json` `db:seed-demo` runs `scripts/db/seed.js`. |
| `.idea/` | JetBrains IDE metadata; not referenced by application. |

### Files moved

| From (repo root) | To |
|------------------|-----|
| `WOS_69_NEW_REQUEST_FORM_REGISTRY_WIRING_REPORT.md` | `docs/reports/` |
| `WOS_70_LEGACY_REQUEST_RUNTIME_VISUAL_PARITY_REPORT.md` | `docs/reports/` |
| `WOS_71_MVP_SIDEBAR_CONSOLIDATION_UNIFIED_ARCHIVE_REPORT.md` | `docs/reports/` |
| `WOS_72_FORMS_ADMIN_RBAC_WORKFLOW_ONBOARDING_REPORT.md` | `docs/reports/` |
| `WOS_73_FLEXIBLE_LAUNCH_VISIBILITY_ROLE_CATALOG_REPORT.md` | `docs/reports/` |
| `WOS_73_PRE_RDS_UI_CONSISTENCY_LAUNCH_VISIBILITY_REPORT.md` | `docs/reports/` |
| `WOS_74_VISUAL_SYSTEM_CLEANUP_REPORT.md` | `docs/reports/` |
| `WOS_74_ROUTE_ACTIVATION_DARK_MODE_FIX_REPORT.md` | `docs/reports/` |
| `ARCHIVE_ROUTE_HYDRATION_FIX_REPORT.md` | `docs/reports/` |

### Files intentionally kept

| Path | Category | Rationale |
|------|----------|-----------|
| `index.html` | Canonical app shell | Primary portal; hub-first boot, routing, legacy embed targets. |
| `hub.js`, `hub.css`, `hub-*.js` | Modern hub shell | Loaded from `index.html`; tested extensively. |
| `action.html` | Production action links | Used by document workflow and email action URLs. |
| `for-dev/` | Local dev infrastructure | `redis-client.js`, `local-redis.js`, demo seeders — required for local JSON store and dev routes. |
| `for-dev/local-hub-data/redis.json` | Generated local store | Gitignored runtime scratch for `HUB_USE_LOCAL_STORE=1`. |
| `bol-generator.html` (root) | Legacy standalone prototype | Content inlined into `index.html`; not linked at runtime. Low risk if kept; safe to delete in a follow-up pass. |
| `scripts/**/*-test.js` | Regression suite | All wired in `package.json`. |
| `deploy/` | EC2/PM2/nginx staging | Referenced by `DEPLOYMENT_STAGING.md` and cutover scripts. |
| Operational `.md` at root | Runbooks | `DEPLOYMENT_STAGING.md`, `RDS_POSTGRES_SETUP.md`, `LOCAL_POSTGRES_SETUP.md`, etc. |

### Document risk (not deleted — needs team decision)

| Path | Risk | Recommendation |
|------|------|----------------|
| `OpnForm-main/` (~3,900+ files) | Largest deploy bloat; vendored OSS form builder never imported. App uses custom `template-*.js` builder. | **Delete** before production deploy, or move to external reference repo. |
| `bol-generator.html` | Dead standalone; BOL UI lives in `index.html`. | Delete when team confirms inlined version is sole source. |
| `README.md` | Empty stub; cross-links in other docs expect architecture overview. | Fill with deploy pointer or link to `DEPLOYMENT_STAGING.md`. |
| `scripts/migrations/001-organizations-saml.md` | Legacy Redis migration notes; no code references. | Move to `docs/` or keep as ops archaeology. |
| `package.json` duplicate alias | `templates:dark-mode-surface-consistency-test` duplicates `templates:dark-mode-ui-consistency-test`. | Cosmetic; remove alias in a small follow-up. |
| `SIGNATURE_SCOPE_AND_UI_LANGUAGE.md` | Links to missing `SIGNATURE_EMAIL_NOTIFICATION_REPORT.md`. | Fix broken doc link. |

---

## Part B — Old shell / route audit

### Modern hub shell (primary)

| Component | Status |
|-----------|--------|
| `html.hub-boot-hub` + `body.hub-mode` | **Active** — unconditional in `<head>`; hides legacy chrome before hydration. |
| `#panel-hub-shell` | **Primary visible shell** on load. |
| `.hub-topbar`, hub sidebar, hub pages | **Active** — dashboard, requests, forms, documents, archive, settings, vendor areas. |
| `hub.js` `navigateShell` / `showHubPage` | **Active** — orchestrates hub tab activation. |

### Legacy shell (present but suppressed)

| Component | Status | Classification |
|-----------|--------|----------------|
| `.topbar` (legacy nav) | Hidden via CSS + `aria-hidden` + `hidden` | **Needed legacy support** — DOM retained; not user-facing on hard refresh. |
| `#panel-home` | `display:none`, `hidden` by default | **Needed legacy support** — `switchTab('home')` mapping exists; hub dashboard is default route. |
| Per-category archive panels (`jsa-archive`, `bol-archive`, etc.) | Embedded inside `#hubArchiveContent` via `hub-unified-archive.js` | **Needed legacy support** — archive lists reuse legacy panel markup inside modern shell. |
| `hub-legacy-mount` / `hub-legacy-panel` | CSS + JS mount targets | **Needed legacy support** — BOL generator, parts request forms, management sections mount here. |
| `switchTab` + `streamlineRouter` in `index.html` | **Active** — central route hydration | **Risky to remove** — hub delegates to these for hash sync and legacy tab IDs. |
| Standalone `bol-generator.html` | Not routed | **Dead code** — safe to remove separately. |

### Route hydration (post WOS-74)

| Route pattern | Behavior |
|---------------|----------|
| `#/archive`, `#/archives` | Hub archive overview |
| `#/archives/jsa`, `/bol`, `/work-orders`, `/parts-requests`, `/roll-off-swap` | Category archive lists |
| `#/documents` | Hub documents (not parts archive) |
| Hard refresh | `hub-boot-hub` + `resetRouteCache()` + `applyRoute({ force: true })` |

### Hard refresh / hydration risks

| Item | Assessment |
|------|------------|
| Old “Guiding Principles” home shell flashing | **Mitigated** (WOS-73/74) — hub-first CSS and hidden `#panel-home`. |
| Archive first-click race | **Fixed** (WOS-74) — `selectArchiveFilter`, hash-before-mount, coalesced fetches. |
| Legacy `panel-home` interfering | **Low risk** — hidden unless explicit `home` route; default is hub dashboard. |

---

## Part C — Migration inventory

Canonical directory: **`migrations/`** — applied by `npm run db:migrate` in filename order; tracked in `schema_migrations`.

| # | Filename | Purpose | Tables/columns | Launch required | Category | Demo/local assumptions | Fresh empty Postgres |
|---|----------|---------|----------------|-----------------|----------|------------------------|----------------------|
| 001 | `001_init.sql` | Core hub schema | `users`, `requests`, `web_documents`, `workflow_steps`, `workflow_templates`, `status_history`, `audit_events`, `comments`, `notifications`, `action_links`, `signatures`, `integration_events`, `document_types`, `form_definitions`, `request_sequences` | **Yes** | Core hub + legacy `form_definitions` | None | **Safe** |
| 002 | `002_hub_extras.sql` | Archive columns, settings, locations, equipment, files | `requests` archive/maintainx columns; `hub_settings`, `locations`, `equipment`, `request_files` | **Yes** | Archive + reference data | None | **Safe** |
| 003 | `003_workflow_step_action_types.sql` | Remove restrictive `action_type` CHECK | `workflow_steps` constraint drop | **Yes** | Workflow | Fixes demo seed / MaintainX step types | **Safe** |
| 004 | `004_integration_events_outbox.sql` | Durable integration outbox fields | `integration_events` dispatch columns + indexes; backfill UPDATEs | **Yes** | Integration outbox | Backfill UPDATEs are no-ops on empty DB | **Safe** |
| 005 | `005_outbox_events_email_delivery.sql` | Email delivery outbox | `outbox_events` table + indexes | **Yes** | Email worker | None | **Safe** |
| 006 | `006_vendor_master.sql` | Vendor master system of record | `vendor_master` + indexes | **Yes** | Vendor | None | **Safe** |
| 007 | `007_form_template_versions.sql` | Admin template versioning | `form_templates`, `form_template_versions`, `form_submissions`, `workflow_step_instances` | **Yes** | Templates / runtime | None | **Safe** |
| 008 | `008_app_spaces_launch_registry.sql` | App spaces + launch registry | `app_spaces`, `template_launch_entries`; seeds 5 default spaces | **Yes** | Launch visibility | `INSERT` default spaces (`ON CONFLICT DO NOTHING`) | **Safe** |
| 009 | `009_template_kind_sectioned_schema_bindings.sql` | Template kind + workflow bindings | `template_bindings`; `template_kind` columns; backfill UPDATEs | **Yes** | Templates / bindings | Backfill uses `launch_config_json` patterns | **Safe** (no rows → no-op updates) |
| 010 | `010_form_submission_events.sql` | Submission audit trail | `form_submission_events` | **Yes** | Templates / runtime | None | **Safe** |
| 011 | `011_hub_rbac_roles.sql` | Workflow role catalog + assignments | `roles`, `user_roles`; seeds 6 system roles | **Yes** | RBAC | Seeds default roles (`ON CONFLICT DO NOTHING`) | **Safe** |

**Stale copy removed:** `db/migrations/001_init.sql` (was duplicate, not applied by scripts).

### Migration risks

| Risk | Severity | Notes |
|------|----------|-------|
| Dual form systems (`form_definitions` in 001 vs `form_templates` in 007) | Medium | Legacy document-type forms coexist with new template builder. Runtime uses new tables for MVP forms; old table remains for historical document registry paths. |
| 004/009 backfill UPDATEs | Low | Harmless on empty DB; idempotent on populated DB. |
| 008/011 seed INSERTs | Low | `ON CONFLICT DO NOTHING` — safe for re-run. |
| `migrations/README.md` table incomplete | Low | Lists only 001–003 and 011; 004–010 exist and apply (validated by `db:validate`). Update README in follow-up. |
| No migration edits made | — | Per card rules; any schema fix requires new `012_*.sql`. |

---

## Part D — Schema flexibility review

### Flexible enough now

| Area | Assessment |
|------|------------|
| **form_templates / form_template_versions** | JSON schema, workflow, validation, compiled workflow — supports admin-authored forms without code deploys. |
| **form_submissions / workflow_step_instances** | Runtime pins to `template_version_id`; step instances track per-submission workflow state. |
| **template_launch_entries / app_spaces** | `visible_to_roles_json`, `status`, `sort_order` — launch visibility without hardcoded nav. |
| **template_bindings** | Optional workflow binding between source and workflow templates. |
| **roles / user_roles** | Extensible role catalog with system seed roles; email-based assignments. |
| **vendor_master** | `payload_json`, `document_meta_json`, `history_json` — flexible vendor workflow state. |
| **requests** | `form_payload`, `archive_kind`, `archive_id`, `demo` flag — supports archive bridge and demo isolation. |
| **integration_events / outbox_events** | Queued dispatch with retry, dedupe, locking — production-safe async pattern. |

### Too rigid (acceptable for MVP staging)

| Area | Issue | Before RDS? | After launch? |
|------|-------|-------------|---------------|
| **Dual RBAC stores** | Postgres `user_roles` for workflow onboarding; portal permission bundles still in Redis KV (`api/lib/hub/store.js`) | **Needs config** — keep Upstash on staging | Unify portal permissions into Postgres |
| **vendor_master status columns** | Fixed `w9_status`, `banking_status`, etc. as TEXT columns | OK for MVP | Consider JSON status map if vendor doc types grow |
| **users.permissions JSONB** | Parallel to `user_roles` | OK if synced at login | Consolidate |
| **form_definitions (legacy)** | Tied to `document_types` registry | Keep for BOL/JSA legacy paths | Migrate remaining doc types to `form_templates` |
| **assignee_role on workflow_step_instances** | TEXT, not FK to `roles.key` | OK | Add FK or validation layer |
| **No departments/teams tables** | By design for MVP | N/A | Defer org chart |

### Recommended before RDS (no new migration required for staging)

- Run `npm run db:migrate` on RDS; verify with `npm run db:validate`.
- Seed only via controlled scripts (`db:seed`, `db:seed-archives`) — not auto demo on staging.
- Configure Upstash if portal permission KV is still required.

### Can wait until after launch

- Full RBAC unification (Redis → Postgres).
- Deprecate `form_definitions` after all document types use template builder.
- Department/team/org-chart tables.
- Analytics warehouse tables.

---

## Part E — Production safety audit

| Item | Status | Classification | Notes |
|------|--------|----------------|-------|
| `_noauth=1` dev bypass | Present in `index.html`, `rbac-client.js` | **Needs config** | Bypasses client auth gate; `DEPLOYMENT_STAGING.md` says do not use on staging. Hostname localhost also bypasses SSO redirect. |
| `rolePreview` query param | Localhost UI-only preview | **Safe** (localhost) / **Needs config** (staging) | APIs enforce permissions in production per UI banner. |
| Demo seed routes `/hub/dev/seed-demo-data` | Gated by `isDevDemoAllowed()` | **Needs config** | Allowed when `NODE_ENV !== 'production'` or admin. Block on production. |
| `demoSeedEnabled` portal setting | Settings UI toggle | **Needs config** | Default true; disable on staging via hub settings. |
| `HUB_USE_LOCAL_STORE` / local JSON | `for-dev/local-redis.js` | **Blocker if enabled on staging** | `server-core.js` warns on staging. Must be `0` for multi-user staging. |
| Hardcoded `127.0.0.1:3000` | Dev server logs, test docs | **Safe** | Not used in production server paths. |
| Hardcoded test users in demo seed | `for-dev/hub-demo-seed.js` | **Safe** | Demo-only; `demo: true` flag on entities. |
| Secrets in code | None found in app code | **Safe** | Secrets via `.env.staging.example` placeholders only. `OpnForm-main/` has example secrets — exclude from deploy. |
| `SSO_ENFORCEMENT` | Env kill switch | **Needs config** | Must be `on` for staging approval. |
| `EMAIL_DELIVERY_MODE` | `queued` in PM2 config | **Needs config** | Requires worker + `RESEND_API_KEY`. |
| `INTEGRATION_DISPATCH_MODE` | `queued` in PM2 config | **Needs config** | Requires `ops-hub-staging-worker` process. |
| Redis / Upstash dependency | `for-dev/redis-client.js` | **Needs config** | Required for legacy KV unless fully on Postgres adapters. Staging can use Upstash alongside RDS. |
| `HUB_STORE_MODE=postgres` | Template + hub validation tests | **Needs config** | Required for RDS staging; validated by `db:validate`. |
| Auth gate “fail open” on `/me` error | `index.html` auth gate | **Document risk** | Prevents redirect loops; means network failure bypasses gate. Acceptable tradeoff documented in code. |
| Migration local assumptions | None in canonical `migrations/` | **Safe** | All SQL is portable Postgres. |

---

## Part F — Hosting recommendation

### Target shape (MVP)

| Layer | Recommendation |
|-------|----------------|
| **App** | Single Node 20.x instance; `scripts/production-server.js` via PM2 (`deploy/ecosystem.config.cjs`) or systemd (`deploy/ops-hub-staging.service`). |
| **Worker** | Second PM2 process for `scripts/hub-worker.js` (outbox + integration delivery). |
| **Database** | AWS RDS PostgreSQL; `DATABASE_URL` + `HUB_STORE_MODE=postgres`. |
| **Redis** | Upstash Redis REST (legacy portal KV, dedupe) until RBAC fully migrated. |
| **TLS** | Nginx or ALB terminating HTTPS; sample config at `deploy/nginx/ops-hub-staging.conf`. |
| **Static** | `index.html` + JS/CSS served by Node static handler in `scripts/server-core.js`. |

### Repo readiness for this shape

| Ready | Gap |
|-------|-----|
| PM2/systemd/nginx deploy artifacts exist | Fill `.env.staging` secrets |
| `npm run db:migrate` + `db:validate` pass | Provision RDS and run migrate on empty DB |
| Dual-process worker architecture documented | Configure Resend, Entra SSO, Upstash |
| `DEPLOYMENT_STAGING.md` runbook | Remove/exclude `OpnForm-main/` from `git clone` deploy |
| Health check script (`npm run health`) | Manual browser sign-off after cutover |

**Verdict:** Repo structure supports EC2 + RDS + Redis + Nginx/ALB + PM2. Operational secrets and artifact cleanup remain before leadership staging approval.

---

## Part G — Tests run

All requested scripts exist and were executed **2026-07-07**. Result: **26/26 PASS** (0 failures).

| Script | Result |
|--------|--------|
| `npm run db:validate` | PASS |
| `npm run settings:ui-test` | PASS |
| `npm run templates:mvp-ia-test` | PASS |
| `npm run templates:ia-test` | PASS |
| `npm run templates:versioning-test` | PASS |
| `npm run templates:validator-test` | PASS |
| `npm run templates:builder-ui-test` | PASS |
| `npm run templates:launch-registry-test` | PASS |
| `npm run templates:section-binding-test` | PASS |
| `npm run templates:section-builder-ui-test` | PASS |
| `npm run templates:runtime-mvp-test` | PASS |
| `npm run templates:runtime-reconciliation-test` | PASS |
| `npm run templates:ui-cleanse-import-test` | PASS |
| `npm run templates:new-request-registry-test` | PASS |
| `npm run templates:legacy-runtime-parity-test` | PASS |
| `npm run templates:mvp-sidebar-consolidation-test` | PASS |
| `npm run templates:forms-admin-rbac-readiness-test` | PASS |
| `npm run templates:archive-route-hydration-test` | PASS (51 checks) |
| `npm run templates:dark-mode-surface-consistency-test` | PASS (30 checks) |
| `npm run vendor-dashboard:test` | PASS |
| `npm run vendor-master:test` | PASS |
| `npm run vendor-workflow:test` | PASS |
| `npm run vendor-documents:test` | PASS |
| `npm run vendor-document-notifications:test` | PASS |
| `npm run vendor-rbac-ui:test` | PASS |
| `npm run vendor-dashboard-queues:test` | PASS (30 checks) |

No missing test scripts from the requested list.

---

## Blockers

| Blocker | Type | Mitigation |
|---------|------|------------|
| RDS instance + `DATABASE_URL` not provisioned in this card | Operational | Follow `RDS_POSTGRES_SETUP.md` |
| Staging secrets unfilled | Operational | Copy `.env.staging.example` → `.env.staging` |
| `OpnForm-main/` in deploy artifact | Deploy hygiene | Delete or `.dockerignore` / sparse checkout |
| `HUB_USE_LOCAL_STORE=1` on staging | Config | Set to `0`; use Upstash |
| Demo seed exposed to non-admins on staging | Config | `NODE_ENV=staging` limits seed; disable `demoSeedEnabled` in settings |

**No code/schema blockers** identified for RDS staging migration.

---

## Recommendation summary

| Criterion | Status |
|-----------|--------|
| Unused files removed or documented | Done — 4 deletions, 9 reports moved, risks documented |
| Migration order documented | Done — 001–011 |
| Schema flexibility gaps identified | Done — dual RBAC, legacy `form_definitions` |
| Production safety risks documented | Done |
| Hosting path documented | Done — EC2 + RDS + Redis + Nginx + PM2 |
| Tests pass | **26/26 PASS** |
| Report created | This document |

### Next steps (ordered)

1. Team confirmation to remove `OpnForm-main/` from repo or deploy exclude list.
2. Provision RDS; run `npm run db:migrate` against empty database.
3. Configure `.env.staging` (SSO, Resend, Upstash, `SESSION_SECRET`).
4. Deploy via PM2 per `DEPLOYMENT_STAGING.md`; run `npm run rds-staging-smoke:test` on host.
5. Manual browser verification: hard refresh archive/forms routes without `?_noauth=1` on staging SSO.

**Final recommendation: Ready after listed cleanup**
