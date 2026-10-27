# Deployment and retest runbook

**Release readiness: NO-GO.**

P0 fixes are in local commits only. They are not deployed and have not been independently retested. Do not describe this branch as production-ready.

Commits to deploy together, staging first:

1. AuthBridge `e05b2fcc4f3a061ce99d1856ef636054bd817a09` on `security/2026-10-remediation` in the SSO repo.
2. SLIOps `9b459e5b1cd480fcce99a4163b0968e9f31fac0b` on `security/2026-10-remediation`.

Deploy AuthBridge before SLIOps so logout forwarding and `/session/verify` understand jti revocation before the portal starts POSTing sign-out.

## Before staging

1. Back up the AuthBridge Postgres database and the SLIOps Postgres database. Do not restore by rewriting history.
2. Confirm the running Git SHA on each host. It is currently UNKNOWN. Record it in the change ticket.
3. Apply SLIOps `migrations/019_session_revocation.sql` only after backup. It creates `sliops_session_revocation` and does not update existing rows.
4. Set `SLIOPS_SESSION_REVOCATION_STORE=postgres` on every Node worker after the table exists. Without that, revocation is per process and a second worker can still accept a logged-out HMAC cookie.
5. Leave `AUTHBRIDGE_EXPOSE_DOCS` unset.
6. Confirm `COOKIE_SECURE=true` on the gateway. Do not print secret values into the ticket.
7. HSTS in the operations nginx example is `max-age=31536000` **without** `includeSubDomains`, because that flag on a parent name would cover sibling products. Apply it on the operations vhost and the auth vhost only after the operator confirms each `server_name`.
8. Plan a Node upgrade to **24.22.1 or a later 24.x** on the host. The manifest already asks for `>=24.22.1 <25`. The workstation that ran these tests was 24.18.0. Do not treat the manifest as the running version.
9. Rotate `SESSION_SECRET` and `ENTRA_CLIENT_SECRET` only with the owner's existing rotation procedure, after file exposure is confirmed closed. This pass did not rotate them. Rotation of `SESSION_SECRET` signs everyone out. Follow `docs/security/2026-production-exposure-checklist.md`.
10. Confirm `CLEANUP_SECRET` is set on the host. Missing secret must fail closed (existing code). Do not read the value into logs.

## Staging order

1. Deploy AuthBridge. Reload nginx from `adapters/nginx/authbridge.conf` only after review.
2. Health: `GET /healthz` returns `{"status":"ok","service":"sli-authbridge"}` and does not mention Sumo.
3. `GET /docs`, `/redoc`, and `/openapi.json` are 404.
4. Login with a staging employee still completes Entra and returns to the operations host.
5. Deploy SLIOps. Restart PM2 (`ops-hub-staging` and the worker) only as the existing staging procedure describes.
6. Confirm `GET /health` is green and archive DELETE/SWP create no longer log `pipe.zrem is not a function`.

## Revert

- AuthBridge: redeploy the previously recorded SHA. Do not force-push.
- SLIOps: redeploy the previously recorded SHA. `019_session_revocation.sql` can stay; the old code ignores the table. Dropping it is optional and needs a DBA.
- If HSTS was enabled on the wrong name, remove that `add_header` and reload nginx. Browsers that already stored HSTS keep it until `max-age` ends.

## Operator / employee / vendor checks

| Actor | Check | Expected |
| --- | --- | --- |
| Employee A | Create a JSA whose API body contains `<img src=x onerror=alert(1)>` | Record saves. Detail view does not run the handler. Print/export still shows tables and text |
| Employee A | Open a historical archive row known to contain a script | Script does not run. Row is not deleted |
| Employee A | Complete a fill step assigned to A | 200 |
| Employee A | Complete or reject a signature step assigned to B | 403 |
| Employee B | Complete that same signature step | 200 |
| Employee A | PATCH a step with `status` or `completed_by` | 400 |
| Employee A | POST `/hub/requests` with B's email and `status=approved` | Stored requester is A and status is `submitted` |
| Admin | POST with `assigned_to` | Assignment stored |
| Employee A | GET `/hub/requests` for a row A cannot open | Summary fields only. No `form_payload`, notes, or storage URL. Detail remains 403 |
| Employee A | POST mark-read on B's notification id | 404 and B's `read_at` unchanged |
| Employee A | Sign out from the portal, then replay the old cookie | 401/anonymous on `/me` and on AuthBridge `/session/verify` |
| Employee A | Sign in again | New session works |
| Another site | Top-level navigation to logout | 403 and the session remains |
| Employee | PUT a jpeg work-order upload within 15 MB, and a `text/html` body | jpeg follows the existing MaintainX rules; html is 415 and is not forwarded |
| Vendor | Existing code-login and magic-link flows | Unchanged. This pass does not alter vendor cookies |

## rePen retest

Ask the assessor to repeat the scripted checks in `_1`, `_2`, and `_3` for W03, W05, W06, W07, W08, S05, S06, A13, A15, A17, A19, vuln-0011, and `_2` vuln-0003. Give them the deployed SHA after staging, not these local SHAs, once the host is actually running that SHA.

Do not send new exploit payloads to production until that retest is authorized.

## Test-record cleanup

Reports left labeled `RETEST1022` and `ZZ-PENTEST` rows because archive DELETE was broken. After the `zrem` fix is on the host, an owner may delete those rows with the normal creator-or-admin archive DELETE. Do not bulk-delete by title. Do not delete historical JSA/BOL rows to "clean" XSS; sanitizing on read is the safe path. A separate owner-approved rewrite of stored HTML can be done later by reading each row, running `sanitizeRenderedHtml`, and writing it back.
