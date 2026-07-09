/**
 * WOS-36 — Durable notification email delivery queue (outbox_events).
 * Fire-and-forget: never throws into workflow save paths.
 */
const store = require('./store/index.js');
const { sendEmail } = require('../email/send-email');
const { sanitizeIntegrationPayload } = require('./integration-events');

const DEFAULT_MAX_ATTEMPTS = Number(process.env.EMAIL_DELIVERY_MAX_ATTEMPTS || 8);
const DEFAULT_BASE_BACKOFF_MS = Number(process.env.EMAIL_DELIVERY_RETRY_BASE_MS || 60_000);

function getEmailDeliveryMode() {
  return String(process.env.EMAIL_DELIVERY_MODE || 'inline').toLowerCase() === 'queued'
    ? 'queued'
    : 'inline';
}

function shouldDeliverEmailInline() {
  return getEmailDeliveryMode() === 'inline';
}

function buildEmailDedupeKey(notificationDedupeKey) {
  return `email:${notificationDedupeKey}`;
}

function computeNextAttemptAt(attempts, baseMs = DEFAULT_BASE_BACKOFF_MS) {
  const n = Math.max(1, Number(attempts) || 1);
  const delayMs = Math.min(baseMs * 2 ** (n - 1), 24 * 60 * 60 * 1000);
  return new Date(Date.now() + delayMs).toISOString();
}

function resolveFailureStatus(attempts, maxAttempts = DEFAULT_MAX_ATTEMPTS) {
  return attempts >= maxAttempts ? 'dead_lettered' : 'retrying';
}

function sanitizeEmailOutboxPayload(payload) {
  const safe = sanitizeIntegrationPayload(payload || {});
  if (safe.email && typeof safe.email === 'object') {
    safe.email = {
      to: safe.email.to,
      subject: safe.email.subject,
      text: safe.email.text,
      html: safe.email.html,
      template_key: safe.email.template_key || null,
    };
  }
  if (safe.action_link_url) {
    safe.action_link_url = sanitizeIntegrationPayload({ url: safe.action_link_url }).url;
  }
  return safe;
}

function isDevSkippedDelivery(result) {
  return (
    result?.skipped &&
    (result.logged ||
      result.reason === 'disabled' ||
      result.reason === 'no_provider' ||
      result.reason === 'no_recipient')
  );
}

async function writeDeliveryAuditFromPayload(payload, actionKey, metadata) {
  const audit = payload.audit || {};
  const action = audit[actionKey];
  if (!action || !payload.request_id) return;
  try {
    await store.addAuditEvent({
      request_id: payload.request_id,
      workflow_step_id: payload.workflow_step_id || null,
      document_id: payload.document_id || null,
      action,
      actor_email: 'system',
      metadata: metadata || {},
    });
  } catch (err) {
    console.warn('[email-delivery] audit write failed:', err.message);
  }
}

/**
 * Process one outbox email event through sendEmail().
 */
async function processEmailDeliveryEvent(record) {
  if (!record?.id) return { ok: false, error: 'missing_record' };

  const payload = record.payload || {};
  const email = payload.email || {};

  try {
    const result = await sendEmail({
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });

    if (result.ok || isDevSkippedDelivery(result)) {
      if (typeof store.markEmailDeliveryProcessed === 'function') {
        await store.markEmailDeliveryProcessed(record.id, {
          attempts: (record.attempts || 0) + 1,
          provider_result: result.skipped ? result.reason || 'skipped' : 'sent',
        });
      }
      await writeDeliveryAuditFromPayload(payload, 'sent', {
        dedupe_key: payload.notification_dedupe_key,
        recipient: email.to,
        outbox_event_id: record.id,
        provider: result.skipped ? result.reason : 'sent',
        provider_id: result.id || null,
      });
      return { ok: true, id: record.id, skipped: !!result.skipped, result };
    }

    const errMsg = result.error || result.reason || 'send_failed';
    if (typeof store.markEmailDeliveryFailed === 'function') {
      await store.markEmailDeliveryFailed(record.id, errMsg);
    }
    await writeDeliveryAuditFromPayload(payload, 'failed', {
      dedupe_key: payload.notification_dedupe_key,
      recipient: email.to,
      outbox_event_id: record.id,
      error: errMsg,
    });
    return { ok: false, id: record.id, error: errMsg, result };
  } catch (err) {
    if (typeof store.markEmailDeliveryFailed === 'function') {
      await store.markEmailDeliveryFailed(record.id, err.message);
    }
    await writeDeliveryAuditFromPayload(payload, 'failed', {
      dedupe_key: payload.notification_dedupe_key,
      recipient: email.to,
      outbox_event_id: record.id,
      error: err.message,
    });
    console.warn('[email-delivery] process failed:', err.message);
    return { ok: false, id: record.id, error: err.message };
  }
}

/**
 * Queue notification email for durable delivery.
 */
async function queueNotificationEmailDelivery({
  channel,
  dedupeKey,
  requestId,
  workflowStepId,
  documentId,
  notificationId,
  recipientEmail,
  email,
  actionLinkUrl,
  actionLinkId,
  audit,
}) {
  const emailDedupeKey = buildEmailDedupeKey(dedupeKey);
  const payload = sanitizeEmailOutboxPayload({
    channel,
    notification_dedupe_key: dedupeKey,
    notification_id: notificationId || null,
    request_id: requestId || null,
    workflow_step_id: workflowStepId || null,
    document_id: documentId || null,
    recipient_email: recipientEmail,
    action_link_id: actionLinkId || null,
    action_link_url: actionLinkUrl || null,
    email: {
      to: recipientEmail,
      subject: email.subject,
      text: email.text,
      html: email.html,
      template_key: channel,
    },
    audit: audit || {},
  });

  try {
    const queueFn = store.queueEmailDeliveryEvent || store.createEmailDeliveryEvent;
    if (typeof queueFn !== 'function') {
      const result = await sendEmail(email);
      return { ok: !!result.ok || isDevSkippedDelivery(result), inline_fallback: true, result };
    }

    const ev = await queueFn({
      event_type: 'email.send',
      dedupe_key: emailDedupeKey,
      request_id: requestId || null,
      payload,
    });

    if (ev?.dedupe_hit) {
      if (ev.status === 'processed' || ev.status === 'sent') {
        return { skipped: true, reason: 'email_dedupe', outbox_event_id: ev.id };
      }
      if (!shouldDeliverEmailInline()) {
        return { queued: true, dedupe_hit: true, outbox_event_id: ev.id };
      }
    }

    if (!shouldDeliverEmailInline()) {
      return { queued: true, outbox_event_id: ev.id };
    }

    const outcome = await processEmailDeliveryEvent(ev);
    return { ...outcome, outbox_event_id: ev.id, delivery_mode: 'inline' };
  } catch (err) {
    console.warn('[email-delivery] queue failed:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Batch processor for WOS-37 worker (callable without long-running process).
 */
async function processPendingEmailDeliveryEvents({
  limit = 20,
  workerId = 'email-worker',
  staleLockMs,
  releaseStaleLocks = true,
} = {}) {
  if (releaseStaleLocks && typeof store.releaseStaleEmailDeliveryLocks === 'function') {
    await store.releaseStaleEmailDeliveryLocks(staleLockMs).catch(() => []);
  }
  if (typeof store.claimEmailDeliveryEvents !== 'function') {
    return [];
  }

  const claimed = await store.claimEmailDeliveryEvents({ limit, workerId });
  const results = [];
  for (const ev of claimed || []) {
    try {
      results.push(await processEmailDeliveryEvent(ev));
    } catch (err) {
      console.warn('[email-delivery] worker process error:', ev.id, err.message);
      if (typeof store.markEmailDeliveryFailed === 'function') {
        await store.markEmailDeliveryFailed(ev.id, err.message).catch(() => null);
      }
      results.push({ id: ev.id, ok: false, error: err.message });
    }
  }
  return results;
}

module.exports = {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_BASE_BACKOFF_MS,
  getEmailDeliveryMode,
  shouldDeliverEmailInline,
  buildEmailDedupeKey,
  sanitizeEmailOutboxPayload,
  queueNotificationEmailDelivery,
  processEmailDeliveryEvent,
  processPendingEmailDeliveryEvents,
  isDevSkippedDelivery,
  computeNextAttemptAt,
  resolveFailureStatus,
};
