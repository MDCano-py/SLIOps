# Operations Workflow Hub — EC2 staging deployment

GitHub is the **source of truth** for code. Your company EC2 instance is the **staging host** leadership visits for approval. Vercel is optional and not required for this phase.

**Staging URL (example):** `https://automation.streamlinescada.com/ops-hub-staging/`

---

## Data store modes (read this first)

| Environment | `NODE_ENV` | Store | When to use |
|-------------|------------|-------|-------------|
| **Local dev** | `development` | JSON file or local Postgres (`HUB_USE_LOCAL_STORE=1` / `.env.local.postgres`) | Solo developer on laptop |
| **Staging (approval)** | `staging` | **AWS RDS PostgreSQL** (`HUB_STORE_MODE=postgres`, `DATABASE_URL`) | Leadership demos, vendor workflow, durable outbox |
| **Production (later)** | `production` | **RDS PostgreSQL** + optional Redis for legacy KV/dedupe | Go-live |

**Do not** use the local JSON store for staging approval. Staging requires Postgres (RDS) for hub requests, vendor master, and outbox/worker delivery.

Optional **Upstash Redis** may remain configured for legacy user/role KV and dedupe keys; it is **not** required and **not** the system of record when `HUB_STORE_MODE=postgres` and `VENDOR_STORE_MODE=postgres`. Leave `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` blank for PostgreSQL-only staging — `/health` and startup will not initialize Redis or fall back to local JSON.

---

## 1. Commit and push to GitHub

```bash
git init   # if not already a repo
git add .
git commit -m "Prepare Operations Workflow Hub for EC2 staging deployment"
git remote add origin git@github.com:YOUR_ORG/Parts_request-main.git
git push -u origin main
```

Use your real org/repo name and branch strategy (`main` or `staging`).

---

## 2. Prepare the EC2 instance

Assumptions:

- Ubuntu 22.04+ (or similar)
- nginx already terminates TLS for `automation.streamlinescada.com`
- Node.js **20.x** installed (`node -v`)
- Git access to the repository

```bash
sudo mkdir -p /var/www/ops-hub-staging /var/log/ops-hub-staging
sudo chown -R $USER:www-data /var/www/ops-hub-staging /var/log/ops-hub-staging

cd /var/www/ops-hub-staging
git clone git@github.com:YOUR_ORG/Parts_request-main.git .
npm ci --omit=dev
cp .env.staging.example .env.staging
nano .env.staging   # fill secrets (see section 5)
```

---

## 3. Start the app (PM2 recommended)

### Option A — PM2

```bash
cd /var/www/ops-hub-staging
pm2 start deploy/ecosystem.config.cjs
pm2 status
pm2 logs ops-hub-staging --lines 50
pm2 logs ops-hub-staging-worker --lines 50
pm2 save
pm2 startup   # follow printed command for boot persistence
```

This starts **two processes**: `ops-hub-staging` (API) and `ops-hub-staging-worker` (outbox/integration delivery). Both read secrets from `.env.staging`.

### Option B — systemd

```bash
sudo cp deploy/ops-hub-staging.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable ops-hub-staging
sudo systemctl start ops-hub-staging
sudo systemctl status ops-hub-staging
```

### Production start command

```bash
npm start
# runs: node scripts/production-server.js
# listens: PORT (default 3010), HOST 0.0.0.0
```

---

## 4. nginx — `/ops-hub-staging/`

Copy the snippet and reload nginx:

```bash
sudo cp deploy/nginx/ops-hub-staging.conf /etc/nginx/snippets/ops-hub-staging.conf
# In your server { } block for automation.streamlinescada.com:
#   include snippets/ops-hub-staging.conf;
sudo nginx -t
sudo systemctl reload nginx
```

The app must use matching env:

```env
APP_BASE_PATH=/ops-hub-staging
PORTAL_BASE_URL=https://automation.streamlinescada.com/ops-hub-staging/
```

**Entra redirect URI** must include:

`https://automation.streamlinescada.com/ops-hub-staging/api/auth/callback`

---

## 5. Environment variables (`.env.staging`)

Copy from `.env.staging.example`. Minimum for staging approval:

| Variable | Staging value |
|----------|----------------|
| `NODE_ENV` | `staging` |
| `PORT` | `3010` |
| `HOST` | `0.0.0.0` |
| `APP_BASE_PATH` | `/ops-hub-staging` |
| `PORTAL_BASE_URL` | `https://automation.streamlinescada.com/ops-hub-staging/` |
| `APP_BASE_PATH` | `/ops-hub-staging` |
| `ALLOWED_ORIGIN` | `https://automation.streamlinescada.com` (scheme+host only, no path) |
| `HUB_STORE_MODE` | `postgres` |
| `VENDOR_STORE_MODE` | `postgres` |
| `HUB_USE_LOCAL_STORE` | `0` |
| `DATABASE_URL` | RDS connection string (see `.env.staging.example`) |
| `PGSSLMODE` | `require` |
| `INTEGRATION_DISPATCH_MODE` | `queued` |
| `EMAIL_DELIVERY_MODE` | `queued` |
| `EMAIL_NOTIFICATIONS_ENABLED` | `true` (when Resend configured) |
| `RESEND_API_KEY` / `EMAIL_FROM` | Verified sender |
| `VENDOR_NOTIFY_EMAIL_*` | Rebekah/AP/Legal recipients |
| `BLOB_READ_WRITE_TOKEN` | Required for vendor doc upload smoke |
| `SESSION_SECRET` | Long random string (32+ chars) |
| `SSO_ENFORCEMENT` | `on` |
| `DEMO_BYPASS` | `0` |
| `BOOTSTRAP_ADMIN_EMAILS` | Comma-separated approver emails |
| `MAINTAINX_API_KEY` | Server-only MaintainX bearer token (leave blank until ready) |
| `STAGING_TEST_LOGIN_ENABLED` | `1` to enable shared-secret test login (staging only) |
| `STAGING_DEMO_DATA_ENABLED` | `1` to enable Hub Admin seed/clear of tagged demo requests |
| `ENTRA_TENANT_ID` / `ENTRA_CLIENT_ID` / `ENTRA_CLIENT_SECRET` | Per `ENTRA_SSO_SETUP.md` |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Optional (legacy user/role KV) |

See [RDS_POSTGRES_SETUP.md](./RDS_POSTGRES_SETUP.md) and [WOS_51_RDS_MIGRATION_STAGING_READINESS_REPORT.md](./WOS_51_RDS_MIGRATION_STAGING_READINESS_REPORT.md) for migration and smoke-test steps.

### Disable `_noauth` on staging

- Set `SSO_ENFORCEMENT=on` and `DEMO_BYPASS=0`.
- Do **not** share links with `?_noauth=1` — the portal auth gate only bypasses on `localhost` / `127.0.0.1`.
- `/api/auth/dev-login` is **disabled** unless `ALLOW_DEV_LOGIN=1` (emergency only).

### MaintainX (after UI loads)

```env
MAINTAINX_API_KEY=...
MAINTAINX_ORG_ID=...
```

Test work-order sync on **staging/sandbox** data first. Use hub demo seed only on a dedicated Upstash database, not production keys.

### n8n (after UI loads)

Point webhooks at your internal n8n instance, e.g.:

```env
N8N_WEBHOOK_DEFAULT=https://automation.streamlinescada.com/webhook/...
N8N_WEBHOOK_REQUEST_CREATED=...
```

See `api/lib/hub/integrations.js` for the full webhook env map.

---

## 6. RDS migrations (before first smoke test)

From the EC2 host (with network access to RDS security group):

```bash
cd /var/www/ops-hub-staging
# Ensure .env.staging has DATABASE_URL and PGSSLMODE=require
npm run db:migrate
npm run db:validate
```

Migrations are **forward-only** and idempotent (`schema_migrations` tracks applied files including `012_staging_test_users.sql`).

---

## 7. Health check

```bash
curl -s http://127.0.0.1:3010/health | jq .
```

Expect `"ok": true`, `"hub_store_mode": "postgres"`, `"store_ok": true`, `"node_env": "staging"`.
`"staging_test_login_enabled"` is `true` or `false` only — never includes the secret.

Via nginx (from the server):

```bash
curl -sk https://automation.streamlinescada.com/ops-hub-staging-health
```

Or:

```bash
HEALTH_URL=http://127.0.0.1:3010/health npm run health
```

---

## 7a. Staging test login (WOS-85 — before Entra)
Use this **only** for role/RBAC workflow testing while Entra is not configured. It does **not** replace SSO and does **not** re-enable `/api/auth/dev-login`.

1. In `.env.staging`:

```bash
STAGING_TEST_LOGIN_ENABLED=1
STAGING_TEST_LOGIN_SECRET=<generate-with-openssl-or-node-≥32-chars>
# ALLOW_DEV_LOGIN=0
# DEMO_BYPASS=0
# SSO_ENFORCEMENT=on
```

2. Migrate + seed (idempotent):

```bash
npm run db:migrate
npm run db:seed-staging-test-users
pm2 restart ops-hub-staging ops-hub-staging-worker
```

3. Open:

`https://automation.streamlinescada.com/ops-hub-staging/api/auth/staging-test-login`

Seeded emails (domain `staging-test.streamlinecorp.com`):

| Key | Email | Role |
|-----|-------|------|
| hub_admin | hub-admin@… | hub_admin |
| operations_manager | ops-manager@… | operations |
| hr_manager | hr-manager@… | hr |
| accounting | accounting@… | ap |
| field_supervisor | field-supervisor@… | field_supervisor |
| field_technician | field-technician@… | field_technician |
| client_representative | client-rep@… | client |
| external_vendor | external-vendor@… | vendor |

When Entra is configured, use the normal SSO login; leave test-login as an explicit separate URL (or set `STAGING_TEST_LOGIN_ENABLED=0`).

Production always returns 404 for this feature even if the env vars are set.

---

## 7. Deploy updates from GitHub

```bash
cd /var/www/ops-hub-staging
git pull origin main
npm ci --omit=dev
npm run db:migrate
pm2 restart ops-hub-staging ops-hub-staging-worker
curl -s http://127.0.0.1:3010/health | jq .ok
```

---

## 8. Staging test checklist (leadership)

1. Open `https://automation.streamlinescada.com/ops-hub-staging/` — Entra sign-in appears.
2. **Operations Workflow Hub** → dashboard loads counts.
3. (Optional) Hub admin → **Seed demo data** — only with Upstash staging DB.
4. Request queue, detail, timelines, aging chips, filters.
5. Do **not** enable MaintainX/n8n until steps 1–4 pass.
6. Request written approval before production DNS/path.

---

## 9. Rollback

### Quick — stop staging app

```bash
pm2 stop ops-hub-staging
# or: sudo systemctl stop ops-hub-staging
```

nginx will return 502 for `/ops-hub-staging/` — production paths unaffected.

### Revert code

```bash
cd /var/www/ops-hub-staging
git log --oneline -5
git checkout <previous-commit-sha>
npm ci --omit=dev
pm2 restart ops-hub-staging
```

### Revert nginx

```bash
sudo rm /etc/nginx/snippets/ops-hub-staging.conf
# remove include from server block
sudo nginx -t && sudo systemctl reload nginx
```

### Data rollback

- Upstash: use a **separate staging database**; delete keys prefixed `hub:` or restore from Upstash backup if needed.
- Demo data only: `POST /hub/dev/clear-demo-data` as hub admin (records with `demo: true`).

---

## 10. Local dev (unchanged)

```bash
npm run dev
# http://127.0.0.1:3000/?_noauth=1
# Uses .env.local — HUB_USE_LOCAL_STORE=1 without Upstash
```

Local JSON store does not affect EC2 staging when `.env.staging` sets `HUB_USE_LOCAL_STORE=0` and Upstash credentials.

---

## Architecture summary

```
GitHub (source)  -->  git pull on EC2  -->  Node :3010 (PM2 ops-hub-staging)
                                              |
                                              +--> hub-worker (PM2 ops-hub-staging-worker)
                                              |
                                         AWS RDS PostgreSQL (system of record)
                                         Entra SSO (auth)
                                         Resend (email via outbox worker)
                                         Vercel Blob (vendor docs)
                                         MaintainX / n8n (optional, later)
```
