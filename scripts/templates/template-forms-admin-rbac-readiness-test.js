#!/usr/bin/env node
/**
 * WOS-72 — Forms admin readiness + flexible RBAC workflow onboarding tests.
 * Usage: npm run templates:forms-admin-rbac-readiness-test
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
  console.log('=== WOS-72 Forms Admin RBAC Readiness Test ===\n');

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const uiPath = path.join(ROOT, 'template-registry-ui.js');
  const uiSrc = fs.readFileSync(uiPath, 'utf8');
  const indexSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  const ui = require('../../template-registry-ui.js');
  const t = ui.TemplateRegistryUI._test;

  assert('TemplateRegistryUI module loads', !!ui.TemplateRegistryUI);
  assert('manage table does not show internal key inline', !uiSrc.includes('hub-cell-sub mono">${esc(t.key)}'));
  assert('internal key in details metadata', uiSrc.includes('Internal key') && uiSrc.includes('forms-manage-meta'));
  assert('search filter input present', uiSrc.includes('formsManageSearch'));
  assert('availability filter present', uiSrc.includes('formsManageAvailability'));
  assert('workflow filter present', uiSrc.includes('formsManageWorkflow'));
  assert('sort filter present', uiSrc.includes('formsManageSort'));
  assert('manage columns include Workflow', uiSrc.includes('<th>Workflow</th>') && uiSrc.includes('<th>Version</th>'));
  assert('no hardcoded ASSIGNEE_ROLES array', !uiSrc.includes('const ASSIGNEE_ROLES ='));
  assert('workflow roles loaded from API', uiSrc.includes('/hub/rbac/workflow-roles'));
  assert('assigneeRoleSelectOptions helper exported', typeof t.assigneeRoleSelectOptions === 'function');
  assert('applyFormsManageFilters helper exported', typeof t.applyFormsManageFilters === 'function');

  const sampleTemplates = [
    {
      id: '1',
      key: 'form_alpha',
      name: 'Alpha Safety Form',
      status: 'active',
      current_published_version_id: 'v1',
      latest_draft_id: null,
      published_version_number: 1,
      updated_at: '2026-01-02T00:00:00Z',
      launch_config_json: { enabled: true },
      published_workflow_json: { steps: [{ step_type: 'Review', assignee_role: 'manager' }] },
    },
    {
      id: '2',
      key: 'form_beta',
      name: 'Beta Request',
      status: 'active',
      current_published_version_id: 'v2',
      latest_draft_id: 'd2',
      published_version_number: 2,
      updated_at: '2026-01-03T00:00:00Z',
      launch_config_json: { enabled: false },
      workflow_binding_mode: 'required',
      workflow_binding_template_id: 'wf1',
      workflow_binding_name: 'Standard Approval',
    },
    {
      id: '3',
      key: 'form_gamma',
      name: 'Gamma Draft Only',
      status: 'active',
      latest_draft_id: 'd3',
      updated_at: '2026-01-01T00:00:00Z',
      launch_config_json: { enabled: true },
    },
  ];

  const searched = t.applyFormsManageFilters(sampleTemplates, { search: 'alpha', statusFilter: 'all' });
  assert('search filters by form name', searched.length === 1 && searched[0].name.includes('Alpha'));

  const publishedOnly = t.applyFormsManageFilters(sampleTemplates, { statusFilter: 'published' });
  assert('published status filter works', publishedOnly.length === 2);

  const availableOnly = t.applyFormsManageFilters(sampleTemplates, { availability: 'available' });
  assert('available filter works', availableOnly.every((x) => t.isFormAvailable(x)));

  const workflowAttached = t.applyFormsManageFilters(sampleTemplates, { workflow: 'attached' });
  assert('workflow attached filter works', workflowAttached.length === 2);

  const noWorkflow = t.applyFormsManageFilters(sampleTemplates, { workflow: 'none' });
  assert('no workflow filter works', noWorkflow.length === 1 && noWorkflow[0].key === 'form_gamma');

  const sortedName = t.applyFormsManageFilters(sampleTemplates, { sort: 'name' });
  assert('name sort works', sortedName[0].name === 'Alpha Safety Form');

  const metaHtml = t.formMetadataDetailsHtml(sampleTemplates[0]);
  assert('internal key only in details html', metaHtml.includes('Internal key') && metaHtml.includes('form_alpha'));
  assert('details html hides key from primary label', !metaHtml.startsWith('form_alpha'));

  const rowHtml = t.assigneeRoleSelectOptions('manager');
  assert('assignee dropdown uses role catalog helper', rowHtml.includes('value="manager"'));

  const rolesCatalog = require('../../api/lib/rbac/roles-catalog');
  const rbacPostgres = require('../../api/lib/rbac/postgres');
  rolesCatalog.resetRoleCatalogCacheForTest();
  await rolesCatalog.refreshAllowedAssigneeRoleKeys(true);
  const keys = rolesCatalog.getAllowedAssigneeRoleKeysSync();
  assert('roles loaded from centralized catalog', keys.includes('manager') && keys.includes('legal'));

  const testEmail = `wos72-rbac-test-${Date.now()}@streamlinecorp.com`;
  try {
    await rbacPostgres.setUserRoleKeys(testEmail, ['manager', 'legal'], 'wos72-test@streamlinecorp.com');
    const assigned = await rbacPostgres.getUserRoleKeys(testEmail);
    assert('admin can assign workflow roles (persist)', assigned.includes('manager') && assigned.includes('legal'));

    await rbacPostgres.setUserRoleKeys(testEmail, ['requester'], 'wos72-test@streamlinecorp.com');
    const removed = await rbacPostgres.getUserRoleKeys(testEmail);
    assert('admin can remove workflow roles', removed.length === 1 && removed[0] === 'requester');
  } finally {
    await rbacPostgres.deleteUserRolesForTest(testEmail);
  }

  const runtimeRbac = require('../../api/lib/templates/runtime-rbac');
  const step = { status: 'pending', assignee_role: 'manager' };
  assert(
    'user with assigned role can act on workflow step',
    runtimeRbac.canActOnStep([], false, step, ['manager'])
  );
  assert(
    'user without assigned role cannot act',
    !runtimeRbac.canActOnStep([], false, step, ['requester'])
  );
  assert('admin can always act', runtimeRbac.canActOnStep([], true, step, []));

  assert('Users UI has workflow role assignment section', indexSrc.includes('Workflow roles') && indexSrc.includes('perms-workflow-role'));
  assert('Users UI saves workflow roles API', indexSrc.includes('/hub/users/') && indexSrc.includes('/workflow-roles'));

  const migrationPath = path.join(ROOT, 'migrations', '011_hub_rbac_roles.sql');
  assert('RBAC migration file exists', fs.existsSync(migrationPath));
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');
  assert('migration creates roles table', migrationSql.includes('CREATE TABLE IF NOT EXISTS roles'));
  assert('migration creates user_roles table', migrationSql.includes('CREATE TABLE IF NOT EXISTS user_roles'));

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
