# Test results — 2026-10-21 release candidate

**When:** 2026-10-20  
**Where:** developer workstation after `npm ci` (96 packages). `package.json` engines ask for Node 20.x. This machine ran Node v24.18.0. Local Postgres is `127.0.0.1` from `.env.local.postgres`.  
**Deployed host:** not tested. HTTPS to `https://automation.streamlinescada.com/ops-hub-staging/` timed out at 20s on `/`, `/.env`, `/.git/HEAD`, `/package.json`, and `/api/maintainx` (curl exit 28, HTTP status 000).

## Passed

| Command | Result |
| --- | --- |
| `npm run security:release-2026-10-21-test` | 78 passed, 0 failed. Includes migration `018`, OTP enumeration, hash storage, attempt increment, single-use replay, expiry, disabled contact, vendor A/B denial, employee cookie denied, scoped vendor read. |
| `npm run security:pentest-emergency-closure-test` | 13 passed, 0 failed |
| `npm run security:gate2-identity-fallback-test` | In-suite after `npm ci`: 15 passed, 1 failed (`tampered JWT rejected` fixture). Direct re-run after the fixture fix: 16 passed, 0 failed. |
| `npm run security:gate2-sso-manage-sso-test` | 16 passed, 0 failed |
| `npm run security:gate2-cleanup-failclosed-test` | 15 passed, 0 failed |
| `npm run security:sensitive-path-probe` | 32 passed, 0 failed. Remote probe skipped. |
| `npm run security:vendor-identity-scr-s05-test` | 28 passed, 0 failed |
| `npm run security:submission-idor-test` | 8 passed, 0 failed |
| `npm run security:wos98-vendor-contract-automation-test` | 9 passed, 0 failed |
| `npm run templates:new-request-registry-test` | 62 passed, 0 failed. Fixture is `Daily Safety Walkthrough`. `NR Published Form` stays filtered. |
| `npm run perf:vendor-scope-bench` | Completed. Numbers are in `PERFORMANCE.md`. |

## Local regression after `npm ci`

`node scripts/deploy/run-local-regression.js` ran 61 scripts. 60 passed. `security:gate2-identity-fallback-test` failed once because `sig.replace(/./, 'A')` leaves a signature unchanged when it already starts with `A`. The verifier was not weakened. The fixture now flips one character, and the direct re-run passed. The other 60 scripts were not repeated after that one-line test change.

## Not run against staging

Sensitive-file probe, authentication, Work Order, document, Control Room, S3, and MaintainX smoke tests. The host timed out before any HTTP status.

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
