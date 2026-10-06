#!/usr/bin/env node
/**
 * WOS-73 — Dark mode UI consistency (Archive, New Form modal, shared tokens).
 * Usage: npm run templates:dark-mode-ui-consistency-test
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
  console.log('=== WOS-73 Dark Mode UI Consistency Test ===\n');

  const hubCss = fs.readFileSync(path.join(ROOT, 'hub.css'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const archiveJs = fs.readFileSync(path.join(ROOT, 'hub-unified-archive.js'), 'utf8');
  const sbSrc = fs.readFileSync(path.join(ROOT, 'template-section-builder.js'), 'utf8');

  assert('Archive filter buttons use hub-archive-filter class', archiveJs.includes('hub-archive-filter'));
  assert('Archive filter bar styled as pill buttons', hubCss.includes('.hub-archive-filter {'));
  assert('Archive filter active state uses hub teal', hubCss.includes('.hub-archive-filter.is-active'));
  assert('Archive filter dark mode active contrast', hubCss.includes('html[data-theme="dark"] .hub-archive-filter.is-active'));

  assert('Archive overview cards use hub tokens', hubCss.includes('.hub-archive-overview-card'));
  assert('Archive overview cards dark mode', hubCss.includes('html[data-theme="dark"] .hub-archive-overview-card'));

  assert('Archive page uses unified hub panel', indexHtml.includes('id="hubPageArchive"'));
  assert('Archive filter row in hub panel', indexHtml.includes('hub-archive-filter-row hub-quick-filters'));

  assert('New Form modal dark backdrop rule', indexHtml.includes('html[data-theme="dark"] .tmpl-modal-backdrop'));
  assert('New Form modal dark surface rule', indexHtml.includes('html[data-theme="dark"] .tmpl-modal {'));
  assert('New Form modal dark head/foot rule', indexHtml.includes('html[data-theme="dark"] .tmpl-modal-head'));
  assert('New Form modal dark input tokens', indexHtml.includes('html[data-theme="dark"] .tmpl-modal-body .input'));
  assert('New Form modal dark label tokens', indexHtml.includes('html[data-theme="dark"] .tmpl-modal-body .field label'));

  assert('Forms hub filter dark mode', indexHtml.includes('html[data-theme="dark"] .forms-hub-filter'));
  assert('Forms hub filter active dark mode', indexHtml.includes('html[data-theme="dark"] .forms-hub-filter.is-active'));
  assert('Visibility role wrap dark mode labels', indexHtml.includes('html[data-theme="dark"] .tmpl-launch-roles-wrap label'));

  assert('Preview removes traffic-light dots', !sbSrc.includes('tmpl-preview-dot-red'));
  assert('Preview uses Streamline header copy', sbSrc.includes('Updates as you edit'));
  assert('Preview frame chrome dark mode', indexHtml.includes('html[data-theme="dark"] .tmpl-preview-frame-chrome'));

  assert('Manage forms meta dark mode', indexHtml.includes('html[data-theme="dark"] .forms-manage-meta-body'));

  assert('WOS-74 workflow roles dark mode cards', hubCss.includes('html[data-theme="dark"] .hub-workflow-role-card'));
  assert('WOS-74 archive pagination dark active contrast', hubCss.includes('html[data-theme="dark"] #hubPageArchive .archive-page-size.is-active'));

  assert('WOS-74 builder tab strip dark mode', indexHtml.includes('html[data-theme="dark"] .tmpl-studio-tabs'));
  assert('WOS-74 builder tab active dark mode', indexHtml.includes('html[data-theme="dark"] .tmpl-studio-tab.is-active'));
  assert('WOS-74 read-only banner dark mode', indexHtml.includes('html[data-theme="dark"] .tmpl-readonly-banner'));
  assert('WOS-74 preview header dark mode', indexHtml.includes('html[data-theme="dark"] .tmpl-preview-header'));
  assert('WOS-74 preview section head dark mode', indexHtml.includes('html[data-theme="dark"] .tmpl-preview-section-head'));
  assert('WOS-74 hub.css builder tab dark mode', hubCss.includes('html[data-theme="dark"] .hub-shell .tmpl-studio-tabs'));
  assert('WOS-74 hub.css read-only banner dark mode', hubCss.includes('html[data-theme="dark"] .hub-shell .tmpl-readonly-banner'));
  assert('WOS-74 hub.css preview chrome dark mode', hubCss.includes('html[data-theme="dark"] .hub-shell .tmpl-preview-frame-chrome'));

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('RESULT: FAIL');
    process.exit(1);
  }
  console.log('RESULT: PASS');
}

main();
