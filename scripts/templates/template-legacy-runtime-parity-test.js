#!/usr/bin/env node
/**
 * WOS-70 — Legacy request runtime visual parity + admin edit policy tests.
 * Usage: npm run templates:legacy-runtime-parity-test
 */
const fs = require('fs');
const path = require('path');
const { loadDbEnv } = require('../db/env');
const { listDocumentTypes } = require('../../api/lib/hub/document-registry');

loadDbEnv();

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

function readRepoFile(rel) {
  return fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
}

async function main() {
  console.log('=== WOS-70 Legacy Runtime Visual Parity Test ===\n');

  const indexHtml = readRepoFile('index.html');
  const hubJs = readRepoFile('hub.js');
  const rendererJs = readRepoFile('hub-form-renderer.js');
  const shellJs = readRepoFile('hub-request-form-shell.js');
  const runtimeJs = readRepoFile('template-runtime-ui.js');
  const sectionJs = readRepoFile('template-section-builder.js');
  const hubCss = readRepoFile('hub.css');
  const nr = require('../../hub-new-request-registry.js');
  const shell = require('../../hub-request-form-shell.js');

  assert('HubRequestFormShell module loads', !!shell.isLegacySystemManaged);
  assert('legacy system-managed keys count', shell.LEGACY_SYSTEM_MANAGED_KEYS.length === 9);
  assert('shouldShowEditFormAction false', shell.shouldShowEditFormAction() === false);
  assert('canShowManageForm admin dynamic', shell.canShowManageForm(true, 'published_form') === true);
  assert('canShowManageForm non-admin dynamic', shell.canShowManageForm(false, 'published_form') === false);
  assert('canShowManageForm admin legacy custom', shell.canShowManageForm(true, 'custom') === false);
  assert('canShowManageForm admin schema', shell.canShowManageForm(true, 'schema') === false);
  assert('work_order is system-managed', shell.isLegacySystemManaged('work_order') === true);

  assert('hub-request-form-shell script in index', indexHtml.includes('hub-request-form-shell.js'));
  assert('legacy panel class on work order', indexHtml.includes('id="panel-work-order"') && indexHtml.includes('hub-legacy-request-panel'));
  assert('legacy panel class on parts', indexHtml.includes('id="panel-parts"') && indexHtml.includes('hub-legacy-request-panel'));
  assert('legacy panel class on bol', indexHtml.includes('id="panel-bol"') && indexHtml.includes('hub-legacy-request-panel'));
  assert('legacy panel class on jsa', indexHtml.includes('id="panel-jsa"') && indexHtml.includes('hub-legacy-request-panel'));
  assert('legacy panel class on swp', indexHtml.includes('id="panel-swp"') && indexHtml.includes('hub-legacy-request-panel'));
  assert('work order system-managed header copy', indexHtml.includes('System-managed request type · Work Order'));
  assert('work order field api warn helper', indexHtml.includes('function woSetFieldApiWarn'));
  assert('work order field api warn class', indexHtml.includes('hub-field-api-warn'));
  assert('work order progress copy improved', indexHtml.includes('required fields complete'));
  assert('no emoji api placeholder on wo combo disable in load', !indexHtml.match(/woLocationCombo\.setEnabled\(false, '⚠️/));

  assert('hub-form-renderer uses request shell', rendererJs.includes('HubRequestFormShell') && rendererJs.includes('wrapFormShell'));
  assert('hub-form-renderer systemManaged option', rendererJs.includes('systemManaged'));
  assert('hub-form-renderer no edit form action', !rendererJs.includes('Edit form') && !rendererJs.includes('Edit schema'));

  assert('hub passes systemManaged for schema legacy', hubJs.includes('isLegacySystemManaged'));
  assert('hub showManageForm for published forms', hubJs.includes('showManageForm'));
  assert('hub canShowManageForm uses admin perm', hubJs.includes("canShowManageForm(hasPerm('hub_admin')"));

  assert('runtime manage form link', runtimeJs.includes('hub-request-manage-link') && runtimeJs.includes('Manage form'));
  assert('runtime showManageForm option', runtimeJs.includes('options.showManageForm'));
  assert('runtime no edit form label', !runtimeJs.includes('Edit form') && !runtimeJs.includes('Edit schema'));

  assert('dynamic runtime shared shell classes', sectionJs.includes('hub-request-form-shell') && sectionJs.includes('hub-request-form-footer'));
  assert('shell CSS present', hubCss.includes('.hub-request-form-shell') && hubCss.includes('.hub-field-api-warn'));
  assert('legacy panel CSS present', hubCss.includes('.hub-legacy-request-panel'));

  const legacyKeys = nr.LEGACY_REQUEST_TYPE_KEYS;
  assert('nine legacy keys in new request registry', legacyKeys.length === 9);
  legacyKeys.forEach((key) => {
    assert(`legacy type enabled: ${key}`, listDocumentTypes({ enabledOnly: true }).some((d) => d.key === key));
  });

  const headerHtml = shell.renderHeaderHtml({ title: 'Test', systemManaged: true });
  assert('shell header system-managed badge', headerHtml.includes('System-managed'));
  assert('shell header no edit form', !headerHtml.includes('Edit form'));

  const manageHeader = shell.renderHeaderHtml({ title: 'Dynamic', showManageForm: true, manageFormHref: '#/forms/x' });
  assert('shell manage form link when allowed', manageHeader.includes('Manage form'));
  assert('shell no manage when legacy', !shell.renderHeaderHtml({ title: 'WO', systemManaged: true }).includes('Manage form'));

  const runtimeHtml = require('../../template-section-builder.js').renderRuntimeFormHtml({
    title: 'Dynamic Form',
    sections: [{ id: 's1', title: 'Section', fields: [{ key: 'title', label: 'Title', type: 'text', required: true }] }],
  });
  assert('runtime HTML hides field keys as visible text', runtimeHtml.includes('Title') && !runtimeHtml.includes('>title<'));

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
