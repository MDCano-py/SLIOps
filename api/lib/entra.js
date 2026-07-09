// Microsoft Entra ID (Azure AD) — OIDC authorization code flow via @azure/msal-node.
//
// Tokens are acquired and validated server-side only. The browser receives
// our signed session cookie (auth.issueSession) — never Microsoft tokens.
//
// Required env vars:
//   ENTRA_TENANT_ID
//   ENTRA_CLIENT_ID
//   ENTRA_CLIENT_SECRET
//   ENTRA_REDIRECT_URI     e.g. https://your-app.vercel.app/api/auth/callback
//   SESSION_SECRET         (shared with lib/auth.js)
//   ALLOWED_EMAIL_DOMAINS  comma-separated, e.g. streamlinecorp.com

const crypto = require('crypto');
const msal = require('@azure/msal-node');
const auth = require('./auth');

const OAUTH_STATE_COOKIE = 'sliops_oauth_state';
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const OIDC_SCOPES = ['openid', 'profile', 'email', 'User.Read'];

let _cca = null;

function isNonProduction() {
  return process.env.NODE_ENV !== 'production';
}

/** Dev-login cookie only in local development (not staging approval). */
function isDevLoginAllowed() {
  const env = (process.env.NODE_ENV || '').toLowerCase();
  // WOS-80 — dev-login is a local/dev break-glass and is NEVER available on
  // staging or production, even if ALLOW_DEV_LOGIN is set in the environment.
  if (env === 'staging' || env === 'production') {
    return false;
  }
  if (['1', 'true', 'yes'].includes(String(process.env.ALLOW_DEV_LOGIN || '').toLowerCase())) {
    return true;
  }
  return env === 'development';
}

function isEntraConfigured() {
  return missingEntraVars().length === 0;
}

function missingEntraVars() {
  const missing = [];
  if (!process.env.ENTRA_TENANT_ID) missing.push('ENTRA_TENANT_ID');
  if (!process.env.ENTRA_CLIENT_ID) missing.push('ENTRA_CLIENT_ID');
  if (!process.env.ENTRA_CLIENT_SECRET) missing.push('ENTRA_CLIENT_SECRET');
  if (!process.env.ENTRA_REDIRECT_URI) missing.push('ENTRA_REDIRECT_URI');
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    missing.push('SESSION_SECRET (≥32 chars)');
  }
  return missing;
}

function allowedDomains() {
  return (process.env.ALLOWED_EMAIL_DOMAINS || '')
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

function getMsalClient() {
  if (_cca) return _cca;
  const tenantId = process.env.ENTRA_TENANT_ID;
  _cca = new msal.ConfidentialClientApplication({
    auth: {
      clientId: process.env.ENTRA_CLIENT_ID,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      clientSecret: process.env.ENTRA_CLIENT_SECRET,
    },
    system: {
      loggerOptions: {
        loggerCallback() {},
        piiLoggingEnabled: false,
        logLevel: msal.LogLevel.Error,
      },
    },
  });
  return _cca;
}

function parseDisplayName(name) {
  if (!name || typeof name !== 'string') return { firstName: null, lastName: null };
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function identityFromTokenResponse(tokenResponse) {
  const claims = tokenResponse?.idTokenClaims || {};
  const account = tokenResponse?.account || {};
  const email = String(
    claims.preferred_username ||
      claims.email ||
      claims.upn ||
      account.username ||
      ''
  )
    .trim()
    .toLowerCase();

  const displayName = claims.name || account.name || '';
  const { firstName, lastName } = parseDisplayName(displayName);

  return {
    email,
    firstName,
    lastName,
    name: displayName,
    oid: claims.oid || null,
    tid: claims.tid || null,
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
  auth.appendSetCookie(res, [
    auth.buildSetCookie(OAUTH_STATE_COOKIE, token, OAUTH_STATE_TTL_SECONDS),
  ]);
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

async function handleLogin(req, res, { renderError, portalBase }) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const missing = missingEntraVars();
  if (missing.length) {
    return renderError(
      503,
      'Entra SSO not configured',
      `Missing: ${missing.join(', ')}`
    );
  }

  const remember = req.query.remember === '1' || req.query.remember === 'true';
  const next = typeof req.query.next === 'string' ? req.query.next : '';
  const state = issueOAuthStateCookie(res, { remember, next });

  try {
    const cca = getMsalClient();
    const url = await cca.getAuthCodeUrl({
      scopes: OIDC_SCOPES,
      redirectUri: process.env.ENTRA_REDIRECT_URI,
      state,
      prompt: 'select_account',
    });
    res.setHeader('Location', url);
    return res.status(302).end();
  } catch (err) {
    console.error('Entra login redirect failed:', err);
    return renderError(500, 'Sign-in failed', err.message || String(err));
  }
}

async function handleCallback(req, res, { renderError, portalBase, ensureUserProvisioned }) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const errParam = req.query.error;
  const errDesc = req.query.error_description;
  if (errParam) {
    return renderError(401, 'Sign-in cancelled', errDesc || errParam);
  }

  const code = req.query.code;
  const state = req.query.state;
  if (!code) {
    return renderError(400, 'Missing authorization code', 'Restart sign-in from the portal.');
  }

  const oauthState = consumeOAuthState(req, res, state);
  if (!oauthState) {
    return renderError(401, 'Invalid sign-in state', 'Your session may have expired. Please try again.');
  }

  try {
    const cca = getMsalClient();
    const tokenResponse = await cca.acquireTokenByCode({
      code,
      scopes: OIDC_SCOPES,
      redirectUri: process.env.ENTRA_REDIRECT_URI,
    });

    const identity = identityFromTokenResponse(tokenResponse);
    if (!identity.email) {
      return renderError(
        401,
        'No email on account',
        'Microsoft did not return an email for this user. Ensure the app has openid/profile/email scopes.'
      );
    }

    if (!isEmailDomainAllowed(identity.email)) {
      return renderError(
        403,
        'Email not allowed',
        `Sign-in is restricted to: ${allowedDomains().join(', ')}`
      );
    }

    auth.issueSession(res, identity.email, { remember: oauthState.r === 1 });

    try {
      await ensureUserProvisioned(identity);
    } catch (err) {
      console.error('Entra provisioning failed (non-fatal):', err);
    }

    const target = buildRedirectTarget(portalBase, oauthState.next);
    res.setHeader('Location', target);
    return res.status(302).end();
  } catch (err) {
    console.error('Entra token exchange failed:', err);
    return renderError(401, 'Sign-in failed', err.message || String(err));
  }
}

async function handleLogout(req, res, { portalBase }) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  auth.clearSession(res);

  const tenantId = process.env.ENTRA_TENANT_ID;
  const postLogout = encodeURIComponent(portalBase || '/');
  const logoutUrl =
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/logout` +
    `?post_logout_redirect_uri=${postLogout}`;

  res.setHeader('Location', logoutUrl);
  return res.status(302).end();
}

async function handleDevLogin(req, res, { renderError, portalBase, ensureUserProvisioned }) {
  if (!isDevLoginAllowed()) {
    return res.status(404).json({ error: 'Not found' });
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const email = String(req.query.email || '')
    .trim()
    .toLowerCase();
  if (!email || !email.includes('@')) {
    return renderError(400, 'Invalid email', 'Use ?email=you@company.com');
  }
  if (!isEmailDomainAllowed(email)) {
    return renderError(403, 'Email not allowed', `Allowed domains: ${allowedDomains().join(', ')}`);
  }

  auth.issueSession(res, email, { remember: false });
  try {
    await ensureUserProvisioned({
      email,
      firstName: null,
      lastName: null,
    });
  } catch (err) {
    console.warn('Dev login provisioning failed:', err.message);
  }

  const next = typeof req.query.next === 'string' ? req.query.next : '';
  res.setHeader('Location', buildRedirectTarget(portalBase, next));
  return res.status(302).end();
}

module.exports = {
  isEntraConfigured,
  isNonProduction,
  isDevLoginAllowed,
  missingEntraVars,
  isEmailDomainAllowed,
  handleLogin,
  handleCallback,
  handleLogout,
  handleDevLogin,
  identityFromTokenResponse,
};
