/**
 * WOS-24 — Inbound email processing (match, comment, audit, integration events).
 * Never throws into callers; plain replies are comments only (no approve/sign).
 */
const crypto = require('crypto');
const store = require('../store/index.js');
const {
  normalizeInboundEmailPayload,
  cleanEmailBody,
  extractRequestNumbers,
  extractActionTokens,
  buildInboundDedupeKey,
  formatInboundCommentBody,
} = require('./parser');

function isInboundEnabled() {
  return String(process.env.INBOUND_EMAIL_ENABLED || '').toLowerCase() === 'true';
}

function isInboundTestMode() {
  return String(process.env.INBOUND_EMAIL_TEST_MODE || '').toLowerCase() === 'true';
}

/**
 * Verify webhook secret or allow test mode (server-side only).
 */
function verifyInboundWebhook(req) {
  const enabled = isInboundEnabled();
  const testMode = isInboundTestMode();
  if (!enabled && !testMode) {
    return { ok: false, reason: 'disabled', status: 503 };
  }
  const secret = process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
  if (secret) {
    const header =
      req.headers['x-hub-inbound-secret'] ||
      req.headers['x-inbound-email-secret'] ||
      req.headers['x-webhook-secret'];
    if (header !== secret) {
      return { ok: false, reason: 'invalid_secret', status: 401 };
    }
    return { ok: true };
  }
  if (testMode) {
    return { ok: true, reason: 'test_mode' };
  }
  return { ok: false, reason: 'secret_required', status: 401 };
}

function isActionLinkValid(link) {
  if (!link) return false;
  if (link.revoked_at) return false;
  if (link.used_at) return false;
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) return false;
  return true;
}

function dedupeNotificationId(dedupeKey) {
  const hash = crypto.createHash('sha256').update(dedupeKey).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

async function writeRequestAudit(requestId, action, metadata, workflowStepId, documentId) {
  if (!requestId) return;
  try {
    await store.addAuditEvent({
      request_id: requestId,
      document_id: documentId || null,
      workflow_step_id: workflowStepId || null,
      action,
      actor_email: 'inbound-email',
      metadata: metadata || {},
    });
  } catch (err) {
    console.warn('[inbound-email] audit write failed:', err.message);
  }
}

async function findPriorInboundEvent(dedupeKey) {
  if (!dedupeKey) return null;
  if (typeof store.findIntegrationEventByDedupeKey === 'function') {
    return store.findIntegrationEventByDedupeKey('inbound_email', dedupeKey);
  }
  return null;
}

async function recordInboundIntegrationEvent({
  dedupeKey,
  requestId,
  workflowStepId,
  documentId,
  status,
  payload,
}) {
  const safePayload = {
    dedupe_key: dedupeKey,
    provider: payload.provider,
    message_id: payload.message_id || null,
    from: payload.from || null,
    to: payload.to || null,
    subject: payload.subject || null,
    matched_request_id: requestId || null,
    matched_request_number: payload.matched_request_number || null,
    reason: payload.reason || status,
    status,
  };
  try {
    const ev = await store.queueIntegrationEvent({
      event_type: 'inbound_email',
      request_id: requestId || null,
      workflow_step_id: workflowStepId || null,
      document_id: documentId || null,
      payload: safePayload,
    });
    if (ev?.id && typeof store.updateIntegrationEvent === 'function') {
      await store.updateIntegrationEvent(ev.id, { status });
    }
    return ev;
  } catch (err) {
    console.warn('[inbound-email] integration event failed:', err.message);
    return null;
  }
}

async function hasCommentForMessage(requestId, messageId) {
  if (!requestId || !messageId) return false;
  try {
    const events = await store.listAuditEvents(requestId);
    return (events || []).some(
      (ev) =>
        ev.action === 'inbound_email_comment_created' &&
        (ev.metadata?.message_id === messageId || ev.metadata?.messageId === messageId)
    );
  } catch {
    return false;
  }
}

async function notifyInboundComment(request, payload, dedupeKey) {
  const recipient = (request.assigned_to || request.requester_email || '').toLowerCase();
  if (!recipient || !recipient.includes('@')) return null;

  const notifDedupe = `inbound:notify:${request.id}:${payload.message_id || dedupeKey}`;
  const id = dedupeNotificationId(notifDedupe);
  const save = typeof store.saveNotification === 'function' ? store.saveNotification : store.createNotification;
  try {
    return await save({
      id,
      recipient_email: recipient,
      type: 'inbound_email_comment',
      title: 'Inbound email received',
      message: `New email response on ${request.request_number}: ${payload.subject || '(no subject)'}`,
      request_id: request.id,
    });
  } catch (err) {
    console.warn('[inbound-email] notification failed:', err.message);
    return null;
  }
}

/**
 * Resolve inbound email to request/workflow/action link.
 */
async function matchInboundEmail(payload, cleanedBody) {
  const tokens = extractActionTokens(payload.subject, cleanedBody, payload.html);
  let tokenMatch = null;
  let invalidToken = false;

  for (const token of tokens) {
    const link = await store.getActionLinkByToken(token);
    if (!link) {
      invalidToken = true;
      continue;
    }
    if (!isActionLinkValid(link)) {
      invalidToken = true;
      continue;
    }
    const request = await store.getRequest(link.request_id);
    if (request) {
      tokenMatch = { request, link, matchType: 'action_token' };
      break;
    }
  }

  if (tokenMatch) {
    return { ok: true, ...tokenMatch, invalidToken: false };
  }

  if (tokens.length && invalidToken && !extractRequestNumbers(payload.subject, cleanedBody).length) {
    return { ok: false, status: 'invalid_token', reason: 'invalid_or_expired_token', tokens };
  }

  const numbers = extractRequestNumbers(payload.subject, cleanedBody);
  if (!numbers.length) {
    return { ok: false, status: 'unmatched', reason: 'no_request_number_or_token' };
  }

  const unique = [...new Set(numbers.map((n) => n.toUpperCase()))];
  if (unique.length > 1) {
    return { ok: false, status: 'ambiguous', reason: 'multiple_request_numbers', requestNumbers: unique };
  }

  const request = await store.getRequestByNumber(unique[0]);
  if (!request) {
    return { ok: false, status: 'unmatched', reason: 'request_not_found', requestNumber: unique[0] };
  }

  return { ok: true, request, link: null, matchType: 'request_number', requestNumber: unique[0] };
}

async function processInboundEmail(rawPayload, options = {}) {
  let payload;
  try {
    payload = normalizeInboundEmailPayload(rawPayload);
  } catch (err) {
    return { ok: false, status: 'failed', error: err.message };
  }

  const cleanedBody = cleanEmailBody(payload);
  const dedupeKey = buildInboundDedupeKey(payload, cleanedBody);

  try {
    const prior = await findPriorInboundEvent(dedupeKey);
    if (prior) {
      if (prior.status === 'processed' || prior.status === 'duplicate') {
        if (prior.request_id) {
          await writeRequestAudit(prior.request_id, 'inbound_email_duplicate_skipped', {
            dedupe_key: dedupeKey,
            message_id: payload.message_id,
          });
        }
        return {
          ok: true,
          status: 'duplicate',
          dedupe_key: dedupeKey,
          prior_event_id: prior.id,
          request_id: prior.request_id || null,
        };
      }
      if (['unmatched', 'ambiguous', 'invalid_token', 'failed'].includes(prior.status)) {
        return {
          ok: true,
          status: prior.status,
          dedupe_key: dedupeKey,
          prior_event_id: prior.id,
          skipped: true,
        };
      }
    }

    if (!cleanedBody && !payload.subject) {
      await recordInboundIntegrationEvent({
        dedupeKey,
        status: 'failed',
        payload: { ...payload, reason: 'empty_payload' },
      });
      return { ok: false, status: 'failed', reason: 'empty_payload' };
    }

    const match = await matchInboundEmail(payload, cleanedBody);

    if (!match.ok) {
      const status = match.status || 'unmatched';
      const auditAction =
        status === 'ambiguous'
          ? 'inbound_email_ambiguous'
          : status === 'invalid_token'
            ? 'inbound_email_invalid_token'
            : 'inbound_email_unmatched';

      await recordInboundIntegrationEvent({
        dedupeKey,
        status,
        payload: {
          ...payload,
          reason: match.reason,
          request_numbers: match.requestNumbers || null,
        },
      });

      console.warn(`[inbound-email] ${status}:`, match.reason, payload.subject);
      return {
        ok: true,
        status,
        reason: match.reason,
        dedupe_key: dedupeKey,
        audit_action: auditAction,
      };
    }

    const { request, link, matchType } = match;
    const workflowStepId = link?.workflow_step_id || null;
    const documentId = link?.document_id || null;

    await writeRequestAudit(request.id, 'inbound_email_received', {
      dedupe_key: dedupeKey,
      message_id: payload.message_id,
      from: payload.from,
      subject: payload.subject,
      provider: payload.provider,
    }, workflowStepId, documentId);

    await writeRequestAudit(request.id, 'inbound_email_matched', {
      dedupe_key: dedupeKey,
      match_type: matchType,
      message_id: payload.message_id,
      request_number: request.request_number,
      action_link_id: link?.id || null,
    }, workflowStepId, documentId);

    if (payload.message_id && (await hasCommentForMessage(request.id, payload.message_id))) {
      await writeRequestAudit(request.id, 'inbound_email_duplicate_skipped', {
        dedupe_key: dedupeKey,
        message_id: payload.message_id,
      });
      await recordInboundIntegrationEvent({
        dedupeKey,
        requestId: request.id,
        workflowStepId,
        documentId,
        status: 'duplicate',
        payload: {
          ...payload,
          matched_request_number: request.request_number,
          reason: 'duplicate_comment',
        },
      });
      return { ok: true, status: 'duplicate', request_id: request.id, dedupe_key: dedupeKey };
    }

    const commentBody = formatInboundCommentBody(payload, cleanedBody);
    const comment = await store.addComment({
      request_id: request.id,
      document_id: documentId,
      workflow_step_id: workflowStepId,
      author_email: payload.from || 'inbound@unknown',
      author_name: payload.from || 'Inbound email',
      body: commentBody,
      visible_to_client: false,
    });

    await writeRequestAudit(request.id, 'inbound_email_comment_created', {
      dedupe_key: dedupeKey,
      message_id: payload.message_id,
      comment_id: comment.id,
    }, workflowStepId, documentId);

    await notifyInboundComment(request, payload, dedupeKey);

    const integrationEvent = await recordInboundIntegrationEvent({
      dedupeKey,
      requestId: request.id,
      workflowStepId,
      documentId,
      status: 'processed',
      payload: {
        ...payload,
        matched_request_number: request.request_number,
        reason: 'comment_created',
      },
    });

    return {
      ok: true,
      status: 'processed',
      request_id: request.id,
      request_number: request.request_number,
      comment_id: comment.id,
      match_type: matchType,
      dedupe_key: dedupeKey,
      integration_event_id: integrationEvent?.id || null,
    };
  } catch (err) {
    console.error('[inbound-email] processing failed:', err.message);
    await recordInboundIntegrationEvent({
      dedupeKey,
      status: 'failed',
      payload: { ...payload, reason: err.message },
    });
    if (payload?.request_id) {
      await writeRequestAudit(payload.request_id, 'inbound_email_processing_failed', {
        dedupe_key: dedupeKey,
        error: err.message,
      });
    }
    return { ok: false, status: 'failed', error: err.message, dedupe_key: dedupeKey };
  }
}

module.exports = {
  isInboundEnabled,
  isInboundTestMode,
  verifyInboundWebhook,
  matchInboundEmail,
  processInboundEmail,
  isActionLinkValid,
};
