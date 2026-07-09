/**
 * WOS-72 / WOS-73 — Hub RBAC routes (workflow role catalog + user assignments).
 */
const postgres = require('./postgres');
const rolesCatalog = require('./roles-catalog');
const { recordSecurityAudit } = require('../security-audit');

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

// Read gate — the read-only "view user permissions" perm may read role data.
function requireAdmin(res, permissions, isAdmin) {
  if (isAdmin) return true;
  if (Array.isArray(permissions) && (permissions.includes('admin') || permissions.includes('view_user_permissions'))) {
    return true;
  }
  json(res, 403, { error: 'Forbidden' });
  return false;
}

// WOS-80 (finding R5) — write gate. Creating/archiving roles and assigning
// user roles are privileged writes and require true admin/hub_admin; the
// read-only view_user_permissions perm is NOT sufficient.
function requireAdminWrite(res, permissions, isAdmin) {
  if (isAdmin) return true;
  if (Array.isArray(permissions) && (permissions.includes('admin') || permissions.includes('hub_admin'))) {
    return true;
  }
  json(res, 403, { error: 'Admin required' });
  return false;
}

async function handleRbacRoutes(path, req, res, ctx) {
  const { actorEmail, permissions, isAdmin } = ctx;
  const method = req.method;

  if (path === '/hub/rbac/workflow-roles' && method === 'GET') {
    try {
      await rolesCatalog.refreshAllowedAssigneeRoleKeys();
      const roles = await rolesCatalog.listRoleOptionsForUi();
      json(res, 200, { roles });
    } catch (err) {
      json(res, 500, { error: err.message || 'Failed to load workflow roles' });
    }
    return true;
  }

  if (path === '/hub/rbac/roles' && method === 'GET') {
    if (!requireAdmin(res, permissions, isAdmin)) return true;
    try {
      let roles = postgres.isAvailable() ? await postgres.listAllRoles() : [];
      // WOS-80 — annotate each role with reference usage so the UI can hide or
      // disable Delete for referenced roles (delete stays blocked server-side).
      if (postgres.isAvailable() && roles.length) {
        try {
          const refs = await postgres.getRoleReferenceSummary();
          roles = roles.map((r) => {
            const count = refs[String(r.key || '').toLowerCase()] || 0;
            return { ...r, reference_count: count, referenced: count > 0, deletable: !r.system_role && count === 0 };
          });
        } catch {
          roles = roles.map((r) => ({ ...r, reference_count: null, referenced: null, deletable: !r.system_role }));
        }
      }
      json(res, 200, { roles });
    } catch (err) {
      json(res, 500, { error: err.message || 'Failed to load roles' });
    }
    return true;
  }

  if (path === '/hub/rbac/roles' && method === 'POST') {
    if (!requireAdminWrite(res, permissions, isAdmin)) return true;
    const body = parseBody(req);
    if (body === null) {
      json(res, 400, { error: 'Invalid JSON body' });
      return true;
    }
    if (!postgres.isAvailable()) {
      json(res, 503, { error: 'Role management requires Postgres (DATABASE_URL)' });
      return true;
    }
    try {
      const role = await postgres.createRole(
        { key: body.key, name: body.name, description: body.description },
        actorEmail
      );
      await rolesCatalog.refreshAllowedAssigneeRoleKeys(true);
      recordSecurityAudit('rbac.role_created', { actor: actorEmail, role_key: body.key });
      json(res, 201, { role });
    } catch (err) {
      json(res, err.status || 500, { error: err.message, code: err.code || 'ERROR' });
    }
    return true;
  }

  const roleArchiveMatch = path.match(/^\/hub\/rbac\/roles\/([^/]+)\/archive$/);
  if (roleArchiveMatch && method === 'POST') {
    if (!requireAdminWrite(res, permissions, isAdmin)) return true;
    if (!postgres.isAvailable()) {
      json(res, 503, { error: 'Role management requires Postgres (DATABASE_URL)' });
      return true;
    }
    try {
      const roleKey = decodeURIComponent(roleArchiveMatch[1]);
      const role = await postgres.archiveRole(roleKey, actorEmail);
      await rolesCatalog.refreshAllowedAssigneeRoleKeys(true);
      recordSecurityAudit('rbac.role_archived', { actor: actorEmail, role_key: roleKey });
      json(res, 200, { role });
    } catch (err) {
      json(res, err.status || 500, { error: err.message, code: err.code || 'ERROR' });
    }
    return true;
  }

  const roleRestoreMatch = path.match(/^\/hub\/rbac\/roles\/([^/]+)\/restore$/);
  if (roleRestoreMatch && method === 'POST') {
    if (!requireAdminWrite(res, permissions, isAdmin)) return true;
    if (!postgres.isAvailable()) {
      json(res, 503, { error: 'Role management requires Postgres (DATABASE_URL)' });
      return true;
    }
    try {
      const roleKey = decodeURIComponent(roleRestoreMatch[1]);
      const role = await postgres.restoreRole(roleKey);
      await rolesCatalog.refreshAllowedAssigneeRoleKeys(true);
      recordSecurityAudit('rbac.role_restored', { actor: actorEmail, role_key: roleKey });
      json(res, 200, { role });
    } catch (err) {
      json(res, err.status || 500, { error: err.message, code: err.code || 'ERROR' });
    }
    return true;
  }

  // WOS-80 — hard delete. Blocked for system roles (PROTECTED) and referenced
  // roles (REFERENCED); the client should offer Archive/Deactivate instead.
  const roleDeleteMatch = path.match(/^\/hub\/rbac\/roles\/([^/]+)$/);
  if (roleDeleteMatch && method === 'DELETE') {
    if (!requireAdminWrite(res, permissions, isAdmin)) return true;
    if (!postgres.isAvailable()) {
      json(res, 503, { error: 'Role management requires Postgres (DATABASE_URL)' });
      return true;
    }
    try {
      const roleKey = decodeURIComponent(roleDeleteMatch[1]);
      const result = await postgres.deleteRole(roleKey, actorEmail);
      await rolesCatalog.refreshAllowedAssigneeRoleKeys(true);
      recordSecurityAudit('rbac.role_deleted', { actor: actorEmail, role_key: roleKey });
      json(res, 200, { deleted: true, key: result.key });
    } catch (err) {
      json(res, err.status || 500, { error: err.message, code: err.code || 'ERROR', references: err.references });
    }
    return true;
  }

  const userRolesMatch = path.match(/^\/hub\/users\/([^/]+)\/workflow-roles$/);
  if (userRolesMatch && method === 'GET') {
    if (!requireAdmin(res, permissions, isAdmin)) return true;
    const email = decodeURIComponent(userRolesMatch[1]);
    try {
      const role_keys = postgres.isAvailable() ? await postgres.getUserRoleKeys(email) : [];
      json(res, 200, { email, role_keys });
    } catch (err) {
      json(res, 500, { error: err.message || 'Failed to load user workflow roles' });
    }
    return true;
  }

  if (userRolesMatch && method === 'PUT') {
    if (!requireAdminWrite(res, permissions, isAdmin)) return true;
    const email = decodeURIComponent(userRolesMatch[1]);
    const body = parseBody(req);
    if (body === null) {
      json(res, 400, { error: 'Invalid JSON body' });
      return true;
    }
    if (!postgres.isAvailable()) {
      json(res, 503, { error: 'Workflow role assignment requires Postgres (DATABASE_URL)' });
      return true;
    }
    try {
      const role_keys = await postgres.setUserRoleKeys(email, body.role_keys || [], actorEmail);
      await rolesCatalog.refreshAllowedAssigneeRoleKeys(true);
      recordSecurityAudit('rbac.user_roles_set', {
        actor: actorEmail,
        target: email,
        role_count: Array.isArray(role_keys) ? role_keys.length : 0,
      });
      json(res, 200, { email, role_keys });
    } catch (err) {
      json(res, err.status || 500, { error: err.message, code: err.code || 'ERROR' });
    }
    return true;
  }

  return false;
}

module.exports = { handleRbacRoutes };
