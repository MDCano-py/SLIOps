#!/usr/bin/env node
/**
 * WOS-80 — No-Origin auth gate + CORS/dev-login hardening test.
 * Usage: npm run security:no-origin-auth-gate-test
 *
 * - Static: the SSO gate only trusts no-Origin requests outside staging/prod,
 *   CORS auto-allows localhost/preview only outside staging/prod, and a CSRF
 *   Referer check guards state-changing requests.
 * - Functional: entra dev-login is refused (404) on staging/production even
 *   when ALLOW_DEV_LOGIN is set.
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

function mockRes() {
  return {
    code: null,
    payload: null,
    status(c) { this.code = c; return this; },
    json(b) { this.payload = b; return this; },
    setHeader() {},
    send(b) { this.payload = b; return this; },
    end(b) { if (b !== undefined) this.payload = b; return this; },
  };
}

async function main() {
  console.log('=== WOS-80 No-Origin Auth Gate + CORS/Dev-Login Test ===\n');
  const mx = read('api/maintainx.js');

  // No-Origin gate
  assert('gate computes deployed flag', mx.includes('const gateDeployed = gateEnv'));
  assert(
    'no-Origin only trusted outside staging/production',
    mx.includes('const isServerToServer = !req.headers.origin && !gateDeployed;')
  );

  // CORS localhost/preview gating
  assert('CORS computes deployed flag', mx.includes('const corsDeployed = corsEnv'));
  assert('CORS localhost/preview gated to non-deployed', /if \(!corsDeployed\)\s*\{[\s\S]{0,400}localhost/.test(mx));

  // CSRF Referer defense-in-depth
  assert('CSRF Referer check for state-changing methods', mx.includes('Cross-site request blocked'));
  assert(
    'CSRF check targets POST/PUT/PATCH/DELETE',
    /\['POST', 'PUT', 'PATCH', 'DELETE'\]\.includes\(req\.method\)/.test(mx)
  );

  // Functional: dev-login refused on staging/production
  const entra = require(path.join(ROOT, 'api', 'lib', 'entra.js'));
  const saved = { ...process.env };
  try {
    process.env.NODE_ENV = 'staging';
    process.env.ALLOW_DEV_LOGIN = '1';
    let res = mockRes();
    await entra.handleDevLogin({ method: 'GET', query: {}, headers: {} }, res, {});
    assert('dev-login refused (404) on staging even with ALLOW_DEV_LOGIN=1', res.code === 404);

    process.env.NODE_ENV = 'production';
    res = mockRes();
    await entra.handleDevLogin({ method: 'GET', query: {}, headers: {} }, res, {});
    assert('dev-login refused (404) on production even with ALLOW_DEV_LOGIN=1', res.code === 404);
  } finally {
    process.env = { ...saved };
  }

  // Source: entra gate blocks staging/production regardless of env flag
  const entraSrc = read('api/lib/entra.js');
  assert(
    'isDevLoginAllowed returns false for staging/production',
    /env === 'staging' \|\| env === 'production'\)\s*\{\s*return false;/.test(entraSrc)
  );

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  if (failed) { console.error('RESULT: FAIL'); process.exit(1); }
  console.log('RESULT: PASS');
}

main();
