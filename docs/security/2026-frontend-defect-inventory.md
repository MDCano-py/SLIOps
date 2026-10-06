# Frontend Production Defect Inventory (Gate 3 pass)

**Date:** 2026-10-05  
**Method:** Static/route audit + security regression suites (no live Entra browser session in this environment)

| ID | Severity | Route / area | Finding | Status |
| --- | --- | --- | --- | --- |
| FE-001 | `P1_FIX_BEFORE_LAUNCH` | `#/control-room` | Deep-link string exists in signed-out tests; no Control Room page/nav — operators hitting hash see blank/wrong tab until CR built | **Deferred** to Gate 4 (not implemented this pass per stop rule) |
| FE-002 | `P1_FIX_BEFORE_LAUNCH` | Management → Organization SSO | Was visible to `view_management`; now UI gated on `manage_sso` | **Fixed** (`rbac-client.js`) |
| FE-003 | `P2_HARDEN_THIS_WEEK` | Insights / Analytics | Historical placeholders — confirm empty states on live | Open (needs live UI) |
| FE-004 | `P2_HARDEN_THIS_WEEK` | MaintainX / S3 banners | Graceful “not configured” — covered by MaintainX/storage tests | Mitigated in API; live UX pending |
| FE-005 | `P0_PRODUCTION_BLOCKER` | Static exposure on live host | Code mitigated; live = `INFRASTRUCTURE_CHANGE_REQUIRED` | Deploy + remote probe |
| FE-006 | `P1_FIX_BEFORE_LAUNCH` | Docs | `DEPLOYMENT_STAGING.md` missing broke `object-storage-test` | **Fixed** (restored from history) |
| FE-007 | `P3_DEFER` | a11y baseline | Labels/focus pass not fully audited | Defer |

No P0 UI code defects were found that could be safely fixed without live browser SSO beyond FE-005 (infra) and FE-002 (fixed).

**API remains the security boundary** — UI visibility changes are UX only.
