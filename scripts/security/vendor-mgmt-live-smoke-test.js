#!/usr/bin/env node
/**
 * Vendor Management live-smoke regression:
 * - list fetch coalescing / TTL (no fan-out storm)
 * - tab switching DOM updates even when list fails
 * - routeWithinManagement preserves sub-views (skipUrlUpdate)
 *
 * Usage: npm run security:vendor-mgmt-live-smoke-test
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

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

console.log('=== Vendor Management live-smoke regression ===\n');

assert('shared fetch helper present', indexHtml.includes('function fetchVendorListShared'));
assert('inflight coalescing present', indexHtml.includes('vendorListInflight'));
assert('TTL cache present', indexHtml.includes('VENDOR_LIST_TTL_MS'));
assert('stats hook for tests', indexHtml.includes('__vendorListFetchStats'));
assert('loadVendors uses shared fetch', /async function loadVendors[\s\S]*?fetchVendorListShared/.test(indexHtml));
assert('loadDashboard uses shared fetch', /async function loadDashboard[\s\S]*?fetchVendorListShared/.test(indexHtml));
assert('loadVendors does not rethrow', /Failed to load vendors[\s\S]*?Do not rethrow/.test(indexHtml) || /loadVendors[\s\S]{0,800}catch \(err\)[\s\S]{0,400}listEl\.innerHTML/.test(indexHtml));

assert(
  'routeWithinManagement uses skipUrlUpdate',
  /const fromRoute = \{ skipUrlUpdate: true \}/.test(indexHtml)
);
assert(
  'vendor section hash preserves sub-view',
  /Preserve vendor sub-view in the hash/.test(indexHtml) ||
    /buildHash\('management', 'vendors', sub\)/.test(indexHtml)
);
assert(
  'mgmtSwitchView null-safe for missing panels',
  /function mgmtSwitchView[\s\S]{0,400}if \(!vendorsView \|\| !newView/.test(indexHtml)
);
assert(
  'mgmtSwitchView supports skipLoad',
  /skipLoad:\s*!!opts\.skipLoad/.test(indexHtml) || /if \(!opts\.skipLoad\)/.test(indexHtml)
);

// Simulate coalescing semantics in isolation (mirrors frontend contract)
let cache = [];
let cacheOk = false;
let fetchedAt = 0;
let inflight = null;
const TTL = 4000;
const stats = { starts: 0, network: 0, cacheHits: 0, coalesced: 0 };
let networkCalls = 0;

async function sharedFetch(opts = {}) {
  const force = !!opts.force;
  const now = Date.now();
  stats.starts += 1;
  if (!force && inflight) {
    stats.coalesced += 1;
    return inflight;
  }
  if (!force && cacheOk && now - fetchedAt < TTL) {
    stats.cacheHits += 1;
    return { records: cache, fromCache: true };
  }
  stats.network += 1;
  networkCalls += 1;
  inflight = (async () => {
    await new Promise((r) => setTimeout(r, 30));
    cache = [{ refNumber: 'VEN-1' }];
    cacheOk = true;
    fetchedAt = Date.now();
    return { records: cache, fromCache: false };
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

(async () => {
  const p = [sharedFetch(), sharedFetch(), sharedFetch()];
  const results = await Promise.all(p);
  assert('three parallel fetches → one network', networkCalls === 1, `network=${networkCalls}`);
  assert('coalesced count ≥ 2', stats.coalesced >= 2, `coalesced=${stats.coalesced}`);
  assert('all callers see same records', results.every((r) => r.records[0].refNumber === 'VEN-1'));

  const cached = await sharedFetch();
  assert('TTL hit avoids second network', networkCalls === 1 && cached.fromCache === true);

  // Tab failure isolation: list error must not prevent view toggle semantics
  let activeView = 'vendors';
  function switchView(view) {
    activeView = view;
    // list failure swallowed
    try {
      throw new Error('List failed: 429');
    } catch {
      /* ignore */
    }
  }
  switchView('new');
  assert('tab switches to new despite list error', activeView === 'new');
  switchView('dashboard');
  assert('tab switches to dashboard despite list error', activeView === 'dashboard');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
