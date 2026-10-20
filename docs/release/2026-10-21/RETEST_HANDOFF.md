# Retest handoff — 2026-10-21

**Application:** SLIOps (Operations Workflow Hub)  
**Candidate branch:** `release/sliops-2026-10-21-retest`  
**Base commit:** `fb9a743` (`feature/sliops-ui-refinement`)  
**Prior commit on this branch:** `69d79263b768148ddbaef25e9a913d1725eab4e7` (Nginx API-prefix deny, vendor consume rate limit, root pentest notes)  
**Code through vendor OTP:** `5db548a230280c2c85da2faf75c15787d4963a34`  
**SHA stamp of that work:** `4177f8e6e2e0488d99865a2746b4baf880e4c767`  
**Continuation SHA:** `d66f237d1cf3c9cb1e557c00040ea3b18063e9cf`  
**Decision:** NO-GO. Live verification did not pass.  
**Deployed:** no  
**Production:** unchanged  

On 2026-10-20 this session repeated the HTTPS probe with a 20s timeout. `https://automation.streamlinescada.com/ops-hub-staging/` and four sensitive or API paths all returned curl exit 28 and HTTP status 000. The configured AWS account has no EC2 instances in the six regions checked and no SSH config, so the staging SHA, Nginx, and PM2 were not read. Aurora `rbit-dev-writer` is private and was not queried. Local Postgres `127.0.0.1` has migrations `001`–`018`. That is not evidence about RDS.  

Automated results in this package are local. They are not a penetration test and they are not evidence that `https://automation.streamlinescada.com/ops-hub-staging/` is running this branch.

## Workstream status

| Workstream | Status | Why |
| --- | --- | --- |
| A Architecture consolidation | **INCOMPLETE** | Operational Work Order stays the launch card when a configurable twin exists. Shared facades exist and are not wired through every route. Legacy engines and tables were not replaced. |
| B Security remediation | **BLOCKED** for live closure | Local controls still pass. Critical/High items with no live reproduction and no original report text are not FIXED. See `SECURITY_FINDINGS.md`. |
| C Vendor authentication | **BLOCKED** for live closure | Code login passed on local Postgres. Resend is unset. AuthBridge exemptions were not read from the edge. Staging did not answer HTTPS. |
| D Performance | **INCOMPLETE** | Vendor workspace no longer loads the full registry. Other hotspots were not changed. |
| E UX consistency | **INCOMPLETE** | Repair NDA wiring stays behind `?diagnostics=1`. Modules were not browser-tested. New Request registry test is 62/0. |
| F Integration and regression | **COMPLETE** locally, **BLOCKED** live | `npm ci` plus 61 local scripts: 60 passed, 1 test-fixture failure then fixed (identity JWT tamper). Live personas were not run. |
| G Release engineering | **BLOCKED** | No deploy. No staging SHA. `scripts/deploy/staging-deploy.sh` refuses to run without `STAGING_DEPLOY_AUTHORIZED=yes`. |

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
- New Request: `NR Published Form` remains filtered. The passing fixture is `Daily Safety Walkthrough` (62/0).

## Outstanding before an authorized deploy

- Capture the current EC2 SHA and Nginx config.
- Apply migration `018` only with the matching application build.
- Add AuthBridge exemptions for the two code routes if the live list is explicit.
- Set Resend for vendor codes or accept that codes will not be delivered.
- Run the sensitive-path probe against the HTTPS staging URL.
- Do not deploy to production as part of this retest.

## Commit

`IMPLEMENTATION_SHA: 5db548a230280c2c85da2faf75c15787d4963a34`

There is no deployed SHA. Candidate code is `d66f237d1cf3c9cb1e557c00040ea3b18063e9cf`. A later commit may only record that SHA.
