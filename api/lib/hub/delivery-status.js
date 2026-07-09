/**
 * WOS-40 — Admin delivery queue health summary (sanitized).
 */
const { sanitizeIntegrationPayload, getIntegrationDispatchMode } = require('./integration-events');
const { getEmailDeliveryMode, DEFAULT_MAX_ATTEMPTS: EMAIL_MAX } = require('./email-delivery');

function getIntegrationMaxAttempts() {
  return Number(process.env.INTEGRATION_MAX_ATTEMPTS || 8);
}

function sanitizeIntegrationFailureRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    event_type: row.event_type,
    status: row.status,
    attempts: row.attempts ?? 0,
    last_error: row.last_error || null,
    last_attempt_at: row.last_attempt_at || null,
    next_attempt_at: row.next_attempt_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    processed_at: row.processed_at || null,
    request_id: row.request_id || null,
    source_system: row.source_system || null,
    destination_system: row.destination_system || null,
    locked_at: row.locked_at || null,
    locked_by: row.locked_by || null,
  };
}

function sanitizeEmailFailureRow(row) {
  if (!row) return null;
  const payload = sanitizeIntegrationPayload(row.payload || {});
  return {
    id: row.id,
    event_type: row.event_type,
    status: row.status,
    attempts: row.attempts ?? 0,
    last_error: row.last_error || null,
    last_attempt_at: row.last_attempt_at || null,
    next_attempt_at: row.next_attempt_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    processed_at: row.processed_at || null,
    request_id: row.request_id || payload.request_id || null,
    recipient_email: payload.recipient_email || payload.email?.to || null,
    notification_id: payload.notification_id || null,
    channel: payload.channel || payload.email?.template_key || null,
    notification_dedupe_key: payload.notification_dedupe_key || null,
    action_link_id: payload.action_link_id || null,
  };
}

function buildWorkerSummary() {
  return {
    integration_dispatch_mode: getIntegrationDispatchMode(),
    email_delivery_mode: getEmailDeliveryMode(),
    hub_worker_mode: process.env.HUB_WORKER_MODE || 'continuous',
    max_attempts: {
      integration: getIntegrationMaxAttempts(),
      email: EMAIL_MAX,
    },
    poll_interval_ms: Number(process.env.HUB_WORKER_POLL_INTERVAL_MS || 5000),
    batch_size: Number(process.env.HUB_WORKER_BATCH_SIZE || 10),
    stale_lock_ms: Number(process.env.HUB_WORKER_STALE_LOCK_MS || 300_000),
  };
}

async function getDeliveryStatusSummary(store, { limit = 10 } = {}) {
  const fetchFn = store.getDeliveryStatusSummary;
  if (typeof fetchFn !== 'function') {
    return {
      ok: true,
      generated_at: new Date().toISOString(),
      integration_events: {
        pending: 0,
        retrying: 0,
        processing: 0,
        dead_lettered: 0,
        failed: 0,
        recent_failures: [],
      },
      email_delivery: {
        pending: 0,
        retrying: 0,
        processing: 0,
        dead_lettered: 0,
        failed: 0,
        recent_failures: [],
      },
      worker: buildWorkerSummary(),
      store_mode: process.env.HUB_STORE_MODE || 'unknown',
    };
  }

  const raw = await fetchFn(Math.min(Math.max(1, limit), 50));
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    integration_events: {
      pending: raw.integration?.pending ?? 0,
      retrying: raw.integration?.retrying ?? 0,
      processing: raw.integration?.processing ?? 0,
      dead_lettered: raw.integration?.dead_lettered ?? 0,
      failed: raw.integration?.failed ?? 0,
      recent_failures: (raw.integration?.recent_failures || [])
        .map(sanitizeIntegrationFailureRow)
        .filter(Boolean),
    },
    email_delivery: {
      pending: raw.email?.pending ?? 0,
      retrying: raw.email?.retrying ?? 0,
      processing: raw.email?.processing ?? 0,
      dead_lettered: raw.email?.dead_lettered ?? 0,
      failed: raw.email?.failed ?? 0,
      recent_failures: (raw.email?.recent_failures || [])
        .map(sanitizeEmailFailureRow)
        .filter(Boolean),
    },
    worker: buildWorkerSummary(),
    store_mode: process.env.HUB_STORE_MODE || 'unknown',
  };
}

module.exports = {
  getDeliveryStatusSummary,
  sanitizeIntegrationFailureRow,
  sanitizeEmailFailureRow,
  buildWorkerSummary,
};
