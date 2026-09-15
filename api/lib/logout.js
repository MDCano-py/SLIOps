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
 * Append ?signed_out=1 so the portal auth gate does not immediately
 * bounce the user back into Entra after local session clear.
 */
function appendSignedOutFlag(url) {
  if (!url || typeof url !== 'string') return url;
  if (/[?&]signed_out=1(?:&|$)/.test(url)) return url;
  return url.includes('?') ? `${url}&signed_out=1` : `${url}?signed_out=1`;
}

/**
 * Preferred landing page after logout (login or portal home).
 * Never lands on bare "/" when WOS is mounted under APP_BASE_PATH.
 * Always includes signed_out=1 so auto-SSO cannot look like a no-op logout.
 */
function resolvePostLogoutUrl(portalBase) {
  const { resolvePostAuthRedirect } = require('./app-paths');
  const home = resolvePostAuthRedirect(portalBase || process.env.PORTAL_BASE_URL || '/', '/');

  try {
    const stagingLogin = require('./staging-test-login');
    if (stagingLogin.isStagingTestLoginEnabled()) {
      const { publicPath, getPortalMountPath, getAppBasePath } = require('./app-paths');
      const mount = getPortalMountPath(portalBase) || getAppBasePath();
      if (/^https?:\/\//i.test(home)) {
        const u = new URL(home);
        return appendSignedOutFlag(
          `${u.origin}${publicPath('/api/auth/staging-test-login', mount)}`
        );
      }
      return appendSignedOutFlag(publicPath('/api/auth/staging-test-login', mount));
    }
  } catch {
    /* optional */
  }

  return appendSignedOutFlag(home);
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
  appendSignedOutFlag,
  resolvePostLogoutUrl,
  performLogout,
};
