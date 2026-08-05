/**
 * WOS-98 — External participant secure links for configurable workflow tasks.
 */
const crypto = require('crypto');

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function mintToken() {
  return crypto.randomBytes(32).toString('hex');
}

function publicBaseUrl() {
  const base = process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || '';
  return String(base).replace(/\/$/, '');
}

function buildExternalActionUrl(token) {
  const base = publicBaseUrl();
  const path = `/cfg-action.html?token=${encodeURIComponent(token)}`;
  return base ? `${base}${path}` : path;
}

async function createExternalParticipant(client, {
  taskId,
  instanceId,
  relatedRequestId,
  email,
  displayName,
  expiresHours = 168,
  meta = {},
}) {
  const token = mintToken();
  const tokenHash = hashToken(token);
  const hours = Number(expiresHours) > 0 ? Number(expiresHours) : 168;
  const { rows } = await client.query(
    `INSERT INTO cfg_external_participants
      (task_id, instance_id, related_request_id, display_name, email, token_hash, expires_at, meta_json)
     VALUES ($1,$2,$3,$4,$5,$6, now() + ($7::text || ' hours')::interval, $8::jsonb)
     RETURNING *`,
    [
      taskId,
      instanceId,
      relatedRequestId || null,
      displayName || null,
      String(email).toLowerCase(),
      tokenHash,
      String(hours),
      JSON.stringify(meta || {}),
    ]
  );
  const row = rows[0];
  return {
    participant: row,
    token,
    actionUrl: buildExternalActionUrl(token),
  };
}

async function getExternalParticipantByToken(client, token) {
  const tokenHash = hashToken(token);
  const { rows } = await client.query(
    `SELECT ep.*, t.title AS task_title, t.task_type, t.status AS task_status, t.instructions,
            t.related_request_id AS task_request_id, i.state AS instance_state, i.context_json
     FROM cfg_external_participants ep
     JOIN cfg_workflow_tasks t ON t.id = ep.task_id
     JOIN cfg_workflow_instances i ON i.id = ep.instance_id
     WHERE ep.token_hash = $1
     LIMIT 1`,
    [tokenHash]
  );
  return rows[0] || null;
}

async function listGeneratedDocsForInstance(client, instanceId) {
  const { rows } = await client.query(
    `SELECT id, title, body_html, status, created_at
     FROM cfg_generated_documents
     WHERE instance_id = $1
     ORDER BY created_at DESC
     LIMIT 5`,
    [instanceId]
  );
  return rows;
}

module.exports = {
  hashToken,
  mintToken,
  buildExternalActionUrl,
  createExternalParticipant,
  getExternalParticipantByToken,
  listGeneratedDocsForInstance,
  publicBaseUrl,
};
