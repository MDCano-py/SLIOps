#!/usr/bin/env node
/**
 * WOS-80 — Role lifecycle guardrails.
 * Usage: npm run templates:role-lifecycle-guardrails-test
 *
 * Verifies safe, understandable role delete/archive behavior:
 *   - system roles cannot be deleted (or archived),
 *   - referenced custom roles cannot be hard-deleted (only deactivated),
 *   - reference checks span users / workflow steps / workflow JSON / launch
 *     visibility JSON,
 *   - archived (inactive) roles are excluded from NEW selectable options while
 *     existing references remain readable,
 *   - the roles UI exposes status/type badges, an "In use" hint, and
 *     Deactivate / Restore / Delete actions with the role key kept secondary.
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
  console.log('=== Role Lifecycle Guardrails Test ===\n');

  const rbacPg = require('../../api/lib/rbac/postgres.js');
  const pgSrc = fs.readFileSync(path.join(ROOT, 'api/lib/rbac/postgres.js'), 'utf8');
  const routesSrc = fs.readFileSync(path.join(ROOT, 'api/lib/rbac/routes.js'), 'utf8');
  const catalogSrc = fs.readFileSync(path.join(ROOT, 'api/lib/rbac/roles-catalog.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const hubCss = fs.readFileSync(path.join(ROOT, 'hub.css'), 'utf8');

  // ---- Backend exports ----
  assert('deleteRole exported', typeof rbacPg.deleteRole === 'function');
  assert('restoreRole exported', typeof rbacPg.restoreRole === 'function');
  assert('getRoleReferenceSummary exported', typeof rbacPg.getRoleReferenceSummary === 'function');
  assert('countRoleReferences exported', typeof rbacPg.countRoleReferences === 'function');
  assert('archiveRole still exported', typeof rbacPg.archiveRole === 'function');

  // ---- Delete guards (system + referenced) ----
  assert('deleteRole blocks system roles', (() => {
    const i = pgSrc.indexOf('async function deleteRole(');
    const block = pgSrc.slice(i, i + 900);
    return block.includes('role.system_role') && block.includes('System roles are required by the platform and cannot be deleted.') && block.includes("code = 'PROTECTED'");
  })());
  assert('deleteRole blocks referenced roles', (() => {
    const i = pgSrc.indexOf('async function deleteRole(');
    const block = pgSrc.slice(i, i + 1100);
    return block.includes('countRoleReferences') && block.includes('It can be deactivated, but not deleted.') && block.includes("code = 'REFERENCED'");
  })());
  assert('deleteRole only hard-deletes non-system', (() => {
    const i = pgSrc.indexOf('async function deleteRole(');
    const block = pgSrc.slice(i, i + 1400);
    return block.includes('DELETE FROM roles WHERE key = $1 AND system_role = false');
  })());

  // ---- Reference summary covers all surfaces ----
  assert('references check user_roles', pgSrc.includes('FROM user_roles GROUP BY role_key'));
  assert('references check workflow_step_instances', pgSrc.includes('workflow_step_instances') && pgSrc.includes('assignee_role'));
  assert('references check workflow JSON', pgSrc.includes('workflow_json') && pgSrc.includes('compiled_workflow_json') && pgSrc.includes('collectWorkflowRoleKeys'));
  assert('references check launch visibility JSON', pgSrc.includes('visible_to_roles_json') && pgSrc.includes('app_spaces') && pgSrc.includes('template_launch_entries'));
  assert('missing tables skipped via to_regclass', pgSrc.includes('to_regclass'));

  // ---- Restore reactivates custom, leaves system unchanged ----
  assert('restoreRole reactivates', (() => {
    const i = pgSrc.indexOf('async function restoreRole(');
    const block = pgSrc.slice(i, i + 700);
    return block.includes("SET status = 'active'") && block.includes('role.system_role');
  })());

  // ---- Inactive roles excluded from NEW selections (dropdowns) ----
  assert('catalog options are active-only', catalogSrc.includes('listActiveRoles'));
  assert('catalog assignee keys are active-only', catalogSrc.includes('listActiveRoleKeys'));

  // ---- Routes: delete/restore + admin write gate + audit ----
  assert('DELETE role route exists', routesSrc.includes('roleDeleteMatch') && /method === 'DELETE'/.test(routesSrc));
  assert('restore role route exists', routesSrc.includes('roleRestoreMatch') && routesSrc.includes('/restore'));
  assert('delete requires admin write', (() => {
    const i = routesSrc.indexOf('roleDeleteMatch && method');
    const block = routesSrc.slice(i, i + 500);
    return block.includes('requireAdminWrite');
  })());
  assert('delete emits audit', routesSrc.includes("recordSecurityAudit('rbac.role_deleted'"));
  assert('restore emits audit', routesSrc.includes("recordSecurityAudit('rbac.role_restored'"));
  assert('roles list annotates references', routesSrc.includes('getRoleReferenceSummary') && routesSrc.includes('deletable') && routesSrc.includes('referenced'));

  // ---- UI: badges, actions, secondary key ----
  assert('UI shows Active/Archived status badge', indexHtml.includes('hub-workflow-role-badge-active') && indexHtml.includes('hub-workflow-role-badge-archived'));
  assert('UI shows System/Custom badge', indexHtml.includes('hub-workflow-role-badge-system') && indexHtml.includes('hub-workflow-role-badge-custom'));
  assert('UI shows In use badge', indexHtml.includes('hub-workflow-role-badge-inuse'));
  assert('UI hides destructive actions for system roles', indexHtml.includes('if (!role.system_role) {'));
  assert('UI Deactivate for active custom', indexHtml.includes('hub-workflow-role-archive') && indexHtml.includes('>Deactivate<'));
  assert('UI Restore for inactive custom', indexHtml.includes('hub-workflow-role-restore') && indexHtml.includes('>Restore<'));
  assert('UI Delete only when deletable', (() => {
    const i = indexHtml.indexOf('if (role.deletable) {');
    return i >= 0 && indexHtml.slice(i, i + 200).includes('hub-workflow-role-delete');
  })());
  assert('delete handler calls DELETE endpoint', indexHtml.includes('async function deleteHubWorkflowRole(') && indexHtml.includes("method: 'DELETE'"));
  assert('restore handler calls restore endpoint', indexHtml.includes('async function restoreHubWorkflowRole(') && indexHtml.includes('/restore'));
  assert('role key kept visually secondary', indexHtml.includes('hub-workflow-role-key-label') && indexHtml.includes('hub-workflow-role-key'));

  // ---- Dark mode readability ----
  assert('In use badge has light + dark styles', hubCss.includes('.hub-workflow-role-badge-inuse') && hubCss.includes('html[data-theme="dark"] .hub-workflow-role-badge-inuse'));

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('RESULT: FAIL');
    process.exit(1);
  }
  console.log('RESULT: PASS');
}

main();
