#!/usr/bin/env node
/**
 * WOS-74 — Visual system cleanup (roles, archive, legacy forms, dark mode).
 * Usage: npm run ui:visual-consistency-test
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

function main() {
  console.log('=== WOS-74 Visual Consistency Test ===\n');

  const hubCss = fs.readFileSync(path.join(ROOT, 'hub.css'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const archiveJs = fs.readFileSync(path.join(ROOT, 'hub-unified-archive.js'), 'utf8');

  /* Roles catalog — display name primary, key secondary */
  assert('Roles catalog uses hub-workflow-role-name for title', indexHtml.includes('hub-workflow-role-name'));
  assert('Roles catalog does not inline key in title strong+code pattern', !indexHtml.includes('<strong>${escapeHtml(role.name)}</strong> <code class="mono">${escapeHtml(role.key)}</code>'));
  assert('Roles key shown as muted metadata', indexHtml.includes('hub-workflow-role-key-meta'));
  assert('Roles filter pills present', indexHtml.includes('data-wf-role-filter="all"'));
  assert('Roles filter pills include Active/System/Custom', indexHtml.includes('data-wf-role-filter="system"') && indexHtml.includes('data-wf-role-filter="custom"'));
  assert('Roles search input present', indexHtml.includes('id="hubWorkflowRolesSearch"'));
  assert('Roles filter function implemented', indexHtml.includes('function filterHubWorkflowRoles'));
  assert('Roles card layout CSS', hubCss.includes('.hub-workflow-role-card'));
  assert('Roles badge CSS (Active/System/Custom)', hubCss.includes('.hub-workflow-role-badge-system') && hubCss.includes('.hub-workflow-role-badge-custom'));
  assert('Roles dark mode card surfaces', hubCss.includes('html[data-theme="dark"] .hub-workflow-role-card'));

  /* Archive hub parity */
  assert('Archive page shell styled in hub.css', hubCss.includes('#hubPageArchive .archive-pagination'));
  assert('Archive embedded pagination uses hub tokens', hubCss.includes('.hub-archive-embedded .archive-pagination'));
  assert('Archive route state set before tab switch', (() => {
    const idx = indexHtml.indexOf('global._hubArchiveRoute');
    const switchIdx = indexHtml.indexOf('switchTab(target, routeOpts)', idx);
    return idx >= 0 && switchIdx > idx;
  })());
  assert('Archive filter click uses event delegation', archiveJs.includes('ensureArchiveFilterDelegation'));
  assert('Archive load deferred until panel mount', archiveJs.includes('requestAnimationFrame'));

  /* Legacy BOL form typography */
  assert('BOL section headers pin white text in dark mode', indexHtml.includes('html[data-theme="dark"] #panel-bol .bol-scope .section-header'));
  assert('BOL labels pin readable color in dark mode', indexHtml.includes('html[data-theme="dark"] #panel-bol .bol-scope label'));
  assert('BOL does not use broken color inherit on all descendants', !indexHtml.includes('.bol-scope *  { color: inherit; }'));
  assert('BOL hub section header keeps dark strip contrast', hubCss.includes('.hub-legacy-content .bol-scope .section-header') && hubCss.includes('background: #1a1a2e !important'));

  /* Metadata visibility — forms manage pattern unchanged */
  assert('Forms manage keeps key in meta body not title', indexHtml.includes('forms-manage-meta-body'));

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('RESULT: FAIL');
    process.exit(1);
  }
  console.log('RESULT: PASS');
}

main();
