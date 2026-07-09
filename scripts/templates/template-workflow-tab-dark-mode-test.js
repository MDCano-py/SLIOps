#!/usr/bin/env node
/**
 * WOS-77 — Forms builder Workflow tab dark mode.
 * Usage: npm run templates:workflow-tab-dark-mode-test
 *
 * Static source checks that the workflow tab builder surfaces (step cards,
 * badges, dropdowns, binding section, warning/error panels, checkboxes) have
 * dark-mode overrides mapped onto hub tokens instead of light hex fallbacks.
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
  console.log('=== WOS-77 Workflow Tab Dark Mode Test ===\n');

  const hubCss = fs.readFileSync(path.join(ROOT, 'hub.css'), 'utf8');
  const registryUi = fs.readFileSync(path.join(ROOT, 'template-registry-ui.js'), 'utf8');

  // Step cards must not stay light in dark mode.
  assert(
    'Workflow step cards have dark-mode surface override',
    hubCss.includes('html[data-theme="dark"] .hub-shell .tmpl-step-row')
  );
  assert(
    'Step cards use hub dark surface token',
    /\.tmpl-step-row[\s\S]*?background: var\(--hub-surface-2\)/.test(
      hubCss.slice(hubCss.indexOf('WOS-77'))
    )
  );

  // Fill / Review / Sign / Approve / Upload badges readable in dark mode.
  assert('Step type badge base dark override', hubCss.includes('html[data-theme="dark"] .hub-shell .tmpl-step-type-badge'));
  assert('Review badge dark override', hubCss.includes('html[data-theme="dark"] .hub-shell .tmpl-step-type-Review'));
  assert('Sign badge dark override', hubCss.includes('html[data-theme="dark"] .hub-shell .tmpl-step-type-Sign'));
  assert('Upload badge dark override', hubCss.includes('html[data-theme="dark"] .hub-shell .tmpl-step-type-Upload'));
  assert('Approve badge dark override', hubCss.includes('html[data-theme="dark"] .hub-shell .tmpl-step-type-Approve'));

  // Dropdowns / inputs.
  assert(
    'Workflow builder dropdowns dark override',
    hubCss.includes('html[data-theme="dark"] .hub-shell .tmpl-step-row select.input')
  );
  assert(
    'Binding section select dark override',
    hubCss.includes('html[data-theme="dark"] .hub-shell .tmpl-binding-section select')
  );

  // Workflow Binding section.
  assert(
    'Workflow Binding section dark override',
    hubCss.includes('html[data-theme="dark"] .hub-shell .tmpl-binding-section')
  );
  assert(
    'Workflow Binding status text dark override',
    hubCss.includes('html[data-theme="dark"] .hub-shell .tmpl-binding-status')
  );

  // Warning / error panels.
  assert(
    'Builder API error panel dark override',
    hubCss.includes('html[data-theme="dark"] .hub-shell .tmpl-api-error')
  );
  assert(
    'Builder validation-fail dark override',
    hubCss.includes('html[data-theme="dark"] .hub-shell .tmpl-validation-fail')
  );
  assert(
    'Builder validation count badge dark override',
    hubCss.includes('html[data-theme="dark"] .hub-shell .tmpl-val-group-count')
  );

  // Required checkboxes + field labels.
  assert('Field-key check labels dark override', hubCss.includes('html[data-theme="dark"] .hub-shell .tmpl-check'));
  assert(
    'Checkbox accent uses hub teal in dark mode',
    /\.tmpl-check input\[type="checkbox"\][\s\S]*?accent-color: var\(--hub-teal\)/.test(hubCss)
  );

  // Move up/down + remove buttons use hub button classes (token-driven, dark-safe).
  assert('Move up button uses hub-btn-ghost', registryUi.includes('hub-btn hub-btn-ghost tmpl-step-up'));
  assert('Move down button uses hub-btn-ghost', registryUi.includes('hub-btn hub-btn-ghost tmpl-step-down'));
  assert('Remove step button uses hub-btn-ghost', registryUi.includes('hub-btn hub-btn-ghost tmpl-step-remove'));
  assert('hub-btn-ghost color is token-driven', /\.hub-btn-ghost \{[\s\S]*?color: var\(--hub-muted\)/.test(hubCss));

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('RESULT: FAIL');
    process.exit(1);
  }
  console.log('RESULT: PASS');
}

main();
