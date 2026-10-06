# Local PostgreSQL for Operations Workflow Hub

Use Postgres on your machine for realistic staging-style testing. The hub UI and API routes stay the same; only the storage backend changes.

## Storage modes (`HUB_STORE_MODE`)

| Mode | Description |
|------|-------------|
| `local_json` | File-backed store (`for-dev/local-hub-data/redis.json`) — default when no Upstash env |
| `redis` | Upstash / Redis REST (production-style without Postgres) |
| `postgres` | PostgreSQL via `DATABASE_URL` — source of truth for hub entities |

Legacy: `HUB_STORE=postgres` also selects Postgres.  
Default dev without env: `local_json` if Upstash is not configured.

## 1. Install PostgreSQL

**Windows (winget):**
```powershell
winget install PostgreSQL.PostgreSQL
```

**macOS:**
```bash
brew install postgresql@16
brew services start postgresql@16
```

**Docker:**
```bash
docker run -d --name streamline-pg -e POSTGRES_USER=streamline -e POSTGRES_PASSWORD=streamline -e POSTGRES_DB=streamline_hub -p 5432:5432 postgres:16
```

## 2. Create database and role

```sql
CREATE USER streamline WITH PASSWORD 'streamline';
CREATE DATABASE streamline_hub OWNER streamline;
GRANT ALL PRIVILEGES ON DATABASE streamline_hub TO streamline;
```

## 3. Configure environment

```powershell
copy .env.local.postgres.example .env.local.postgres
```

Edit `.env.local.postgres`:

```env
HUB_STORE_MODE=postgres
DATABASE_URL=postgresql://streamline:streamline@127.0.0.1:5432/streamline_hub
PGSSLMODE=disable
PORT=3010
SSO_ENFORCEMENT=off
```

## 4. Run migrations

```powershell
# Load env (PowerShell)
Get-Content .env.local.postgres | ForEach-Object {
  if ($_ -match '^\s*([^#=]+)=(.*)$') { Set-Item -Path "env:$($matches[1])" -Value $matches[2] }
}
npm run db:migrate
npm run db:validate
npm run db:fresh-migration-check
```

`db:validate` is staging-safe (no demo seed). For local demo compatibility:

```powershell
npm run db:validate:demo
```

`db:fresh-migration-check` verifies migrations on an empty database without `psql`. If your role lacks `CREATEDB`, it uses an isolated schema fallback on local Postgres.

Optional admin connection for temp-database mode (when your role has `CREATEDB` or you use a superuser):

```env
# DATABASE_URL_ADMIN=postgresql://postgres:YOUR_PASSWORD@127.0.0.1:5432/postgres
```

Or grant your dev role:

```sql
ALTER USER streamline CREATEDB;
```

Or set `DATABASE_URL` inline:

```powershell
$env:DATABASE_URL="postgresql://streamline:streamline@127.0.0.1:5432/streamline_hub"
$env:PGSSLMODE="disable"
$env:HUB_STORE_MODE="postgres"
npm run db:migrate
npm run db:validate
```

## 5. Seed demo data

```powershell
$env:HUB_STORE_MODE="postgres"
npm run db:seed
```

## 6. Start portal with Postgres

```powershell
npm run dev:pg
```

Open `http://127.0.0.1:3010/` (or your `PORT`).

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run db:migrate` | Apply SQL files in `migrations/` |
| `npm run db:reset` | Drop hub tables and re-migrate (**local hosts only**; see below) |
| `npm run db:seed` | Seed document types (Postgres) + demo requests |
| `npm run db:validate` | Schema, constraints, smoke CRUD, and idempotent demo seed checks |
| `npm run db:persistence-test` | WOS-20 end-to-end persistence read/write/reconnect test (local; cleans up `PERSISTENCE_TEST-*` rows only) |
| `npm run dev:pg` | Dev server with `.env.local.postgres` |
| `npm run health` | Check `/health` (set `HEALTH_URL` if needed) |

## Schema overview

Migrations live in `migrations/`:

- `001_init.sql` — requests, workflow, web documents, notifications, action links, audit, integration events, registry tables
- `002_hub_extras.sql` — archive columns, `hub_settings`, `locations`, `equipment`, `request_files`
- `003_workflow_step_action_types.sql` — extended workflow step action types for MaintainX/upload/close steps

**Reset safety:** `db:reset` only runs against local hosts (`127.0.0.1`, `localhost`, etc.). Pointing at RDS/staging requires `DATABASE_URL_CONFIRM_RESET=1` (dangerous).

Table naming notes:

- `status_history` = request status timeline (`request_status_history` conceptually)
- `audit_events` = document/request audit (`document_audit_events` conceptually)

## Health check

`GET /health` returns:

- `hub_store_mode` — active mode (`postgres`, `local_json`, `redis`)
- `postgres.connected` — when using Postgres
- `store_ok` — ping success for the active backend

Management → Integrations (`GET /integrations-status`) also reports Postgres connection status when `HUB_STORE_MODE=postgres`.

## AWS RDS (later)

Use the same migrations and set:

```env
HUB_STORE_MODE=postgres
DATABASE_URL=postgresql://user:pass@your-rds-host:5432/streamline_hub
PGSSLMODE=require
```

See `RDS_POSTGRES_SETUP.md` for deployment notes. Run `npm run db:validate` after migrate on staging (safe, non-destructive).

## What stays on Redis/local JSON

- Vendor/user permission KV (existing MaintainX proxy storage)
- Short-lived n8n dedupe keys (optional; Postgres holds integration event queue)
- Archives and legacy forms unchanged

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `DATABASE_URL is required` | Set env before `db:migrate` or use `.env.local.postgres` |
| `relation "requests" does not exist` | Run `npm run db:migrate` |
| `password authentication failed` | Verify Postgres user/password in `DATABASE_URL` |
| Health `store_ok: false` | Check Postgres is running; test `psql $DATABASE_URL -c 'SELECT 1'` |
