# WOS-84 — Remove mandatory Redis/Upstash for PostgreSQL staging

## Root cause

`scripts/server-core.js` `buildHealthPayload()` always imported `getStoreMode()` from `for-dev/redis-client.js`. Calling `getStoreMode()` invokes `createRedisClient()` → `assertStoreReady()`, which threw when `NODE_ENV=staging|production` and Upstash credentials were blank — even when `HUB_STORE_MODE=postgres` and `VENDOR_STORE_MODE=postgres`.

Secondary eager inits (`api/lib/hub/db/postgres.js`, `api/lib/vendor/db/kv.js` via vendor store, `api/maintainx.js`) could also force Redis client creation on related load paths.

## Files changed

| File | Change |
|------|--------|
| `for-dev/redis-client.js` | Postgres-only mode: skip Upstash assert; no local JSON fallback; optional ephemeral memory stub; `getLegacyKvStatus()` without init |
| `scripts/server-core.js` | Health uses `getLegacyKvStatus`; does not call `getStoreMode()` in postgres mode; export `buildHealthPayload` |
| `api/lib/hub/db/postgres.js` | Lazy `redis` getter (healthCheck does not init Redis) |
| `api/lib/hub/db/index.js` | Postgres health reports `redis_backend: not_applicable` |
| `api/lib/vendor/store.js` | Lazy-require `kv.js` only when not postgres |
| `api/lib/hub/routes.js` | Dev status uses hub mode + legacy KV status |
| `api/maintainx.js` | Lazy Proxy around Redis client |
| `scripts/security/postgres-only-staging-health-test.js` | New regression tests |
| `package.json` | `security:postgres-only-staging-health-test` script |
| `.env.staging.example` | Upstash documented as optional / blank OK |
| `DEPLOYMENT_STAGING.md` | Postgres-only staging without Upstash |
| `DEPLOYMENT_NOTES.md` | Optional KV clarified |

## Tests

```bash
npm run security:postgres-only-staging-health-test   # 26/26 PASS
npm run security:staging-hardening-test              # 30/30 PASS
npm run security:rbac-authz-test                     # 23/23 PASS
npm run security:legacy-route-rbac-test              # 16/16 PASS
```

(Additional auth/DB tests run after `npm ci` when dependencies are present.)

## Remaining runtime Redis dependency

| Path | When |
|------|------|
| `api/maintainx.js` (lazy Proxy) | First portal permission / archive / SSO org KV access — uses **ephemeral in-memory stub** when postgres-only + no Upstash (not local JSON, not Upstash) |
| `api/lib/hub/db/postgres.js` `.redis` | Only if code reads `store.redis` (integrations dedupe helpers) |
| `api/lib/hub/store.js` / `api/lib/vendor/db/kv.js` | Only when hub/vendor mode is **not** postgres |
| Explicit `HUB_STORE_MODE=redis` | Still requires valid Upstash (or local store in development) |

Auth/SSO/RBAC/session hardening and Postgres `assertPostgresConfigured` are unchanged.

## EC2 pull / restart / health-check

```bash
cd /var/www/ops-hub-staging
git pull origin main
npm ci --omit=dev
npm run db:migrate
pm2 restart ops-hub-staging ops-hub-staging-worker
curl -s http://127.0.0.1:3010/health | jq .
# Expect: ok=true, hub_store_mode="postgres", store_mode="postgres",
#         legacy_kv="disabled", redis_backend="not_applicable", local_store_enabled=false
HEALTH_URL=http://127.0.0.1:3010/health npm run health
```

Ensure `.env.staging` has:

```bash
NODE_ENV=staging
HUB_STORE_MODE=postgres
VENDOR_STORE_MODE=postgres
HUB_USE_LOCAL_STORE=0
# UPSTASH_* may be blank
```
