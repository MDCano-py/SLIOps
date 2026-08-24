/**
 * Canonical WOS base-path / public-URL helpers.
 *
 * Single owner of APP_BASE_PATH prefixing for auth redirects and public paths.
 * Never concatenate PORTAL_BASE_URL + APP_BASE_PATH (PORTAL_BASE_URL already
 * includes the mount). Never join portalBase onto a `next` that already
 * contains the mount path.
 */

function normalizeBasePath(raw) {
  if (raw == null || raw === '' || raw === '/') return '';
  let b = String(raw).trim();
  if (!b) return '';
  if (!b.startsWith('/')) b = `/${b}`;
  while (b.length > 1 && b.endsWith('/')) b = b.slice(0, -1);
  return b === '/' ? '' : b;
}

function getAppBasePath(env = process.env) {
  return normalizeBasePath(env.APP_BASE_PATH || '');
}

/**
 * Path attribute for session / OAuth-state cookies under the WOS mount.
 * When APP_BASE_PATH is unset, Path=/ (app at site root).
 */
function getCookiePath(env = process.env) {
  return getAppBasePath(env) || '/';
}

/**
 * Mount path derived from PORTAL_BASE_URL pathname, falling back to APP_BASE_PATH.
 */
function getPortalMountPath(portalBase, env = process.env) {
  const raw = portalBase != null ? portalBase : env.PORTAL_BASE_URL;
  if (raw && /^https?:\/\//i.test(String(raw))) {
    try {
      const u = new URL(String(raw));
      const fromUrl = normalizeBasePath(u.pathname);
      if (fromUrl) return fromUrl;
    } catch {
      /* fall through */
    }
  } else if (raw && String(raw).startsWith('/')) {
    const fromRel = normalizeBasePath(String(raw));
    if (fromRel) return fromRel;
  }
  return getAppBasePath(env);
}

/**
 * Normalize an absolute or relative input into an application-relative path
 * (no mount prefix), e.g. "/dashboard" or "/".
 * Rejects protocol-relative and off-site URLs (returns null).
 */
function toAppRelativePath(input, mountPath) {
  const mount = normalizeBasePath(mountPath);
  if (input == null || input === '') return '/';

  let raw = String(input).trim();
  if (!raw) return '/';

  // Absolute URL — only same-site paths under the mount are allowed.
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      raw = `${u.pathname || '/'}${u.search || ''}${u.hash || ''}`;
    } catch {
      return null;
    }
  }

  // Open-redirect guards
  if (raw.startsWith('//') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
    return null;
  }

  if (!raw.startsWith('/')) {
    raw = `/${raw}`;
  }

  // Split path from query/hash so we only strip the mount from the pathname.
  let pathname = raw;
  let suffix = '';
  const q = raw.search(/[?#]/);
  if (q >= 0) {
    pathname = raw.slice(0, q);
    suffix = raw.slice(q);
  }

  let relative = pathname;
  if (mount) {
    if (pathname === mount || pathname === `${mount}/`) {
      relative = '/';
    } else if (pathname.startsWith(`${mount}/`)) {
      relative = pathname.slice(mount.length) || '/';
    }
  }

  // Collapse accidental double mounts: /ops-hub-staging/ops-hub-staging/...
  if (mount) {
    while (relative === mount || relative === `${mount}/` || relative.startsWith(`${mount}/`)) {
      if (relative === mount || relative === `${mount}/`) {
        relative = '/';
        break;
      }
      relative = relative.slice(mount.length) || '/';
    }
  }

  if (!relative.startsWith('/')) relative = `/${relative}`;
  return `${relative}${suffix}`;
}

/**
 * Public path under the WOS mount (no origin), e.g. "/ops-hub-staging/dashboard".
 */
function publicPath(appRelativeOrPublic, mountPath) {
  const mount = normalizeBasePath(mountPath);
  const rel = toAppRelativePath(appRelativeOrPublic, mount);
  if (rel == null) return mount ? `${mount}/` : '/';

  const q = rel.search(/[?#]/);
  const pathname = q >= 0 ? rel.slice(0, q) : rel;
  const suffix = q >= 0 ? rel.slice(q) : '';

  if (!mount) {
    return `${pathname || '/'}${suffix}`;
  }
  if (!pathname || pathname === '/') {
    return `${mount}/${suffix}`;
  }
  return `${mount}${pathname}${suffix}`;
}

/**
 * Resolve the single post-login Location value.
 * portalBase may be absolute (PORTAL_BASE_URL) or a path.
 * `next` may be app-relative, already-mounted, or absolute same-site.
 */
function resolvePostAuthRedirect(portalBase, next, env = process.env) {
  const mount = getPortalMountPath(portalBase, env) || getAppBasePath(env);
  const baseRaw = portalBase != null && String(portalBase).trim()
    ? String(portalBase).trim()
    : (env.PORTAL_BASE_URL || (mount ? `${mount}/` : '/'));

  const rel = toAppRelativePath(next, mount);
  const safeRel = rel == null ? '/' : rel;

  if (/^https?:\/\//i.test(baseRaw)) {
    let origin;
    try {
      const u = new URL(baseRaw.endsWith('/') ? baseRaw : `${baseRaw}/`);
      origin = u.origin;
    } catch {
      origin = null;
    }
    if (!origin) {
      return publicPath(safeRel, mount);
    }
    const pub = publicPath(safeRel, mount);
    return `${origin}${pub}`;
  }

  // Relative portal base (unusual) — still never emit bare "/" when mounted.
  return publicPath(safeRel, mount || normalizeBasePath(baseRaw));
}

/**
 * True when a candidate Location would double the mount segment.
 */
function hasDuplicatedMount(urlOrPath, mountPath) {
  const mount = normalizeBasePath(mountPath);
  if (!mount) return false;
  const s = String(urlOrPath || '');
  const doubled = `${mount}${mount}`;
  return s.includes(`${doubled}/`) || s.endsWith(doubled) || s.includes(`${doubled}?`);
}

module.exports = {
  normalizeBasePath,
  getAppBasePath,
  getCookiePath,
  getPortalMountPath,
  toAppRelativePath,
  publicPath,
  resolvePostAuthRedirect,
  hasDuplicatedMount,
  /** @deprecated use resolvePostAuthRedirect — kept as alias for call sites */
  buildRedirectTarget: resolvePostAuthRedirect,
};
