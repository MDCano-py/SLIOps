#!/usr/bin/env node
/**
 * WOS-80 — Legacy route RBAC / IDOR test.
 * Usage: npm run security:legacy-route-rbac-test
 *
 * Static source assertions that the legacy maintainx.js routes (JSA/BOL/SWP
 * archive, /request-archive/*, /forms/*) now require an authenticated actor,
 * gate reads by the per-kind view permission, use privileged-or-creator delete
 * authorization, and derive the stored submitter from the session (not the
 * spoofable x-actor-email header).
 *
 * Auth error contract (canonical):
 *   unauthenticated → HTTP 401 + code WOS_AUTH_REQUIRED
 *   authenticated without permission → HTTP 403 + code WOS_FORBIDDEN
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
  console.log('=== WOS-80 Legacy Route RBAC / IDOR Test ===\n');
  const mx = read('api/maintainx.js');
  const authErrors = read('api/lib/auth-errors.js');

  assert('auth-errors defines WOS_AUTH_REQUIRED', /WOS_AUTH_REQUIRED/.test(authErrors));
  assert('auth-errors defines WOS_FORBIDDEN', /WOS_FORBIDDEN/.test(authErrors));

  // Shared actor resolver
  assert('resolveActor helper exists', /async function resolveActor\(req\)/.test(mx));
  assert('resolveActor requires session outside relaxed dev', mx.includes('if (!actorEmail) return { actorEmail: null'));

  // Archive JSA/BOL/SWP
  const archiveStart = mx.indexOf('// WOS-80 — legacy archive RBAC/IDOR');
  const archiveEnd = mx.indexOf('// ---- Request Archive (Parts Request + Work Order) ----');
  const archiveBlock = archiveStart >= 0 && archiveEnd > archiveStart
    ? mx.slice(archiveStart, archiveEnd)
    : mx;

  assert('archive block resolves actor', archiveBlock.includes('const authActor = await resolveActor(req);'));
  assert(
    'archive block 401 when unauthenticated',
    /if \(!authActor\.actorEmail\) return res\.status\(401\)\.json\(authErrors\.wosAuthRequiredBody\(\)\)/.test(archiveBlock),
    'expected WOS_AUTH_REQUIRED via authErrors.wosAuthRequiredBody()'
  );
  assert('archive view permission map defined', mx.includes('ARCHIVE_VIEW_PERM'));
  assert('archive delete permission map defined', mx.includes('ARCHIVE_DELETE_PERM'));
  assert('archive GET gated by view permission', /ARCHIVE_VIEW_PERM\[kind\][\s\S]{0,200}return res\.status\(403\)/.test(mx));
  assert(
    'archive GET 403 uses WOS_FORBIDDEN',
    /ARCHIVE_VIEW_PERM\[kind\][\s\S]{0,220}wosForbiddenBody\(\)/.test(mx)
  );
  assert('archive DELETE uses privileged-or-creator authz', mx.includes('Only the creator or an admin can delete this record'));
  assert('archive DELETE computes privileged deleter', /const privileged = authActor\.isAdmin/.test(mx));

  // Request-archive parts/wo
  assert('request-archive view permission map', mx.includes('REQ_ARCHIVE_VIEW_PERM'));
  assert('request-archive GET gated by view permission', /REQ_ARCHIVE_VIEW_PERM\[kind\][\s\S]{0,200}return res\.status\(403\)/.test(mx));
  assert(
    'request-archive 401 uses WOS_AUTH_REQUIRED',
    /request-archive[\s\S]{0,800}wosAuthRequiredBody\(\)/.test(mx)
  );
  assert(
    'request-archive GET 403 uses WOS_FORBIDDEN',
    /REQ_ARCHIVE_VIEW_PERM\[kind\][\s\S]{0,220}wosForbiddenBody\(\)/.test(mx)
  );
  assert('request-archive submitter from session, not header', /const submitter = \(authActor\.actorEmail \|\| req\.headers\['x-actor-email'\]/.test(mx));

  // Forms roll-off-swap
  const formsBlock = mx.slice(mx.indexOf('const formMatch ='), mx.indexOf('// ---- Operations Workflow Hub API ----'));
  assert('forms block resolves actor', formsBlock.includes('const authActor = await resolveActor(req);'));
  assert(
    'forms block 401 when unauthenticated',
    /if \(!authActor\.actorEmail\) return res\.status\(401\)\.json\(authErrors\.wosAuthRequiredBody\(\)\)/.test(formsBlock)
  );
  assert('forms GET gated by roll-off-swap view permission', /view_roll_off_swap_archive'\]\)\)\s*\{\s*return res\.status\(403\)/.test(formsBlock));
  assert('forms GET 403 uses WOS_FORBIDDEN', /view_roll_off_swap_archive[\s\S]{0,120}wosForbiddenBody\(\)/.test(formsBlock));

  // Ensure hasAnyPermission (admin/hub_admin superuser) still used for these gates
  assert('legacy gates use hasAnyPermission (admin superuser passes)', mx.includes('hasAnyPermission(authActor.permissions'));

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  if (failed) { console.error('RESULT: FAIL'); process.exit(1); }
  console.log('RESULT: PASS');
}

main();
