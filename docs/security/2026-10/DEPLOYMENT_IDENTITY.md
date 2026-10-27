# Deployment identity — October 2026

Local HEAD is not the deployed build. No host was inspected. Git SHAs below are the remediation branches on this workstation.

| Application | Repository | Branch | Local HEAD | Role |
| --- | --- | --- | --- | --- |
| SLIOps | `sliops_master` | `security/2026-10-remediation` | code `bb4cc8cfc9a7cc55d9be4282765109280520e002` on top of `9b459e5`. This file is a later documentation commit on the same branch | Operations SPA and hub API |
| AuthBridge | `SSO` repo, `sli-authbridge/` | `security/2026-10-remediation` | `7bdbca15bf181a8cb6503785ebe0fa0887d6ecea` on top of `e05b2fc` | Authentication gateway |
| SLI Auth | same `SSO` repo, `sli-auth/` | same branch | same HEAD | Downstream adapter library and setup CLI. Not a listening gateway |

The production zip in the SSO working tree was not extracted and is not the source of truth.

## How each process starts

| Piece | Entry | Process model in repo | Listen |
| --- | --- | --- | --- |
| SLIOps web | `scripts/production-server.js` → `scripts/server-core.js` → `api/maintainx.js` | PM2 app `ops-hub-staging` in `deploy/ecosystem.config.cjs` (`instances: 1`, `fork`). Alternate unit `deploy/ops-hub-staging.service` runs the same script as `www-data` | `3010`, prefix `APP_BASE_PATH` (staging example `/ops-hub-staging`) |
| SLIOps worker | `scripts/hub-worker.js` | PM2 app `ops-hub-staging-worker`, one fork | no HTTP port |
| AuthBridge | `uvicorn gateway.main:app` | `docker/Dockerfile.gateway` (`python:3.11-slim-bookworm`). Compose also starts Postgres 16, Redis 7, and nginx | `8000` inside the image |
| nginx in front of SLIOps | `deploy/nginx/ops-hub-staging.conf` | proxies `/ops-hub-staging/` to `127.0.0.1:3010`. Denies source, env, and migration paths. Does not run PHP | host nginx, not observed |
| nginx in front of AuthBridge | `adapters/nginx/authbridge.conf` | `auth_request` to `GET /session/verify`. `/auth/` is rewritten onto the gateway and is not itself behind `auth_request`. `/admin/` forwards `X-Admin-Key` | example only |
| SLI Auth | imported by a downstream app (`sli_auth.fastapi`, `sli_auth.flask`) | no service unit and no gateway Dockerfile | none |

`/health` on SLIOps returns `version` from `package.json` (`1.2.0`), `node_env`, and store mode. It does not return a Git SHA. Build `1.2.0` in the October reports therefore does not identify a commit. AuthBridge `/healthz` returns status and service name only.

## Data stores

| Store | Who uses it | What this pass proved |
| --- | --- | --- |
| PostgreSQL `DATABASE_URL` | SLIOps hub when `HUB_STORE_MODE=postgres`. Migrations through `019_session_revocation.sql` | Disposable database migrated and used by the integration script. Staging RDS was not opened |
| PostgreSQL `DATABASE_URL` (AuthBridge) | tenants, apps, audit. Separate schema from SLIOps | Not migrated here. The Redis test stubbed `get_db` |
| Redis `REDIS_URL` | AuthBridge `authbridge:session:{jti}` and `authbridge:revoked:{jti}` | Disposable Redis db 1. Logout and both verify paths honored the revocation key |
| Upstash REST or in-process stub | SLIOps legacy archive indexes when Postgres is the system of record | Integration used the in-process stub. Upstash was unset on purpose |
| `sliops_session_revocation` | SLIOps employee HMAC cutoff when `SLIOPS_SESSION_REVOCATION_STORE=postgres` | A second process image loaded the cutoff and rejected the old cookie. A login after `primeIssuer` was accepted |
| S3 | `api/lib/storage` for binary vendor docs and parts photos | Not called |
| MaintainX | `https://api.getmaintainx.com/v1` when `MAINTAINX_API_KEY` is set | `fetch` was replaced. The real API was not called |

Employee cookies are HMAC (`sliops_session` / `sliops_remember`), path from `APP_BASE_PATH`. AuthBridge cookies are RS256 `sli_session`. They are different session authorities. Logout from SLIOps revokes the HMAC cutoff. It does not, by itself, write AuthBridge's Redis revocation list unless the browser also completes the AuthBridge logout request.

`SLIOPS_SESSION_REVOCATION_STORE=redis` writes through `createRedisClient()`. In postgres-only mode that client is the memory stub, not AuthBridge Redis and not a TCP Redis URL. Multi-worker revocation for the employee cookie depends on the Postgres flag and migration 019.

## Versions named by the repo

| Runtime | Declared | Observed locally | Deployed |
| --- | --- | --- | --- |
| Node.js | `package.json` engines `>=24.22.1 <25` | v24.18.0 | UNKNOWN |
| Python image | Dockerfile `python:3.11-slim-bookworm` | host Python 3.12.10; venv is not that image | UNKNOWN |
| PHP | no `php` or `php-fpm` reference in the SLIOps or AuthBridge trees | `php` is not on PATH | UNKNOWN until the host package list and nginx `fastcgi_pass` are read |
| nginx | staging example and adapter example | not the host's running config | UNKNOWN |

## Read-only commands for an operator

Run these on the host that actually serves the site. Do not print secret values. Compare the SHA with the branch above before calling the build current.

```bash
# SLIOps
cd /var/www/ops-hub-staging
git rev-parse HEAD
git status --short
node -p "require('./package.json').version"
node -v
readlink -f /proc/$(pm2 pid ops-hub-staging)/exe
pm2 describe ops-hub-staging
pm2 describe ops-hub-staging-worker
systemctl cat ops-hub-staging.service
curl -sS http://127.0.0.1:3010/health
psql "$DATABASE_URL" -c "SELECT id, applied_at FROM schema_migrations WHERE id = '019_session_revocation.sql';"
psql "$DATABASE_URL" -c "\d sliops_session_revocation"

# AuthBridge container or host
python -c "import sys; print(sys.version)"
# image id and the Git SHA baked into the deploy, if the deploy records one
curl -sS http://127.0.0.1:8000/healthz
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/docs
nginx -T | awk '/server_name|auth_request|proxy_pass|fastcgi_pass|add_header/'

# PHP presence on the host, without changing packages
php -v || true
dpkg -l 'php*' 2>/dev/null || rpm -q php 2>/dev/null || true
```

A missing `019_session_revocation.sql` row means the shared employee-logout cutoff is not in that database yet.
