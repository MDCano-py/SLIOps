# Regression results — October 2026

The security changes were exercised through the existing hub handler and through the regression scripts that already guard session, workflow, and staging behavior. No new identity provider, MFA flow, or UI redesign was added.

## Routes exercised on disposable Postgres

| Surface | Request | Result |
| --- | --- | --- |
| Dashboard | `GET /hub/dashboard/summary` | 200 |
| Action required | `GET /hub/dashboard/action-required` | 200, summary projection |
| Request queue | `GET /hub/requests` | 200, summary for a non-participant |
| New request | `POST /hub/requests` with a signature step | 201, server-owned requester and status |
| Document / signature workflow | complete and PATCH on `/hub/workflow-steps/{id}` | 403, 400, and 200 as required by the actor |
| Timeline | `GET /hub/requests/{id}/timeline` | 200 for the owner after the audit-label fix, 403 for another employee |
| Archive create, read, delete | `/archive/jsa` and `/archive/swp` | 200 / 404 on the in-process archive stub |
| Form retry | `POST /forms/roll-off-swap` | identical bodies collapsed |
| My Tasks | `GET /hub/my-tasks` | 200 |
| Control Room | `GET /hub/control-room/meta` | 200 and a station list |
| Template registry | `GET /hub/templates` as hub admin | 200 |
| Client link | `POST /hub/action-links` then unauthenticated `GET /hub/action/{token}` | 201 then 200 |
| Admin permissions | template list and action-link create require hub admin | enforced by the same routes |
| Logout | `POST /auth/logout` | 302 to a URL that includes `signed_out=1`, not a cross-site GET |

## Not covered end to end

| Surface | Result |
| --- | --- |
| MaintainX synchronization | BLOCKED. The type gate ran against a mocked `fetch`. No work order was read or written upstream |
| Entra ID and AuthBridge browser SSO | BLOCKED. No IdP redirect was followed. AuthBridge token verify and logout were proven only with a locally signed RS256 token and disposable Redis |
| Signed-in browser, including print and the sandboxed snapshot iframe | not run |
| Full `npm test` matrix | not run |

## Existing scripts

| Script | Result |
| --- | --- |
| `scripts/security/october-2026-remediation-test.js` | PASS |
| `scripts/security/workflow-step-authz-test.js` | 12 passed |
| `scripts/security/wos-logout-session-clear-test.js` | PASS, including `signed_out=1` and cookie clear |
| `scripts/security/staging-hardening-test.js` | 34 passed |
| AuthBridge `tests/test_october_2026_redis_integration.py` | 1 passed |

Logout redirect behavior in the integration script stopped at the first 302. It did not follow into Entra, so it does not by itself prove the browser will not loop. The landing URL contains `signed_out=1`, which is the guard the portal already uses to stop an immediate return to sign-in.
