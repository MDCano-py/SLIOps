/**
 * Logout is state-changing. Cross-site GET navigation must not sign the
 * user out. Same-origin GET remains for already-shipped portal links.
 * POST is accepted from this site (form or fetch).
 */

function header(req, name) {
  const headers = req?.headers || {};
  const direct = headers[name] || headers[name.toLowerCase()];
  return direct ? String(direct) : '';
}

function originAllowed(origin, req) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    const host = String(req?.headers?.host || '').split(':')[0].toLowerCase();
    const allowed = new Set(
      String(process.env.ALLOWED_ORIGIN || '')
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
    );
    if (host) allowed.add(host);
    return allowed.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function evaluateLogoutRequest(req) {
  const method = String(req?.method || '').toUpperCase();
  const site = header(req, 'sec-fetch-site').toLowerCase();
  const origin = header(req, 'origin');
  if (site === 'cross-site') {
    return { allow: false, reason: 'cross-site' };
  }
  if (origin && !originAllowed(origin, req)) {
    return { allow: false, reason: 'origin' };
  }
  if (method === 'POST') return { allow: true, reason: 'post' };
  if (method === 'GET' && (site === 'same-origin' || site === 'same-site' || site === 'none')) {
    return { allow: true, reason: 'same-site-get' };
  }
  if (method === 'GET' && !site) {
    return { allow: false, reason: 'get-without-fetch-metadata' };
  }
  return { allow: false, reason: 'method' };
}

module.exports = {
  evaluateLogoutRequest,
  originAllowed,
};
