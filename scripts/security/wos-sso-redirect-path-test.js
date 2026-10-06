/**
 * WOS SSO redirect / base-path normalization tests.
 * Usage: npm run security:wos-sso-redirect-path-test
 */
'use strict';

const assert = require('assert');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..', '..');

function loadFresh(rel) {
  const abs = path.join(ROOT, rel);
  delete require.cache[require.resolve(abs)];
  return require(abs);
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

function ok(name, cond) {
  assert.ok(cond, name);
  console.log(`  PASS  ${name}`);
}

function eq(name, actual, expected) {
  assert.strictEqual(actual, expected, `${name}: got ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`);
  console.log(`  PASS  ${name}`);
}

async function main() {
  let failed = 0;
  const run = (fn) => {
    try {
      fn();
    } catch (err) {
      failed += 1;
      console.error(`  FAIL  ${err.message}`);
    }
  };

  section('app-paths normalization');
  run(() => {
    const prev = { ...process.env };
    process.env.APP_BASE_PATH = '/ops-hub-staging';
    process.env.PORTAL_BASE_URL = 'https://automation.streamlinescada.com/ops-hub-staging/';
    const p = loadFresh('api/lib/app-paths.js');

    eq('base=/ + path=/', p.publicPath('/', '/ops-hub-staging'), '/ops-hub-staging/');
    eq('base=/ + path=/request-queue', p.publicPath('/request-queue', '/ops-hub-staging'), '/ops-hub-staging/request-queue');
    eq(
      'already-mounted path deduped',
      p.publicPath('/ops-hub-staging/request-queue', '/ops-hub-staging'),
      '/ops-hub-staging/request-queue'
    );
    eq(
      'toAppRelative strips mount',
      p.toAppRelativePath('/ops-hub-staging/request-queue', '/ops-hub-staging'),
      '/request-queue'
    );
    eq('toAppRelative home', p.toAppRelativePath('/ops-hub-staging/', '/ops-hub-staging'), '/');
    eq(
      'double mount collapsed',
      p.toAppRelativePath('/ops-hub-staging/ops-hub-staging/', '/ops-hub-staging'),
      '/'
    );

    const portal = 'https://automation.streamlinescada.com/ops-hub-staging/';
    eq(
      'post-auth empty next → portal home',
      p.resolvePostAuthRedirect(portal, ''),
      'https://automation.streamlinescada.com/ops-hub-staging/'
    );
    eq(
      'post-auth / → portal home',
      p.resolvePostAuthRedirect(portal, '/'),
      'https://automation.streamlinescada.com/ops-hub-staging/'
    );
    eq(
      'post-auth app-relative',
      p.resolvePostAuthRedirect(portal, '/request-queue'),
      'https://automation.streamlinescada.com/ops-hub-staging/request-queue'
    );
    eq(
      'post-auth already-mounted next (the production bug)',
      p.resolvePostAuthRedirect(portal, '/ops-hub-staging/'),
      'https://automation.streamlinescada.com/ops-hub-staging/'
    );
    eq(
      'post-auth already-mounted deep link',
      p.resolvePostAuthRedirect(portal, '/ops-hub-staging/request-queue'),
      'https://automation.streamlinescada.com/ops-hub-staging/request-queue'
    );
    ok(
      'never doubles mount',
      !p.hasDuplicatedMount(
        p.resolvePostAuthRedirect(portal, '/ops-hub-staging/request-queue'),
        '/ops-hub-staging'
      )
    );
    eq(
      'rejects protocol-relative next',
      p.toAppRelativePath('//evil.example/', '/ops-hub-staging'),
      null
    );
    eq(
      'cookie path scoped to mount',
      p.getCookiePath(),
      '/ops-hub-staging'
    );

    process.env = prev;
  });

  section('PORTAL_BASE_URL + APP_BASE_PATH must not double');
  run(() => {
    const prev = { ...process.env };
    process.env.APP_BASE_PATH = '/ops-hub-staging';
    process.env.PORTAL_BASE_URL = 'https://automation.streamlinescada.com/ops-hub-staging/';
    const p = loadFresh('api/lib/app-paths.js');
    const targets = [
      p.resolvePostAuthRedirect(process.env.PORTAL_BASE_URL, '/'),
      p.resolvePostAuthRedirect(process.env.PORTAL_BASE_URL, '/ops-hub-staging/'),
      p.resolvePostAuthRedirect(process.env.PORTAL_BASE_URL, process.env.APP_BASE_PATH + '/'),
      p.resolvePostAuthRedirect(process.env.PORTAL_BASE_URL, '/ops-hub-staging/ops-hub-staging/'),
    ];
    for (const t of targets) {
      ok(`no double path in ${t}`, !/\/ops-hub-staging\/ops-hub-staging/.test(t));
      ok(`not bare root ${t}`, t !== 'https://automation.streamlinescada.com/');
      ok(`under mount ${t}`, /\/ops-hub-staging\/?$/.test(new URL(t).pathname) || new URL(t).pathname.startsWith('/ops-hub-staging/'));
    }
    process.env = prev;
  });

  section('Entra buildRedirectTarget uses shared helper');
  run(() => {
    const prev = { ...process.env };
    process.env.APP_BASE_PATH = '/ops-hub-staging';
    process.env.PORTAL_BASE_URL = 'https://automation.streamlinescada.com/ops-hub-staging/';
    process.env.SESSION_SECRET = 'x'.repeat(32);
    const entra = loadFresh('api/lib/entra.js');
    eq(
      'entra callback target dedupes',
      entra.buildRedirectTarget(process.env.PORTAL_BASE_URL, '/ops-hub-staging/'),
      'https://automation.streamlinescada.com/ops-hub-staging/'
    );
    eq(
      'entra normalizeNext strips mount',
      entra.normalizeNextForState('/ops-hub-staging/request-queue', process.env.PORTAL_BASE_URL),
      '/request-queue'
    );
    process.env = prev;
  });

  section('session cookie Path uses APP_BASE_PATH');
  run(() => {
    const prev = { ...process.env };
    process.env.APP_BASE_PATH = '/ops-hub-staging';
    process.env.SESSION_SECRET = 'y'.repeat(32);
    const auth = loadFresh('api/lib/auth.js');
    const cookie = auth.buildSetCookie('sliops_session', 'tok', 60);
    ok('Path=/ops-hub-staging', /Path=\/ops-hub-staging/.test(cookie));
    ok('HttpOnly', /HttpOnly/.test(cookie));
    ok('Secure', /Secure/.test(cookie));
    ok('SameSite=Lax', /SameSite=Lax/.test(cookie));
    process.env = prev;
  });

  section('HTTP login stores normalized next; callback redirects once under mount');
  await (async () => {
    const prev = { ...process.env };
    process.env.APP_BASE_PATH = '/ops-hub-staging';
    process.env.PORTAL_BASE_URL = 'https://automation.streamlinescada.com/ops-hub-staging/';
    process.env.SESSION_SECRET = 'z'.repeat(40);
    process.env.NODE_ENV = 'test';

    const auth = loadFresh('api/lib/auth.js');
    const { resolvePostAuthRedirect } = loadFresh('api/lib/app-paths.js');

    // Stub session cookie issuance path without real Entra: simulate what
    // handleCallback does after a valid token exchange.
    const headers = {};
    const res = {
      statusCode: 0,
      headersSent: false,
      setHeader(k, v) { headers[k] = v; },
      getHeader(k) { return headers[k]; },
      status(c) { this.statusCode = c; return this; },
      end() { this.headersSent = true; return this; },
    };
    auth.issueSession(res, 'ops.user@streamlinecorp.com', { remember: false });
    const setCookie = headers['Set-Cookie'];
    ok('session cookie issued', Array.isArray(setCookie) && setCookie.some((c) => /sliops_session=/.test(c)));
    ok(
      'session cookie path scoped',
      setCookie.some((c) => /sliops_session=/.test(c) && /Path=\/ops-hub-staging/.test(c))
    );

    const final = resolvePostAuthRedirect(
      process.env.PORTAL_BASE_URL,
      '/ops-hub-staging/'
    );
    eq('stub post-login Location', final, 'https://automation.streamlinescada.com/ops-hub-staging/');

    // Tiny HTTP smoke: ensure a server can emit the Location without doubling.
    await new Promise((resolve, reject) => {
      const server = http.createServer((req, nodeRes) => {
        if (req.url.startsWith('/ops-hub-staging/api/auth/callback')) {
          const target = resolvePostAuthRedirect(
            process.env.PORTAL_BASE_URL,
            '/ops-hub-staging/request-queue'
          );
          nodeRes.writeHead(302, { Location: target });
          nodeRes.end();
          return;
        }
        nodeRes.writeHead(404);
        nodeRes.end('not found');
      });
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        http
          .get(`http://127.0.0.1:${port}/ops-hub-staging/api/auth/callback?code=x&state=y`, (r) => {
            try {
              eq(
                'http Location under mount once',
                r.headers.location,
                'https://automation.streamlinescada.com/ops-hub-staging/request-queue'
              );
              ok('single redirect status', r.statusCode === 302);
              server.close();
              resolve();
            } catch (e) {
              server.close();
              reject(e);
            }
          })
          .on('error', (e) => {
            server.close();
            reject(e);
          });
      });
    }).catch((err) => {
      failed += 1;
      console.error(`  FAIL  ${err.message}`);
    });

    process.env = prev;
  })();

  section('index.html auth gate uses app-relative next');
  run(() => {
    const fs = require('fs');
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    ok('defines appRelativePath', /function appRelativePath\(/.test(html));
    ok('gate uses loginNextValue / appRelativePath', /loginNextValue\(/.test(html) && /appRelativePath\(window\.location\.pathname\)/.test(html));
    ok('login URL still via appPath', /appPath\('\/api\/auth\/login\?next='/.test(html));
  });

  console.log(`\n${failed ? 'FAILED' : 'OK'} — ${failed} failure(s)`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
