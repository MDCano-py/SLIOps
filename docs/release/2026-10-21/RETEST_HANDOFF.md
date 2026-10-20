# Retest handoff — 2026-10-21

**Application:** SLIOps (Operations Workflow Hub)  
**Candidate branch:** `release/sliops-2026-10-21-retest`  
**Base commit:** `fb9a743` (`feature/sliops-ui-refinement`)  
**Prior commit on this branch:** `69d79263b768148ddbaef25e9a913d1725eab4e7` (Nginx API-prefix deny, vendor consume rate limit, root pentest notes)  
**Implementation commit:** the tip SHA below, which contains vendor code login, session isolation, and these documents.  
**Deployed:** no  
**Production:** unchanged  

A same-day HTTPS read of `https://automation.streamlinescada.com/ops-hub-staging` recorded in `PENTEST_EMERGENCY_STATUS.md` timed out. This session did not repeat that probe and did not read the EC2 checkout.  

Automated results in this package are local. They are not a penetration test and they are not evidence that `https://automation.streamlinescada.com/ops-hub-staging/` is running this branch.

## Workstream status

| Workstream | Status | Why |
| --- | --- | --- |
| A Architecture consolidation | **INCOMPLETE** | Operational Work Order stays the launch card when a configurable twin exists. Shared facades exist and are not wired through every route. Legacy engines and tables were not replaced. |
| B Security remediation | **IMPLEMENTED, AWAITING LIVE VALIDATION** | Session isolation, vendor scope, OTP abuse controls, SSO write gate, cleanup fail-closed, and local sensitive-path probe passed. Live Nginx, AuthBridge, and the missing BW/STR report IDs are not closed. |
| C Vendor authentication | **IMPLEMENTED, AWAITING LIVE VALIDATION** | Code login, magic link, isolation, and deactivation passed on local Postgres. Real email and the edge exemption were not exercised. |
| D Performance | **INCOMPLETE** | Vendor workspace no longer loads the full registry. Other hotspots were not changed or benchmarked. |
| E UX consistency | **INCOMPLETE** | Repair NDA wiring is off the normal Configuration overview unless `?diagnostics=1`. Primary modules were not browser-tested. |
| F Integration and regression | **IMPLEMENTED, AWAITING LIVE VALIDATION** | Local suites in `TEST_RESULTS.md` passed except one pre-existing New Request fixture failure (58 passed, 1 failed). Clean `npm ci`, Entra login, and cross-persona browser runs were not done. |
| G Release engineering | **BLOCKED** | Branch exists. Deploy is blocked until an explicit authorization. Staging SHA was not captured from the host. |

## What a retest can attack on a host that is actually running this commit

1. Request a vendor code for a real contact and for an unknown address. Bodies must match. The code must arrive only if Resend is configured, expire in 5 minutes, and fail on the second submit.
2. With vendor A's cookie, call workspace `ref` for vendor B. Expect 403. Employee cookie on the same route: 401.
3. Copy the vendor session JWT into `sliops_session`. Employee APIs must not treat it as that vendor's email.
4. Replay a magic-link token and a verification code.
5. Probe `/.env`, `/.git/HEAD`, `/package.json`, and `/api/maintainx.js` over HTTPS. Expect 404 with no body leak. `/api/maintainx` and `/api/auth/*` must still respond as the application, not as a blanket Nginx 404.
6. Confirm `view_management` cannot `PUT` SSO trust and that cleanup routes 503 when `CLEANUP_SECRET` is unset.
7. Confirm AuthBridge still challenges the Hub and that only the vendor paths in `VENDOR_AUTH.md` are exempt.

## Do not treat as fixed on the live host

- SCR-A01, SCR-A02, SCR-A03, SCR-S20, SCR-W01, SCR-W05 until the original report text is mapped and the deployed host is checked.
- Any `STR-*` finding. The package is not in this repo.
- Moderate `uuid` via `@azure/msal-node` (GHSA-w5hq-g745-h8pq). Deferred.
- S3 and MaintainX behavior. Not configured or called in this session.
- The New Request card test failure for a form titled `NR Published Form`.

## Outstanding before an authorized deploy

- Capture the current EC2 SHA and Nginx config.
- Apply migration `018` only with the matching application build.
- Add AuthBridge exemptions for the two code routes if the live list is explicit.
- Set Resend for vendor codes or accept that codes will not be delivered.
- Run the sensitive-path probe against the HTTPS staging URL.
- Do not deploy to production as part of this retest.

## Commit

Code, tests, and these documents are on `release/sliops-2026-10-21-retest`.

`IMPLEMENTATION_SHA: 5db548a230280c2c85da2faf75c15787d4963a34`

That commit's parent is `69d79263b768148ddbaef25e9a913d1725eab4e7`. Use `git rev-parse HEAD` on this branch for the tip if a later commit only records this SHA.
