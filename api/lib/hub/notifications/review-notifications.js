/**
 * WOS-22 — Review request notifications (in-app + email).
 * Fire-and-forget: never throws; email failure does not block saves.
 */
const crypto = require('crypto');
const store = require('../store/index.js');
const { queueNotificationEmailDelivery } = require('../email-delivery');

const ACTIONABLE_STEP_STATUSES = new Set(['pending', 'waiting', 'in_progress', 'not_started']);

const REVIEW_REQUEST_STATUSES = new Set([
  'in_review',
  'waiting_on_internal_review',
  'waiting_on_client_review',
]);

const REVIEW_DOCUMENT_STATUSES = new Set(['waiting_on_review']);

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function isReviewStep(step) {
  if (!step) return false;
  const action = step.action_type || step.step_type || '';
  return action === 'review' || step.review_required === true;
}

function isReviewRequiredRequestStatus(status) {
  return REVIEW_REQUEST_STATUSES.has(status);
}

function isTestOrDemoRecord(request) {
  if (!request) return true;
  if (request.demo === true) return true;
  if (String(process.env.SKIP_REVIEW_NOTIFICATIONS || '') === '1') return true;
  const rn = String(request.request_number || '');
  const title = String(request.title || '');
  if (/^(PERSISTENCE_TEST|VALIDATION-|DEMO-|WOS21_ASSIGNMENT_TEST)/i.test(rn)) return true;
  if (/PERSISTENCE_TEST|WOS-19 validation|db:validate|db:persistence-test/i.test(title)) {
    return true;
  }
  return false;
}

function dedupeNotificationId(dedupeKey) {
  const hash = crypto.createHash('sha256').update(dedupeKey).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

async function hasDedupeAudit(requestId, dedupeKey) {
  if (!requestId || !dedupeKey) return false;
  try {
    const events = await store.listAuditEvents(requestId);
    return (events || []).some(
      (ev) =>
        ev.action === 'review_notification_queued' &&
        (ev.metadata?.dedupe_key === dedupeKey || ev.metadata?.dedupeKey === dedupeKey)
    );
  } catch {
    return false;
  }
}

async function writeAudit(requestId, action, metadata, workflowStepId, documentId) {
  try {
    await store.addAuditEvent({
      request_id: requestId,
      document_id: documentId || null,
      workflow_step_id: workflowStepId || null,
      action,
      actor_email: 'system',
      metadata: metadata || {},
    });
  } catch (err) {
    console.warn('[review-notifications] audit write failed:', err.message);
  }
}

function hubRequestUrl(requestId) {
  const base = (process.env.PORTAL_BASE_URL || '').replace(/\/$/, '');
  if (!base || !requestId) return null;
  return `${base}/#/hub-request-detail/${requestId}`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stepLabel(step) {
  return step?.step_title || step?.action_type || step?.step_type || 'review';
}

function isValidReviewer(email, request, step) {
  const e = normalizeEmail(email);
  if (!e || !e.includes('@')) return false;
  const assignee = normalizeEmail(request?.assigned_to || request?.assigned_to_email);
  const stepReviewer = normalizeEmail(step?.assigned_to_email);
  if (e === assignee || e === stepReviewer) return true;
  return false;
}

function buildReviewEmail({ request, step, webDoc, reviewer, notificationType }) {
  const url = hubRequestUrl(request.id);
  const label = step ? stepLabel(step) : 'Review';
  const subject = `Review requested: ${request.request_number} — ${request.title}`;
  const docType = webDoc?.document_type_key || request.request_type || '—';
  const due = step?.due_at ? new Date(step.due_at).toLocaleString() : null;
  const lines = [
    notificationType === 'review_reassigned'
      ? `Review was reassigned to you for ${request.request_number}.`
      : `You have a review task for ${request.request_number}.`,
    '',
    `Title: ${request.title}`,
    `Type: ${request.request_type || '—'}`,
    `Document type: ${docType}`,
    `Review step: ${label}`,
    `Status: ${request.status || '—'}`,
  ];
  if (due) lines.push(`Due: ${due}`);
  lines.push('', 'Please review and approve or reject this item.');
  if (url) lines.push('', `Open in hub: ${url}`);
  const text = lines.join('\n');
  const html = `<p>${
    notificationType === 'review_reassigned'
      ? `Review was reassigned to you for <strong>${escapeHtml(request.request_number)}</strong>.`
      : `You have a review task for <strong>${escapeHtml(request.request_number)}</strong>.`
  }</p>
<ul>
<li><strong>Title:</strong> ${escapeHtml(request.title)}</li>
<li><strong>Type:</strong> ${escapeHtml(request.request_type || '—')}</li>
<li><strong>Document type:</strong> ${escapeHtml(docType)}</li>
<li><strong>Review step:</strong> ${escapeHtml(label)}</li>
<li><strong>Status:</strong> ${escapeHtml(request.status || '—')}</li>
${due ? `<li><strong>Due:</strong> ${escapeHtml(due)}</li>` : ''}
</ul>
<p>Please review and approve or reject this item.</p>
${url ? `<p><a href="${escapeHtml(url)}">Open request in Operations Workflow Hub</a></p>` : ''}`;
  return { to: reviewer, subject, text, html };
}

async function deliverReviewEmail({ request, step, webDoc, reviewer, dedupeKey, notificationType, trustRecipient = false }) {
  if (!trustRecipient && !isValidReviewer(reviewer, request, step)) {
    console.warn('[review-notifications] invalid reviewer skipped:', reviewer);
    return { skipped: true, reason: 'invalid_recipient' };
  }

  const emailContent = buildReviewEmail({ request, step, webDoc, reviewer, notificationType });

  try {
    return await queueNotificationEmailDelivery({
      channel: 'review',
      dedupeKey,
      requestId: request.id,
      workflowStepId: step?.id,
      documentId: webDoc?.id,
      recipientEmail: reviewer,
      email: emailContent,
      audit: {
        sent: 'review_email_sent',
        failed: 'review_email_failed',
      },
    });
  } catch (err) {
    await writeAudit(
      request.id,
      'review_email_failed',
      { dedupe_key: dedupeKey, recipient: reviewer, error: err.message },
      step?.id,
      webDoc?.id
    );
    console.warn('[review-notifications] email error:', err.message);
    return { ok: false, error: err.message };
  }
}

async function createInAppNotification({
  dedupeKey,
  recipient_email,
  type,
  title,
  message,
  request_id,
  workflow_step_id,
  document_id,
}) {
  const id = dedupeNotificationId(dedupeKey);
  const save = typeof store.saveNotification === 'function' ? store.saveNotification : store.createNotification;
  return save({
    id,
    recipient_email,
    type,
    title,
    message,
    request_id,
    workflow_step_id: workflow_step_id || null,
    document_id: document_id || null,
  });
}

async function queueReviewNotification({
  request,
  step,
  webDoc,
  reviewer,
  notificationType,
  dedupeKey,
  actorEmail,
  trustRecipient = false,
}) {
  if (await hasDedupeAudit(request.id, dedupeKey)) {
    await writeAudit(
      request.id,
      'review_notification_skipped_duplicate',
      { dedupe_key: dedupeKey, recipient: reviewer, type: notificationType },
      step?.id,
      webDoc?.id
    );
    return { skipped: true, reason: 'dedupe' };
  }

  const title = notificationType === 'review_reassigned' ? 'Review reassigned' : 'Review requested';
  const message =
    notificationType === 'review_reassigned'
      ? `Review was reassigned to you for ${request.request_number}: ${request.title}.`
      : `You have a review task for ${request.request_number}: ${request.title}.`;

  await createInAppNotification({
    dedupeKey,
    recipient_email: reviewer,
    type: notificationType,
    title,
    message,
    request_id: request.id,
    workflow_step_id: step?.id,
    document_id: webDoc?.id,
  });

  await writeAudit(
    request.id,
    'review_notification_queued',
    {
      dedupe_key: dedupeKey,
      recipient: reviewer,
      type: notificationType,
      actor: actorEmail || null,
    },
    step?.id,
    webDoc?.id
  );

  await deliverReviewEmail({ request, step, webDoc, reviewer, dedupeKey, notificationType, trustRecipient });
  return { ok: true, dedupeKey, type: notificationType };
}

/**
 * Notify when a review workflow step is activated or reviewer changes.
 */
async function notifyWorkflowStepReview({
  request,
  step,
  webDoc,
  previousReviewer,
  previousStatus,
  actorEmail,
}) {
  try {
    if (!request) request = await store.getRequest(step?.request_id);
    if (isTestOrDemoRecord(request)) return { skipped: true, reason: 'demo_or_test' };
    if (!step || !isReviewStep(step)) return { skipped: true, reason: 'not_review_step' };

    const reviewer = normalizeEmail(step.assigned_to_email);
    if (!reviewer) return { skipped: true, reason: 'no_reviewer' };

    const status = step.status || 'not_started';
    if (!ACTIONABLE_STEP_STATUSES.has(status)) {
      return { skipped: true, reason: 'not_actionable_status' };
    }

    const prevReviewer = normalizeEmail(previousReviewer);
    const prevStatus = previousStatus || '';
    const reviewerChanged = prevReviewer !== reviewer;
    const statusActivated = prevStatus !== status && ACTIONABLE_STEP_STATUSES.has(status);

    if (!reviewerChanged && !statusActivated) {
      return { skipped: true, reason: 'unchanged_step' };
    }

    const notificationType =
      reviewerChanged && prevReviewer ? 'review_reassigned' : 'review_requested';

    const stepUpdated = step.updated_at || step.started_at || new Date().toISOString();
    const dedupeKey = `review:step:${step.id}:${reviewer}:${status}:${stepUpdated}`;

    if (!webDoc && request?.id) {
      webDoc = await store.getWebDocumentByRequestId(request.id);
    }

    return queueReviewNotification({
      request,
      step,
      webDoc,
      reviewer,
      notificationType,
      dedupeKey,
      actorEmail,
    });
  } catch (err) {
    console.warn('[review-notifications] notifyWorkflowStepReview failed:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Notify when a request enters a review-required status.
 */
async function notifyRequestReviewStatus({ request, webDoc, previousStatus, reviewerEmail, actorEmail }) {
  try {
    if (isTestOrDemoRecord(request)) return { skipped: true, reason: 'demo_or_test' };

    const newStatus = request.status;
    if (!isReviewRequiredRequestStatus(newStatus)) {
      return { skipped: true, reason: 'not_review_status' };
    }
    if (previousStatus === newStatus) {
      return { skipped: true, reason: 'unchanged_status' };
    }
    if (isReviewRequiredRequestStatus(previousStatus) && previousStatus === newStatus) {
      return { skipped: true, reason: 'already_in_review' };
    }

    let reviewer = normalizeEmail(reviewerEmail);
    let step = null;
    if (!reviewer) {
      const steps = await store.listWorkflowSteps(request.id);
      step = steps.find(
        (s) =>
          isReviewStep(s) &&
          ACTIONABLE_STEP_STATUSES.has(s.status) &&
          normalizeEmail(s.assigned_to_email)
      );
      reviewer = normalizeEmail(step?.assigned_to_email);
    }
    if (!reviewer) {
      reviewer = normalizeEmail(request.assigned_to || request.assigned_to_email);
    }
    if (!reviewer) return { skipped: true, reason: 'no_reviewer' };

    const updatedAt = request.updated_at || new Date().toISOString();
    const dedupeKey = `review:request:${request.id}:${reviewer}:${newStatus}:${updatedAt}`;

    if (!webDoc && request.id) {
      webDoc = await store.getWebDocumentByRequestId(request.id);
    }

    return queueReviewNotification({
      request,
      step,
      webDoc,
      reviewer,
      notificationType: 'review_requested',
      dedupeKey,
      actorEmail,
      trustRecipient: !!normalizeEmail(reviewerEmail),
    });
  } catch (err) {
    console.warn('[review-notifications] notifyRequestReviewStatus failed:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Notify when a web document enters a review-required status.
 */
async function notifyDocumentReview({ request, webDoc, previousDocStatus, reviewerEmail, actorEmail }) {
  try {
    if (!webDoc) return { skipped: true, reason: 'no_document' };
    if (!request) request = await store.getRequest(webDoc.request_id);
    if (isTestOrDemoRecord(request)) return { skipped: true, reason: 'demo_or_test' };

    const newStatus = webDoc.status;
    if (!REVIEW_DOCUMENT_STATUSES.has(newStatus)) {
      return { skipped: true, reason: 'not_review_doc_status' };
    }
    if (previousDocStatus === newStatus) {
      return { skipped: true, reason: 'unchanged_doc_status' };
    }

    let reviewer = normalizeEmail(reviewerEmail);
    let step = null;
    if (!reviewer) {
      const steps = await store.listWorkflowSteps(request.id);
      step = steps.find(
        (s) =>
          isReviewStep(s) &&
          ACTIONABLE_STEP_STATUSES.has(s.status) &&
          normalizeEmail(s.assigned_to_email)
      );
      reviewer = normalizeEmail(step?.assigned_to_email);
    }
    if (!reviewer) {
      reviewer = normalizeEmail(webDoc.current_owner || request.assigned_to);
    }
    if (!reviewer) return { skipped: true, reason: 'no_reviewer' };

    const docUpdated = webDoc.updated_at || new Date().toISOString();
    const dedupeKey = `review:document:${webDoc.id}:${reviewer}:${newStatus}:${docUpdated}`;

    return queueReviewNotification({
      request,
      step,
      webDoc,
      reviewer,
      notificationType: 'review_requested',
      dedupeKey,
      actorEmail,
      trustRecipient: !!normalizeEmail(reviewerEmail),
    });
  } catch (err) {
    console.warn('[review-notifications] notifyDocumentReview failed:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  notifyWorkflowStepReview,
  notifyRequestReviewStatus,
  notifyDocumentReview,
  isReviewStep,
  isReviewRequiredRequestStatus,
  isTestOrDemoRecord,
  dedupeNotificationId,
  ACTIONABLE_STEP_STATUSES,
  REVIEW_REQUEST_STATUSES,
};
