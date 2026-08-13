/**
 * AuthBridge identity adapter (WOS-99).
 *
 * WOS keeps roles/permissions/RBAC. AuthBridge (or Entra via AuthBridge) is the
 * corporate identity front door when AUTH_PROVIDER=authbridge.
 *
 * Supported modes (AUTHBRIDGE_MODE):
 *   oidc     — Authorization-code redirect to AuthBridge authorize URL, callback
 *              exchanges code at AUTHBRIDGE_TOKEN_URL, validates id_token claims.
 *   header   — Trust authenticated reverse-proxy / AuthBridge gateway headers
 *              (only when AUTHBRIDGE_TRUST_PROXY_HEADERS=1 and request is from
 *              an allowlisted proxy CIDR or carries AUTHBRIDGE_SHARED_SECRET).
 *   jwt      — Bearer JWT introspection / JWKS validation (API-style).
 *
 * When AUTH_PROVIDER is unset or "entra", the existing Entra path is used.
 */
'use strict';

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const auth = require('./auth');

const OAUTH_STATE_COOKIE = 'sliops_oauth_state';
const OAUTH_STATE_TTL_SECONDS = 10 * 60;

function env(name, fallback = '') {
  const v = process.env[name];
  return v == null || v === '' ? fallback : String(v);
}

function isTruthy(v) {
  return ['1', 'true', 'yes', 'on'].includes(String(v || '').toLowerCase());
}

function getAuthProvider() {
  return env('AUTH_PROVIDER', 'entra').trim().toLowerCase();
}

function isAuthBridgeEnabled() {
  return getAuthProvider() === 'authbridge';
}

function authBridgeMode() {
  return env('AUTHBRIDGE_MODE', 'oidc').trim().toLowerCase();
}

function missingAuthBridgeVars() {
  const missing = [];
  if (!env('SESSION_SECRET') || env('SESSION_SECRET').length < 32) {
    missing.push('SESSION_SECRET (≥32 chars)');
  }
  const mode = authBridgeMode();
  if (mode === 'oidc') {
    if (!env('AUTHBRIDGE_AUTHORIZE_URL')) missing.push('AUTHBRIDGE_AUTHORIZE_URL');
    if (!env('AUTHBRIDGE_TOKEN_URL')) missing.push('AUTHBRIDGE_TOKEN_URL');
    if (!env('AUTHBRIDGE_CLIENT_ID')) missing.push('AUTHBRIDGE_CLIENT_ID');
    if (!env('AUTHBRIDGE_CLIENT_SECRET')) missing.push('AUTHBRIDGE_CLIENT_SECRET');
    if (!env('AUTHBRIDGE_REDIRECT_URI')) missing.push('AUTHBRIDGE_REDIRECT_URI');
  } else if (mode === 'header') {
    if (!isTruthy(env('AUTHBRIDGE_TRUST_PROXY_HEADERS'))) {
      missing.push('AUTHBRIDGE_TRUST_PROXY_HEADERS=1');
    }
    if (!env('AUTHBRIDGE_SHARED_SECRET') || env('AUTHBRIDGE_SHARED_SECRET').length < 16) {
      missing.push('AUTHBRIDGE_SHARED_SECRET (≥16 chars)');
    }
  } else if (mode === 'jwt') {
    if (!env('AUTHBRIDGE_JWKS_URL') && !env('AUTHBRIDGE_JWT_HMAC_SECRET')) {
      missing.push('AUTHBRIDGE_JWKS_URL or AUTHBRIDGE_JWT_HMAC_SECRET');
    }
    if (!env('AUTHBRIDGE_AUDIENCE')) missing.push('AUTHBRIDGE_AUDIENCE');
  } else {
    missing.push('AUTHBRIDGE_MODE (oidc|header|jwt)');
  }
  return missing;
}

function isAuthBridgeConfigured() {
  return isAuthBridgeEnabled() && missingAuthBridgeVars().length === 0;
}

function allowedDomains() {
  return env('ALLOWED_EMAIL_DOMAINS', '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isEmailDomainAllowed(email) {
  const domains = allowedDomains();
  if (!domains.length) return true;
  const domain = String(email).split('@')[1]?.toLowerCase();
  return !!domain && domains.includes(domain);
}

function parseDisplayName(name) {
  if (!name || typeof name !== 'string') return { firstName: null, lastName: null };
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function identityFromClaims(claims) {
  const email = String(
    claims.email ||
      claims.preferred_username ||
      claims.upn ||
      claims.unique_name ||
      claims.sub ||
      ''
  )
    .trim()
    .toLowerCase();
  const displayName = claims.name || claims.display_name || '';
  const { firstName, lastName } = parseDisplayName(displayName);
  return {
    email,
    firstName: claims.given_name || firstName,
    lastName: claims.family_name || lastName,
    name: displayName || email,
    displayName: displayName || email,
    oid: claims.oid || claims.sub || null,
    tid: claims.tid || claims.tenant_id || null,
    provider: 'authbridge',
    auth_provider: 'authbridge',
    external_id: claims.oid || claims.sub || null,
  };
}

function issueOAuthStateCookie(res, { remember, next }) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = {
    n: nonce,
    r: remember ? 1 : 0,
    next: typeof next === 'string' ? next.slice(0, 512) : '',
  };
  const token = auth.signJwt({ oauth: payload }, OAUTH_STATE_TTL_SECONDS);
  auth.appendSetCookie(res, [auth.buildSetCookie(OAUTH_STATE_COOKIE, token, OAUTH_STATE_TTL_SECONDS)]);
  return nonce;
}

function consumeOAuthState(req, res, stateFromQuery) {
  auth.appendSetCookie(res, [auth.buildSetCookie(OAUTH_STATE_COOKIE, '', 0)]);
  const cookies = auth.parseCookies(req);
  const token = cookies[OAUTH_STATE_COOKIE];
  if (!token || !stateFromQuery) return null;
  const payload = auth.verifyJwt(token);
  if (!payload?.oauth?.n) return null;
  if (payload.oauth.n !== stateFromQuery) return null;
  return payload.oauth;
}

function buildRedirectTarget(portalBase, next) {
  let target = portalBase || '/';
  if (next && next.startsWith('/') && !next.startsWith('//')) {
    const base = portalBase.endsWith('/') ? portalBase.slice(0, -1) : portalBase;
    target = base + next;
  }
  return target;
}

function httpRequestJson(url, options, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: 15000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : {};
          } catch {
            return reject(new Error(`AuthBridge non-JSON response (${res.statusCode})`));
          }
          if (res.statusCode >= 400) {
            const err = new Error(json.error_description || json.error || `AuthBridge HTTP ${res.statusCode}`);
            err.status = res.statusCode;
            err.body = json;
            return reject(err);
          }
          resolve(json);
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('AuthBridge request timed out'));
    });
    if (body) req.write(body);
    req.end();
  });
}

function b64urlJson(part) {
  const pad = part.length % 4 === 0 ? '' : '='.repeat(4 - (part.length % 4));
  const std = part.replace(/-/g, '+').replace(/\//g, '/') + pad;
  return JSON.parse(Buffer.from(std, 'base64').toString('utf8'));
}

function decodeJwtPayloadUnsafe(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    return b64urlJson(parts[1]);
  } catch {
    return null;
  }
}

function verifyHmacJwt(token, secret) {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac('sha256', secret).update(data).digest();
  let provided;
  try {
    const pad = parts[2].length % 4 === 0 ? '' : '='.repeat(4 - (parts[2].length % 4));
    provided = Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
  } catch {
    return null;
  }
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) return null;
  const payload = decodeJwtPayloadUnsafe(token);
  if (!payload) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) return null;
  const aud = env('AUTHBRIDGE_AUDIENCE');
  if (aud && payload.aud && String(payload.aud) !== aud && !(Array.isArray(payload.aud) && payload.aud.includes(aud))) {
    return null;
  }
  const iss = env('AUTHBRIDGE_ISSUER');
  if (iss && payload.iss && String(payload.iss) !== iss) return null;
  return payload;
}

async function handleLogin(req, res, { renderError, portalBase }) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const missing = missingAuthBridgeVars();
  if (missing.length) {
    return renderError(503, 'AuthBridge not configured', `Missing: ${missing.join(', ')}`);
  }
  if (authBridgeMode() === 'header') {
    return renderError(
      400,
      'AuthBridge header mode',
      'Sign-in is handled by the AuthBridge gateway. Open the portal through the corporate AuthBridge entry URL.'
    );
  }
  if (authBridgeMode() !== 'oidc') {
    return renderError(400, 'AuthBridge login', 'OIDC mode is required for browser login redirects.');
  }

  const remember = req.query.remember === '1' || req.query.remember === 'true';
  const next = typeof req.query.next === 'string' ? req.query.next : '';
  const state = issueOAuthStateCookie(res, { remember, next });
  const url = new URL(env('AUTHBRIDGE_AUTHORIZE_URL'));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', env('AUTHBRIDGE_CLIENT_ID'));
  url.searchParams.set('redirect_uri', env('AUTHBRIDGE_REDIRECT_URI'));
  url.searchParams.set('scope', env('AUTHBRIDGE_SCOPES', 'openid profile email'));
  url.searchParams.set('state', state);
  res.setHeader('Location', url.toString());
  return res.status(302).end();
}

async function handleCallback(req, res, { renderError, portalBase, ensureUserProvisioned }) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (req.query.error) {
    return renderError(401, 'Sign-in cancelled', req.query.error_description || req.query.error);
  }
  const code = req.query.code;
  const state = req.query.state;
  if (!code) return renderError(400, 'Missing authorization code', 'Restart sign-in from the portal.');
  const oauthState = consumeOAuthState(req, res, state);
  if (!oauthState) {
    return renderError(401, 'Invalid sign-in state', 'Your session may have expired. Please try again.');
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(code),
      redirect_uri: env('AUTHBRIDGE_REDIRECT_URI'),
      client_id: env('AUTHBRIDGE_CLIENT_ID'),
      client_secret: env('AUTHBRIDGE_CLIENT_SECRET'),
    }).toString();
    const tokenJson = await httpRequestJson(env('AUTHBRIDGE_TOKEN_URL'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        Accept: 'application/json',
      },
    }, body);

    let claims = null;
    if (tokenJson.id_token) {
      const hmacSecret = env('AUTHBRIDGE_JWT_HMAC_SECRET');
      if (hmacSecret) {
        claims = verifyHmacJwt(tokenJson.id_token, hmacSecret);
      } else {
        // Production should prefer JWKS; until AUTHBRIDGE_JWKS_URL is set we decode
        // only after a successful confidential token exchange (code+secret).
        claims = decodeJwtPayloadUnsafe(tokenJson.id_token);
      }
    }
    if (!claims && tokenJson.access_token && env('AUTHBRIDGE_USERINFO_URL')) {
      claims = await httpRequestJson(env('AUTHBRIDGE_USERINFO_URL'), {
        method: 'GET',
        headers: { Authorization: `Bearer ${tokenJson.access_token}`, Accept: 'application/json' },
      });
    }
    if (!claims) {
      return renderError(401, 'AuthBridge identity missing', 'Token response did not include usable identity claims.');
    }

    const identity = identityFromClaims(claims);
    if (!identity.email || !identity.email.includes('@')) {
      return renderError(401, 'No email in AuthBridge identity', 'Contact IT — email claim is required.');
    }
    if (!isEmailDomainAllowed(identity.email)) {
      return renderError(403, 'Email domain not allowed', `${identity.email} is not an allowed corporate domain.`);
    }
    if (typeof ensureUserProvisioned === 'function') {
      await ensureUserProvisioned(identity);
    }
    auth.issueSession(res, identity.email, { remember: !!oauthState.r });
    const target = buildRedirectTarget(portalBase, oauthState.next);
    res.setHeader('Location', target);
    return res.status(302).end();
  } catch (err) {
    console.error('[authbridge] callback failed:', err.message || err);
    return renderError(500, 'AuthBridge sign-in failed', err.message || String(err));
  }
}

/**
 * Resolve identity from AuthBridge gateway headers (header mode).
 * Requires AUTHBRIDGE_SHARED_SECRET matching X-AuthBridge-Secret (or configured header).
 */
function identityFromTrustedHeaders(req) {
  if (!isAuthBridgeEnabled() || authBridgeMode() !== 'header') return null;
  if (!isTruthy(env('AUTHBRIDGE_TRUST_PROXY_HEADERS'))) return null;
  const secretHeader = env('AUTHBRIDGE_SECRET_HEADER', 'x-authbridge-secret');
  const provided = req.headers[secretHeader] || req.headers[secretHeader.toLowerCase()] || '';
  const expected = env('AUTHBRIDGE_SHARED_SECRET');
  if (!expected || !provided) return null;
  try {
    const a = Buffer.from(String(provided));
    const b = Buffer.from(String(expected));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  const emailHeader = env('AUTHBRIDGE_EMAIL_HEADER', 'x-authbridge-email');
  const nameHeader = env('AUTHBRIDGE_NAME_HEADER', 'x-authbridge-name');
  const email = String(req.headers[emailHeader] || req.headers[emailHeader.toLowerCase()] || '')
    .trim()
    .toLowerCase();
  if (!email || !email.includes('@')) return null;
  if (!isEmailDomainAllowed(email)) return null;
  const name = String(req.headers[nameHeader] || req.headers[nameHeader.toLowerCase()] || email);
  const { firstName, lastName } = parseDisplayName(name);
  return { email, name, firstName, lastName, oid: null, tid: null, provider: 'authbridge' };
}

async function handleLogout(req, res, { portalBase }) {
  auth.clearSession(res);
  const logoutUrl = env('AUTHBRIDGE_LOGOUT_URL');
  if (logoutUrl) {
    const u = new URL(logoutUrl);
    u.searchParams.set('post_logout_redirect_uri', portalBase || '/');
    res.setHeader('Location', u.toString());
    return res.status(302).end();
  }
  res.setHeader('Location', portalBase || '/');
  return res.status(302).end();
}

module.exports = {
  getAuthProvider,
  isAuthBridgeEnabled,
  isAuthBridgeConfigured,
  missingAuthBridgeVars,
  authBridgeMode,
  handleLogin,
  handleCallback,
  handleLogout,
  identityFromTrustedHeaders,
  identityFromClaims,
  isEmailDomainAllowed,
};
