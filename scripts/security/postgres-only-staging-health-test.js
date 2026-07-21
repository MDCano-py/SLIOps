#!/usr/bin/env node
/**
 * WOS-84 — PostgreSQL-only staging must not require Upstash/Redis.
 * Usage: npm run security:postgres-only-staging-health-test
 */
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

let passed = 0;
let failed = 0;

function assert(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function withEnv(overrides, fn) {
  const saved = { ...process.env };
  const keys = Object.keys(overrides);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined || v === null) delete process.env[k];
    else process.env[k] = String(v);
  }
  const restore = () => {
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(saved, k)) process.env[k] = saved[k];
      else delete process.env[k];
    }
  };
  try {
    const out = fn();
    if (out && typeof out.then === 'function') {
      return out.finally(restore);
    }
    restore();
    return out;
  } catch (err) {
    restore();
    throw err;
  }
}

function loadRedisClientFresh() {
  const id = require.resolve(path.join(ROOT, 'for-dev', 'redis-client.js'));
  delete require.cache[id];
  return require(id);
}

function clearHubDbCache() {
  const targets = [
    path.join(ROOT, 'api', 'lib', 'hub', 'db', 'index.js'),
    path.join(ROOT, 'api', 'lib', 'hub', 'db', 'postgres.js'),
    path.join(ROOT, 'api', 'lib', 'hub', 'db', 'config.js'),
    path.join(ROOT, 'api', 'lib', 'hub', 'store.js'),
    path.join(ROOT, 'api', 'lib', 'vendor', 'store.js'),
    path.join(ROOT, 'api', 'lib', 'vendor', 'db', 'kv.js'),
  ];
  for (const rel of targets) {
    try {
      delete require.cache[require.resolve(rel)];
    } catch {
      /* not loaded */
    }
  }
}

async function getJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let d = '';
        res.on('data', (c) => {
          d += c;
        });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(d) });
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

async function main() {
  console.log('=== WOS-84 PostgreSQL-only Staging Health Test ===\n');

  // --- Unit: postgres-only staging does not require Upstash ---
  withEnv(
    {
      NODE_ENV: 'staging',
      HUB_STORE_MODE: 'postgres',
      VENDOR_STORE_MODE: 'postgres',
      HUB_USE_LOCAL_STORE: '0',
      UPSTASH_REDIS_REST_URL: '',
      UPSTASH_REDIS_REST_TOKEN: '',
      KV_REST_API_URL: '',
      KV_REST_API_TOKEN: '',
      DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/hub',
    },
    () => {
      const rc = loadRedisClientFresh();
      rc.resetRedisClientForTests();
      assert('isPostgresOnlyMode true for staging postgres pair', rc.isPostgresOnlyMode());
      assert('shouldUseLocalStore false (no JSON fallback)', rc.shouldUseLocalStore() === false);
      let threw = false;
      try {
        rc.assertStoreReady();
      } catch (err) {
        threw = true;
        console.error('  assertStoreReady threw:', err.message);
      }
      assert('assertStoreReady does not throw without Upstash', !threw);
      const status = rc.getLegacyKvStatus();
      assert('legacy_kv status is disabled', status.legacy_kv === 'disabled');
      assert('redis_backend not_applicable', status.redis_backend === 'not_applicable');
      assert('getLegacyKvStatus does not init client', rc.isRedisClientInitialized() === false);
    }
  );

  // --- Unit: explicit redis mode on staging still requires Upstash ---
  withEnv(
    {
      NODE_ENV: 'staging',
      HUB_STORE_MODE: 'redis',
      VENDOR_STORE_MODE: 'redis',
      HUB_USE_LOCAL_STORE: '0',
      UPSTASH_REDIS_REST_URL: '',
      UPSTASH_REDIS_REST_TOKEN: '',
      DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/hub',
    },
    () => {
      const rc = loadRedisClientFresh();
      rc.resetRedisClientForTests();
      let threw = false;
      try {
        rc.assertStoreReady();
      } catch {
        threw = true;
      }
      assert('explicit redis staging requires Upstash (assertStoreReady throws)', threw);
      let createThrew = false;
      try {
        rc.createRedisClient();
      } catch {
        createThrew = true;
      }
      assert('explicit redis createRedisClient throws without Upstash', createThrew);
    }
  );

  // --- Unit: development local store still works ---
  withEnv(
    {
      NODE_ENV: 'development',
      HUB_STORE_MODE: '',
      VENDOR_STORE_MODE: '',
      HUB_USE_LOCAL_STORE: '1',
      UPSTASH_REDIS_REST_URL: '',
      UPSTASH_REDIS_REST_TOKEN: '',
    },
    () => {
      const rc = loadRedisClientFresh();
      rc.resetRedisClientForTests();
      assert('dev local store enabled', rc.shouldUseLocalStore() === true);
      const client = rc.createRedisClient();
      assert('dev getStoreMode is local', rc.getStoreMode() === 'local');
      assert('dev local client has get/set', typeof client.get === 'function' && typeof client.set === 'function');
    }
  );

  // --- Health HTTP: postgres-only staging, mock healthy Postgres ---
  await withEnv(
    {
      NODE_ENV: 'staging',
      HUB_STORE_MODE: 'postgres',
      VENDOR_STORE_MODE: 'postgres',
      HUB_USE_LOCAL_STORE: '0',
      UPSTASH_REDIS_REST_URL: '',
      UPSTASH_REDIS_REST_TOKEN: '',
      KV_REST_API_URL: '',
      KV_REST_API_TOKEN: '',
      DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/hub',
      PORT: String(19010 + Math.floor(Math.random() * 500)),
      HOST: '127.0.0.1',
      SESSION_SECRET: 'x'.repeat(48),
    },
    async () => {
      const rc = loadRedisClientFresh();
      rc.resetRedisClientForTests();
      clearHubDbCache();

      const hubDbPath = require.resolve(path.join(ROOT, 'api', 'lib', 'hub', 'db', 'index.js'));
      require.cache[hubDbPath] = {
        id: hubDbPath,
        filename: hubDbPath,
        loaded: true,
        exports: {
          getHubStoreMode: () => 'postgres',
          checkHubStoreHealth: async () => ({
            store_ok: true,
            store_error: null,
            hub_store_mode: 'postgres',
            store_mode: 'postgres',
            postgres: { connected: true, ok: true, mode: 'postgres', database_url_set: true },
            redis_backend: 'not_applicable',
            legacy_kv: 'disabled',
          }),
          getStore: () => ({}),
        },
      };

      delete require.cache[require.resolve(path.join(ROOT, 'scripts', 'server-core.js'))];
      const { createServer } = require(path.join(ROOT, 'scripts', 'server-core.js'));
      const { listen, buildHealthPayload } = createServer({
        envFiles: [],
        defaultNodeEnv: 'staging',
        defaultPort: Number(process.env.PORT) || 19010,
        defaultHost: '127.0.0.1',
        ensureArchiveDemoSeed: false,
      });

      const payload = await buildHealthPayload();
      assert('health payload ok=true when Postgres healthy', payload.ok === true);
      assert('health hub_store_mode=postgres', payload.hub_store_mode === 'postgres');
      assert('health store_mode=postgres', payload.store_mode === 'postgres');
      assert('health local_store_enabled=false', payload.local_store_enabled === false);
      assert('health legacy_kv=disabled', payload.legacy_kv === 'disabled');
      assert('health redis_backend=not_applicable', payload.redis_backend === 'not_applicable');
      assert('health redis_configured=false', payload.redis_configured === false);
      assert(
        'health path did not initialize Redis client',
        rc.isRedisClientInitialized() === false
      );

      const { server, port } = await listen();
      try {
        const { status, body } = await getJson(`http://127.0.0.1:${port}/health`);
        assert('GET /health returns 200', status === 200);
        assert('GET /health body.ok=true', body.ok === true);
        assert('GET /health hub_store_mode=postgres', body.hub_store_mode === 'postgres');
        assert('GET /health no local JSON fallback', body.local_store_enabled === false);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }

      delete require.cache[hubDbPath];
      clearHubDbCache();
    }
  );

  // --- Startup listen succeeds without Upstash (postgres mode asserts DATABASE_URL only) ---
  await withEnv(
    {
      NODE_ENV: 'staging',
      HUB_STORE_MODE: 'postgres',
      VENDOR_STORE_MODE: 'postgres',
      HUB_USE_LOCAL_STORE: '0',
      UPSTASH_REDIS_REST_URL: '',
      UPSTASH_REDIS_REST_TOKEN: '',
      DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/hub',
      PORT: String(19510 + Math.floor(Math.random() * 500)),
      HOST: '127.0.0.1',
      SESSION_SECRET: 'x'.repeat(48),
    },
    async () => {
      const rc = loadRedisClientFresh();
      rc.resetRedisClientForTests();
      clearHubDbCache();
      const hubDbPath = require.resolve(path.join(ROOT, 'api', 'lib', 'hub', 'db', 'index.js'));
      require.cache[hubDbPath] = {
        id: hubDbPath,
        filename: hubDbPath,
        loaded: true,
        exports: {
          getHubStoreMode: () => 'postgres',
          checkHubStoreHealth: async () => ({
            store_ok: true,
            hub_store_mode: 'postgres',
            postgres: { connected: true },
          }),
          getStore: () => ({}),
        },
      };
      // Also stub config assert path used at listen()
      const cfgPath = require.resolve(path.join(ROOT, 'api', 'lib', 'hub', 'db', 'config.js'));
      const realCfg = require(cfgPath);
      require.cache[cfgPath].exports = {
        ...realCfg,
        getHubStoreMode: () => 'postgres',
        assertPostgresConfigured: () => {},
      };

      delete require.cache[require.resolve(path.join(ROOT, 'scripts', 'server-core.js'))];
      const { createServer } = require(path.join(ROOT, 'scripts', 'server-core.js'));
      const { listen } = createServer({
        envFiles: [],
        defaultNodeEnv: 'staging',
        defaultPort: Number(process.env.PORT) || 19510,
        defaultHost: '127.0.0.1',
        ensureArchiveDemoSeed: false,
      });
      let started = false;
      let server;
      try {
        const out = await listen();
        server = out.server;
        started = true;
      } catch (err) {
        console.error('  listen error:', err.message);
      }
      assert('staging postgres-only listen() starts without Upstash', started);
      if (server) await new Promise((resolve) => server.close(resolve));
      delete require.cache[hubDbPath];
      clearHubDbCache();
    }
  );

  // --- Source: archive demo seed remains development-only ---
  {
    const fs = require('fs');
    const serverCore = fs.readFileSync(path.join(ROOT, 'scripts', 'server-core.js'), 'utf8');
    assert(
      'archive demo seed gated to NODE_ENV=development',
      /ensureArchiveDemoSeed[\s\S]*NODE_ENV === 'development'/.test(serverCore)
    );
    assert(
      'buildHealthPayload uses getLegacyKvStatus',
      serverCore.includes('getLegacyKvStatus')
    );
  }

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('RESULT: FAIL');
    process.exit(1);
  }
  console.log('RESULT: PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
