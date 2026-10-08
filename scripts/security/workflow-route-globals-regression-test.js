#!/usr/bin/env node
/**
 * Regression: workflow / configuration routes must not throw ReferenceError
 * for bare `global` / `globals` in the browser portal router.
 *
 * Usage: BASE_URL=http://127.0.0.1:3010 npm run security:workflow-route-globals-regression-test
 * Static checks always run; Playwright checks run when BASE_URL is set (or default :3010 healthy).
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

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

console.log('=== Workflow route global/globals regression ===\n');

const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const applyRouteBlock = indexHtml.slice(
  indexHtml.indexOf('function applyRoute('),
  indexHtml.indexOf('async function deepLinkUnifiedArchive')
);
assert(
  'applyRoute does not assign bare global._hub*',
  !/\bglobal\._hub(Archive|Workflow|Template|Space|Launch|Submission)Route\b/.test(applyRouteBlock)
);
assert(
  'applyRoute uses window._hub* route bags',
  /window\._hubArchiveRoute\s*=/.test(applyRouteBlock) && /window\._hubWorkflowRoute\s*=/.test(applyRouteBlock)
);
assert(
  'buildHash does not use bare global.HubUnifiedArchive',
  !/\bglobal\.HubUnifiedArchive\b/.test(indexHtml) || /window\.HubUnifiedArchive/.test(indexHtml)
);
assert('no bare globals identifier in index.html router', !/\bglobals\b/.test(applyRouteBlock));

for (const f of ['hub-workflow-simple-builder.js', 'hub-control-room.js']) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  assert(`${f} has no unsafe ? window : global) footer`, !src.includes('? window : global)'));
  assert(`${f} uses globalThis-safe bootstrap`, /globalThis/.test(src));
}

async function probeBase(baseUrl) {
  return new Promise((resolve) => {
    const req = http.get(baseUrl.replace(/\/$/, '') + '/health', (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

(async () => {
  const base = (process.env.BASE_URL || 'http://127.0.0.1:3010').replace(/\/$/, '');
  const healthy = await probeBase(base);
  if (!healthy) {
    console.log(`SKIP  Playwright route probe (${base} not healthy)`);
  } else {
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    const routes = [
      `${base}/?_noauth=1#/configuration`,
      `${base}/?_noauth=1#/configuration/workflows`,
      `${base}/?_noauth=1#/forms/approval-routes`,
    ];
    for (const url of routes) {
      pageErrors.length = 0;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2000);
      const globalRefs = pageErrors.filter((e) => /global/i.test(e.message));
      assert(
        `no uncaught global ReferenceError on ${url.split('#')[1] || url}`,
        globalRefs.length === 0,
        globalRefs.map((e) => e.message).join('; ')
      );
      const builders = await page.evaluate(
        () => !!(window.HubWorkflowSimpleBuilder || window.HubConfigurationCenter || window.HubWorkflowDesigner)
      );
      assert(`workflow builders attached after ${url.split('#')[1]}`, builders);
    }
    await browser.close();
  }

  console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
  if (failed) process.exit(1);
  console.log('RESULT: PASS');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
