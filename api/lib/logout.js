/**
 * WOS-86 — Shared post-auth logout helpers (server-side session clear).
 */

const auth = require('./auth');

function setNoStore(res) {
  if (typeof res.setHeader === 'function') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}

/**
 * Preferred landing page after logout (login or portal home).
 */
function resolvePostLogoutUrl(portalBase) {
  const base = portalBase || process.env.PORTAL_BASE_URL || '/';
  const normalized = base.endsWith('/') ? base.slice(0, -1) : base;

  try {
    const stagingLogin = require('./staging-test-login');
    if (stagingLogin.isStagingTestLoginEnabled()) {
      return `${normalized}/api/auth/staging-test-login`;
    }
  } catch {
    /* optional */
  }

  // Relative portal home forces a full navigation (avoids BFCache restoring app state).
  if (base.startsWith('http')) return `${normalized}/`;
  return `${normalized}/` || '/';
}

/**
 * Clear session cookies and redirect. Optionally hand off to Entra SLO when configured.
 */
async function performLogout(req, res, { portalBase, useEntra = false, entraLogoutUrl = null } = {}) {
  setNoStore(res);
  auth.clearSession(res);

  const landing = resolvePostLogoutUrl(portalBase);

  if (useEntra && entraLogoutUrl) {
    res.setHeader('Location', entraLogoutUrl);
    return res.status(302).end();
  }

  res.setHeader('Location', landing);
  return res.status(302).end();
}

module.exports = {
  setNoStore,
  resolvePostLogoutUrl,
  performLogout,
};
