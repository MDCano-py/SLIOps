# WOS-86 — Staging Production-Readiness Cleanup and Authentication Hardening

## Root causes

1. **Origin not allowed** — Staging CORS required an exact `ALLOWED_ORIGIN` matching the browser origin (`https://automation.streamlinescada.com`, no path). Missing/mismatched values blocked credentialed API calls (demo seed, dashboards stuck on Loading).
2. **Demo tools blocked on staging** — Seed/clear were development-only; staging needed an explicit `STAGING_DEMO_DATA_ENABLED` flag plus admin enforcement.
3. **Vercel UI copy** — User Management told admins to edit env vars “in Vercel”.
4. **Sign out broken** — Management “Sign out” only cleared a client vendor token (`clearMgmtToken`) instead of calling `/api/auth/logout`. Hub topbar had no account menu / confirm flow.
5. **MaintainX** — Already used `MAINTAINX_API_KEY` server-side; health needed an actionable message without exposing the secret.

## Files changed (high level)

- `api/lib/cors-origins.js` (new), `api/lib/logout.js` (new)
- `api/maintainx.js`, `api/lib/entra.js`, `api/lib/staging-test-login.js`
- `api/lib/hub/routes.js`, `for-dev/hub-demo-seed.js`
- `index.html`, `hub.js`, `hub.css`
- `.env.staging.example`, `DEPLOYMENT_STAGING.md`, `package.json`
- `scripts/security/staging-readiness-test.js` (+ updates to hardening / no-origin tests)
- Vendor notification/visibility PORTAL defaults (removed vercel.app fallback)

## Behavior before → after

| Area | Before | After |
|------|--------|--------|
| CORS | Manual ALLOWED_ORIGIN only; easy to miss | ALLOWED_ORIGIN + PORTAL_BASE_URL origin; documented staging value |
| Demo seed | Dev-only | Staging with `STAGING_DEMO_DATA_ENABLED=1` + hub_admin/admin; never production |
| Sign out | Cosmetic mgmt clear | Shared `portalSignOut` → server `/api/auth/logout` clears cookies |
| Account chip | Static text | Accessible menu + confirm + Hub Admin label |
| MaintainX health | configured / not_configured | Same + admin message; no secret |

## Tests

| Suite | Result |
|-------|--------|
| `security:staging-readiness-test` | **34/34 PASS** |
| `security:staging-hardening-test` | **34/34 PASS** |
| `security:no-origin-auth-gate-test` | **10/10 PASS** |
| `security:staging-test-login-test` | **45/45 PASS** |
| `security:postgres-only-staging-health-test` | **26/26 PASS** |
| `security:rbac-authz-test` | **23/23 PASS** |
| `security:secret-scan` | **PASS** |

## Confirmations

- **No real secret committed** (secret-scan PASS; MAINTAINX_API_KEY placeholder empty).
- **Test/demo cannot run in production** (`isDevDemoAllowed` false; production startup refuses `STAGING_DEMO_DATA_ENABLED` / `STAGING_TEST_LOGIN_ENABLED`).

## Required staging env (critical)

```bash
NODE_ENV=staging
PORTAL_BASE_URL=https://automation.streamlinescada.com/ops-hub-staging/
APP_BASE_PATH=/ops-hub-staging
ALLOWED_ORIGIN=https://automation.streamlinescada.com
DATABASE_URL=...
SESSION_SECRET=<≥32 chars>
SSO_ENFORCEMENT=on
DEMO_BYPASS=0
ALLOW_DEV_LOGIN=0
STAGING_TEST_LOGIN_ENABLED=1   # optional
STAGING_TEST_LOGIN_SECRET=...  # if enabled
STAGING_DEMO_DATA_ENABLED=1    # optional hub admin demo tools
MAINTAINX_API_KEY=             # optional until MaintainX ready
BOOTSTRAP_ADMIN_EMAILS=...
```

## Required production env (critical)

```bash
NODE_ENV=production
# Same Postgres/session/SSO pattern
STAGING_TEST_LOGIN_ENABLED=0   # must not be 1 — startup fails if set
STAGING_DEMO_DATA_ENABLED=0    # must not be 1 — startup fails if set
SESSION_SECRET=<≥32 chars>
DATABASE_URL=...
ALLOWED_ORIGIN=<exact production origin>
```

## EC2 deploy

```bash
cd /var/www/ops-hub-staging
git pull origin main
npm ci --omit=dev
# Edit .env.staging: set ALLOWED_ORIGIN=https://automation.streamlinescada.com
pm2 restart ops-hub-staging ops-hub-staging-worker
# Nginx usually unchanged; reload only if config edited:
# sudo nginx -t && sudo systemctl reload nginx
curl -s http://127.0.0.1:3010/health | jq '{ok, staging_test_login_enabled, staging_demo_data_enabled, maintainx_configured}'
```

## Manual staging checklist

1. Confirm `ALLOWED_ORIGIN` matches browser origin (no path).
2. Sign in (Entra or staging test login).
3. Dashboard sections load (no Origin errors / hung Loading).
4. Top-right account menu → Sign out confirm → session cleared; Back does not restore auth.
5. With `STAGING_DEMO_DATA_ENABLED=1` as Hub Admin: seed/clear tagged demo only.
6. User Management bootstrap text has no Vercel reference.
7. Integrations status shows MaintainX configured/not_configured without exposing key.

## Remaining blockers

- Entra must still be configured for production SSO; staging test login is temporary.
- MaintainX sync remains inactive until a real `MAINTAINX_API_KEY` is set on the server (not in git).
- Full authenticated E2E on EC2 depends on deploying this commit and setting `ALLOWED_ORIGIN`.
