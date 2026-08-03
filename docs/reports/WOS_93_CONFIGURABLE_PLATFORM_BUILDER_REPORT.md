# WOS-93 — Configurable Platform Builder Report

**Branch:** `wos-93-configurable-platform-builder`  
**Commit:** `112f4d9`  
**Feature flag:** `CONFIGURABLE_PLATFORM_ENABLED=1`

---

## Executive summary

WOS-93 adds a **configuration-first foundation** behind a feature flag: Configuration Center UI, versioned definitions (forms, documents, workflows, dashboards, request types, saved views, variables), a safe expression/condition engine, a visual workflow designer wired to a real runtime, and additive Postgres migrations. Existing legacy requests, templates, auth, RBAC, MaintainX, Automation, and S3 behavior remain intact when the flag is off (default).

---

## Architecture overview

Five concepts:

1. **Definitions** (`cfg_definitions`)
2. **Versions** (`cfg_versions`) — draft / published / archived; published immutable
3. **Instances** (`cfg_workflow_instances`, tasks, node executions, generated documents)
4. **Variables** (builtin registry + `cfg_variable_definitions`)
5. **Execution history** (`cfg_node_executions`, `cfg_audit_events`)

Compatibility: dual runtime (`legacy` vs `configurable`). See `docs/architecture/WOS_93_COMPATIBILITY_STRATEGY.md`.

---

## Database changes

Additive migration: `migrations/013_configurable_platform.sql`

Tables: `cfg_definitions`, `cfg_versions`, `cfg_variable_definitions`, `cfg_workflow_instances`, `cfg_node_executions`, `cfg_workflow_tasks`, `cfg_generated_documents`, `cfg_audit_events` (+ indexes / FKs).

No destructive changes to `form_templates`, `requests`, or `workflow_steps`.

---

## New routes / APIs

UI hashes: `#/configuration`, `#/admin/configuration` → tab `hub-configuration`.

API (gated by flag + RBAC), mounted in `handleHubRoute` before template routes:

- `GET /hub/configuration/status`
- `GET /hub/configuration/catalogs`
- `GET|POST /hub/configuration/variables`, `POST .../variables/resolve`
- `POST /hub/configuration/validate`
- `POST /hub/configuration/forms/validate-submission`
- `POST /hub/configuration/seed-defaults`
- `GET /hub/configuration/audit`
- CRUD + `publish` / `archive` / `duplicate` / `history` / `validate` for:
  - `/hub/configuration/request-types`
  - `/hub/configuration/forms`
  - `/hub/configuration/documents`
  - `/hub/configuration/workflows`
  - `/hub/configuration/dashboards`
  - `/hub/configuration/saved-views`
- Runtime: `/hub/workflow-runtime/start`, `/instances/:id`, `/retry`, `/tasks`, `/tasks/:id/complete`

---

## New permissions

Added to `PERMISSION_CATALOG`:

- `configuration.view|edit|publish|archive`
- `workflow.execute|manage`
- `form.manage`, `document.manage`, `dashboard.manage`, `variable.manage`

`admin` / `hub_admin` continue to bypass as today.

---

## Variable / form / document / workflow / dashboard models

- **Variables:** allowlisted builtins + `custom.*`; resolver never uses `eval`; sensitive values blocked from render.
- **Forms:** field registry (25+ types), sections, conditional visibility/required, server-side submission validation, draft→publish.
- **Documents:** sanitized HTML body, variable insertion panel, signer metadata, `pdf_status: unavailable` (deferred sealing).
- **Workflows:** node library (triggers, human, logic, notify, document, integration, terminal), SVG canvas, connections/outcomes, cycle rejection, publish validation.
- **Runtime:** starts from published version, executes automatic nodes, creates My-Tasks-compatible `cfg_workflow_tasks`, condition branching, idempotency keys, failure + retry.
- **Dashboards:** widget registry + reorderable layout definitions (consumes existing operational concepts; does not replace legacy dashboard APIs).

---

## Feature flags

```env
CONFIGURABLE_PLATFORM_ENABLED=0
```

Documented in `.env.example` and `.env.staging.example`.

---

## Security controls

- Auth required; permission checks server-side
- Published immutability + revision conflict (`409 CONFLICT`)
- Payload size / field / node / nesting limits
- HTML sanitization (scripts, event handlers, javascript: URLs)
- Allowlisted condition operators only
- Secrets not exposed via variable render or integration node outputs
- Audit events without tokens/cookies

---

## Default templates (seed)

`POST /hub/configuration/seed-defaults` (publish permission):

- NDA form + document + workflow (acyclic revision path)
- Purchase form + conditional approval workflow
- Vendor onboarding form + workflow
- Operations dashboard
- Request types `nda_request`, `work_order`

Seeds create **definitions only** (no demo request rows).

---

## Test results

| Suite | Result |
|-------|--------|
| `npm run security:configurable-platform-test` | **38/38 PASS** |
| Existing security/template regression with flag off | PASS (rbac, hardening, workflow-step-authz, no-origin, object-storage, staging-readiness, start-center, secret-scan) |

---

## Known limitations / deferred

- Final sealed PDF / tamper-evident crypto
- Unbounded revision loops (explicitly rejected; revision modeled without cycles)
- Real-time multi-admin collaborative editing
- Deep MaintainX/Automation invocation inside every integration node (safe skip when not configured)
- Personal saved-view UX is API-ready; polish ongoing
- Live EC2 E2E of NDA + purchase paths requires flag on + migrate + seed

---

## Deployment steps

1. Deploy branch to staging.
2. `npm run db:migrate` (applies `013_configurable_platform.sql`).
3. Set `CONFIGURABLE_PLATFORM_ENABLED=1` in staging env.
4. Restart PM2 (`ops-hub-staging`, worker).
5. As Hub Admin open `#/configuration` → Seed default templates.
6. Publish/validate a workflow; start via `/hub/workflow-runtime/start`.

## Rollback steps

1. Set `CONFIGURABLE_PLATFORM_ENABLED=0` and restart.
2. Leave tables in place (additive; safe).
3. Do not drop `cfg_*` tables while instances exist.

---

## Interface descriptions

- **Overview:** explains dual runtime; seed action.
- **Forms:** list/create drafts; field list with accessible Up/Down reorder; validate/publish.
- **Documents:** title/body editor + variable chips; PDF unavailable notice.
- **Workflows:** node library, draggable/keyboard-movable nodes, SVG edges, connect/delete, side connection list.
- **Dashboards / Variables / History:** widget editor, custom variables, audit feed.
