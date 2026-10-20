/**
 * In-memory rate limit for vendor magic-link consume.
 * Does not trust X-Forwarded-For unless TRUST_FORWARDED_CLIENT_IP is set.
 * Not a new auth method — failed consume attempts only.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 20;

/** @type {Map<string, { failures: number, windowStart: number, lockedUntil: number }>} */
const byIp = new Map();

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

function stateFor(ip) {
  const now = Date.now();
  let state = byIp.get(ip);
  if (!state || now - state.windowStart > WINDOW_MS) {
    state = { failures: 0, windowStart: now, lockedUntil: 0 };
    byIp.set(ip, state);
  }
  return state;
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

function resetForTests() {
  byIp.clear();
}

module.exports = {
  WINDOW_MS,
  MAX_FAILURES,
  clientIp,
  isLimited,
  recordFailure,
  resetForTests,
};
