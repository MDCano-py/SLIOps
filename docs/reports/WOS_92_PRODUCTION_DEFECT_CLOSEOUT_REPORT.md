# WOS-92 — Production Defect Closeout Before Cybersecurity Testing

**Branch:** `wos-92-production-defect-closeout`  
**Staging URL (configured):** `https://automation.streamlinescada.com/ops-hub-staging/`  
**Note:** Automated suites below are readiness/regression checks — **not** a penetration test. Cyber performs the independent pentest on live HTTPS staging.

---

## 1. Executive summary

Corrected confirmed production defects that would block demo, UAT, or Cyber testing: broken Admin Start Center “Admin setup” / “Start here” navigation, incomplete post-logout BFCache handling, misleading integration copy (user-facing `n8n`), incomplete Integrations status (missing S3), and unclear vendor-upload errors when S3 is absent. Workflow/archive/RBAC server protections were reviewed and found already enforced; no security controls were weakened. Suitable for Cyber testing **without S3** once live EC2 smoke confirms, with S3 features remaining explicitly deferred.

---

## 2. Defects identified

| ID | Defect | Severity |
|----|--------|----------|
| D1 | Start Center top cards “Admin setup” and “Start here” scrolled to non-existent section IDs → silent no-op | High (reported nonfunctional Admin Setup) |
| D2 | After Sign Out, browser Back could restore BFCached authenticated UI shell | Medium |
| D3 | Settings Integrations card said “n8n” instead of Automation | Low (production language) |
| D4 | Management Integrations grid omitted `object_storage` / S3 status | Medium |
| D5 | Vendor document upload error did not explain missing S3 clearly | Medium |
| D6 | System health panel omitted MaintainX / object-storage honesty | Low |

---

## 3. Root causes

- **D1:** `TOP_CARDS[].id` values (`sc-admin-setup`, `sc-start-here`) did not match section element IDs (`sc-admin-setup-flow`, `sc-overview`).
- **D2:** Logout cleared cookies and used full navigation, but no `pageshow` / BFCache guard re-checked signed-out state.
- **D3–D6:** UI copy and integrations/health panels were incomplete after S3 cutover (WOS-88).

---

## 4. Files changed

- `hub-start-center.js` — fix Admin setup / Start here scroll targets
- `index.html` — BFCache sign-out guard; integrations UI; S3 upload message; Automation copy; clear signed-out on `/me`
- `hub.js` — health panel MaintainX + object storage status
- `hub.css` — integrations message styling
- `api/maintainx.js` — Automation delivery label
- `scripts/templates/start-center-admin-help-test.js` — assert matching scroll IDs
- `scripts/security/production-defect-closeout-test.js` — new WOS-92 regression suite
- `package.json` — `security:production-defect-closeout-test`
- `docs/reports/WOS_92_PRODUCTION_DEFECT_CLOSEOUT_REPORT.md` — this report

---

## 5. Behavior before → after

| Area | Before | After |
|------|--------|-------|
| Admin Setup card | Click did nothing | Scrolls to Admin setup accordion inside Start Center |
| Start here card | Click did nothing | Scrolls to Overview |
| Sign out + Back | Possible BFCache restore of shell | Marker + `pageshow` forces login navigation |
| Integrations UI | No S3 card; said n8n | Shows object storage + Automation wording; not-configured messages |
| Vendor upload without S3 | Generic error | Clear “Amazon S3 not configured” message |
| Health | Postgres only | Also MaintainX + object storage Not configured / Configured |

---

## 6. Roles tested

Catalog / automated RBAC coverage for staging personas (server-side):

| Role | Server RBAC suite | Notes |
|------|-------------------|-------|
| Hub Admin | PASS (`rbac-authz`, workflow-step-authz) | Start Center requires `hub_admin`/`admin` |
| Operations / AP / Legal / Manager / Requester | PASS | Step assignment isolation |
| Field Tech / Client / Vendor | Documented in WOS-89 matrix | Live walkthrough remaining on EC2 |
| Unauthorized Start Center | Code gate + RBAC rules | Non-admin denied |

Live eight-persona browser matrix remains an EC2 operator checklist item (`docs/cyber/ROLE_TEST_MATRIX.md`).

---

## 7. Workflow tested

Representative flow `Create → Fill → Review → Sign → Complete → Archive → Restore`:

- **Code review:** Double-complete blocked (`409` / `STEP_NOT_PENDING`); step role isolation enforced; template delete blocked when submissions exist (`HAS_SUBMISSIONS`).
- **Automated:** `security:workflow-step-authz-test` **12/12 PASS**; `templates:archive-dynamic-forms-test` **36/36 PASS**; `templates:role-lifecycle-guardrails-test` **33/33 PASS**.
- **Live E2E on HTTPS staging:** PENDING operator smoke (this environment has no RDS credentials).

No workflow-engine code defect requiring a code change was confirmed beyond the UI/navigation/integrations defects fixed above.

---

## 8. Archive and restore results

| Check | Result |
|-------|--------|
| Forms submissions archive list auth (401 unauthenticated) | PASS (archive-dynamic-forms-test) |
| Legacy archive view/delete permission maps | PASS (legacy-route-rbac-test) |
| Role deactivate/restore/reference checks | PASS (role-lifecycle-guardrails-test) |
| Template delete with submissions | Refused (`HAS_SUBMISSIONS`) — code present |
| Live archive→restore on staging data | PENDING_LIVE |

---

## 9. RDS persistence results

| Check | Result |
|-------|--------|
| `HUB_STORE_MODE=postgres` requires `DATABASE_URL` | PASS (config assert + hardening tests) |
| Staging/production refuse silent local JSON fallback | PASS (postgres-only + redis-client commentary/tests) |
| Create record → restart → still present | PENDING_LIVE (needs EC2 + RDS) |

**Do not** reset RDS for this card.

---

## 10. Optional-integration behavior

| Integration | Absent behavior |
|-------------|-----------------|
| Amazon S3 | App starts; doc upload returns 503 `STORAGE_NOT_CONFIGURED`; UI message clear; Integrations shows Not configured |
| MaintainX | Proxy misconfigured error; Integrations/Health Not configured; no secret leak |
| Automation webhooks | Status Not configured when webhooks unset; labeled Automation delivery |

Core forms / hub / RBAC remain usable without S3.

---

## 11. Automated tests executed

| Command | Result |
|---------|--------|
| `node --check` hub-start-center.js, hub.js, maintainx.js, portal-settings, WOS-92 test | PASS |
| `npm run security:production-defect-closeout-test` | **27/27 PASS** |
| `npm run templates:start-center-admin-help-test` | **46/46 PASS** |
| `npm run security:staging-readiness-test` | **49/49 PASS** |
| `npm run security:staging-hardening-test` | **34/34 PASS** |
| `npm run security:staging-test-login-test` | PASS |
| `npm run security:postgres-only-staging-health-test` | PASS |
| `npm run security:staging-launch-readiness-test` | PASS |
| `npm run security:rbac-authz-test` | **23/23 PASS** |
| `npm run security:workflow-step-authz-test` | **12/12 PASS** |
| `npm run security:no-origin-auth-gate-test` | **10/10 PASS** (includes CSRF Referer checks) |
| `npm run security:object-storage-test` | **35/35 PASS** |
| `npm run security:legacy-route-rbac-test` | **16/16 PASS** |
| `npm run security:secret-scan` | **PASS** |
| `npm run templates:role-lifecycle-guardrails-test` | **33/33 PASS** |
| `npm run templates:archive-dynamic-forms-test` | **36/36 PASS** |

---

## 12. Manual tests executed

| Item | Result |
|------|--------|
| Login / Dashboard / New Request / My Tasks / Fill / Review / Sign / Archive / Restore on live staging HTTPS | **Not executed here** (no EC2 session from this agent environment) — **PENDING_LIVE** |
| Admin Start Center route wiring (static/module) | PASS via automated Start Center suite |
| Account dropdown + portalSignOut wiring | PASS via WOS-92 + staging-readiness tests |
| Sign-out session clear (unit) | PASS (`logout` cookie Max-Age=0 in staging-readiness) |
| Direct `#/start-center` mapping | PASS (parseHash / buildHash tests) |

---

## 13. Remaining known limitations

- S3 binary upload/download/ZIP: **BLOCKED — WAITING FOR S3** (see `docs/cyber/S3_DEFERRED_CHECKLIST.md`)
- MaintainX sync inactive until server key set
- Live eight-role browser matrix and full E2E workflow on staging: PENDING_LIVE
- Reports export / Analytics trends remain limited placeholders
- PSSR Management intentionally out of nav (WOS-89)
- Management paper form (WOS-87) still blocked pending assets

---

## 14. Items intentionally deferred

- Historical Vercel Blob object migration (WOS-88 §8)
- Enabling real MaintainX / Resend / n8n webhooks for Cyber window (recommend leave unset unless scoped)
- Full redesign of Integrations UI beyond honesty fixes

---

## 15. Cybersecurity handoff readiness

**Posture:** Development closeout for confirmed defects is complete. Staging is **suitable for Cyber without S3** provided operators confirm HTTPS smoke (`PENDING_LIVE` items) and Cyber explicitly accepts object-storage limitation **or** S3 is configured first.

Handoff pack:

- `docs/cyber/CYBER_PENTEST_HANDOFF.md`
- `docs/cyber/OPERATIONAL_ACCEPTANCE_CHECKLIST.md`
- `docs/cyber/ROLE_TEST_MATRIX.md`
- `docs/cyber/S3_DEFERRED_CHECKLIST.md`

---

## 16. Deployed test URL

`https://automation.streamlinescada.com/ops-hub-staging/`

Verification of this host from the developer workspace was **not** performed in this card (no interactive EC2 session). Operators should `git pull` this branch, restart PM2, and complete the smoke list before Cyber begins.
