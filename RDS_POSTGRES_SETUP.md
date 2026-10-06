# AWS RDS PostgreSQL setup (staging + production)

This repo can use **AWS RDS PostgreSQL** as the permanent source of truth for the Operations Workflow Hub when:

- `HUB_STORE_MODE=postgres` (or legacy `HUB_STORE=postgres`)
- `DATABASE_URL=postgres://...`

Local dev can continue using the local JSON store (`HUB_USE_LOCAL_STORE=1`) unless you explicitly point it at Postgres.

## Recommended engine

- **PostgreSQL 15+** (RDS)

## Required environment variables

| Var | Example | Notes |
|-----|---------|------|
| `HUB_STORE_MODE` | `postgres` | Enables Postgres store (preferred) |
| `HUB_STORE` | `postgres` | Legacy alias for Postgres mode |
| `DATABASE_URL` | `postgresql://user:pass@host:5432/dbname` | Must be reachable from the app runtime |
| `PGSSLMODE` | `require` (RDS) / `disable` (local only) | SSL mode for `pg` client |

Optional:

| Var | Notes |
|-----|------|
| `PGSSLMODE` | Set to `require` for RDS SSL; set to `disable` only for local Docker/dev |

## Create the database

- Create an RDS instance (private subnets recommended)
- Create a database (e.g. `streamline_hub`)
- Create a DB user with least privilege (DDL for migrations + DML for app)

## Run migrations

From your workstation or CI (with network access to RDS):

```bash
npm run db:migrate
npm run db:validate
npm run db:persistence-test
```

`db:persistence-test` writes and removes only `PERSISTENCE_TEST-*` rows. On staging/RDS set `DATABASE_URL_CONFIRM_PERSISTENCE_TEST=1` intentionally.

**Never** run `db:reset` against RDS unless you set `DATABASE_URL_CONFIRM_RESET=1` intentionally (destructive).

## Point staging at RDS

On the EC2 host (`.env.staging` / process env used by PM2), set:

- `HUB_STORE_MODE=postgres` (or legacy `HUB_STORE=postgres`)
- `DATABASE_URL=...`
- Optional Redis/Upstash env vars may still be present (dedupe + legacy KV); they are not the source of truth when Postgres is enabled (`HUB_STORE_MODE=postgres`).

## Security group notes

- Allow inbound `5432` to the RDS SG **only** from your app’s egress IPs / VPC security group(s)
- Prefer **private** RDS + app in same VPC, with VPC connector if needed

## SSL

RDS typically requires SSL. Use:

- `PGSSLMODE=require`

If your environment uses a custom CA bundle, ensure the runtime trusts the RDS CA.

## Backups / snapshots

- Enable automated backups (7–35 days)
- Enable deletion protection (production)
- Take manual snapshots before schema changes

## Rollback plan

- Roll back by restoring a snapshot into a new RDS instance and switching `DATABASE_URL`
- Migrations in this repo are **forward-only**; rolling back means restoring data

## Verify connection

```bash
node -e "const {Client}=require('pg'); const c=new Client({connectionString:process.env.DATABASE_URL}); c.connect().then(()=>c.query('select now()')).then(r=>{console.log(r.rows[0]);}).finally(()=>c.end());"
```

## Prevent local JSON use in staging

The selector (`api/lib/hub/store/index.js`) will **throw** if `HUB_STORE=postgres` is set but `DATABASE_URL` is missing.

