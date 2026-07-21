/**
 * WOS-86 — Resolve allowed browser origins for CORS / CSRF.
 *
 * Staging/production must list exact origins (no wildcards with credentials).
 * ALLOWED_ORIGIN is the primary allowlist (comma-separated).
 * PORTAL_BASE_URL's origin is always included when set so a missing
 * ALLOWED_ORIGIN does not break same-origin portal → API calls.
 */

function parseOrigin(raw) {
  if (!raw || !String(raw).trim()) return null;
  try {
    return new URL(String(raw).trim()).origin;
  } catch {
    return null;
  }
}

function splitOrigins(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      if (/^https?:\/\//i.test(entry)) return parseOrigin(entry) || entry;
      return entry;
    })
    .filter(Boolean);
}

/**
 * Full allowlist for the current process.
 * @returns {string[]}
 */
function getAllowedOrigins() {
  const set = new Set(splitOrigins(process.env.ALLOWED_ORIGIN));
  const portalOrigin = parseOrigin(process.env.PORTAL_BASE_URL);
  if (portalOrigin) set.add(portalOrigin);
  return [...set];
}

function isDeployedCorsEnv() {
  const env = String(process.env.NODE_ENV || '').toLowerCase();
  return env === 'staging' || env === 'production';
}

/**
 * @param {string} origin
 * @returns {boolean}
 */
function isOriginAllowed(origin) {
  if (!origin) return true; // server-to-server / no Origin
  const allowed = getAllowedOrigins();
  if (allowed.includes(origin)) return true;

  // Auto-allow localhost / legacy preview hosts ONLY outside staging/production.
  if (!isDeployedCorsEnv()) {
    if (/^https?:\/\/localhost(:\d+)?$/i.test(origin)) return true;
    if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/i.test(origin)) return true;
    if (/^https:\/\/parts-request-portal[a-z0-9-]*\.vercel\.app$/i.test(origin)) return true;
  }
  return false;
}

/** Documented staging portal origin (no path). */
const STAGING_PORTAL_ORIGIN = 'https://automation.streamlinescada.com';

module.exports = {
  parseOrigin,
  splitOrigins,
  getAllowedOrigins,
  isOriginAllowed,
  isDeployedCorsEnv,
  STAGING_PORTAL_ORIGIN,
};
