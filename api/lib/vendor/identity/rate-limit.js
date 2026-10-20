/**
 * Vendor auth rate limits.
 * Does not trust X-Forwarded-For unless TRUST_FORWARDED_CLIENT_IP is set.
 * IP failure lock is shared by magic-link consume and verification-code checks.
 * Code requests have separate per-IP and per-account counters.
 */
const crypto = require('crypto');

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 20;
const MAX_CODE_REQUESTS_PER_IP = 8;
const MAX_CODE_REQUESTS_PER_ACCOUNT = 5;
const MAX_VERIFY_FAILURES_PER_ACCOUNT = 5;

/** @type {Map<string, { failures: number, requests: number, windowStart: number, lockedUntil: number }>} */
const byIp = new Map();
/** @type {Map<string, { failures: number, requests: number, windowStart: number, lockedUntil: number }>} */
const byAccount = new Map();

function clientIp(req) {
  const trustFwd = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.TRUST_FORWARDED_CLIENT_IP || '').toLowerCase()
  );
  if (trustFwd) {
    const xf = req && req.headers && req.headers['x-forwarded-for'];
    if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0].trim();
    const xr = req && req.headers && req.headers['x-real-ip'];
    if (typeof xr === 'string' && xr.trim()) return xr.trim();
  }
  return (req && req.socket && req.socket.remoteAddress) || 'unknown';
}

function accountKey(email) {
  const normalized = String(email || '').trim().toLowerCase();
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function touch(map, key) {
  const now = Date.now();
  let state = map.get(key);
  if (!state || now - state.windowStart > WINDOW_MS) {
    state = { failures: 0, requests: 0, windowStart: now, lockedUntil: 0 };
    map.set(key, state);
  }
  return state;
}

function stateFor(ip) {
  return touch(byIp, ip);
}

function isLimited(req) {
  const state = stateFor(clientIp(req));
  return Date.now() < state.lockedUntil;
}

function recordFailure(req) {
  const state = stateFor(clientIp(req));
  state.failures += 1;
  if (state.failures >= MAX_FAILURES) {
    state.lockedUntil = Date.now() + WINDOW_MS;
  }
  return state.failures;
}

function isCodeRequestLimited(req, email) {
  if (isLimited(req)) return true;
  const ipState = stateFor(clientIp(req));
  if (ipState.requests >= MAX_CODE_REQUESTS_PER_IP) return true;
  const account = touch(byAccount, accountKey(email));
  if (Date.now() < account.lockedUntil) return true;
  if (account.requests >= MAX_CODE_REQUESTS_PER_ACCOUNT) return true;
  return false;
}

function recordCodeRequest(req, email) {
  const ipState = stateFor(clientIp(req));
  ipState.requests += 1;
  if (ipState.requests >= MAX_CODE_REQUESTS_PER_IP) {
    ipState.lockedUntil = Date.now() + WINDOW_MS;
  }
  const account = touch(byAccount, accountKey(email));
  account.requests += 1;
  if (account.requests >= MAX_CODE_REQUESTS_PER_ACCOUNT) {
    account.lockedUntil = Date.now() + WINDOW_MS;
  }
  return { ipRequests: ipState.requests, accountRequests: account.requests };
}

function isVerifyLimited(req, email) {
  if (isLimited(req)) return true;
  const account = touch(byAccount, accountKey(email));
  return Date.now() < account.lockedUntil && account.failures >= MAX_VERIFY_FAILURES_PER_ACCOUNT;
}

function recordVerifyFailure(req, email) {
  recordFailure(req);
  const account = touch(byAccount, accountKey(email));
  account.failures += 1;
  if (account.failures >= MAX_VERIFY_FAILURES_PER_ACCOUNT) {
    account.lockedUntil = Date.now() + WINDOW_MS;
  }
  return account.failures;
}

function resetForTests() {
  byIp.clear();
  byAccount.clear();
}

module.exports = {
  WINDOW_MS,
  MAX_FAILURES,
  MAX_CODE_REQUESTS_PER_IP,
  MAX_CODE_REQUESTS_PER_ACCOUNT,
  MAX_VERIFY_FAILURES_PER_ACCOUNT,
  clientIp,
  accountKey,
  isLimited,
  recordFailure,
  isCodeRequestLimited,
  recordCodeRequest,
  isVerifyLimited,
  recordVerifyFailure,
  resetForTests,
};
