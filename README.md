> **Repository provenance:** Migrated from `Parts_request-main` (branch `wos-logout-authbridge-session`, commit `8dd13d1ae326741c0add3c48ece2da088da26c6a`, tag `pre-clean-repo`) on 2026-10-06. Historical engineering reports remain recoverable from that source tag/history. This tree is the clean `sliops_master` engineering allowlist — same application paths and behavior.
# SLIOps

Streamline Operations Workflow Hub â€” parts requests, forms, vendor onboarding, archives, and RBAC.

## Quick start

```bash
npm ci
cp .env.example .env.local   # or .env.local.postgres.example for Postgres
npm run dev
```

See [DEPLOYMENT_NOTES.md](./DEPLOYMENT_NOTES.md) and [DEPLOYMENT_STAGING.md](./DEPLOYMENT_STAGING.md) for EC2 + Nginx + RDS deployment.
