/**
 * WOS-55 — Form template versioning Postgres store.
 */
const { Pool } = require('pg');
const { resolvePgSsl } = require('../hub/db/pg-ssl');
const { compileTemplateVersion } = require('./compile-workflow');
const { validateTemplateVersion } = require('./validator');
const { normalizeSchemaJson } = require('./schema-normalize');
const { inferTemplateKind, normalizeTemplateKind, kindForSpace } = require('./template-kind');
const { syncLaunchEntryOnPublish, hideLaunchEntriesForTemplate, repointLaunchEntriesAfterRetire, getLaunchEntry } = require('../spaces/postgres');
const { getActiveBinding } = require('./bindings-postgres');
const { validateSubmissionData } = require('./runtime-validate');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: resolvePgSsl(process.env.DATABASE_URL),
});

function jsonb(val) {
  if (val === undefined || val === null) return null;
  return JSON.stringify(val);
}

function rowToTemplate(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    status: row.status,
    current_published_version_id: row.current_published_version_id,
    launch_config_json: row.launch_config_json || {},
    template_kind: row.template_kind || inferTemplateKind(row),
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at,
  };
}

function rowToVersion(row) {
  if (!row) return null;
  return {
    id: row.id,
    template_id: row.template_id,
    version_number: row.version_number,
    status: row.status,
    schema_json: row.schema_json,
    workflow_json: row.workflow_json,
    validation_json: row.validation_json,
    compiled_workflow_json: row.compiled_workflow_json,
    template_kind: row.template_kind || null,
    created_by: row.created_by,
    created_at: row.created_at,
    published_at: row.published_at,
    published_by: row.published_by,
    retired_at: row.retired_at,
  };
}

function rowToSubmission(row) {
  if (!row) return null;
  return {
    id: row.id,
    template_version_id: row.template_version_id,
    data_json: row.data_json,
    status: row.status,
    current_step_index: row.current_step_index,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToStepInstance(row) {
  if (!row) return null;
  return {
    id: row.id,
    submission_id: row.submission_id,
    step_index: row.step_index,
    step_type: row.step_type,
    assignee_role: row.assignee_role,
    status: row.status,
    acted_by: row.acted_by,
    acted_at: row.acted_at,
    payload_json: row.payload_json,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

class TemplateStoreError extends Error {
  constructor(message, code, status = 400, details = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function getTemplate(idOrKey) {
  const isUuid = /^[0-9a-f-]{36}$/i.test(String(idOrKey));
  const r = await pool.query(
    isUuid
      ? 'SELECT * FROM form_templates WHERE id = $1 LIMIT 1'
      : 'SELECT * FROM form_templates WHERE key = $1 LIMIT 1',
    [idOrKey]
  );
  return rowToTemplate(r.rows[0]);
}

async function getVersion(versionId) {
  const r = await pool.query('SELECT * FROM form_template_versions WHERE id = $1 LIMIT 1', [versionId]);
  return rowToVersion(r.rows[0]);
}

async function getLatestDraftVersion(templateId) {
  const r = await pool.query(
    `SELECT * FROM form_template_versions
     WHERE template_id = $1 AND status = 'draft'
     ORDER BY created_at DESC
     LIMIT 1`,
    [templateId]
  );
  return rowToVersion(r.rows[0]);
}

async function getCurrentPublishedVersion(templateId) {
  const tpl = await getTemplate(templateId);
  if (!tpl?.current_published_version_id) return null;
  return getVersion(tpl.current_published_version_id);
}

async function listTemplates() {
  const r = await pool.query(
    `SELECT
       t.*,
       dv.id AS latest_draft_id,
       dv.status AS latest_draft_status,
       dv.created_at AS latest_draft_created_at,
       pv.version_number AS published_version_number,
       pv.status AS published_version_status,
       pv.published_at AS published_at,
       pv.workflow_json AS published_workflow_json,
       b.binding_mode AS workflow_binding_mode,
       b.workflow_template_id AS workflow_binding_template_id,
       wt.name AS workflow_binding_name
     FROM form_templates t
     LEFT JOIN LATERAL (
       SELECT id, status, created_at
       FROM form_template_versions
       WHERE template_id = t.id AND status = 'draft'
       ORDER BY created_at DESC
       LIMIT 1
     ) dv ON true
     LEFT JOIN form_template_versions pv ON pv.id = t.current_published_version_id
     LEFT JOIN LATERAL (
       SELECT binding_mode, workflow_template_id
       FROM template_bindings
       WHERE source_template_id = t.id
         AND binding_status = 'active'
         AND archived_at IS NULL
       ORDER BY updated_at DESC
       LIMIT 1
     ) b ON true
     LEFT JOIN form_templates wt ON wt.id = b.workflow_template_id
     ORDER BY t.updated_at DESC, t.created_at DESC`
  );
  return r.rows.map((row) => ({
    ...rowToTemplate(row),
    latest_draft_id: row.latest_draft_id,
    latest_draft_status: row.latest_draft_status,
    latest_draft_created_at: row.latest_draft_created_at,
    published_version_number: row.published_version_number,
    published_version_status: row.published_version_status,
    published_at: row.published_at,
    published_workflow_json: row.published_workflow_json,
    workflow_binding_mode: row.workflow_binding_mode,
    workflow_binding_template_id: row.workflow_binding_template_id,
    workflow_binding_name: row.workflow_binding_name,
  }));
}

async function listVersionsForTemplate(templateId) {
  const template = await getTemplate(templateId);
  if (!template) return null;
  const r = await pool.query(
    `SELECT * FROM form_template_versions
     WHERE template_id = $1
     ORDER BY
       CASE status WHEN 'draft' THEN 0 WHEN 'published' THEN 1 ELSE 2 END,
       version_number DESC NULLS FIRST,
       created_at DESC`,
    [template.id]
  );
  return r.rows.map(rowToVersion);
}

async function createTemplate({
  key,
  name,
  description = null,
  createdBy = null,
  schema_json = {},
  workflow_json = {},
  validation_json = {},
  template_kind = null,
  launch_config_json = null,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const norm = normalizeSchemaJson(schema_json, { assignIds: true });
    if (!norm.ok) {
      throw new TemplateStoreError('Invalid schema_json', 'VALIDATION_FAILED', 400, { errors: norm.errors });
    }
    const kind =
      normalizeTemplateKind(template_kind) ||
      (launch_config_json?.space_key ? kindForSpace(launch_config_json.space_key) : null) ||
      'form';
    const tplRes = await client.query(
      `INSERT INTO form_templates (key, name, description, status, template_kind, launch_config_json, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', $4, $5::jsonb, $6, now(), now())
       RETURNING *`,
      [key, name, description, kind, jsonb(launch_config_json || {}), createdBy]
    );
    const template = rowToTemplate(tplRes.rows[0]);
    const verRes = await client.query(
      `INSERT INTO form_template_versions
         (template_id, version_number, status, schema_json, workflow_json, validation_json, template_kind, created_by, created_at)
       VALUES ($1, NULL, 'draft', $2::jsonb, $3::jsonb, $4::jsonb, $5, $6, now())
       RETURNING *`,
      [template.id, jsonb(norm.schema_json), jsonb(workflow_json), jsonb(validation_json), kind, createdBy]
    );
    await client.query('COMMIT');
    return { template, draftVersion: rowToVersion(verRes.rows[0]) };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      throw new TemplateStoreError(`Template key already exists: ${key}`, 'DUPLICATE_KEY', 409);
    }
    throw err;
  } finally {
    client.release();
  }
}

async function createDraftVersion({
  templateId,
  createdBy = null,
  schema_json = {},
  workflow_json = {},
  validation_json = {},
}) {
  const template = await getTemplate(templateId);
  if (!template) throw new TemplateStoreError('Template not found', 'NOT_FOUND', 404);
  if (template.status === 'archived') {
    throw new TemplateStoreError('Cannot create draft on archived template', 'ARCHIVED', 409);
  }
  const norm = normalizeSchemaJson(schema_json, { assignIds: true });
  if (!norm.ok) {
    throw new TemplateStoreError('Invalid schema_json', 'VALIDATION_FAILED', 400, { errors: norm.errors });
  }
  const r = await pool.query(
    `INSERT INTO form_template_versions
       (template_id, version_number, status, schema_json, workflow_json, validation_json, template_kind, created_by, created_at)
     VALUES ($1, NULL, 'draft', $2::jsonb, $3::jsonb, $4::jsonb, $5, $6, now())
     RETURNING *`,
    [template.id, jsonb(norm.schema_json), jsonb(workflow_json), jsonb(validation_json), template.template_kind, createdBy]
  );
  await pool.query('UPDATE form_templates SET updated_at = now() WHERE id = $1', [template.id]);
  return rowToVersion(r.rows[0]);
}

async function updateDraftVersion(versionId, patch, actor = null) {
  const current = await getVersion(versionId);
  if (!current) throw new TemplateStoreError('Version not found', 'NOT_FOUND', 404);
  if (current.status !== 'draft') {
    throw new TemplateStoreError('Only draft versions can be edited', 'IMMUTABLE', 409);
  }
  const norm = normalizeSchemaJson(patch.schema_json !== undefined ? patch.schema_json : current.schema_json, {
    assignIds: true,
  });
  if (!norm.ok) {
    throw new TemplateStoreError('Invalid schema_json', 'VALIDATION_FAILED', 400, { errors: norm.errors });
  }
  const schema_json = norm.schema_json;
  const workflow_json = patch.workflow_json !== undefined ? patch.workflow_json : current.workflow_json;
  const validation_json = patch.validation_json !== undefined ? patch.validation_json : current.validation_json;
  const r = await pool.query(
    `UPDATE form_template_versions
     SET schema_json = $2::jsonb,
         workflow_json = $3::jsonb,
         validation_json = $4::jsonb
     WHERE id = $1 AND status = 'draft'
     RETURNING *`,
    [versionId, jsonb(schema_json), jsonb(workflow_json), jsonb(validation_json)]
  );
  if (!r.rowCount) {
    throw new TemplateStoreError('Draft version could not be updated', 'IMMUTABLE', 409);
  }
  await pool.query('UPDATE form_templates SET updated_at = now() WHERE id = $1', [current.template_id]);
  return rowToVersion(r.rows[0]);
}

async function nextPublishedVersionNumber(client, templateId) {
  const r = await client.query(
    `SELECT COALESCE(MAX(version_number), 0) + 1 AS next
     FROM form_template_versions
     WHERE template_id = $1 AND status IN ('published', 'retired')`,
    [templateId]
  );
  return Number(r.rows[0].next);
}

async function publishDraftVersion(versionId, actor = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT * FROM form_template_versions WHERE id = $1 FOR UPDATE', [versionId]);
    const version = rowToVersion(cur.rows[0]);
    if (!version) throw new TemplateStoreError('Version not found', 'NOT_FOUND', 404);
    if (version.status !== 'draft') {
      throw new TemplateStoreError('Only draft versions can be published', 'NOT_DRAFT', 409);
    }
    const tplLock = await client.query('SELECT * FROM form_templates WHERE id = $1 FOR UPDATE', [
      version.template_id,
    ]);
    const template = rowToTemplate(tplLock.rows[0]);
    if (template.status === 'archived') {
      throw new TemplateStoreError('Cannot publish on archived template', 'ARCHIVED', 409);
    }
    const validation = validateTemplateVersion({
      schema_json: version.schema_json,
      workflow_json: version.workflow_json,
      template_kind: template.template_kind,
      template,
    });
    if (!validation.ok) {
      throw new TemplateStoreError('Template validation failed', 'VALIDATION_FAILED', 400, validation);
    }
    const normalizedSchema = validation.schema_json || version.schema_json;
    const versionNumber = await nextPublishedVersionNumber(client, version.template_id);
    const compiled = compileTemplateVersion({
      schema_json: normalizedSchema,
      workflow_json: version.workflow_json,
      template_kind: template.template_kind,
      template,
    });
    const validationJson = {
      ok: true,
      validated_at: new Date().toISOString(),
      errors: [],
      warnings: validation.warnings || [],
    };
    const pub = await client.query(
      `UPDATE form_template_versions
       SET status = 'published',
           version_number = $2,
           schema_json = $3::jsonb,
           validation_json = $4::jsonb,
           compiled_workflow_json = $5::jsonb,
           template_kind = $6,
           published_at = now(),
           published_by = $7
       WHERE id = $1 AND status = 'draft'
       RETURNING *`,
      [
        versionId,
        versionNumber,
        jsonb(normalizedSchema),
        jsonb(validationJson),
        jsonb(compiled),
        template.template_kind,
        actor,
      ]
    );
    if (!pub.rowCount) throw new TemplateStoreError('Publish failed', 'IMMUTABLE', 409);
    const published = rowToVersion(pub.rows[0]);
    await client.query(
      `UPDATE form_templates
       SET current_published_version_id = $2, updated_at = now()
       WHERE id = $1`,
      [template.id, published.id]
    );
    await syncLaunchEntryOnPublish(client, { template, publishedVersion: published, actor });
    await client.query('COMMIT');
    return published;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function clonePublishedToDraft(templateId, actor = null) {
  const template = await getTemplate(templateId);
  if (!template) throw new TemplateStoreError('Template not found', 'NOT_FOUND', 404);
  if (template.status === 'archived') {
    throw new TemplateStoreError('Cannot clone draft on archived template', 'ARCHIVED', 409);
  }
  const published = await getCurrentPublishedVersion(template.id);
  if (!published) {
    throw new TemplateStoreError('No published version to clone', 'NO_PUBLISHED', 409);
  }
  return createDraftVersion({
    templateId: template.id,
    createdBy: actor,
    schema_json: published.schema_json,
    workflow_json: published.workflow_json,
    validation_json: published.validation_json,
  });
}

async function retirePublishedVersion(versionId, actor = null) {
  const current = await getVersion(versionId);
  if (!current) throw new TemplateStoreError('Version not found', 'NOT_FOUND', 404);
  if (current.status !== 'published') {
    throw new TemplateStoreError('Only published versions can be retired', 'NOT_PUBLISHED', 409);
  }
  const r = await pool.query(
    `UPDATE form_template_versions
     SET status = 'retired', retired_at = now()
     WHERE id = $1 AND status = 'published'
     RETURNING *`,
    [versionId]
  );
  if (!r.rowCount) throw new TemplateStoreError('Retire failed', 'IMMUTABLE', 409);
  const tpl = await getTemplate(current.template_id);
  if (tpl?.current_published_version_id === versionId) {
    const latest = await pool.query(
      `SELECT id FROM form_template_versions
       WHERE template_id = $1 AND status = 'published'
       ORDER BY version_number DESC NULLS LAST
       LIMIT 1`,
      [current.template_id]
    );
    await pool.query(
      `UPDATE form_templates
       SET current_published_version_id = $2, updated_at = now()
       WHERE id = $1`,
      [current.template_id, latest.rows[0]?.id || null]
    );
  }
  await repointLaunchEntriesAfterRetire(current.template_id, versionId);
  return rowToVersion(r.rows[0]);
}

async function archiveTemplate(templateId, actor = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `UPDATE form_templates
       SET status = 'archived', archived_at = now(), updated_at = now()
       WHERE id = $1 AND status = 'active'
       RETURNING *`,
      [templateId]
    );
    if (!r.rowCount) throw new TemplateStoreError('Template not found or already archived', 'NOT_FOUND', 404);
    await hideLaunchEntriesForTemplate(client, templateId);
    await client.query('COMMIT');
    return rowToTemplate(r.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function createWorkflowStepInstances(client, submissionId, version) {
  if (!version.compiled_workflow_json) {
    throw new TemplateStoreError(
      'Published version missing compiled_workflow_json',
      'MISSING_COMPILED_WORKFLOW',
      500
    );
  }
  const compiled = version.compiled_workflow_json;
  const steps = Array.isArray(compiled.steps) ? compiled.steps : [];
  const created = [];
  for (const step of steps) {
    const stepIndex = step.index ?? step.step_index ?? 0;
    const r = await client.query(
      `INSERT INTO workflow_step_instances
         (submission_id, step_index, step_type, assignee_role, status, payload_json, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'pending', $5::jsonb, now(), now())
       RETURNING *`,
      [
        submissionId,
        stepIndex,
        step.step_type,
        step.assignee_role,
        jsonb({
          action: step.action || null,
          field_keys: step.field_keys || [],
        }),
      ]
    );
    created.push(rowToStepInstance(r.rows[0]));
  }
  return created;
}

async function createSubmission({ templateId, data_json = {}, createdBy = null }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tplRes = await client.query('SELECT * FROM form_templates WHERE id = $1 FOR UPDATE', [templateId]);
    const template = rowToTemplate(tplRes.rows[0]);
    if (!template) throw new TemplateStoreError('Template not found', 'NOT_FOUND', 404);
    if (template.status === 'archived') {
      throw new TemplateStoreError('Template is archived; new submissions blocked', 'ARCHIVED', 409);
    }
    if (!template.current_published_version_id) {
      throw new TemplateStoreError('Template has no published version', 'NO_PUBLISHED', 409);
    }
    const verRes = await client.query(
      'SELECT * FROM form_template_versions WHERE id = $1',
      [template.current_published_version_id]
    );
    const version = rowToVersion(verRes.rows[0]);
    if (!version || version.status !== 'published') {
      throw new TemplateStoreError('Current published version is unavailable', 'NO_PUBLISHED', 409);
    }
    const subRes = await client.query(
      `INSERT INTO form_submissions
         (template_version_id, data_json, status, current_step_index, created_by, created_at, updated_at)
       VALUES ($1, $2::jsonb, 'in_progress', 0, $3, now(), now())
       RETURNING *`,
      [version.id, jsonb(data_json), createdBy]
    );
    const submission = rowToSubmission(subRes.rows[0]);
    const stepInstances = await createWorkflowStepInstances(client, submission.id, version);
    await client.query('COMMIT');
    return { submission, templateVersion: version, stepInstances };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getSubmissionWithVersion(submissionId) {
  const subRes = await pool.query('SELECT * FROM form_submissions WHERE id = $1 LIMIT 1', [submissionId]);
  const submission = rowToSubmission(subRes.rows[0]);
  if (!submission) return null;
  const version = await getVersion(submission.template_version_id);
  const stepsRes = await pool.query(
    `SELECT * FROM workflow_step_instances
     WHERE submission_id = $1
     ORDER BY step_index ASC`,
    [submissionId]
  );
  return {
    submission,
    templateVersion: version,
    stepInstances: stepsRes.rows.map(rowToStepInstance),
  };
}

async function countSubmissionsForTemplate(templateId) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS c
     FROM form_submissions fs
     JOIN form_template_versions v ON v.id = fs.template_version_id
     WHERE v.template_id = $1`,
    [templateId]
  );
  return r.rows[0]?.c || 0;
}

// WOS-80 — unified archive: list dynamic form submissions joined to their
// template version + template. `createdBy` scopes the result to a single
// submitter (used to enforce non-admin visibility — admins pass it null to see
// all). Returns { records, count } where count is the total matching rows
// (independent of limit) so the archive overview can show a true count.
async function listSubmissions({ limit = 500, offset = 0, createdBy = null } = {}) {
  const where = [];
  const params = [];
  if (createdBy) {
    params.push(String(createdBy).toLowerCase());
    where.push(`lower(fs.created_by) = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS c FROM form_submissions fs ${whereSql}`,
    params
  );
  const count = countRes.rows[0]?.c || 0;

  const cappedLimit = Math.min(Math.max(parseInt(limit, 10) || 500, 1), 1000);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
  const rowsRes = await pool.query(
    `SELECT fs.id, fs.status, fs.current_step_index, fs.created_by, fs.created_at, fs.updated_at,
            v.version_number, v.template_id,
            t.name AS template_name, t.key AS template_key
     FROM form_submissions fs
     JOIN form_template_versions v ON v.id = fs.template_version_id
     JOIN form_templates t         ON t.id = v.template_id
     ${whereSql}
     ORDER BY fs.created_at DESC
     LIMIT ${cappedLimit} OFFSET ${safeOffset}`,
    params
  );

  const records = rowsRes.rows.map((row) => ({
    id: row.id,
    template_id: row.template_id,
    template_name: row.template_name,
    template_key: row.template_key,
    version_number: row.version_number,
    status: row.status,
    current_step_index: row.current_step_index,
    submitted_by: row.created_by,
    submitted_at: row.created_at,
    updated_at: row.updated_at,
  }));

  return { records, count };
}

async function deleteDraftTemplate(templateId) {
  const template = await getTemplate(templateId);
  if (!template) {
    throw new TemplateStoreError('Template not found', 'NOT_FOUND', 404);
  }
  if (template.current_published_version_id) {
    throw new TemplateStoreError(
      'Published forms must be archived, not deleted. Use Archive form instead.',
      'PUBLISHED',
      409
    );
  }
  const submissionCount = await countSubmissionsForTemplate(templateId);
  if (submissionCount > 0) {
    throw new TemplateStoreError(
      'Forms with submissions cannot be deleted. Archive the form instead.',
      'HAS_SUBMISSIONS',
      409
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM template_launch_entries WHERE template_id = $1', [templateId]);
    await client.query(
      'DELETE FROM template_bindings WHERE source_template_id = $1 OR workflow_template_id = $1',
      [templateId]
    );
    await client.query('DELETE FROM form_template_versions WHERE template_id = $1', [templateId]);
    const del = await client.query('DELETE FROM form_templates WHERE id = $1 RETURNING id', [templateId]);
    if (!del.rowCount) {
      throw new TemplateStoreError('Template not found', 'NOT_FOUND', 404);
    }
    await client.query('COMMIT');
    return { ok: true, template_id: templateId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function deleteTemplateForTest(keyPrefix) {
  const tpl = await getTemplate(keyPrefix);
  if (!tpl) return;
  await pool.query(
    `DELETE FROM form_submission_events
     WHERE submission_id IN (
       SELECT fs.id FROM form_submissions fs
       JOIN form_template_versions ftv ON ftv.id = fs.template_version_id
       WHERE ftv.template_id = $1
     )`,
    [tpl.id]
  );
  await pool.query(
    `DELETE FROM workflow_step_instances
     WHERE submission_id IN (
       SELECT fs.id FROM form_submissions fs
       JOIN form_template_versions ftv ON ftv.id = fs.template_version_id
       WHERE ftv.template_id = $1
     )`,
    [tpl.id]
  );
  await pool.query(
    `DELETE FROM form_submissions
     WHERE template_version_id IN (SELECT id FROM form_template_versions WHERE template_id = $1)`,
    [tpl.id]
  );
  await pool.query('DELETE FROM template_bindings WHERE source_template_id = $1 OR workflow_template_id = $1', [tpl.id]);
  await pool.query('DELETE FROM form_template_versions WHERE template_id = $1', [tpl.id]);
  await pool.query('DELETE FROM form_templates WHERE id = $1', [tpl.id]);
}

async function appendSubmissionEvent(client, submissionId, { event_type, actor_email, detail, metadata_json }) {
  const r = await client.query(
    `INSERT INTO form_submission_events (submission_id, event_type, actor_email, detail, metadata_json, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, now())
     RETURNING *`,
    [submissionId, event_type, actor_email || null, detail || null, jsonb(metadata_json || {})]
  );
  return r.rows[0];
}

async function listSubmissionEvents(submissionId) {
  const r = await pool.query(
    `SELECT * FROM form_submission_events WHERE submission_id = $1 ORDER BY created_at ASC`,
    [submissionId]
  );
  return r.rows.map((row) => ({
    id: row.id,
    submission_id: row.submission_id,
    event_type: row.event_type,
    actor_email: row.actor_email,
    detail: row.detail,
    metadata_json: row.metadata_json || {},
    created_at: row.created_at,
  }));
}

function firstPendingStepIndex(stepInstances) {
  const sorted = [...(stepInstances || [])].sort((a, b) => a.step_index - b.step_index);
  const idx = sorted.findIndex((s) => s.status === 'pending');
  return idx >= 0 ? sorted[idx].step_index : sorted.length;
}

async function createWorkflowStepInstancesFromCompiled(client, submissionId, compiled, { autoCompleteFill = false, actor = null } = {}) {
  if (!compiled || !Array.isArray(compiled.steps) || !compiled.steps.length) return [];
  const steps = compiled.steps;
  const created = [];
  for (const step of steps) {
    const stepIndex = step.index ?? step.step_index ?? created.length;
    const isFill = step.step_type === 'Fill';
    const status = autoCompleteFill && isFill ? 'completed' : 'pending';
    const payload = {
      action: step.action || null,
      field_keys: step.field_keys || [],
    };
    if (autoCompleteFill && isFill) {
      payload.auto_completed = true;
      payload.completed_at_submit = true;
    }
    const r = await client.query(
      `INSERT INTO workflow_step_instances
         (submission_id, step_index, step_type, assignee_role, status, payload_json, acted_by, acted_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, now(), now())
       RETURNING *`,
      [
        submissionId,
        stepIndex,
        step.step_type,
        step.assignee_role,
        status,
        jsonb(payload),
        autoCompleteFill && isFill ? actor : null,
        autoCompleteFill && isFill ? new Date().toISOString() : null,
      ]
    );
    created.push(rowToStepInstance(r.rows[0]));
  }
  return created;
}

async function resolveLaunchRuntimeBundle(launchEntryId) {
  const entry = await getLaunchEntry(launchEntryId);
  if (!entry) return null;
  const template = await getTemplate(entry.template_id);
  if (!template) return { entry, template: null, version: null };
  const versionId = entry.template_version_id || entry.route_target;
  const version = versionId ? await getVersion(versionId) : null;
  const binding = template ? await getActiveBinding(template.id) : null;
  let boundWorkflowVersion = null;
  if (binding?.workflow_template_version_id) {
    boundWorkflowVersion = await getVersion(binding.workflow_template_version_id);
  }
  return { entry, template, version, binding, boundWorkflowVersion };
}

async function submitLaunchEntry({ launchEntryId, data_json, createdBy, bindingModeHint = null }) {
  const bundle = await resolveLaunchRuntimeBundle(launchEntryId);
  if (!bundle?.entry) throw new TemplateStoreError('Launch entry not found', 'NOT_FOUND', 404);
  const { entry, template, version, binding, boundWorkflowVersion } = bundle;
  if (entry.status === 'archived' || template?.status === 'archived') {
    throw new TemplateStoreError('Launch entry is archived', 'ARCHIVED', 409);
  }
  if (entry.status !== 'active') {
    throw new TemplateStoreError('Launch entry is not active', 'UNAVAILABLE', 409);
  }
  if (!version || version.status !== 'published') {
    throw new TemplateStoreError('Published template version is unavailable', 'NO_PUBLISHED', 409);
  }
  const compiled = version.compiled_workflow_json;
  if (!compiled) {
    throw new TemplateStoreError('Template version missing compiled contract', 'MISSING_COMPILED', 500);
  }
  const validation = validateSubmissionData(compiled, data_json);
  if (!validation.ok) {
    const err = new TemplateStoreError('Submission validation failed', 'VALIDATION_FAILED', 400);
    err.details = { ok: false, errors: validation.errors };
    throw err;
  }

  const bindingMode = binding?.binding_mode || bindingModeHint || 'none';
  const hasBoundWorkflow =
    binding &&
    binding.binding_mode !== 'none' &&
    binding.workflow_template_id &&
    boundWorkflowVersion &&
    boundWorkflowVersion.status === 'published';

  if (bindingMode === 'required' && !hasBoundWorkflow) {
    throw new TemplateStoreError(
      'A published workflow is required before this form can be submitted',
      'REQUIRED_WORKFLOW_MISSING',
      409
    );
  }

  const workflowCompiled = hasBoundWorkflow ? boundWorkflowVersion.compiled_workflow_json : null;
  const notice =
    binding && binding.binding_mode === 'optional' && binding.workflow_template_id && !hasBoundWorkflow
      ? 'Optional workflow is configured but no published workflow is available. Submitted without workflow routing.'
      : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const initialStatus = workflowCompiled?.steps?.length ? 'in_progress' : 'submitted';
    const subRes = await client.query(
      `INSERT INTO form_submissions
         (template_version_id, data_json, status, current_step_index, created_by, created_at, updated_at)
       VALUES ($1, $2::jsonb, $3, 0, $4, now(), now())
       RETURNING *`,
      [version.id, jsonb(data_json), initialStatus, createdBy]
    );
    const submission = rowToSubmission(subRes.rows[0]);
    let stepInstances = [];
    if (workflowCompiled?.steps?.length) {
      stepInstances = await createWorkflowStepInstancesFromCompiled(client, submission.id, workflowCompiled, {
        autoCompleteFill: true,
        actor: createdBy,
      });
      const nextIndex = firstPendingStepIndex(stepInstances);
      const allDone = stepInstances.every((s) => s.status === 'completed');
      const finalStatus = allDone ? 'completed' : 'in_progress';
      await client.query(
        `UPDATE form_submissions SET current_step_index = $2, status = $3, updated_at = now() WHERE id = $1`,
        [submission.id, nextIndex, finalStatus]
      );
      submission.current_step_index = nextIndex;
      submission.status = finalStatus;
    }
    await appendSubmissionEvent(client, submission.id, {
      event_type: 'submission.created',
      actor_email: createdBy,
      detail: `Submitted via launch entry ${entry.label || entry.id}`,
      metadata_json: {
        launch_entry_id: entry.id,
        space_key: entry.space_key,
        template_id: template.id,
        template_version_id: version.id,
        binding_mode: bindingMode,
        workflow_attached: !!workflowCompiled,
      },
    });
    await client.query('COMMIT');
    return {
      submission,
      templateVersion: version,
      template,
      launchEntry: entry,
      stepInstances,
      binding: binding || null,
      binding_mode: bindingMode,
      notice,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function actOnSubmissionStep({ submissionId, stepInstanceId, actionPayload, actorEmail }) {
  const bundle = await getSubmissionWithVersion(submissionId);
  if (!bundle) throw new TemplateStoreError('Submission not found', 'NOT_FOUND', 404);
  const { submission, stepInstances } = bundle;
  const step = stepInstances.find((s) => s.id === stepInstanceId);
  if (!step) throw new TemplateStoreError('Workflow step not found', 'NOT_FOUND', 404);
  if (step.status !== 'pending') {
    throw new TemplateStoreError('Step is not pending', 'STEP_NOT_PENDING', 409);
  }
  if (step.step_index !== submission.current_step_index) {
    throw new TemplateStoreError('This step is not the current actionable step', 'STEP_NOT_CURRENT', 409);
  }

  const action = String(actionPayload?.action || actionPayload?.decision || '').toLowerCase();
  const stepType = step.step_type;
  let newStepStatus = 'completed';
  let submissionStatus = submission.status;
  let rejectReason = null;

  if (stepType === 'Approve' && action === 'reject') {
    rejectReason = String(actionPayload?.reason || actionPayload?.reject_reason || '').trim();
    if (!rejectReason) {
      throw new TemplateStoreError('Reject reason is required', 'REJECT_REASON_REQUIRED', 400);
    }
    newStepStatus = 'rejected';
    submissionStatus = 'rejected';
  } else if (stepType === 'Review' && action === 'request_changes') {
    newStepStatus = 'completed';
  } else if (stepType === 'Sign') {
    if (actionPayload?.acknowledged !== true && !actionPayload?.signature_text) {
      throw new TemplateStoreError('Signature acknowledgment is required', 'SIGNATURE_REQUIRED', 400);
    }
  } else if (stepType === 'Upload') {
    const ref = String(actionPayload?.reference || actionPayload?.file_reference || actionPayload?.note || '').trim();
    if (!ref) {
      throw new TemplateStoreError('Upload reference or note is required', 'UPLOAD_REFERENCE_REQUIRED', 400);
    }
  } else if (!action && stepType !== 'Fill') {
    actionPayload = { ...actionPayload, action: 'approve' };
  }

  const mergedPayload = {
    ...(step.payload_json || {}),
    ...actionPayload,
    action: action || actionPayload?.action || 'complete',
    acted_at: new Date().toISOString(),
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE workflow_step_instances
       SET status = $2, payload_json = $3::jsonb, acted_by = $4, acted_at = now(), updated_at = now()
       WHERE id = $1`,
      [step.id, newStepStatus, jsonb(mergedPayload), actorEmail]
    );

    let nextIndex = submission.current_step_index;
    if (submissionStatus === 'rejected') {
      await client.query(
        `UPDATE form_submissions SET status = $2, updated_at = now() WHERE id = $1`,
        [submission.id, 'rejected']
      );
    } else {
      const refreshed = await client.query(
        `SELECT * FROM workflow_step_instances WHERE submission_id = $1 ORDER BY step_index ASC`,
        [submission.id]
      );
      const instances = refreshed.rows.map(rowToStepInstance);
      const pending = instances.find((s) => s.status === 'pending');
      if (!pending) {
        submissionStatus = 'completed';
        await client.query(
          `UPDATE form_submissions SET status = $2, current_step_index = $3, updated_at = now() WHERE id = $1`,
          [submission.id, 'completed', instances.length ? instances[instances.length - 1].step_index : 0]
        );
      } else {
        nextIndex = pending.step_index;
        await client.query(
          `UPDATE form_submissions SET status = $2, current_step_index = $3, updated_at = now() WHERE id = $1`,
          [submission.id, 'in_progress', nextIndex]
        );
      }
    }

    await appendSubmissionEvent(client, submission.id, {
      event_type: submissionStatus === 'rejected' ? 'workflow.rejected' : 'workflow.step_completed',
      actor_email: actorEmail,
      detail: `${stepType} step ${newStepStatus}`,
      metadata_json: {
        step_instance_id: step.id,
        step_index: step.step_index,
        step_type: stepType,
        action: mergedPayload.action,
        reject_reason: rejectReason,
      },
    });

    await client.query('COMMIT');
    return getSubmissionWithVersion(submissionId).then(async (out) => ({
      ...out,
      events: await listSubmissionEvents(submissionId),
    }));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getSubmissionDetail(submissionId) {
  const bundle = await getSubmissionWithVersion(submissionId);
  if (!bundle) return null;
  const template = await getTemplate(bundle.templateVersion.template_id);
  const events = await listSubmissionEvents(submissionId);
  return { ...bundle, template, events };
}

async function healthCheck() {
  try {
    await pool.query('SELECT 1');
    const r = await pool.query(`SELECT to_regclass('public.form_templates') AS reg`);
    return { ok: true, table: !!r.rows[0]?.reg };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  TemplateStoreError,
  healthCheck,
  getTemplate,
  getVersion,
  getLatestDraftVersion,
  getCurrentPublishedVersion,
  listTemplates,
  listVersionsForTemplate,
  createTemplate,
  createDraftVersion,
  updateDraftVersion,
  publishDraftVersion,
  clonePublishedToDraft,
  retirePublishedVersion,
  archiveTemplate,
  countSubmissionsForTemplate,
  listSubmissions,
  deleteDraftTemplate,
  createSubmission,
  getSubmissionWithVersion,
  getSubmissionDetail,
  resolveLaunchRuntimeBundle,
  submitLaunchEntry,
  actOnSubmissionStep,
  listSubmissionEvents,
  createWorkflowStepInstances,
  deleteTemplateForTest,
};
