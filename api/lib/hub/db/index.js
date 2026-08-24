/**
 * Hub database adapter selector.
 * Routes and workflow modules require this module as the store abstraction.
 *
 * Store binding is lazy: scripts must be able to loadDbEnv() before the first
 * store call. Eager require-time binding previously pinned local_json/redis
 * when HUB_STORE_MODE=postgres was only set later from .env.staging, so outbox
 * writes missed Postgres outbox_events.
 */

const {
  getHubStoreMode,
  applyModeEnvDefaults,
  assertPostgresConfigured,
} = require('./config');

let _store = null;

function loadStore() {
  const mode = getHubStoreMode();
  applyModeEnvDefaults(mode);

  if (mode === 'postgres') {
    assertPostgresConfigured();
    return require('./postgres');
  }

  // local_json and redis both use the Redis-compatible store (local file or Upstash).
  return require('../store.js');
}

function getStore() {
  if (!_store) _store = loadStore();
  return _store;
}

/** Test-only: clear cached adapter after env changes. */
function resetHubStoreForTests() {
  _store = null;
}

async function checkHubStoreHealth() {
  const mode = getHubStoreMode();
  if (mode === 'postgres') {
    assertPostgresConfigured();
    // Require postgres adapter for SELECT 1 only — do not touch Redis/Upstash.
    const pg = require('./postgres');
    const pgHealth = await pg.healthCheck();
    return {
      store_mode: mode,
      hub_store_mode: mode,
      postgres: pgHealth,
      store_ok: !!pgHealth.connected,
      store_error: pgHealth.error || null,
      redis_backend: 'not_applicable',
      legacy_kv: 'disabled',
    };
  }

  let storeOk = false;
  let storeError = null;
  let redisMode = null;
  try {
    const { createRedisClient, getStoreMode } = require('../../../../for-dev/redis-client');
    applyModeEnvDefaults(mode);
    const client = createRedisClient();
    redisMode = getStoreMode();
    const key = 'hub:health:ping';
    await client.set(key, String(Date.now()));
    const v = await client.get(key);
    storeOk = v != null && v !== '';
  } catch (err) {
    storeError = err.message;
  }

  return {
    store_mode: redisMode || mode,
    hub_store_mode: mode,
    redis_backend: redisMode,
    store_ok: storeOk,
    store_error: storeError,
  };
}

const meta = {
  getStore,
  getHubStoreMode,
  checkHubStoreHealth,
  resetHubStoreForTests,
};

module.exports = new Proxy(meta, {
  get(target, prop, receiver) {
    if (prop in target) return Reflect.get(target, prop, receiver);
    if (typeof prop === 'symbol') return undefined;
    const store = getStore();
    const value = store[prop];
    return typeof value === 'function' ? value.bind(store) : value;
  },
  has(target, prop) {
    if (prop in target) return true;
    return prop in getStore();
  },
});
