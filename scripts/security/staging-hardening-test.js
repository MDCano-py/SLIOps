#!/usr/bin/env node
/**
 * WOS-79 — Staging security hardening test.
 * Usage: npm run security:staging-hardening-test
 *
 * Verifies dev/demo bypasses are blocked outside local/dev, production-safety
 * guards refuse deployed environments, session cookies are hardened, baseline
 * security headers + body-size cap are wired, and demo/seed routes are fenced.
 * Mix of functional (env guard) checks and static source assertions.
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

function throwsWith(fn) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function main() {
  console.log('=== WOS-79 Staging Security Hardening Test ===\n');

  // --- Functional: production/staging safety guards refuse deployed envs ---
  const savedEnv = { ...process.env };
  try {
    const env = require(path.join(ROOT, 'scripts', 'db', 'env.js'));

    process.env.NODE_ENV = 'staging';
    assert('assertLocalSeedAllowed refuses staging', throwsWith(() => env.assertLocalSeedAllowed()));
    assert(
      'assertLocalDemoValidationAllowed refuses staging',
      throwsWith(() => env.assertLocalDemoValidationAllowed())
    );

    process.env.NODE_ENV = 'production';
    assert('assertLocalSeedAllowed refuses production', throwsWith(() => env.assertLocalSeedAllowed()));
    assert('assertResetAllowed refuses production', throwsWith(() => env.assertResetAllowed()));

    // Staging reset must refuse a non-local host without explicit confirm.
    process.env.NODE_ENV = 'staging';
    process.env.DATABASE_URL = 'postgresql://u:p@rds.example.com:5432/app';
    delete process.env.DATABASE_URL_CONFIRM_RESET;
    assert(
      'assertResetAllowed refuses non-local staging host',
      throwsWith(() => env.assertResetAllowed())
    );

    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL = 'postgresql://u:p@127.0.0.1:5432/app';
    assert('assertLocalSeedAllowed allows local development', !throwsWith(() => env.assertLocalSeedAllowed()));
  } finally {
    process.env = { ...savedEnv };
  }

  // --- Functional: staging startup requires DATABASE_URL for postgres mode ---
  {
    const saved = { ...process.env };
    try {
      const cfg = require(path.join(ROOT, 'api', 'lib', 'hub', 'db', 'config.js'));
      delete process.env.DATABASE_URL;
      assert(
        'assertPostgresConfigured throws without DATABASE_URL',
        throwsWith(() => cfg.assertPostgresConfigured())
      );
    } finally {
      process.env = { ...saved };
    }
  }

  // --- Functional: session cookies are hardened & SESSION_SECRET enforced ---
  {
    const saved = { ...process.env };
    try {
      const auth = require(path.join(ROOT, 'api', 'lib', 'auth.js'));
      const cookie = auth.buildSetCookie('sliops_session', 'abc', 3600);
      assert('Session cookie is HttpOnly', /HttpOnly/.test(cookie));
      assert('Session cookie is Secure', /Secure/.test(cookie));
      assert('Session cookie is SameSite=Lax', /SameSite=Lax/.test(cookie));

      delete process.env.SESSION_SECRET;
      assert('signing throws without SESSION_SECRET', throwsWith(() => auth.signJwt({ email: 'a@b.c' }, 60)));
      process.env.SESSION_SECRET = 'x'.repeat(16);
      assert('signing throws with short SESSION_SECRET (<32)', throwsWith(() => auth.signJwt({ email: 'a@b.c' }, 60)));
      process.env.SESSION_SECRET = 'x'.repeat(48);
      assert('signing works with strong SESSION_SECRET', !throwsWith(() => auth.signJwt({ email: 'a@b.c' }, 60)));
    } finally {
      process.env = { ...saved };
    }
  }

  // --- Source: DEMO_BYPASS never honored on staging/production ---
  const maintainx = read('api/maintainx.js');
  assert(
    'isDemoBypassActive returns false for staging/production',
    /env === 'staging' \|\| env === 'production'\)\s*\{\s*return false;/.test(maintainx)
  );

  // --- Source: client _noauth=1 / localhost bypass gated to local/dev ---
  const indexHtml = read('index.html');
  assert('index.html gates _noauth via isLocalOrDevPortal', indexHtml.includes('isLocalOrDevPortal'));
  assert('index.html ignores _noauth outside local/dev', indexHtml.includes('_noauth=1 ignored outside'));
  const rbacClient = read('rbac-client.js');
  assert('rbac-client isPortalNoAuthMode gated to local/dev', /isPortalNoAuthMode[\s\S]*isLocalOrDevPortal/.test(rbacClient));

  // --- Source: demo seed/clear routes fenced to development ---
  const hubRoutes = read('api/lib/hub/routes.js');
  assert('seed-demo route returns 403 when not dev', /seed-demo-data[\s\S]*?403/.test(hubRoutes));
  const demoSeed = read('for-dev/hub-demo-seed.js');
  assert(
    'isDevDemoAllowed excludes production and staging',
    /env !== 'production' && env !== 'staging'/.test(demoSeed)
  );

  // --- Source: db:validate never seeds demo data ---
  const validate = read('scripts/db/validate.js');
  assert('db:validate documents no demo seed', /Does NOT seed demo data/.test(validate));

  // --- Source: baseline security headers + body-size cap in server-core ---
  const serverCore = read('scripts/server-core.js');
  assert('server-core applies baseline security headers', serverCore.includes('applyBaseSecurityHeaders'));
  assert('server-core sets X-Content-Type-Options nosniff', serverCore.includes("'X-Content-Type-Options', 'nosniff'"));
  assert('server-core sets X-Frame-Options', serverCore.includes("'X-Frame-Options'"));
  assert('server-core sets Referrer-Policy', serverCore.includes("'Referrer-Policy'"));
  assert('server-core sets HSTS on staging/production', serverCore.includes('Strict-Transport-Security'));
  assert('server-core enforces request body size cap', serverCore.includes('getMaxRequestBodyBytes'));
  assert('server-core returns 413 on oversized body', serverCore.includes('413'));
  assert(
    'server-core asserts Postgres configured on deploy',
    serverCore.includes('assertPostgresConfigured')
  );

  // --- Source: .gitignore covers .env variants but keeps templates ---
  const gitignore = read('.gitignore');
  assert('.gitignore ignores all .env variants', gitignore.includes('.env.*'));
  assert('.gitignore keeps *.example templates', gitignore.includes('!.env*.example'));

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('RESULT: FAIL');
    process.exit(1);
  }
  console.log('RESULT: PASS');
}

main();
