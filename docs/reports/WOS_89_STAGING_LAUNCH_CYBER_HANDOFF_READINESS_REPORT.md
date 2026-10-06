# WOS-89 — Staging Launch and Cybersecurity Pentest Handoff Readiness

**Card:** WOS-89  
**Audience:** Streamline engineering + Cybersecurity (external)  
**Commit:** see `git rev-parse HEAD` on `main` after deploy (`WOS-89` commit message)  
**Staging URL:** `https://automation.streamlinescada.com/ops-hub-staging/`

> Automated suites in this card are **pre-handoff readiness checks only**.  
> They are **not** a penetration test. Cyber conducts the independent pentest on live HTTPS staging.

---

## 1. Summary

Prepared the staging handoff package and fixed staging-facing polish issues that would confuse Cyber. Confirmed repository deploy templates, seed catalog, auth/logout design, MaintainX “not configured” behavior, and S3 failure isolation. Live EC2 browser walkthroughs remain **PENDING_LIVE** for operators. Object-storage binary workflows remain **BLOCKED — WAITING FOR S3**.

**Posture if S3 unset:** operational except for documented object-storage features — Cyber must explicitly accept that limitation before starting, or wait for S3 verification.

---

## 2. Files changed

| Path | Change |
|------|--------|
| `index.html` | Fix SSO banner; remove PSSR nav; redirect PSSR; remove fake ⌘K |
| `hub.js` | Management subtitle; demo-seed toggle only when allowed; hint copy |
| `api/lib/hub/portal-settings.js` | `demoSeedEnabled` default **false** (explicit opt-in) |
| `DEPLOYMENT_STAGING.md` | Architecture: Amazon S3 (not Vercel Blob) |
| `docs/cyber/CYBER_PENTEST_HANDOFF.md` | Cyber handoff package |
| `docs/cyber/OPERATIONAL_ACCEPTANCE_CHECKLIST.md` | PASS/FAIL/BLOCKED checklist |
| `docs/cyber/ROLE_TEST_MATRIX.md` | Role matrix |
| `docs/cyber/S3_DEFERRED_CHECKLIST.md` | S3 deferred verification |
| `docs/reports/WOS_89_…_REPORT.md` | This report |
| `scripts/security/staging-launch-readiness-test.js` | Repo readiness suite (not pentest) |
| `scripts/settings/settings-ui-test.js` | Align demoSeed restore semantics |
| `package.json` | `security:staging-launch-readiness-test` |

---

## 3. Staging configuration (expected)

| Layer | Config |
|-------|--------|
| URL | `https://automation.streamlinescada.com/ops-hub-staging/` |
| Nginx | `deploy/nginx/ops-hub-staging.conf` → `127.0.0.1:3010` |
| PM2 | `ops-hub-staging` + `ops-hub-staging-worker` |
| DB | RDS PostgreSQL, `HUB_STORE_MODE=postgres` |
| CORS | `ALLOWED_ORIGIN=https://automation.streamlinescada.com` |
| Auth | Entra and/or staging test login; `SSO_ENFORCEMENT=on`; no dev-login |
| Demo | `STAGING_DEMO_DATA_ENABLED=0` for Cyber |
| S3 | `STORAGE_DRIVER=s3` + `S3_BUCKET` when ready |
| MaintainX | `MAINTAINX_API_KEY` empty → Not configured |

### Operator commands (EC2)

```bash
cd /var/www/ops-hub-staging
git pull origin main
npm ci --omit=dev
npm run db:migrate
npm run db:seed-staging-test-users
pm2 restart ops-hub-staging ops-hub-staging-worker
curl -s http://127.0.0.1:3010/health | jq '{ok, hub_store_mode, object_storage_configured, maintainx_configured, staging_test_login_enabled, staging_demo_data_enabled}'
```

---

## 4. Test accounts

Eight idempotent personas — see `docs/cyber/CYBER_PENTEST_HANDOFF.md` and `ROLE_TEST_MATRIX.md`.  
Share `STAGING_TEST_LOGIN_SECRET` out of band only.

---

## 5. Acceptance / blockers

Full checklist: `docs/cyber/OPERATIONAL_ACCEPTANCE_CHECKLIST.md`.

| Critical blockers for “fully ready” | Status |
|-------------------------------------|--------|
| Live EC2 migrate + seed + health | PENDING_LIVE |
| Live HTTPS auth + both sign-outs + post-logout denial | PENDING_LIVE |
| Live role walkthrough (8 personas) | PENDING_LIVE |
| Live E2E business workflows | PENDING_LIVE |
| S3 vendor docs / photos | **BLOCKED — WAITING FOR S3** |
| MaintainX sync | Not configured (safe) until key set |
| Management paper form (WOS-87) | Blocked pending form assets |

---

## 6. Pre-handoff automated readiness results

*(Filled after local run — not a pentest.)*

| Command | Result |
|---------|--------|
| `npm run security:staging-launch-readiness-test` | **38/38 PASS** |
| `npm run security:staging-readiness-test` | **49/49 PASS** |
| `npm run security:staging-hardening-test` | **34/34 PASS** |
| `npm run security:staging-test-login-test` | **45/45 PASS** |
| `npm run security:postgres-only-staging-health-test` | **26/26 PASS** |
| `npm run security:object-storage-test` | **35/35 PASS** |
| `npm run security:rbac-authz-test` | **23/23 PASS** |
| `npm run security:no-origin-auth-gate-test` | **10/10 PASS** |
| `npm run security:legacy-route-rbac-test` | **16/16 PASS** |
| `npm run security:secret-scan` | **PASS** |

---

## 7. Cyber handoff package location

Primary: **`docs/cyber/CYBER_PENTEST_HANDOFF.md`**

Supporting:

- `docs/cyber/OPERATIONAL_ACCEPTANCE_CHECKLIST.md`
- `docs/cyber/ROLE_TEST_MATRIX.md`
- `docs/cyber/S3_DEFERRED_CHECKLIST.md`

---

## 8. Remaining “Vercel” notes

Runtime Blob dependency removed in WOS-88. Remaining mentions are historical reports, optional `vercel.json` reference (unused on EC2), or non-deployed CORS preview helpers. Staging architecture doc now lists Amazon S3.

---

## 9. Recommendation

1. Operators complete all `PENDING_LIVE` non-S3 checklist rows on HTTPS staging.  
2. Configure S3 and clear `docs/cyber/S3_DEFERRED_CHECKLIST.md`, **or** obtain Cyber’s written acceptance of the S3 limitation.  
3. Only then declare staging **fully** ready for the penetration test.  
