// n8n webhook dispatch + MaintainX work-order handoff (server-side only).

const store = require('./store/index.js');
const { transitionRequestStatus } = require('./workflow');
const integrationEvents = require('./integration-events');

const MAINTAINX_BASE = 'https://api.getmaintainx.com/v1';

const WEBHOOK_ENV_MAP = {
  'request.created': 'N8N_WEBHOOK_REQUEST_CREATED',
  'request.status_changed': 'N8N_WEBHOOK_REQUEST_STATUS_CHANGED',
  'request.assigned': 'N8N_WEBHOOK_REQUEST_ASSIGNED',
  'workflow_step.created': 'N8N_WEBHOOK_WORKFLOW_STEP_CREATED',
  'workflow_step.completed': 'N8N_WEBHOOK_WORKFLOW_STEP_COMPLETED',
  'workflow_step.rejected': 'N8N_WEBHOOK_WORKFLOW_STEP_REJECTED',
  'document.signed': 'N8N_WEBHOOK_DOCUMENT_SIGNED',
  'document.approved': 'N8N_WEBHOOK_DOCUMENT_APPROVED',
  'document.uploaded': 'N8N_WEBHOOK_DOCUMENT_UPLOADED',
  'work_order.sent_to_maintainx': 'N8N_WEBHOOK_WORK_ORDER_SENT',
  'work_order.maintainx_status_changed': 'N8N_WEBHOOK_WORK_ORDER_MX_STATUS',
  'request.closed': 'N8N_WEBHOOK_REQUEST_CLOSED',
  'notification.created': 'N8N_WEBHOOK_NOTIFICATION_CREATED',
};

function buildEventPayload(eventType, request, extra = {}) {
  return integrationEvents.sanitizeIntegrationPayload({
    event_type: eventType,
    request_id: request?.id,
    request_number: request?.request_number,
    request_type: request?.request_type,
    status: request?.status,
    priority: request?.priority,
    requester: {
      name: request?.requester_name,
      email: request?.requester_email,
      company: request?.requester_company,
    },
    assigned_to: request?.assigned_to,
    maintainx_id: request?.maintainx_id,
    created_at: request?.created_at,
    ...extra,
  });
}

async function dispatchN8nWebhook(eventType, payload) {
  const envKey = WEBHOOK_ENV_MAP[eventType];
  const url = envKey ? process.env[envKey] : process.env.N8N_WEBHOOK_DEFAULT;
  if (!url) return { skipped: true, reason: 'No webhook URL configured' };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, body: text };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function buildDedupeKey(eventType, request, extra = {}) {
  const parts = [
    eventType,
    request?.id || 'none',
    extra.new_status || '',
    extra.step?.id || '',
    extra.maintainx_id || '',
  ];
  return parts.join(':');
}

async function markRedisDedupe(dedupeKey) {
  if (!dedupeKey || !store.redis) return;
  try {
    await store.redis.set(`hub:n8n:dedupe:${dedupeKey}`, '1', { ex: 60 * 60 * 24 * 90 });
  } catch {
    // ignore
  }
}

async function isRedisDedupeHit(dedupeKey) {
  if (!dedupeKey || !store.redis) return false;
  try {
    return (await store.redis.get(`hub:n8n:dedupe:${dedupeKey}`)) === '1';
  } catch {
    return false;
  }
}

async function applyDispatchResult(ev, result, dedupeKey) {
  if (result.ok) {
    await markRedisDedupe(dedupeKey);
    if (typeof store.markIntegrationEventProcessed === 'function') {
      return store.markIntegrationEventProcessed(ev.id, {
        status: 'processed',
        attempts: (ev.attempts || 0) + 1,
      });
    }
    return store.updateIntegrationEvent(
      ev.id,
      integrationEvents.buildProcessedPatch(ev, { status: 'processed' })
    );
  }

  if (result.skipped) {
    return store.updateIntegrationEvent(
      ev.id,
      integrationEvents.buildSkippedWebhookPatch(ev, result.reason || 'No webhook configured')
    );
  }

  const errMsg = result.error || result.body || `HTTP ${result.status}`;
  if (typeof store.markIntegrationEventFailed === 'function') {
    return store.markIntegrationEventFailed(ev.id, errMsg);
  }
  return store.updateIntegrationEvent(ev.id, integrationEvents.buildRetryPatch(ev, errMsg));
}

/**
 * Queue-first: always persist integration_events before optional inline dispatch.
 * INTEGRATION_DISPATCH_MODE=inline (default) — transitional inline delivery after insert.
 * INTEGRATION_DISPATCH_MODE=queued — persist only; WOS-37 worker delivers.
 */
async function queueN8nEvent(eventType, request, extra = {}) {
  const dedupeKey = buildDedupeKey(eventType, request, extra);

  if (await isRedisDedupeHit(dedupeKey)) {
    return { id: null, skipped: true, dedupe_key: dedupeKey, reason: 'redis_dedupe' };
  }

  const payload = buildEventPayload(eventType, request, extra);
  payload.dedupe_key = dedupeKey;

  const createFn = store.createIntegrationEvent || store.queueIntegrationEvent;
  const ev = await createFn({
    event_type: eventType,
    request_id: request?.id,
    workflow_step_id: extra.step?.id || null,
    dedupe_key: dedupeKey,
    payload,
    destination_system: 'n8n',
    source_system: 'wos_hub',
  });

  if (ev?.dedupe_hit) {
    if (integrationEvents.isProcessedStatus(ev.status)) {
      return { ...ev, skipped: true, dedupe_key: dedupeKey, reason: 'db_dedupe' };
    }
    if (!integrationEvents.shouldDispatchInline()) {
      return { ...ev, skipped: true, dedupe_key: dedupeKey, reason: 'existing_pending' };
    }
  }

  payload.integration_event_id = ev.id;

  if (!integrationEvents.shouldDispatchInline()) {
    return { ...ev, queued: true, dispatch_mode: 'queued' };
  }

  const result = await dispatchN8nWebhook(eventType, payload);
  const updated = await applyDispatchResult(ev, result, dedupeKey);
  return updated || ev;
}

async function dispatchIntegrationEventRecord(ev) {
  if (!ev || integrationEvents.isProcessedStatus(ev.status)) {
    return { id: ev?.id, ok: true, skipped: true, reason: 'already_processed' };
  }

  const dedupeKey = ev.payload?.dedupe_key || ev.dedupe_key;
  if (await isRedisDedupeHit(dedupeKey)) {
    if (typeof store.markIntegrationEventProcessed === 'function') {
      await store.markIntegrationEventProcessed(ev.id, { status: 'processed' });
    } else {
      await store.updateIntegrationEvent(ev.id, {
        status: 'sent',
        sent_at: store.nowIso(),
        processed_at: store.nowIso(),
      });
    }
    return { id: ev.id, ok: true, deduped: true };
  }

  const payload = { ...(ev.payload || {}), integration_event_id: ev.id };
  const result = await dispatchN8nWebhook(ev.event_type, payload);
  await applyDispatchResult(ev, result, dedupeKey);
  return { id: ev.id, ok: !!result.ok, skipped: !!result.skipped, error: result.error || result.body };
}

async function retryPendingIntegrationEvents(limit = 20) {
  if (typeof store.releaseStaleIntegrationEventLocks === 'function') {
    await store.releaseStaleIntegrationEventLocks().catch(() => []);
  }

  const pending = store.listPendingIntegrationEvents
    ? await store.listPendingIntegrationEvents(limit)
    : [];
  const results = [];
  for (const ev of pending || []) {
    if (!ev || integrationEvents.isProcessedStatus(ev.status)) continue;
    if (ev.event_type === 'inbound_email') continue;

    const dedupeKey = ev.payload?.dedupe_key || ev.dedupe_key;
    if (await isRedisDedupeHit(dedupeKey)) {
      if (typeof store.markIntegrationEventProcessed === 'function') {
        await store.markIntegrationEventProcessed(ev.id, { status: 'processed' });
      } else {
        await store.updateIntegrationEvent(ev.id, {
          status: 'sent',
          sent_at: store.nowIso(),
          processed_at: store.nowIso(),
        });
      }
      results.push({ id: ev.id, ok: true, deduped: true });
      continue;
    }

    const outcome = await dispatchIntegrationEventRecord(ev);
    results.push(outcome);
  }
  return results;
}

/**
 * Claim and dispatch integration events (WOS-37 hub-worker).
 */
async function processPendingIntegrationEvents({
  limit = 20,
  workerId = 'integration-worker',
  staleLockMs,
  releaseStaleLocks = true,
} = {}) {
  if (releaseStaleLocks && typeof store.releaseStaleIntegrationEventLocks === 'function') {
    await store.releaseStaleIntegrationEventLocks(staleLockMs).catch(() => []);
  }
  if (typeof store.claimIntegrationEvents !== 'function') {
    return [];
  }

  const claimed = await store.claimIntegrationEvents({ limit, workerId });
  const results = [];
  for (const ev of claimed || []) {
    if (ev.event_type === 'inbound_email') {
      results.push({ id: ev.id, ok: false, skipped: true, reason: 'inbound_email_not_deliverable' });
      continue;
    }
    try {
      const outcome = await dispatchIntegrationEventRecord(ev);
      results.push(outcome);
    } catch (err) {
      console.warn('[integrations] worker dispatch error:', ev.id, err.message);
      if (typeof store.markIntegrationEventFailed === 'function') {
        await store.markIntegrationEventFailed(ev.id, err.message).catch(() => null);
      }
      results.push({ id: ev.id, ok: false, error: err.message });
    }
  }
  return results;
}

async function maintainxFetch(path, method, body, apiKey) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  };
  if (process.env.MAINTAINX_ORG_ID) {
    headers['x-organization-id'] = process.env.MAINTAINX_ORG_ID;
  }
  const opts = { method, headers };
  if (body && (method === 'POST' || method === 'PUT')) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${MAINTAINX_BASE}${path}`, opts);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

/**
 * Create central request first, POST work order to MaintainX, update IDs.
 */
async function createWorkOrderInMaintainX(requestId, workOrderBody, actorEmail) {
  const apiKey = process.env.MAINTAINX_API_KEY;
  if (!apiKey) {
    return { error: 'Server misconfigured: MAINTAINX_API_KEY', status: 500 };
  }

  let request = await store.getRequest(requestId);
  if (!request) return { error: 'Request not found', status: 404 };

  const mxResult = await maintainxFetch('/workorders', 'POST', workOrderBody, apiKey);
  if (!mxResult.ok) {
    await transitionRequestStatus(requestId, 'failed_sync', {
      changed_by: actorEmail,
      changed_by_type: 'maintainx',
      note: mxResult.json?.error || 'MaintainX create failed',
      source: 'maintainx',
    });
    return { error: 'MaintainX sync failed', status: 502, detail: mxResult.json };
  }

  const wo = mxResult.json?.workOrder || mxResult.json;
  const maintainxId = wo?.id ?? wo?.workOrderId;
  const sequentialId =
    wo?.sequentialId ?? wo?.sequential_id ?? wo?.publicId ?? (maintainxId ? `WO-${maintainxId}` : null);

  const { record } = await store.patchRequest(requestId, {
    maintainx_id: maintainxId,
    maintainx_sequential_id: sequentialId,
    maintainx_status: wo?.status || 'open',
    maintainx_synced_at: store.nowIso(),
  });

  await transitionRequestStatus(requestId, 'sent_to_maintainx', {
    changed_by: actorEmail,
    changed_by_type: 'maintainx',
    source: 'maintainx',
  });

  await queueN8nEvent('work_order.sent_to_maintainx', record, {
    maintainx_id: maintainxId,
    maintainx_sequential_id: sequentialId,
  });

  return { request: record, maintainx: wo };
}

async function retryMaintainXSync(requestId, workOrderBody, actorEmail) {
  const request = await store.getRequest(requestId);
  if (!request) return { error: 'Request not found', status: 404 };
  if (request.maintainx_id) {
    return { error: 'Request already linked to MaintainX', status: 409 };
  }
  return createWorkOrderInMaintainX(requestId, workOrderBody, actorEmail);
}

async function fetchMaintainXStatus(requestId) {
  const request = await store.getRequest(requestId);
  if (!request?.maintainx_id) {
    return { error: 'No MaintainX ID on request', status: 404 };
  }
  const apiKey = process.env.MAINTAINX_API_KEY;
  if (!apiKey) return { error: 'MAINTAINX_API_KEY not set', status: 500 };

  const mxResult = await maintainxFetch(`/workorders/${request.maintainx_id}`, 'GET', null, apiKey);
  if (!mxResult.ok) {
    return { error: 'Failed to fetch MaintainX status', status: mxResult.status, detail: mxResult.json };
  }

  const wo = mxResult.json?.workOrder || mxResult.json;
  const mxStatus = wo?.status || wo?.state;
  const oldMx = request.maintainx_status;
  await store.patchRequest(requestId, {
    maintainx_status: mxStatus,
    maintainx_synced_at: store.nowIso(),
  });

  if (oldMx !== mxStatus) {
    const updated = await store.getRequest(requestId);
    await queueN8nEvent('work_order.maintainx_status_changed', updated, {
      old_maintainx_status: oldMx,
      maintainx_status: mxStatus,
    });
    if (mxStatus && /complete|done|closed/i.test(mxStatus)) {
      await transitionRequestStatus(requestId, 'maintainx_in_progress', {
        changed_by: 'maintainx',
        changed_by_type: 'maintainx',
        source: 'maintainx',
      });
    }
  }

  return { request: await store.getRequest(requestId), maintainx: wo };
}

module.exports = {
  buildEventPayload,
  queueN8nEvent,
  dispatchN8nWebhook,
  dispatchIntegrationEventRecord,
  processPendingIntegrationEvents,
  retryPendingIntegrationEvents,
  createWorkOrderInMaintainX,
  retryMaintainXSync,
  fetchMaintainXStatus,
};
