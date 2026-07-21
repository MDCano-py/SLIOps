# Deployment Notes — EC2 + Nginx + RDS PostgreSQL

GitHub holds **source code only**. Secrets and environment-specific values live on the
server (`.env.staging`, `.env.production`) — never in the repository.

For step-by-step staging setup, see [DEPLOYMENT_STAGING.md](./DEPLOYMENT_STAGING.md).

---

## Target architecture

| Layer | Technology |
|---|---|
| App | Node.js 20.x (`scripts/production-server.js` via PM2 or systemd) |
| Reverse proxy | Nginx (TLS termination, path prefix e.g. `/ops-hub-staging/`) |
| Database | AWS RDS PostgreSQL (`DATABASE_URL`, migrations in `/migrations`) |
| Worker | `scripts/hub-worker.js` (outbox / email / integration delivery) |
| Optional KV | Upstash Redis — **optional** when `HUB_STORE_MODE=postgres` + `VENDOR_STORE_MODE=postgres`; leave blank for Postgres-only staging |
| Blob storage | Vercel Blob API (`BLOB_READ_WRITE_TOKEN`) — legacy JSA/BOL/archive files |

---

## What ships to EC2

**Include in deploy artifact (git clone / rsync):**

- `package.json`, `package-lock.json`
- `index.html`, `hub.js`, `hub.css`, and root frontend modules (`*-ui.js`, `rbac-client.js`, etc.)
- `api/` (all server routes and libs)
- `scripts/` (production server, db migrate, worker, tests)
- `migrations/` (001–011 canonical SQL)
- `deploy/` (PM2 ecosystem, systemd unit, nginx sample config)
- `for-dev/` (local Redis shim — used when `HUB_USE_LOCAL_STORE=1`; harmless on server)
- `docs/`, `*.md` documentation
- `.env.example`, `.env.staging.example`, `.env.local.postgres.example`

**Do NOT ship / commit:**

- `node_modules/` (run `npm ci --omit=dev` on server)
- `.env`, `.env.local`, `.env.staging`, `.env.production` (create on server)
- `for-dev/local-hub-data/redis.json` (local dev JSON store)
- IDE folders (`.idea/`, `.vscode/`)
- Reference/prototype trees (e.g. vendored OSS copies)

---

## First-time server setup (summary)

1. Clone repo to e.g. `/var/www/ops-hub-staging`
2. `npm ci --omit=dev`
3. Copy `.env.staging.example` → `.env.staging` and fill secrets
4. Provision **empty** RDS database; set `DATABASE_URL`
5. `npm run db:migrate`
6. Configure Nginx using `deploy/nginx/ops-hub-staging.conf`
7. Start API + worker: `pm2 start deploy/ecosystem.config.cjs`
8. Smoke: `curl https://your-host/ops-hub-staging/health`

**Do not** run `db:seed`, `db:seed-demo`, or `db:validate:demo` on staging/production.

---

## Environment files

| File | Purpose | Commit? |
|---|---|---|
| `.env.example` | Generic variable index | Yes |
| `.env.staging.example` | Staging template for EC2 | Yes |
| `.env.local.postgres.example` | Local Postgres dev | Yes |
| `.env.staging` / `.env.production` | Real secrets on server | **Never** |

---

## Dependency notes (EC2 vs Vercel)

| Package | Keep? | Why |
|---|---|---|
| `@azure/msal-node` | Yes | Microsoft Entra SSO (`api/lib/entra.js`) |
| `@node-saml/node-saml` | Yes | Multi-tenant SAML SSO |
| `@upstash/redis` | Yes (optional on server) | Legacy KV when configured |
| `@vercel/blob` | Yes | Legacy archive blob I/O via `BLOB_READ_WRITE_TOKEN` (not Vercel hosting) |
| `pg` | Yes | RDS PostgreSQL |
| `jszip` | Yes | Document export in `api/maintainx.js` |

`vercel.json` is optional for EC2 (Vercel cron/rewrites only). Safe to keep for reference; Nginx handles routing on EC2.

---

## Security before GitHub push

- Run `npm run security:secret-scan`
- Confirm `.env.local` / `.env.local.postgres` are gitignored
- Rotate any secret that was ever committed locally
- Review `PENTEST_READINESS_PACKAGE.md` for staging hardening checklist
