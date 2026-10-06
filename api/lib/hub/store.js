// Redis-backed store for Operations Workflow Hub entities.

const crypto = require('crypto');
const { createRedisClient } = require('../../../for-dev/redis-client');
const {
  REQUEST_NUMBER_PREFIX,
  REQUEST_STATUSES,
  DEFAULT_AGING_CONFIG,
} = require('./constants');

const redis = createRedisClient();

function nowIso() {
  return new Date().toISOString();
}

function parseJson(raw) {
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

function generateId() {
  const ts = Date.now();
  const nonce = crypto.randomBytes(4).toString('hex');
  return `${ts}-${nonce}`;
}

async function nextRequestNumber(requestType) {
  const prefix = REQUEST_NUMBER_PREFIX[requestType] || 'REQ';
  const key = `hub:seq:${requestType}`;
  const n = await redis.incr(key);
  return `${prefix}-${String(n).padStart(6, '0')}`;
}

const {
  DEFAULT_PORTAL_SETTINGS,
  normalizePortalSettings,
  mergePortalSettings,
} = require('./portal-settings');

async function getPortalSettings() {
  const raw = parseJson(await redis.get('hub:settings:portal:general')) || {};
  return normalizePortalSettings({ ...DEFAULT_PORTAL_SETTINGS, ...raw });
}

async function setPortalSettings(patch) {
  const next = mergePortalSettings(await getPortalSettings(), patch || {});
  next.updatedAt = nowIso();
  await redis.set('hub:settings:portal:general', JSON.stringify(next));
  return next;
}

async function getAgingConfig() {
  const raw = await redis.get('hub:settings:aging');
  const cfg = parseJson(raw) || {};
  return { ...DEFAULT_AGING_CONFIG, ...cfg };
}

async function getVisibilitySettings(requestId) {
  const globalRaw = await redis.get('hub:settings:visibility');
  const global = parseJson(globalRaw) || {
    requesterProgress: true,
    clientProgress: false,
    clientSimplifiedStatus: true,
  };
  if (!requestId) return global;
  const per = parseJson(await redis.get(`hub:visibility:${requestId}`));
  return { ...global, ...(per || {}) };
}

async function setVisibilitySettings(requestId, settings) {
  const key = requestId ? `hub:visibility:${requestId}` : 'hub:settings:visibility';
  await redis.set(key, JSON.stringify({ ...settings, updatedAt: nowIso() }));
  return getVisibilitySettings(requestId);
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

async function saveRequest(request) {
  const id = request.id || generateId();
  const rec = { ...request, id, updated_at: nowIso() };
  if (!rec.created_at) rec.created_at = rec.updated_at;
  const p = redis.pipeline();
  p.set(`hub:request:${id}`, JSON.stringify(rec));
  p.zadd('hub:requests:by-date', { score: new Date(rec.created_at).getTime(), member: id });
  if (rec.status) p.zadd(`hub:requests:by-status:${rec.status}`, { score: Date.now(), member: id });
  if (rec.request_type) p.zadd(`hub:requests:by-type:${rec.request_type}`, { score: Date.now(), member: id });
  if (rec.assigned_to) p.zadd(`hub:requests:by-assignee:${rec.assigned_to}`, { score: Date.now(), member: id });
  if (rec.requester_email) p.zadd(`hub:requests:by-requester:${rec.requester_email}`, { score: Date.now(), member: id });
  if (rec.maintainx_id) p.set(`hub:maintainx:${rec.maintainx_id}`, id);
  if (rec.request_number) p.set(`hub:reqnum:${rec.request_number}`, id);
  if (rec.archive_kind && rec.archive_id) {
    p.set(`hub:archive:${rec.archive_kind}:${rec.archive_id}`, id);
  }
  await p.exec();
  return rec;
}

async function getRequest(id) {
  const rec = parseJson(await redis.get(`hub:request:${id}`));
  if (!rec) return null;
  try {
    const { isDemoDataVisible } = require('./demo-visibility');
    if (rec.demo && !isDemoDataVisible()) return null;
  } catch {
    /* ignore */
  }
  return rec;
}

async function getRequestByNumber(num) {
  const id = await redis.get(`hub:reqnum:${num}`);
  if (!id) return null;
  return getRequest(id);
}

async function listRequestIds(opts = {}) {
  const limit = Math.min(opts.limit || 500, 2000);
  let ids = await redis.zrange('hub:requests:by-date', 0, -1, { rev: true });
  if (!ids?.length) return [];
  if (opts.status) {
    const statusIds = await redis.zrange(`hub:requests:by-status:${opts.status}`, 0, -1);
    const set = new Set(statusIds || []);
    ids = ids.filter((id) => set.has(id));
  }
  return ids.slice(0, limit);
}

async function listRequests(opts = {}) {
  const ids = await listRequestIds(opts);
  if (!ids.length) return [];
  const keys = ids.map((id) => `hub:request:${id}`);
  const values = await redis.mget(...keys);
  let records = values.map((v) => parseJson(v)).filter(Boolean);

  if (opts.request_type) {
    records = records.filter((r) => r.request_type === opts.request_type);
  }
  if (opts.priority) {
    records = records.filter((r) => r.priority === opts.priority);
  }
  if (opts.assigned_to) {
    records = records.filter((r) => r.assigned_to === opts.assigned_to);
  }
  if (opts.requester_email) {
    records = records.filter((r) => r.requester_email === opts.requester_email);
  }
  if (opts.location) {
    const loc = opts.location.toLowerCase();
    records = records.filter((r) => (r.location || '').toLowerCase().includes(loc));
  }
  if (opts.company) {
    const c = opts.company.toLowerCase();
    records = records.filter((r) => (r.requester_company || '').toLowerCase().includes(c));
  }
  if (opts.search) {
    const q = opts.search.toLowerCase();
    records = records.filter(
      (r) =>
        (r.title || '').toLowerCase().includes(q) ||
        (r.request_number || '').toLowerCase().includes(q) ||
        (r.requester_name || '').toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q)
    );
  }
  if (opts.date_from) {
    const from = new Date(opts.date_from).getTime();
    records = records.filter((r) => new Date(r.created_at).getTime() >= from);
  }
  if (opts.date_to) {
    const to = new Date(opts.date_to + 'T23:59:59').getTime();
    records = records.filter((r) => new Date(r.created_at).getTime() <= to);
  }
  if (opts.my_email) {
    const email = opts.my_email.toLowerCase();
    records = records.filter(
      (r) =>
        (r.requester_email || '').toLowerCase() === email ||
        (r.assigned_to || '').toLowerCase() === email
    );
  }
  if (opts.open_only) {
    records = records.filter((r) => !['closed', 'canceled', 'rejected'].includes(r.status));
  }

  // WOS-87 — hide demo-tagged rows unless env gate allows them.
  try {
    const { shouldIncludeDemoRows } = require('./demo-visibility');
    if (!shouldIncludeDemoRows(opts)) {
      records = records.filter((r) => !r.demo);
    }
  } catch {
    /* visibility helper optional for pure redis path */
  }

  return records;
}

async function createRequest(input, actorEmail) {
  const requestType = input.request_type || 'general_request';
  const requestNumber = input.request_number || (await nextRequestNumber(requestType));
  const rec = emptyRequest({
    ...input,
    id: generateId(),
    request_number: requestNumber,
    request_type: requestType,
    status: input.status || 'submitted',
    requester_email: (input.requester_email || actorEmail || '').toLowerCase(),
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  await saveRequest(rec);
  return rec;
}

async function findRequestByArchive(kind, archiveId) {
  if (!kind || !archiveId) return null;
  const hubId = await redis.get(`hub:archive:${kind}:${archiveId}`);
  if (!hubId) return null;
  return getRequest(hubId);
}

async function patchRequest(id, patch) {
  const existing = await getRequest(id);
  if (!existing) return null;
  const oldStatus = existing.status;
  const updated = { ...existing, ...patch, id, updated_at: nowIso() };
  const p = redis.pipeline();
  p.set(`hub:request:${id}`, JSON.stringify(updated));
  p.zadd('hub:requests:by-date', { score: new Date(updated.created_at).getTime(), member: id });
  if (oldStatus && patch.status && patch.status !== oldStatus) {
    p.zrem(`hub:requests:by-status:${oldStatus}`, id);
  }
  if (updated.status) {
    p.zadd(`hub:requests:by-status:${updated.status}`, { score: Date.now(), member: id });
  }
  if (existing.assigned_to && patch.assigned_to && patch.assigned_to !== existing.assigned_to) {
    p.zrem(`hub:requests:by-assignee:${existing.assigned_to}`, id);
  }
  if (updated.assigned_to) {
    p.zadd(`hub:requests:by-assignee:${updated.assigned_to}`, { score: Date.now(), member: id });
  }
  if (updated.maintainx_id) p.set(`hub:maintainx:${updated.maintainx_id}`, id);
  if (updated.request_number) p.set(`hub:reqnum:${updated.request_number}`, id);
  await p.exec();
  return { record: updated, oldStatus };
}

// ---------- Status history ----------

async function addStatusHistory({
  request_id,
  old_status,
  new_status,
  changed_by,
  changed_by_type = 'user',
  note = '',
  source = 'portal',
}) {
  const id = generateId();
  const entry = {
    id,
    request_id,
    old_status,
    new_status,
    changed_by: changed_by || 'system',
    changed_by_type,
    changed_at: nowIso(),
    note,
    source,
  };
  const p = redis.pipeline();
  p.set(`hub:status_history:${id}`, JSON.stringify(entry));
  p.zadd(`hub:request:${request_id}:history`, {
    score: Date.now(),
    member: id,
  });
  await p.exec();
  return entry;
}

async function listStatusHistory(requestId) {
  const ids = await redis.zrange(`hub:request:${requestId}:history`, 0, -1);
  if (!ids?.length) return [];
  const keys = ids.map((id) => `hub:status_history:${id}`);
  const values = await redis.mget(...keys);
  return values.map((v) => parseJson(v)).filter(Boolean);
}

// ---------- Workflow steps ----------

async function saveWorkflowStep(step) {
  const id = step.id || generateId();
  const rec = { ...step, id, updated_at: nowIso() };
  const p = redis.pipeline();
  p.set(`hub:workflow:${id}`, JSON.stringify(rec));
  p.zadd(`hub:request:${rec.request_id}:steps`, {
    score: rec.step_order || 0,
    member: id,
  });
  await p.exec();
  return rec;
}

async function getWorkflowStep(id) {
  return parseJson(await redis.get(`hub:workflow:${id}`));
}

async function listWorkflowSteps(requestId) {
  const ids = await redis.zrange(`hub:request:${requestId}:steps`, 0, -1);
  if (!ids?.length) return [];
  const keys = ids.map((id) => `hub:workflow:${id}`);
  const values = await redis.mget(...keys);
  return values.map((v) => parseJson(v)).filter(Boolean).sort((a, b) => (a.step_order || 0) - (b.step_order || 0));
}

async function deleteWorkflowStepsForRequest(requestId) {
  const ids = await redis.zrange(`hub:request:${requestId}:steps`, 0, -1);
  if (!ids?.length) return 0;
  const p = redis.pipeline();
  for (const id of ids) {
    p.del(`hub:workflow:${id}`);
  }
  p.del(`hub:request:${requestId}:steps`);
  await p.exec();
  return ids.length;
}

async function saveWorkflowTemplateOverride(templateId, data) {
  const rec = { ...data, id: templateId, updated_at: nowIso() };
  await redis.set(`hub:workflow_template:${templateId}`, JSON.stringify(rec));
  return rec;
}

async function getWorkflowTemplateOverride(templateId) {
  return parseJson(await redis.get(`hub:workflow_template:${templateId}`));
}

// ---------- Comments ----------

async function addComment({ request_id, author_email, author_name, body, visible_to_client = false }) {
  const id = generateId();
  const entry = {
    id,
    request_id,
    author_email,
    author_name,
    body,
    visible_to_client,
    created_at: nowIso(),
  };
  const p = redis.pipeline();
  p.set(`hub:comment:${id}`, JSON.stringify(entry));
  p.zadd(`hub:request:${request_id}:comments`, { score: Date.now(), member: id });
  await p.exec();
  return entry;
}

async function listComments(requestId, { clientView = false } = {}) {
  const ids = await redis.zrange(`hub:request:${requestId}:comments`, 0, -1);
  if (!ids?.length) return [];
  const keys = ids.map((id) => `hub:comment:${id}`);
  const values = await redis.mget(...keys);
  let comments = values.map((v) => parseJson(v)).filter(Boolean);
  if (clientView) comments = comments.filter((c) => c.visible_to_client);
  return comments;
}

// ---------- Documents ----------

async function saveDocument(doc) {
  const id = doc.id || generateId();
  const rec = { ...doc, id, uploaded_at: doc.uploaded_at || nowIso() };
  const p = redis.pipeline();
  p.set(`hub:document:${id}`, JSON.stringify(rec));
  p.zadd(`hub:request:${rec.request_id}:documents`, { score: Date.now(), member: id });
  await p.exec();
  return rec;
}

async function listDocuments(requestId) {
  const ids = await redis.zrange(`hub:request:${requestId}:documents`, 0, -1);
  if (!ids?.length) return [];
  const keys = ids.map((id) => `hub:document:${id}`);
  const values = await redis.mget(...keys);
  return values.map((v) => parseJson(v)).filter(Boolean);
}

// ---------- Web documents (dashboard-native content) ----------

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
  const id = generateId();
  const rec = emptyWebDocument({ ...input, id, created_at: nowIso(), updated_at: nowIso() });
  const p = redis.pipeline();
  p.set(`hub:web_document:${id}`, JSON.stringify(rec));
  if (rec.request_id) p.set(`hub:request:${rec.request_id}:web_document`, id);
  p.zadd('hub:web_documents:by-date', { score: Date.now(), member: id });
  await p.exec();
  return rec;
}

async function getWebDocument(id) {
  return parseJson(await redis.get(`hub:web_document:${id}`));
}

async function getWebDocumentByRequestId(requestId) {
  const id = await redis.get(`hub:request:${requestId}:web_document`);
  if (!id) return null;
  return getWebDocument(id);
}

async function patchWebDocument(id, patch) {
  const existing = await getWebDocument(id);
  if (!existing) return null;
  const updated = { ...existing, ...patch, id, updated_at: nowIso() };
  await redis.set(`hub:web_document:${id}`, JSON.stringify(updated));
  return updated;
}

// ---------- Notifications ----------

async function createNotification(input) {
  const id = input.id || generateId();
  const email = (input.recipient_email || '').toLowerCase();
  const rec = {
    id,
    recipient_email: email,
    recipient_name: input.recipient_name || email,
    type: input.type || 'workflow_assigned',
    title: input.title || '',
    message: input.message || '',
    request_id: input.request_id || null,
    document_id: input.document_id || null,
    workflow_step_id: input.workflow_step_id || null,
    read_at: input.read_at || null,
    created_at: input.created_at || nowIso(),
  };
  const p = redis.pipeline();
  p.set(`hub:notification:${id}`, JSON.stringify(rec));
  p.zadd(`hub:notifications:by-user:${email}`, { score: Date.now(), member: id });
  if (!rec.read_at) {
    p.zadd(`hub:notifications:unread:${email}`, { score: Date.now(), member: id });
  }
  await p.exec();
  return rec;
}

async function saveNotification(input) {
  return createNotification(input);
}

async function listNotifications(recipientEmail, { limit = 50, unreadOnly = false } = {}) {
  const email = (recipientEmail || '').toLowerCase();
  const key = unreadOnly ? `hub:notifications:unread:${email}` : `hub:notifications:by-user:${email}`;
  const ids = await redis.zrange(key, 0, limit - 1, { rev: true });
  if (!ids?.length) return [];
  const values = await redis.mget(...ids.map((id) => `hub:notification:${id}`));
  return values.map((v) => parseJson(v)).filter(Boolean);
}

async function countUnreadNotifications(recipientEmail) {
  const email = (recipientEmail || '').toLowerCase();
  const ids = await redis.zrange(`hub:notifications:unread:${email}`, 0, -1);
  return ids?.length || 0;
}

async function markNotificationRead(id, recipientEmail) {
  const n = parseJson(await redis.get(`hub:notification:${id}`));
  if (!n) return null;
  if ((n.recipient_email || '').toLowerCase() !== (recipientEmail || '').toLowerCase()) return null;
  n.read_at = nowIso();
  const p = redis.pipeline();
  p.set(`hub:notification:${id}`, JSON.stringify(n));
  p.zrem(`hub:notifications:unread:${n.recipient_email}`, id);
  await p.exec();
  return n;
}

async function markAllNotificationsRead(recipientEmail) {
  const email = (recipientEmail || '').toLowerCase();
  const ids = await redis.zrange(`hub:notifications:unread:${email}`, 0, -1);
  for (const id of ids || []) {
    await markNotificationRead(id, email);
  }
  return { count: ids?.length || 0 };
}

// ---------- Audit trail ----------

async function addAuditEvent(input) {
  const id = generateId();
  const entry = {
    id,
    request_id: input.request_id,
    document_id: input.document_id || null,
    workflow_step_id: input.workflow_step_id || null,
    event_type: input.event_type,
    actor_email: input.actor_email || 'system',
    actor_name: input.actor_name || null,
    detail: input.detail || '',
    metadata: input.metadata || {},
    created_at: nowIso(),
  };
  const p = redis.pipeline();
  p.set(`hub:audit:${id}`, JSON.stringify(entry));
  p.zadd(`hub:request:${input.request_id}:audit`, { score: Date.now(), member: id });
  await p.exec();
  return entry;
}

async function listAuditEvents(requestId) {
  const ids = await redis.zrange(`hub:request:${requestId}:audit`, 0, -1);
  if (!ids?.length) return [];
  const values = await redis.mget(...ids.map((id) => `hub:audit:${id}`));
  return values.map((v) => parseJson(v)).filter(Boolean);
}

async function listAllWaitingSteps() {
  const reqIds = await redis.zrange('hub:requests:by-date', 0, 499, { rev: true });
  const out = [];
  for (const rid of reqIds || []) {
    const steps = await listWorkflowSteps(rid);
    out.push(...steps.filter((s) => ['waiting', 'pending', 'not_started', 'in_progress'].includes(s.status)));
  }
  return out;
}

// ---------- Action links ----------

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function createActionLink({
  request_id,
  workflow_step_id,
  recipient_email,
  action_type,
  expires_in_hours = 72,
}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const id = generateId();
  const expiresAt = new Date(Date.now() + expires_in_hours * 3600 * 1000).toISOString();
  const link = {
    id,
    request_id,
    workflow_step_id,
    token_hash: tokenHash,
    recipient_email: (recipient_email || '').toLowerCase(),
    action_type,
    expires_at: expiresAt,
    used_at: null,
    revoked_at: null,
    created_at: nowIso(),
  };
  const p = redis.pipeline();
  p.set(`hub:action_link:${id}`, JSON.stringify(link));
  p.set(`hub:action_token:${tokenHash}`, id);
  await p.exec();
  return { link, token };
}

async function getActionLinkByToken(token) {
  const tokenHash = hashToken(token);
  const linkId = await redis.get(`hub:action_token:${tokenHash}`);
  if (!linkId) return null;
  return parseJson(await redis.get(`hub:action_link:${linkId}`));
}

async function markActionLinkUsed(id) {
  const link = parseJson(await redis.get(`hub:action_link:${id}`));
  if (!link) return null;
  if (link.used_at || link.revoked_at) return null;
  link.used_at = nowIso();
  const p = redis.pipeline();
  p.set(`hub:action_link:${id}`, JSON.stringify(link));
  if (link.token_hash) p.del(`hub:action_token:${link.token_hash}`);
  await p.exec();
  return link;
}

async function revokeActionLink(id) {
  const link = parseJson(await redis.get(`hub:action_link:${id}`));
  if (!link) return null;
  link.revoked_at = nowIso();
  await redis.set(`hub:action_link:${id}`, JSON.stringify(link));
  return link;
}

// ---------- Integration events (Redis stub — Postgres is production outbox) ----------

async function createIntegrationEvent(input) {
  return queueIntegrationEvent(input);
}

async function queueIntegrationEvent({ event_type, request_id, workflow_step_id, document_id, payload, dedupe_key, status }) {
  const id = generateId();
  const ev = {
    id,
    event_type,
    request_id: request_id || null,
    workflow_step_id: workflow_step_id || null,
    document_id: document_id || null,
    payload: payload || {},
    status: status || 'pending',
    attempts: 0,
    dedupe_key: dedupe_key || payload?.dedupe_key || null,
    last_error: null,
    created_at: nowIso(),
    sent_at: null,
    processed_at: null,
    next_attempt_at: null,
    last_attempt_at: null,
    locked_at: null,
    locked_by: null,
    source_system: 'wos_hub',
    destination_system: event_type === 'inbound_email' ? 'inbound_audit' : 'n8n',
  };
  const p = redis.pipeline();
  p.set(`hub:integration_event:${id}`, JSON.stringify(ev));
  p.zadd('hub:integration_events:pending', { score: Date.now(), member: id });
  await p.exec();
  return ev;
}

async function updateIntegrationEvent(id, patch) {
  const ev = parseJson(await redis.get(`hub:integration_event:${id}`));
  if (!ev) return null;
  const updated = { ...ev, ...patch, updated_at: nowIso() };
  await redis.set(`hub:integration_event:${id}`, JSON.stringify(updated));
  if (updated.status === 'sent' || updated.status === 'processed') {
    await redis.zrem('hub:integration_events:pending', id);
  }
  return updated;
}

async function listPendingIntegrationEvents(limit = 20) {
  const ids = await redis.zrange('hub:integration_events:pending', 0, Math.min(limit, 200) - 1);
  if (!ids?.length) return [];
  const keys = ids.map((id) => `hub:integration_event:${id}`);
  const values = await redis.mget(...keys);
  return values.map((v) => parseJson(v)).filter(Boolean);
}

async function countPendingIntegrationEvents() {
  return (await redis.zcard('hub:integration_events:pending')) || 0;
}

async function findIntegrationEventByDedupeKey(_eventType, _dedupeKey) {
  return null;
}

async function claimIntegrationEvents() {
  return [];
}

async function markIntegrationEventProcessed(id, patch = {}) {
  return updateIntegrationEvent(id, {
    status: patch.status || 'processed',
    processed_at: nowIso(),
    sent_at: patch.sent_at || nowIso(),
    ...patch,
  });
}

async function markIntegrationEventFailed(id, errorMessage) {
  const ev = parseJson(await redis.get(`hub:integration_event:${id}`));
  if (!ev) return null;
  const attempts = (ev.attempts || 0) + 1;
  return updateIntegrationEvent(id, {
    status: attempts >= 8 ? 'dead_lettered' : 'retrying',
    attempts,
    last_error: errorMessage,
    last_attempt_at: nowIso(),
  });
}

async function releaseStaleIntegrationEventLocks() {
  return [];
}

// ---------- Email delivery outbox (Redis stub) ----------

async function queueEmailDeliveryEvent(input) {
  return createEmailDeliveryEvent(input);
}

async function createEmailDeliveryEvent(input) {
  const id = generateId();
  const ev = {
    id,
    event_type: input.event_type || 'email.send',
    status: input.status || 'pending',
    payload: input.payload || {},
    dedupe_key: input.dedupe_key || null,
    attempts: 0,
    request_id: input.request_id || null,
    created_at: nowIso(),
    updated_at: nowIso(),
    processed_at: null,
    next_attempt_at: null,
    last_attempt_at: null,
    locked_at: null,
    locked_by: null,
    last_error: null,
  };
  await redis.set(`hub:email_outbox:${id}`, JSON.stringify(ev));
  if (ev.dedupe_key) await redis.set(`hub:email_outbox:dedupe:${ev.dedupe_key}`, id);
  return ev;
}

async function findEmailDeliveryEventByDedupeKey(dedupeKey) {
  if (!dedupeKey) return null;
  const id = await redis.get(`hub:email_outbox:dedupe:${dedupeKey}`);
  if (!id) return null;
  return parseJson(await redis.get(`hub:email_outbox:${id}`));
}

async function claimEmailDeliveryEvents() {
  return [];
}

async function markEmailDeliveryProcessed(id, patch = {}) {
  const ev = parseJson(await redis.get(`hub:email_outbox:${id}`));
  if (!ev) return null;
  const updated = {
    ...ev,
    ...patch,
    status: 'processed',
    processed_at: nowIso(),
    updated_at: nowIso(),
  };
  await redis.set(`hub:email_outbox:${id}`, JSON.stringify(updated));
  return updated;
}

async function markEmailDeliveryFailed(id, errorMessage) {
  const ev = parseJson(await redis.get(`hub:email_outbox:${id}`));
  if (!ev) return null;
  const attempts = (ev.attempts || 0) + 1;
  const updated = {
    ...ev,
    attempts,
    last_error: errorMessage,
    last_attempt_at: nowIso(),
    status: attempts >= 8 ? 'dead_lettered' : 'retrying',
    updated_at: nowIso(),
  };
  await redis.set(`hub:email_outbox:${id}`, JSON.stringify(updated));
  return updated;
}

async function releaseStaleEmailDeliveryLocks() {
  return [];
}

async function listPendingEmailDeliveryEvents(limit = 20) {
  return [];
}

async function countPendingEmailDeliveryEvents() {
  return 0;
}

async function getDeliveryStatusSummary() {
  return {
    integration: {
      pending: 0,
      retrying: 0,
      processing: 0,
      dead_lettered: 0,
      failed: 0,
      recent_failures: [],
    },
    email: {
      pending: 0,
      retrying: 0,
      processing: 0,
      dead_lettered: 0,
      failed: 0,
      recent_failures: [],
    },
  };
}

/**
 * Remove a demo-tagged request and all indexed children (dev seed clear only).
 */
async function deleteDemoRequest(requestId) {
  const req = await getRequest(requestId);
  if (!req || !req.demo) return false;

  const stepIds = (await redis.zrange(`hub:request:${requestId}:steps`, 0, -1)) || [];
  const historyIds = (await redis.zrange(`hub:request:${requestId}:history`, 0, -1)) || [];
  const commentIds = (await redis.zrange(`hub:request:${requestId}:comments`, 0, -1)) || [];
  const docIds = (await redis.zrange(`hub:request:${requestId}:documents`, 0, -1)) || [];

  const p = redis.pipeline();
  p.del(`hub:request:${requestId}`);
  p.zrem('hub:requests:by-date', requestId);
  if (req.status) p.zrem(`hub:requests:by-status:${req.status}`, requestId);
  if (req.request_type) p.zrem(`hub:requests:by-type:${req.request_type}`, requestId);
  if (req.assigned_to) p.zrem(`hub:requests:by-assignee:${req.assigned_to}`, requestId);
  if (req.requester_email) p.zrem(`hub:requests:by-requester:${req.requester_email}`, requestId);
  if (req.maintainx_id) p.del(`hub:maintainx:${req.maintainx_id}`);
  if (req.request_number) p.del(`hub:reqnum:${req.request_number}`);
  if (req.archive_kind && req.archive_id) {
    p.del(`hub:archive:${req.archive_kind}:${req.archive_id}`);
  }
  p.del(`hub:request:${requestId}:steps`);
  p.del(`hub:request:${requestId}:history`);
  p.del(`hub:request:${requestId}:comments`);
  p.del(`hub:request:${requestId}:documents`);
  p.del(`hub:visibility:${requestId}`);

  for (const id of stepIds) p.del(`hub:workflow:${id}`);
  for (const id of historyIds) p.del(`hub:status_history:${id}`);
  for (const id of commentIds) p.del(`hub:comment:${id}`);
  for (const id of docIds) p.del(`hub:document:${id}`);

  await p.exec();

  const linkIds = (await redis.smembers(`hub:request:${requestId}:action_links`)) || [];
  for (const linkId of linkIds) {
    const link = parseJson(await redis.get(`hub:action_link:${linkId}`));
    const lp = redis.pipeline();
    lp.del(`hub:action_link:${linkId}`);
    if (link?.token_hash) lp.del(`hub:action_token:${link.token_hash}`);
    await lp.exec();
  }
  await redis.del(`hub:request:${requestId}:action_links`);

  const eventIds =
    (await redis.zrange(`hub:request:${requestId}:integration_events`, 0, -1)) || [];
  for (const evId of eventIds) {
    const ep = redis.pipeline();
    ep.del(`hub:integration_event:${evId}`);
    ep.zrem('hub:integration_events:pending', evId);
    await ep.exec();
  }
  await redis.del(`hub:request:${requestId}:integration_events`);

  await redis.srem('hub:demo:requests', requestId);
  return true;
}

module.exports = {
  redis,
  nowIso,
  generateId,
  getAgingConfig,
  getVisibilitySettings,
  setVisibilitySettings,
  getPortalSettings,
  setPortalSettings,
  emptyRequest,
  createRequest,
  saveRequest,
  getRequest,
  getRequestByNumber,
  findRequestByArchive,
  listRequests,
  patchRequest,
  addStatusHistory,
  listStatusHistory,
  saveWorkflowStep,
  getWorkflowStep,
  listWorkflowSteps,
  deleteWorkflowStepsForRequest,
  saveWorkflowTemplateOverride,
  getWorkflowTemplateOverride,
  addComment,
  listComments,
  saveDocument,
  listDocuments,
  createWebDocument,
  getWebDocument,
  getWebDocumentByRequestId,
  patchWebDocument,
  emptyWebDocument,
  createNotification,
  saveNotification,
  listNotifications,
  countUnreadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  addAuditEvent,
  listAuditEvents,
  listAllWaitingSteps,
  createActionLink,
  getActionLinkByToken,
  markActionLinkUsed,
  revokeActionLink,
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
  queueEmailDeliveryEvent,
  createEmailDeliveryEvent,
  findEmailDeliveryEventByDedupeKey,
  claimEmailDeliveryEvents,
  markEmailDeliveryProcessed,
  markEmailDeliveryFailed,
  releaseStaleEmailDeliveryLocks,
  listPendingEmailDeliveryEvents,
  countPendingEmailDeliveryEvents,
  getDeliveryStatusSummary,
  deleteDemoRequest,
  hashToken,
};
