#!/usr/bin/env node
/**
 * Gate 2 — AuthBridge claim validation + application entitlement.
 * Usage: npm run security:gate2-authbridge-entitlement-test
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

function loadFresh() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes('authbridge')) delete require.cache[key];
  }
  return require(path.join(ROOT, 'api', 'lib', 'authbridge.js'));
}

async function withEnv(env, fn) {
  const saved = { ...process.env };
  // clear relevant keys first
  for (const k of Object.keys(env)) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return await fn(loadFresh());
  } finally {
    process.env = { ...saved };
  }
}

async function main() {
  console.log('=== Gate 2 AuthBridge entitlement / claims ===\n');

  await withEnv(
    {
      AUTH_PROVIDER: 'authbridge',
      AUTHBRIDGE_MODE: 'oidc',
      AUTHBRIDGE_APP_ID: 'sliops',
      AUTHBRIDGE_AUDIENCE: 'sliops-aud',
      AUTHBRIDGE_ISSUER: 'https://authbridge.example',
      AUTHBRIDGE_APP_ENABLED: '1',
    },
    async (ab) => {
      const now = Math.floor(Date.now() / 1000);
      const base = {
        email: 'user@streamlinecorp.com',
        exp: now + 600,
        nbf: now - 10,
        iss: 'https://authbridge.example',
        aud: 'sliops-aud',
        apps: ['sliops'],
      };
      assert('entitled user claims ok', ab.validateAuthBridgeClaims(base).ok === true);
      assert(
        'non-entitled apps denied',
        ab.validateAuthBridgeClaims({ ...base, apps: ['other-app'] }).ok === false
      );
      assert(
        'unknown/missing apps denied',
        ab.validateAuthBridgeClaims({ ...base, apps: undefined, aud: 'sliops-aud' }).reason ===
          'application_not_entitled' ||
          ab.isApplicationEntitled({ ...base, apps: undefined, aud: 'wrong' }) === false
      );
      // aud alone can satisfy extractAppIds when APP_ID matches aud — use distinct aud
      assert(
        'wrong audience denied',
        ab.validateAuthBridgeClaims({ ...base, aud: 'other-aud', apps: ['sliops'] }).ok === false
      );
      assert(
        'expired denied',
        ab.validateAuthBridgeClaims({ ...base, exp: now - 10 }).ok === false
      );
      assert(
        'issuer mismatch denied',
        ab.validateAuthBridgeClaims({ ...base, iss: 'https://evil.example' }).ok === false
      );
    }
  );

  await withEnv(
    {
      AUTH_PROVIDER: 'authbridge',
      AUTHBRIDGE_APP_ENABLED: '0',
      AUTHBRIDGE_APP_ID: 'sliops',
    },
    async (ab) => {
      assert('disabled application denied', ab.isApplicationEnabled() === false);
      assert(
        'disabled application validate fails',
        ab.validateAuthBridgeClaims({
          email: 'a@b.com',
          exp: Math.floor(Date.now() / 1000) + 100,
          apps: ['sliops'],
        }).reason === 'application_disabled'
      );
    }
  );

  await withEnv(
    {
      AUTH_PROVIDER: 'authbridge',
      AUTHBRIDGE_REQUIRE_APP_ENTITLEMENT: '1',
      // no APP_ID
    },
    async (ab) => {
      assert(
        'require entitlement without APP_ID fails closed',
        ab.isApplicationEntitled({ apps: ['anything'] }) === false
      );
    }
  );

  await withEnv(
    {
      AUTH_PROVIDER: 'authbridge',
      AUTHBRIDGE_MODE: 'jwt',
      AUTHBRIDGE_JWT_HMAC_SECRET: 'hmac-secret-for-tests-32chars!!',
      AUTHBRIDGE_AUDIENCE: 'sliops',
      AUTHBRIDGE_APP_ID: 'sliops',
      ALLOWED_EMAIL_DOMAINS: 'streamlinecorp.com',
    },
    async (ab) => {
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      function mint(claims) {
        const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
        const data = `${header}.${payload}`;
        const sig = crypto
          .createHmac('sha256', process.env.AUTHBRIDGE_JWT_HMAC_SECRET)
          .update(data)
          .digest('base64url');
        return `${data}.${sig}`;
      }
      const good = mint({
        email: 'ok@streamlinecorp.com',
        exp: now + 600,
        aud: 'sliops',
        apps: ['sliops'],
      });
      const otherDomain = mint({
        email: 'ok@evil.example',
        exp: now + 600,
        aud: 'sliops',
        apps: ['sliops'],
      });
      assert(
        'entitled domain allowed',
        !!ab.identityFromBearerToken({ headers: { authorization: `Bearer ${good}` } })
      );
      assert(
        'disallowed domain denied',
        ab.identityFromBearerToken({ headers: { authorization: `Bearer ${otherDomain}` } }) === null
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
