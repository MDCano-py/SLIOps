// Postgres-backed store for Operations Workflow Hub.
// Selected when HUB_STORE_MODE=postgres and DATABASE_URL is set.

const crypto = require('crypto');
const { Pool } = require('pg');
const { DEFAULT_AGING_CONFIG } = require('../constants');
const { resolvePgSsl } = require('./pg-ssl');

function nowIso() {
  return new Date().toISOString();
}

function uuid() {
  return crypto.randomUUID();
}

function jsonb(val) {
  return val === undefined ? null : val;
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: resolvePgSsl(process.env.DATABASE_URL),
});

// WOS-84 — lazy legacy KV; healthCheck must not initialize Redis/Upstash.
let _redis = null;
function getRedis() {
  if (!_redis) {
    const { createRedisClient } = require('../../../../for-dev/redis-client');
    _redis = createRedisClient();
  }
  return _redis;
}

function mapRequestRow(row) {
  if (!row) return null;
  return {
    ...row,
    assigned_to: row.assigned_to_email ?? row.assigned_to ?? null,
    current_step: row.current_step_id ?? row.current_step ?? null,
    created_by: row.created_by_email ?? row.created_by,
    form_payload: row.form_payload ?? null,
  };
}

function mapWebDocumentRow(row) {
  if (!row) return null;
  return {
    ...row,
    created_by: row.created_by_email ?? row.created_by,
    current_owner: row.current_owner_email ?? row.current_owner,
  };
}

function mapStatusHistoryRow(row) {
  if (!row) return null;
  return {
    ...row,
    changed_at: row.created_at,
    changed_by: row.changed_by,
  };
}

async function healthCheck() {
  try {
    await pool.query('SELECT 1 AS ok');
    const mode = (process.env.HUB_STORE_MODE || 'postgres').toLowerCase();
    return { connected: true, ok: true, mode, database_url_set: !!process.env.DATABASE_URL };
  } catch (err) {
    return {
      connected: false,
      ok: false,
      mode: 'postgres',
      database_url_set: !!process.env.DATABASE_URL,
      error: err.message,
    };
  }
}

async function withClient(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function tx(fn) {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });
}

// ---------- Requests ----------

function emptyRequest(overrides = {}) {
  const t = nowIso();
  return {
    id: null,
    request_number: null,
    request_type: 'general_request',
    title: '',
    description: '',
    requester_name: '',
    requester_email: '',
    requester_company: '',
    requester_type: 'employee',
    location: '',
    department: '',
    priority: 'normal',
    status: 'submitted',
    current_step: null,
    assigned_to: null,
    assigned_team: null,
    client_visible_status: null,
    internal_notes: '',
    client_notes: '',
    maintainx_id: null,
    maintainx_sequential_id: null,
    maintainx_status: null,
    maintainx_synced_at: null,
    external_storage_url: null,
    n8n_workflow_run_id: null,
    archive_kind: null,
    archive_id: null,
    form_payload: null,
    created_at: t,
    updated_at: t,
    due_at: null,
    completed_at: null,
    closed_at: null,
    ...overrides,
  };
}

async function createRequest(input, actorEmail) {
  const id = uuid();
  const createdAt = input.created_at ? new Date(input.created_at) : new Date();
  const updatedAt = input.updated_at ? new Date(input.updated_at) : createdAt;
  const requestType = input.request_type || 'general_request';

  return tx(async (c) => {
    // Allocate request_number (per request_type).
    const prefixMap = {
      work_order: 'WO',
      parts_request: 'PR',
      safe_work_permit: 'SWP',
      jsa: 'JSA',
      bol: 'BOL',
      document_review: 'DOC',
      document_signature: 'SIG',
      equipment_request: 'EQ',
      general_request: 'REQ',
    };
    const prefix = prefixMap[requestType] || 'REQ';
    let requestNumber = input.request_number || null;
    if (!requestNumber) {
      await c.query(
        `INSERT INTO request_sequences (request_type, seq) VALUES ($1, 0)
         ON CONFLICT (request_type) DO NOTHING`,
        [requestType]
      );
      const r = await c.query(
        `UPDATE request_sequences SET seq = seq + 1 WHERE request_type=$1 RETURNING seq`,
        [requestType]
      );
      const n = r.rows[0]?.seq || 1;
      requestNumber = `${prefix}-${String(n).padStart(6, '0')}`;
    }

    const rec = emptyRequest({
      ...input,
      id,
      request_type: requestType,
      request_number: requestNumber,
      status: input.status || 'submitted',
      requester_email: (input.requester_email || actorEmail || '').toLowerCase(),
      created_at: createdAt.toISOString(),
      updated_at: updatedAt.toISOString(),
    });

    const assignedTo = input.assigned_to || input.assigned_to_email || rec.assigned_to || null;

    await c.query(
      `INSERT INTO requests
        (id, request_number, request_type, title, description, requester_name, requester_email, requester_company, requester_type,
         location, department, priority, status, assigned_to_email, assigned_team, client_visible_status, internal_notes, client_notes,
         maintainx_id, maintainx_sequential_id, external_storage_url, demo, form_payload, archive_kind, archive_id,
         maintainx_status, maintainx_synced_at, n8n_workflow_run_id, created_at, updated_at, due_at, completed_at, closed_at)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,
         $10,$11,$12,$13,$14,$15,$16,$17,$18,
         $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33)`,
      [
        rec.id,
        rec.request_number,
        rec.request_type,
        rec.title,
        rec.description,
        rec.requester_name,
        rec.requester_email,
        rec.requester_company,
        rec.requester_type,
        rec.location,
        rec.department,
        rec.priority,
        rec.status,
        assignedTo,
        rec.assigned_team,
        rec.client_visible_status,
        rec.internal_notes,
        rec.client_notes,
        rec.maintainx_id,
        rec.maintainx_sequential_id,
        rec.external_storage_url,
        !!rec.demo,
        jsonb(rec.form_payload),
        rec.archive_kind || null,
        rec.archive_id || null,
        rec.maintainx_status || null,
        rec.maintainx_synced_at ? new Date(rec.maintainx_synced_at) : null,
        rec.n8n_workflow_run_id || null,
        createdAt,
        updatedAt,
        rec.due_at ? new Date(rec.due_at) : null,
        rec.completed_at ? new Date(rec.completed_at) : null,
        rec.closed_at ? new Date(rec.closed_at) : null,
      ]
    );
    return mapRequestRow({ ...rec, assigned_to_email: assignedTo, assigned_to: assignedTo });
  });
}

async function saveRequest(request) {
  if (!request?.id) throw new Error('saveRequest requires id');
  const createdAt = request.created_at ? new Date(request.created_at) : new Date();
  const updatedAt = request.updated_at ? new Date(request.updated_at) : new Date();
  const rec = {
    ...request,
    created_at: createdAt.toISOString(),
    updated_at: updatedAt.toISOString(),
  };
  return withClient(async (c) => {
    const assignedTo = rec.assigned_to || rec.assigned_to_email || null;
    await c.query(
      `INSERT INTO requests
        (id, request_number, request_type, title, description, requester_name, requester_email, requester_company, requester_type,
         location, department, priority, status, assigned_to_email, assigned_team, client_visible_status, internal_notes, client_notes,
         maintainx_id, maintainx_sequential_id, external_storage_url, demo, form_payload, archive_kind, archive_id,
         maintainx_status, maintainx_synced_at, n8n_workflow_run_id, created_at, updated_at, due_at, completed_at, closed_at)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,
         $10,$11,$12,$13,$14,$15,$16,$17,$18,
         $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33)
       ON CONFLICT (id) DO UPDATE SET
        request_number=EXCLUDED.request_number,
        request_type=EXCLUDED.request_type,
        title=EXCLUDED.title,
        description=EXCLUDED.description,
        requester_name=EXCLUDED.requester_name,
        requester_email=EXCLUDED.requester_email,
        requester_company=EXCLUDED.requester_company,
        requester_type=EXCLUDED.requester_type,
        location=EXCLUDED.location,
        department=EXCLUDED.department,
        priority=EXCLUDED.priority,
        status=EXCLUDED.status,
        assigned_to_email=EXCLUDED.assigned_to_email,
        assigned_team=EXCLUDED.assigned_team,
        client_visible_status=EXCLUDED.client_visible_status,
        internal_notes=EXCLUDED.internal_notes,
        client_notes=EXCLUDED.client_notes,
        maintainx_id=EXCLUDED.maintainx_id,
        maintainx_sequential_id=EXCLUDED.maintainx_sequential_id,
        external_storage_url=EXCLUDED.external_storage_url,
        demo=EXCLUDED.demo,
        form_payload=EXCLUDED.form_payload,
        archive_kind=EXCLUDED.archive_kind,
        archive_id=EXCLUDED.archive_id,
        maintainx_status=EXCLUDED.maintainx_status,
        maintainx_synced_at=EXCLUDED.maintainx_synced_at,
        n8n_workflow_run_id=EXCLUDED.n8n_workflow_run_id,
        updated_at=EXCLUDED.updated_at,
        due_at=EXCLUDED.due_at,
        completed_at=EXCLUDED.completed_at,
        closed_at=EXCLUDED.closed_at`,
      [
        rec.id,
        rec.request_number,
        rec.request_type,
        rec.title,
        rec.description,
        rec.requester_name,
        rec.requester_email,
        rec.requester_company,
        rec.requester_type,
        rec.location,
        rec.department,
        rec.priority,
        rec.status,
        assignedTo,
        rec.assigned_team,
        rec.client_visible_status,
        rec.internal_notes,
        rec.client_notes,
        rec.maintainx_id,
        rec.maintainx_sequential_id,
        rec.external_storage_url,
        !!rec.demo,
        jsonb(rec.form_payload),
        rec.archive_kind || null,
        rec.archive_id || null,
        rec.maintainx_status || null,
        rec.maintainx_synced_at ? new Date(rec.maintainx_synced_at) : null,
        rec.n8n_workflow_run_id || null,
        createdAt,
        updatedAt,
        rec.due_at ? new Date(rec.due_at) : null,
        rec.completed_at ? new Date(rec.completed_at) : null,
        rec.closed_at ? new Date(rec.closed_at) : null,
      ]
    );
    return mapRequestRow({ ...rec, assigned_to_email: assignedTo, assigned_to: assignedTo });
  });
}

async function getRequest(id) {
  if (!id) return null;
  return withClient(async (c) => {
    const { isDemoDataVisible } = require('../demo-visibility');
    const r = await c.query('SELECT * FROM requests WHERE id=$1', [id]);
    const row = mapRequestRow(r.rows[0]);
    if (row?.demo && !isDemoDataVisible()) return null;
    return row;
  });
}

async function getRequestByNumber(requestNumber) {
  if (!requestNumber) return null;
  return withClient(async (c) => {
    const { isDemoDataVisible } = require('../demo-visibility');
    const r = await c.query('SELECT * FROM requests WHERE request_number=$1', [requestNumber]);
    const row = mapRequestRow(r.rows[0]);
    if (row?.demo && !isDemoDataVisible()) return null;
    return row;
  });
}

async function findRequestByArchive(kind, archiveId) {
  if (!kind || !archiveId) return null;
  return withClient(async (c) => {
    const r = await c.query(
      'SELECT * FROM requests WHERE archive_kind=$1 AND archive_id=$2 LIMIT 1',
      [kind, archiveId]
    );
    return mapRequestRow(r.rows[0]);
  });
}

async function listRequests(opts = {}) {
  return withClient(async (c) => {
    const { shouldIncludeDemoRows } = require('../demo-visibility');
    const limit = Math.min(parseInt(opts.limit || 200, 10) || 200, 500);
    const where = [];
    const params = [];
    // WOS-87 — hide demo-tagged rows unless staging demo flag (or local dev) allows them.
    if (!shouldIncludeDemoRows(opts)) {
      where.push(`(demo IS NOT TRUE)`);
    }
    if (opts.status) {
      params.push(opts.status);
      where.push(`status=$${params.length}`);
    }
    if (opts.request_type) {
      params.push(opts.request_type);
      where.push(`request_type=$${params.length}`);
    }
    if (opts.open_only) {
      where.push(`status NOT IN ('completed','closed','rejected')`);
    }
    params.push(limit);
    const sql = `SELECT * FROM requests ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT $${params.length}`;
    const r = await c.query(sql, params);
    return (r.rows || []).map(mapRequestRow);
  });
}

async function patchRequest(id, patch) {
  const existing = await getRequest(id);
  if (!existing) return { record: null, oldStatus: null };
  const merged = { ...existing, ...patch, id };
  const oldStatus = existing.status;
  const saved = await saveRequest(merged);
  return { record: saved, oldStatus };
}

// ---------- Status history ----------

async function addStatusHistory(entry) {
  return withClient(async (c) => {
    const id = uuid();
    await c.query(
      `INSERT INTO status_history (id, request_id, old_status, new_status, changed_by, changed_by_type, note, source, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        entry.request_id,
        entry.old_status || null,
        entry.new_status || null,
        entry.changed_by || null,
        entry.changed_by_type || null,
        entry.note || null,
        entry.source || null,
        entry.created_at ? new Date(entry.created_at) : new Date(),
      ]
    );
    return { ...entry, id };
  });
}

async function listStatusHistory(requestId) {
  return withClient(async (c) => {
    const r = await c.query('SELECT * FROM status_history WHERE request_id=$1 ORDER BY created_at ASC', [requestId]);
    return (r.rows || []).map(mapStatusHistoryRow);
  });
}

// ---------- Web documents ----------

function emptyWebDocument(overrides = {}) {
  const t = nowIso();
  return {
    id: null,
    request_id: null,
    document_type_key: '',
    title: '',
    status: 'draft',
    content_json: null,
    rendered_html: null,
    version: 1,
    created_by: '',
    current_owner: null,
    locked: false,
    locked_at: null,
    completed_at: null,
    created_at: t,
    updated_at: t,
    ...overrides,
  };
}

async function createWebDocument(input) {
  const id = uuid();
  const rec = emptyWebDocument({ ...input, id, created_at: nowIso(), updated_at: nowIso() });
  return withClient(async (c) => {
    await c.query(
      `INSERT INTO web_documents
       (id, request_id, document_type_key, title, status, content_json, rendered_html, version, created_by_email, current_owner_email,
        locked, locked_at, completed_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        rec.id,
        rec.request_id,
        rec.document_type_key,
        rec.title,
        rec.status,
        jsonb(rec.content_json),
        rec.rendered_html,
        rec.version || 1,
        rec.created_by,
        rec.current_owner,
        !!rec.locked,
        rec.locked_at ? new Date(rec.locked_at) : null,
        rec.completed_at ? new Date(rec.completed_at) : null,
        new Date(rec.created_at),
        new Date(rec.updated_at),
      ]
    );
    return rec;
  });
}

async function getWebDocument(id) {
  return withClient(async (c) => {
    const r = await c.query('SELECT * FROM web_documents WHERE id=$1', [id]);
    return mapWebDocumentRow(r.rows[0]);
  });
}

async function getWebDocumentByRequestId(requestId) {
  return withClient(async (c) => {
    const r = await c.query('SELECT * FROM web_documents WHERE request_id=$1 ORDER BY created_at DESC LIMIT 1', [requestId]);
    return mapWebDocumentRow(r.rows[0]);
  });
}

async function patchWebDocument(id, patch) {
  const existing = await getWebDocument(id);
  if (!existing) return null;
  const merged = { ...existing, ...patch, id, updated_at: nowIso() };
  return withClient(async (c) => {
    await c.query(
      `UPDATE web_documents SET
        title=$2, status=$3, content_json=$4, rendered_html=$5, version=$6,
        created_by_email=$7, current_owner_email=$8, locked=$9, locked_at=$10, completed_at=$11, updated_at=$12
       WHERE id=$1`,
      [
        merged.id,
        merged.title,
        merged.status,
        jsonb(merged.content_json),
        merged.rendered_html,
        merged.version || 1,
        merged.created_by_email || merged.created_by,
        merged.current_owner_email || merged.current_owner,
        !!merged.locked,
        merged.locked_at ? new Date(merged.locked_at) : null,
        merged.completed_at ? new Date(merged.completed_at) : null,
        new Date(merged.updated_at),
      ]
    );
    return merged;
  });
}

// ---------- Workflow steps ----------

async function saveWorkflowStep(step) {
  const id = step.id || uuid();
  const now = new Date();
  const createdAt = step.created_at ? new Date(step.created_at) : now;
  const updatedAt = now;
  const rec = { ...step, id, created_at: createdAt.toISOString(), updated_at: updatedAt.toISOString() };
  return withClient(async (c) => {
    await c.query(
      `INSERT INTO workflow_steps
       (id, request_id, document_id, step_order, action_type, assigned_user_email, assigned_user_name, assigned_role, required, status,
        instructions, due_at, started_at, completed_at, completed_by_email, signature_required, review_required, created_at, updated_at)
       VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (id) DO UPDATE SET
        request_id=EXCLUDED.request_id,
        document_id=EXCLUDED.document_id,
        step_order=EXCLUDED.step_order,
        action_type=EXCLUDED.action_type,
        assigned_user_email=EXCLUDED.assigned_user_email,
        assigned_user_name=EXCLUDED.assigned_user_name,
        assigned_role=EXCLUDED.assigned_role,
        required=EXCLUDED.required,
        status=EXCLUDED.status,
        instructions=EXCLUDED.instructions,
        due_at=EXCLUDED.due_at,
        started_at=EXCLUDED.started_at,
        completed_at=EXCLUDED.completed_at,
        completed_by_email=EXCLUDED.completed_by_email,
        signature_required=EXCLUDED.signature_required,
        review_required=EXCLUDED.review_required,
        updated_at=EXCLUDED.updated_at`,
      [
        rec.id,
        rec.request_id,
        rec.document_id || null,
        rec.step_order,
        rec.action_type || rec.step_type,
        rec.assigned_to_email || rec.assigned_user_email || null,
        rec.assigned_to_name || rec.assigned_user_name || null,
        rec.assigned_role || null,
        rec.required !== false,
        rec.status || 'not_started',
        rec.instructions || null,
        rec.due_at ? new Date(rec.due_at) : null,
        rec.started_at ? new Date(rec.started_at) : null,
        rec.completed_at ? new Date(rec.completed_at) : null,
        rec.completed_by || rec.completed_by_email || null,
        !!(rec.requires_signature || rec.signature_required),
        !!(rec.review_required),
        createdAt,
        updatedAt,
      ]
    );
    return {
      ...rec,
      assigned_to_email: rec.assigned_to_email || rec.assigned_user_email,
      assigned_to_name: rec.assigned_to_name || rec.assigned_user_name,
      requires_signature: !!(rec.requires_signature || rec.signature_required),
    };
  });
}

async function getWorkflowStep(id) {
  return withClient(async (c) => {
    const r = await c.query('SELECT * FROM workflow_steps WHERE id=$1', [id]);
    const row = r.rows[0];
    if (!row) return null;
    return {
      ...row,
      assigned_to_email: row.assigned_user_email,
      assigned_to_name: row.assigned_user_name,
      requires_signature: row.signature_required,
    };
  });
}

async function listWorkflowSteps(requestId) {
  return withClient(async (c) => {
    const r = await c.query('SELECT * FROM workflow_steps WHERE request_id=$1 ORDER BY step_order ASC', [requestId]);
    return (r.rows || []).map((row) => ({
      ...row,
      assigned_to_email: row.assigned_user_email,
      assigned_to_name: row.assigned_user_name,
      requires_signature: row.signature_required,
    }));
  });
}

async function deleteWorkflowStepsForRequest(requestId) {
  return withClient(async (c) => {
    await c.query('DELETE FROM workflow_steps WHERE request_id=$1', [requestId]);
    return true;
  });
}

// ---------- Workflow template overrides ----------

async function saveWorkflowTemplateOverride(templateId, override) {
  // Store overrides in workflow_templates keyed by templateId for now.
  return withClient(async (c) => {
    const existing = await c.query('SELECT * FROM workflow_templates WHERE id=$1', [templateId]);
    const id = existing.rowCount ? templateId : uuid();
    await c.query(
      `INSERT INTO workflow_templates (id, key, label, applies_to_document_type, steps_json, enabled, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,now(),now())
       ON CONFLICT (key) DO UPDATE SET steps_json=EXCLUDED.steps_json, label=EXCLUDED.label, updated_at=now()`,
      [
        id,
        override.key || templateId,
        override.label || null,
        override.applies_to_document_type || null,
        override.steps_json || [],
        override.enabled !== false,
      ]
    );
    return { ...override, id };
  });
}

async function getWorkflowTemplateOverride(templateId) {
  return withClient(async (c) => {
    const r = await c.query('SELECT * FROM workflow_templates WHERE key=$1', [templateId]);
    return r.rows[0] || null;
  });
}

// ---------- Comments ----------

async function addComment(input) {
  const id = uuid();
  return withClient(async (c) => {
    await c.query(
      `INSERT INTO comments (id, request_id, document_id, workflow_step_id, author_email, author_name, body, visibility, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`,
      [
        id,
        input.request_id,
        input.document_id || null,
        input.workflow_step_id || null,
        input.author_email || null,
        input.author_name || null,
        input.body || '',
        input.visible_to_client ? 'client' : input.visibility || 'internal',
      ]
    );
    return { ...input, id, created_at: nowIso() };
  });
}

async function listComments(requestId, { clientView = false } = {}) {
  return withClient(async (c) => {
    const r = await c.query('SELECT * FROM comments WHERE request_id=$1 ORDER BY created_at ASC', [requestId]);
    let rows = r.rows || [];
    if (clientView) {
      rows = rows.filter((row) => row.visibility === 'client' || row.visible_to_client);
    }
    return rows.map((row) => ({
      ...row,
      visible_to_client: row.visibility === 'client' || !!row.visible_to_client,
    }));
  });
}

// ---------- Documents (attachments/signatures) ----------

async function saveDocument(input) {
  if (input.document_type !== 'signature' && input.file_url) {
    const id = uuid();
    return withClient(async (c) => {
      await c.query(
        `INSERT INTO request_files
         (id, request_id, document_id, workflow_step_id, file_name, file_url, storage_provider, document_type, uploaded_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
        [
          id,
          input.request_id,
          input.document_id || null,
          input.workflow_step_id || null,
          input.file_name || null,
          input.file_url,
          input.storage_provider || null,
          input.document_type || 'attachment',
          input.uploaded_by || null,
        ]
      );
      return { ...input, id };
    });
  }
  // Stored in signatures table when type is signature.
  if (input.document_type === 'signature') {
    const id = uuid();
    return withClient(async (c) => {
      const sigType = input.storage_provider === 'acknowledgement' ? 'typed_acknowledgement' : 'canvas';
      await c.query(
        `INSERT INTO signatures
         (id, request_id, document_id, workflow_step_id, signer_email, signer_name, signature_type, signature_data, acknowledgement_text, ip_address, user_agent, signed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          id,
          input.request_id,
          input.document_id || null,
          input.workflow_step_id || null,
          input.signer_email || input.uploaded_by || null,
          input.signer_name || null,
          sigType,
          sigType === 'canvas' ? input.file_url : null,
          sigType === 'typed_acknowledgement' ? 'Acknowledged in hub' : null,
          input.signer_ip || null,
          input.signer_user_agent || null,
          input.signed_at ? new Date(input.signed_at) : new Date(),
        ]
      );
      return { ...input, id };
    });
  }
  return { ...input, id: uuid() };
}

async function listDocuments(requestId) {
  return withClient(async (c) => {
    const files = await c.query('SELECT * FROM request_files WHERE request_id=$1 ORDER BY created_at DESC', [
      requestId,
    ]);
    const sigs = await c.query('SELECT * FROM signatures WHERE request_id=$1 ORDER BY signed_at DESC', [requestId]);
    const out = (files.rows || []).map((f) => ({
      id: f.id,
      document_type: f.document_type || 'attachment',
      file_name: f.file_name,
      file_url: f.file_url,
      storage_provider: f.storage_provider,
      uploaded_by: f.uploaded_by,
      uploaded_at: f.created_at,
    }));
    (sigs.rows || []).forEach((s) => {
      out.push({
        document_type: 'signature',
        file_name: 'signature.png',
        file_url: s.signature_data,
        storage_provider: s.signature_type,
        uploaded_by: s.signer_email,
        signed_at: s.signed_at,
        signer_email: s.signer_email,
        signer_name: s.signer_name,
        signer_ip: s.ip_address,
        signer_user_agent: s.user_agent,
      });
    });
    return out;
  });
}

// ---------- Notifications ----------

async function createNotification(input) {
  return saveNotification(input);
}

async function saveNotification(input) {
  const id = input.id || uuid();
  const createdAt = input.created_at ? new Date(input.created_at) : new Date();
  return withClient(async (c) => {
    await c.query(
      `INSERT INTO notifications
       (id, recipient_email, recipient_name, type, title, message, request_id, document_id, workflow_step_id, read_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET
        recipient_email=EXCLUDED.recipient_email,
        recipient_name=EXCLUDED.recipient_name,
        type=EXCLUDED.type,
        title=EXCLUDED.title,
        message=EXCLUDED.message,
        request_id=EXCLUDED.request_id,
        document_id=EXCLUDED.document_id,
        workflow_step_id=EXCLUDED.workflow_step_id,
        read_at=EXCLUDED.read_at,
        created_at=EXCLUDED.created_at`,
      [
        id,
        (input.recipient_email || '').toLowerCase(),
        input.recipient_name || null,
        input.type,
        input.title,
        input.message,
        input.request_id || null,
        input.document_id || null,
        input.workflow_step_id || null,
        input.read_at ? new Date(input.read_at) : null,
        createdAt,
      ]
    );
    return {
      ...input,
      id,
      recipient_email: (input.recipient_email || '').toLowerCase(),
      created_at: createdAt.toISOString(),
      read_at: input.read_at || null,
    };
  });
}

async function listNotifications(email, { unreadOnly = false } = {}) {
  return withClient(async (c) => {
    const sql = unreadOnly
      ? 'SELECT * FROM notifications WHERE recipient_email=$1 AND read_at IS NULL ORDER BY created_at DESC LIMIT 200'
      : 'SELECT * FROM notifications WHERE recipient_email=$1 ORDER BY created_at DESC LIMIT 200';
    const r = await c.query(sql, [email]);
    return r.rows || [];
  });
}

async function countUnreadNotifications(email) {
  return withClient(async (c) => {
    const r = await c.query('SELECT COUNT(*)::int AS n FROM notifications WHERE recipient_email=$1 AND read_at IS NULL', [email]);
    return r.rows[0]?.n || 0;
  });
}

async function markNotificationRead(id, email) {
  return withClient(async (c) => {
    await c.query('UPDATE notifications SET read_at=now() WHERE id=$1 AND recipient_email=$2', [id, email]);
    const r = await c.query('SELECT * FROM notifications WHERE id=$1', [id]);
    return r.rows[0] || null;
  });
}

async function markAllNotificationsRead(email) {
  return withClient(async (c) => {
    const r = await c.query('UPDATE notifications SET read_at=now() WHERE recipient_email=$1 AND read_at IS NULL', [email]);
    return { updated: r.rowCount || 0 };
  });
}

// ---------- Audit ----------

async function addAuditEvent(input) {
  const id = uuid();
  return withClient(async (c) => {
    await c.query(
      `INSERT INTO audit_events (id, request_id, document_id, workflow_step_id, actor_email, actor_name, action, metadata, ip_address, user_agent, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`,
      [
        id,
        input.request_id,
        input.document_id || null,
        input.workflow_step_id || null,
        input.actor_email || null,
        input.actor_name || null,
        input.event_type || input.action || null,
        jsonb(input.metadata || {}),
        input.ip_address || null,
        input.user_agent || null,
      ]
    );
    return { ...input, id, created_at: nowIso() };
  });
}

async function listAuditEvents(requestId) {
  return withClient(async (c) => {
    const r = await c.query('SELECT * FROM audit_events WHERE request_id=$1 ORDER BY created_at ASC', [requestId]);
    return r.rows || [];
  });
}

// ---------- Waiting steps / tasks ----------

async function listAllWaitingSteps() {
  return withClient(async (c) => {
    const r = await c.query(`SELECT * FROM workflow_steps WHERE status IN ('waiting','not_started')`);
    return (r.rows || []).map((row) => ({
      ...row,
      assigned_to_email: row.assigned_user_email,
      assigned_to_name: row.assigned_user_name,
      requires_signature: row.signature_required,
    }));
  });
}

// ---------- Action links ----------

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function createActionLink(input) {
  const id = uuid();
  const token = crypto.randomBytes(24).toString('hex');
  const tokenHash = hashToken(token);
  const hours = input.expires_in_hours || 168;
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

  await withClient(async (c) => {
    await c.query(
      `INSERT INTO action_links (id, request_id, document_id, workflow_step_id, token_hash, recipient_email, action_type, expires_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`,
      [
        id,
        input.request_id,
        input.document_id || null,
        input.workflow_step_id || null,
        tokenHash,
        input.recipient_email,
        input.action_type,
        expiresAt,
      ]
    );
  });

  return {
    link: { id, ...input, token_hash: tokenHash, expires_at: expiresAt.toISOString(), created_at: nowIso() },
    token,
  };
}

async function getActionLinkByToken(token) {
  const tokenHash = hashToken(token);
  return withClient(async (c) => {
    const r = await c.query('SELECT * FROM action_links WHERE token_hash=$1', [tokenHash]);
    return r.rows[0] || null;
  });
}

async function markActionLinkUsed(id) {
  return withClient(async (c) => {
    await c.query('UPDATE action_links SET used_at=now() WHERE id=$1 AND used_at IS NULL', [id]);
    const r = await c.query('SELECT * FROM action_links WHERE id=$1', [id]);
    return r.rows[0] || null;
  });
}

async function revokeActionLink(id) {
  return withClient(async (c) => {
    await c.query('UPDATE action_links SET revoked_at=now() WHERE id=$1', [id]);
    const r = await c.query('SELECT * FROM action_links WHERE id=$1', [id]);
    return r.rows[0] || null;
  });
}

// ---------- Integration events (WOS-35 outbox) ----------

const integrationEvents = require('../integration-events');

function mapIntegrationRow(row) {
  if (!row) return null;
  return row;
}

async function createIntegrationEvent(input) {
  const normalized = integrationEvents.normalizeCreateInput(input);
  const id = uuid();
  return withClient(async (c) => {
    if (normalized.dedupe_key) {
      const existing = await c.query(
        `SELECT * FROM integration_events WHERE dedupe_key=$1 ORDER BY created_at DESC LIMIT 1`,
        [normalized.dedupe_key]
      );
      if (existing.rows[0]) {
        return { ...existing.rows[0], dedupe_hit: true };
      }
    }

    await c.query(
      `INSERT INTO integration_events
       (id, event_type, request_id, document_id, workflow_step_id, payload, status, attempts,
        dedupe_key, last_error, next_attempt_at, source_system, destination_system, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),now())`,
      [
        id,
        normalized.event_type,
        normalized.request_id,
        normalized.document_id,
        normalized.workflow_step_id,
        jsonb(normalized.payload),
        normalized.status,
        normalized.attempts,
        normalized.dedupe_key,
        normalized.last_error,
        normalized.next_attempt_at ? new Date(normalized.next_attempt_at) : null,
        normalized.source_system,
        normalized.destination_system,
      ]
    );
    const r = await c.query('SELECT * FROM integration_events WHERE id=$1', [id]);
    return mapIntegrationRow(r.rows[0]);
  });
}

async function queueIntegrationEvent(input) {
  return createIntegrationEvent(input);
}

async function updateIntegrationEvent(id, patch) {
  return withClient(async (c) => {
    const existing = await c.query('SELECT * FROM integration_events WHERE id=$1', [id]);
    if (!existing.rowCount) return null;
    const merged = { ...existing.rows[0], ...patch, id };
    await c.query(
      `UPDATE integration_events SET
         status=$2,
         attempts=$3,
         last_error=$4,
         sent_at=$5,
         processed_at=$6,
         next_attempt_at=$7,
         last_attempt_at=$8,
         locked_at=$9,
         locked_by=$10,
         updated_at=now()
       WHERE id=$1`,
      [
        id,
        merged.status,
        merged.attempts ?? 0,
        merged.last_error ?? null,
        merged.sent_at ? new Date(merged.sent_at) : null,
        merged.processed_at ? new Date(merged.processed_at) : null,
        merged.next_attempt_at ? new Date(merged.next_attempt_at) : null,
        merged.last_attempt_at ? new Date(merged.last_attempt_at) : null,
        merged.locked_at ? new Date(merged.locked_at) : null,
        merged.locked_by ?? null,
      ]
    );
    const r = await c.query('SELECT * FROM integration_events WHERE id=$1', [id]);
    return mapIntegrationRow(r.rows[0]);
  });
}

async function listPendingIntegrationEvents(limit = 20) {
  return withClient(async (c) => {
    const r = await c.query(
      `SELECT * FROM integration_events
       WHERE status IN ('pending','retrying')
         AND (next_attempt_at IS NULL OR next_attempt_at <= now())
       ORDER BY created_at ASC
       LIMIT $1`,
      [Math.min(limit, 200)]
    );
    return r.rows || [];
  });
}

async function countPendingIntegrationEvents() {
  return withClient(async (c) => {
    const r = await c.query(
      `SELECT COUNT(*)::int AS n FROM integration_events
       WHERE status IN ('pending','retrying')
         AND (next_attempt_at IS NULL OR next_attempt_at <= now())`
    );
    return r.rows[0]?.n || 0;
  });
}

async function findIntegrationEventByDedupeKey(eventType, dedupeKey) {
  if (!eventType || !dedupeKey) return null;
  return withClient(async (c) => {
    const r = await c.query(
      `SELECT * FROM integration_events WHERE event_type=$1 AND dedupe_key=$2 ORDER BY created_at DESC LIMIT 1`,
      [eventType, dedupeKey]
    );
    return r.rows[0] || null;
  });
}

async function releaseStaleIntegrationEventLocks(staleMs = 5 * 60 * 1000) {
  return withClient(async (c) => {
    const r = await c.query(
      `UPDATE integration_events
       SET status='pending', locked_at=NULL, locked_by=NULL, updated_at=now()
       WHERE status='processing'
         AND locked_at IS NOT NULL
         AND locked_at < now() - ($1::int * interval '1 millisecond')
       RETURNING id`,
      [Math.max(1000, staleMs)]
    );
    return (r.rows || []).map((row) => row.id);
  });
}

async function claimIntegrationEvents({ limit = 20, workerId = 'worker', eventTypes = null } = {}) {
  const batch = Math.min(Math.max(1, limit), 200);
  const worker = workerId || 'worker';
  return withClient(async (c) => {
    await c.query('BEGIN');
    try {
      const typeFilter =
        eventTypes && eventTypes.length
          ? `AND event_type = ANY($2::text[])`
          : `AND event_type <> 'inbound_email'`;
      const params = eventTypes && eventTypes.length ? [batch, eventTypes] : [batch];

      const sel = await c.query(
        `SELECT id FROM integration_events
         WHERE status IN ('pending','retrying')
           AND (next_attempt_at IS NULL OR next_attempt_at <= now())
           ${typeFilter}
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $1`,
        params
      );
      const ids = (sel.rows || []).map((row) => row.id);
      if (!ids.length) {
        await c.query('COMMIT');
        return [];
      }
      await c.query(
        `UPDATE integration_events
         SET status='processing', locked_at=now(), locked_by=$2, updated_at=now()
         WHERE id = ANY($1::uuid[])`,
        [ids, worker]
      );
      const r = await c.query(`SELECT * FROM integration_events WHERE id = ANY($1::uuid[])`, [ids]);
      await c.query('COMMIT');
      return r.rows || [];
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    }
  });
}

async function markIntegrationEventProcessed(id, patch = {}) {
  const existing = await withClient(async (c) => {
    const r = await c.query('SELECT * FROM integration_events WHERE id=$1', [id]);
    return r.rows[0] || null;
  });
  if (!existing) return null;
  const merged = integrationEvents.buildProcessedPatch(existing, patch);
  return updateIntegrationEvent(id, merged);
}

async function markIntegrationEventFailed(id, errorMessage, options = {}) {
  const existing = await withClient(async (c) => {
    const r = await c.query('SELECT * FROM integration_events WHERE id=$1', [id]);
    return r.rows[0] || null;
  });
  if (!existing) return null;
  const merged = integrationEvents.buildRetryPatch(existing, errorMessage, options);
  return updateIntegrationEvent(id, merged);
}

// ---------- Email delivery outbox (WOS-36) ----------

async function queueEmailDeliveryEvent(input) {
  return createEmailDeliveryEvent(input);
}

async function createEmailDeliveryEvent(input) {
  const id = uuid();
  const payload = integrationEvents.sanitizeIntegrationPayload(input.payload || {});
  const dedupeKey = input.dedupe_key || input.event_key || null;
  const status = input.status || 'pending';

  return withClient(async (c) => {
    if (dedupeKey) {
      const existing = await c.query(
        `SELECT * FROM outbox_events WHERE dedupe_key=$1 ORDER BY created_at DESC LIMIT 1`,
        [dedupeKey]
      );
      if (existing.rows[0]) {
        return { ...existing.rows[0], dedupe_hit: true };
      }
    }

    await c.query(
      `INSERT INTO outbox_events
       (id, event_type, status, payload, dedupe_key, attempts, next_attempt_at, request_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),now())`,
      [
        id,
        input.event_type || 'email.send',
        status,
        jsonb(payload),
        dedupeKey,
        input.attempts ?? 0,
        input.next_attempt_at ? new Date(input.next_attempt_at) : null,
        input.request_id || payload.request_id || null,
      ]
    );
    const r = await c.query('SELECT * FROM outbox_events WHERE id=$1', [id]);
    return r.rows[0] || null;
  });
}

async function updateEmailDeliveryEvent(id, patch) {
  return withClient(async (c) => {
    const existing = await c.query('SELECT * FROM outbox_events WHERE id=$1', [id]);
    if (!existing.rowCount) return null;
    const merged = { ...existing.rows[0], ...patch, id };
    await c.query(
      `UPDATE outbox_events SET
         status=$2,
         attempts=$3,
         last_error=$4,
         processed_at=$5,
         next_attempt_at=$6,
         last_attempt_at=$7,
         locked_at=$8,
         locked_by=$9,
         updated_at=now()
       WHERE id=$1`,
      [
        id,
        merged.status,
        merged.attempts ?? 0,
        merged.last_error ?? null,
        merged.processed_at ? new Date(merged.processed_at) : null,
        merged.next_attempt_at ? new Date(merged.next_attempt_at) : null,
        merged.last_attempt_at ? new Date(merged.last_attempt_at) : null,
        merged.locked_at ? new Date(merged.locked_at) : null,
        merged.locked_by ?? null,
      ]
    );
    const r = await c.query('SELECT * FROM outbox_events WHERE id=$1', [id]);
    return r.rows[0] || null;
  });
}

async function findEmailDeliveryEventByDedupeKey(dedupeKey) {
  if (!dedupeKey) return null;
  return withClient(async (c) => {
    const r = await c.query(`SELECT * FROM outbox_events WHERE dedupe_key=$1 ORDER BY created_at DESC LIMIT 1`, [
      dedupeKey,
    ]);
    return r.rows[0] || null;
  });
}

async function listPendingEmailDeliveryEvents(limit = 20) {
  return withClient(async (c) => {
    const r = await c.query(
      `SELECT * FROM outbox_events
       WHERE event_type='email.send'
         AND status IN ('pending','retrying')
         AND (next_attempt_at IS NULL OR next_attempt_at <= now())
       ORDER BY created_at ASC
       LIMIT $1`,
      [Math.min(limit, 200)]
    );
    return r.rows || [];
  });
}

async function countPendingEmailDeliveryEvents() {
  return withClient(async (c) => {
    const r = await c.query(
      `SELECT COUNT(*)::int AS n FROM outbox_events
       WHERE event_type='email.send'
         AND status IN ('pending','retrying')
         AND (next_attempt_at IS NULL OR next_attempt_at <= now())`
    );
    return r.rows[0]?.n || 0;
  });
}

async function releaseStaleEmailDeliveryLocks(staleMs = 5 * 60 * 1000) {
  return withClient(async (c) => {
    const r = await c.query(
      `UPDATE outbox_events
       SET status='pending', locked_at=NULL, locked_by=NULL, updated_at=now()
       WHERE status='processing'
         AND locked_at IS NOT NULL
         AND locked_at < now() - ($1::int * interval '1 millisecond')
       RETURNING id`,
      [Math.max(1000, staleMs)]
    );
    return (r.rows || []).map((row) => row.id);
  });
}

async function claimEmailDeliveryEvents({ limit = 20, workerId = 'email-worker' } = {}) {
  const batch = Math.min(Math.max(1, limit), 200);
  const worker = workerId || 'email-worker';
  return withClient(async (c) => {
    await c.query('BEGIN');
    try {
      const sel = await c.query(
        `SELECT id FROM outbox_events
         WHERE event_type='email.send'
           AND status IN ('pending','retrying')
           AND (next_attempt_at IS NULL OR next_attempt_at <= now())
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $1`,
        [batch]
      );
      const ids = (sel.rows || []).map((row) => row.id);
      if (!ids.length) {
        await c.query('COMMIT');
        return [];
      }
      await c.query(
        `UPDATE outbox_events
         SET status='processing', locked_at=now(), locked_by=$2, updated_at=now()
         WHERE id = ANY($1::uuid[])`,
        [ids, worker]
      );
      const r = await c.query(`SELECT * FROM outbox_events WHERE id = ANY($1::uuid[])`, [ids]);
      await c.query('COMMIT');
      return r.rows || [];
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    }
  });
}

async function markEmailDeliveryProcessed(id, patch = {}) {
  const existing = await withClient(async (c) => {
    const r = await c.query('SELECT * FROM outbox_events WHERE id=$1', [id]);
    return r.rows[0] || null;
  });
  if (!existing) return null;
  const now = nowIso();
  return updateEmailDeliveryEvent(id, {
    status: 'processed',
    attempts: patch.attempts ?? (existing.attempts || 0) + 1,
    processed_at: now,
    last_attempt_at: now,
    last_error: null,
    next_attempt_at: null,
    locked_at: null,
    locked_by: null,
    ...patch,
  });
}

async function markEmailDeliveryFailed(id, errorMessage, options = {}) {
  const existing = await withClient(async (c) => {
    const r = await c.query('SELECT * FROM outbox_events WHERE id=$1', [id]);
    return r.rows[0] || null;
  });
  if (!existing) return null;
  const maxAttempts = options.maxAttempts ?? Number(process.env.EMAIL_DELIVERY_MAX_ATTEMPTS || 8);
  const baseMs = options.baseBackoffMs ?? Number(process.env.EMAIL_DELIVERY_RETRY_BASE_MS || 60_000);
  const attempts = (existing.attempts || 0) + 1;
  const now = nowIso();
  const status = attempts >= maxAttempts ? 'dead_lettered' : 'retrying';
  const patch = {
    attempts,
    last_error: errorMessage || existing.last_error || 'send_failed',
    last_attempt_at: now,
    locked_at: null,
    locked_by: null,
  };
  if (status === 'dead_lettered') {
    patch.status = 'dead_lettered';
    patch.next_attempt_at = null;
  } else {
    patch.status = 'retrying';
    const delayMs = Math.min(baseMs * 2 ** (attempts - 1), 24 * 60 * 60 * 1000);
    patch.next_attempt_at = new Date(Date.now() + delayMs).toISOString();
  }
  return updateEmailDeliveryEvent(id, patch);
}

// ---------- Delivery status (WOS-40 admin visibility) ----------

async function getDeliveryStatusSummary(limit = 10) {
  const n = Math.min(Math.max(1, limit), 50);
  return withClient(async (c) => {
    const integCounts = await c.query(
      `SELECT status, COUNT(*)::int AS n FROM integration_events
       WHERE event_type <> 'inbound_email'
       GROUP BY status`
    );
    const emailCounts = await c.query(
      `SELECT status, COUNT(*)::int AS n FROM outbox_events
       WHERE event_type = 'email.send'
       GROUP BY status`
    );

    const integMap = {};
    (integCounts.rows || []).forEach((r) => {
      integMap[r.status] = r.n;
    });
    const emailMap = {};
    (emailCounts.rows || []).forEach((r) => {
      emailMap[r.status] = r.n;
    });

    const integFailures = await c.query(
      `SELECT id, event_type, status, attempts, last_error, last_attempt_at, next_attempt_at,
              created_at, updated_at, processed_at, request_id, source_system, destination_system,
              locked_at, locked_by
       FROM integration_events
       WHERE event_type <> 'inbound_email'
         AND (
           status IN ('failed', 'dead_lettered')
           OR (status = 'retrying' AND last_error IS NOT NULL)
           OR (status = 'processing' AND locked_at IS NOT NULL AND locked_at < now() - interval '5 minutes')
         )
       ORDER BY COALESCE(last_attempt_at, updated_at, created_at) DESC
       LIMIT $1`,
      [n]
    );

    const emailFailures = await c.query(
      `SELECT id, event_type, status, attempts, last_error, last_attempt_at, next_attempt_at,
              created_at, updated_at, processed_at, request_id, payload
       FROM outbox_events
       WHERE event_type = 'email.send'
         AND (
           status IN ('failed', 'dead_lettered')
           OR (status = 'retrying' AND last_error IS NOT NULL)
           OR (status = 'processing' AND locked_at IS NOT NULL AND locked_at < now() - interval '5 minutes')
         )
       ORDER BY COALESCE(last_attempt_at, updated_at, created_at) DESC
       LIMIT $1`,
      [n]
    );

    return {
      integration: {
        pending: integMap.pending || 0,
        retrying: integMap.retrying || 0,
        processing: integMap.processing || 0,
        dead_lettered: integMap.dead_lettered || 0,
        failed: integMap.failed || 0,
        recent_failures: integFailures.rows || [],
      },
      email: {
        pending: emailMap.pending || 0,
        retrying: emailMap.retrying || 0,
        processing: emailMap.processing || 0,
        dead_lettered: emailMap.dead_lettered || 0,
        failed: emailMap.failed || 0,
        recent_failures: emailFailures.rows || [],
      },
    };
  });
}

// ---------- Visibility + aging config (keep simple in Postgres) ----------

async function readHubSetting(key) {
  return withClient(async (c) => {
    const r = await c.query('SELECT value_json FROM hub_settings WHERE key=$1', [key]);
    return r.rows[0]?.value_json || null;
  });
}

async function writeHubSetting(key, value) {
  return withClient(async (c) => {
    await c.query(
      `INSERT INTO hub_settings (key, value_json, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value_json=EXCLUDED.value_json, updated_at=now()`,
      [key, jsonb(value)]
    );
  });
}

async function getAgingConfig() {
  try {
    const cfg = await readHubSetting('aging');
    return { ...DEFAULT_AGING_CONFIG, ...(cfg || {}) };
  } catch {
    return { ...DEFAULT_AGING_CONFIG };
  }
}

async function getVisibilitySettings(requestId) {
  const global = (await readHubSetting('visibility:global')) || {
    requesterProgress: true,
    clientProgress: false,
    clientSimplifiedStatus: true,
  };
  if (!requestId) return global;
  const per = await readHubSetting(`visibility:${requestId}`);
  return { ...global, ...(per || {}) };
}

async function setVisibilitySettings(requestId, settings) {
  const key = requestId ? `visibility:${requestId}` : 'visibility:global';
  await writeHubSetting(key, { ...settings, updatedAt: nowIso() });
  return getVisibilitySettings(requestId);
}

// ---------- Demo cleanup ----------

async function deleteDemoRequest(requestId) {
  return withClient(async (c) => {
    await c.query('DELETE FROM notifications WHERE request_id=$1', [requestId]);
    await c.query('DELETE FROM requests WHERE id=$1 AND demo=true', [requestId]);
    return true;
  });
}

async function listDemoRequestIds() {
  return withClient(async (c) => {
    const r = await c.query('SELECT id FROM requests WHERE demo = true ORDER BY created_at');
    return (r.rows || []).map((row) => row.id);
  });
}

const {
  DEFAULT_PORTAL_SETTINGS,
  normalizePortalSettings,
  mergePortalSettings,
} = require('../portal-settings');

async function getPortalSettings() {
  try {
    const cfg = await readHubSetting('portal:general');
    return normalizePortalSettings({ ...DEFAULT_PORTAL_SETTINGS, ...(cfg || {}) });
  } catch {
    return normalizePortalSettings(DEFAULT_PORTAL_SETTINGS);
  }
}

async function setPortalSettings(patch) {
  const next = mergePortalSettings(await getPortalSettings(), patch || {});
  next.updatedAt = nowIso();
  await writeHubSetting('portal:general', next);
  return next;
}

async function trackDemoRequest(_requestId) {
  // Postgres tracks demo rows via requests.demo=true; no separate index required.
  return true;
}

module.exports = {
  get redis() {
    return getRedis();
  },
  // Core helpers
  nowIso,
  generateId: uuid,
  hashToken,
  healthCheck,
  // Postgres-only helpers
  tx,
  pool,

  // Settings
  getAgingConfig,
  getVisibilitySettings,
  setVisibilitySettings,
  getPortalSettings,
  setPortalSettings,

  // Requests
  emptyRequest,
  createRequest,
  saveRequest,
  getRequest,
  getRequestByNumber,
  findRequestByArchive,
  listRequests,
  patchRequest,

  // History / audit
  addStatusHistory,
  listStatusHistory,
  addAuditEvent,
  listAuditEvents,

  // Workflow steps
  saveWorkflowStep,
  getWorkflowStep,
  listWorkflowSteps,
  deleteWorkflowStepsForRequest,
  listAllWaitingSteps,

  // Templates (overrides)
  saveWorkflowTemplateOverride,
  getWorkflowTemplateOverride,

  // Web docs
  emptyWebDocument,
  createWebDocument,
  getWebDocument,
  getWebDocumentByRequestId,
  patchWebDocument,

  // Comments
  addComment,
  listComments,

  // Documents/signatures
  saveDocument,
  listDocuments,

  // Notifications
  createNotification,
  saveNotification,
  listNotifications,
  countUnreadNotifications,
  markNotificationRead,
  markAllNotificationsRead,

  // Action links
  createActionLink,
  getActionLinkByToken,
  markActionLinkUsed,
  revokeActionLink,

  // Integrations (outbox)
  createIntegrationEvent,
  queueIntegrationEvent,
  updateIntegrationEvent,
  listPendingIntegrationEvents,
  countPendingIntegrationEvents,
  findIntegrationEventByDedupeKey,
  claimIntegrationEvents,
  markIntegrationEventProcessed,
  markIntegrationEventFailed,
  releaseStaleIntegrationEventLocks,

  // Email delivery outbox (WOS-36)
  queueEmailDeliveryEvent,
  createEmailDeliveryEvent,
  updateEmailDeliveryEvent,
  findEmailDeliveryEventByDedupeKey,
  listPendingEmailDeliveryEvents,
  countPendingEmailDeliveryEvents,
  claimEmailDeliveryEvents,
  markEmailDeliveryProcessed,
  markEmailDeliveryFailed,
  releaseStaleEmailDeliveryLocks,

  getDeliveryStatusSummary,

  // Demo
  deleteDemoRequest,
  listDemoRequestIds,
  trackDemoRequest,
};

