/**
 * WOS-72 — Postgres-backed workflow role catalog + user role assignments.
 */
const { Pool } = require('pg');
const { resolvePgSsl } = require('../hub/db/pg-ssl');

const DEFAULT_WORKFLOW_ROLE_KEYS = ['admin', 'requester', 'manager', 'operations', 'ap', 'legal'];

const SEED_ROLES = [
  { key: 'admin', name: 'Admin', description: 'Full workflow administration and sign-off', system_role: true },
  { key: 'requester', name: 'Requester', description: 'Submitter who fills and completes requester steps', system_role: true },
  { key: 'employee', name: 'Employee', description: 'Standard employee access for form fill and visibility', system_role: true },
  { key: 'manager', name: 'Manager', description: 'Review and approve manager-assigned steps', system_role: true },
  { key: 'operations', name: 'Operations', description: 'Operations review and fulfillment steps', system_role: true },
  { key: 'ap', name: 'Accounts Payable', description: 'AP review and approval steps', system_role: true },
  { key: 'legal', name: 'Legal', description: 'Legal review and sign-off steps', system_role: true },
  { key: 'hub_admin', name: 'Hub Admin', description: 'Hub administrator with elevated access', system_role: true },
  { key: 'hr', name: 'HR Manager', description: 'Human resources review and people workflows', system_role: true },
  { key: 'field_supervisor', name: 'Field Supervisor', description: 'Field crew supervision and field approvals', system_role: true },
  { key: 'field_technician', name: 'Field Technician', description: 'Field execution and form completion', system_role: true },
  { key: 'client', name: 'Client Representative', description: 'External client visibility into assigned work', system_role: true },
  { key: 'vendor', name: 'External Vendor', description: 'External vendor portal access', system_role: true },
];

let pool = null;

function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: resolvePgSsl(process.env.DATABASE_URL),
    });
  }
  return pool;
}

function isAvailable() {
  return !!getPool();
}

function rowToRole(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    status: row.status,
    system_role: row.system_role,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function seedRolesIfEmpty() {
  const p = getPool();
  if (!p) return;
  for (const role of SEED_ROLES) {
    await p.query(
      `INSERT INTO roles (key, name, description, status, system_role, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', $4, now(), now())
       ON CONFLICT (key) DO NOTHING`,
      [role.key, role.name, role.description, role.system_role]
    );
  }
}

async function listActiveRoles() {
  const p = getPool();
  if (!p) return SEED_ROLES.map((r) => ({ ...r, status: 'active', system_role: r.system_role }));
  await seedRolesIfEmpty();
  const r = await p.query(
    `SELECT * FROM roles WHERE status = 'active' ORDER BY system_role DESC, name ASC`
  );
  return r.rows.map(rowToRole);
}

async function listActiveRoleKeys() {
  const roles = await listActiveRoles();
  return roles.map((r) => r.key);
}

async function getUserRoleKeys(userEmail) {
  const p = getPool();
  if (!p || !userEmail) return [];
  await seedRolesIfEmpty();
  const r = await p.query(
    `SELECT role_key FROM user_roles WHERE lower(user_email) = lower($1) ORDER BY role_key ASC`,
    [userEmail]
  );
  return r.rows.map((row) => row.role_key);
}

async function setUserRoleKeys(userEmail, roleKeys, actorEmail = null) {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL required for workflow role assignment');
  if (!userEmail) throw new Error('user_email required');
  await seedRolesIfEmpty();
  const email = String(userEmail).trim().toLowerCase();
  const keys = Array.isArray(roleKeys)
    ? [...new Set(roleKeys.map((k) => String(k).trim().toLowerCase()).filter(Boolean))]
    : [];

  if (keys.length) {
    const valid = await p.query(`SELECT key FROM roles WHERE status = 'active' AND key = ANY($1::text[])`, [keys]);
    const validSet = new Set(valid.rows.map((row) => row.key));
    const invalid = keys.filter((k) => !validSet.has(k));
    if (invalid.length) {
      const err = new Error(`Unknown or inactive role keys: ${invalid.join(', ')}`);
      err.code = 'INVALID_ROLE';
      err.status = 400;
      throw err;
    }
  }

  const client = await p.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM user_roles WHERE lower(user_email) = lower($1)', [email]);
    for (const roleKey of keys) {
      await client.query(
        `INSERT INTO user_roles (user_email, role_key, created_at, created_by)
         VALUES ($1, $2, now(), $3)`,
        [email, roleKey, actorEmail]
      );
    }
    await client.query('COMMIT');
    return keys;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function deleteUserRolesForTest(userEmail) {
  const p = getPool();
  if (!p || !userEmail) return;
  await p.query('DELETE FROM user_roles WHERE lower(user_email) = lower($1)', [userEmail]);
}

function slugRoleKey(name) {
  const base =
    String(name || 'role')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'role';
  return base;
}

async function listAllRoles() {
  const p = getPool();
  if (!p) return SEED_ROLES.map((r) => ({ ...r, status: 'active', system_role: r.system_role }));
  await seedRolesIfEmpty();
  const r = await p.query(`SELECT * FROM roles ORDER BY system_role DESC, status ASC, name ASC`);
  return r.rows.map(rowToRole);
}

async function createRole({ key, name, description = null }, actorEmail = null) {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL required for role management');
  await seedRolesIfEmpty();
  const roleKey = String(key || slugRoleKey(name)).trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(roleKey)) {
    const err = new Error('Role key must start with a letter and use lowercase letters, numbers, underscores');
    err.code = 'INVALID_KEY';
    err.status = 400;
    throw err;
  }
  const roleName = String(name || roleKey).trim();
  if (!roleName) {
    const err = new Error('Role name is required');
    err.code = 'VALIDATION';
    err.status = 400;
    throw err;
  }
  const existing = await p.query('SELECT key FROM roles WHERE key = $1 LIMIT 1', [roleKey]);
  if (existing.rowCount) {
    const err = new Error(`Role key already exists: ${roleKey}`);
    err.code = 'DUPLICATE';
    err.status = 409;
    throw err;
  }
  const r = await p.query(
    `INSERT INTO roles (key, name, description, status, system_role, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', false, now(), now())
     RETURNING *`,
    [roleKey, roleName, description || null]
  );
  return rowToRole(r.rows[0]);
}

async function archiveRole(roleKey, actorEmail = null) {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL required for role management');
  const key = String(roleKey || '').trim().toLowerCase();
  const r = await p.query('SELECT * FROM roles WHERE key = $1 LIMIT 1', [key]);
  const role = r.rows[0];
  if (!role) {
    const err = new Error('Role not found');
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }
  if (role.system_role) {
    const err = new Error('System roles cannot be archived');
    err.code = 'PROTECTED';
    err.status = 409;
    throw err;
  }
  const updated = await p.query(
    `UPDATE roles SET status = 'archived', updated_at = now() WHERE key = $1 RETURNING *`,
    [key]
  );
  return rowToRole(updated.rows[0]);
}

async function deleteRoleForTest(roleKey) {
  const p = getPool();
  if (!p || !roleKey) return;
  await p.query('DELETE FROM user_roles WHERE role_key = $1', [roleKey]);
  await p.query('DELETE FROM roles WHERE key = $1 AND system_role = false', [roleKey]);
}

// WOS-80 — role lifecycle guardrails ---------------------------------------

async function tableExists(p, name) {
  try {
    const r = await p.query('SELECT to_regclass($1) AS reg', [`public.${name}`]);
    return !!r.rows[0]?.reg;
  } catch {
    return false;
  }
}

// Pull assignee role keys out of a workflow JSON blob (raw draft or compiled).
function collectWorkflowRoleKeys(wf) {
  if (!wf || typeof wf !== 'object') return [];
  const steps = Array.isArray(wf.steps) ? wf.steps : [];
  const keys = [];
  for (const step of steps) {
    const role = step && (step.assignee_role || step.role);
    if (role) keys.push(String(role).toLowerCase());
  }
  return keys;
}

/**
 * WOS-80 — count where each role key is referenced across the platform so the
 * UI/delete route can protect in-use roles. Returns a map of
 * lowercased role_key → total reference count. Surfaces checked:
 *   - user_roles.role_key (assigned users)
 *   - workflow_step_instances.assignee_role (live workflow steps)
 *   - form_template_versions.workflow_json / compiled_workflow_json (steps)
 *   - app_spaces / template_launch_entries.visible_to_roles_json (launch vis.)
 * Missing tables are skipped (older schema); this never throws into callers.
 */
async function getRoleReferenceSummary() {
  const p = getPool();
  if (!p) return {};
  const counts = {};
  const bump = (key, n) => {
    if (!key) return;
    const k = String(key).toLowerCase();
    counts[k] = (counts[k] || 0) + (n || 0);
  };

  try {
    const r = await p.query('SELECT role_key, COUNT(*)::int AS c FROM user_roles GROUP BY role_key');
    r.rows.forEach((row) => bump(row.role_key, row.c));
  } catch {
    /* user_roles always exists with roles migration; ignore transient errors */
  }

  if (await tableExists(p, 'workflow_step_instances')) {
    try {
      const r = await p.query(
        "SELECT assignee_role, COUNT(*)::int AS c FROM workflow_step_instances WHERE assignee_role IS NOT NULL GROUP BY assignee_role"
      );
      r.rows.forEach((row) => bump(row.assignee_role, row.c));
    } catch {
      /* ignore */
    }
  }

  if (await tableExists(p, 'form_template_versions')) {
    try {
      const r = await p.query('SELECT workflow_json, compiled_workflow_json FROM form_template_versions');
      r.rows.forEach((row) => {
        collectWorkflowRoleKeys(row.workflow_json).forEach((k) => bump(k, 1));
        collectWorkflowRoleKeys(row.compiled_workflow_json).forEach((k) => bump(k, 1));
      });
    } catch {
      /* ignore */
    }
  }

  for (const tbl of ['app_spaces', 'template_launch_entries']) {
    if (!(await tableExists(p, tbl))) continue;
    try {
      const r = await p.query(`SELECT visible_to_roles_json AS v FROM ${tbl}`);
      r.rows.forEach((row) => {
        const arr = Array.isArray(row.v) ? row.v : [];
        arr.forEach((k) => bump(k, 1));
      });
    } catch {
      /* ignore */
    }
  }

  return counts;
}

async function countRoleReferences(roleKey) {
  const summary = await getRoleReferenceSummary();
  return summary[String(roleKey || '').toLowerCase()] || 0;
}

/**
 * WOS-80 — hard-delete a custom, unreferenced role. System roles and any role
 * still referenced by users/workflows/submissions are blocked (callers should
 * archive/deactivate those instead).
 */
async function deleteRole(roleKey, actorEmail = null) {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL required for role management');
  const key = String(roleKey || '').trim().toLowerCase();
  const r = await p.query('SELECT * FROM roles WHERE key = $1 LIMIT 1', [key]);
  const role = r.rows[0];
  if (!role) {
    const err = new Error('Role not found');
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }
  if (role.system_role) {
    const err = new Error('System roles are required by the platform and cannot be deleted.');
    err.code = 'PROTECTED';
    err.status = 409;
    throw err;
  }
  const refs = await countRoleReferences(key);
  if (refs > 0) {
    const err = new Error('This role is used by users, workflows, or submitted records. It can be deactivated, but not deleted.');
    err.code = 'REFERENCED';
    err.status = 409;
    err.references = refs;
    throw err;
  }
  await p.query('DELETE FROM user_roles WHERE role_key = $1', [key]);
  await p.query('DELETE FROM roles WHERE key = $1 AND system_role = false', [key]);
  return { deleted: true, key };
}

/** WOS-80 — restore (reactivate) an archived custom role. */
async function restoreRole(roleKey) {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL required for role management');
  const key = String(roleKey || '').trim().toLowerCase();
  const r = await p.query('SELECT * FROM roles WHERE key = $1 LIMIT 1', [key]);
  const role = r.rows[0];
  if (!role) {
    const err = new Error('Role not found');
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }
  if (role.system_role) {
    // System roles are always active; nothing to restore.
    return rowToRole(role);
  }
  const updated = await p.query(
    `UPDATE roles SET status = 'active', updated_at = now() WHERE key = $1 RETURNING *`,
    [key]
  );
  return rowToRole(updated.rows[0]);
}

module.exports = {
  DEFAULT_WORKFLOW_ROLE_KEYS,
  SEED_ROLES,
  isAvailable,
  seedRolesIfEmpty,
  listActiveRoles,
  listAllRoles,
  listActiveRoleKeys,
  getUserRoleKeys,
  setUserRoleKeys,
  createRole,
  archiveRole,
  deleteRole,
  restoreRole,
  getRoleReferenceSummary,
  countRoleReferences,
  deleteUserRolesForTest,
  deleteRoleForTest,
  slugRoleKey,
};
