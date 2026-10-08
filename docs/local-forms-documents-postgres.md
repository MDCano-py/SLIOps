# Local Forms & Documents (Postgres templates)

Forms and Documents use the **Postgres template store**. They intentionally return `POSTGRES_REQUIRED` when the hub is running in local JSON/redis mode.

## Exact setup

```bash
cp .env.local.postgres.example .env.local.postgres
# Ensure Postgres accepts DATABASE_URL from that file (default docker user/db below).
# Optional: docker run --name sliops-pg -e POSTGRES_USER=streamline \
#   -e POSTGRES_PASSWORD=streamline -e POSTGRES_DB=streamline_hub -p 5432:5432 -d postgres:16-alpine

npm run db:migrate
npm run dev:pg
# Portal: http://127.0.0.1:3010/?_noauth=1
```

Forms/Documents/template APIs require `HUB_STORE_MODE=postgres`. Configuration Center also needs `CONFIGURABLE_PLATFORM_ENABLED=1` (set in the example env file).

Local workflow proof: `npm run security:local-swp-workflow-e2e` (optionally `BASE_URL=http://127.0.0.1:3010`).

Do **not** add an in-memory template store for production. Ordinary users never see these commands.
