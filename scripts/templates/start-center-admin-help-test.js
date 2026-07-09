#!/usr/bin/env node
/**
 * WOS-81 — Admin Start Center / Help page.
 * Usage: npm run templates:start-center-admin-help-test
 */
const fs = require('fs');
const path = require('path');
const { ROOT } = require('../db/env');

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

const BANNED = [
  'App Spaces',
  'Launch Registry',
  'Template Studio',
  'schema_json',
  'compiled workflow',
  'WorkflowInstance',
];

function main() {
  console.log('=== Start Center Admin Help Test ===\n');

  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const hubJs = fs.readFileSync(path.join(ROOT, 'hub.js'), 'utf8');
  const hubCss = fs.readFileSync(path.join(ROOT, 'hub.css'), 'utf8');
  const rbacSrc = fs.readFileSync(path.join(ROOT, 'rbac-client.js'), 'utf8');
  const startCenterSrc = fs.readFileSync(path.join(ROOT, 'hub-start-center.js'), 'utf8');
  const startCenter = require('../../hub-start-center.js');

  // ---- Route ----
  assert('hub-start-center in HUB_NATIVE_TABS (hub.js)', hubJs.includes("'hub-start-center'"));
  assert('hub-start-center in HUB_NATIVE_TABS (index.html)', indexHtml.includes("'hub-start-center'"));
  assert('parseHash maps start-center', indexHtml.includes("tab === 'start-center'") && indexHtml.includes("'hub-start-center'"));
  assert('buildRouteHash returns #/start-center', hubJs.includes("if (tab === 'hub-start-center') return '#/start-center'"));
  assert('buildHash fallback #/start-center', indexHtml.includes("if (tab === 'hub-start-center') return '#/start-center'"));
  assert('knownTabs includes hub-start-center', indexHtml.includes("'hub-start-center'"));
  assert('hub page panel hubPageStartCenter', indexHtml.includes('id="hubPageStartCenter"') && indexHtml.includes('data-hub-page="hub-start-center"'));

  // ---- Nav + RBAC ----
  assert('sidebar nav Start Center label', indexHtml.includes('>Start Center</span>'));
  assert('nav data-hub-tab hub-start-center', indexHtml.includes('data-hub-tab="hub-start-center"'));
  assert('nav rbac key hub:start-center-admin', indexHtml.includes('data-rbac-key="hub:start-center-admin"'));
  assert('NAV_ITEM_RULES hub:start-center-admin', rbacSrc.includes("'hub:start-center-admin': { any: ['hub_admin', 'admin'] }"));
  assert('HUB_TAB_RULES hub-start-center', rbacSrc.includes("'hub-start-center': { any: ['hub_admin', 'admin'] }"));
  assert('applyRoute RBAC gates hub-start-center', (() => {
    const i = indexHtml.indexOf("'hub-reports','hub-settings'");
    return indexHtml.slice(i, i + 120).includes("'hub-start-center'");
  })());

  // ---- Init + access gate ----
  assert('initHubStartCenter defined', hubJs.includes('async function initHubStartCenter('));
  assert('onTabActivated wires hub-start-center', hubJs.includes("else if (tabName === 'hub-start-center') initHubStartCenter()"));
  assert('init checks canAccessHubTab', (() => {
    const i = hubJs.indexOf('async function initHubStartCenter');
    const block = hubJs.slice(i, i + 500);
    return block.includes("canAccessHubTab('hub-start-center')") && block.includes('renderAccessRestricted');
  })());

  // ---- Static content module ----
  assert('HubStartCenter module exports renderStartCenter', typeof startCenter.renderStartCenter === 'function');
  const html = startCenter.renderStartCenterHtml();
  assert('content includes Forms', html.includes('Forms'));
  assert('content includes Workflows', html.includes('Workflows'));
  assert('content includes New Request', html.includes('New Request'));
  assert('content includes Archive', html.includes('Archive'));
  assert('content includes Users and roles', html.includes('Users and roles'));
  assert('content mentions Archive → Forms', html.includes('Archive') && html.includes('Forms') && startCenterSrc.includes('Archive \\u2192 Forms'));
  assert('content explains role deactivate/delete', html.includes('cannot be hard-deleted') && html.includes('deactivated'));
  assert('content includes Reports', html.includes('Reports'));
  assert('content includes Analytics', html.includes('Analytics'));
  assert('content includes Request Queue', html.includes('Request Queue'));
  assert('content includes My Tasks', html.includes('My Tasks'));
  assert('content includes Settings', html.includes('Settings'));
  assert('launch checklist present', html.includes('Confirm it appears in Archive'));
  assert('troubleshooting section present', html.includes('Troubleshooting') || startCenterSrc.includes('TROUBLESHOOTING'));

  BANNED.forEach((term) => {
    assert(`Start Center does not mention banned term: ${term}`, !html.includes(term) && !startCenterSrc.includes(term));
  });

  // ---- Dark mode ----
  assert('Start Center CSS uses hub tokens', hubCss.includes('.hub-start-center-top-card') && hubCss.includes('var(--hub-surface'));
  assert('Start Center dark mode overrides', hubCss.includes('html[data-theme="dark"] .hub-start-center-top-card'));

  // ---- Existing admin nav preserved ----
  assert('Users nav still present', indexHtml.includes('data-hub-tab="hub-users"') && indexHtml.includes('>Users</span>'));
  assert('Settings nav still present', indexHtml.includes('data-hub-tab="hub-settings"') && indexHtml.includes('>Settings</span>'));
  assert('hub-start-center.js script included', indexHtml.includes('hub-start-center.js'));

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('RESULT: FAIL');
    process.exit(1);
  }
  console.log('RESULT: PASS');
}

main();
