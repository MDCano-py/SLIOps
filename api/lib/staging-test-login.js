/**
 * WOS-85 — Controlled staging test-login (shared-secret + allowlisted PG users).
 *
 * Never available in production. Staging requires STAGING_TEST_LOGIN_ENABLED=1
 * and a strong STAGING_TEST_LOGIN_SECRET. Does not weaken /auth/dev-login.
 */

const crypto = require('crypto');
const auth = require('./auth');
const { recordSecurityAudit } = require('./security-audit');
const {
  ALLOWED_KEYS,
  listSelectorOptions,
  loadActiveTestUserByKey,
} = require('./staging-test-users');

const MIN_SECRET_LENGTH = 32;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_FAILURES = 5;

/** @type {Map<string, { failures: number, windowStart: number, lockedUntil: number }>} */
const _rateByIp = new Map();

function isTruthyFlag(raw) {
  return ['1', 'true', 'yes'].includes(String(raw || '').toLowerCase());
}

function getNodeEnv() {
  return String(process.env.NODE_ENV || '').toLowerCase();
}

function getConfiguredSecret() {
  return String(process.env.STAGING_TEST_LOGIN_SECRET || '');
}

/**
 * True only when the feature is fully enabled for this process.
 * Production always false. Weak/missing secret ⇒ false (never half-enabled).
 */
function isStagingTestLoginEnabled() {
  if (getNodeEnv() !== 'staging') return false;
  if (!isTruthyFlag(process.env.STAGING_TEST_LOGIN_ENABLED)) return false;
  if (getConfiguredSecret().length < MIN_SECRET_LENGTH) return false;
  return true;
}

/**
 * Startup guard: if staging explicitly enables the feature, secret must be strong.
 * Production never fails for these vars (feature stays disabled).
 */
function assertStagingTestLoginStartup() {
  const env = getNodeEnv();
  if (env === 'production') return;
  if (env !== 'staging') return;
  if (!isTruthyFlag(process.env.STAGING_TEST_LOGIN_ENABLED)) return;
  const secret = getConfiguredSecret();
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      'STAGING_TEST_LOGIN_ENABLED=1 requires STAGING_TEST_LOGIN_SECRET with at least 32 characters'
    );
  }
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) {
    // Compare against self to keep work roughly constant on length mismatch.
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function clientIp(req) {
  const xf = req.headers?.['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0].trim();
  return req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
}

function getRateState(ip) {
  const now = Date.now();
  let state = _rateByIp.get(ip);
  if (!state || now - state.windowStart > RATE_WINDOW_MS) {
    state = { failures: 0, windowStart: now, lockedUntil: 0 };
    _rateByIp.set(ip, state);
  }
  return state;
}

function isRateLimited(ip) {
  const state = getRateState(ip);
  return Date.now() < state.lockedUntil;
}

function recordFailedAttempt(ip) {
  const state = getRateState(ip);
  state.failures += 1;
  if (state.failures >= RATE_MAX_FAILURES) {
    state.lockedUntil = Date.now() + RATE_WINDOW_MS;
  }
}

function clearFailedAttempts(ip) {
  _rateByIp.delete(ip);
}

/** Test helper — clears rate-limit map. */
function resetRateLimitForTests() {
  _rateByIp.clear();
}

function isOriginAllowed(origin) {
  if (!origin) return false;
  const allowed = (process.env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.includes(origin)) return true;

  // Staging portal URL origin
  const portal = process.env.PORTAL_BASE_URL || '';
  if (portal) {
    try {
      if (new URL(portal).origin === origin) return true;
    } catch {
      /* ignore */
    }
  }

  // Same-host requests against the app (e.g. https://automation... )
  try {
    const u = new URL(origin);
    if (u.hostname === 'automation.streamlinescada.com') return true;
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return true;
  } catch {
    return false;
  }
  return false;
}

/**
 * CSRF defense for this POST endpoint (auth routes skip global Referer check).
 * Requires a valid Origin or Referer matching allowed staging origins.
 */
function assertCrossSiteProtected(req) {
  const origin = req.headers?.origin || '';
  const referer = req.headers?.referer || req.headers?.referrer || '';
  if (origin) return isOriginAllowed(origin);
  if (referer) {
    try {
      return isOriginAllowed(new URL(referer).origin);
    } catch {
      return false;
    }
  }
  return false;
}

function setNoStore(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderLoginPageHtml({ portalBase = '/' } = {}) {
  const options = listSelectorOptions()
    .map(
      (o) =>
        `<option value="${esc(o.key)}">${esc(o.label)} (${esc(o.role_key)})</option>`
    )
    .join('\n');
  const base = portalBase.endsWith('/') ? portalBase.slice(0, -1) : portalBase;
  const postAction = `${base}/api/auth/staging-test-login`;
  const homeHref = base || '/';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Staging Test Login</title>
  <style>
    :root { color-scheme: light; --ink:#1a2332; --muted:#5a6a7a; --line:#c5d0dc; --bg:#e8eef4; --card:#f7fafc; --accent:#0b5fff; --warn:#8a4b08; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; font-family: "Segoe UI", system-ui, sans-serif; background:
      radial-gradient(ellipse at 20% 0%, #d6e4f5 0%, transparent 50%),
      linear-gradient(160deg, #dfe8f0 0%, #cfd9e4 100%);
      color: var(--ink); display:flex; align-items:center; justify-content:center; padding:24px; }
    .panel { width:min(420px, 100%); background:var(--card); border:1px solid var(--line); border-radius:12px; padding:28px 26px 24px;
      box-shadow: 0 12px 40px rgba(26,35,50,.12); }
    h1 { margin:0 0 6px; font-size:1.35rem; letter-spacing:-0.02em; }
    .sub { margin:0 0 18px; color:var(--muted); font-size:.92rem; line-height:1.45; }
    .warn { margin:0 0 18px; padding:10px 12px; background:#fff6e8; border:1px solid #f0d2a0; border-radius:8px;
      color:var(--warn); font-size:.85rem; line-height:1.4; }
    label { display:block; font-size:.8rem; font-weight:600; margin:0 0 6px; }
    select, input[type=password] { width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:8px;
      font:inherit; background:#fff; margin-bottom:14px; }
    button { width:100%; padding:11px 14px; border:0; border-radius:8px; background:var(--accent); color:#fff;
      font:inherit; font-weight:600; cursor:pointer; }
    button:hover { filter:brightness(1.05); }
    .err { display:none; margin:0 0 12px; color:#9b1c1c; font-size:.88rem; }
    .err.show { display:block; }
    .foot { margin-top:16px; font-size:.8rem; color:var(--muted); text-align:center; }
    a { color:var(--accent); }
  </style>
</head>
<body>
  <main class="panel">
    <h1>Staging Test Login</h1>
    <p class="sub">Controlled role-based access for staging workflow tests before Entra SSO is configured.</p>
    <p class="warn"><strong>Unavailable in production.</strong> Requires a shared staging secret. Do not use real personal accounts.</p>
    <p class="err" id="err" role="alert"></p>
    <form id="f" method="post" action="${esc(postAction)}" autocomplete="off">
      <label for="user_key">Test user / role</label>
      <select id="user_key" name="user_key" required>
        <option value="" disabled selected>Select a seeded test user…</option>
        ${options}
      </select>
      <label for="secret">Shared staging secret</label>
      <input id="secret" name="secret" type="password" required minlength="32" autocomplete="current-password" />
      <button type="submit">Sign in as test user</button>
    </form>
    <p class="foot"><a href="${esc(homeHref)}">← Portal home</a></p>
  </main>
  <script>
    (function () {
      var form = document.getElementById('f');
      var err = document.getElementById('err');
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        err.classList.remove('show');
        err.textContent = '';
        var body = {
          user_key: document.getElementById('user_key').value,
          secret: document.getElementById('secret').value
        };
        fetch(form.action, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(body)
        }).then(function (res) {
          return res.json().then(function (data) {
            if (!res.ok) {
              err.textContent = (data && data.error) || 'Login failed';
              err.classList.add('show');
              return;
            }
            window.location.href = (data && data.redirect) || ${JSON.stringify(homeHref || '/')};
          });
        }).catch(function () {
          err.textContent = 'Login failed';
          err.classList.add('show');
        });
      });
    })();
  </script>
</body>
</html>`;
}

function parseBody(req) {
  const body = req.body;
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body;
}

function genericAuthError(res, status = 401) {
  setNoStore(res);
  return res.status(status).json({ error: 'Invalid credentials' });
}

/**
 * GET → HTML page (when enabled). POST → authenticate.
 * Always 404 when feature is not enabled (including production).
 */
async function handleStagingTestLogin(req, res, { portalBase = '/', syncUserRecord } = {}) {
  setNoStore(res);

  if (!isStagingTestLoginEnabled()) {
    return res.status(404).json({ error: 'Not found' });
  }

  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(renderLoginPageHtml({ portalBase }));
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = clientIp(req);

  if (isRateLimited(ip)) {
    recordSecurityAudit('staging_test_login.rate_limited', { ip });
    setNoStore(res);
    return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  }

  if (!assertCrossSiteProtected(req)) {
    recordSecurityAudit('staging_test_login.csrf_blocked', { ip });
    setNoStore(res);
    return res.status(403).json({ error: 'Cross-site request blocked' });
  }

  const body = parseBody(req);
  const userKey = String(body.user_key || body.userKey || '').trim();
  const submittedSecret = body.secret;

  // Reject arbitrary emails — only allowlist keys.
  if (body.email || body.user_email) {
    recordFailedAttempt(ip);
    recordSecurityAudit('staging_test_login.rejected', {
      ip,
      reason: 'arbitrary_email',
    });
    return genericAuthError(res);
  }

  if (!userKey || !ALLOWED_KEYS.has(userKey)) {
    recordFailedAttempt(ip);
    recordSecurityAudit('staging_test_login.rejected', {
      ip,
      reason: 'invalid_user_key',
      user_key: userKey || null,
    });
    return genericAuthError(res);
  }

  const expected = getConfiguredSecret();
  if (!timingSafeEqualString(submittedSecret, expected)) {
    recordFailedAttempt(ip);
    recordSecurityAudit('staging_test_login.rejected', {
      ip,
      reason: 'bad_secret',
      user_key: userKey,
    });
    return genericAuthError(res);
  }

  let user;
  try {
    user = await loadActiveTestUserByKey(userKey);
  } catch (err) {
    recordSecurityAudit('staging_test_login.error', {
      ip,
      user_key: userKey,
      detail: err.message,
    });
    setNoStore(res);
    return res.status(503).json({ error: 'Login temporarily unavailable' });
  }

  if (!user) {
    recordFailedAttempt(ip);
    recordSecurityAudit('staging_test_login.rejected', {
      ip,
      reason: 'user_unavailable',
      user_key: userKey,
    });
    return genericAuthError(res);
  }

  // Issue normal signed session cookie (HttpOnly, Secure, SameSite=Lax).
  auth.issueSession(res, user.email, { remember: false });

  if (typeof syncUserRecord === 'function') {
    try {
      await syncUserRecord(user);
    } catch (syncErr) {
      console.warn('[staging-test-login] permission sync failed (non-fatal):', syncErr.message);
    }
  }

  clearFailedAttempts(ip);
  recordSecurityAudit('staging_test_login.success', {
    ip,
    email: user.email,
    user_key: userKey,
    role_keys: user.roleKeys,
  });

  const home = portalBase.endsWith('/') ? portalBase : `${portalBase}/`;
  setNoStore(res);
  return res.status(200).json({
    ok: true,
    email: user.email,
    name: user.displayName,
    role_keys: user.roleKeys,
    redirect: home,
  });
}

module.exports = {
  MIN_SECRET_LENGTH,
  isStagingTestLoginEnabled,
  assertStagingTestLoginStartup,
  timingSafeEqualString,
  handleStagingTestLogin,
  renderLoginPageHtml,
  resetRateLimitForTests,
  isOriginAllowed,
  assertCrossSiteProtected,
  recordFailedAttempt,
  isRateLimited,
  clientIp,
  RATE_MAX_FAILURES,
  RATE_WINDOW_MS,
};
