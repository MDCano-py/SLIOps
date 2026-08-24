/**
 * WOS-58 — App spaces + launch registry API routes.
 */
const spaceStore = require('./store');
const { rolesCanSee } = require('./normalize');
const authErrors = require('../auth-errors');

function parseBody(req) {
  if (!req.body) return {};
  try {
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return null;
  }
}

function json(res, status, data) {
  return res.status(status).json(data);
}

function canManageSpaces(permissions, isAdmin) {
  if (isAdmin) return true;
  if (!Array.isArray(permissions)) return false;
  return permissions.includes('hub_admin') || permissions.includes('admin');
}

function storeError(res, err) {
  const status = err.status || 500;
  return json(res, status, { error: err.message, code: err.code || 'ERROR' });
}

/**
 * @returns {boolean} true if handled
 */
async function handleSpaceRoutes(path, req, res, ctx) {
  const method = (req.method || 'GET').toUpperCase();
  const { permissions, isAdmin, actorEmail } = ctx;

  if (!path.startsWith('/hub/spaces') && !path.startsWith('/hub/launch-entries')) return false;

  if (!spaceStore.isSpacesPostgresMode()) {
    json(res, 503, {
      error: 'App spaces require Postgres mode',
      code: 'POSTGRES_REQUIRED',
    });
    return true;
  }

  const adminOnly = async (handler) => {
    if (!canManageSpaces(permissions, isAdmin)) {
      json(res, 403, { error: 'Admin required for app spaces management' });
      return;
    }
    return handler();
  };

  if (path === '/hub/spaces/registry' && method === 'GET') {
    if (!actorEmail) {
      json(res, 401, authErrors.wosAuthRequiredBody());
      return true;
    }
    try {
      const registry = await spaceStore.getLaunchRegistry(permissions, isAdmin, actorEmail);
      json(res, 200, registry);
    } catch (err) {
      storeError(res, err);
    }
    return true;
  }

  if (path === '/hub/spaces' && method === 'GET') {
    try {
      const includeArchived = canManageSpaces(permissions, isAdmin);
      const spaces = await spaceStore.listSpaces({ includeArchived });
      const visible = includeArchived
        ? spaces
        : spaces.filter((s) => rolesCanSee(s.visible_to_roles_json, permissions, isAdmin));
      json(res, 200, { spaces: visible });
    } catch (err) {
      storeError(res, err);
    }
    return true;
  }

  if (path === '/hub/spaces' && method === 'POST') {
    await adminOnly(async () => {
      const body = parseBody(req);
      if (!body) return json(res, 400, { error: 'Invalid JSON body' });
      try {
        const space = await spaceStore.createSpace(body, actorEmail);
        json(res, 201, { space });
      } catch (err) {
        storeError(res, err);
      }
    });
    return true;
  }

  let m = path.match(/^\/hub\/spaces\/([^/]+)$/);
  if (m && method === 'PATCH') {
    await adminOnly(async () => {
      const body = parseBody(req);
      if (!body) return json(res, 400, { error: 'Invalid JSON body' });
      try {
        const space = await spaceStore.updateSpace(decodeURIComponent(m[1]), body, actorEmail);
        json(res, 200, { space });
      } catch (err) {
        storeError(res, err);
      }
    });
    return true;
  }

  m = path.match(/^\/hub\/spaces\/([^/]+)\/archive$/);
  if (m && method === 'POST') {
    await adminOnly(async () => {
      try {
        const space = await spaceStore.archiveSpace(decodeURIComponent(m[1]), actorEmail);
        json(res, 200, { space });
      } catch (err) {
        storeError(res, err);
      }
    });
    return true;
  }

  m = path.match(/^\/hub\/spaces\/([^/]+)\/launch-entries$/);
  if (m && method === 'GET') {
    await adminOnly(async () => {
      try {
        const entries = await spaceStore.listLaunchEntriesForSpace(decodeURIComponent(m[1]), {
          includeHidden: true,
        });
        json(res, 200, { entries });
      } catch (err) {
        storeError(res, err);
      }
    });
    return true;
  }

  m = path.match(/^\/hub\/launch-entries\/([^/]+)$/);
  if (m && method === 'GET') {
    if (!actorEmail) return json(res, 401, authErrors.wosAuthRequiredBody()), true;
    try {
      const entry = await spaceStore.getLaunchEntry(m[1]);
      if (!entry) return json(res, 404, { error: 'Launch entry not found' });
      if (entry.status !== 'active' && !canManageSpaces(permissions, isAdmin)) {
        return json(res, 404, { error: 'Launch entry not found' });
      }
      if (!rolesCanSee(entry.visible_to_roles_json, permissions, isAdmin)) {
        return json(res, 403, { error: 'Forbidden' });
      }
      json(res, 200, { entry });
    } catch (err) {
      storeError(res, err);
    }
    return true;
  }

  if (m && method === 'PATCH') {
    await adminOnly(async () => {
      const body = parseBody(req);
      if (!body) return json(res, 400, { error: 'Invalid JSON body' });
      try {
        const entry = await spaceStore.updateLaunchEntry(m[1], body, actorEmail);
        json(res, 200, { entry });
      } catch (err) {
        storeError(res, err);
      }
    });
    return true;
  }

  m = path.match(/^\/hub\/launch-entries\/([^/]+)\/(hide|activate)$/);
  if (m && method === 'POST') {
    await adminOnly(async () => {
      try {
        const status = m[2] === 'hide' ? 'hidden' : 'active';
        const entry = await spaceStore.setLaunchEntryStatus(m[1], status);
        json(res, 200, { entry });
      } catch (err) {
        storeError(res, err);
      }
    });
    return true;
  }

  return false;
}

module.exports = { handleSpaceRoutes, canManageSpaces };
