/**
 * Logout session clear + Entra post-logout landing tests.
 * Usage: npm run security:wos-logout-session-clear-test
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function loadFresh(rel) {
  const abs = path.join(ROOT, rel);
  delete require.cache[require.resolve(abs)];
  // Also bust auth / app-paths deps when reloading logout/entra
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}api${path.sep}lib${path.sep}auth.js`) ||
      key.includes(`${path.sep}api${path.sep}lib${path.sep}logout.js`) ||
      key.includes(`${path.sep}api${path.sep}lib${path.sep}entra.js`) ||
      key.includes(`${path.sep}api${path.sep}lib${path.sep}app-paths.js`)
    ) {
      delete require.cache[key];
    }
  }
  return require(abs);
}

function mockRes() {
  const headers = {};
  return {
    headers,
    status: null,
    res: {
      setHeader(k, v) {
        headers[k] = v;
      },
      getHeader(k) {
        return headers[k];
      },
      status(code) {
        this._status = code;
        return this;
      },
      end() {
        return this;
      },
      json() {
        return this;
      },
    },
    get statusCode() {
      return this.res._status;
    },
  };
}

function withEnv(env, fn) {
  const prev = { ...process.env };
  Object.assign(process.env, env);
  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      for (const k of Object.keys(process.env)) {
        if (!(k in prev)) delete process.env[k];
      }
      Object.assign(process.env, prev);
    });
}

function ok(name, cond) {
  assert.ok(cond, name);
  console.log(`  PASS  ${name}`);
}

async function main() {
  let failed = 0;
  const run = async (fn) => {
    try {
      await fn();
    } catch (err) {
      failed += 1;
      console.error(`  FAIL  ${err.message}`);
    }
  };

  console.log('\n=== resolvePostLogoutUrl signed_out ===');
  await run(() =>
    withEnv(
      {
        NODE_ENV: 'staging',
        SESSION_SECRET: 'x'.repeat(48),
        PORTAL_BASE_URL: 'https://automation.streamlinescada.com/ops-hub-staging/',
        APP_BASE_PATH: '/ops-hub-staging',
        STAGING_TEST_LOGIN_ENABLED: '0',
      },
      () => {
        const logout = loadFresh('api/lib/logout.js');
        const url = logout.resolvePostLogoutUrl(process.env.PORTAL_BASE_URL);
        ok('post-logout includes mount', /\/ops-hub-staging\/?/.test(url));
        ok('post-logout includes signed_out=1', /[?&]signed_out=1(?:&|$)/.test(url));
        ok(
          'appendSignedOutFlag is idempotent',
          logout.appendSignedOutFlag(url) === url
        );
      }
    )
  );

  console.log('\n=== clearSession clears cookies under Path=/ and mount ===');
  await run(() =>
    withEnv(
      {
        SESSION_SECRET: 'x'.repeat(48),
        APP_BASE_PATH: '/ops-hub-staging',
      },
      () => {
        const auth = loadFresh('api/lib/auth.js');
        const m = mockRes();
        auth.issueSession(m.res, 'user@streamlinecorp.com', { remember: false });
        auth.issueOidcIdTokenCookie(m.res, 'eyJhbGciOiJSUzI1NiJ9.' + 'a'.repeat(40) + '.sig', 3600);
        const m2 = mockRes();
        auth.clearSession(m2.res);
        const cleared = [].concat(m2.headers['Set-Cookie'] || []).join('\n');
        ok('clears sliops_session Max-Age=0', /sliops_session=.*Max-Age=0/i.test(cleared));
        ok('clears sliops_remember', /sliops_remember=.*Max-Age=0/i.test(cleared));
        ok('clears sliops_oidc_id', /sliops_oidc_id=.*Max-Age=0/i.test(cleared));
        ok('clears Path=/ops-hub-staging', /Path=\/ops-hub-staging/.test(cleared));
        ok('clears Path=/', /Path=\//.test(cleared));
      }
    )
  );

  console.log('\n=== Entra logout URL includes id_token_hint ===');
  await run(() =>
    withEnv(
      {
        SESSION_SECRET: 'x'.repeat(48),
        ENTRA_TENANT_ID: 'tenant-abc',
        APP_BASE_PATH: '/ops-hub-staging',
        PORTAL_BASE_URL: 'https://automation.streamlinescada.com/ops-hub-staging/',
        STAGING_TEST_LOGIN_ENABLED: '0',
      },
      () => {
        const auth = loadFresh('api/lib/auth.js');
        const entra = loadFresh('api/lib/entra.js');
        const logout = loadFresh('api/lib/logout.js');
        const idToken = 'eyJhbGciOiJSUzI1NiJ9.payload.signature';
        const landing = logout.resolvePostLogoutUrl(process.env.PORTAL_BASE_URL);
        const req = {
          headers: {
            cookie: `${auth.OIDC_ID_TOKEN_COOKIE_NAME}=${encodeURIComponent(idToken)}`,
          },
        };
        const url = entra.buildEntraLogoutUrl(req, landing);
        ok('logout URL targets tenant', /login\.microsoftonline\.com\/tenant-abc\//.test(url));
        ok('logout URL has post_logout_redirect_uri', /post_logout_redirect_uri=/.test(url));
        ok('logout URL has id_token_hint', /id_token_hint=/.test(url));
        ok(
          'post_logout_redirect_uri encodes signed_out',
          decodeURIComponent(url).includes('signed_out=1')
        );
      }
    )
  );

  console.log('\n=== performLogout with Entra does not skip cookie clear ===');
  await run(async () =>
    withEnv(
      {
        SESSION_SECRET: 'x'.repeat(48),
        APP_BASE_PATH: '/ops-hub-staging',
        PORTAL_BASE_URL: 'https://automation.streamlinescada.com/ops-hub-staging/',
        STAGING_TEST_LOGIN_ENABLED: '0',
      },
      async () => {
        const logout = loadFresh('api/lib/logout.js');
        const m = mockRes();
        // emulate status chaining used by performLogout callers
        m.res.status = function status(code) {
          m.status = code;
          return {
            end() {
              return m.res;
            },
          };
        };
        await logout.performLogout({}, m.res, {
          portalBase: process.env.PORTAL_BASE_URL,
          useEntra: true,
          entraLogoutUrl: 'https://login.microsoftonline.com/t/oauth2/v2.0/logout?x=1',
        });
        const cleared = [].concat(m.headers['Set-Cookie'] || []).join(';');
        ok('Entra handoff still clears session cookie', /sliops_session=.*Max-Age=0/i.test(cleared));
        ok('Entra handoff Location is IdP', /login\.microsoftonline\.com/.test(String(m.headers.Location || '')));
        ok('status 302', m.status === 302);
      }
    )
  );

  console.log('\n=== sliops_oidc_id cookie attributes ===');
  await run(() =>
    withEnv(
      {
        SESSION_SECRET: 'x'.repeat(48),
        APP_BASE_PATH: '/ops-hub-staging',
      },
      () => {
        const auth = loadFresh('api/lib/auth.js');
        const m = mockRes();
        const sample = 'eyJhbGciOiJSUzI1NiJ9.' + 'b'.repeat(40) + '.sig';
        ok(
          'issueOidcIdTokenCookie succeeds',
          auth.issueOidcIdTokenCookie(m.res, sample, auth.SESSION_TTL_SECONDS) === true
        );
        const issued = [].concat(m.headers['Set-Cookie'] || []).join('\n');
        ok('HttpOnly', /HttpOnly/i.test(issued));
        ok('Secure', /Secure/i.test(issued));
        ok('SameSite=Lax', /SameSite=Lax/i.test(issued));
        ok('Path scoped to mount', /Path=\/ops-hub-staging/.test(issued));
        ok(
          'Max-Age matches session TTL',
          new RegExp(`Max-Age=${auth.SESSION_TTL_SECONDS}`).test(issued)
        );
        ok('cookie name is sliops_oidc_id', /sliops_oidc_id=/.test(issued));
      }
    )
  );

  console.log('\n=== index.html signed-out gate (no forced prompt=login) ===');
  await run(() => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    ok('auth gate detects signed_out=1', /signed_out=1/.test(html) && /isSignedOutLanding/.test(html));
    ok('signed-out interstitial exists', /showSignedOutInterstitial/.test(html));
    ok(
      'Sign in uses /api/auth/resume',
      /wos-signed-out-signin[\s\S]{0,120}appPath\('\/api\/auth\/resume'\)/.test(html)
    );
    ok('Sign in does not use /api/auth/login', !/wos-signed-out-signin[\s\S]{0,120}appPath\('\/api\/auth\/login'\)/.test(html));
    ok('Sign in does not force prompt=login', !/\/api\/auth\/login\?prompt=login/.test(html));
    ok('proxyFetch respects _portalSignedOut', /_portalSignedOut/.test(html));
    ok('frontend never references sliops_oidc_id', !/sliops_oidc_id/.test(html));
  });

  console.log('\n=== authLog redacts id_token fields ===');
  await run(() => {
    const entraSrc = fs.readFileSync(path.join(ROOT, 'api/lib/entra.js'), 'utf8');
    ok('authLog deletes id_token', /delete safe\.id_token/.test(entraSrc));
    ok('authLog deletes access_token', /delete safe\.access_token/.test(entraSrc));
  });

  if (failed) {
    console.error(`\n${failed} failure(s)`);
    process.exit(1);
  }
  console.log('\nAll logout session-clear checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
