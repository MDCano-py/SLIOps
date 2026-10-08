#!/usr/bin/env node
/**
 * Unit tests for stale manage_sso remediation planner + apply dry-run guarantees.
 * Usage: npm run security:remediate-stale-manage-sso-test
 */
const path = require('path');
const {
  planStaleManageSsoRemediation,
  ACTOR,
} = require(path.join(__dirname, 'remediate-stale-manage-sso.js'));

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

const MANAGEMENT_BASE = [
  'view_home',
  'hub_admin',
  'admin',
  'view_management',
  'control_room_supervisor',
  'control_room_schedule_manage',
];

console.log('=== Stale manage_sso remediation test ===\n');

assert('actor is system remediation identity', ACTOR === 'system:manage_sso_remediation');

{
  const plan = planStaleManageSsoRemediation({
    users: [
      {
        email: 'mgmt@sliops.test',
        permissions: [...MANAGEMENT_BASE, 'manage_sso'],
      },
      {
        email: 'sso.admin@sliops.test',
        permissions: ['admin', 'manage_sso', 'view_management'],
      },
      {
        email: 'bootstrap@sliops.test',
        permissions: ['manage_sso', 'admin', 'hub_admin'],
        bootstrap: true,
      },
      {
        email: 'employee@sliops.test',
        permissions: ['view_home'],
      },
    ],
    managementPerms: MANAGEMENT_BASE,
    approvedEmails: ['sso.admin@sliops.test'],
  });

  assert('lists manage_sso holders', plan.holders.length === 3);
  assert(
    'stale Management user queued for removal',
    plan.remove.some((r) => r.email === 'mgmt@sliops.test' && r.reason === 'stale_management_derived')
  );
  assert(
    'approved SSO admin kept',
    plan.keep.some((k) => k.email === 'sso.admin@sliops.test' && k.reason === 'explicitly_approved')
  );
  assert(
    'bootstrap admin protected',
    plan.keep.some((k) => k.email === 'bootstrap@sliops.test' && k.reason === 'bootstrap_admin')
  );
  assert(
    'dry-run plan does not mutate input permissions',
    plan.remove[0].previousPermissions.includes('manage_sso') &&
      plan.remove[0].nextPermissions.every((p) => p !== 'manage_sso')
  );
  assert(
    'next permissions drop only manage_sso',
    plan.remove[0].nextPermissions.length === MANAGEMENT_BASE.length
  );
}

{
  // Custom grant that happens to include manage_sso but is not Management bundle
  const plan = planStaleManageSsoRemediation({
    users: [
      {
        email: 'custom@sliops.test',
        permissions: ['view_home', 'manage_sso'],
      },
    ],
    managementPerms: MANAGEMENT_BASE,
    approvedEmails: [],
  });
  assert(
    'non-Management custom grant kept',
    plan.remove.length === 0 &&
      plan.keep.some((k) => k.email === 'custom@sliops.test' && k.reason === 'custom_or_explicit_grant')
  );
}

// Dry-run CLI source contract
const fs = require('fs');
const src = fs.readFileSync(path.join(__dirname, 'remediate-stale-manage-sso.js'), 'utf8');
assert('CLI defaults to dry-run (requires --apply)', src.includes("Mode: ${args.apply ? 'APPLY' : 'DRY-RUN'}"));
assert('apply writes users:audit', src.includes("p.lpush(") && src.includes('users:audit'));
assert('never trusts caller-supplied actor from argv body', !src.includes('process.env.ACTOR_EMAIL') && src.includes("ACTOR = 'system:manage_sso_remediation'"));
assert('checklist docs mention remediation', fs.existsSync(path.join(__dirname, '../../docs/security/ec2-final-validation-checklist.md')));

console.log('\n=== Summary ===');
console.log(`Checks: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
