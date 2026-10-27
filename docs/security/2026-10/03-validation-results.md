# Validation results — 2026-10-26

Commands were run on this workstation. No request was sent to `operations.streamlinescada.com` or `automation.streamlinescada.com`.

Local Node was `v24.18.0`. That is not the patched 24.22.1 runtime. AuthBridge tests used `sli-authbridge\.venv` (Python 3.12).

## PASS

| Command | Working directory | Result |
| --- | --- | --- |
| `node scripts/security/october-2026-remediation-test.js` | SLIOps | PASS (all named checks) |
| `node scripts/security/workflow-step-authz-test.js` | SLIOps | PASS (12) |
| `node scripts/security/wos-logout-session-clear-test.js` | SLIOps | PASS |
| `node scripts/security/staging-hardening-test.js` | SLIOps | PASS (34) |
| `node --check` on `api/maintainx.js`, `api/lib/hub/routes.js`, `api/lib/auth.js` | SLIOps | exit 0 |
| `.\.venv\Scripts\python.exe -m pytest tests/test_october_2026_remediation.py tests/test_validation.py tests/test_sumo.py tests/test_revocation.py -q` | `sli-authbridge` | **31 passed**, 4 warnings |

The remediation script covered: HTML sentinels, signature vs fill authorization, protected PATCH fields, forged create fields, queue summary vs owner row, eight identical creates vs one distinct create, pre-logout token denial and a later login, cross-site GET logout, buffered PUT body, type and size limits, pipeline `zrem`, and UUID shape.

AuthBridge pytest covered the backslash redirect, logout site checks, nil tenant, non-ASCII admin key, hidden docs, and the existing validation/revocation/sumo modules. Sumo health assertions were updated because `/healthz` no longer returns probe detail.

## Not run (do not read as PASS)

| Gap | Status |
| --- | --- |
| Full SLIOps `npm test` matrix, browser click-through of JSA/BOL print, and a signed-in portal session | NOT RUN. Portal sign-in needs Entra. Markup was inspected: snapshot iframe `sandbox` is empty; sign-out submits POST |
| PostgreSQL integration for notification 404, hub 22P02, and migration 019 | BLOCKED. No disposable database was used, and the migration was not applied |
| AuthBridge logout against a real Redis revocation list, then `/session/verify` replay | BLOCKED. Tests mock the session store |
| MaintainX PUT against the upstream API | NOT RUN. The local check stops before `fetch` |
| `npm audit` / image SBOM / host `node -v` on EC2 | NOT RUN against production. See the dependency note |
| Live header, HSTS, and docs probe | NOT RUN. Probing the live hosts was out of scope |

## Historical report status

Strix results from October 22–23 remain the last independent dynamic results. They predate `9b459e5` and `e05b2fc`. They are not evidence that these commits are deployed.
