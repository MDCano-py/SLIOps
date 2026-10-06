/**
 * Hub storage mode resolution.
 *
 * HUB_STORE_MODE:
 *   - local_json  — file-backed JSON store (for-dev/local-hub-data)
 *   - redis       — Upstash / Redis REST (or explicit redis mode)
 *   - postgres    — PostgreSQL via DATABASE_URL
 *
 * Legacy: HUB_STORE=postgres implies postgres mode.
 */

const { shouldUseLocalStore, hasUpstashEnv, isDeployedEnvironment } = require('../../../../for-dev/redis-client');

const VALID_MODES = new Set(['local_json', 'redis', 'postgres']);

function getHubStoreMode() {
  const explicit = String(process.env.HUB_STORE_MODE || '').toLowerCase().trim();
  if (VALID_MODES.has(explicit)) return explicit;

  if (String(process.env.HUB_STORE || '').toLowerCase() === 'postgres') {
    return 'postgres';
  }

  if (shouldUseLocalStore()) return 'local_json';
  return 'redis';
}

function applyModeEnvDefaults(mode) {
  if (mode === 'local_json') {
    if (!process.env.HUB_USE_LOCAL_STORE) process.env.HUB_USE_LOCAL_STORE = '1';
  } else if (mode === 'redis') {
    if (process.env.HUB_STORE_MODE === 'redis') {
      process.env.HUB_USE_LOCAL_STORE = '0';
    }
  } else if (mode === 'postgres') {
    process.env.HUB_USE_LOCAL_STORE = '0';
  }
}

function assertPostgresConfigured() {
  if (!process.env.DATABASE_URL) {
    const env = (process.env.NODE_ENV || '').toLowerCase();
    const where =
      env === 'production' || env === 'staging' || isDeployedEnvironment()
        ? 'staging/production'
        : 'development';
    throw new Error(
      `HUB_STORE_MODE=postgres requires DATABASE_URL (${where}). Refusing to start without Postgres configured.`
    );
  }
}

module.exports = {
  VALID_MODES,
  getHubStoreMode,
  applyModeEnvDefaults,
  assertPostgresConfigured,
  hasUpstashEnv,
  shouldUseLocalStore,
  isDeployedEnvironment,
};
