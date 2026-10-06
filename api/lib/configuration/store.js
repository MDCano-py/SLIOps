/**
 * WOS-93 configuration store (Postgres).
 */

const { Pool } = require('pg');
const { resolvePgSsl } = require('../hub/db/pg-ssl');
const { validateDefinitionPayload } = require('./validation');
const { sanitizeHtml, safeKey, stripControlChars } = require('./sanitize');
const { LIMITS } = require('./limits');

let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: resolvePgSsl(process.env.DATABASE_URL),
    });
  }
  return pool;
}

function isPostgresMode() {
  return String(process.env.HUB_STORE_MODE || '').toLowerCase() === 'postgres' && !!process.env.DATABASE_URL;
}

function assertPostgres() {
  if (!isPostgresMode()) {
    const err = new Error('Configurable platform requires HUB_STORE_MODE=postgres and DATABASE_URL');
    err.status = 503;
    err.code = 'POSTGRES_REQUIRED';
    throw err;
  }
}

async function writeAudit(client, event) {
  await client.query(
    `INSERT INTO cfg_audit_events
      (organization_id, actor_email, action, definition_kind, definition_id, version_id, before_summary, after_summary, meta_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb)`,
    [
      event.organization_id || null,
      event.actor_email || null,
      event.action,
      event.definition_kind || null,
      event.definition_id || null,
      event.version_id || null,
      JSON.stringify(event.before_summary || null),
      JSON.stringify(event.after_summary || null),
      JSON.stringify(event.meta_json || {}),
    ]
  );
}

async function listDefinitions({ kind, status } = {}) {
  assertPostgres();
  const pool = getPool();
  const params = [];
  const where = [];
  if (kind) {
    params.push(kind);
    where.push(`kind = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  const sql = `
    SELECT d.*,
      pv.version_number AS published_version_number,
      dv.version_number AS draft_version_number,
      dv.revision AS draft_revision
    FROM cfg_definitions d
    LEFT JOIN cfg_versions pv ON pv.id = d.current_published_version_id
    LEFT JOIN cfg_versions dv ON dv.id = d.current_draft_version_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY d.updated_at DESC
    LIMIT 500`;
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function getDefinition(id) {
  assertPostgres();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT d.*,
      row_to_json(pv.*) AS published_version,
      row_to_json(dv.*) AS draft_version
     FROM cfg_definitions d
     LEFT JOIN cfg_versions pv ON pv.id = d.current_published_version_id
     LEFT JOIN cfg_versions dv ON dv.id = d.current_draft_version_id
     WHERE d.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function createDraftDefinition({ kind, key, name, description, payload, actorEmail }) {
  assertPostgres();
  const cleanKey = safeKey(key);
  if (!cleanKey) {
    const err = new Error('key is required');
    err.status = 400;
    err.code = 'KEY_REQUIRED';
    throw err;
  }
  const validation = validateDefinitionPayload(kind, payload || {});
  if (!validation.ok) {
    const err = new Error('Validation failed');
    err.status = 400;
    err.code = 'VALIDATION_FAILED';
    err.details = validation.issues;
    throw err;
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const defIns = await client.query(
      `INSERT INTO cfg_definitions (kind, key, name, description, status, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'draft',$5,$5)
       RETURNING *`,
      [kind, cleanKey, stripControlChars(name || cleanKey).slice(0, LIMITS.MAX_LABEL_LENGTH), stripControlChars(description || ''), actorEmail || null]
    );
    const def = defIns.rows[0];
    const verIns = await client.query(
      `INSERT INTO cfg_versions (definition_id, status, revision, payload_json, validation_json, created_by)
       VALUES ($1,'draft',1,$2::jsonb,$3::jsonb,$4)
       RETURNING *`,
      [def.id, JSON.stringify(validation.normalized), JSON.stringify({ issues: validation.issues }), actorEmail || null]
    );
    const ver = verIns.rows[0];
    await client.query(
      `UPDATE cfg_definitions SET current_draft_version_id = $2, updated_at = now(), updated_by = $3 WHERE id = $1`,
      [def.id, ver.id, actorEmail || null]
    );
    await writeAudit(client, {
      actor_email: actorEmail,
      action: 'definition.create_draft',
      definition_kind: kind,
      definition_id: def.id,
      version_id: ver.id,
      after_summary: { key: cleanKey, name: def.name },
    });
    await client.query('COMMIT');
    return getDefinition(def.id);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      const e = new Error('Definition key already exists for this kind');
      e.status = 409;
      e.code = 'DUPLICATE_KEY';
      throw e;
    }
    throw err;
  } finally {
    client.release();
  }
}

async function updateDraftVersion({ definitionId, expectedRevision, payload, actorEmail }) {
  assertPostgres();
  const def = await getDefinition(definitionId);
  if (!def) {
    const err = new Error('Definition not found');
    err.status = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (!def.current_draft_version_id || !def.draft_version) {
    const err = new Error('No draft version to update');
    err.status = 409;
    err.code = 'NO_DRAFT';
    throw err;
  }
  if (def.draft_version.status !== 'draft') {
    const err = new Error('Only draft versions can be edited');
    err.status = 409;
    err.code = 'IMMUTABLE';
    throw err;
  }
  if (expectedRevision != null && Number(expectedRevision) !== Number(def.draft_version.revision)) {
    const err = new Error('Draft was modified by another administrator');
    err.status = 409;
    err.code = 'CONFLICT';
    err.details = { current_revision: def.draft_version.revision };
    throw err;
  }
  const validation = validateDefinitionPayload(def.kind, payload || {});
  if (!validation.ok) {
    const err = new Error('Validation failed');
    err.status = 400;
    err.code = 'VALIDATION_FAILED';
    err.details = validation.issues;
    throw err;
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE cfg_versions
       SET payload_json = $2::jsonb,
           validation_json = $3::jsonb,
           revision = revision + 1,
           updated_at = now()
       WHERE id = $1 AND status = 'draft'
       RETURNING *`,
      [def.current_draft_version_id, JSON.stringify(validation.normalized), JSON.stringify({ issues: validation.issues })]
    );
    if (!rows[0]) {
      const err = new Error('Published versions cannot be edited');
      err.status = 409;
      err.code = 'IMMUTABLE';
      throw err;
    }
    await client.query(
      `UPDATE cfg_definitions SET updated_at = now(), updated_by = $2 WHERE id = $1`,
      [definitionId, actorEmail || null]
    );
    await writeAudit(client, {
      actor_email: actorEmail,
      action: 'definition.update_draft',
      definition_kind: def.kind,
      definition_id: definitionId,
      version_id: rows[0].id,
      after_summary: { revision: rows[0].revision },
    });
    await client.query('COMMIT');
    return getDefinition(definitionId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function publishDefinition({ definitionId, actorEmail, acknowledgeWarnings }) {
  assertPostgres();
  const def = await getDefinition(definitionId);
  if (!def || !def.draft_version) {
    const err = new Error('Draft not found');
    err.status = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }
  const validation = validateDefinitionPayload(def.kind, def.draft_version.payload_json || {});
  if (!validation.ok) {
    const err = new Error('Cannot publish: validation errors');
    err.status = 400;
    err.code = 'VALIDATION_FAILED';
    err.details = validation.issues;
    throw err;
  }
  const warnings = validation.issues.filter((i) => i.severity === 'warning');
  if (warnings.length && !acknowledgeWarnings) {
    const err = new Error('Publish blocked by warnings; acknowledge to continue');
    err.status = 400;
    err.code = 'WARNINGS_PRESENT';
    err.details = warnings;
    throw err;
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const nextNumRes = await client.query(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS n FROM cfg_versions WHERE definition_id = $1 AND version_number IS NOT NULL`,
      [definitionId]
    );
    const versionNumber = nextNumRes.rows[0].n;
    const { rows } = await client.query(
      `UPDATE cfg_versions
       SET status = 'published',
           version_number = $2,
           payload_json = $3::jsonb,
           validation_json = $4::jsonb,
           published_at = now(),
           published_by = $5,
           updated_at = now()
       WHERE id = $1 AND status = 'draft'
       RETURNING *`,
      [
        def.current_draft_version_id,
        versionNumber,
        JSON.stringify(validation.normalized),
        JSON.stringify({ issues: validation.issues }),
        actorEmail || null,
      ]
    );
    if (!rows[0]) {
      const err = new Error('Draft missing or already published');
      err.status = 409;
      err.code = 'PUBLISH_CONFLICT';
      throw err;
    }
    const published = rows[0];
    // Create new empty draft based on published payload for future edits
    const draftIns = await client.query(
      `INSERT INTO cfg_versions (definition_id, status, revision, payload_json, validation_json, created_by)
       VALUES ($1,'draft',1,$2::jsonb,$3::jsonb,$4)
       RETURNING *`,
      [definitionId, JSON.stringify(validation.normalized), JSON.stringify({ issues: [] }), actorEmail || null]
    );
    await client.query(
      `UPDATE cfg_definitions
       SET status = 'published',
           current_published_version_id = $2,
           current_draft_version_id = $3,
           updated_at = now(),
           updated_by = $4
       WHERE id = $1`,
      [definitionId, published.id, draftIns.rows[0].id, actorEmail || null]
    );
    await writeAudit(client, {
      actor_email: actorEmail,
      action: 'definition.publish',
      definition_kind: def.kind,
      definition_id: definitionId,
      version_id: published.id,
      after_summary: { version_number: versionNumber },
    });
    await client.query('COMMIT');
    return getDefinition(definitionId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function archiveDefinition({ definitionId, actorEmail }) {
  assertPostgres();
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE cfg_definitions
       SET status = 'archived', archived_at = now(), updated_at = now(), updated_by = $2
       WHERE id = $1
       RETURNING *`,
      [definitionId, actorEmail || null]
    );
    if (!rows[0]) {
      const err = new Error('Definition not found');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }
    await writeAudit(client, {
      actor_email: actorEmail,
      action: 'definition.archive',
      definition_kind: rows[0].kind,
      definition_id: definitionId,
    });
    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function duplicateDefinition({ definitionId, actorEmail, newKey }) {
  const def = await getDefinition(definitionId);
  if (!def) {
    const err = new Error('Definition not found');
    err.status = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }
  const sourcePayload =
    (def.draft_version && def.draft_version.payload_json) ||
    (def.published_version && def.published_version.payload_json) ||
    {};
  return createDraftDefinition({
    kind: def.kind,
    key: newKey || `${def.key}_copy`,
    name: `${def.name} (copy)`,
    description: def.description,
    payload: sourcePayload,
    actorEmail,
  });
}

async function listVersionHistory(definitionId) {
  assertPostgres();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, definition_id, version_number, status, revision, created_by, published_by, created_at, updated_at, published_at
     FROM cfg_versions
     WHERE definition_id = $1
     ORDER BY COALESCE(version_number, 0) DESC, created_at DESC`,
    [definitionId]
  );
  return rows;
}

async function listAuditEvents({ definitionId, limit = 100 } = {}) {
  assertPostgres();
  const pool = getPool();
  if (definitionId) {
    const { rows } = await pool.query(
      `SELECT * FROM cfg_audit_events WHERE definition_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [definitionId, Math.min(Number(limit) || 100, 500)]
    );
    return rows;
  }
  const { rows } = await pool.query(
    `SELECT * FROM cfg_audit_events ORDER BY created_at DESC LIMIT $1`,
    [Math.min(Number(limit) || 100, 500)]
  );
  return rows;
}

async function upsertVariable(input, actorEmail) {
  assertPostgres();
  const { validateCustomVariable } = require('./variables/validation');
  const result = validateCustomVariable(input);
  if (!result.ok) {
    const err = new Error('Invalid variable');
    err.status = 400;
    err.code = 'VALIDATION_FAILED';
    err.details = result.issues;
    throw err;
  }
  const v = result.normalized;
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO cfg_variable_definitions (key, label, description, value_type, value_json, sensitive, active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$8)
     ON CONFLICT (key) DO UPDATE SET
       label = EXCLUDED.label,
       description = EXCLUDED.description,
       value_type = EXCLUDED.value_type,
       value_json = EXCLUDED.value_json,
       sensitive = EXCLUDED.sensitive,
       active = EXCLUDED.active,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()
     RETURNING *`,
    [v.key, v.label, v.description, v.type, JSON.stringify(v.value), v.sensitive, v.active, actorEmail || null]
  );
  return rows[0];
}

async function listVariables({ includeSensitive = false } = {}) {
  assertPostgres();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, key, label, description, value_type, value_json, sensitive, active, updated_at
     FROM cfg_variable_definitions
     WHERE active = true
     ORDER BY key ASC`
  );
  return rows.map((r) => {
    if (r.sensitive && !includeSensitive) {
      return { ...r, value_json: null, value_redacted: true };
    }
    return r;
  });
}

async function getCustomVariableMap() {
  const rows = await listVariables({ includeSensitive: true });
  const map = {};
  for (const r of rows) {
    map[r.key] = { value: r.value_json, sensitive: r.sensitive, type: r.value_type };
  }
  return map;
}

module.exports = {
  isPostgresMode,
  assertPostgres,
  listDefinitions,
  getDefinition,
  createDraftDefinition,
  updateDraftVersion,
  publishDefinition,
  archiveDefinition,
  duplicateDefinition,
  listVersionHistory,
  listAuditEvents,
  upsertVariable,
  listVariables,
  getCustomVariableMap,
  writeAudit,
  sanitizeHtml,
};
