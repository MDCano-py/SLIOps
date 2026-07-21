# WOS-85 — Controlled staging test-user login

## Summary

Adds a staging-only shared-secret test login for eight seeded PostgreSQL personas so RBAC workflows can be tested before Entra is configured. Does not weaken `/api/auth/dev-login`, SSO enforcement, or production hardening.

## Seeded users (`@staging-test.streamlinecorp.com`)

| Key | Email | Role key |
|-----|-------|----------|
| hub_admin | hub-admin@staging-test.streamlinecorp.com | hub_admin |
| operations_manager | ops-manager@staging-test.streamlinecorp.com | operations |
| hr_manager | hr-manager@staging-test.streamlinecorp.com | hr |
| accounting | accounting@staging-test.streamlinecorp.com | ap |
| field_supervisor | field-supervisor@staging-test.streamlinecorp.com | field_supervisor |
| field_technician | field-technician@staging-test.streamlinecorp.com | field_technician |
| client_representative | client-rep@staging-test.streamlinecorp.com | client |
| external_vendor | external-vendor@staging-test.streamlinecorp.com | vendor |

## Env vars

```bash
STAGING_TEST_LOGIN_ENABLED=1   # must be 1 on staging; ignored/disabled in production
STAGING_TEST_LOGIN_SECRET=…    # ≥32 characters when ENABLED=1
```

Keep `ALLOW_DEV_LOGIN=0`, `DEMO_BYPASS=0`, `SSO_ENFORCEMENT=on`.

## Commands

```bash
npm run db:migrate
npm run db:seed-staging-test-users
npm run security:staging-test-login-test
```

Login URL: `/api/auth/staging-test-login` (GET page, POST authenticate).
