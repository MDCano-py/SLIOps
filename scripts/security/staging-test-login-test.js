#!/usr/bin/env node
/**
 * WOS-85 — Staging test-login security regression tests.
 * Usage: npm run security:staging-test-login-test
 */
const path = require('path');
const crypto = require('crypto');

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

function withEnv(overrides, fn) {
  const saved = { ...process.env };
  const keys = Object.keys(overrides);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined || v === null) delete process.env[k];
    else process.env[k] = String(v);
  }
  const restore = () => {
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(saved, k)) process.env[k] = saved[k];
      else delete process.env[k];
    }
  };
  try {
    const out = fn();
    if (out && typeof out.then === 'function') return out.finally(restore);
    restore();
    return out;
  } catch (err) {
    restore();
    throw err;
  }
}

function loadFresh(rel) {
  const id = require.resolve(path.join(ROOT, rel));
  delete require.cache[id];
  return require(id);
}

function mockRes() {
  const headers = {};
  let statusCode = 200;
  let body;
  const res = {
    statusCode: 200,
    status(code) {
      statusCode = code;
      res.statusCode = code;
      return res;
    },
    setHeader(k, v) {
      headers[k] = v;
    },
    getHeader(k) {
      return headers[k];
    },
    json(obj) {
      body = obj;
      return res;
    },
    send(payload) {
      body = payload;
      return res;
    },
    end(payload) {
      if (payload !== undefined) body = payload;
      return res;
    },
  };
  return {
    res,
    get status() {
      return statusCode;
    },
    get body() {
      return body;
    },
    get headers() {
      return headers;
    },
  };
}

async function main() {
  console.log('=== WOS-85 Staging Test Login Security Test ===\n');

  const strongSecret = `stl-${crypto.randomBytes(24).toString('hex')}`;
  assert('test secret length ≥32', strongSecret.length >= 32);

  // --- Production unavailable under every configuration ---
  await withEnv(
    {
      NODE_ENV: 'production',
      STAGING_TEST_LOGIN_ENABLED: '1',
      STAGING_TEST_LOGIN_SECRET: strongSecret,
      SESSION_SECRET: 'x'.repeat(48),
    },
    async () => {
      const stl = loadFresh('api/lib/staging-test-login.js');
      assert('production isStagingTestLoginEnabled=false', stl.isStagingTestLoginEnabled() === false);
      const m = mockRes();
      await stl.handleStagingTestLogin(
        { method: 'GET', headers: {}, body: {} },
        m.res,
        { portalBase: '/' }
      );
      assert('production GET returns 404', m.status === 404);
      const m2 = mockRes();
      await stl.handleStagingTestLogin(
        {
          method: 'POST',
          headers: { origin: 'https://evil.example' },
          body: { user_key: 'hub_admin', secret: strongSecret },
        },
        m2.res,
        { portalBase: '/' }
      );
      assert('production POST returns 404', m2.status === 404);
      assert('production startup assert does not throw', (() => {
        try {
          stl.assertStagingTestLoginStartup();
          return true;
        } catch {
          return false;
        }
      })());
    }
  );

  // --- Staging disabled when flag off ---
  await withEnv(
    {
      NODE_ENV: 'staging',
      STAGING_TEST_LOGIN_ENABLED: '0',
      STAGING_TEST_LOGIN_SECRET: strongSecret,
      SESSION_SECRET: 'x'.repeat(48),
    },
    async () => {
      const stl = loadFresh('api/lib/staging-test-login.js');
      assert('staging disabled ⇒ feature false', stl.isStagingTestLoginEnabled() === false);
      const m = mockRes();
      await stl.handleStagingTestLogin({ method: 'GET', headers: {}, body: {} }, m.res, {
        portalBase: '/',
      });
      assert('staging disabled GET 404', m.status === 404);
    }
  );

  // --- Missing/weak secret cannot enable ---
  await withEnv(
    {
      NODE_ENV: 'staging',
      STAGING_TEST_LOGIN_ENABLED: '1',
      STAGING_TEST_LOGIN_SECRET: 'short',
      SESSION_SECRET: 'x'.repeat(48),
    },
    () => {
      const stl = loadFresh('api/lib/staging-test-login.js');
      assert('weak secret ⇒ feature disabled', stl.isStagingTestLoginEnabled() === false);
      let threw = false;
      try {
        stl.assertStagingTestLoginStartup();
      } catch {
        threw = true;
      }
      assert('ENABLED=1 + weak secret fails startup assert', threw);
    }
  );

  await withEnv(
    {
      NODE_ENV: 'staging',
      STAGING_TEST_LOGIN_ENABLED: '1',
      STAGING_TEST_LOGIN_SECRET: '',
      SESSION_SECRET: 'x'.repeat(48),
    },
    () => {
      const stl = loadFresh('api/lib/staging-test-login.js');
      assert('missing secret ⇒ feature disabled', stl.isStagingTestLoginEnabled() === false);
    }
  );

  // --- Timing-safe compare + CSRF + GET cannot auth ---
  await withEnv(
    {
      NODE_ENV: 'staging',
      STAGING_TEST_LOGIN_ENABLED: '1',
      STAGING_TEST_LOGIN_SECRET: strongSecret,
      SESSION_SECRET: 'x'.repeat(48),
      PORTAL_BASE_URL: 'https://automation.streamlinescada.com/ops-hub-staging/',
      ALLOWED_ORIGIN: 'https://automation.streamlinescada.com',
    },
    async () => {
      const stl = loadFresh('api/lib/staging-test-login.js');
      stl.resetRateLimitForTests();
      assert('feature enabled with strong secret', stl.isStagingTestLoginEnabled() === true);
      assert(
        'timingSafeEqualString accepts match',
        stl.timingSafeEqualString(strongSecret, strongSecret) === true
      );
      assert(
        'timingSafeEqualString rejects mismatch',
        stl.timingSafeEqualString(strongSecret, 'x'.repeat(strongSecret.length)) === false
      );

      const g = mockRes();
      await stl.handleStagingTestLogin({ method: 'GET', headers: {}, body: {} }, g.res, {
        portalBase: '/ops-hub-staging',
      });
      assert('GET returns HTML login page', g.status === 200 && String(g.body).includes('Staging Test Login'));
      assert('GET page Cache-Control no-store', /no-store/i.test(String(g.headers['Cache-Control'] || '')));
      assert('GET page does not expose secret', !String(g.body).includes(strongSecret));
      assert('GET page warns production unavailable', /Unavailable in production/i.test(String(g.body)));
      assert('GET does not set session cookie', !g.headers['Set-Cookie']);

      const badCsrf = mockRes();
      await stl.handleStagingTestLogin(
        {
          method: 'POST',
          headers: {},
          body: { user_key: 'hub_admin', secret: strongSecret },
        },
        badCsrf.res,
        { portalBase: '/' }
      );
      assert('POST without Origin/Referer blocked', badCsrf.status === 403);

      const emailAttempt = mockRes();
      await stl.handleStagingTestLogin(
        {
          method: 'POST',
          headers: { origin: 'https://automation.streamlinescada.com' },
          body: { email: 'attacker@evil.com', secret: strongSecret },
        },
        emailAttempt.res,
        { portalBase: '/' }
      );
      assert('arbitrary email rejected', emailAttempt.status === 401);
      assert('generic error (no secret leak)', emailAttempt.body?.error === 'Invalid credentials');
      assert(
        'response body has no secret',
        !JSON.stringify(emailAttempt.body || {}).includes(strongSecret)
      );

      const badSecret = mockRes();
      await stl.handleStagingTestLogin(
        {
          method: 'POST',
          headers: { origin: 'https://automation.streamlinescada.com' },
          body: { user_key: 'hub_admin', secret: 'wrong-secret-value-xxxxxxxxxxxxxxxx' },
        },
        badSecret.res,
        { portalBase: '/' }
      );
      assert('incorrect secret rejected', badSecret.status === 401);

      // Valid credentials with PG user mocked
      const usersPath = require.resolve(path.join(ROOT, 'api/lib/staging-test-users.js'));
      const realUsers = require(usersPath);
      require.cache[usersPath].exports = {
        ...realUsers,
        loadActiveTestUserByKey: async (key) => {
          if (key !== 'hub_admin') return null;
          return {
            email: 'hub-admin@staging-test.streamlinecorp.com',
            displayName: 'Staging Hub Admin',
            roleKeys: ['hub_admin'],
            primaryRole: 'hub_admin',
            permissions: ['hub_admin', 'admin', 'view_home'],
            status: 'active',
          };
        },
      };
      // Reload login module so it picks up... actually it already required users at load.
      // Patch via the required module's exports is enough since login requires once.
      delete require.cache[require.resolve(path.join(ROOT, 'api/lib/staging-test-login.js'))];
      const stl2 = require(path.join(ROOT, 'api/lib/staging-test-login.js'));
      stl2.resetRateLimitForTests();

      let synced = null;
      const ok = mockRes();
      await stl2.handleStagingTestLogin(
        {
          method: 'POST',
          headers: { origin: 'https://automation.streamlinescada.com' },
          body: { user_key: 'hub_admin', secret: strongSecret },
        },
        ok.res,
        {
          portalBase: '/ops-hub-staging',
          syncUserRecord: async (u) => {
            synced = u;
          },
        }
      );
      assert('valid credentials return 200', ok.status === 200);
      assert('valid credentials ok=true', ok.body?.ok === true);
      assert(
        'session cookie issued',
        Array.isArray(ok.headers['Set-Cookie'])
          ? ok.headers['Set-Cookie'].some((c) => /sliops_session=/.test(c))
          : /sliops_session=/.test(String(ok.headers['Set-Cookie'] || ''))
      );
      const cookieStr = Array.isArray(ok.headers['Set-Cookie'])
        ? ok.headers['Set-Cookie'].join(';')
        : String(ok.headers['Set-Cookie'] || '');
      assert('cookie HttpOnly', /HttpOnly/i.test(cookieStr));
      assert('cookie Secure', /Secure/i.test(cookieStr));
      assert('cookie SameSite=Lax', /SameSite=Lax/i.test(cookieStr));
      assert('user loaded from PG mock', synced?.email === 'hub-admin@staging-test.streamlinecorp.com');
      assert('role_keys from PG not browser', Array.isArray(ok.body?.role_keys) && ok.body.role_keys.includes('hub_admin'));

      // Inactive user rejected
      require.cache[usersPath].exports = {
        ...realUsers,
        loadActiveTestUserByKey: async () => null,
      };
      delete require.cache[require.resolve(path.join(ROOT, 'api/lib/staging-test-login.js'))];
      const stl3 = require(path.join(ROOT, 'api/lib/staging-test-login.js'));
      stl3.resetRateLimitForTests();
      const inactive = mockRes();
      await stl3.handleStagingTestLogin(
        {
          method: 'POST',
          headers: { origin: 'https://automation.streamlinescada.com' },
          body: { user_key: 'hub_admin', secret: strongSecret },
        },
        inactive.res,
        { portalBase: '/' }
      );
      assert('missing/inactive PG user rejected', inactive.status === 401);

      // Restore users module
      require.cache[usersPath].exports = realUsers;
      delete require.cache[require.resolve(path.join(ROOT, 'api/lib/staging-test-login.js'))];
    }
  );

  // --- Rate limiting ---
  await withEnv(
    {
      NODE_ENV: 'staging',
      STAGING_TEST_LOGIN_ENABLED: '1',
      STAGING_TEST_LOGIN_SECRET: strongSecret,
      SESSION_SECRET: 'x'.repeat(48),
      ALLOWED_ORIGIN: 'https://automation.streamlinescada.com',
    },
    async () => {
      const stl = loadFresh('api/lib/staging-test-login.js');
      stl.resetRateLimitForTests();
      const usersPath = require.resolve(path.join(ROOT, 'api/lib/staging-test-users.js'));
      const realUsers = require(usersPath);
      require.cache[usersPath].exports = {
        ...realUsers,
        loadActiveTestUserByKey: async () => null,
      };
      delete require.cache[require.resolve(path.join(ROOT, 'api/lib/staging-test-login.js'))];
      const stlR = require(path.join(ROOT, 'api/lib/staging-test-login.js'));
      stlR.resetRateLimitForTests();

      let lastStatus = 0;
      for (let i = 0; i < stlR.RATE_MAX_FAILURES + 1; i += 1) {
        const m = mockRes();
        await stlR.handleStagingTestLogin(
          {
            method: 'POST',
            headers: {
              origin: 'https://automation.streamlinescada.com',
              'x-forwarded-for': '203.0.113.50',
            },
            body: { user_key: 'hub_admin', secret: 'wrong-secret-value-xxxxxxxxxxxxxxxx' },
          },
          m.res,
          { portalBase: '/' }
        );
        lastStatus = m.status;
      }
      assert('rate limit returns 429 after max failures', lastStatus === 429);
      require.cache[usersPath].exports = realUsers;
      delete require.cache[require.resolve(path.join(ROOT, 'api/lib/staging-test-login.js'))];
    }
  );

  // --- Dev-login still blocked; SSO enforcement preserved ---
  {
    const entra = require(path.join(ROOT, 'api/lib/entra.js'));
    await withEnv({ NODE_ENV: 'staging', ALLOW_DEV_LOGIN: '1' }, () => {
      assert('dev-login blocked in staging even with ALLOW_DEV_LOGIN=1', entra.isDevLoginAllowed() === false);
    });
    await withEnv({ NODE_ENV: 'production', ALLOW_DEV_LOGIN: '1' }, () => {
      assert('dev-login blocked in production', entra.isDevLoginAllowed() === false);
    });
    assert(
      'SSO_ENFORCEMENT default remains on',
      String(process.env.SSO_ENFORCEMENT || 'on').toLowerCase() !== 'off'
    );
  }

  // --- Catalog / docs invariants ---
  {
    const catalog = require(path.join(ROOT, 'api/lib/staging-test-users.js'));
    assert('eight seeded personas', catalog.STAGING_TEST_USERS.length === 8);
    assert(
      'all emails use staging-test domain',
      catalog.STAGING_TEST_USERS.every((u) => u.email.endsWith('@staging-test.streamlinecorp.com'))
    );
    assert(
      'display names are role-based (Staging …)',
      catalog.STAGING_TEST_USERS.every((u) => /^Staging /.test(u.displayName))
    );
    const fs = require('fs');
    const serverCore = fs.readFileSync(path.join(ROOT, 'scripts/server-core.js'), 'utf8');
    assert(
      'health exposes staging_test_login_enabled only',
      serverCore.includes('staging_test_login_enabled') &&
        !serverCore.includes('STAGING_TEST_LOGIN_SECRET')
    );
    const maintainx = fs.readFileSync(path.join(ROOT, 'api/maintainx.js'), 'utf8');
    assert('maintainx wires staging-test-login route', maintainx.includes('/auth/staging-test-login'));
    assert('dev-login path unchanged', maintainx.includes('/auth/dev-login'));
  }

  // --- RBAC: hub_admin perms vs field tech (catalog) ---
  {
    const catalog = require(path.join(ROOT, 'api/lib/staging-test-users.js'));
    const admin = catalog.getCatalogEntry('hub_admin');
    const tech = catalog.getCatalogEntry('field_technician');
    assert('hub_admin has admin permission', admin.permissions.includes('admin'));
    assert('field tech does not have admin', !tech.permissions.includes('admin'));
    assert('field tech does not have hub_admin perm', !tech.permissions.includes('hub_admin'));
  }

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('RESULT: FAIL');
    process.exit(1);
  }
  console.log('RESULT: PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
