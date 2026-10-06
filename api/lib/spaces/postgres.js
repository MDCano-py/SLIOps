/**
 * WOS-58 — App spaces + template launch registry Postgres store.
 */
const { Pool } = require('pg');
const { resolvePgSsl } = require('../hub/db/pg-ssl');
const {
  normalizeSpaceInput,
  normalizeLaunchConfig,
  inferDefaultSpaceKey,
  rolesCanSee,
} = require('./normalize');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: resolvePgSsl(process.env.DATABASE_URL),
});

function jsonb(val) {
  if (val === undefined || val === null) return null;
  return JSON.stringify(val);
}

class SpaceStoreError extends Error {
  constructor(message, code, status = 400, details = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function rowToSpace(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    icon: row.icon,
    status: row.status,
    sort_order: row.sort_order,
    visible_to_roles_json: row.visible_to_roles_json || [],
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToLaunchEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    template_id: row.template_id,
    template_version_id: row.template_version_id,
    space_key: row.space_key,
    label: row.label,
    description: row.description,
    icon: row.icon,
    route_type: row.route_type,
    route_target: row.route_target,
    quick_action_enabled: row.quick_action_enabled,
    visible_to_roles_json: row.visible_to_roles_json || [],
    status: row.status,
    sort_order: row.sort_order,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    template_key: row.template_key || null,
    template_name: row.template_name || null,
  };
}

async function ensureDefaultSpaces() {
  await pool.query(`
    INSERT INTO app_spaces (key, label, description, icon, status, sort_order, visible_to_roles_json)
    VALUES
      ('forms', 'Forms', 'Form templates and quick form launches', 'form', 'active', 10, '["requester","employee","manager","admin","hub_admin"]'::jsonb),
      ('documents', 'Documents', 'Document-backed workflows and uploads', 'document', 'active', 20, '["requester","employee","manager","admin","hub_admin"]'::jsonb),
      ('workflows', 'Workflows', 'Operational workflow templates', 'workflow', 'active', 30, '["manager","admin","hub_admin"]'::jsonb),
      ('operations', 'Operations', 'Operations team launch area', 'operations', 'active', 40, '["manager","operations","admin","hub_admin"]'::jsonb),
      ('admin', 'Admin', 'Administrative launch area', 'admin', 'active', 50, '["admin","hub_admin"]'::jsonb)
    ON CONFLICT (key) DO NOTHING
  `);
}

async function listSpaces({ includeArchived = false } = {}) {
  await ensureDefaultSpaces();
  const r = await pool.query(
    `SELECT * FROM app_spaces
     WHERE ($1::boolean OR status = 'active')
     ORDER BY sort_order ASC, label ASC`,
    [includeArchived]
  );
  return r.rows.map(rowToSpace);
}

async function getSpaceByKey(key) {
  const r = await pool.query('SELECT * FROM app_spaces WHERE key = $1 LIMIT 1', [key]);
  return rowToSpace(r.rows[0]);
}

async function createSpace(input, actor = null) {
  const norm = normalizeSpaceInput(input);
  const existing = await getSpaceByKey(norm.key);
  if (existing) {
    throw new SpaceStoreError(`Space key already exists: ${norm.key}`, 'DUPLICATE_KEY', 409);
  }
  const r = await pool.query(
    `INSERT INTO app_spaces
       (key, label, description, icon, status, sort_order, visible_to_roles_json, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, now(), now())
     RETURNING *`,
    [
      norm.key,
      norm.label,
      norm.description,
      norm.icon,
      norm.status,
      norm.sort_order,
      jsonb(norm.visible_to_roles_json),
      actor,
    ]
  );
  return rowToSpace(r.rows[0]);
}

async function updateSpace(key, patch, actor = null) {
  const current = await getSpaceByKey(key);
  if (!current) throw new SpaceStoreError('Space not found', 'NOT_FOUND', 404);
  const norm = normalizeSpaceInput(patch, current);
  const r = await pool.query(
    `UPDATE app_spaces
     SET label = $2,
         description = $3,
         icon = $4,
         status = $5,
         sort_order = $6,
         visible_to_roles_json = $7::jsonb,
         updated_at = now()
     WHERE key = $1
     RETURNING *`,
    [
      key,
      norm.label,
      norm.description,
      norm.icon,
      norm.status,
      norm.sort_order,
      jsonb(norm.visible_to_roles_json),
    ]
  );
  return rowToSpace(r.rows[0]);
}

async function archiveSpace(key, actor = null) {
  const r = await pool.query(
    `UPDATE app_spaces SET status = 'archived', updated_at = now()
     WHERE key = $1 AND status = 'active'
     RETURNING *`,
    [key]
  );
  if (!r.rowCount) throw new SpaceStoreError('Space not found or already archived', 'NOT_FOUND', 404);
  return rowToSpace(r.rows[0]);
}

async function listLaunchEntriesForSpace(spaceKey, { includeHidden = true } = {}) {
  const r = await pool.query(
    `SELECT e.*, t.key AS template_key, t.name AS template_name
     FROM template_launch_entries e
     JOIN form_templates t ON t.id = e.template_id
     WHERE e.space_key = $1
       AND ($2::boolean OR e.status = 'active')
     ORDER BY e.sort_order ASC, e.label ASC`,
    [spaceKey, includeHidden]
  );
  return r.rows.map(rowToLaunchEntry);
}

async function listAllLaunchEntries({ includeHidden = true } = {}) {
  const r = await pool.query(
    `SELECT e.*, t.key AS template_key, t.name AS template_name
     FROM template_launch_entries e
     JOIN form_templates t ON t.id = e.template_id
     ORDER BY e.space_key ASC, e.sort_order ASC, e.label ASC`
  );
  return r.rows
    .map(rowToLaunchEntry)
    .filter((e) => includeHidden || e.status === 'active');
}

async function getLaunchEntry(id) {
  const r = await pool.query(
    `SELECT e.*, t.key AS template_key, t.name AS template_name
     FROM template_launch_entries e
     JOIN form_templates t ON t.id = e.template_id
     WHERE e.id = $1 LIMIT 1`,
    [id]
  );
  return rowToLaunchEntry(r.rows[0]);
}

async function getLaunchEntryForTemplate(templateId, spaceKey = null) {
  if (spaceKey) {
    const r = await pool.query(
      `SELECT * FROM template_launch_entries WHERE template_id = $1 AND space_key = $2 LIMIT 1`,
      [templateId, spaceKey]
    );
    return rowToLaunchEntry(r.rows[0]);
  }
  const r = await pool.query(
    `SELECT * FROM template_launch_entries WHERE template_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [templateId]
  );
  return rowToLaunchEntry(r.rows[0]);
}

async function updateLaunchEntry(id, patch, actor = null) {
  const current = await getLaunchEntry(id);
  if (!current) throw new SpaceStoreError('Launch entry not found', 'NOT_FOUND', 404);
  const label = patch.label != null ? String(patch.label).trim() : current.label;
  const description =
    patch.description != null ? String(patch.description).trim() || null : current.description;
  const icon = patch.icon != null ? String(patch.icon).trim() || null : current.icon;
  const sort_order = patch.sort_order != null ? Number(patch.sort_order) : current.sort_order;
  const quick_action_enabled =
    patch.quick_action_enabled != null ? !!patch.quick_action_enabled : current.quick_action_enabled;
  const visible_to_roles_json =
    patch.visible_to_roles != null
      ? normalizeLaunchConfig({ visible_to_roles: patch.visible_to_roles }).visible_to_roles
      : current.visible_to_roles_json;
  const status = ['active', 'hidden', 'archived'].includes(patch.status)
    ? patch.status
    : current.status;
  const route_type = patch.route_type || current.route_type;
  const r = await pool.query(
    `UPDATE template_launch_entries
     SET label = $2,
         description = $3,
         icon = $4,
         sort_order = $5,
         quick_action_enabled = $6,
         visible_to_roles_json = $7::jsonb,
         status = $8,
         route_type = $9,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      label,
      description,
      icon,
      sort_order,
      quick_action_enabled,
      jsonb(visible_to_roles_json),
      status,
      route_type,
    ]
  );
  return rowToLaunchEntry(r.rows[0]);
}

async function setLaunchEntryStatus(id, status) {
  const r = await pool.query(
    `UPDATE template_launch_entries SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, status]
  );
  if (!r.rowCount) throw new SpaceStoreError('Launch entry not found', 'NOT_FOUND', 404);
  return rowToLaunchEntry(r.rows[0]);
}

async function updateTemplateLaunchConfig(templateId, configPatch, actor = null) {
  const tplRes = await pool.query('SELECT * FROM form_templates WHERE id = $1 LIMIT 1', [templateId]);
  if (!tplRes.rows[0]) throw new SpaceStoreError('Template not found', 'NOT_FOUND', 404);
  const template = tplRes.rows[0];
  const launch_config_json = normalizeLaunchConfig(configPatch, {
    launch_config_json: template.launch_config_json,
  });
  const r = await pool.query(
    `UPDATE form_templates SET launch_config_json = $2::jsonb, updated_at = now() WHERE id = $1 RETURNING *`,
    [templateId, jsonb(launch_config_json)]
  );
  return {
    template_id: templateId,
    launch_config: launch_config_json,
  };
}

async function getTemplateLaunchConfig(templateId) {
  const r = await pool.query(
    'SELECT id, key, name, launch_config_json FROM form_templates WHERE id = $1 LIMIT 1',
    [templateId]
  );
  if (!r.rows[0]) throw new SpaceStoreError('Template not found', 'NOT_FOUND', 404);
  return {
    template_id: r.rows[0].id,
    template_key: r.rows[0].key,
    launch_config: r.rows[0].launch_config_json || {},
  };
}

/**
 * Called inside publish transaction — activates or creates launch entry.
 */
async function syncLaunchEntryOnPublish(client, { template, publishedVersion, actor = null }) {
  await client.query(`
    INSERT INTO app_spaces (key, label, description, icon, status, sort_order, visible_to_roles_json)
    VALUES
      ('forms', 'Forms', 'Form templates and quick form launches', 'form', 'active', 10, '["requester","employee","manager","admin","hub_admin"]'::jsonb),
      ('documents', 'Documents', 'Document-backed workflows and uploads', 'document', 'active', 20, '["requester","employee","manager","admin","hub_admin"]'::jsonb),
      ('workflows', 'Workflows', 'Operational workflow templates', 'workflow', 'active', 30, '["manager","admin","hub_admin"]'::jsonb),
      ('operations', 'Operations', 'Operations team launch area', 'operations', 'active', 40, '["manager","operations","admin","hub_admin"]'::jsonb),
      ('admin', 'Admin', 'Administrative launch area', 'admin', 'active', 50, '["admin","hub_admin"]'::jsonb)
    ON CONFLICT (key) DO NOTHING
  `);

  const launchConfig = normalizeLaunchConfig(template.launch_config_json || {}, template);
  if (!launchConfig.enabled) return null;

  const spaceKey = launchConfig.space_key || inferDefaultSpaceKey(template);
  const spaceCheck = await client.query(
    'SELECT key FROM app_spaces WHERE key = $1 AND status = $2 LIMIT 1',
    [spaceKey, 'active']
  );
  if (!spaceCheck.rowCount) {
    throw new SpaceStoreError(`App space not found or archived: ${spaceKey}`, 'SPACE_NOT_FOUND', 400);
  }

  const label = launchConfig.label || template.name;
  const description = launchConfig.description || template.description;
  const icon = launchConfig.icon;
  const routeType = launchConfig.route_type || 'template_runtime_placeholder';
  const routeTarget = publishedVersion.id;
  const visibleRoles = launchConfig.visible_to_roles;
  const sortOrder = launchConfig.sort_order || 0;
  const quickAction = launchConfig.quick_action_enabled;

  const existing = await client.query(
    'SELECT id FROM template_launch_entries WHERE template_id = $1 AND space_key = $2 LIMIT 1',
    [template.id, spaceKey]
  );

  if (existing.rowCount) {
    const upd = await client.query(
      `UPDATE template_launch_entries
       SET template_version_id = $2,
           label = $3,
           description = $4,
           icon = $5,
           route_type = $6,
           route_target = $7,
           quick_action_enabled = $8,
           visible_to_roles_json = $9::jsonb,
           sort_order = $10,
           status = 'active',
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        existing.rows[0].id,
        publishedVersion.id,
        label,
        description,
        icon,
        routeType,
        routeTarget,
        quickAction,
        jsonb(visibleRoles),
        sortOrder,
      ]
    );
    return rowToLaunchEntry(upd.rows[0]);
  }

  const ins = await client.query(
    `INSERT INTO template_launch_entries
       (template_id, template_version_id, space_key, label, description, icon,
        route_type, route_target, quick_action_enabled, visible_to_roles_json,
        status, sort_order, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, 'active', $11, $12, now(), now())
     RETURNING *`,
    [
      template.id,
      publishedVersion.id,
      spaceKey,
      label,
      description,
      icon,
      routeType,
      routeTarget,
      quickAction,
      jsonb(visibleRoles),
      sortOrder,
      actor,
    ]
  );
  return rowToLaunchEntry(ins.rows[0]);
}

async function hideLaunchEntriesForTemplate(clientOrPool, templateId) {
  const q = clientOrPool.query.bind(clientOrPool);
  await q(
    `UPDATE template_launch_entries
     SET status = 'archived', updated_at = now()
     WHERE template_id = $1 AND status != 'archived'`,
    [templateId]
  );
}

async function repointLaunchEntriesAfterRetire(templateId, retiredVersionId) {
  const tpl = await pool.query(
    'SELECT current_published_version_id FROM form_templates WHERE id = $1',
    [templateId]
  );
  const currentPub = tpl.rows[0]?.current_published_version_id;
  if (currentPub) {
    await pool.query(
      `UPDATE template_launch_entries
       SET template_version_id = $2, route_target = $3, updated_at = now()
       WHERE template_id = $1 AND template_version_id = $4 AND status = 'active'`,
      [templateId, currentPub, currentPub, retiredVersionId]
    );
  } else {
    await pool.query(
      `UPDATE template_launch_entries
       SET status = 'hidden', updated_at = now()
       WHERE template_id = $1 AND template_version_id = $2`,
      [templateId, retiredVersionId]
    );
  }
}

async function getLaunchRegistry(permissions, isAdmin, actorEmail = null) {
  await ensureDefaultSpaces();
  let assignedRoleKeys = [];
  if (actorEmail) {
    try {
      const rbacPostgres = require('../rbac/postgres');
      if (rbacPostgres.isAvailable()) {
        assignedRoleKeys = await rbacPostgres.getUserRoleKeys(actorEmail);
      }
    } catch {
      assignedRoleKeys = [];
    }
  }
  const spaces = await listSpaces({ includeArchived: false });
  const entries = await listAllLaunchEntries({ includeHidden: false });
  const activeEntries = entries.filter((e) => e.status === 'active');

  const bySpace = {};
  for (const space of spaces) {
    if (!rolesCanSee(space.visible_to_roles_json, permissions, isAdmin, assignedRoleKeys)) continue;
    const spaceEntries = activeEntries
      .filter((e) => e.space_key === space.key)
      .filter((e) => rolesCanSee(e.visible_to_roles_json, permissions, isAdmin, assignedRoleKeys))
      .map((e) => ({
        id: e.id,
        template_id: e.template_id,
        template_key: e.template_key,
        label: e.label,
        description: e.description,
        icon: e.icon,
        route_type: e.route_type,
        route_target: e.route_target,
        quick_action_enabled: e.quick_action_enabled,
        sort_order: e.sort_order,
      }));
    if (spaceEntries.length || isAdmin) {
      bySpace[space.key] = {
        ...space,
        entries: spaceEntries,
      };
    }
  }

  return {
    spaces: Object.values(bySpace).sort((a, b) => a.sort_order - b.sort_order),
  };
}

async function healthCheck() {
  try {
    const r = await pool.query(`SELECT to_regclass('public.app_spaces') AS reg`);
    return { ok: !!r.rows[0]?.reg, table: 'app_spaces' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function deleteLaunchDataForTemplateTest(templateId) {
  await pool.query('DELETE FROM template_launch_entries WHERE template_id = $1', [templateId]);
}

module.exports = {
  SpaceStoreError,
  pool,
  healthCheck,
  ensureDefaultSpaces,
  listSpaces,
  getSpaceByKey,
  createSpace,
  updateSpace,
  archiveSpace,
  listLaunchEntriesForSpace,
  listAllLaunchEntries,
  getLaunchEntry,
  getLaunchEntryForTemplate,
  updateLaunchEntry,
  setLaunchEntryStatus,
  updateTemplateLaunchConfig,
  getTemplateLaunchConfig,
  syncLaunchEntryOnPublish,
  hideLaunchEntriesForTemplate,
  repointLaunchEntriesAfterRetire,
  getLaunchRegistry,
  deleteLaunchDataForTemplateTest,
};
