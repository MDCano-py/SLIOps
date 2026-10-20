# Feature parity — 2026-10-21 release candidate

**Verification date:** 2026-10-20 (local repository and local Postgres)  
**Live staging click-through:** not performed

## Preserved on purpose

| Capability | Evidence in this session | Live host |
| --- | --- | --- |
| Operational Work Order launch card | `security:release-2026-10-21-test` asserts a single `work_order` card with `render_mode=custom` when a configurable twin exists | Not exercised in a browser |
| Magic-link vendor invite consume, replay, expiry, revoke | `security:vendor-identity-scr-s05-test`: 28 passed, 0 failed | Not exercised |
| Vendor workspace company isolation | Same test, plus release test vendor B denied vendor A `ref` (403) | Not exercised |
| Employee SSO session still resolves | Gate 2 identity fallback: 16 passed, 0 failed | Not exercised |
| `manage_sso` required to write SSO trust | `security:gate2-sso-manage-sso-test`: 16 passed, 0 failed | Not exercised |
| Cleanup endpoints fail closed without `CLEANUP_SECRET` | `security:gate2-cleanup-failclosed-test`: 15 passed, 0 failed | Not exercised |
| Submission IDOR denial for a second user | `security:submission-idor-test`: 8 passed, 0 failed | Not exercised |
| Sensitive static paths 404 on a local probe server | `security:sensitive-path-probe`: 32 passed, 0 failed. Remote probe skipped (`PROBE_BASE_URL` unset) | Not probed |
| Repair NDA wiring API | `security:wos98-vendor-contract-automation-test`: 9 passed, 0 failed. Button source remains a POST and is rendered only when the page URL contains `diagnostics=1` | Not clicked |
| Legacy document types still registered | `templates:new-request-registry-test` passed the legacy type assertions for Work Order, Parts, Equipment, BOL, JSA, SWP, document review/signature, general request | Not clicked |

## New behavior covered by tests

- Vendor email verification code request returns the same JSON for an unknown email, a known contact, and an email that matches two vendors.
- A known contact stores only `code_hash` / `code_salt`.
- Wrong codes increment `attempt_count`. The correct code sets an HttpOnly `sliops_vendor_session`. Reuse returns 401 `invalid_code`.
- Expired codes and disabled contacts are rejected.
- An employee `sliops_session` cookie does not open `/vendor/workspace`.
- A vendor JWT copied into `sliops_session` does not yield an employee actor.

## Not verified

Module navigation for Dashboard, Request Queue, New Request, My Work, Work Orders, Parts and Equipment, Documents, Vendor Management, Control Room, Insights, and Administration was not clicked through in a browser. No browser tool was available in this session.

`templates:new-request-registry-test` finished **58 passed, 1 failed**. The failure is `published form appears as New Request card`. `publishedFormsFromRegistry` drops labels matching `/^nr\s*published\s*form$/i`, and that test publishes a form named `NR Published Form`. That filter was already in `hub-new-request-registry.js` before this release. The test's earlier merge and grouping assertions passed. This is an outstanding product-test mismatch, not a Work Order regression.

MaintainX synchronization, document Fill/Review/Sign, NDA/MSA signature completion, notification delivery, and S3 upload/download were not executed against external services in this session.

## Rollback of product behavior

- Vendor OTP is additive. Magic links still call `/vendor/auth/consume`.
- Dropping migration `018`'s table removes code login only after the application build that references it is rolled back. See `DEPLOYMENT.md`.
- Configurable `work_order` definitions remain in configuration storage. Only the duplicate New Request card is suppressed while a legacy `work_order` card exists.
