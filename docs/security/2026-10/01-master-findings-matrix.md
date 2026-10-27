# Master findings matrix — October 2026

Statuses mean only what they say.

- **source-verified**: the vulnerable behavior is visible in the pre-fix local code and matches a report.
- **fixed-in-code**: a local commit changes that behavior. Not deployed.
- **local-test-passed**: a local test named here passed on 2026-10-26.
- **deployed**: UNKNOWN unless noted. Nothing in this pass was deployed.
- **rePen verified**: not retested by Strix after these commits. Prior report status is historical.
- **BLOCKED** is not fixed.

The four reports are not additive. `_3` is the 56-item retest. `_4` is the earlier unauthenticated pass. `_1` and `_2` are later authenticated passes. Baseline titles that are not written in the report text are **baseline metadata unavailable**.

Report files: `.security-assessment/reports/strix-report-operations-streamlinescada-com_{1,2,3,4}.txt`. Page numbers refer to those PDFs.

## Conflicts kept separate

| Topic | Earlier | Later | How this pass treats it |
| --- | --- | --- | --- |
| Open redirect | `_4` vuln-0004, 2026-10-22 17:46–19:04 UTC, p.4–5 | `_3` STR-A13, same day 20:15–21:48 UTC, p.3: backslash-userinfo was re-emitted percent-encoded and Chromium stayed on the trusted host | Candidate fixed between windows. Local `is_safe_redirect` now rejects backslash, userinfo, and non-ASCII. Not closed on the live host |
| XSS vs escaped fields | Ordinary fields escaped (`_3` regression, `_2` p.4) | `_1` F-01 / `_3` STR-W03: `renderedHtml` still executed, including historical records | Both true. Tests cover the snapshot path, not only field escaping |
| Spoof plus self-approval | `_1` p.5 suggested the chain and did not run it | `_2` p.4 ran it and refuted it: spoofing transfers requester authority, so the creator then receives 403 | Findings stay independent. The chain is **not confirmed** |

## Authenticated and gateway findings that this pass changed in code

| ID | Issue | Module | First / last seen | Code status | Local test | Deployed | rePen |
| --- | --- | --- | --- | --- | --- | --- | --- |
| STR-W03 / `_1` F-01 / `_3` vuln-0009 | Stored XSS via `data.renderedHtml` on JSA/BOL, including historical rows | SLIOps `api/lib/html-sanitize.js`, `api/maintainx.js`, `index.html` | `_3` 2026-10-22; `_1` 2026-10-23 p.5 | fixed-in-code `9b459e5` | `security:october-2026-remediation-test` PASS | NOT DEPLOYED | historical fail |
| STR-S05 / `_1` F-03 / `_2` vuln-0001 | Requester completes another user's review or signature step | `api/lib/hub/authorization.js`, `routes.js` | `_3` and `_1` 2026-10-23 p.5; `_2` p.4 | fixed-in-code `9b459e5` | same test PASS | NOT DEPLOYED | historical fail |
| STR-S06 / `_3` vuln-0005 | Workflow PATCH accepts status, completed_by, assignee, completed_at | same | `_3` p.3 | fixed-in-code `9b459e5` | same test PASS | NOT DEPLOYED | historical fail |
| STR-W07 / `_1` F-02 / `_2` vuln-0002 (identity half) | Client `requester_email` / status / maintainx / archive ids on create | `authorization.js`, `bridge.js`, `maintainx.js` `saveRequestArchive` | `_3`, `_1` p.5, `_2` p.4 | fixed-in-code `9b459e5` | same test PASS | NOT DEPLOYED | historical fail |
| `_2` vuln-0003 | Queue and action-required return full bodies when detail is 403 | `projectQueueRecord` | `_2` 2026-10-23 p.4 | fixed-in-code `9b459e5` | same test PASS | NOT DEPLOYED | historical fail |
| STR-W08 / `_1` F-06 / `_2` vuln-0002 (notification half) | Mark-read returns another user's notification | `postgres.js` `markNotificationRead`, `routes.js` | `_3` p.3 (update half already fixed); `_1` p.6 | fixed-in-code `9b459e5` | route returns 404 when the store returns null; postgres no longer selects by id alone. Cross-account DB test BLOCKED (no disposable database in this run) | NOT DEPLOYED | historical fail |
| STR-W05 / `_1` F-05 / `_3` vuln-0010 | Pre-logout token still accepted | SLIOps `session-revocation.js`; AuthBridge `oidc.py` `revoke_token(jti)` `e05b2fc` | `_3` p.3; `_1` p.5 | fixed-in-code for the employee HMAC session in-process, and for AuthBridge jti revocation on logout | SLIOps revocation PASS. AuthBridge store integration against Redis BLOCKED | NOT DEPLOYED | historical fail |
| STR-A15 / `_1` F-04 / `_4` vuln-0005 | GET logout is CSRF | `logout-csrf.js`; AuthBridge `logout_request_allowed` | `_4` p.4; `_3`; `_1` p.2 | fixed-in-code | both local tests PASS | NOT DEPLOYED | historical fail |
| STR-W06 | Identical roll-off/swap creates duplicate rows | `archive-idempotency.js` | `_3` p.6 | fixed-in-code for same actor + canonical body (2 min) or explicit key (24h) | PASS | NOT DEPLOYED | historical fail |
| STR-A13 / `_4` vuln-0004 | Redirect parser differential | AuthBridge `is_safe_redirect` | `_4` fail; `_3` held | fixed-in-code and retested locally. Live state UNKNOWN | pytest PASS | NOT DEPLOYED | `_3` held; `_4` failed. Not retested live |
| `_4` vuln-0001 / docs | Unauthenticated `/docs`, `/redoc`, `/openapi.json` | `main.py` docs off unless `AUTHBRIDGE_EXPOSE_DOCS` | `_4` p.5 | fixed-in-code `e05b2fc` | pytest PASS | NOT DEPLOYED | historical fail |
| `_4` vuln-0003 | Nil tenant GUID in Ignition metadata | `ignition.py` `public_metadata_tenant` | `_4` p.4 | fixed-in-code. Real tenant id is not written into git | pytest PASS | NOT DEPLOYED | historical fail |
| STR-A19 | Non-ASCII admin key HTTP 500 | `admin.py` byte compare | `_3` p.3 | fixed-in-code | pytest PASS | NOT DEPLOYED | historical fail |
| STR-A17 | app_id error text distinguishes unknown vs inactive | `get_active_app` generic detail | `_3` p.3 | fixed-in-code for the message. A registered app still redirects, so existence remains observable | constant asserted in pytest | NOT DEPLOYED | historical fail |
| `_3` vuln-0011 | PostgreSQL `22P02` on bad hub ids | `postgres.js` `isUuid`, hub catch drops `err.message` | `_3` p.5 | fixed-in-code | format gate PASS. Live SQL 22P02 path not executed here | NOT DEPLOYED | historical fail |
| `pipe.zrem is not a function` | SWP create and archive DELETE on the postgres-only Redis stub | `for-dev/redis-client.js` | `_3` p.3; `_2` p.3 | fixed-in-code | pipeline test PASS | NOT DEPLOYED | n/a (defect) |
| PUT passthrough HTTP 500 | `readRawBody` listened on an already-buffered request | `maintainx-upload.js` | `_2` p.5 | fixed-in-code. Upstream MaintainX was not called | body and type/size tests PASS | NOT DEPLOYED | n/a (defect) |
| STR-A20 | Security headers missing on gateway responses; CSP absent | Node `server-core.js`; AuthBridge middleware; nginx examples | `_3` p.4 partial | fixed-in-code for app responses and example nginx. Deployed nginx UNKNOWN. CSP does not set `script-src` | staging-hardening still PASS; AuthBridge health header PASS | NOT DEPLOYED | partial |
| `_4` vuln-0002 | HSTS / Secure cookie / HTTP redirect | Node already set HSTS when `NODE_ENV` is staging or production. Nginx examples now set HSTS without `includeSubDomains` on the operations vhost | `_4` p.4 | example config updated. Live headers UNKNOWN | not probed live | NOT DEPLOYED | historical fail |

## 56-baseline rollup from `_3` (p.2–4)

| Group | Report status on 2026-10-22 | This pass |
| --- | --- | --- |
| STR-W01 | Partially fixed. File exposure verified closed. `SESSION_SECRET` and `ENTRA_CLIENT_SECRET` rotation evidence outstanding | BLOCKED on rotation evidence. Do not treat as fixed |
| STR-S01 | Fixed. Forged `x-vercel-*` ignored | unchanged; not re-probed live |
| STR-A01, STR-A16 | Fixed. Bound session rejects mismatched X-Forwarded-For | unchanged; not re-probed live |
| STR-A14 | Fixed. Host headers do not enter redirects | unchanged; not re-probed live |
| STR-W04 | BLOCKED. Need `CLEANUP_SECRET` fail-closed evidence from the host | still BLOCKED. Code fail-closed behavior was not re-run in this pass |
| STR-A02–A10, A18, A21 | BLOCKED. Adapter and gateway internals need configuration review | still BLOCKED |
| STR-S02, S04, S11, W02, S10 | BLOCKED. Need vendor/admin accounts or an enabled org SAML app | still BLOCKED |
| STR-D01–D16 | BLOCKED. Need image SBOM / lock evidence | see `05-dependency-and-PHP-Node-exposure.md`. Not closed |
| One baseline item | Not reproduced / inconclusive. The report text does not name the id | baseline metadata unavailable |
| Remaining baseline ids inside W01–W08, S01–S11, A01–A21, D01–D16 | 38 blocked plus the items named above. Individual titles, CVSS, and endpoints are **baseline metadata unavailable** where the PDF narrative does not state them | do not invent closure |

`_3` totals: 5 fixed-verified, 2 partially fixed, 10 still vulnerable, 1 inconclusive, 38 blocked. Those 10 are the rows marked historical fail above (W03, W05, W06, W07, W08 response, S05, S06, A15, A17, A19).

## Explicit non-findings kept

`_2` tested the spoof-then-self-approve chain and refuted it (p.4). This pass does not report that chain as confirmed. Each flaw remains independently addressed.
