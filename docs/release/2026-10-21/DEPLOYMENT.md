# Deployment — 2026-10-21 release candidate

**Deployment status:** not deployed.  
Production was not modified. Staging was not modified. No live HTTPS smoke test was run.

## Current staging version

The live staging SHA was **not** read from EC2 in this session. Do not assume it matches this branch. Before any future deploy, on the host:

```bash
cd /var/www/ops-hub-staging
git rev-parse HEAD
git status -sb
pm2 describe ops-hub-staging | sed -n '1,40p'
```

Record that SHA. Rollback is `git checkout <that-sha>`, `npm ci --omit=dev`, and `pm2 restart ops-hub-staging ops-hub-staging-worker`. If migration `018` has already been applied, leave the table in place when rolling the app backward (the previous build does not read it). Drop it only if you must undo the schema and no release build is still running:

```sql
DROP TABLE IF EXISTS vendor_login_codes;
DELETE FROM schema_migrations WHERE id = '018_vendor_login_codes.sql';
```

Take a database snapshot before that drop. Vendor master, contacts, invitations, and sessions are not altered by `018`.

## What a future authorized deploy must include

1. Fetch `release/sliops-2026-10-21-retest` at the SHA recorded in `RETEST_HANDOFF.md`. Do not deploy from an uncommitted tree.
2. `npm ci --omit=dev` on the host (not done in this session).
3. Confirm `.env.staging` still has `NODE_ENV=staging`, `HUB_STORE_MODE=postgres`, `VENDOR_STORE_MODE=postgres`, `SSO_ENFORCEMENT=on`, `SESSION_SECRET` of at least 32 characters, and `TRUST_FORWARDED_CLIENT_IP` unset unless Nginx overwrites `X-Forwarded-For`.
4. `npm run db:migrate` so `018_vendor_login_codes.sql` is applied. Local migrate during the release test printed `applying 018_vendor_login_codes.sql`.
5. Vendor email: `EMAIL_NOTIFICATIONS_ENABLED=true` and `RESEND_API_KEY` set, plus `EMAIL_FROM`. If the key is empty, codes are not sent and the API still returns the generic message. This session did not send a real email.
6. Reload Nginx from `deploy/nginx/ops-hub-staging.conf` only after diffing it against the live file. The template stops denying the `/api/` prefix and denies `api/*.(js|cjs|mjs|json|md)` instead. A mistaken reload can take the API offline or re-open source files.
7. AuthBridge / Entra exemptions must include the vendor code routes listed in `VENDOR_AUTH.md`. Employee routes stay behind AuthBridge. This repository cannot apply that edge rule.
8. PM2 processes stay `ops-hub-staging` and `ops-hub-staging-worker` from `deploy/ecosystem.config.cjs`. This session did not restart them.
9. Confirm S3 and MaintainX the same way as the existing staging checklist (`docs/cyber/S3_DEFERRED_CHECKLIST.md`). Neither was probed.
10. After an authorized deploy, run HTTPS smoke tests and `PROBE_BASE_URL=https://automation.streamlinescada.com/ops-hub-staging npm run security:sensitive-path-probe`. Those commands were not run here.

## Explicit non-actions

- No production deploy.
- No staging deploy.
- No secret rotation (no evidence in this session that a secret was newly exposed).
- No `npm audit fix --force`.
