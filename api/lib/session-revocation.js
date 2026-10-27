/**
 * Employee-session revocation.
 *
 * Logout records the issued-at time of the presented session. Any token for
 * that email with iat <= cutoff is denied. A later login is stamped past the
 * cutoff so a fresh session still works in the same second.
 *
 * The in-process map is authoritative for this process. Set
 * SLIOPS_SESSION_REVOCATION_STORE=redis or =postgres to share the cutoff.
 * Postgres requires migrations/019_session_revocation.sql. This module does
 * not create that table at runtime.
 */

const cutoffs = new Map();
let postgresDisabled = false;

function cutoffFor(email) {
  if (!email) return null;
  const value = cutoffs.get(String(email).toLowerCase());
  return value == null ? null : value;
}

function isRevokedSync(payload) {
  if (!payload || typeof payload.email !== 'string') return false;
  const cutoff = cutoffFor(payload.email);
  if (cutoff == null || typeof payload.iat !== 'number') return false;
  return payload.iat <= cutoff;
}

function remember(email, iat) {
  const key = String(email || '').toLowerCase();
  if (!key || typeof iat !== 'number') return null;
  const next = Math.max(cutoffFor(key) || 0, iat);
  cutoffs.set(key, next);
  return next;
}

function freshIssuedAt(email, nowSeconds) {
  const now = typeof nowSeconds === 'number' ? nowSeconds : Math.floor(Date.now() / 1000);
  const cutoff = cutoffFor(email);
  if (cutoff != null && now <= cutoff) return cutoff + 1;
  return now;
}

async function persist(email, cutoff) {
  const mode = String(process.env.SLIOPS_SESSION_REVOCATION_STORE || '').toLowerCase();
  if (mode === 'redis') {
    try {
      const { createRedisClient } = require('../../for-dev/redis-client');
      const redis = createRedisClient();
      const key = `sliops:session-revoked-before:${String(email).toLowerCase()}`;
      const current = Number((await redis.get(key)) || 0);
      if (cutoff > current) await redis.set(key, String(cutoff));
    } catch (err) {
      console.warn('[auth] session revocation redis persist failed', err.message);
    }
    return;
  }
  if (mode === 'postgres' && process.env.DATABASE_URL && !postgresDisabled) {
    try {
      const { Pool } = require('pg');
      if (!global.__sliopsRevocationPool) {
        global.__sliopsRevocationPool = new Pool({ connectionString: process.env.DATABASE_URL });
      }
      await global.__sliopsRevocationPool.query(
        `INSERT INTO sliops_session_revocation (email, revoked_through_iat, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (email) DO UPDATE
           SET revoked_through_iat = GREATEST(sliops_session_revocation.revoked_through_iat, EXCLUDED.revoked_through_iat),
               updated_at = now()`,
        [String(email).toLowerCase(), cutoff]
      );
    } catch (err) {
      if (err && err.code === '42P01') postgresDisabled = true;
      console.warn('[auth] session revocation postgres persist failed', err.message);
    }
  }
}

async function load(email) {
  const mode = String(process.env.SLIOPS_SESSION_REVOCATION_STORE || '').toLowerCase();
  if (mode === 'redis') {
    try {
      const { createRedisClient } = require('../../for-dev/redis-client');
      const redis = createRedisClient();
      const raw = await redis.get(`sliops:session-revoked-before:${String(email).toLowerCase()}`);
      const value = Number(raw || 0);
      return value > 0 ? value : null;
    } catch {
      return null;
    }
  }
  if (mode === 'postgres' && process.env.DATABASE_URL && !postgresDisabled) {
    try {
      const { Pool } = require('pg');
      if (!global.__sliopsRevocationPool) {
        global.__sliopsRevocationPool = new Pool({ connectionString: process.env.DATABASE_URL });
      }
      const result = await global.__sliopsRevocationPool.query(
        'SELECT revoked_through_iat FROM sliops_session_revocation WHERE email=$1',
        [String(email).toLowerCase()]
      );
      const value = Number(result.rows[0]?.revoked_through_iat || 0);
      return value > 0 ? value : null;
    } catch (err) {
      if (err && err.code === '42P01') postgresDisabled = true;
      return null;
    }
  }
  return null;
}

async function primeIssuer(email) {
  const stored = await load(email);
  if (stored) remember(email, stored);
  return cutoffFor(email);
}

async function revokeClaims(payload) {
  if (!payload?.email || typeof payload.iat !== 'number') return null;
  const cutoff = remember(payload.email, payload.iat);
  await persist(payload.email, cutoff);
  return cutoff;
}

async function hydrate(req, readClaims) {
  if (typeof readClaims !== 'function') return;
  const claims = readClaims(req);
  if (!claims?.email) return;
  const stored = await load(claims.email);
  if (stored) remember(claims.email, stored);
}

function resetSessionRevocationForTests() {
  cutoffs.clear();
  postgresDisabled = false;
}

module.exports = {
  cutoffFor,
  isRevokedSync,
  freshIssuedAt,
  revokeClaims,
  primeIssuer,
  hydrate,
  resetSessionRevocationForTests,
};
