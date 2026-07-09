#!/usr/bin/env node
/**
 * WOS-67 — MVP IA simplification + forms-first launch surface tests.
 * Usage: npm run templates:mvp-ia-test
 */
const fs = require('fs');
const path = require('path');
const { loadDbEnv } = require('../db/env');

loadDbEnv();
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

function readRepoFile(rel) {
  return fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
}

async function main() {
  console.log('=== WOS-67 MVP IA Forms-First Test ===\n');

  const ui = require('../../template-registry-ui.js');
  const t = ui.TemplateRegistryUI._test;
  const rbac = (() => {
    require('../../rbac-client.js');
    return global.RbacClient;
  })();
  const indexHtml = readRepoFile('index.html');
  const registryJs = readRepoFile('template-registry-ui.js');
  const runtimeJs = readRepoFile('template-runtime-ui.js');
  const spacesJs = readRepoFile('app-spaces-ui.js');

  assert('module loads', !!ui.TemplateRegistryUI);
  assert('forms space meta title', registryJs.includes("title: 'Forms'") && registryJs.includes("breadcrumb: ['Forms']"));
  assert('forms new label plain', registryJs.includes("newLabel: 'New Form'"));
  assert('no Google Forms copy in registry UI', !registryJs.includes('Google-Forms') && !registryJs.includes('Google Forms'));
  assert('no App Spaces in runtime back', !runtimeJs.includes('Back to App Spaces'));
  assert('runtime back navigation wired', runtimeJs.includes('Back to New Request') && runtimeJs.includes('onCancel'));
  assert('sidebar Forms nav item', indexHtml.includes('data-hub-tab="hub-forms"') && indexHtml.includes('<span>Forms</span>'));
  assert('workflows not in primary sidebar', !indexHtml.includes('data-hub-tab="hub-workflows"'));
  assert('approval routes in forms manage', registryJs.includes('Approval routes') && registryJs.includes('tmplApprovalRoutesBtn'));
  assert('Template Studio nav group removed', !indexHtml.includes('<div class="hub-nav-group-label">Template Studio</div>'));
  assert('Form Builder nav label removed', !indexHtml.includes('>Form Builder<'));
  assert('Document Templates nav hidden', !indexHtml.includes('>Document Templates<'));
  assert('launch sidebar nav disabled', spacesJs.includes('container.hidden = true') && spacesJs.includes("container.innerHTML = ''"));
  assert('forms hub available section', registryJs.includes('Available forms'));
  assert('forms hub fill out action', registryJs.includes('Fill out form'));
  assert('forms hub manage section', registryJs.includes('Manage forms'));
  assert('forms hub new form button', registryJs.includes('New Form'));
  assert('auto launch config on forms publish', registryJs.includes('ensureDefaultLaunchConfig'));
  assert('forms route primary surface', registryJs.includes('renderFormsHub'));
  assert('draft filter helper', typeof t.filterFormsManageTemplates === 'function');
  assert(
    'draft filter excludes published-only',
    t.filterFormsManageTemplates(
      [
        { id: '1', status: 'active', latest_draft_id: 'd1', current_published_version_id: 'p1' },
        { id: '2', status: 'active', latest_draft_id: 'd2' },
      ],
      'draft'
    ).length === 1 && t.filterFormsManageTemplates([{ id: '2', status: 'active', latest_draft_id: 'd2' }], 'draft')[0].id === '2'
  );
  assert(
    'published filter',
    t.filterFormsManageTemplates(
      [{ id: '1', status: 'active', current_published_version_id: 'p1' }, { id: '2', status: 'active' }],
      'published'
    ).length === 1
  );
  assert(
    'launch status available label',
    t.launchStatusCell({
      current_published_version_id: 'v1',
      launch_config_json: { enabled: true, space_key: 'forms' },
    }).includes('Available')
  );
  assert(
    'non-admin can access hub-forms tab',
    rbac.canAccessHubTab(['requester'], 'hub-forms') === true
  );
  assert(
    'admin still required for hub-workflows tab',
    rbac.canAccessHubTab(['requester'], 'hub-workflows') === false &&
      rbac.canAccessHubTab(['hub_admin'], 'hub-workflows') === true
  );
  assert('settings app-spaces card hidden', indexHtml.includes('data-hub-settings-card="app-spaces" hidden'));
  assert('settings documents card hidden', indexHtml.includes('data-hub-settings-card="documents" hidden'));

  assert('forms context banner suppressed', registryJs.includes("space === 'forms'") && registryJs.includes('!meta.bannerHtml'));

  try {
    if (typeof global.document === 'undefined') {
      global.document = {
        readyState: 'complete',
        documentElement: { getAttribute() { return null; }, removeAttribute() {}, setAttribute() {} },
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
        createElement: () => ({
          hidden: false,
          style: {},
          classList: { add() {}, remove() {}, toggle() {} },
          appendChild: () => {},
          addEventListener: () => {},
          querySelector: () => null,
          querySelectorAll: () => [],
          setAttribute: () => {},
        }),
      };
    }
    if (typeof global.window === 'undefined') global.window = global;
    delete require.cache[require.resolve('../../hub.js')];
    require('../../hub.js');
    assert('HubUI forms hash', global.HubUI?._test?.buildFormsHash?.() === '#/forms');
  } catch (err) {
    assert('HubUI module load', false, err.message);
  }

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
