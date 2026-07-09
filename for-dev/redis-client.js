/**
 * Redis client factory: Upstash when configured, else local JSON file store.
 * No Vercel or cloud Redis required for local development.
 */

const path = require('path');

let _client = null;
let _mode = null;

function hasUpstashEnv() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token || !String(url).trim() || !String(token).trim()) return false;
  try {
    new URL(String(url).trim());
    return true;
  } catch {
    return false;
  }
}

function isDeployedEnvironment() {
  const env = (process.env.NODE_ENV || '').toLowerCase();
  return env === 'staging' || env === 'production';
}

function shouldUseLocalStore() {
  const force = (process.env.HUB_USE_LOCAL_STORE || '').toLowerCase();
  if (force === '0' || force === 'false') return false;
  if (force === '1' || force === 'true') {
    if (isDeployedEnvironment()) {
      console.warn(
        '[hub] HUB_USE_LOCAL_STORE=1 on staging/production — not suitable for multi-user approval testing'
      );
    }
    return true;
  }
  if (isDeployedEnvironment()) {
    return false;
  }
  return !hasUpstashEnv();
}

function assertStoreReady() {
  if (isDeployedEnvironment() && !hasUpstashEnv() && !shouldUseLocalStore()) {
    throw new Error(
      'Staging/production requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or HUB_USE_LOCAL_STORE=1 for single-user debug only)'
    );
  }
}

function createRedisClient() {
  if (_client) return _client;
  assertStoreReady();
  if (shouldUseLocalStore()) {
    const { createLocalRedis } = require('./local-redis');
    _client = createLocalRedis();
    _mode = 'local';
    console.log(
      '[hub] Local store: for-dev/local-hub-data/redis.json (no Upstash/Vercel required)'
    );
  } else {
    const { Redis } = require('@upstash/redis');
    _client = Redis.fromEnv();
    _mode = 'upstash';
  }
  return _client;
}

function getStoreMode() {
  if (!_mode) createRedisClient();
  return _mode;
}

module.exports = {
  createRedisClient,
  getStoreMode,
  shouldUseLocalStore,
  hasUpstashEnv,
  isDeployedEnvironment,
  assertStoreReady,
};
