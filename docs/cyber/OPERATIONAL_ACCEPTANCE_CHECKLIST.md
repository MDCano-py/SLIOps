# Operational Acceptance Checklist — Staging (WOS-89)

**Legend:** `PASS` | `FAIL` | `BLOCKED` | `PENDING_LIVE` (requires EC2 browser/API verification)  
**Note:** Repository automated suites are readiness checks only — **not** a penetration test.

Staging URL: `https://automation.streamlinescada.com/ops-hub-staging/`

---

## A. Platform / deploy

| # | Item | Status | Notes |
|---|------|--------|-------|
| A1 | EC2 + Nginx `/ops-hub-staging/` proxy config in repo | PASS | `deploy/nginx/ops-hub-staging.conf` |
| A2 | PM2 ecosystem (`ops-hub-staging` + worker) | PASS | `deploy/ecosystem.config.cjs` |
| A3 | `.env.staging.example` complete (CORS, Postgres, S3, MaintainX) | PASS | |
| A4 | Live EC2 `git pull` + `npm ci` + `pm2 restart` on latest main | PENDING_LIVE | Operator |
| A5 | `npm run db:migrate` on staging RDS | PENDING_LIVE | Includes `012_staging_test_users.sql` |
| A6 | `npm run db:seed-staging-test-users` idempotent | PENDING_LIVE | Eight personas |
| A7 | `/health` ok; postgres store; SSO enforcement on | PENDING_LIVE | |
| A8 | `ALLOWED_ORIGIN=https://automation.streamlinescada.com` | PENDING_LIVE | No path |

## B. Authentication & session

| # | Item | Status | Notes |
|---|------|--------|-------|
| B1 | Staging test login or Entra login works over HTTPS | PENDING_LIVE | |
| B2 | Session cookie HttpOnly / Secure / SameSite=Lax | PASS | Automated auth tests |
| B3 | Portal top-right Sign out clears session | PASS (code) / PENDING_LIVE | Shared `portalSignOut` |
| B4 | Hub account menu Sign out same flow | PASS (code) / PENDING_LIVE | |
| B5 | After sign-out, protected APIs return 401; Back does not restore usable auth | PENDING_LIVE | Cache-Control no-store on logout |
| B6 | `/api/auth/dev-login` disabled on staging | PASS | Automated |

## C. RBAC / roles

| # | Item | Status | Notes |
|---|------|--------|-------|
| C1 | Eight seeded roles present in catalog | PASS | `staging-test-users.js` |
| C2 | Role-by-role nav/API matrix documented | PASS | `ROLE_TEST_MATRIX.md` |
| C3 | Live role walkthrough (all 8) | PENDING_LIVE | |
| C4 | Field tech / client / vendor denied management-sensitive APIs | PASS (suite) / PENDING_LIVE | |

## D. Business workflows (non-S3)

| # | Item | Status | Notes |
|---|------|--------|-------|
| D1 | Form create / submit | PENDING_LIVE | |
| D2 | Review / approval steps | PENDING_LIVE | |
| D3 | Signature / acknowledgment | PENDING_LIVE | |
| D4 | Request create + status change | PENDING_LIVE | |
| D5 | Workflow assignment | PENDING_LIVE | |
| D6 | Archives browse / open | PENDING_LIVE | |
| D7 | Dashboards / reports load | PENDING_LIVE | Export/trends may be limited |
| D8 | Audit history visible where implemented | PENDING_LIVE | |
| D9 | Notifications / action routing | PENDING_LIVE | Email may be log-only |

## E. UI polish / modes

| # | Item | Status | Notes |
|---|------|--------|-------|
| E1 | Misleading “SSO not yet enabled” banner fixed | PASS | Hidden for real sessions |
| E2 | PSSR dead nav removed | PASS | |
| E3 | Demo seed default off; toggle only when staging demo allowed | PASS | |
| E4 | Light / dark mode toggle | PENDING_LIVE | |
| E5 | Responsive / loading / empty / validation | PENDING_LIVE | |
| E6 | No Vercel Blob architecture copy in staging deploy doc | PASS | |

## F. Integrations

| # | Item | Status | Notes |
|---|------|--------|-------|
| F1 | MaintainX shows Not configured without key | PASS (code) / PENDING_LIVE | No secret leak |
| F2 | Missing S3 does not crash unrelated hub/forms | PASS (code) / PENDING_LIVE | Doc ops → 503 STORAGE_NOT_CONFIGURED |
| F3 | Object storage health fields on `/health` | PASS (code) | |

## G. Object storage (S3)

| # | Item | Status | Notes |
|---|------|--------|-------|
| G1 | Parts photo upload/retrieval | **BLOCKED — WAITING FOR S3** | |
| G2 | Vendor doc upload/preview/download/replace/delete | **BLOCKED — WAITING FOR S3** | |
| G3 | Cross-user / cross-request key isolation | **BLOCKED — WAITING FOR S3** | |
| G4 | Modified key / record ID denial | **BLOCKED — WAITING FOR S3** | |
| G5 | File type/size validation (unit) | PASS | `security:object-storage-test` |
| G6 | Missing IAM / outage behavior (live S3) | **BLOCKED — WAITING FOR S3** | |
| G7 | Storage audit events (live) | **BLOCKED — WAITING FOR S3** | |

## H. Pre-handoff automated readiness (not pentest)

| Suite | Result |
|-------|--------|
| `security:staging-launch-readiness-test` | (run in WOS-89) |
| `security:staging-readiness-test` | |
| `security:staging-hardening-test` | |
| `security:staging-test-login-test` | |
| `security:object-storage-test` | |
| `security:rbac-authz-test` | |
| `security:no-origin-auth-gate-test` | |
| `security:secret-scan` | |

---

**Cyber handoff decision gate**

- [ ] All critical **non-S3** `PENDING_LIVE` items verified PASS on HTTPS staging  
- [ ] S3 either verified PASS **or** Cyber explicitly accepts “operational except object-storage”  
- [ ] Secrets shared out of band  
- [ ] Stop-testing contacts filled in `CYBER_PENTEST_HANDOFF.md`  
