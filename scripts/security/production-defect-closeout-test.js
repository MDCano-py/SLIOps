#!/usr/bin/env node
/**
 * WOS-92 — Production defect closeout regression checks (not a pentest).
 */
const path = require('path');
const fs = require('fs');

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

function main() {
  console.log('=== WOS-92 Production Defect Closeout Test ===\n');

  // --- Start Center Admin Setup scroll targets ---
  const startCenter = require(path.join(ROOT, 'hub-start-center.js'));
  const html = startCenter.renderStartCenterHtml();
  const targets = [...html.matchAll(/data-scroll-target="([^"]+)"/g)].map((m) => m[1]);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert('Start Center has Admin setup card', /Admin setup/i.test(html));
  assert(
    'every top-card scroll target has a matching section id',
    targets.every((t) => ids.includes(t)),
    `missing=${targets.filter((t) => !ids.includes(t)).join(',')}`
  );
  assert('Admin setup targets sc-admin-setup-flow', targets.includes('sc-admin-setup-flow'));
  assert('Start here targets sc-overview', targets.includes('sc-overview'));

  const hubJs = read('hub.js');
  const indexHtml = read('index.html');
  const rbac = read('rbac-client.js');

  assert('sidebar Start Center nav present', /data-hub-tab="hub-start-center"/.test(indexHtml));
  assert('Start Center RBAC admin-only', /'hub-start-center':\s*\{\s*any:\s*\['hub_admin',\s*'admin'\]/.test(rbac));
  assert('initHubStartCenter gates unauthorized', /canAccessHubTab\('hub-start-center'\)/.test(hubJs));
  assert('hash maps #/start-center', /tab === 'start-center'/.test(indexHtml) && /'hub-start-center'/.test(indexHtml));
  assert('onTabActivated wires start center', /tabName === 'hub-start-center'\) initHubStartCenter\(\)/.test(hubJs));

  // --- Account menu / sign-out ---
  assert('portalSignOut shared helper', /window\.portalSignOut\s*=\s*function/.test(indexHtml));
  assert('portalSignOut navigates to logout API', /appPath\('\/api\/auth\/logout'\)/.test(indexHtml));
  assert('sign-out sets BFCache marker', /sliops_signed_out/.test(indexHtml));
  assert('pageshow BFCache guard present', /pageshow/.test(indexHtml) && /event\.persisted/.test(indexHtml));
  assert(
    'hub account menu Sign out uses portalSignOut',
    /function wireAccountMenu[\s\S]*?portalSignOut[\s\S]*?chip\.dataset\.accountWired/.test(hubJs) ||
      /hubAccountSignOut[\s\S]{0,1200}portalSignOut/.test(hubJs)
  );
  assert('portal user menu Sign out uses portalSignOut', /userMenuLogoutBtn[\s\S]{0,500}portalSignOut/.test(indexHtml) || /function showUserMenu[\s\S]*portalSignOut/.test(indexHtml));
  assert('successful /me clears signed-out marker', /removeItem\('sliops_signed_out'\)/.test(indexHtml));

  // --- Production language ---
  assert('Settings integrations card does not say n8n', !/MaintainX, n8n, Postgres/.test(indexHtml));
  assert('Settings integrations card says Automation', /Automation webhooks/.test(indexHtml));
  assert('integrations view includes object_storage', /'object_storage'/.test(indexHtml));
  assert('vendor upload shows S3 not-configured message', /Document storage is not configured \(Amazon S3\)/.test(indexHtml));
  assert('health panel shows MaintainX not configured path', /maintainx_configured \? 'Configured' : 'Not configured'/.test(hubJs));
  assert('health panel shows object storage', /object_storage_configured/.test(hubJs));

  // --- Optional integration honesty (server) ---
  const mx = read('api/maintainx.js');
  assert('integrations-status exposes object_storage', /object_storage:/.test(mx));
  assert('MaintainX missing key message honest', /Set MAINTAINX_API_KEY/.test(mx));
  assert('Automation delivery label (no user-facing n8n)', /label: 'Automation delivery'/.test(mx));

  // --- RDS no silent local fallback ---
  const cfg = read('api/lib/hub/db/config.js');
  assert('postgres mode refuses missing DATABASE_URL', /HUB_STORE_MODE=postgres requires DATABASE_URL/.test(cfg));
  const redisClient = read('for-dev/redis-client.js');
  assert('postgres-only never uses local JSON', /Never fall back to local JSON when Postgres/.test(redisClient));

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('RESULT: FAIL');
    process.exit(1);
  }
  console.log('RESULT: PASS');
}

main();
