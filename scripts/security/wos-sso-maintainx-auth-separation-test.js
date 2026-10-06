/**
 * WOS SSO vs MaintainX integration error classification tests.
 * Usage: npm run security:wos-sso-maintainx-auth-separation-test
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');

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

function makeRes() {
  const headers = {};
  let statusCode = 200;
  let body = null;
  return {
    statusCode,
    headers,
    status(c) {
      statusCode = c;
      this.statusCode = c;
      return this;
    },
    setHeader(k, v) {
      headers[k] = v;
    },
    getHeader(k) {
      return headers[k];
    },
    json(obj) {
      body = obj;
      headers['Content-Type'] = 'application/json';
      return this;
    },
    send(text) {
      body = text;
      return this;
    },
    end() {
      return this;
    },
    get body() {
      return body;
    },
  };
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

  section('A — classify MaintainX Invalid token (never HTTP 401)');
  run(() => {
    const ae = loadFresh('api/lib/auth-errors.js');
    const c = ae.classifyMaintainxUpstream(401, JSON.stringify({ error: 'Invalid token' }));
    eq('status is 502 not 401', c.httpStatus, 502);
    eq('code MAINTAINX_AUTH_FAILED', c.body.code, 'MAINTAINX_AUTH_FAILED');
    ok('error message names MaintainX', /MaintainX authentication failed/i.test(c.body.error));
    ok('not WOS_AUTH_REQUIRED', c.body.code !== 'WOS_AUTH_REQUIRED');
  });

  section('B — WOS session missing uses WOS_AUTH_REQUIRED');
  run(() => {
    const ae = loadFresh('api/lib/auth-errors.js');
    const body = ae.wosAuthRequiredBody();
    eq('code', body.code, 'WOS_AUTH_REQUIRED');
    eq('error text', body.error, 'Authentication required');
  });

  section('C — RBAC forbidden is 403 WOS_FORBIDDEN');
  run(() => {
    const ae = loadFresh('api/lib/auth-errors.js');
    const body = ae.wosForbiddenBody();
    eq('code', body.code, 'WOS_FORBIDDEN');
  });

  section('D — MaintainX 500/429/network classification');
  run(() => {
    const ae = loadFresh('api/lib/auth-errors.js');
    eq('500 → UNAVAILABLE', ae.classifyMaintainxUpstream(500, '{}').body.code, 'MAINTAINX_UNAVAILABLE');
    eq('429 → RATE_LIMITED', ae.classifyMaintainxUpstream(429, '{}').body.code, 'MAINTAINX_RATE_LIMITED');
    eq('500 http 502', ae.classifyMaintainxUpstream(500, '{}').httpStatus, 502);
  });

  section('proxyFetch only redirects on WOS_AUTH_REQUIRED');
  run(() => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    ok('checks WOS_AUTH_REQUIRED', /code === 'WOS_AUTH_REQUIRED'/.test(html));
    ok('warns when not redirecting', /HTTP 401 without WOS_AUTH_REQUIRED/.test(html));
    // Ensure we no longer redirect on bare status===401 alone without code check
    const proxyBlock = html.slice(html.indexOf('async function proxyFetch'), html.indexOf('window.proxyFetch'));
    ok('proxyFetch still has 401 branch', /res\.status === 401/.test(proxyBlock));
    ok('proxyFetch requires wosAuthRequired flag', /if \(!wosAuthRequired\)/.test(proxyBlock));
  });

  section('MaintainX proxy remaps upstream auth (static)');
  run(() => {
    const mx = fs.readFileSync(path.join(ROOT, 'api/maintainx.js'), 'utf8');
    ok('uses classifyMaintainxUpstream', /classifyMaintainxUpstream/.test(mx));
    ok('logs credential diagnostics without token', /logMaintainxCredentialDiagnostics/.test(mx));
    ok('SSO gate returns WOS_AUTH_REQUIRED', /wosAuthRequiredBody\(\)/.test(mx));
    ok('does not blindly res.status(upstream.status) without classify', /if \(!upstream\.ok\)/.test(mx));
  });

  section('HTTP simulation: WOS session vs MaintainX auth');
  await (async () => {
    const ae = loadFresh('api/lib/auth-errors.js');
    const prevFetch = global.fetch;

    // Simulated handler mirroring the MaintainX proxy remapping + SSO gate.
    async function simulatedHandler(req, res) {
      const u = new URL(req.url, 'http://127.0.0.1');
      const apiPath = u.searchParams.get('path') || '';
      const cookie = req.headers.cookie || '';
      const hasSession = /sliops_session=valid/.test(cookie);

      if (apiPath === '/me') {
        if (!hasSession) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(ae.wosAuthRequiredBody()));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ authenticated: true, email: 'michael.cano@streamlineinnovations.com', role: 'hub_admin' }));
        return;
      }

      if (!hasSession) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(ae.wosAuthRequiredBody()));
        return;
      }

      // Authenticated WOS user — MaintainX upstream returns Invalid token
      if (/^\/(locations|assets|categories)/.test(apiPath.split('?')[0])) {
        const classified = ae.classifyMaintainxUpstream(401, JSON.stringify({ error: 'Invalid token' }));
        res.writeHead(classified.httpStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(classified.body));
        return;
      }

      if (apiPath === '/hub/forbidden-demo') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(ae.wosForbiddenBody()));
        return;
      }

      res.writeHead(404);
      res.end('not found');
    }

    await new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        simulatedHandler(req, res).catch((e) => {
          res.writeHead(500);
          res.end(String(e));
        });
      });
      server.listen(0, '127.0.0.1', async () => {
        try {
          const { port } = server.address();
          const base = `http://127.0.0.1:${port}/api/maintainx?path=`;

          // A: valid session + MaintainX invalid token
          const me = await fetch(`${base}${encodeURIComponent('/me')}`, {
            headers: { cookie: 'sliops_session=valid' },
          });
          const meBody = await me.json();
          eq('A /me authenticated', meBody.authenticated, true);
          const loc = await fetch(`${base}${encodeURIComponent('/locations?limit=200')}`, {
            headers: { cookie: 'sliops_session=valid' },
          });
          const locBody = await loc.json();
          eq('A MaintainX remapped status', loc.status, 502);
          eq('A MaintainX code', locBody.code, 'MAINTAINX_AUTH_FAILED');
          ok('A not 401', loc.status !== 401);

          // B: missing session on protected path
          const unauth = await fetch(`${base}${encodeURIComponent('/locations?limit=200')}`);
          const unauthBody = await unauth.json();
          eq('B status 401', unauth.status, 401);
          eq('B WOS_AUTH_REQUIRED', unauthBody.code, 'WOS_AUTH_REQUIRED');

          // C: RBAC 403
          const forbid = await fetch(`${base}${encodeURIComponent('/hub/forbidden-demo')}`, {
            headers: { cookie: 'sliops_session=valid' },
          });
          const forbidBody = await forbid.json();
          eq('C status 403', forbid.status, 403);
          eq('C WOS_FORBIDDEN', forbidBody.code, 'WOS_FORBIDDEN');

          // D already covered by classifier unit tests

          // Frontend decision helper simulation
          function shouldRedirectToLogin(status, body) {
            return status === 401 && body && body.code === 'WOS_AUTH_REQUIRED';
          }
          ok('A no Entra redirect', !shouldRedirectToLogin(loc.status, locBody));
          ok('B Entra redirect', shouldRedirectToLogin(unauth.status, unauthBody));
          ok('C no Entra redirect', !shouldRedirectToLogin(forbid.status, forbidBody));

          server.close();
          resolve();
        } catch (e) {
          server.close();
          reject(e);
        }
      });
    }).catch((err) => {
      failed += 1;
      console.error(`  FAIL  ${err.message}`);
    });

    global.fetch = prevFetch;
  })();

  console.log(`\n${failed ? 'FAILED' : 'OK'} — ${failed} failure(s)`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
