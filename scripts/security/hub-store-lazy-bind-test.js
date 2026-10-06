#!/usr/bin/env node
/**
 * Hub store must bind lazily so loadDbEnv() can set HUB_STORE_MODE=postgres
 * before the first outbox write.
 * Usage: node scripts/security/hub-store-lazy-bind-test.js
 */
'use strict';

const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
let passed = 0;
let failed = 0;

function ok(name, cond) {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}`);
  }
}

function clearHubStoreModules() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}api${path.sep}lib${path.sep}hub${path.sep}db${path.sep}`) ||
      key.endsWith(`${path.sep}hub${path.sep}store.js`) ||
      key.endsWith(`${path.sep}hub${path.sep}store${path.sep}index.js`)
    ) {
      delete require.cache[key];
    }
  }
}

function main() {
  console.log('=== Hub store lazy bind ===\n');

  const prev = {
    HUB_STORE_MODE: process.env.HUB_STORE_MODE,
    DATABASE_URL: process.env.DATABASE_URL,
    HUB_USE_LOCAL_STORE: process.env.HUB_USE_LOCAL_STORE,
  };

  try {
    delete process.env.HUB_STORE_MODE;
    delete process.env.DATABASE_URL;
    process.env.HUB_USE_LOCAL_STORE = '1';
    clearHubStoreModules();

    const hubDb = require(path.join(ROOT, 'api/lib/hub/db/index.js'));
    ok('require does not throw before env', !!hubDb);
    ok('mode before env is not forced postgres', hubDb.getHubStoreMode() !== 'postgres');

    // Simulate late .env.staging load (as cutover smoke must do).
    process.env.HUB_STORE_MODE = 'postgres';
    process.env.DATABASE_URL = 'postgres://user:pass@127.0.0.1:5432/wos';
    process.env.HUB_USE_LOCAL_STORE = '0';
    hubDb.resetHubStoreForTests();

    ok('mode after env is postgres', hubDb.getHubStoreMode() === 'postgres');
    ok('getStore returns postgres adapter after reset', typeof hubDb.getStore().queueEmailDeliveryEvent === 'function');
    ok('proxy exposes queueEmailDeliveryEvent', typeof hubDb.queueEmailDeliveryEvent === 'function');
  } catch (err) {
    failed += 1;
    console.error('FAIL  unexpected error —', err.message);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    clearHubStoreModules();
  }

  // Smoke test source order: loadDbEnv before notify require
  const fs = require('fs');
  const smoke = fs.readFileSync(path.join(ROOT, 'scripts/rds-staging-smoke-test.js'), 'utf8');
  const loadIdx = smoke.indexOf('loadDbEnv()');
  const notifyIdx = smoke.indexOf("require('../api/lib/vendor/notifications')");
  ok('smoke loadDbEnv before notifications require', loadIdx >= 0 && notifyIdx > loadIdx);
  ok('smoke asserts hub store postgres before enqueue', /hub store mode postgres before outbox enqueue/.test(smoke));
  ok('smoke documents disable flags do not skip persist', /HUB_WORKER_ENABLE_EMAIL\/INTEGRATIONS=false only skips dispatch/.test(smoke));

  console.log(`\nChecks: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('RESULT: FAIL');
    process.exit(1);
  }
  console.log('RESULT: PASS');
}

main();
