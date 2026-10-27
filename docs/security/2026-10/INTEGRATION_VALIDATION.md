# Integration validation — October 2026

Local only. No staging or production host was contacted. Disposable Postgres listened on `127.0.0.1:55432` and disposable Redis on `127.0.0.1:56379`. Both containers were removed after the run. The script refuses any database URL that is not that local port.

| Area | What actually ran | Result |
| --- | --- | --- |
| SLIOps hub, archive, logout | `node scripts/security/october-2026-integration-test.js` against migrated Postgres | 22 PASS, 0 FAIL, 3 BLOCKED |
| AuthBridge verify, me, logout, replay | `pytest tests/test_october_2026_redis_integration.py` against disposable Redis | 1 PASS |
| Entra / OIDC browser login | not run | BLOCKED |
| Live MaintainX and S3 | not called | BLOCKED |

AuthBridge audit writes in that pytest use a stub database. That pass is a Redis integration result, not a production login test. Archive and SWP rows in the SLIOps script use the in-process Redis stub that postgres-only mode already uses. They are not an Upstash or live S3 test.

## Case results

| # | Case | Result | Evidence |
| --- | --- | --- | --- |
| 1 | AuthBridge OIDC login and token verification | BLOCKED for Entra. Local RS256 issue plus `/session/verify` and `/session/me` PASS | Redis pytest. No call to Microsoft |
| 2 | SLIOps authentication and permission resolution | PASS | Employee session cookie reached hub routes; admin-only template list returned 200 for the admin fixture and the queue stayed a summary for a different employee |
| 3 | Logout initiated from SLIOps | PASS | Cross-site GET 403. Same-origin POST 302 with `signed_out=1`. Old cookie then 401. New cookie 200 |
| 4 | Logout initiated through AuthBridge | PASS on disposable Redis. Live gateway BLOCKED | POST `/logout` then verify and me return 401 |
| 5 | Redis-backed JWT revocation on every verification path | PASS for AuthBridge `/session/verify` and `/session/me`. SLIOps shared cutoff is Postgres, not AuthBridge Redis | See deployment identity. `SLIOPS_SESSION_REVOCATION_STORE=redis` was not pointed at this Redis |
| 6 | Replay of a revoked token | PASS | Both apps denied the presented token and accepted a later token |
| 7 | Requester versus assigned approver | PASS | Requester complete 403. Assignee complete 200 |
| 8 | Signature-required workflow steps | PASS | Stored `requires_signature` and self-complete 403 |
| 9 | Protected workflow PATCH fields | PASS | `status` PATCH 400 and the row stayed `waiting`. `instructions` PATCH 200 |
| 10 | Forged requester and status | PASS | Stored requester is the session email, status `submitted`, MaintainX id empty, step `waiting` |
| 11 | Queue and action-required field restriction | PASS | Other employee received `access=summary` |
| 12 | Notification recipient | PASS | Other employee 404 without the message. Owner 200 |
| 13 | Historical and new archive XSS | PASS on the postgres-only memory stub | New HTML stored without `script` or `onerror`. Historical raw markup still in storage and sanitized on GET |
| 14 | Duplicate form submissions | PASS | Identical roll-off bodies shared one id. A changed body did not |
| 15 | SWP create and archive delete | PASS on the memory stub | Create 200, creator delete 200, later GET 404, `archive.delete` audit |
| 16 | Binary PUT and file type | PASS for the type gate with `fetch` mocked. Live MaintainX BLOCKED | `application/x-msdownload` 415 and no upstream call. JPEG reached the mock once and returned 200 |
| 17 | Request timeline | PASS after `bb4cc8c` | Owner 200. Other employee 403. Non-UUID id 404 with no `22P02` |

## Defects found and fixed in this pass

- Request timeline returned 500 after a completed step because audit rows expose `action`, not `event_type`. `api/lib/hub/routes.js` now uses whichever name is present.
- A new employee session on a process that had not seen the logout could be signed at or before the shared cutoff. Login, sliding `/me`, AuthBridge callback, Entra callback, SSO ACS, and staging test login call `primeIssuer` before `issueSession`.

Those fixes are SLIOps `bb4cc8cfc9a7cc55d9be4282765109280520e002`. The Redis test is AuthBridge `7bdbca15bf181a8cb6503785ebe0fa0887d6ecea`.
