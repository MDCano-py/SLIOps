# WOS-98 — Vendor Contract Automation Fix (Dashboard 500, Repair 404, MSA/NDA Workflow)

## Root causes

### 1. Vendor Management Dashboard HTTP 500

| Item | Detail |
|------|--------|
| **Failed endpoint** | `GET /api/maintainx?path=%2Fvendors` |
| **UI** | `loadDashboard()` → `mgmtFetch(proxyUrl('/vendors'))` in `index.html` |
| **Root cause** | Non-production environments used `requireVendorAuth`, which returns **500** when `VENDOR_ACCESS_CODE` is unset. Hub Admin SSO never sends `X-Vendor-Session`. WOS-98 only exposed the sidebar, so Hub Admin hit this broken path. |
| **Secondary risk** | `GET /vendors` also required object storage when deployed → would 503 (not this 500). |
| **Fix** | Prefer Hub SSO `requirePermissions` (same pattern as User Management). Legacy passcode only when `X-Vendor-Session` is present. Metadata list/detail no longer requires object storage. Local errors show server `error` detail. |

### 2. “Repair NDA wiring” → Configuration route not found

| Item | Detail |
|------|--------|
| **Client** | `POST` via `hubFetch('/hub/configuration/repair-nda-wiring')` — does **not** navigate |
| **Server** | Registered in `api/lib/configuration/routes.js` |
| **404 message** | Catch-all `Configuration route not found` when the running API process lacks the route (stale `require` cache / process started before WOS-98) |
| **Fix** | Route remains POST; button uses `preventDefault`/`stopPropagation`, `data-cfg-action="repair-nda-wiring"`, clearer success/error. **Restart the API** (`npm run dev` / `npm run dev:pg`) after deploy. Expanded repair also wires MSA + vendor NDA/MSA condition workflow (idempotent). |

### 3. MSA/NDA were passive checkboxes

**Fix:** On `POST /vendors`, values become workflow context:

- `vendor.nda_required` / `vendor.msa_required` (boolean)
- `vendor.vendor_ref`, `company_name`, `contact_*`, etc.
- Event `vendor.request.submitted`
- Starts published `vendor_onboarding_workflow` when `CONFIGURABLE_PLATFORM_ENABLED=1`

Default vendor workflow: **NDA condition → MSA condition → upload/ops** (sequential; admin can reconnect). `logic.update_vendor` writes `nda_status` / `msa_status`.

## Routes / methods

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/vendors` | Vendor list + dashboard (SSO RBAC) |
| POST | `/vendors` | Create vendor + start cfg workflow |
| POST | `/hub/configuration/repair-nda-wiring` | Diagnostic repair (idempotent) |
| GET | `/hub/configuration/validate-wiring` | Pre-flight broken-reference check |

## Migrations

No new migration. Uses `006_vendor_master`, `013_configurable_platform`, `014_workflow_runtime_notifications`.

## Tests

```bash
npm run security:wos98-vendor-contract-automation-test
npm run security:wos98-nav-documents-bridge-test
npm run security:wos98-config-vendor-nda-e2e-test
```

## Still deferred / mocked

- Full **React Flow** (`@xyflow/react`) migration — vanilla `hub-workflow-designer.js` remains (drag, handles, x/y persistence, undo). React Flow is the intended next canvas platform; not embedded n8n.
- True parallel NDA+MSA execution (engine is single-path; seed runs NDA then MSA).
- SMTP to vendor inbox (secure link still minted for admins).
- Sealed PDF.
- Live browser screenshots must be captured on a restarted Hub with `CONFIGURABLE_PLATFORM_ENABLED=1` + **Seed defaults** or **Repair** once after upgrade.

## Ops after deploy

1. Restart API so `repair-nda-wiring` is loaded.
2. Set `CONFIGURABLE_PLATFORM_ENABLED=1`.
3. Configuration → Seed defaults (or Repair once) to publish MSA template + vendor NDA/MSA branches.
4. Confirm Dashboard loads; submit vendor with NDA only / both; verify My Tasks + vendor status write-back.

## Branch / commit

- Branch: `wos-98-config-vendor-nda-e2e`
- Commit: `e503c4a87326a7babfe904d1f47d20f92744f5c9` (`e503c4a`)
