#!/usr/bin/env node
/**
 * WOS-73 — Launch visibility + role catalog cleanup tests.
 * Usage: npm run templates:launch-visibility-role-catalog-test
 */
const fs = require('fs');
const path = require('path');
const { loadDbEnv, ROOT } = require('../db/env');

loadDbEnv();
process.env.HUB_STORE_MODE = 'postgres';

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

async function main() {
  console.log('=== WOS-73 Launch Visibility + Role Catalog Test ===\n');

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const uiPath = path.join(ROOT, 'template-registry-ui.js');
  const uiSrc = fs.readFileSync(uiPath, 'utf8');
  const sbSrc = fs.readFileSync(path.join(ROOT, 'template-section-builder.js'), 'utf8');
  const indexSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  const ui = require('../../template-registry-ui.js');
  const t = ui.TemplateRegistryUI._test;
  const { rolesCanSee, normalizeLaunchConfig } = require('../../api/lib/spaces/normalize');
  const rbacPostgres = require('../../api/lib/rbac/postgres');
  const rolesCatalog = require('../../api/lib/rbac/roles-catalog');

  assert('TemplateRegistryUI module loads', !!ui.TemplateRegistryUI);
  assert('Settings tab removes App Space copy', !uiSrc.includes('WOS-58 app spaces'));
  assert('Settings tab removes App space dropdown', !uiSrc.includes('id="tmplLaunchSpace"'));
  assert('Settings uses Availability language', uiSrc.includes('<h3>Availability</h3>'));
  assert('Settings has New Request availability checkbox', uiSrc.includes('tmplLaunchEnabled'));
  assert('Settings has visibility mode radios', uiSrc.includes('tmplVisibilityMode'));
  assert('no hardcoded LAUNCH_ROLE_OPTIONS array', !uiSrc.includes('LAUNCH_ROLE_OPTIONS'));
  assert('no hardcoded LAUNCH_SPACE_OPTIONS array', !uiSrc.includes('LAUNCH_SPACE_OPTIONS'));
  assert('visibility roles use catalog helper', uiSrc.includes('renderVisibilityRoleCheckboxes'));
  assert('launchRoleOptionsForUi exported', typeof t.launchRoleOptionsForUi === 'function');
  assert('readLaunchConfigFromDom exported', typeof t.readLaunchConfigFromDom === 'function');

  await rolesCatalog.refreshAllowedAssigneeRoleKeys(true);
  const roleOptions = t.launchRoleOptionsForUi();
  assert('visibility role options loaded from catalog', roleOptions.length >= 6);

  const settingsHtml = t.renderVisibilityRoleCheckboxes(['manager'], false);
  assert('visibility checkboxes use role names', settingsHtml.includes('Manager') || settingsHtml.includes('manager'));

  const normalizedEveryone = normalizeLaunchConfig({ visibility_mode: 'everyone', visible_to_roles: [], space_key: 'forms' });
  assert('normalizeLaunchConfig preserves everyone mode', normalizedEveryone.visibility_mode === 'everyone');
  assert('normalizeLaunchConfig empty roles for everyone', normalizedEveryone.visible_to_roles.length === 0);

  const normalizedSpecific = normalizeLaunchConfig({
    visibility_mode: 'specific',
    visible_to_roles: ['manager', 'requester'],
    space_key: 'forms',
  });
  assert('normalizeLaunchConfig specific mode keeps roles', normalizedSpecific.visible_to_roles.includes('manager'));

  assert('rolesCanSee empty list means everyone', rolesCanSee([], ['requester'], false));
  assert('rolesCanSee specific role requires match', !rolesCanSee(['manager'], ['requester'], false));
  assert('rolesCanSee honors assigned workflow roles', rolesCanSee(['manager'], [], false, ['manager']));

  assert('preview removes traffic-light dots', !sbSrc.includes('tmpl-preview-dot-red'));
  assert('preview uses Streamline header copy', sbSrc.includes('Updates as you edit'));

  const testRoleKey = `wos73_test_${Date.now()}`;
  try {
    const created = await rbacPostgres.createRole(
      { key: testRoleKey, name: 'WOS73 Test Role', description: 'Temporary test role' },
      'wos73-test@streamlinecorp.com'
    );
    assert('custom role can be created in database', created.key === testRoleKey);
    await rolesCatalog.refreshAllowedAssigneeRoleKeys(true);
    const afterCreate = (await rolesCatalog.listRoleOptionsForUi()).some((r) => r.key === testRoleKey);
    assert('custom role appears in catalog options', afterCreate);

    const archived = await rbacPostgres.archiveRole(testRoleKey);
    assert('custom role can be archived', archived.status === 'archived');
    await rolesCatalog.refreshAllowedAssigneeRoleKeys(true);
    const afterArchive = (await rolesCatalog.listRoleOptionsForUi()).some((r) => r.key === testRoleKey);
    assert('archived role hidden from active catalog options', !afterArchive);
  } finally {
    await rbacPostgres.deleteRoleForTest(testRoleKey);
  }

  try {
    await rbacPostgres.archiveRole('admin');
    assert('system role archive protected', false, 'expected error');
  } catch (err) {
    assert('system role archive protected', err.code === 'PROTECTED');
  }

  assert('workflow role catalog UI in Admin Users', indexSrc.includes('Workflow role catalog'));
  assert('workflow role create button present', indexSrc.includes('hubWorkflowRoleNewBtn'));

  const assigneeHtml = t.assigneeRoleSelectOptions('manager');
  assert('workflow assignee dropdown still uses catalog', assigneeHtml.includes('value="manager"'));

  assert('ensureDefaultLaunchConfig uses forms space internally', uiSrc.includes("space_key: 'forms'"));

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('RESULT: FAIL');
    process.exit(1);
  }
  console.log('RESULT: PASS');
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
