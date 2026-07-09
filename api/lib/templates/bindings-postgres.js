/**
 * WOS-60 — Optional workflow binding store.
 */
const { Pool } = require('pg');
const { resolvePgSsl } = require('../hub/db/pg-ssl');
const { inferTemplateKind, isBindableKind, isWorkflowKind } = require('./template-kind');

function storeError(message, code, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: resolvePgSsl(process.env.DATABASE_URL),
});

const BINDING_MODES = new Set(['none', 'optional', 'required']);
const BINDING_STATUSES = new Set(['active', 'inactive', 'archived']);

function rowToBinding(row) {
  if (!row) return null;
  return {
    id: row.id,
    source_template_id: row.source_template_id,
    source_template_version_id: row.source_template_version_id,
    source_space_key: row.source_space_key,
    workflow_template_id: row.workflow_template_id,
    workflow_template_version_id: row.workflow_template_version_id,
    binding_status: row.binding_status,
    binding_mode: row.binding_mode,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at,
    workflow_template_name: row.workflow_template_name || null,
    workflow_template_key: row.workflow_template_key || null,
    workflow_version_number: row.workflow_version_number || null,
    used_by_count: row.used_by_count != null ? Number(row.used_by_count) : undefined,
  };
}

async function getTemplateRow(idOrKey) {
  const isUuid = /^[0-9a-f-]{36}$/i.test(String(idOrKey));
  const r = await pool.query(
    isUuid
      ? 'SELECT * FROM form_templates WHERE id = $1 LIMIT 1'
      : 'SELECT * FROM form_templates WHERE key = $1 LIMIT 1',
    [idOrKey]
  );
  return r.rows[0] || null;
}

async function getActiveBinding(sourceTemplateId) {
  const r = await pool.query(
    `SELECT b.*,
            wt.name AS workflow_template_name,
            wt.key AS workflow_template_key,
            wv.version_number AS workflow_version_number
     FROM template_bindings b
     LEFT JOIN form_templates wt ON wt.id = b.workflow_template_id
     LEFT JOIN form_template_versions wv ON wv.id = b.workflow_template_version_id
     WHERE b.source_template_id = $1
       AND b.binding_status = 'active'
       AND b.archived_at IS NULL
     ORDER BY b.updated_at DESC
     LIMIT 1`,
    [sourceTemplateId]
  );
  return rowToBinding(r.rows[0]);
}

async function archiveActiveBindings(client, sourceTemplateId) {
  await client.query(
    `UPDATE template_bindings
     SET binding_status = 'archived',
         archived_at = now(),
         updated_at = now()
     WHERE source_template_id = $1
       AND binding_status = 'active'
       AND archived_at IS NULL`,
    [sourceTemplateId]
  );
}

async function upsertTemplateBinding(sourceTemplateId, payload = {}, actor = null) {
  const source = await getTemplateRow(sourceTemplateId);
  if (!source) throw storeError('Source template not found', 'NOT_FOUND', 404);
  const sourceKind = inferTemplateKind(source);
  if (!isBindableKind(sourceKind)) {
    throw storeError(
      'Only form, document, checklist, and inspection templates support workflow binding',
      'INVALID_KIND',
      400
    );
  }

  const mode = BINDING_MODES.has(payload.binding_mode) ? payload.binding_mode : 'none';
  const workflowTemplateId = payload.workflow_template_id || null;

  if (mode === 'none' || !workflowTemplateId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await archiveActiveBindings(client, source.id);
      await client.query('COMMIT');
      return { binding: null, binding_mode: 'none' };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  const workflowTpl = await getTemplateRow(workflowTemplateId);
  if (!workflowTpl) throw storeError('Workflow template not found', 'NOT_FOUND', 404);
  const workflowKind = inferTemplateKind(workflowTpl);
  if (!isWorkflowKind(workflowKind)) {
    throw storeError('Bound template must be template_kind workflow', 'INVALID_WORKFLOW', 400);
  }
  if (!workflowTpl.current_published_version_id) {
    throw storeError('Workflow template must be published before binding', 'NO_PUBLISHED', 409);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await archiveActiveBindings(client, source.id);
    const r = await client.query(
      `INSERT INTO template_bindings (
         source_template_id,
         source_template_version_id,
         source_space_key,
         workflow_template_id,
         workflow_template_version_id,
         binding_status,
         binding_mode,
         created_by,
         created_at,
         updated_at
       ) VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, now(), now())
       RETURNING *`,
      [
        source.id,
        payload.source_template_version_id || null,
        payload.source_space_key || source.launch_config_json?.space_key || null,
        workflowTpl.id,
        workflowTpl.current_published_version_id,
        mode,
        actor,
      ]
    );
    await client.query('COMMIT');
    const binding = await getActiveBinding(source.id);
    return { binding, binding_mode: mode };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function deleteTemplateBinding(sourceTemplateId, actor = null) {
  return upsertTemplateBinding(sourceTemplateId, { binding_mode: 'none' }, actor);
}

async function listPublishedWorkflowTemplates() {
  const r = await pool.query(
    `SELECT t.*,
            pv.id AS published_version_id,
            pv.version_number AS published_version_number,
            COALESCE(bc.used_by_count, 0) AS used_by_count
     FROM form_templates t
     INNER JOIN form_template_versions pv ON pv.id = t.current_published_version_id
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS used_by_count
       FROM template_bindings b
       WHERE b.workflow_template_id = t.id
         AND b.binding_status = 'active'
         AND b.archived_at IS NULL
     ) bc ON true
     WHERE t.status = 'active'
       AND COALESCE(t.template_kind, 'workflow') = 'workflow'
     ORDER BY t.name ASC`
  );
  return r.rows.map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    template_kind: row.template_kind || 'workflow',
    published_version_id: row.published_version_id,
    published_version_number: row.published_version_number,
    used_by_count: Number(row.used_by_count || 0),
  }));
}

async function deleteBindingsForTemplateTest(templateId) {
  await pool.query('DELETE FROM template_bindings WHERE source_template_id = $1 OR workflow_template_id = $1', [
    templateId,
  ]);
}

module.exports = {
  BINDING_MODES,
  getActiveBinding,
  upsertTemplateBinding,
  deleteTemplateBinding,
  listPublishedWorkflowTemplates,
  deleteBindingsForTemplateTest,
};
