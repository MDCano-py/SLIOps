#!/usr/bin/env node
/**
 * WOS-80 — Workflow step creation + RBAC authorization test.
 * Usage: npm run security:workflow-step-authz-test
 *
 * - Static: POST /hub/requests/:id/workflow-steps now requires an
 *   authenticated admin/hub_admin and an existing request (was unguarded).
 * - Functional: canActOnStep enforces per-role step separation and RBAC role
 *   writes require true admin (finding R5).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
let passed = 0;
let failed = 0;

function assert(name, cond, detail) {
  if (cond) { passed += 1; console.log(`PASS  ${name}`); }
  else { failed += 1; console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function main() {
  console.log('=== WOS-80 Workflow Step Authorization Test ===\n');

  const hub = read('api/lib/hub/routes.js');
  const wfBlock = hub.slice(hub.indexOf("sub === '/workflow-steps'"));
  assert('workflow-steps POST returns 401 when unauthenticated', /if \(!actorEmail\) return json\(res, 401/.test(wfBlock));
  assert('workflow-steps POST returns 404 for missing request', /if \(!requestForAccess\) return json\(res, 404/.test(wfBlock));
  assert(
    'workflow-steps POST requires admin/hub_admin',
    /if \(!isAdmin && !hasHubPerm\(permissions, 'hub_admin'\)\)/.test(wfBlock) && wfBlock.includes('Admin required to modify workflow steps')
  );

  // Functional: role separation on acting
  const rbac = require(path.join(ROOT, 'api', 'lib', 'templates', 'runtime-rbac.js'));
  const apStep = { status: 'pending', assignee_role: 'ap' };
  const legalStep = { status: 'pending', assignee_role: 'legal' };
  assert('AP cannot act on legal step', !rbac.canActOnStep(['review_ap'], false, legalStep));
  assert('Legal cannot act on AP step', !rbac.canActOnStep(['legal_review'], false, apStep));
  assert('Requester cannot act on AP step', !rbac.canActOnStep([], false, apStep));
  assert('Admin can act on any step', rbac.canActOnStep([], true, legalStep));

  // Static: RBAC role writes require true admin (finding R5)
  const rbacRoutes = read('api/lib/rbac/routes.js');
  assert('requireAdminWrite gate exists', rbacRoutes.includes('function requireAdminWrite'));
  assert(
    'role write does not accept view_user_permissions',
    /function requireAdminWrite[\s\S]{0,220}admin'\) \|\| permissions\.includes\('hub_admin'\)/.test(rbacRoutes) &&
      !/function requireAdminWrite[\s\S]{0,220}view_user_permissions/.test(rbacRoutes)
  );
  assert('role create uses requireAdminWrite', /roles' && method === 'POST'\)\s*\{\s*if \(!requireAdminWrite/.test(rbacRoutes));
  assert('user role assignment uses requireAdminWrite', /userRolesMatch && method === 'PUT'\)\s*\{\s*if \(!requireAdminWrite/.test(rbacRoutes));

  // Static: security audit events recorded
  assert('role assignment audited', rbacRoutes.includes("recordSecurityAudit('rbac.user_roles_set'"));

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  if (failed) { console.error('RESULT: FAIL'); process.exit(1); }
  console.log('RESULT: PASS');
}

main();
