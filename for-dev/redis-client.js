/**
 * Redis / local-JSON / optional ephemeral KV client factory.
 *
 * WOS-84 — PostgreSQL-only staging/production is supported:
 * when HUB_STORE_MODE=postgres (and vendor is postgres or unset), Upstash is
 * NOT required. Legacy Redis init is skipped for health; createRedisClient()
 * returns an ephemeral in-memory stub (never the local JSON file store) so
 * maintainx portal-permission helpers do not crash. Explicit redis / local_json
 * modes keep prior behavior.
 */

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

/**
 * True when Postgres is the intentional system of record for hub (+ vendor).
 * Vendor defaults to hub mode when VENDOR_STORE_MODE is unset.
 */
function isPostgresOnlyMode() {
  const hub = String(process.env.HUB_STORE_MODE || process.env.HUB_STORE || '')
    .toLowerCase()
    .trim();
  if (hub !== 'postgres') return false;
  const vendor = String(process.env.VENDOR_STORE_MODE || hub || '')
    .toLowerCase()
    .trim();
  return vendor === 'postgres' || vendor === '';
}

function shouldUseLocalStore() {
  const force = (process.env.HUB_USE_LOCAL_STORE || '').toLowerCase();
  if (force === '0' || force === 'false') return false;
  // Never fall back to local JSON when Postgres is the selected SoR.
  if (isPostgresOnlyMode()) return false;
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
  // Explicit redis mode should not auto-pick local JSON.
  const hub = String(process.env.HUB_STORE_MODE || '').toLowerCase().trim();
  if (hub === 'redis') return false;
  return !hasUpstashEnv();
}

function assertStoreReady() {
  // WOS-84 — Postgres-only deployed mode does not require Upstash.
  if (isPostgresOnlyMode()) return;
  if (isDeployedEnvironment() && !hasUpstashEnv() && !shouldUseLocalStore()) {
    throw new Error(
      'Staging/production requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN when HUB_STORE_MODE is not postgres (or set HUB_USE_LOCAL_STORE=1 for single-user debug only)'
    );
  }
}

/**
 * Minimal Redis-compatible in-memory stub for Postgres-only mode without Upstash.
 * Does NOT touch for-dev/local-hub-data/redis.json.
 */
function createMemoryRedisStub() {
  const strings = new Map();
  const sets = new Map();
  const zsets = new Map();
  const lists = new Map();

  function ensureSet(key) {
    if (!sets.has(key)) sets.set(key, new Set());
    return sets.get(key);
  }
  function ensureZ(key) {
    if (!zsets.has(key)) zsets.set(key, new Map());
    return zsets.get(key);
  }
  function ensureList(key) {
    if (!lists.has(key)) lists.set(key, []);
    return lists.get(key);
  }

  const client = {
    async get(key) {
      return strings.has(key) ? strings.get(key) : null;
    },
    async set(key, value) {
      strings.set(key, typeof value === 'string' ? value : JSON.stringify(value));
      return 'OK';
    },
    async del(...keys) {
      let n = 0;
      for (const k of keys.flat()) {
        if (strings.delete(k) || sets.delete(k) || zsets.delete(k) || lists.delete(k)) n += 1;
      }
      return n;
    },
    async mget(...keys) {
      const flat = keys.flat();
      return Promise.all(flat.map((k) => client.get(k)));
    },
    async incr(key) {
      const cur = Number(strings.get(key) || 0) + 1;
      strings.set(key, String(cur));
      return cur;
    },
    async smembers(key) {
      return Array.from(ensureSet(key));
    },
    async sadd(key, ...members) {
      const s = ensureSet(key);
      let added = 0;
      for (const m of members.flat()) {
        const before = s.size;
        s.add(m);
        if (s.size > before) added += 1;
      }
      return added;
    },
    async srem(key, ...members) {
      const s = ensureSet(key);
      let n = 0;
      for (const m of members.flat()) {
        if (s.delete(m)) n += 1;
      }
      return n;
    },
    async zadd(key, ...args) {
      const z = ensureZ(key);
      // Upstash style: zadd(key, { score, member }) or score, member pairs
      if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
        const { score, member } = args[0];
        z.set(String(member), Number(score));
        return 1;
      }
      for (let i = 0; i < args.length; i += 2) {
        z.set(String(args[i + 1]), Number(args[i]));
      }
      return Math.floor(args.length / 2);
    },
    async zrange(key, start, stop, opts = {}) {
      const z = ensureZ(key);
      let entries = Array.from(z.entries());
      if (opts.byScore) {
        entries = entries.filter(([, score]) => score >= start && score <= stop);
        entries.sort((a, b) => a[1] - b[1]);
        if (opts.rev) entries.reverse();
        return entries.map(([m]) => m);
      }
      entries.sort((a, b) => a[1] - b[1]);
      if (opts.rev) entries.reverse();
      const arr = entries.map(([m]) => m);
      const end = stop < 0 ? arr.length + stop + 1 : stop + 1;
      return arr.slice(start, end);
    },
    async zcard(key) {
      return ensureZ(key).size;
    },
    async lpush(key, ...values) {
      const list = ensureList(key);
      for (const v of values.flat().reverse()) list.unshift(v);
      return list.length;
    },
    async lrange(key, start, stop) {
      const list = ensureList(key);
      const end = stop < 0 ? list.length + stop + 1 : stop + 1;
      return list.slice(start, end);
    },
    async ltrim(key, start, stop) {
      const list = ensureList(key);
      const end = stop < 0 ? list.length + stop + 1 : stop + 1;
      const next = list.slice(start, end);
      lists.set(key, next);
      return 'OK';
    },
    pipeline() {
      const ops = [];
      const api = {
        set(...a) {
          ops.push(() => client.set(...a));
          return api;
        },
        sadd(...a) {
          ops.push(() => client.sadd(...a));
          return api;
        },
        srem(...a) {
          ops.push(() => client.srem(...a));
          return api;
        },
        del(...a) {
          ops.push(() => client.del(...a));
          return api;
        },
        zadd(...a) {
          ops.push(() => client.zadd(...a));
          return api;
        },
        lpush(...a) {
          ops.push(() => client.lpush(...a));
          return api;
        },
        ltrim(...a) {
          ops.push(() => client.ltrim(...a));
          return api;
        },
        async exec() {
          const out = [];
          for (const op of ops) out.push(await op());
          return out;
        },
      };
      return api;
    },
  };
  return client;
}

function createRedisClient() {
  if (_client) return _client;
  assertStoreReady();

  // Explicit local JSON (dev) — never used for postgres-only SoR.
  if (shouldUseLocalStore()) {
    const { createLocalRedis } = require('./local-redis');
    _client = createLocalRedis();
    _mode = 'local';
    console.log(
      '[hub] Local store: for-dev/local-hub-data/redis.json (no Upstash/Vercel required)'
    );
    return _client;
  }

  if (hasUpstashEnv()) {
    const { Redis } = require('@upstash/redis');
    _client = Redis.fromEnv();
    _mode = 'upstash';
    return _client;
  }

  // WOS-84 — Postgres-only without Upstash: ephemeral memory stub (not local JSON).
  if (isPostgresOnlyMode()) {
    _client = createMemoryRedisStub();
    _mode = 'disabled';
    if (isDeployedEnvironment()) {
      console.log(
        '[hub] Legacy Redis/Upstash disabled — PostgreSQL is system of record (ephemeral in-memory KV stub for legacy helpers)'
      );
    }
    return _client;
  }

  // Explicit redis mode (or undeployed without local) still needs credentials.
  throw new Error(
    'Redis/Upstash is not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or HUB_USE_LOCAL_STORE=1 for local development, or HUB_STORE_MODE=postgres for PostgreSQL-only mode.'
  );
}

function getStoreMode() {
  if (!_mode) createRedisClient();
  return _mode;
}

/** Health/status helper — does not initialize a Redis connection. */
function getLegacyKvStatus() {
  if (isPostgresOnlyMode() && !hasUpstashEnv()) {
    return {
      legacy_kv: 'disabled',
      redis_backend: 'not_applicable',
      redis_configured: false,
      local_store_enabled: false,
      postgres_only: true,
    };
  }
  if (hasUpstashEnv()) {
    return {
      legacy_kv: 'upstash',
      redis_backend: 'upstash',
      redis_configured: true,
      local_store_enabled: false,
      postgres_only: isPostgresOnlyMode(),
    };
  }
  if (shouldUseLocalStore()) {
    return {
      legacy_kv: 'local_json',
      redis_backend: 'local',
      redis_configured: false,
      local_store_enabled: true,
      postgres_only: false,
    };
  }
  return {
    legacy_kv: 'unconfigured',
    redis_backend: null,
    redis_configured: false,
    local_store_enabled: false,
    postgres_only: isPostgresOnlyMode(),
  };
}

/** Reset singleton — tests only. */
function resetRedisClientForTests() {
  _client = null;
  _mode = null;
}

/** True when createRedisClient() has already materialized a client. Tests only. */
function isRedisClientInitialized() {
  return _client != null;
}

module.exports = {
  createRedisClient,
  getStoreMode,
  shouldUseLocalStore,
  hasUpstashEnv,
  isDeployedEnvironment,
  assertStoreReady,
  isPostgresOnlyMode,
  getLegacyKvStatus,
  resetRedisClientForTests,
  isRedisClientInitialized,
  createMemoryRedisStub,
};
