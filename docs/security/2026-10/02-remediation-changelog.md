# Remediation changelog — 2026-10-26

Local commits only. Neither commit has been pushed or deployed.

## SLIOps `9b459e5b1cd480fcce99a4163b0968e9f31fac0b`

Branch `security/2026-10-remediation`.

| Change | Where | Why | Test |
| --- | --- | --- | --- |
| Allowlist sanitizer for stored HTML. Reads re-sanitize historical snapshots and do not delete them | `api/lib/html-sanitize.js`, archive POST/PATCH/GET in `api/maintainx.js` | Client escaping does not bind direct API writes or old rows | img/script/javascript/table cases |
| Archive viewer uses an iframe with `sandbox=""` (no `allow-scripts`, no `allow-same-origin`) | `index.html` `renderSandboxedSnapshot` | A missed tag must not run in the portal origin | source inspection. Browser session not run |
| Workflow complete/reject requires the stored assignee or an audited override. Requester self-review of signature/review steps is denied. Fill steps assigned to the requester still complete | `api/lib/hub/authorization.js`, `routes.js` | STR-S05 checked requester-or-assignee | actor matrix in the remediation test |
| Step PATCH rejects status, completion, and assignee fields | `workflowStepPatch` | STR-S06 | protected-field case |
| New workflow steps ignore client completion status | `api/lib/hub/documents.js` | Create must not land a step already completed | covered by the status initializer; no separate assertion |
| Create stamps requester and `submitted` status from the server. Assignment requires admin, `hub_admin`, or `assign_hub_requests` | `trustedCreateInput` | STR-W07 / F-02 | forged-field case |
| Archive mirror uses the actor, not `contactEmail` | `api/lib/hub/bridge.js` | Same attribution bug on form intake | helper-level; bridge call not executed against a database |
| Archive/form idempotency: explicit key 24h, identical canonical body 2 minutes, per actor and kind | `api/lib/archive-idempotency.js` | STR-W06. Title alone does not match | 8 concurrent identical vs one distinct |
| Queue and action-required project a summary when the caller cannot open the row | `projectQueueRecord` | `_2` vuln-0003 | summary vs owner case |
| Notification read updates only the recipient row | `postgres.js`, `routes.js` | STR-W08 response half | 404 path when the store returns null. Database not used |
| Bad ids never reach PostgreSQL as unbounded errors | `isUuid`, hub handler omits `err.message` | vuln-0011 | format gate |
| Employee logout records an iat cutoff. A later login is stamped past it | `session-revocation.js`, `auth.js`, `logout.js` | STR-W05 for the SLIOps HMAC cookie | replay denied, new login allowed |
| Cross-site GET logout returns 403. Portal sign-out POSTs | `logout-csrf.js`, `index.html`, `hub.js` | STR-A15 / F-04 | CSRF cases |
| Memory Redis pipeline implements `zrem` | `for-dev/redis-client.js` | `pipe.zrem is not a function` on the postgres-only stub | SWP index move |
| PUT uploads read the buffered body and enforce type and 15 MB | `maintainx-upload.js` | HTTP 500 before MaintainX | jpeg allowed, html and oversize denied |
| Partial CSP and nginx header examples | `server-core.js`, `deploy/nginx/ops-hub-staging.conf` | STR-A20 / `_4` transport notes | existing staging-hardening test still passes |
| Additive revocation table. Not applied to any database | `migrations/019_session_revocation.sql` | Shared cutoff when `SLIOPS_SESSION_REVOCATION_STORE=postgres` | not migrated in this run |

## AuthBridge `e05b2fcc4f3a061ce99d1856ef636054bd817a09`

Same branch name, separate repository (`SSO`).

| Change | Where | Why | Test |
| --- | --- | --- | --- |
| Redirect allowlist rejects backslash, userinfo, non-ASCII, and scheme-relative URLs | `gateway/dependencies.py` | `_4` vuln-0004 and STR-A13 | pytest differential cases |
| Logout GET from another site is rejected. Logout revokes the presented `jti` (or `uti`) for the remaining lifetime | `oidc.py` | STR-A15 and STR-W05 on the gateway | CSRF helper tests. Redis revoke path not executed |
| OpenAPI/Swagger/ReDoc off unless `AUTHBRIDGE_EXPOSE_DOCS` is true | `main.py`, `.env.example` | `_4` vuln-0001 | `/openapi.json` and `/docs` return 404 |
| Nil tenant id is not published in Ignition metadata | `ignition.py` | `_4` vuln-0003 | `public_metadata_tenant` |
| Admin key compare uses bytes and returns 403 for non-ASCII | `admin.py` | STR-A19 | pytest |
| Unknown and inactive apps share one error string | `get_active_app` | STR-A17 | constant assertion |
| Public `/healthz` no longer includes Sumo probe detail | `health.py` | over-detailed health | updated `test_sumo.py` |
| Security headers on app responses. Example nginx denies docs and sets HSTS without `includeSubDomains` | `security_headers.py`, nginx examples | STR-A20 / `_4` vuln-0002 | health response header |

## Not changed

- No MFA, passkey, or Entra tenant/pool change.
- `sli-auth` adapter code was not modified. Pre-existing dirty files in that package were left untouched.
- The production zip was not extracted.
- No production or staging request was sent.
