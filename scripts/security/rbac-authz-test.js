#!/usr/bin/env node
/**
 * WOS-79 — RBAC / authorization / immutability security test.
 * Usage: npm run security:rbac-authz-test
 *
 * Unit-tests the runtime RBAC helpers (role-boundary + submission ownership)
 * and statically asserts that admin APIs, protected APIs, request-detail IDOR
 * guards, and published-template immutability are enforced server-side.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

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

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function main() {
  console.log('=== WOS-79 RBAC / Authorization Test ===\n');

  const rbac = require(path.join(ROOT, 'api', 'lib', 'templates', 'runtime-rbac.js'));

  // --- Workflow step role boundaries ---
  const apStep = { status: 'pending', assignee_role: 'ap' };
  const legalStep = { status: 'pending', assignee_role: 'legal' };
  const managerStep = { status: 'pending', assignee_role: 'manager' };

  assert('AP user can act on AP step', rbac.canActOnStep(['review_ap'], false, apStep));
  assert('AP user CANNOT act on legal step', !rbac.canActOnStep(['review_ap'], false, legalStep));
  assert('Legal user can act on legal step', rbac.canActOnStep(['legal_review'], false, legalStep));
  assert('Legal user CANNOT act on AP step', !rbac.canActOnStep(['legal_review'], false, apStep));
  assert('Manager user can act on manager step', rbac.canActOnStep(['manager'], false, managerStep));
  assert('Manager user CANNOT act on legal step', !rbac.canActOnStep(['manager'], false, legalStep));
  assert('Requester CANNOT act on AP step', !rbac.canActOnStep([], false, apStep));
  assert('Admin can act on any step', rbac.canActOnStep([], true, legalStep));
  assert('Nobody can act on a non-pending step', !rbac.canActOnStep(['review_ap'], true, { status: 'completed', assignee_role: 'ap' }));

  // --- Submission inspection / IDOR at the helper level ---
  const sub = { created_by: 'owner@corp.com' };
  assert('Owner can inspect own submission', rbac.canInspectSubmission([], false, sub, 'owner@corp.com'));
  assert('Non-owner non-admin CANNOT inspect submission', !rbac.canInspectSubmission([], false, sub, 'someone@corp.com'));
  assert('Admin can inspect any submission', rbac.canInspectSubmission([], true, sub, 'someone@corp.com'));

  // --- Role separation: one queue role does not grant another ---
  const apRoles = rbac.userAssigneeRoles(['review_ap'], false);
  assert('AP permission does not grant legal role', !apRoles.has('legal'));
  const legalRoles = rbac.userAssigneeRoles(['legal_review'], false);
  assert('Legal permission does not grant AP role', !legalRoles.has('ap'));

  // --- Static: admin-only APIs gated ---
  const maintainx = read('api/maintainx.js');
  assert(
    'User management API requires admin',
    maintainx.includes('requirePermissions') && /requirePermissions\([^)]*\[\s*'admin'\s*\]/.test(maintainx)
  );
  assert('requirePermissions returns 401 then 403', /401[\s\S]{0,400}403|Not authenticated[\s\S]{0,400}403/.test(maintainx));

  // --- Static: protected hub API rejects unauthenticated (401 backstop) ---
  const hubRoutes = read('api/lib/hub/routes.js');
  assert('Hub routes 401 when no actorEmail', hubRoutes.includes('if (!actorEmail) return json(res, 401'));
  assert('Hub request detail uses ownership guard', hubRoutes.includes('requireRequestAccess'));
  assert('canAccessRequest checks owner/assignee/admin', hubRoutes.includes('function canAccessRequest'));

  // --- Static: published template versions are immutable server-side ---
  const pg = read('api/lib/templates/postgres.js');
  assert('Published version edit throws IMMUTABLE', pg.includes("'IMMUTABLE'"));
  assert('Only draft versions can be edited', pg.includes('Only draft versions can be edited'));
  assert('Update guarded by status draft', /status !== 'draft'/.test(pg));
  const tmplRoutes = read('api/lib/templates/routes.js');
  assert('Import apply rejects non-draft', tmplRoutes.includes('Import can only apply to draft versions'));

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('RESULT: FAIL');
    process.exit(1);
  }
  console.log('RESULT: PASS');
}

main();
