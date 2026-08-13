// lib/auth.js — session JWT + cookie helpers
//
// We use signed JWTs stored in HTTP-only cookies for the user's session.
// The JWT carries the user's email (the only identity we need); everything
// else (name, role, permissions) is looked up from the user store on each
// request. That keeps the cookie small and means revoking access is a
// matter of removing the user from KV — no need to track issued tokens.
//
// Two cookie types:
//   - "sliops_session"  → sliding 8-hour session, default
//   - "sliops_remember" → 30-day persistent session, set when user picks
//                         "remember me on this device"
//
// Both are signed with HMAC-SHA256 using SESSION_SECRET. Tokens use a
// minimal JWT-like structure (header.payload.signature, base64url-encoded)
// without external libs — keeps deps low.

const crypto = require('crypto');

const SESSION_COOKIE_NAME  = 'sliops_session';
const REMEMBER_COOKIE_NAME = 'sliops_remember';
// 8 hours and 30 days, in seconds. Sliding session means each authenticated
// request issues a fresh cookie with a new 8-hour expiry, so an active
// user never gets logged out mid-day; an idle user logs out after 8 hours.
const SESSION_TTL_SECONDS  = 8 * 60 * 60;
const REMEMBER_TTL_SECONDS = 30 * 24 * 60 * 60;

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET env var is required and must be ≥32 characters');
  }
  return secret;
}

// ---------- base64url helpers (no padding) ----------
function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}
function b64urlDecode(str) {
  // Add padding back, swap chars
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const std = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(std, 'base64');
}

// ---------- JWT-like encode/decode ----------
// Returns: header.payload.signature (all base64url)
function signJwt(payload, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { ...payload, iat: now, exp: now + ttlSeconds };
  const header = { alg: 'HS256', typ: 'JWT' };
  const encHeader  = b64urlEncode(JSON.stringify(header));
  const encPayload = b64urlEncode(JSON.stringify(claims));
  const data = `${encHeader}.${encPayload}`;
  const sig = crypto.createHmac('sha256', getSecret()).update(data).digest();
  return `${data}.${b64urlEncode(sig)}`;
}

// Returns the payload object if signature is valid AND exp is in the future.
// Returns null otherwise — never throws on invalid input (so callers can
// treat any failure as "no session"). Uses constant-time comparison for
// the signature to avoid timing-attack leaks.
function verifyJwt(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [encHeader, encPayload, encSig] = parts;
  const data = `${encHeader}.${encPayload}`;
  let expectedSig;
  try {
    expectedSig = crypto.createHmac('sha256', getSecret()).update(data).digest();
  } catch {
    return null;
  }
  let providedSig;
  try {
    providedSig = b64urlDecode(encSig);
  } catch {
    return null;
  }
  if (expectedSig.length !== providedSig.length) return null;
  if (!crypto.timingSafeEqual(expectedSig, providedSig)) return null;

  let payload;
  try {
    payload = JSON.parse(b64urlDecode(encPayload).toString('utf8'));
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) return null;
  return payload;
}

// ---------- Cookie helpers ----------
// Parses the Cookie header into a plain object. Values are URI-decoded.
function parseCookies(req) {
  const header = req.headers?.cookie || '';
  const out = {};
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

// Build a Set-Cookie header value with secure defaults. We always set
// HttpOnly + Secure + SameSite=Lax — Lax (not Strict) so SAML POST-back
// redirects from Microsoft still carry the cookie. Path=/ so the cookie
// is available across the whole portal + proxy.
function buildSetCookie(name, value, ttlSeconds) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ];
  if (ttlSeconds > 0) {
    parts.push(`Max-Age=${ttlSeconds}`);
  } else {
    // ttl=0 means "delete the cookie" — set Max-Age=0 + Expires in the past
    parts.push('Max-Age=0');
    parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  }
  return parts.join('; ');
}

// ---------- Session lifecycle ----------
// Issue a fresh session cookie on the response. Called after successful
// SAML auth, and on every authenticated request to slide the expiry
// forward (so an active user never gets logged out mid-session).
function issueSession(res, email, opts = {}) {
  const remember = !!opts.remember;
  const ttl = remember ? REMEMBER_TTL_SECONDS : SESSION_TTL_SECONDS;
  const cookieName = remember ? REMEMBER_COOKIE_NAME : SESSION_COOKIE_NAME;
  const token = signJwt({ email, remember }, ttl);
  const cookie = buildSetCookie(cookieName, token, ttl);

  // If we're issuing a "remember me" cookie, also clear the short-session
  // cookie so the user has exactly one active session token. Vice versa.
  const otherName = remember ? SESSION_COOKIE_NAME : REMEMBER_COOKIE_NAME;
  const clearOther = buildSetCookie(otherName, '', 0);

  appendSetCookie(res, [cookie, clearOther]);
}

// Clear both cookies — logout.
function clearSession(res) {
  appendSetCookie(res, [
    buildSetCookie(SESSION_COOKIE_NAME, '', 0),
    buildSetCookie(REMEMBER_COOKIE_NAME, '', 0),
  ]);
}

// Vercel's serverless res object collects multiple Set-Cookie values via
// res.setHeader('Set-Cookie', [array]). Need to merge with anything already
// set (e.g., by another middleware) instead of overwriting.
function appendSetCookie(res, cookies) {
  const existing = res.getHeader && res.getHeader('Set-Cookie');
  let merged = [];
  if (Array.isArray(existing)) merged = existing.slice();
  else if (existing) merged = [existing];
  merged.push(...cookies);
  if (typeof res.setHeader === 'function') {
    res.setHeader('Set-Cookie', merged);
  }
}

// Read the current session from the request, or null if no valid session.
// Tries the persistent cookie first (longer TTL = preferred), falls back
// to the short session cookie. Returns { email, remember, exp } on success.
function getSession(req) {
  const cookies = parseCookies(req);
  // Prefer remember-me if both are somehow set
  const rememberToken = cookies[REMEMBER_COOKIE_NAME];
  const sessionToken  = cookies[SESSION_COOKIE_NAME];
  for (const t of [rememberToken, sessionToken]) {
    if (!t) continue;
    const payload = verifyJwt(t);
    if (payload && payload.email) return payload;
  }
  return null;
}

// Get the actor email for THIS request. Order of precedence:
//   1. Valid session cookie (the new SAML flow)
//   2. x-vercel-user-email header (Vercel Authentication, if ever enabled)
//   3. null (anonymous / no auth)
//
// Wrapped in a try/catch as a defense-in-depth measure: this helper is
// called on every request, so any unexpected error here would 500 the
// whole proxy. Better to silently fall back to anonymous than to crash.
function getActorEmail(req) {
  try {
    const sess = getSession(req);
    if (sess?.email) return String(sess.email).toLowerCase();
  } catch {
    // fall through
  }
  try {
    const authbridge = require('./authbridge');
    if (authbridge.isAuthBridgeEnabled && authbridge.isAuthBridgeEnabled()) {
      const identity = authbridge.identityFromTrustedHeaders(req);
      if (identity && identity.email) return String(identity.email).toLowerCase();
    }
  } catch {
    // authbridge optional
  }
  const headerEmail = req.headers?.['x-vercel-user-email']
                   || req.headers?.['x-vercel-id-token-email']
                   || null;
  return headerEmail ? String(headerEmail).toLowerCase() : null;
}

module.exports = {
  SESSION_COOKIE_NAME,
  REMEMBER_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  REMEMBER_TTL_SECONDS,
  signJwt,
  verifyJwt,
  parseCookies,
  buildSetCookie,
  appendSetCookie,
  issueSession,
  clearSession,
  getSession,
  getActorEmail,
};
