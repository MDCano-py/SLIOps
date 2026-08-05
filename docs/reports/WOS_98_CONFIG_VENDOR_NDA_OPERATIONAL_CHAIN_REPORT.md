# WOS-98 — Configuration and Vendor NDA Operational Chain

## Summary

This card closes the broken **Build → Publish → Assign → Route → Notify → Complete → Track** path for the Mutual NDA scenario across the configurable platform and Vendor Management.

It is **not** a full rewrite of every Configuration Center surface. It wires the operational chain that previously left published documents orphaned and external signers without a secure action.

## Root-cause analysis (disconnected features)

| Area | Root cause | Fix in this card |
|------|------------|------------------|
| Document block order | Linear list; no DnD / keyboard reorder | Drag handles, ↑/↓, duplicate, undo/redo; order persisted in `blocks[]` |
| Published NDA “orphaned” | Publish only flipped `cfg_definitions.status`; no library / attach / launch | Overview **Published Documents library**; post-publish message; document picker on Generate/Sign nodes |
| NDA request type | Seed had no `workflow_definition_id` | Seed + `repairNdaOperationalWiring` attach workflow + form |
| Generate node | `config: {}` — no template id | Seed/`repair` sets `document_definition_id` → Mutual NDA |
| Sign edges | Used `default` while designer/runtime expect `signed`/`declined` | Wired signed → next / declined → reject |
| External vendor sign | `cfg_external_participants` schema only; no mint/page | Mint on assign; `cfg-action.html`; public complete API |
| Notify external | Empty branch in task-notifications | Hub-admin notification with secure URL |
| Vendor Management sidebar | Missing from `#hubSidebarNav` (legacy Management menu hidden in hub-mode) | Explicit **Vendor Management** Admin sidebar item (`mgmt:vendor`) |
| Notify external | Empty branch in task-notifications | Hub-admin notification with secure URL |
| Vendor Management NDA status | Separate file/status system | On workflow complete, if `vendor_ref` in form values → `nda` status `approved` |
| Overview cards | Static non-clickable | Navigate to Forms / Workflows / Request types / Documents |
| Documents highlights Forms | `initTemplateAuthoring` hard-coded `setSidebarForTab('hub-forms')` | Documents sets `hub-documents`; Forms/workflows set `hub-forms` |
| Workflow canvas | Partially addressed in WOS-97 | Document picker added; connection authoring retained |

## Changed files (primary)

- `api/lib/configuration/seeds/default-templates.js` — NDA payload blocks, wired workflow, request type, repair helper
- `api/lib/configuration/runtime/external-participants.js` — **new** token mint/lookup
- `api/lib/configuration/runtime/engine.js` — external mint, complete-by-token, vendor NDA sync, blocks→HTML generate
- `api/lib/configuration/runtime/task-notifications.js` — external link admin notifications
- `api/lib/configuration/routes.js` — published-documents, repair-nda-wiring, external-action GET/POST
- `api/maintainx.js` — SSO public allowlist for external-action
- `cfg-action.html` — **new** vendor/external sign page
- `hub-configuration-center.js` — block DnD, published library, repair button, documents passed to designer
- `hub-workflow-designer.js` — published document picker on generate/sign nodes
- `hub.js` — My Tasks outcome forms (sign/review/fill + vendor_ref)
- `hub.css` — block drag / library styles
- `package.json` — `security:wos98-config-vendor-nda-e2e-test`
- `scripts/security/wos98-config-vendor-nda-e2e-test.js`
- `docs/reports/WOS_98_CONFIG_VENDOR_NDA_OPERATIONAL_CHAIN_REPORT.md`

## Database migrations

No new migration. Uses existing:

- `013_configurable_platform.sql`
- `014_workflow_runtime_notifications.sql` (`cfg_external_participants`)
- `006_vendor_master.sql` (`nda_status`)

## API / route changes

| Method | Path | Auth |
|--------|------|------|
| GET | `/hub/configuration/published-documents` | Config view |
| POST | `/hub/configuration/repair-nda-wiring` | Config publish |
| GET | `/hub/configuration/external-action/:token` | Public (token) |
| POST | `/hub/configuration/external-action/:token/complete` | Public (token) |

## Permission / navigation

- Configuration Center unchanged (admin roles via existing config perms).
- Vendor Management nav was already present (`mgmt:vendor`); not hidden.
- External vendors use **secure link** (`cfg-action.html`), not Hub Configuration.

## Manual test (NDA acceptance)

Prerequisites: `CONFIGURABLE_PLATFORM_ENABLED=1`, Postgres migrations applied, Hub admin session.

1. Configuration Center → **Seed default templates** (or **Repair NDA wiring** if seeds already exist).
2. Overview → confirm **Mutual NDA** in Published Documents library.
3. Vendor Management → create/open a vendor; note `VEN-XXX`; ensure NDA is required if your process needs it.
4. New Request → **NDA Request** (or start after repair).
5. Complete Counterparty form task with `contact_email`, names, and `vendor_ref=VEN-XXX`.
6. Complete Legal review as **Approved**; condition path Yes → Generate.
7. Complete Internal signature as **Signed**.
8. Hub admin notification should include external secure link; open `cfg-action.html?token=…`.
9. External party acknowledges + signs → workflow advances → Complete.
10. Vendor Management shows NDA approved for that vendor.
11. Refresh / re-login: request, instance, and vendor status remain.

Also verify: document block drag reorder + save/reload; workflow handle connect (WOS-97); invalid publish blocked.

## Automated tests

```bash
npm run security:wos98-config-vendor-nda-e2e-test
npm run security:wos97-functional-workflow-connection-authoring-test
npm run security:wos96-production-workflow-runtime-test
```

## Exact URLs (Hub Admin navigable)

| Screen | URL hash |
|--------|----------|
| Configuration Center | `#/configuration` |
| Configuration → Documents (template design) | `#/configuration` then sidebar **Documents (templates)** |
| Main Documents (operational) | `#/documents/templates` |
| Forms | `#/forms` |
| Vendor Management dashboard/list | `#/management/vendors` |
| Vendor profile | `#/management/vendors/{VEN-XXX}` |
| External sign page | `/cfg-action.html?token=…` (absolute when `PUBLIC_BASE_URL` set) |

## Feature flags

| Flag | Effect |
|------|--------|
| `CONFIGURABLE_PLATFORM_ENABLED=1` | Required for Configuration APIs, published cfg documents on main Documents, external-action, NDA request types |
| Without flag | Main Documents workspace drafts still load; cfg Mutual NDA section is empty/omitted; Configuration APIs return 503 |

## RBAC permissions

| Surface | Client rule | Hub Admin |
|---------|-------------|-----------|
| Documents sidebar / page | `HUB_TAB_RULES['hub-documents']` → `hub_admin` or `admin` | Visible |
| Forms | No hub-tab rule (always allowed client-side); manage needs template perms | Visible |
| Configuration | `hub:configuration-admin` → `configuration.view\|edit\|publish` or hub_admin/admin | Visible when platform enabled |
| Vendor Management | `mgmt:vendor` → vendor section perms (`view_management`, `view_vendor_list`, …) or hub_admin/admin bypass | **Visible in `#hubSidebarNav`** |

External vendors must not receive `mgmt:vendor` / configuration admin permissions — they use secure links only.

## Why Vendor Management was missing (corrected)

Earlier WOS-98 report incorrectly claimed Vendor Management was “already navigable.” It existed only on the **legacy** top-tab Management menu, which hub-mode CSS hides. It was **absent** from `#hubSidebarNav`. It is now an explicit Admin sidebar item with `data-portal-tab="management"` + `data-mgmt-section="vendor"` + `data-rbac-key="mgmt:vendor"`.

## Why Forms highlighted on Documents (fixed)

`initTemplateAuthoring` hard-coded `setSidebarForTab('hub-forms')` after Documents navigation. It now sets `hub-documents` when `pageTab === 'hub-documents'`.

## Same document identity

- Authoritative store: `cfg_definitions` (`kind='document'`, e.g. key `mutual_nda_template`)
- Main Documents **Published configuration documents** section calls `GET /hub/configuration/published-documents` and renders those rows
- Does **not** INSERT into `form_templates`
- Workflow nodes store `config.document_definition_id` pointing at the same cfg id

## Automated nav / bridge tests

```bash
npm run security:wos98-nav-documents-bridge-test
npm run security:wos98-config-vendor-nda-e2e-test
```

## Branch / commit

- Branch: `wos-98-config-vendor-nda-e2e`
- Commit: `28f1a91015b7a242f4b0abc271d30a8e58bf8e1f` (`28f1a91`)

## Changed files (navigation / bridge acceptance)

- `index.html` — Vendor Management sidebar item; Documents/Forms subtitles
- `hub.js` — Documents active sidebar; exact `setSidebarForTab`; Configuration openDocument handoff
- `hub-configuration-center.js` — Documents (templates) label; openDocument; Overview library
- `template-registry-ui.js` — Published cfg documents section on main Documents (same cfg identity)
- `scripts/security/wos98-nav-documents-bridge-test.js`
- `docs/reports/WOS_98_CONFIG_VENDOR_NDA_OPERATIONAL_CHAIN_REPORT.md`
## Remaining mocked / deferred behavior

- Full email SMTP to external parties (admins get the link in-app; SMTP optional via existing mail stack).
- PDF sealed output still unavailable (honest `pdf_status`).
- `notify.*` / many `integration.*` nodes remain recorded no-ops.
- Deep usage graph is best-effort (scans workflow payloads for `document_definition_id`).
- Vendor onboarding cfg workflow still does not auto-create `vendor_master` rows (use Vendor Management create + `vendor_ref` bridge).
- Live browser screenshot proof must be captured against a running Hub with the flag on; unit/nav tests alone are not acceptance.

## Deployment

1. Deploy branch `wos-98-config-vendor-nda-e2e` (do not merge to `main` until acceptance).
2. Ensure `CONFIGURABLE_PLATFORM_ENABLED=1` and `PUBLIC_BASE_URL` set for absolute external links.
3. Run migrations through `014` if not already.
4. Call **Seed defaults** or **Repair NDA wiring**.
5. Smoke: Configuration → publish Mutual NDA → Overview library → sidebar Documents → sidebar Vendor Management → assign/sign → vendor NDA approved → refresh with correct nav highlight.

## Rollback

Redeploy previous artifact / revert this branch. Existing `cfg_*` data remains; unused external participant rows are harmless.

## Suggested commit

```text
WOS-98 expose published documents and Vendor Management in Hub navigation
```
