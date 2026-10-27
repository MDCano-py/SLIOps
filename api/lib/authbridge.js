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
const sessionRevocation = require('./session-revocation');
const { resolvePostAuthRedirect, getAppBasePath, toAppRelativePath, getPortalMountPath } = require('./app-paths');

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

/**
 * Smallest explicit application entitlement check compatible with AuthBridge claims.
 *
 * When AUTHBRIDGE_APP_ENABLED=0|false|off → all users denied (disabled application).
 * When AUTHBRIDGE_APP_ID is set (or AUTHBRIDGE_REQUIRE_APP_ENTITLEMENT=1):
 *   claims must include that app id in apps / applications / azp / appid / client_id.
 * When neither is configured → entitlement reduces to email domain allowlist only
 *   (existing behavior); callers still must pass isEmailDomainAllowed.
 */
function isApplicationEnabled() {
  const flag = env('AUTHBRIDGE_APP_ENABLED', '1');
  return !['0', 'false', 'no', 'off'].includes(String(flag).toLowerCase());
}

function extractAppIdsFromClaims(claims) {
  if (!claims || typeof claims !== 'object') return [];
  const ids = new Set();
  const push = (v) => {
    if (v == null) return;
    if (Array.isArray(v)) {
      v.forEach(push);
      return;
    }
    if (typeof v === 'object' && v.id) {
      ids.add(String(v.id).toLowerCase());
      return;
    }
    const s = String(v).trim().toLowerCase();
    if (s) ids.add(s);
  };
  push(claims.apps);
  push(claims.applications);
  push(claims.app_ids);
  push(claims.azp);
  push(claims.appid);
  push(claims.app_id);
  push(claims.client_id);
  push(claims.aud);
  return [...ids];
}

function isApplicationEntitled(claims) {
  if (!isApplicationEnabled()) return false;
  const requiredApp = env('AUTHBRIDGE_APP_ID').trim().toLowerCase();
  const requireEntitlement = isTruthy(env('AUTHBRIDGE_REQUIRE_APP_ENTITLEMENT'));
  if (!requiredApp && !requireEntitlement) return true;
  if (!requiredApp && requireEntitlement) return false;
  const present = extractAppIdsFromClaims(claims);
  if (!present.length) return false;
  return present.includes(requiredApp);
}

/**
 * Validate AuthBridge id_token / access-token claims after confidential exchange
 * or HMAC verification. Fail closed on missing/invalid security claims when
 * the corresponding env vars are configured.
 */
function validateAuthBridgeClaims(claims, { requireSignatureVerified = false } = {}) {
  if (!claims || typeof claims !== 'object') {
    return { ok: false, reason: 'missing_claims' };
  }
  if (requireSignatureVerified && claims.__signatureVerified !== true) {
    return { ok: false, reason: 'unverified_signature' };
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === 'number' && claims.exp < now) {
    return { ok: false, reason: 'expired' };
  }
  if (typeof claims.nbf === 'number' && claims.nbf > now + 60) {
    return { ok: false, reason: 'not_before' };
  }
  const iss = env('AUTHBRIDGE_ISSUER');
  if (iss && claims.iss && String(claims.iss) !== iss) {
    return { ok: false, reason: 'issuer_mismatch' };
  }
  if (iss && !claims.iss) {
    return { ok: false, reason: 'issuer_missing' };
  }
  const aud = env('AUTHBRIDGE_AUDIENCE');
  if (aud) {
    const okAud =
      claims.aud != null &&
      (String(claims.aud) === aud || (Array.isArray(claims.aud) && claims.aud.map(String).includes(aud)));
    if (!okAud) return { ok: false, reason: 'audience_mismatch' };
  }
  if (!isApplicationEnabled()) {
    return { ok: false, reason: 'application_disabled' };
  }
  if (!isApplicationEntitled(claims)) {
    return { ok: false, reason: 'application_not_entitled' };
  }
  return { ok: true };
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
  return resolvePostAuthRedirect(portalBase, next);
}

function normalizeNextForState(next, portalBase) {
  if (typeof next !== 'string' || !next) return '';
  const mount = getPortalMountPath(portalBase) || getAppBasePath();
  const rel = toAppRelativePath(next, mount);
  if (rel == null) return '';
  return rel.slice(0, 512);
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
  let header;
  try {
    header = b64urlJson(parts[0]);
  } catch {
    return null;
  }
  // Reject alg=none and unexpected algorithms (HMAC path is HS256 only).
  if (!header || String(header.alg || '').toUpperCase() !== 'HS256') return null;
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
  const validated = validateAuthBridgeClaims(payload);
  if (!validated.ok) return null;
  return { ...payload, __signatureVerified: true };
}

/**
 * JWT mode: resolve identity from Authorization: Bearer when HMAC secret is configured.
 * JWKS verification is async and not used on the sync request identity path.
 */
function identityFromBearerToken(req) {
  if (!isAuthBridgeEnabled() || authBridgeMode() !== 'jwt') return null;
  const hmacSecret = env('AUTHBRIDGE_JWT_HMAC_SECRET');
  if (!hmacSecret) return null;
  const authz = req.headers?.authorization || req.headers?.Authorization || '';
  const m = /^Bearer\s+(\S+)/i.exec(String(authz));
  if (!m) return null;
  const claims = verifyHmacJwt(m[1], hmacSecret);
  if (!claims) return null;
  const identity = identityFromClaims(claims);
  if (!identity.email || !identity.email.includes('@')) return null;
  if (!isEmailDomainAllowed(identity.email)) return null;
  return identity;
}

function stripSignedOutFromUrl(url) {
  if (!url || typeof url !== 'string') return url;
  try {
    const absolute = /^https?:\/\//i.test(url);
    const u = absolute ? new URL(url) : new URL(url, 'https://placeholder.local');
    u.searchParams.delete('signed_out');
    if (absolute) return u.toString();
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return url;
  }
}

/**
 * Explicit Sign In after logout (AuthBridge header mode / gateway).
 * Clears sliops_signed_out then redirects to the portal so Nginx
 * auth_request can challenge AuthBridge. Does not hardcode AuthBridge URLs.
 */
async function handleResume(req, res, { portalBase }) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  auth.clearSignedOutMarker(res);
  const rawNext = typeof req.query?.next === 'string' ? req.query.next : '';
  const next = normalizeNextForState(rawNext, portalBase) || '/';
  let target = buildRedirectTarget(portalBase, next);
  target = stripSignedOutFromUrl(target);
  console.log('[auth]', JSON.stringify({
    event: 'auth_resume_initiated',
    provider: 'authbridge',
    mode: authBridgeMode(),
    final_redirect: target,
  }));
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Location', target);
  return res.status(302).end();
}

async function handleLogin(req, res, { renderError, portalBase }) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const missing = missingAuthBridgeVars();
  if (missing.length) {
    return renderError(503, 'AuthBridge not configured', `Missing: ${missing.join(', ')}`);
  }
  if (authBridgeMode() === 'header') {
    // Automatic auth-gate / 401 bounces must NOT clear sliops_signed_out.
    // Explicit Sign In uses /api/auth/resume. If the marker is present,
    // send the user back to the signed-out landing without clearing it.
    if (auth.hasSignedOutMarker(req)) {
      const { resolvePostLogoutUrl } = require('./logout');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Location', resolvePostLogoutUrl(portalBase));
      return res.status(302).end();
    }
    // No marker: send to portal; Nginx auth_request owns AuthBridge challenge.
    const rawNext = typeof req.query.next === 'string' ? req.query.next : '';
    const next = normalizeNextForState(rawNext, portalBase) || '/';
    const target = stripSignedOutFromUrl(buildRedirectTarget(portalBase, next));
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Location', target);
    return res.status(302).end();
  }
  if (authBridgeMode() !== 'oidc') {
    return renderError(400, 'AuthBridge login', 'OIDC mode is required for browser login redirects.');
  }

  const remember = req.query.remember === '1' || req.query.remember === 'true';
  const rawNext = typeof req.query.next === 'string' ? req.query.next : '';
  const next = normalizeNextForState(rawNext, portalBase);
  console.log('[auth]', JSON.stringify({
    event: 'auth_login_initiated',
    provider: 'authbridge',
    requested_next: rawNext ? rawNext.slice(0, 200) : '',
    normalized_next: next,
  }));
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
    let signatureVerified = false;
    if (tokenJson.id_token) {
      const hmacSecret = env('AUTHBRIDGE_JWT_HMAC_SECRET');
      if (hmacSecret) {
        claims = verifyHmacJwt(tokenJson.id_token, hmacSecret);
        signatureVerified = !!claims;
      } else {
        // After confidential code+secret exchange only — still validate claims.
        // Prefer setting AUTHBRIDGE_JWT_HMAC_SECRET or JWKS for signature verification.
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

    const claimCheck = validateAuthBridgeClaims(claims);
    if (!claimCheck.ok) {
      console.log('[auth]', JSON.stringify({
        event: 'authbridge_claims_rejected',
        reason: claimCheck.reason,
        signature_verified: signatureVerified,
      }));
      if (claimCheck.reason === 'application_disabled' || claimCheck.reason === 'application_not_entitled') {
        return renderError(403, 'Application access denied', 'You are not entitled to this application.');
      }
      return renderError(401, 'Invalid AuthBridge token claims', claimCheck.reason);
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
    await sessionRevocation.primeIssuer(identity.email);
    auth.issueSession(res, identity.email, { remember: !!oauthState.r });
    const target = buildRedirectTarget(portalBase, oauthState.next);
    console.log('[auth]', JSON.stringify({
      event: 'auth_session_established',
      provider: 'authbridge',
      user: identity.email,
      requested_next: oauthState.next || '',
      final_redirect: target,
    }));
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
  if (!isApplicationEnabled()) return null;
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

/**
 * Resolve AuthBridge browser session cookie names to clear on logout.
 * Prefer explicit AUTHBRIDGE_SESSION_COOKIE_NAMES. Also clear any cookies
 * present on the logout request whose names start with
 * AUTHBRIDGE_SESSION_COOKIE_PREFIX (default: sli_authbri).
 */
function resolveAuthBridgeCookiesToClear(req) {
  const names = new Set();
  env('AUTHBRIDGE_SESSION_COOKIE_NAMES')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((n) => names.add(n));

  const prefix = env('AUTHBRIDGE_SESSION_COOKIE_PREFIX', 'sli_authbri').trim();
  if (prefix && req) {
    const cookies = auth.parseCookies(req);
    for (const name of Object.keys(cookies)) {
      if (name.startsWith(prefix)) names.add(name);
    }
  }
  return [...names];
}

function resolveAuthBridgeCookieDomain() {
  const configured = env('AUTHBRIDGE_COOKIE_DOMAIN').trim();
  if (configured) return configured;
  if (!isTruthy(env('AUTHBRIDGE_COOKIE_DOMAIN_AUTO', '1'))) return '';
  try {
    const base = env('PORTAL_BASE_URL') || env('AUTHBRIDGE_REDIRECT_URI');
    if (!base || !/^https?:\/\//i.test(base)) return '';
    const host = new URL(base).hostname;
    const parts = host.split('.').filter(Boolean);
    if (parts.length >= 2) return `.${parts.slice(-2).join('.')}`;
  } catch {
    /* ignore */
  }
  return '';
}

/**
 * Expire AuthBridge browser cookies that are present / configured.
 * Does not invent cookie names — only clears names from env or the
 * sli_authbri* cookies actually sent on the logout request.
 */
function clearAuthBridgeBrowserCookies(req, res) {
  const names = resolveAuthBridgeCookiesToClear(req);
  if (!names.length) return [];
  const domain = resolveAuthBridgeCookieDomain();
  const paths = new Set([
    auth.getCookiePath(),
    '/',
    env('AUTHBRIDGE_COOKIE_PATH', '/').trim() || '/',
  ]);
  const cleared = [];
  for (const name of names) {
    for (const path of paths) {
      // Host-only clear
      auth.appendSetCookie(res, [auth.buildSetCookie(name, '', 0, { path })]);
      cleared.push({ name, path, domain: null });
      // Parent-domain clear (required when AuthBridge set Domain=.example.com)
      if (domain) {
        auth.appendSetCookie(res, [auth.buildSetCookie(name, '', 0, { path, domain })]);
        cleared.push({ name, path, domain });
      }
    }
  }
  return cleared;
}

function buildAuthBridgeLogoutUrl(landing) {
  const logoutUrl = env('AUTHBRIDGE_LOGOUT_URL');
  if (!logoutUrl) return null;
  try {
    const u = new URL(logoutUrl);
    if (landing) u.searchParams.set('post_logout_redirect_uri', landing);
    return u.toString();
  } catch {
    return logoutUrl;
  }
}

async function handleLogout(req, res, { portalBase }) {
  const { performLogout, resolvePostLogoutUrl } = require('./logout');
  const landing = resolvePostLogoutUrl(portalBase);
  const authBridgeLogoutUrl = buildAuthBridgeLogoutUrl(landing);
  return performLogout(req, res, {
    portalBase,
    useEntra: !!authBridgeLogoutUrl,
    entraLogoutUrl: authBridgeLogoutUrl,
    clearAuthBridgeCookies: true,
  });
}

module.exports = {
  getAuthProvider,
  isAuthBridgeEnabled,
  isAuthBridgeConfigured,
  missingAuthBridgeVars,
  authBridgeMode,
  handleLogin,
  handleResume,
  handleCallback,
  handleLogout,
  identityFromTrustedHeaders,
  identityFromBearerToken,
  identityFromClaims,
  isEmailDomainAllowed,
  isApplicationEnabled,
  isApplicationEntitled,
  validateAuthBridgeClaims,
  verifyHmacJwt,
  resolveAuthBridgeCookiesToClear,
  resolveAuthBridgeCookieDomain,
  clearAuthBridgeBrowserCookies,
  buildAuthBridgeLogoutUrl,
  stripSignedOutFromUrl,
};
