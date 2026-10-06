#!/usr/bin/env node
/**
 * Gate 2 — unsafe identity header fallback removed.
 * Usage: npm run security:gate2-identity-fallback-test
 */
const fs = require('fs');
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

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function loadFresh(rel) {
  const abs = path.join(ROOT, rel);
  delete require.cache[abs];
  return require(abs);
}

function mockRes() {
  const cookies = [];
  return {
    code: null,
    payload: null,
    cookies,
    status(c) {
      this.code = c;
      return this;
    },
    json(b) {
      this.payload = b;
      return this;
    },
    setHeader(k, v) {
      if (String(k).toLowerCase() === 'set-cookie') {
        if (Array.isArray(v)) cookies.push(...v);
        else cookies.push(v);
      }
    },
    getHeader(k) {
      if (String(k).toLowerCase() === 'set-cookie') return cookies;
      return undefined;
    },
    end() {
      return this;
    },
  };
}

function cookieHeaderFromRes(res) {
  return res.cookies.map((c) => String(c).split(';')[0].trim()).join('; ');
}

async function main() {
  console.log('=== Gate 2 identity fallback removal ===\n');

  const authSrc = read('api/lib/auth.js');
  const mx = read('api/maintainx.js');
  assert('getActorEmail source does not read x-vercel-user-email', !/getActorEmail[\s\S]{0,800}x-vercel-user-email/.test(authSrc));
  assert('maintainx archive create does not use x-vercel-id-token-email', !/Actor identity from verified[\s\S]{0,200}x-vercel/.test(mx));
  assert('no x-vercel-user-email left in maintainx.js', !mx.includes('x-vercel-user-email'));
  assert('no x-vercel-id-token-email left in maintainx.js', !mx.includes('x-vercel-id-token-email'));
  assert('no x-vercel-user-name left in maintainx.js', !mx.includes('x-vercel-user-name'));

  process.env.SESSION_SECRET = 'gate2-identity-test-secret-32chars!!';
  process.env.NODE_ENV = 'test';
  delete process.env.AUTH_PROVIDER;

  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}api${path.sep}lib${path.sep}auth`)) delete require.cache[key];
  }
  const auth = loadFresh('api/lib/auth.js');

  assert(
    'anonymous + spoofed vercel email → null',
    auth.getActorEmail({
      headers: {
        'x-vercel-user-email': 'admin@streamlinecorp.com',
        'x-vercel-id-token-email': 'admin@streamlinecorp.com',
        'x-actor-email': 'admin@streamlinecorp.com',
      },
    }) === null
  );

  const res = mockRes();
  auth.issueSession(res, 'legit@streamlinecorp.com', { remember: false });
  const cookie = cookieHeaderFromRes(res);
  assert(
    'session actor is legit user',
    auth.getActorEmail({ headers: { cookie } }) === 'legit@streamlinecorp.com'
  );
  assert(
    'spoofed headers cannot change session user',
    auth.getActorEmail({
      headers: {
        cookie,
        'x-vercel-user-email': 'admin@streamlinecorp.com',
        'x-actor-email': 'admin@streamlinecorp.com',
      },
    }) === 'legit@streamlinecorp.com'
  );

  // AuthBridge header mode requires shared secret — wrong secret → null
  process.env.AUTH_PROVIDER = 'authbridge';
  process.env.AUTHBRIDGE_MODE = 'header';
  process.env.AUTHBRIDGE_TRUST_PROXY_HEADERS = '1';
  process.env.AUTHBRIDGE_SHARED_SECRET = 'shared-secret-16+';
  for (const key of Object.keys(require.cache)) {
    if (key.includes('authbridge') || key.includes(`${path.sep}auth.js`)) delete require.cache[key];
  }
  const auth2 = loadFresh('api/lib/auth.js');
  const ab = loadFresh('api/lib/authbridge.js');
  assert(
    'AuthBridge header without secret → null',
    ab.identityFromTrustedHeaders({
      headers: { 'x-authbridge-email': 'gateway@streamlinecorp.com' },
    }) === null
  );
  assert(
    'AuthBridge header with wrong secret → null',
    ab.identityFromTrustedHeaders({
      headers: {
        'x-authbridge-email': 'gateway@streamlinecorp.com',
        'x-authbridge-secret': 'wrong-secret-xxxxx',
      },
    }) === null
  );
  const ok = ab.identityFromTrustedHeaders({
    headers: {
      'x-authbridge-email': 'gateway@streamlinecorp.com',
      'x-authbridge-secret': 'shared-secret-16+',
    },
  });
  assert('AuthBridge header with correct secret → email', ok && ok.email === 'gateway@streamlinecorp.com');
  assert(
    'getActorEmail uses AuthBridge trusted headers when enabled',
    auth2.getActorEmail({
      headers: {
        'x-authbridge-email': 'gateway@streamlinecorp.com',
        'x-authbridge-secret': 'shared-secret-16+',
      },
    }) === 'gateway@streamlinecorp.com'
  );
  assert(
    'vercel spoof still ignored under AuthBridge',
    auth2.getActorEmail({
      headers: { 'x-vercel-user-email': 'attacker@evil.example' },
    }) === null
  );

  // JWT bearer — alg none / wrong sig rejected
  process.env.AUTHBRIDGE_MODE = 'jwt';
  process.env.AUTHBRIDGE_JWT_HMAC_SECRET = 'hmac-secret-for-tests-32chars!!';
  process.env.AUTHBRIDGE_AUDIENCE = 'sliops';
  process.env.AUTHBRIDGE_APP_ID = 'sliops';
  for (const key of Object.keys(require.cache)) {
    if (key.includes('authbridge')) delete require.cache[key];
  }
  const abJwt = loadFresh('api/lib/authbridge.js');
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      email: 'jwtuser@streamlinecorp.com',
      exp: now + 3600,
      aud: 'sliops',
      apps: ['sliops'],
    })
  ).toString('base64url');
  const data = `${header}.${payload}`;
  const sig = crypto
    .createHmac('sha256', process.env.AUTHBRIDGE_JWT_HMAC_SECRET)
    .update(data)
    .digest('base64url');
  const good = `${data}.${sig}`;
  const bad = `${data}.${sig.replace(/./, 'A')}`;
  assert(
    'valid HMAC JWT entitled',
    !!abJwt.identityFromBearerToken({ headers: { authorization: `Bearer ${good}` } })
  );
  assert(
    'tampered JWT rejected',
    abJwt.identityFromBearerToken({ headers: { authorization: `Bearer ${bad}` } }) === null
  );
  const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  assert(
    'alg=none rejected',
    abJwt.identityFromBearerToken({
      headers: { authorization: `Bearer ${noneHeader}.${payload}.` },
    }) === null
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
