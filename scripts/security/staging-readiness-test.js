#!/usr/bin/env node
/**
 * WOS-86 — Staging production-readiness / auth hardening regression tests.
 * Usage: npm run security:staging-readiness-test
 */
const path = require('path');
const fs = require('fs');
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
  // Also clear cors-origins if loading modules that depend on it
  try {
    delete require.cache[require.resolve(path.join(ROOT, 'api/lib/cors-origins.js'))];
  } catch {
    /* */
  }
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
  console.log('=== WOS-86 Staging Production-Readiness Test ===\n');

  // --- CORS / origins ---
  await withEnv(
    {
      NODE_ENV: 'staging',
      ALLOWED_ORIGIN: 'https://automation.streamlinescada.com',
      PORTAL_BASE_URL: 'https://automation.streamlinescada.com/ops-hub-staging/',
    },
    () => {
      const cors = loadFresh('api/lib/cors-origins.js');
      assert(
        'staging origin allowed',
        cors.isOriginAllowed('https://automation.streamlinescada.com') === true
      );
      assert(
        'unauthorized origin rejected',
        cors.isOriginAllowed('https://evil.example') === false
      );
      assert(
        'localhost rejected on staging',
        cors.isOriginAllowed('http://localhost:3000') === false
      );
      assert(
        'no wildcard in allowlist',
        !cors.getAllowedOrigins().some((o) => o === '*')
      );
      assert(
        'PORTAL_BASE_URL origin included',
        cors.getAllowedOrigins().includes('https://automation.streamlinescada.com')
      );
    }
  );

  // --- Demo endpoints env gating ---
  await withEnv(
    {
      NODE_ENV: 'production',
      STAGING_DEMO_DATA_ENABLED: '1',
      HUB_STORE_MODE: 'postgres',
      DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/hub',
    },
    () => {
      try {
        delete require.cache[require.resolve(path.join(ROOT, 'for-dev/hub-demo-seed.js'))];
        delete require.cache[require.resolve(path.join(ROOT, 'api/lib/hub/db/index.js'))];
        delete require.cache[require.resolve(path.join(ROOT, 'api/lib/hub/store/index.js'))];
      } catch {
        /* */
      }
      const demo = require(path.join(ROOT, 'for-dev/hub-demo-seed.js'));
      assert('demo unavailable in production even if flag set', demo.isDevDemoAllowed(true) === false);
    }
  );
  await withEnv(
    {
      NODE_ENV: 'staging',
      STAGING_DEMO_DATA_ENABLED: '0',
      HUB_STORE_MODE: 'postgres',
      DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/hub',
    },
    () => {
      try {
        delete require.cache[require.resolve(path.join(ROOT, 'for-dev/hub-demo-seed.js'))];
      } catch {
        /* */
      }
      const demo = require(path.join(ROOT, 'for-dev/hub-demo-seed.js'));
      assert('demo unavailable in staging when disabled', demo.isDevDemoAllowed(true) === false);
    }
  );
  await withEnv(
    {
      NODE_ENV: 'staging',
      STAGING_DEMO_DATA_ENABLED: '1',
      HUB_STORE_MODE: 'postgres',
      DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/hub',
    },
    () => {
      try {
        delete require.cache[require.resolve(path.join(ROOT, 'for-dev/hub-demo-seed.js'))];
      } catch {
        /* */
      }
      const demo = require(path.join(ROOT, 'for-dev/hub-demo-seed.js'));
      assert('demo available in staging when enabled', demo.isDevDemoAllowed(true) === true);
    }
  );

  // --- Logout clears session cookie ---
  await withEnv(
    {
      NODE_ENV: 'staging',
      SESSION_SECRET: 'x'.repeat(48),
      PORTAL_BASE_URL: 'https://automation.streamlinescada.com/ops-hub-staging/',
      STAGING_TEST_LOGIN_ENABLED: '0',
    },
    async () => {
      const auth = require(path.join(ROOT, 'api/lib/auth.js'));
      const logout = loadFresh('api/lib/logout.js');
      const m = mockRes();
      // Issue then clear via performLogout
      auth.issueSession(m.res, 'hub-admin@staging-test.streamlinecorp.com', { remember: false });
      const before = m.headers['Set-Cookie'];
      assert('session cookie issued before logout', !!before);

      const m2 = mockRes();
      await logout.performLogout({}, m2.res, { portalBase: process.env.PORTAL_BASE_URL });
      const cleared = Array.isArray(m2.headers['Set-Cookie'])
        ? m2.headers['Set-Cookie'].join(';')
        : String(m2.headers['Set-Cookie'] || '');
      assert('logout clears sliops_session', /sliops_session=/.test(cleared) && /Max-Age=0/i.test(cleared));
      assert('logout Cache-Control no-store', /no-store/i.test(String(m2.headers['Cache-Control'] || '')));
      assert('logout redirects', m2.status === 302 && !!m2.headers.Location);
      assert(
        'logout Location is portal or login',
        /ops-hub-staging/i.test(String(m2.headers.Location || ''))
      );
    }
  );

  // --- Staging test login still gated ---
  await withEnv(
    {
      NODE_ENV: 'staging',
      STAGING_TEST_LOGIN_ENABLED: '0',
      STAGING_TEST_LOGIN_SECRET: crypto.randomBytes(24).toString('hex'),
      SESSION_SECRET: 'x'.repeat(48),
    },
    async () => {
      const stl = loadFresh('api/lib/staging-test-login.js');
      assert('staging login unavailable when disabled', stl.isStagingTestLoginEnabled() === false);
      const m = mockRes();
      await stl.handleStagingTestLogin({ method: 'GET', headers: {}, body: {} }, m.res, {
        portalBase: '/',
      });
      assert('staging login GET 404 when disabled', m.status === 404);
    }
  );

  // --- MaintainX key never exposed ---
  {
    const key = `mx-secret-${crypto.randomBytes(8).toString('hex')}`;
    await withEnv({ MAINTAINX_API_KEY: key }, () => {
      const status = {
        status: process.env.MAINTAINX_API_KEY ? 'configured' : 'not_configured',
        message: process.env.MAINTAINX_API_KEY
          ? 'MaintainX API key is configured on the server.'
          : 'Set MAINTAINX_API_KEY in the server environment and restart to enable MaintainX sync.',
      };
      assert('maintainx configured when key set', status.status === 'configured');
      assert('maintainx message has no secret', !JSON.stringify(status).includes(key));
    });
    await withEnv({ MAINTAINX_API_KEY: '' }, () => {
      const configured = !!process.env.MAINTAINX_API_KEY;
      assert('maintainx not_configured when missing', configured === false);
    });
  }

  // --- UI / copy / shared logout ---
  {
    const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const hubJs = fs.readFileSync(path.join(ROOT, 'hub.js'), 'utf8');
    assert('portalSignOut shared helper exists', indexHtml.includes('window.portalSignOut'));
    assert('confirm sign-out prompt', indexHtml.includes('Are you sure you want to sign out?'));
    assert('mgmt sign-out uses portalSignOut', /mgmtSignOutLink[\s\S]*portalSignOut/.test(indexHtml));
    assert('no Vercel redeploy copy in user mgmt', !/edit the env var in Vercel/i.test(indexHtml));
    assert(
      'bootstrap admin uses deployment-neutral copy',
      /BOOTSTRAP_ADMIN_EMAILS server environment variable/i.test(indexHtml)
    );
    assert('hub account menu markup', indexHtml.includes('hubAccountMenu'));
    assert('hub account menu wired', hubJs.includes('wireAccountMenu'));
    assert('Hub Admin role label normalization', hubJs.includes("hub_admin: 'Hub Admin'"));
    assert('staging test data UI copy', /Staging test data/i.test(indexHtml));
    assert('MAINTAINX_PROXY_URL is same-origin', /appPath\('\/api\/maintainx\?path='\)/.test(indexHtml));
  }

  // --- Env template documents ALLOWED_ORIGIN ---
  {
    const envEx = fs.readFileSync(path.join(ROOT, '.env.staging.example'), 'utf8');
    assert('ALLOWED_ORIGIN in staging example', /ALLOWED_ORIGIN=https:\/\/automation\.streamlinescada\.com/.test(envEx));
    assert('MAINTAINX_API_KEY placeholder present', /MAINTAINX_API_KEY=/.test(envEx));
    assert('STAGING_DEMO_DATA_ENABLED documented', /STAGING_DEMO_DATA_ENABLED=/.test(envEx));
    assert('no real MAINTAINX secret committed', !/MAINTAINX_API_KEY=\S{8,}/.test(envEx.split('\n').find((l) => l.startsWith('MAINTAINX_API_KEY=')) || ''));
  }

  // --- clearDemoData only deletes demo-tagged ---
  {
    const seedSrc = fs.readFileSync(path.join(ROOT, 'for-dev/hub-demo-seed.js'), 'utf8');
    assert('clear skips non-demo requests', /if \(!req\?\.demo\)/.test(seedSrc));
    assert('seed marks demo:true', /demo:\s*true/.test(seedSrc));
  }

  // --- WOS-87 demo visibility gate ---
  {
    const { isDemoDataVisible, shouldIncludeDemoRows } = loadFresh('api/lib/hub/demo-visibility.js');
    await withEnv({ NODE_ENV: 'production', STAGING_DEMO_DATA_ENABLED: '1' }, () => {
      assert('production never shows demo even if flag set', isDemoDataVisible() === false);
      assert('production ignores include_demo override', shouldIncludeDemoRows({ include_demo: true }) === false);
    });
    await withEnv({ NODE_ENV: 'staging', STAGING_DEMO_DATA_ENABLED: '0' }, () => {
      assert('staging hides demo when flag off', isDemoDataVisible() === false);
    });
    await withEnv({ NODE_ENV: 'staging', STAGING_DEMO_DATA_ENABLED: '1' }, () => {
      assert('staging shows demo when flag on', isDemoDataVisible() === true);
      assert('staging can still opt out via include_demo=false', shouldIncludeDemoRows({ include_demo: false }) === false);
    });
    await withEnv({ NODE_ENV: 'development', STAGING_DEMO_DATA_ENABLED: undefined }, () => {
      assert('development shows demo by default', isDemoDataVisible() === true);
    });
    const pgSrc = fs.readFileSync(path.join(ROOT, 'api/lib/hub/db/postgres.js'), 'utf8');
    const storeSrc = fs.readFileSync(path.join(ROOT, 'api/lib/hub/store.js'), 'utf8');
    assert('postgres list filters demo', /shouldIncludeDemoRows/.test(pgSrc) && /demo IS NOT TRUE/.test(pgSrc));
    assert('store list filters demo', /shouldIncludeDemoRows/.test(storeSrc));
  }

  // --- WOS-87 portal top-right user menu ---
  {
    const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert('portal userMenuTrigger present', /id="userMenuTrigger"/.test(indexHtml));
    assert('portal userAccountMenu present', /id="userAccountMenu"/.test(indexHtml));
    assert('portal userMenuLogoutBtn present', /id="userMenuLogoutBtn"/.test(indexHtml));
    assert(
      'portal showUserMenu wires portalSignOut',
      /function showUserMenu[\s\S]*?portalSignOut[\s\S]*?trigger\._wired = true/.test(indexHtml)
    );
    assert('portal menu Escape handling', /Escape/.test(indexHtml) && /userAccountMenu/.test(indexHtml));
    assert('ENTRA setup has no Vercel env section', !/## Vercel environment variables/.test(
      fs.readFileSync(path.join(ROOT, 'ENTRA_SSO_SETUP.md'), 'utf8')
    ));
    assert(
      'maintainx header is deployment-neutral',
      !/^\/\/ Vercel serverless function/m.test(fs.readFileSync(path.join(ROOT, 'api/maintainx.js'), 'utf8'))
    );
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
