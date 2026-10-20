# Test results — 2026-10-21 release candidate

**When:** 2026-10-20  
**Where:** developer workstation, existing `node_modules`, local Postgres from `.env.local.postgres` when a test required `DATABASE_URL`  
**Clean `npm ci`:** not run  
**Deployed host:** not tested

## Passed

| Command | Result |
| --- | --- |
| `npm run security:release-2026-10-21-test` | 78 passed, 0 failed. Includes migration `018`, OTP enumeration, hash storage, attempt increment, single-use replay, expiry, disabled contact, vendor A/B denial, employee cookie denied, scoped vendor read. |
| `npm run security:pentest-emergency-closure-test` | 13 passed, 0 failed |
| `npm run security:gate2-identity-fallback-test` | 16 passed, 0 failed |
| `npm run security:gate2-sso-manage-sso-test` | 16 passed, 0 failed |
| `npm run security:gate2-cleanup-failclosed-test` | 15 passed, 0 failed |
| `npm run security:sensitive-path-probe` | 32 passed, 0 failed. Remote probe skipped. |
| `npm run security:vendor-identity-scr-s05-test` | 28 passed, 0 failed |
| `npm run security:submission-idor-test` | 8 passed, 0 failed |
| `npm run security:wos98-vendor-contract-automation-test` | 9 passed, 0 failed |
| `npm run perf:vendor-scope-bench` | Completed. Numbers are in `PERFORMANCE.md`. |

## Failed

| Command | Result |
| --- | --- |
| `npm run templates:new-request-registry-test` | 58 passed, 1 failed. Failure: `published form appears as New Request card`. The fixture name `NR Published Form` matches the existing test-record filter `/^nr\s*published\s*form$/i`. Merge and `groupNewRequestTypes` assertions passed. |

## Dependency audit

`npm audit` on 2026-10-20:

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Moderate | 2 |
| Low | 0 |

Both moderate entries are `uuid` (GHSA-w5hq-g745-h8pq) via `@azure/msal-node`. The advisory's non-breaking fix path is not available; the offered fix is `@azure/msal-node@7.1.0` (semver major). That upgrade was not applied.

## Personas

| Persona | Local automated coverage | Live |
| --- | --- | --- |
| Unauthenticated visitor | Vendor workspace and code verify return 401 without a session. Sensitive-path probe allows only public static files. | Not run |
| Employee session | Gate 2 session cookie tests. Employee cookie cannot open vendor workspace. | Not run |
| Second employee / IDOR | Submission IDOR test denies an unrelated user. | Not run |
| Administrator | SSO `manage_sso` and submission admin inspect checks. | Not run |
| Supervisor | Not executed as a distinct persona in this session. | Not run |
| Vendor A / Vendor B | SCR-S05 and release test isolation. | Not run |
| Revoked / disabled vendor | Disabled contact verify 401. SCR-S05 revoked session fails. | Not run |
| External document action recipient | Not re-executed in this session. | Not run |

Microsoft Entra login, logout against AuthBridge, MaintainX sync, document sign, Control Room operator flows, and administrative configuration were not executed in a browser.
