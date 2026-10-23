# SLIOps

Streamline Operations Workflow Hub. Employees sign in with Microsoft Entra through AuthBridge. Vendor contacts sign in separately with an email verification code or a one-time invitation link.

## Runtime

Node.js 20 and PostgreSQL. The Hub UI is static files (`index.html`, `hub.js`, and the module scripts). The API is `api/maintainx.js`, started with `npm start` (`scripts/production-server.js`). Local development uses `npm run dev`.

There is no separate frontend build. Staging on EC2 is Nginx in front of PM2 processes `ops-hub-staging` and `ops-hub-staging-worker`. See `DEPLOYMENT_STAGING.md` and `deploy/nginx/ops-hub-staging.conf`.

## What the application keeps separate

| Area | Where it lives |
| --- | --- |
| Operational requests, including Work Orders and MaintainX | Hub requests and `api/lib/hub/` |
| Workspace Forms | Template runtime and the launch registry |
| Configurable request types, workflows, and documents | `api/lib/configuration/` |
| Vendor companies | `vendor_master` |
| Vendor sign-in | `vendor_contacts`, invitation links, and `vendor_login_codes` |
| Control Room | `api/lib/control-room/` |
| Employee authorization | Server-side session plus RBAC. The browser is not the authority. |

Employee cookies (`sliops_session`) do not open the vendor workspace. Vendor cookies (`sliops_vendor_session`) do not satisfy employee authorization.

## Database

Migrations are applied in filename order:

```bash
npm run db:migrate
```

`migrations/README.md` lists the schema files. Do not rewrite historical rows.

## Operations docs

| Topic | Document |
| --- | --- |
| Staging deploy | `DEPLOYMENT_STAGING.md`, `DEPLOYMENT_NOTES.md` |
| Entra / AuthBridge | `ENTRA_SSO_SETUP.md`, `docs/security/2026-authbridge-canonical-path.md` |
| Roles | `docs/security/2026-auth-rbac-model.md`, `docs/security/2026-role-assignment-architecture.md` |
| Vendor edge exemptions | `docs/security/vendor-identity-authbridge-boundary.md` |
| Control Room | `docs/control-room/` |
| Cyber handoff | `docs/cyber/` |
| October 2026 retest record | `docs/release/2026-10-21/` |
