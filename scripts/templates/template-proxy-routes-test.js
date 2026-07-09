#!/usr/bin/env node
/**
 * WOS-57 — Template API proxy routing tests.
 * Ensures /hub/templates/* is handled by the hub router (not MaintainX allowlist).
 * Usage: npm run templates:proxy-routes-test
 */
const { loadDbEnv } = require('../db/env');

loadDbEnv();
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.HUB_STORE_MODE = process.env.HUB_STORE_MODE || 'postgres';

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

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) {
      this.headers[k] = v;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    send(data) {
      this.body = data;
      return this;
    },
    end() {
      return this;
    },
  };
  return res;
}

async function invokeProxy(path, method = 'GET', body = null) {
  delete require.cache[require.resolve('../../api/maintainx.js')];
  const handler = require('../../api/maintainx.js');
  const req = {
    method,
    query: { path },
    headers: { 'x-portal-noauth': '1' },
    body: body != null ? JSON.stringify(body) : undefined,
  };
  const res = mockRes();
  await handler(req, res);
  return res;
}

/** Simulates the broken double-wrapped URL the UI used before WOS-57 fix. */
function doubleWrappedPath(innerPath) {
  return '/api/maintainx?path=' + encodeURIComponent(innerPath);
}

async function main() {
  console.log('=== WOS-57 Template Proxy Routes Test ===\n');

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const listRes = await invokeProxy('/hub/templates', 'GET');
  assert('/hub/templates reaches hub router', listRes.statusCode === 200, `status=${listRes.statusCode}`);
  assert('/hub/templates returns templates array', Array.isArray(listRes.body?.templates), JSON.stringify(listRes.body));

  const testKey = `proxy-route-${Date.now()}`;
  const starter = require('../../api/lib/templates/fixtures').newTemplateStarter();
  const createRes = await invokeProxy('/hub/templates', 'POST', {
    key: testKey,
    name: 'Proxy Route Test',
    description: 'WOS-57',
    ...starter,
  });
  assert('POST /hub/templates creates draft', createRes.statusCode === 201, JSON.stringify(createRes.body));
  assert('create returns draft version id', !!createRes.body?.draftVersion?.id);

  const versionId = createRes.body?.draftVersion?.id;
  if (versionId) {
    const validateRes = await invokeProxy(`/hub/templates/versions/${versionId}/validate`, 'POST', {});
    assert('POST validate returns ok', validateRes.body?.ok === true, JSON.stringify(validateRes.body));
    const publishRes = await invokeProxy(`/hub/templates/versions/${versionId}/publish`, 'POST', {});
    assert('POST publish succeeds', publishRes.statusCode === 200, JSON.stringify(publishRes.body));
  }

  try {
    const store = require('../../api/lib/templates/store.js');
    await store.deleteTemplateForTest(testKey);
  } catch {
    /* ignore cleanup */
  }

  const blockedRes = await invokeProxy('/maintainx/not-a-real-endpoint', 'GET');
  assert('unknown MaintainX path blocked', blockedRes.statusCode === 403);
  assert(
    'blocked path error message',
    blockedRes.body?.error === 'Path not allowed by proxy',
    JSON.stringify(blockedRes.body)
  );

  const doubleRes = await invokeProxy(doubleWrappedPath('/hub/templates'), 'GET');
  assert(
    'double-wrapped /api/maintainx?path= is blocked (403)',
    doubleRes.statusCode === 403,
    `status=${doubleRes.statusCode} body=${JSON.stringify(doubleRes.body)}`
  );
  assert(
    'double-wrap returns proxy block error',
    doubleRes.body?.error === 'Path not allowed by proxy',
    JSON.stringify(doubleRes.body)
  );

  const ui = require('../../template-registry-ui.js');
  assert('UI hubFetch uses direct hub path convention', typeof ui.TemplateRegistryUI._test.hubApiPath === 'function');
  assert('hubApiPath returns /hub/templates', ui.TemplateRegistryUI._test.hubApiPath('/hub/templates') === '/hub/templates');

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('RESULT: FAIL');
    process.exit(1);
  }
  console.log('RESULT: PASS');
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
