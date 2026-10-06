/**
 * WOS-23 — Signature request notifications (in-app + email).
 * Fire-and-forget: never throws; email failure does not block saves.
 */
const crypto = require('crypto');
const store = require('../store/index.js');
const { queueNotificationEmailDelivery } = require('../email-delivery');

const ACTIONABLE_STEP_STATUSES = new Set(['pending', 'waiting', 'in_progress', 'not_started']);

const SIGNATURE_REQUEST_STATUSES = new Set(['waiting_on_signature']);

const SIGNATURE_DOCUMENT_STATUSES = new Set(['waiting_on_signature']);

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function isSignatureStep(step) {
  if (!step) return false;
  const action = step.action_type || step.step_type || '';
  return action === 'sign' || step.requires_signature === true;
}

function isSignatureRequiredRequestStatus(status) {
  return SIGNATURE_REQUEST_STATUSES.has(status);
}

function isTestOrDemoRecord(request) {
  if (!request) return true;
  if (request.demo === true) return true;
  if (String(process.env.SKIP_SIGNATURE_NOTIFICATIONS || '') === '1') return true;
  const rn = String(request.request_number || '');
  const title = String(request.title || '');
  if (/^(PERSISTENCE_TEST|VALIDATION-|DEMO-|WOS21_ASSIGNMENT_TEST|WOS22_REVIEW_TEST)/i.test(rn)) {
    return true;
  }
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
        ev.action === 'signature_notification_queued' &&
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
    console.warn('[signature-notifications] audit write failed:', err.message);
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
  return step?.step_title || step?.action_type || step?.step_type || 'sign';
}

function isValidSigner(email, request, step) {
  const e = normalizeEmail(email);
  if (!e || !e.includes('@')) return false;
  const assignee = normalizeEmail(request?.assigned_to || request?.assigned_to_email);
  const stepSigner = normalizeEmail(step?.assigned_to_email);
  if (e === assignee || e === stepSigner) return true;
  return false;
}

function buildSignatureEmail({ request, step, webDoc, signer, notificationType, actionLinkUrl }) {
  const hubUrl = hubRequestUrl(request.id);
  const label = step ? stepLabel(step) : 'Signature';
  const subject = `Signature requested: ${request.request_number} — ${request.title}`;
  const docType = webDoc?.document_type_key || request.request_type || '—';
  const due = step?.due_at ? new Date(step.due_at).toLocaleString() : null;
  const lines = [
    notificationType === 'signature_reassigned'
      ? `Signature was reassigned to you for ${request.request_number}.`
      : `You have a signature task for ${request.request_number}.`,
    '',
    `Title: ${request.title}`,
    `Type: ${request.request_type || '—'}`,
    `Document type: ${docType}`,
    `Signature step: ${label}`,
    `Status: ${request.status || '—'}`,
  ];
  if (due) lines.push(`Due: ${due}`);
  lines.push('', 'Please review and sign this item.');
  if (actionLinkUrl) lines.push('', `Sign securely: ${actionLinkUrl}`);
  if (hubUrl) lines.push('', `Open in hub: ${hubUrl}`);
  const text = lines.join('\n');
  const html = `<p>${
    notificationType === 'signature_reassigned'
      ? `Signature was reassigned to you for <strong>${escapeHtml(request.request_number)}</strong>.`
      : `You have a signature task for <strong>${escapeHtml(request.request_number)}</strong>.`
  }</p>
<ul>
<li><strong>Title:</strong> ${escapeHtml(request.title)}</li>
<li><strong>Type:</strong> ${escapeHtml(request.request_type || '—')}</li>
<li><strong>Document type:</strong> ${escapeHtml(docType)}</li>
<li><strong>Signature step:</strong> ${escapeHtml(label)}</li>
<li><strong>Status:</strong> ${escapeHtml(request.status || '—')}</li>
${due ? `<li><strong>Due:</strong> ${escapeHtml(due)}</li>` : ''}
</ul>
<p>Please review and sign this item.</p>
${actionLinkUrl ? `<p><a href="${escapeHtml(actionLinkUrl)}">Sign securely</a></p>` : ''}
${hubUrl ? `<p><a href="${escapeHtml(hubUrl)}">Open request in Operations Workflow Hub</a></p>` : ''}`;
  return { to: signer, subject, text, html };
}

async function deliverSignatureEmail({
  request,
  step,
  webDoc,
  signer,
  dedupeKey,
  notificationType,
  actionLinkUrl,
  actionLinkId,
  trustRecipient = false,
}) {
  if (!trustRecipient && !isValidSigner(signer, request, step)) {
    console.warn('[signature-notifications] invalid signer skipped:', signer);
    return { skipped: true, reason: 'invalid_recipient' };
  }

  const emailContent = buildSignatureEmail({ request, step, webDoc, signer, notificationType, actionLinkUrl });

  try {
    return await queueNotificationEmailDelivery({
      channel: 'signature',
      dedupeKey,
      requestId: request.id,
      workflowStepId: step?.id,
      documentId: webDoc?.id,
      recipientEmail: signer,
      email: emailContent,
      actionLinkUrl,
      actionLinkId,
      audit: {
        sent: 'signature_email_sent',
        failed: 'signature_email_failed',
      },
    });
  } catch (err) {
    await writeAudit(
      request.id,
      'signature_email_failed',
      { dedupe_key: dedupeKey, recipient: signer, error: err.message },
      step?.id,
      webDoc?.id
    );
    console.warn('[signature-notifications] email error:', err.message);
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

async function queueSignatureNotification({
  request,
  step,
  webDoc,
  signer,
  notificationType,
  dedupeKey,
  actorEmail,
  actionLinkUrl,
  actionLinkId,
  trustRecipient = false,
}) {
  if (await hasDedupeAudit(request.id, dedupeKey)) {
    await writeAudit(
      request.id,
      'signature_notification_skipped_duplicate',
      { dedupe_key: dedupeKey, recipient: signer, type: notificationType },
      step?.id,
      webDoc?.id
    );
    return { skipped: true, reason: 'dedupe' };
  }

  const title = notificationType === 'signature_reassigned' ? 'Signature reassigned' : 'Signature requested';
  const message =
    notificationType === 'signature_reassigned'
      ? `Signature was reassigned to you for ${request.request_number}: ${request.title}.`
      : `You have a signature task for ${request.request_number}: ${request.title}.`;

  await createInAppNotification({
    dedupeKey,
    recipient_email: signer,
    type: notificationType,
    title,
    message,
    request_id: request.id,
    workflow_step_id: step?.id,
    document_id: webDoc?.id,
  });

  await writeAudit(
    request.id,
    'signature_notification_queued',
    {
      dedupe_key: dedupeKey,
      recipient: signer,
      type: notificationType,
      actor: actorEmail || null,
      action_link: actionLinkUrl || null,
    },
    step?.id,
    webDoc?.id
  );

  await deliverSignatureEmail({
    request,
    step,
    webDoc,
    signer,
    dedupeKey,
    notificationType,
    actionLinkUrl,
    actionLinkId,
    trustRecipient,
  });
  return { ok: true, dedupeKey, type: notificationType };
}

/**
 * Notify when a signature workflow step is activated or signer changes.
 */
async function notifyWorkflowStepSignature({
  request,
  step,
  webDoc,
  previousSigner,
  previousStatus,
  actorEmail,
  actionLinkUrl,
  actionLinkId,
}) {
  try {
    if (!request) request = await store.getRequest(step?.request_id);
    if (isTestOrDemoRecord(request)) return { skipped: true, reason: 'demo_or_test' };
    if (!step || !isSignatureStep(step)) return { skipped: true, reason: 'not_signature_step' };

    const signer = normalizeEmail(step.assigned_to_email);
    if (!signer) return { skipped: true, reason: 'no_signer' };

    const status = step.status || 'not_started';
    if (!ACTIONABLE_STEP_STATUSES.has(status)) {
      return { skipped: true, reason: 'not_actionable_status' };
    }

    const prevSigner = normalizeEmail(previousSigner);
    const prevStatus = previousStatus || '';
    const signerChanged = prevSigner !== signer;
    const statusActivated = prevStatus !== status && ACTIONABLE_STEP_STATUSES.has(status);

    if (!signerChanged && !statusActivated) {
      return { skipped: true, reason: 'unchanged_step' };
    }

    const notificationType =
      signerChanged && prevSigner ? 'signature_reassigned' : 'signature_requested';

    const stepUpdated = step.updated_at || step.started_at || new Date().toISOString();
    const dedupeKey = actionLinkId
      ? `signature:action-link:${actionLinkId}:${signer}`
      : `signature:step:${step.id}:${signer}:${status}:${stepUpdated}`;

    if (!webDoc && request?.id) {
      webDoc = await store.getWebDocumentByRequestId(request.id);
    }

    return queueSignatureNotification({
      request,
      step,
      webDoc,
      signer,
      notificationType,
      dedupeKey,
      actorEmail,
      actionLinkUrl,
      actionLinkId,
    });
  } catch (err) {
    console.warn('[signature-notifications] notifyWorkflowStepSignature failed:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Notify when an action link is created for a signer (sign action).
 */
async function notifySignatureActionLink({ request, step, webDoc, link, actionLinkUrl, actorEmail }) {
  try {
    if (!request) request = await store.getRequest(link?.request_id || step?.request_id);
    if (isTestOrDemoRecord(request)) return { skipped: true, reason: 'demo_or_test' };
    if (!link?.id) return { skipped: true, reason: 'no_link' };

    const actionType = link.action_type || step?.action_type;
    if (actionType !== 'sign' && !isSignatureStep(step)) {
      return { skipped: true, reason: 'not_sign_action' };
    }

    const signer = normalizeEmail(link.recipient_email || step?.assigned_to_email);
    if (!signer) return { skipped: true, reason: 'no_signer' };

    if (!step && link.workflow_step_id) {
      step = await store.getWorkflowStep(link.workflow_step_id);
    }
    if (!webDoc && request?.id) {
      webDoc = await store.getWebDocumentByRequestId(request.id);
    }

    const dedupeKey = `signature:action-link:${link.id}:${signer}`;

    return queueSignatureNotification({
      request,
      step,
      webDoc,
      signer,
      notificationType: 'signature_requested',
      dedupeKey,
      actorEmail,
      actionLinkUrl,
      actionLinkId: link.id,
      trustRecipient: true,
    });
  } catch (err) {
    console.warn('[signature-notifications] notifySignatureActionLink failed:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Notify when a request enters a signature-required status.
 */
async function notifyRequestSignatureStatus({ request, webDoc, previousStatus, signerEmail, actorEmail }) {
  try {
    if (isTestOrDemoRecord(request)) return { skipped: true, reason: 'demo_or_test' };

    const newStatus = request.status;
    if (!isSignatureRequiredRequestStatus(newStatus)) {
      return { skipped: true, reason: 'not_signature_status' };
    }
    if (previousStatus === newStatus) {
      return { skipped: true, reason: 'unchanged_status' };
    }

    let signer = normalizeEmail(signerEmail);
    let step = null;
    if (!signer) {
      const steps = await store.listWorkflowSteps(request.id);
      step = steps.find(
        (s) =>
          isSignatureStep(s) &&
          ACTIONABLE_STEP_STATUSES.has(s.status) &&
          normalizeEmail(s.assigned_to_email)
      );
      signer = normalizeEmail(step?.assigned_to_email);
    }
    if (!signer) {
      signer = normalizeEmail(request.assigned_to || request.assigned_to_email);
    }
    if (!signer) return { skipped: true, reason: 'no_signer' };

    const updatedAt = request.updated_at || new Date().toISOString();
    const dedupeKey = `signature:request:${request.id}:${signer}:${newStatus}:${updatedAt}`;

    if (!webDoc && request.id) {
      webDoc = await store.getWebDocumentByRequestId(request.id);
    }

    return queueSignatureNotification({
      request,
      step,
      webDoc,
      signer,
      notificationType: 'signature_requested',
      dedupeKey,
      actorEmail,
      actionLinkUrl: null,
      trustRecipient: !!normalizeEmail(signerEmail),
    });
  } catch (err) {
    console.warn('[signature-notifications] notifyRequestSignatureStatus failed:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Notify when a web document enters a signature-required status.
 */
async function notifyDocumentSignature({ request, webDoc, previousDocStatus, signerEmail, actorEmail, actionLinkUrl }) {
  try {
    if (!webDoc) return { skipped: true, reason: 'no_document' };
    if (!request) request = await store.getRequest(webDoc.request_id);
    if (isTestOrDemoRecord(request)) return { skipped: true, reason: 'demo_or_test' };

    const newStatus = webDoc.status;
    if (!SIGNATURE_DOCUMENT_STATUSES.has(newStatus)) {
      return { skipped: true, reason: 'not_signature_doc_status' };
    }
    if (previousDocStatus === newStatus) {
      return { skipped: true, reason: 'unchanged_doc_status' };
    }

    let signer = normalizeEmail(signerEmail);
    let step = null;
    if (!signer) {
      const steps = await store.listWorkflowSteps(request.id);
      step = steps.find(
        (s) =>
          isSignatureStep(s) &&
          ACTIONABLE_STEP_STATUSES.has(s.status) &&
          normalizeEmail(s.assigned_to_email)
      );
      signer = normalizeEmail(step?.assigned_to_email);
    }
    if (!signer) {
      signer = normalizeEmail(webDoc.current_owner || request.assigned_to);
    }
    if (!signer) return { skipped: true, reason: 'no_signer' };

    const docUpdated = webDoc.updated_at || new Date().toISOString();
    const dedupeKey = `signature:document:${webDoc.id}:${signer}:${newStatus}:${docUpdated}`;

    return queueSignatureNotification({
      request,
      step,
      webDoc,
      signer,
      notificationType: 'signature_requested',
      dedupeKey,
      actorEmail,
      actionLinkUrl,
      trustRecipient: !!normalizeEmail(signerEmail),
    });
  } catch (err) {
    console.warn('[signature-notifications] notifyDocumentSignature failed:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  notifyWorkflowStepSignature,
  notifySignatureActionLink,
  notifyRequestSignatureStatus,
  notifyDocumentSignature,
  isSignatureStep,
  isSignatureRequiredRequestStatus,
  isTestOrDemoRecord,
  dedupeNotificationId,
  ACTIONABLE_STEP_STATUSES,
  SIGNATURE_REQUEST_STATUSES,
};
