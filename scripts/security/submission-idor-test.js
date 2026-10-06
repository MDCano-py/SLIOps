#!/usr/bin/env node
/**
 * WOS-80 — Submission IDOR authorization test.
 * Usage: npm run security:submission-idor-test
 *
 * - Functional: canInspectSubmission enforces admin / creator / workflow-role
 *   access (guessing an ID as an unrelated user is denied).
 * - Static: GET /hub/templates/submissions/:id now returns 401 when
 *   unauthenticated and 403 when the actor cannot inspect the submission
 *   (previously an unguarded IDOR).
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
  console.log('=== WOS-80 Submission IDOR Test ===\n');

  const rbac = require(path.join(ROOT, 'api', 'lib', 'templates', 'runtime-rbac.js'));
  const sub = { created_by: 'owner@corp.com' };

  assert('creator can inspect own submission', rbac.canInspectSubmission([], false, sub, 'owner@corp.com'));
  assert('unrelated user CANNOT inspect (guessed ID denied)', !rbac.canInspectSubmission([], false, sub, 'attacker@corp.com'));
  assert('admin can inspect any submission', rbac.canInspectSubmission([], true, sub, 'attacker@corp.com'));
  assert('empty-permission stranger denied', !rbac.canInspectSubmission([], false, sub, 'nobody@corp.com'));

  // Static assertions on the fixed template submission route
  const tpl = read('api/lib/templates/routes.js');
  const block = tpl.slice(tpl.indexOf('subGetMatch'));
  assert('submission GET returns 401 when unauthenticated', /if \(!actorEmail\)\s*\{\s*json\(res, 401/.test(block));
  assert(
    'submission GET authorizes via canInspectSubmission',
    block.includes('canInspectSubmission(permissions, isAdmin, bundle.submission')
  );
  assert('submission GET returns 403 on failed authorization', /canInspectSubmission[\s\S]{0,120}json\(res, 403/.test(block));
  assert('templates router imports canInspectSubmission', tpl.includes("require('./runtime-rbac')"));

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  if (failed) { console.error('RESULT: FAIL'); process.exit(1); }
  console.log('RESULT: PASS');
}

main();
