/**
 * AuthBridge + /api/me logout persistence tests.
 * Usage: npm run security:wos-logout-authbridge-me-test
 *
 * Reproduces the live failure mode: after local session clear, AuthBridge
 * header-mode identity must not keep /me authenticated.
 */
'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function loadFresh(rel) {
  const abs = path.join(ROOT, rel);
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}api${path.sep}lib${path.sep}auth.js`) ||
      key.includes(`${path.sep}api${path.sep}lib${path.sep}authbridge.js`) ||
      key.includes(`${path.sep}api${path.sep}lib${path.sep}logout.js`)
    ) {
      delete require.cache[key];
    }
  }
  delete require.cache[require.resolve(abs)];
  return require(abs);
}

function mockRes() {
  const headers = {};
  let statusCode = 200;
  const res = {
    status(code) {
      statusCode = code;
      return {
        end() {
          return res;
        },
        json() {
          return res;
        },
      };
    },
    setHeader(k, v) {
      headers[k] = v;
    },
    getHeader(k) {
      return headers[k];
    },
    end() {
      return res;
    },
    json() {
      return res;
    },
  };
  return {
    res,
    headers,
    get status() {
      return statusCode;
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

  console.log('\n=== /me actor path: AuthBridge headers after logout ===');
  await run(() =>
    withEnv(
      {
        SESSION_SECRET: 'x'.repeat(48),
        AUTH_PROVIDER: 'authbridge',
        AUTHBRIDGE_MODE: 'header',
        AUTHBRIDGE_TRUST_PROXY_HEADERS: '1',
        AUTHBRIDGE_SHARED_SECRET: 'y'.repeat(32),
        ALLOWED_EMAIL_DOMAINS: 'streamlinecorp.com',
        APP_BASE_PATH: '',
        PORTAL_BASE_URL: 'https://operations.streamlinescada.com/',
        AUTHBRIDGE_COOKIE_DOMAIN: '.streamlinescada.com',
        AUTHBRIDGE_SESSION_COOKIE_PREFIX: 'sli_authbri',
        STAGING_TEST_LOGIN_ENABLED: '0',
      },
      async () => {
        const auth = loadFresh('api/lib/auth.js');
        const logout = loadFresh('api/lib/logout.js');
        const authbridge = loadFresh('api/lib/authbridge.js');

        const abHeaders = {
          'x-authbridge-secret': process.env.AUTHBRIDGE_SHARED_SECRET,
          'x-authbridge-email': 'michael.cano@streamlinecorp.com',
          'x-authbridge-name': 'Michael Cano',
          cookie: 'sli_authbri_session=alive-token',
        };

        // Before logout: AuthBridge headers authenticate /me actor
        const beforeEmail = auth.getActorEmail({ headers: abHeaders });
        ok('before logout AuthBridge headers authenticate', beforeEmail === 'michael.cano@streamlinecorp.com');

        const m = mockRes();
        m.res.status = function status(code) {
          m._status = code;
          return { end() { return m.res; } };
        };
        await logout.performLogout({ headers: abHeaders }, m.res, {
          portalBase: process.env.PORTAL_BASE_URL,
          clearAuthBridgeCookies: true,
        });

        const setCookies = [].concat(m.headers['Set-Cookie'] || []).join('\n');
        ok('logout sets sliops_signed_out', /sliops_signed_out=1/.test(setCookies));
        ok('logout clears sliops_session', /sliops_session=.*Max-Age=0/i.test(setCookies));
        ok('logout clears sli_authbri_session', /sli_authbri_session=.*Max-Age=0/i.test(setCookies));
        ok(
          'logout clears AuthBridge cookie with parent Domain',
          /sli_authbri_session=.*Domain=\.streamlinescada\.com/i.test(setCookies)
        );
        ok('logout Location includes signed_out', /signed_out=1/.test(String(m.headers.Location || '')));

        // Simulate browser after logout: AuthBridge headers may still arrive
        // until gateway cookie is gone, but signed_out marker must win.
        const afterHeaders = {
          ...abHeaders,
          cookie: `${auth.SIGNED_OUT_COOKIE_NAME}=1; sli_authbri_session=alive-token`,
        };
        const afterEmail = auth.getActorEmail({ headers: afterHeaders });
        ok('after logout marker blocks AuthBridge header auth', afterEmail === null);

        // Explicit login clears marker
        const m2 = mockRes();
        auth.issueSession(m2.res, 'michael.cano@streamlinecorp.com', { remember: false });
        const issued = [].concat(m2.headers['Set-Cookie'] || []).join('\n');
        ok('login clears signed_out marker', /sliops_signed_out=.*Max-Age=0/i.test(issued));

        ok(
          'buildAuthBridgeLogoutUrl includes post_logout',
          (() => {
            process.env.AUTHBRIDGE_LOGOUT_URL = 'https://auth.example/logout';
            const url = authbridge.buildAuthBridgeLogoutUrl(
              logout.resolvePostLogoutUrl(process.env.PORTAL_BASE_URL)
            );
            return /post_logout_redirect_uri=/.test(url) && /signed_out=1/.test(decodeURIComponent(url));
          })()
        );
      }
    )
  );

  console.log('\n=== Cookie name discovery from logout request ===');
  await run(() =>
    withEnv(
      {
        SESSION_SECRET: 'x'.repeat(48),
        AUTH_PROVIDER: 'authbridge',
        AUTHBRIDGE_MODE: 'header',
        AUTHBRIDGE_TRUST_PROXY_HEADERS: '1',
        AUTHBRIDGE_SHARED_SECRET: 'y'.repeat(32),
        AUTHBRIDGE_SESSION_COOKIE_PREFIX: 'sli_authbri',
        PORTAL_BASE_URL: 'https://operations.streamlinescada.com/',
      },
      () => {
        const authbridge = loadFresh('api/lib/authbridge.js');
        const names = authbridge.resolveAuthBridgeCookiesToClear({
          headers: {
            cookie: 'sli_authbri_abc123=tok; other=1; sliops_session=x',
          },
        });
        ok('discovers sli_authbri_abc123 from request', names.includes('sli_authbri_abc123'));
        ok('does not clear unrelated cookies', !names.includes('other') && !names.includes('sliops_session'));
      }
    )
  );

  if (failed) {
    console.error(`\n${failed} failure(s)`);
    process.exit(1);
  }
  console.log('\nAll AuthBridge /me logout checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
