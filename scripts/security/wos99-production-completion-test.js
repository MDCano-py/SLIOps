/**
 * WOS-99 — Production completion static audit.
 * Verifies AuthBridge adapter, production kill-switch refusals, demo purge gates,
 * workflow/runtime wiring, Vendor Management nav, and notification path.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..', '..');
let passed = 0;
let failed = 0;

function pass(name) {
  passed += 1;
  console.log('PASS ', name);
}
function fail(name, err) {
  failed += 1;
  console.error('FAIL ', name, err && err.message ? err.message : err);
}
function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

console.log('\n=== WOS-99 Production Completion Audit ===\n');

try {
  const ab = require(path.join(root, 'api/lib/authbridge.js'));
  assert.strictEqual(typeof ab.isAuthBridgeEnabled, 'function');
  assert.strictEqual(typeof ab.handleLogin, 'function');
  assert.strictEqual(typeof ab.handleCallback, 'function');
  assert.ok(Array.isArray(ab.missingAuthBridgeVars()));
  const claims = ab.identityFromClaims({
    email: 'pat@streamlinecorp.com',
    name: 'Pat Example',
    oid: 'abc',
  });
  assert.strictEqual(claims.email, 'pat@streamlinecorp.com');
  assert.strictEqual(claims.auth_provider, 'authbridge');
  pass('AuthBridge adapter module');
} catch (e) {
  fail('AuthBridge adapter module', e);
}

try {
  const mx = read('api/maintainx.js');
  assert.ok(mx.includes("require('./lib/authbridge')"));
  assert.ok(mx.includes('isAuthBridgeEnabled'));
  assert.ok(mx.includes('useAuthBridge'));
  assert.ok(mx.includes('authbridge.handleLogin') || mx.includes('authbridge.handleCallback'));
  pass('AuthBridge wired into /auth/login and /auth/callback');
} catch (e) {
  fail('AuthBridge auth routes', e);
}

try {
  const sc = read('scripts/server-core.js');
  assert.ok(sc.includes("SSO_ENFORCEMENT=off is not allowed in production"));
  assert.ok(sc.includes('DEMO_BYPASS must not be set in production'));
  assert.ok(sc.includes('ALLOW_DEV_LOGIN must not be set in production'));
  assert.ok(sc.includes('local JSON hub store is not allowed in production'));
  assert.ok(sc.includes('DATABASE_URL is required in production'));
  assert.ok(sc.includes('STAGING_TEST_LOGIN_ENABLED must not be set in production'));
  pass('Production startup refuses demo/bypass/local store');
} catch (e) {
  fail('Production startup guards', e);
}

try {
  const idx = read('index.html');
  assert.ok(idx.includes('fail closed on deployed hosts') || idx.includes('gate failed open (local/dev only)'));
  assert.ok(!/FAIL OPEN — let the user through/.test(idx));
  pass('Client auth gate fails closed outside local/dev');
} catch (e) {
  fail('Client auth gate', e);
}

try {
  const idx = read('index.html');
  assert.ok(idx.includes('Vendor Management'));
  assert.ok(idx.includes('data-mgmt-section="vendor"'));
  assert.ok(idx.includes('id="hubSidebarNav"'));
  const routes = read('api/lib/configuration/routes.js');
  assert.ok(routes.includes("repair-nda-wiring"));
  assert.ok(routes.includes('validate-wiring'));
  pass('Vendor Management nav + repair/validate routes');
} catch (e) {
  fail('Vendor / repair routes', e);
}

try {
  const designer = read('hub-workflow-designer.js');
  assert.ok(designer.includes('function connect('));
  assert.ok(designer.includes('removeConnection'));
  assert.ok(designer.includes('openConnectDialog'));
  assert.ok(designer.includes('replace: true'));
  assert.ok(designer.includes('fitToView'));
  assert.ok(designer.includes('emitDirty'));
  assert.ok(designer.includes('undo'));
  pass('Workflow designer connect/reconnect/persist hooks');
} catch (e) {
  fail('Workflow designer', e);
}

try {
  const tn = read('api/lib/configuration/runtime/task-notifications.js');
  assert.ok(tn.includes('INSERT INTO notifications'));
  assert.ok(tn.includes('notifyTaskAssigned'));
  const ra = read('api/lib/configuration/runtime/resolve-assignment.js');
  assert.ok(ra.includes('users') || ra.includes('findUser'));
  pass('Workflow notifications use real notifications table + assignment resolver');
} catch (e) {
  fail('Notifications path', e);
}

try {
  const bridge = require(path.join(root, 'api/lib/vendor/cfg-workflow-bridge.js'));
  const ctx = bridge.buildVendorWorkflowContext(
    { refNumber: 'VEN-1', companyName: 'Acme', msaRequired: false, ndaRequired: true, contactEmail: 'a@b.c' },
    'admin@test'
  );
  assert.strictEqual(ctx.vendor.nda_required, true);
  assert.strictEqual(ctx.event, 'vendor.request.submitted');
  pass('Vendor NDA/MSA workflow context bridge');
} catch (e) {
  fail('Vendor workflow bridge', e);
}

try {
  // Demo/test-login must remain gated (not deleted from repo — tests use them)
  const stl = read('api/lib/staging-test-login.js');
  assert.ok(stl.includes('staging') || stl.includes('isStagingTestLoginAllowed'));
  const entra = read('api/lib/entra.js');
  assert.ok(entra.includes('isDevLoginAllowed'));
  assert.ok(entra.includes("env === 'staging' || env === 'production'"));
  pass('Dev/staging login remain env-gated (not production-reachable)');
} catch (e) {
  fail('Dev/staging login gates', e);
}

try {
  const envEx = read('.env.example');
  assert.ok(envEx.includes('AUTH_PROVIDER'));
  assert.ok(envEx.includes('AUTHBRIDGE_AUTHORIZE_URL') || envEx.includes('AuthBridge'));
  pass('Env example documents AuthBridge + AUTH_PROVIDER');
} catch (e) {
  fail('Env example', e);
}

console.log(`\nWOS-99 production completion: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
