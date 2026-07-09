/**
 * Hub database adapter selector.
 * Routes and workflow modules require this module as the store abstraction.
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

async function checkHubStoreHealth() {
  const mode = getHubStoreMode();
  if (mode === 'postgres') {
    assertPostgresConfigured();
    const pg = require('./postgres');
    const pgHealth = await pg.healthCheck();
    return {
      store_mode: mode,
      hub_store_mode: mode,
      postgres: pgHealth,
      store_ok: !!pgHealth.connected,
      store_error: pgHealth.error || null,
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

const store = getStore();

module.exports = store;
module.exports.getStore = getStore;
module.exports.getHubStoreMode = getHubStoreMode;
module.exports.checkHubStoreHealth = checkHubStoreHealth;
