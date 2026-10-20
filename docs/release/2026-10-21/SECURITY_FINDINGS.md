# Security findings — 2026-10-21 release candidate

**Disposition rule:** `FIXED` requires code and a live host check. This session did not deploy. Local passes are `MITIGATED` in code, awaiting live validation.

The full BW Cyber 46+4 register and internal `STR-*` identifiers are still not in this repository. `docs/security/2026-pentest-remediation-matrix.md` records that gap. Findings below are only those reconciled from that matrix, the cyber handoff, and code verified in this session. Unknown report IDs were not invented.

## Findings touched in this candidate

| ID | Issue | What prevents the original exploit | Local evidence | Live host | Disposition |
| --- | --- | --- | --- | --- | --- |
| ENG-SESSION-002 | Vendor session JWT includes `email` and is signed with `SESSION_SECRET`. Pasting it into `sliops_session` used to satisfy `getActorEmail`. | `isEmployeeSessionPayload` rejects `typ=vendor_session` and vendor claims `sid`/`sk`/`vid`/`cid`. | `security:release-2026-10-21-test` | Not deployed | `MITIGATED` locally |
| ENG-VENDOR-OTP-001 | Shared passcode removed; vendors needed an independent login that does not use AuthBridge. | Six-digit `crypto.randomInt` codes, salted SHA-256 at rest, 5-minute expiry, single-use row lock, attempt cap 5, per-account and per-IP limits, generic request/verify bodies, HttpOnly cookie. | Release test Postgres section, 78 passed / 0 failed overall | Email delivery and edge exemptions not live-tested | `MITIGATED` locally |
| ENG-VENDOR-IDOR-001 | Workspace loaded `getAllVendorRecords()` and filtered in process. A client `ref` could target another vendor. | `getVendorRecordById` (primary key). Mismatched `ref` returns 403 and writes `vendor_scope_escape_blocked`. | SCR-S05 test 28/0 and release test cross-vendor 403 | Not deployed | `MITIGATED` locally |
| ENG-NGINX-001 | Nginx deny treated the prefix `api` as a sensitive directory and could 404 `/api/maintainx` and `/api/auth/*`. | Directory deny no longer lists bare `api`. Source files under `api/` are denied by extension. | `security:pentest-emergency-closure-test` 13/0. Template only. | Nginx not reloaded | `INFRASTRUCTURE_CHANGE_REQUIRED` |
| ENG-AUTH-001 | `x-vercel-*` identity fallback | Still absent from `getActorEmail`. | Gate 2 identity test 16/0 | Not deployed | `MITIGATED` locally, live unverified |
| ENG-SSO-001 | `view_management` could write SAML trust | Writes require `manage_sso` or admin. | Gate 2 SSO test 16/0 | Role seed on the host not re-checked | `MITIGATED` locally |
| ENG-DEST-001 | Cleanup routes with optional secret | Fail closed 503 without a long `CLEANUP_SECRET`. | Gate 2 cleanup test 15/0 | Host env not inspected | `CONFIGURATION_CHANGE_REQUIRED` if secret unset on host |
| ENG-STATIC-001 / SCR-W06 | Sensitive files from the app root | Node denylist. Local probe 32/0. | `security:sensitive-path-probe`. Remote skipped. | Not probed | `INFRASTRUCTURE_CHANGE_REQUIRED` |
| SCR-S05 | Shared vendor passcode | Legacy `/vendor-auth` 404 when `NODE_ENV` is production or staging. | SCR-S05 test | Not deployed | `MITIGATED` locally |
| ENG-PROXY-001 | Client `X-Forwarded-For` | Vendor limiter uses the socket address unless `TRUST_FORWARDED_CLIENT_IP` is on. Nginx template overwrites `X-Forwarded-For` with `$remote_addr`. | Release test and emergency closure test | Edge config not inspected | `MITIGATED` locally |
| SCR-D01 / uuid | `@azure/msal-node` → `uuid` moderate advisory GHSA-w5hq-g745-h8pq | Not upgraded. `npm audit` fix is a semver-major MSAL bump. High and critical: 0. Moderate: 2. | `npm audit` on 2026-10-20 | n/a | `DEFERRED_WITH_RISK_ACCEPTANCE` |

## Still open because the report is not in the repo

| ID | Matrix disposition before this session | This session |
| --- | --- | --- |
| SCR-A01, SCR-A02, SCR-A03 | `NEEDS_MANUAL_VALIDATION` | Not mapped to a report title. Related code controls above were re-tested locally only. |
| SCR-S20 | `NEEDS_MANUAL_VALIDATION` | No report text. Not closed. |
| SCR-W01, SCR-W05 | `NEEDS_MANUAL_VALIDATION` | No report text. Static-path and RBAC tests were re-run locally only. |
| Internal `STR-*` | Blocked on the report package | Still blocked. No STR IDs were invented. |

## Controls that tests did not disable

Rate limits, HttpOnly cookies, hash-at-rest, SSO `manage_sso`, cleanup fail-closed, and the sensitive-path denylist were left enabled. Tests use a local `SESSION_SECRET` of at least 32 characters and the developer Postgres URL. They do not turn `SSO_ENFORCEMENT` off.

## Employee / vendor / external separation

| Principal | Credential | Must not grant |
| --- | --- | --- |
| `EMPLOYEE` | `sliops_session` / AuthBridge | Vendor workspace (release test: employee cookie on `/vendor/workspace` → 401) |
| `VENDOR` | `sliops_vendor_session` after code or magic link | Employee actor (vendor JWT in `sliops_session` → null actor) |
| `EXTERNAL_ACTION_RECIPIENT` | Existing `/hub/action/:token` link | Unchanged. Not re-tested end to end in this session. |

Invitation tokens remain single-use in the SCR-S05 test (replay 410). Verification codes are a separate single-use table.
