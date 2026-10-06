/**
 * WOS-35 — Standardized integration event helpers (Phase 1 outbox on integration_events).
 * Does not run workers; provides creation, dispatch mode, retry scheduling, and payload hygiene.
 */

const SENSITIVE_KEYS = new Set([
  'token',
  'action_token',
  'action_link_token',
  'secret',
  'password',
  'authorization',
  'api_key',
  'webhook_secret',
]);

const TERMINAL_STATUSES = new Set([
  'processed',
  'sent',
  'failed',
  'dead_lettered',
  'cancelled',
  'unmatched',
  'ambiguous',
  'invalid_token',
  'duplicate',
  'received',
]);

const DELIVERY_QUEUE_STATUSES = new Set(['pending', 'retrying']);

const DEFAULT_MAX_ATTEMPTS = Number(process.env.INTEGRATION_MAX_ATTEMPTS || 8);
const DEFAULT_BASE_BACKOFF_MS = Number(process.env.INTEGRATION_RETRY_BASE_MS || 60_000);

function getIntegrationDispatchMode() {
  const mode = String(process.env.INTEGRATION_DISPATCH_MODE || 'inline').toLowerCase();
  return mode === 'queued' ? 'queued' : 'inline';
}

function shouldDispatchInline() {
  return getIntegrationDispatchMode() === 'inline';
}

function inferDestinationSystem(eventType) {
  if (eventType === 'inbound_email') return 'inbound_audit';
  return 'n8n';
}

function inferSourceSystem(eventType) {
  if (eventType === 'inbound_email') return 'inbound_email';
  return 'wos_hub';
}

function redactString(value) {
  const s = String(value);
  if (s.length > 80 && /^(data:|eyJ|[A-Za-z0-9+/=]{40,})/.test(s)) {
    return '[redacted]';
  }
  if (/[?&]t=[^&]+/.test(s)) {
    return s.replace(/([?&]t=)[^&]+/g, '$1[redacted]');
  }
  return s;
}

function sanitizeIntegrationPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }
  const out = {};
  for (const [key, value] of Object.entries(payload)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lower) || lower.includes('token') || lower.includes('secret')) {
      out[key] = '[redacted]';
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = sanitizeIntegrationPayload(value);
    } else if (typeof value === 'string') {
      out[key] = redactString(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function normalizeCreateInput(input = {}) {
  const eventType = input.event_type;
  const dedupeKey =
    input.dedupe_key || input.event_key || input.payload?.dedupe_key || input.payload?.event_key || null;
  const payload = sanitizeIntegrationPayload(input.payload || {});
  if (dedupeKey && !payload.dedupe_key) payload.dedupe_key = dedupeKey;

  return {
    event_type: eventType,
    request_id: input.request_id || null,
    document_id: input.document_id || null,
    workflow_step_id: input.workflow_step_id || null,
    payload,
    status: input.status || 'pending',
    attempts: input.attempts ?? 0,
    dedupe_key: dedupeKey,
    event_key: dedupeKey,
    last_error: input.last_error || null,
    next_attempt_at: input.next_attempt_at || null,
    source_system: input.source_system || inferSourceSystem(eventType),
    destination_system: input.destination_system || inferDestinationSystem(eventType),
  };
}

function computeNextAttemptAt(attempts, baseMs = DEFAULT_BASE_BACKOFF_MS) {
  const n = Math.max(1, Number(attempts) || 1);
  const delayMs = Math.min(baseMs * 2 ** (n - 1), 24 * 60 * 60 * 1000);
  return new Date(Date.now() + delayMs).toISOString();
}

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(status);
}

function isDeliveryQueueStatus(status) {
  return DELIVERY_QUEUE_STATUSES.has(status);
}

function isProcessedStatus(status) {
  return status === 'processed' || status === 'sent';
}

function resolveFailureStatus(attempts, maxAttempts = DEFAULT_MAX_ATTEMPTS) {
  if (attempts >= maxAttempts) return 'dead_lettered';
  return 'retrying';
}

function buildRetryPatch(existing, errorMessage, options = {}) {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const attempts = (existing.attempts || 0) + 1;
  const now = new Date().toISOString();
  const status = resolveFailureStatus(attempts, maxAttempts);
  const patch = {
    attempts,
    last_error: errorMessage || existing.last_error || 'Unknown error',
    last_attempt_at: now,
    updated_at: now,
    locked_at: null,
    locked_by: null,
  };
  if (status === 'dead_lettered') {
    patch.status = 'dead_lettered';
    patch.next_attempt_at = null;
  } else {
    patch.status = 'retrying';
    patch.next_attempt_at = computeNextAttemptAt(attempts, options.baseBackoffMs);
  }
  return patch;
}

function buildProcessedPatch(existing, extra = {}) {
  const now = new Date().toISOString();
  return {
    status: extra.status || 'processed',
    attempts: extra.attempts ?? (existing.attempts || 0) + 1,
    last_error: null,
    last_attempt_at: now,
    processed_at: now,
    sent_at: extra.sent_at || now,
    updated_at: now,
    locked_at: null,
    locked_by: null,
    next_attempt_at: null,
    ...extra,
  };
}

function buildSkippedWebhookPatch(existing, reason) {
  return {
    status: 'pending',
    attempts: existing.attempts || 0,
    last_error: reason || 'No webhook configured',
    updated_at: new Date().toISOString(),
    next_attempt_at: null,
  };
}

module.exports = {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_BASE_BACKOFF_MS,
  TERMINAL_STATUSES,
  DELIVERY_QUEUE_STATUSES,
  getIntegrationDispatchMode,
  shouldDispatchInline,
  inferDestinationSystem,
  inferSourceSystem,
  sanitizeIntegrationPayload,
  normalizeCreateInput,
  computeNextAttemptAt,
  isTerminalStatus,
  isDeliveryQueueStatus,
  isProcessedStatus,
  resolveFailureStatus,
  buildRetryPatch,
  buildProcessedPatch,
  buildSkippedWebhookPatch,
};
