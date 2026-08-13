# WOS-99 — Production Completion Pass

## Branch / commit

- Branch: `wos-99-production-completion` (from `wos-98-config-vendor-nda-e2e`)
- Commit: see `git rev-parse HEAD`

## Purpose

Final application-level closeout before Cyber pentest. Not a new feature wave.

Closes six areas:

1. Workflow engine/UI parity (verify + harden; React Flow still deferred)
2. Configurable document → workflow → vendor path (inherits WOS-98)
3. Real-user notifications (inherits WOS-96; assignment → `notifications` table)
4. **AuthBridge** identity front door (new, behind `AUTH_PROVIDER`)
5. Production purge of demo/bypass/local-store kill switches
6. Production readiness audit (automated + ops checklist)

## AuthBridge

```text
Entra (corporate IdP)
        ↓
   AuthBridge
        ↓
   WOS session cookie
        ↓
   WOS users + RBAC (unchanged)
```

| Setting | Value |
|---------|--------|
| Switch | `AUTH_PROVIDER=authbridge` (default remains `entra`) |
| Modes | `oidc` (browser), `header` (trusted gateway), `jwt` (API) |
| Login | `/api/auth/login` → AuthBridge authorize |
| Callback | `/api/auth/callback` → token exchange → `ensureUserProvisioned` → session |
| Logout | Clears WOS cookie; optional `AUTHBRIDGE_LOGOUT_URL` |

WOS still owns roles, permissions, workflow assignment, document ACL, admin authz.

Until AuthBridge URLs/secrets are provided in the deploy environment, leave `AUTH_PROVIDER=entra`.

## Production refusals (startup exit)

When `NODE_ENV=production`, the server **refuses to start** if:

- `SSO_ENFORCEMENT=off`
- `DEMO_BYPASS=1`
- `ALLOW_DEV_LOGIN=1`
- `STAGING_TEST_LOGIN_ENABLED=1`
- `STAGING_DEMO_DATA_ENABLED=1`
- `HUB_USE_LOCAL_STORE=1` or `HUB_STORE_MODE=local_json`
- `HUB_STORE_MODE` set to anything other than `postgres` (when set)
- Missing `DATABASE_URL` or short `SESSION_SECRET`
- `AUTH_PROVIDER=authbridge` with incomplete AuthBridge config

## Client auth gate

Deployed hosts **fail closed** if `/me` errors (redirect to login). Localhost/dev may still fail open for laptop development.

## Already closed on WOS-98 (carried forward)

- Vendor Management in Hub Admin sidebar
- Dashboard SSO (no `VENDOR_ACCESS_CODE` 500)
- Repair NDA wiring = authenticated `POST` (restart API after deploy)
- MSA/NDA checkboxes → `vendor.*` workflow context + onboarding workflow
- Published cfg documents on main Documents (same `cfg_definitions` identity)

## Workflow editor (honest status)

| Capability | Status |
|------------|--------|
| Drag nodes, persist x/y | Yes |
| Handle-to-handle connect | Yes (WOS-97) |
| Delete / reconnect via Outputs + Connect dialog | Yes |
| Undo/redo, fit, zoom, pan | Yes |
| Condition variable picker (NDA/MSA) | Yes |
| Publish validation | Yes (server) |
| Runtime executes published graph | Yes |
| Full React Flow / multi-select / edge-endpoint drag | Deferred |

Architecture rule remains: **WOS owns definition + UX; n8n only via integration emit nodes.**

## Notifications

Configurable workflow assignment inserts into Postgres `notifications` for resolved **users** / role members (not fake catalogs). Bell UI polls `/hub/notifications`. External parties still use secure links; SMTP optional.

## Demo / test purge (production runtime)

| Item | Production |
|------|------------|
| Staging test login | Startup refuse |
| Demo seed APIs | Gated / refuse |
| Dev login | Unavailable |
| `_noauth=1` | Ignored off localhost |
| Local JSON store | Startup refuse |
| Automated test fixtures in `scripts/` | Remain in repo only |

## Production smoke checklist (before Cyber)

1. Deploy branch; run migrations through `014`
2. `HUB_STORE_MODE=postgres`, `DATABASE_URL`, `SESSION_SECRET`, `SSO_ENFORCEMENT=on`
3. `AUTH_PROVIDER=entra` **or** complete AuthBridge vars
4. `CONFIGURABLE_PLATFORM_ENABLED=1`, `PUBLIC_BASE_URL`
5. S3 role allows `s3:PutObject` (infra)
6. Restart API
7. Seed defaults / validate wiring once
8. Prove E2E: real user → form → workflow connect/save/publish → assign → bell + My Tasks → fill/review/sign → vendor NDA writeback → audit

## Tests

```bash
npm run security:wos99-production-completion-test
npm run security:wos98-vendor-contract-automation-test
npm run security:wos98-nav-documents-bridge-test
npm run security:wos97-functional-workflow-connection-authoring-test
```

## Still deferred (explicit)

- Full React Flow canvas migration
- True parallel NDA+MSA engine paths
- SMTP to external vendor inboxes (secure link works)
- Sealed PDF
- Auto-create `vendor_master` from cfg-only flows
- Live browser screenshot pack (ops must capture after deploy)
- Merge to `main` (not done by this card)

## Changed files (primary)

- `api/lib/authbridge.js` (new)
- `api/lib/auth.js` — AuthBridge header identity
- `api/maintainx.js` — AuthBridge login/callback/logout
- `scripts/server-core.js` — production refusals
- `index.html` — fail-closed auth gate
- `.env.example` — AuthBridge + production notes
- `scripts/security/wos99-production-completion-test.js`
- `docs/reports/WOS_99_PRODUCTION_COMPLETION_REPORT.md`
