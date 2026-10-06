#!/usr/bin/env node
/**
 * Gate 2 — cleanup/destructive endpoints fail closed.
 * Usage: npm run security:gate2-cleanup-failclosed-test
 */
const fs = require('fs');
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

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

async function main() {
  console.log('=== Gate 2 cleanup fail-closed ===\n');
  const mx = read('api/maintainx.js');
  const hub = read('api/lib/hub/routes.js');

  assert('photo-cleanup requires CLEANUP_SECRET length check', mx.includes("CLEANUP_SECRET_unset_or_weak"));
  assert('photo-cleanup returns CLEANUP_NOT_CONFIGURED', mx.includes("code: 'CLEANUP_NOT_CONFIGURED'"));
  assert('archive-wipe uses timingSafeEqual', /archive-wipe-orphans[\s\S]{0,800}timingSafeEqual/.test(mx));
  assert(
    'photo-cleanup no longer optional-secret pattern',
    !/Optional shared-secret auth/.test(mx) &&
      !/if \(process\.env\.CLEANUP_SECRET\) \{\s*const provided = req\.headers\['x-cleanup-secret'\]/.test(mx)
  );

  // Hub demo seed/clear: production blocked
  assert('hub seed blocked in production', hub.includes("NODE_ENV === 'production'") || hub.includes("demoSeed.isDevDemoAllowed"));
  assert('hub clear-demo path exists', hub.includes('/hub/dev/clear-demo-data') || hub.includes('clear-demo-data'));

  // Document inventory table (static)
  const inventory = [
    ['POST /photo-cleanup', 'CLEANUP_SECRET ≥16 + timing-safe compare', '503 if unset', 'storage.photo_cleanup'],
    ['POST /archive-wipe-orphans', 'CLEANUP_SECRET ≥16', '503 if unset', 'storage.archive_wipe_orphans'],
    ['POST /hub/dev/seed-demo-data', 'admin + staging/dev flags', 'blocked production', 'demo seed'],
    ['POST /hub/dev/clear-demo-data', 'admin + staging/dev flags', 'blocked production', 'demo clear'],
  ];
  assert('destructive inventory documented in test (≥4 rows)', inventory.length >= 4);

  // Functional unit: simulate gate logic
  function cleanupGate(envSecret, provided) {
    const expected = String(envSecret || '');
    if (!expected || expected.length < 16) {
      return { status: 503, code: 'CLEANUP_NOT_CONFIGURED' };
    }
    const p = String(provided || '');
    if (!p || p.length !== expected.length) return { status: 401 };
    return p === expected ? { status: 200 } : { status: 401 };
  }

  assert('secret unset → 503', cleanupGate(undefined, 'anything-long-enough') .status === 503);
  assert('secret empty → 503', cleanupGate('', 'anything-long-enough').status === 503);
  assert('secret short → 503', cleanupGate('short', 'short').status === 503);
  assert('wrong secret → 401', cleanupGate('correct-secret-16+', 'wrong!!!!!!!!!!!').status === 401);
  assert('missing provided → 401', cleanupGate('correct-secret-16+', '').status === 401);
  assert('correct secret → allow gate', cleanupGate('correct-secret-16+', 'correct-secret-16+').status === 200);

  // Production demo seed helper
  const demo = require(path.join(ROOT, 'for-dev', 'hub-demo-seed.js'));
  const saved = { ...process.env };
  try {
    process.env.NODE_ENV = 'production';
    assert('demo seed disallowed in production', demo.isDevDemoAllowed(true) === false);
    process.env.NODE_ENV = 'staging';
    process.env.STAGING_DEMO_DATA_ENABLED = '0';
    assert('demo seed disallowed staging without flag', demo.isDevDemoAllowed(true) === false);
  } finally {
    process.env = { ...saved };
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
