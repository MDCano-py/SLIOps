# Staging release checklist — October 2026

Do not deploy from this checklist until the identity commands show the host is the intended build and the blockers below are accepted in writing. This file is not a deployment.

## Before the AuthBridge process is replaced

- [ ] Record `git rev-parse HEAD` and the image id on the current gateway host.
- [ ] Confirm the new process will be AuthBridge `7bdbca15bf181a8cb6503785ebe0fa0887d6ecea` or a descendant that contains `e05b2fc`.
- [ ] Confirm `AUTHBRIDGE_EXPOSE_DOCS` is unset or not `1` / `true` / `yes`.
- [ ] Confirm `REDIS_URL` is the gateway Redis, and that logout will call `revoke_token` on that same Redis.
- [ ] Confirm the public Ignition tenant id is not the nil UUID. Do not copy the placeholder from `.env.example` into the host environment.
- [ ] Keep HSTS `includeSubDomains` off the parent zone until every sibling host is ready.
- [ ] Plan secret rotation separately. Do not paste new secrets into Git.

## Before the SLIOps process is replaced

- [ ] Apply `migrations/019_session_revocation.sql` and confirm the `schema_migrations` row.
- [ ] Set `SLIOPS_SESSION_REVOCATION_STORE=postgres` on both `ops-hub-staging` and `ops-hub-staging-worker`.
- [ ] Do not expect `SLIOPS_SESSION_REVOCATION_STORE=redis` to share state while `HUB_STORE_MODE=postgres` unless Upstash is actually configured. The memory stub does not cross workers.
- [ ] Run Node `24.22.1` or a later 24.x. `production-server.js` will exit on the v24.18.0 used for local tests.
- [ ] Confirm `HUB_STORE_MODE=postgres`, `SSO_ENFORCEMENT=on`, and `DEMO_BYPASS` is off.
- [ ] Deploy AuthBridge before SLIOps if logout must revoke both the HMAC cookie and the gateway JWT.
- [ ] Leave historical archive rows in place. The read path sanitizes them.

## After deploy, still on the staging host

- [ ] `GET /health` and `GET /healthz` from localhost. Compare version and store mode. Fetch the Git SHA from the host, not from the health JSON.
- [ ] Repeat the retest rows in `REPEN_RETEST_MATRIX.md` with a staging account. Do not use production.
- [ ] Confirm a logged-out employee cookie is rejected by a second Node worker.
- [ ] Confirm an AuthBridge cookie presented to `/session/verify` is rejected after logout and that a new login still verifies.

## Rollback

Restore the previous recorded SHA and image. Migration 019 is additive and can stay. Unsetting `SLIOPS_SESSION_REVOCATION_STORE` returns employee revocation to per-process memory, which is the previous gap, not a schema rollback.
