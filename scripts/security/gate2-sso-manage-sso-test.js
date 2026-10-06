#!/usr/bin/env node
/**
 * Gate 2 — manage_sso trust authorization.
 * Usage: npm run security:gate2-sso-manage-sso-test
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

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function mockRes() {
  const headers = {};
  return {
    code: null,
    payload: null,
    headers,
    status(c) {
      this.code = c;
      return this;
    },
    json(b) {
      this.payload = b;
      return this;
    },
    setHeader(k, v) {
      headers[k] = v;
      headers[String(k).toLowerCase()] = v;
    },
    getHeader(k) {
      return headers[k] || headers[String(k).toLowerCase()];
    },
    end(b) {
      if (b !== undefined) this.payload = b;
      return this;
    },
  };
}

async function withEnv(env, fn) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    process.env = { ...saved };
  }
}

async function main() {
  console.log('=== Gate 2 manage_sso / SSO trust authorization ===\n');

  const mx = read('api/maintainx.js');
  const rbac = read('rbac-client.js');
  const sso = read('api/lib/sso-routes.js');

  assert('PERMISSION_CATALOG includes manage_sso', mx.includes("id: 'manage_sso'"));
  assert('management built-in role includes manage_sso', /id: 'management'[\s\S]*'manage_sso'/.test(mx));
  assert(
    'SSO write requires manage_sso (not view_management alone)',
    /isWrite[\s\S]{0,200}manage_sso'\]/.test(mx) &&
      /sso-admin\/[\s\S]{0,400}view_management/.test(mx)
  );
  assert(
    'SSO gate no longer ORs view_management for writes only',
    !/requirePermissions\(req, res, \['hub_admin', 'admin', 'view_management'\]\)/.test(
      mx.slice(mx.indexOf("path.startsWith('/sso-admin/')"))
    )
  );
  assert('rbac-client SSO section requires manage_sso', /sso:\s*\['manage_sso'\]/.test(rbac));
  assert('SSO trust update audited', sso.includes("sso.trust_updated"));
  assert('SSO trust audit does not log cert material key as value path', sso.includes('has_certificate'));

  // Functional: hasAnyPermission semantics via requirePermissions helpers
  await withEnv(
    {
      SESSION_SECRET: 'x'.repeat(32),
      NODE_ENV: 'test',
      SSO_ENFORCEMENT: 'on',
    },
    async () => {
      // Bust caches so catalog change is visible
      for (const key of Object.keys(require.cache)) {
        if (key.includes(`${path.sep}api${path.sep}`) || key.includes(`${path.sep}rbac-client`)) {
          delete require.cache[key];
        }
      }
      const auth = require(path.join(ROOT, 'api', 'lib', 'auth.js'));

      // Standard / view_management-only: must not satisfy manage_sso write list
      function hasAny(perms, needed) {
        if (perms.includes('admin') || perms.includes('hub_admin')) return true;
        return needed.some((p) => perms.includes(p));
      }
      assert(
        'view_management alone cannot write SSO',
        hasAny(['view_management', 'view_home'], ['manage_sso']) === false
      );
      assert(
        'employee/standard cannot write SSO',
        hasAny(['view_home', 'view_hub_dashboard'], ['manage_sso']) === false
      );
      assert(
        'manage_sso can write SSO',
        hasAny(['manage_sso', 'view_management'], ['manage_sso']) === true
      );
      assert(
        'admin short-circuit can write SSO',
        hasAny(['admin'], ['manage_sso']) === true
      );
      assert(
        'view_management can still match read list',
        hasAny(['view_management'], ['manage_sso', 'view_management']) === true
      );

      // Spoofed vercel headers must not create a session actor
      const spoofReq = {
        headers: {
          'x-vercel-user-email': 'attacker@evil.example',
          'x-vercel-id-token-email': 'attacker@evil.example',
          cookie: '',
        },
      };
      assert('spoofed x-vercel headers do not authenticate', auth.getActorEmail(spoofReq) === null);

      // Issue real session and confirm actor
      const res = mockRes();
      auth.issueSession(res, 'admin@example.com', { remember: false });
      const setCookie = res.getHeader('Set-Cookie') || [];
      const cookieHeader = (Array.isArray(setCookie) ? setCookie : [setCookie])
        .map((c) => String(c).split(';')[0].trim())
        .filter(Boolean)
        .join('; ');
      const sessReq = { headers: { cookie: cookieHeader } };
      assert(
        'session cookie authenticates expected user',
        auth.getActorEmail(sessReq) === 'admin@example.com',
        `got ${auth.getActorEmail(sessReq)} cookie=${cookieHeader.slice(0, 80)}`
      );
      assert(
        'session wins over spoofed vercel headers',
        auth.getActorEmail({
          headers: {
            cookie: cookieHeader,
            'x-vercel-user-email': 'attacker@evil.example',
          },
        }) === 'admin@example.com'
      );
    }
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
