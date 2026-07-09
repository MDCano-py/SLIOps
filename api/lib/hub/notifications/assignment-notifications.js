/**
 * WOS-21 — Request and workflow step assignment notifications (in-app + email).
 * Fire-and-forget: never throws; email failure does not block saves.
 */
const crypto = require('crypto');
const store = require('../store/index.js');
const { queueNotificationEmailDelivery } = require('../email-delivery');
const ACTIONABLE_STEP_STATUSES = new Set(['pending', 'waiting', 'in_progress', 'not_started']);

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function isValidRecipient(email, request, step) {
  const e = normalizeEmail(email);
  if (!e || !e.includes('@')) return false;
  const assignee = normalizeEmail(request?.assigned_to || request?.assigned_to_email);
  const stepAssignee = normalizeEmail(step?.assigned_to_email);
  const requester = normalizeEmail(request?.requester_email);
  if (e === assignee || e === stepAssignee) return true;
  if (requester && e === requester && step) return true;
  return false;
}

function isTestOrDemoRecord(request) {
  if (!request) return true;
  if (request.demo === true) return true;
  if (String(process.env.SKIP_ASSIGNMENT_NOTIFICATIONS || '') === '1') return true;
  const rn = String(request.request_number || '');
  const title = String(request.title || '');
  if (/^(PERSISTENCE_TEST|VALIDATION-|DEMO-)/i.test(rn)) return true;
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
        ev.action === 'assignment_notification_queued' &&
        (ev.metadata?.dedupe_key === dedupeKey || ev.metadata?.dedupeKey === dedupeKey)
    );
  } catch {
    return false;
  }
}

async function writeAudit(requestId, action, metadata, workflowStepId) {
  try {
    await store.addAuditEvent({
      request_id: requestId,
      workflow_step_id: workflowStepId || null,
      action,
      actor_email: 'system',
      metadata: metadata || {},
    });
  } catch (err) {
    console.warn('[assignment-notifications] audit write failed:', err.message);
  }
}

function hubRequestUrl(requestId) {
  const base = (process.env.PORTAL_BASE_URL || '').replace(/\/$/, '');
  if (!base || !requestId) return null;
  return `${base}/#/hub-request-detail/${requestId}`;
}

function actionLabelForStep(step) {
  const action = step?.action_type || step?.step_type || 'review';
  const map = {
    sign: 'sign',
    review: 'review',
    fill: 'complete',
    approve: 'approve',
    upload: 'upload',
    close: 'close',
    send_to_maintainx: 'send to MaintainX',
  };
  return map[action] || String(action).replace(/_/g, ' ');
}

function buildRequestAssignmentEmail(request, assignee) {
  const url = hubRequestUrl(request.id);
  const subject = `New assignment: ${request.request_number} — ${request.title}`;
  const lines = [
    `You have been assigned request ${request.request_number}.`,
    '',
    `Title: ${request.title}`,
    `Type: ${request.request_type || '—'}`,
    `Status: ${request.status || '—'}`,
    `Priority: ${request.priority || 'normal'}`,
    '',
    'Please review and take the next required action.',
  ];
  if (url) lines.push('', `Open in hub: ${url}`);
  const text = lines.join('\n');
  const html = `<p>You have been assigned request <strong>${escapeHtml(request.request_number)}</strong>.</p>
<ul>
<li><strong>Title:</strong> ${escapeHtml(request.title)}</li>
<li><strong>Type:</strong> ${escapeHtml(request.request_type || '—')}</li>
<li><strong>Status:</strong> ${escapeHtml(request.status || '—')}</li>
<li><strong>Priority:</strong> ${escapeHtml(request.priority || 'normal')}</li>
</ul>
<p>Please review and take the next required action.</p>
${url ? `<p><a href="${escapeHtml(url)}">Open request in Operations Workflow Hub</a></p>` : ''}`;
  return { to: assignee, subject, text, html };
}

function buildStepAssignmentEmail(request, step, assignee) {
  const label = step.step_title || actionLabelForStep(step);
  const url = hubRequestUrl(request.id);
  const subject = `Workflow action assigned: ${request.request_number} — ${label}`;
  const required = actionLabelForStep(step);
  const due = step.due_at ? new Date(step.due_at).toLocaleString() : null;
  const lines = [
    `You have a workflow action on ${request.request_number}.`,
    '',
    `Request: ${request.title}`,
    `Step: ${label}`,
    `Required action: ${required}`,
  ];
  if (due) lines.push(`Due: ${due}`);
  lines.push('', 'Please review and take the next required action.');
  if (url) lines.push('', `Open in hub: ${url}`);
  const text = lines.join('\n');
  const html = `<p>You have a workflow action on <strong>${escapeHtml(request.request_number)}</strong>.</p>
<ul>
<li><strong>Request:</strong> ${escapeHtml(request.title)}</li>
<li><strong>Step:</strong> ${escapeHtml(label)}</li>
<li><strong>Required action:</strong> ${escapeHtml(required)}</li>
${due ? `<li><strong>Due:</strong> ${escapeHtml(due)}</li>` : ''}
</ul>
<p>Please review and take the next required action.</p>
${url ? `<p><a href="${escapeHtml(url)}">Open request in Operations Workflow Hub</a></p>` : ''}`;
  return { to: assignee, subject, text, html };
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function deliverAssignmentEmail({ request, step, kind, assignee, dedupeKey }) {
  if (!isValidRecipient(assignee, request, step)) {
    console.warn('[assignment-notifications] invalid recipient skipped:', assignee);
    return { skipped: true, reason: 'invalid_recipient' };
  }

  const emailContent =
    kind === 'step'
      ? buildStepAssignmentEmail(request, step, assignee)
      : buildRequestAssignmentEmail(request, assignee);

  try {
    return await queueNotificationEmailDelivery({
      channel: 'assignment',
      dedupeKey,
      requestId: request.id,
      workflowStepId: step?.id,
      recipientEmail: assignee,
      email: emailContent,
      audit: {
        sent: 'assignment_email_sent',
        failed: 'assignment_email_failed',
      },
    });
  } catch (err) {
    await writeAudit(request.id, 'assignment_email_failed', {
      dedupe_key: dedupeKey,
      recipient: assignee,
      error: err.message,
    }, step?.id);
    console.warn('[assignment-notifications] email error:', err.message);
    return { ok: false, error: err.message };
  }
}

async function createInAppNotification({ dedupeKey, recipient_email, type, title, message, request_id, workflow_step_id }) {
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
  });
}

/**
 * Notify when a request is assigned or reassigned.
 */
async function notifyRequestAssignment({ request, previousAssignee, actorEmail }) {
  try {
    if (isTestOrDemoRecord(request)) return { skipped: true, reason: 'demo_or_test' };

    const assignee = normalizeEmail(request.assigned_to || request.assigned_to_email);
    if (!assignee) return { skipped: true, reason: 'no_assignee' };

    const prev = normalizeEmail(previousAssignee);
    if (prev && prev === assignee) return { skipped: true, reason: 'unchanged_assignee' };

    if (!isValidRecipient(assignee, request, null)) {
      return { skipped: true, reason: 'invalid_recipient' };
    }

    const updatedAt = request.updated_at || new Date().toISOString();
    const dedupeKey = `assignment:request:${request.id}:${assignee}:${updatedAt}`;
    if (await hasDedupeAudit(request.id, dedupeKey)) {
      return { skipped: true, reason: 'dedupe' };
    }

    const title = 'New request assignment';
    const message = `You were assigned ${request.request_number}: ${request.title}.`;

    await createInAppNotification({
      dedupeKey,
      recipient_email: assignee,
      type: 'request_assigned',
      title,
      message,
      request_id: request.id,
    });

    await writeAudit(request.id, 'assignment_notification_queued', {
      dedupe_key: dedupeKey,
      recipient: assignee,
      type: 'request_assigned',
      actor: actorEmail || null,
    });

    await deliverAssignmentEmail({ request, kind: 'request', assignee, dedupeKey });
    return { ok: true, dedupeKey };
  } catch (err) {
    console.warn('[assignment-notifications] notifyRequestAssignment failed:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Notify when a workflow step is assigned or becomes actionable for a user.
 */
async function notifyWorkflowStepAssignment({
  request,
  step,
  previousAssignee,
  previousStatus,
  actorEmail,
}) {
  try {
    if (!request) request = await store.getRequest(step?.request_id);
    if (isTestOrDemoRecord(request)) return { skipped: true, reason: 'demo_or_test' };
    if (!step) return { skipped: true, reason: 'no_step' };

    const assignee = normalizeEmail(step.assigned_to_email);
    if (!assignee) return { skipped: true, reason: 'no_assignee' };

    const status = step.status || 'not_started';
    if (!ACTIONABLE_STEP_STATUSES.has(status)) {
      return { skipped: true, reason: 'not_actionable_status' };
    }

    const prevAssignee = normalizeEmail(previousAssignee);
    const prevStatus = previousStatus || '';
    const assigneeChanged = prevAssignee !== assignee;
    const statusActivated =
      prevStatus !== status && ACTIONABLE_STEP_STATUSES.has(status);

    if (!assigneeChanged && !statusActivated) {
      return { skipped: true, reason: 'unchanged_step' };
    }

    if (!isValidRecipient(assignee, request, step)) {
      return { skipped: true, reason: 'invalid_recipient' };
    }

    const stepUpdated = step.updated_at || step.started_at || new Date().toISOString();
    const dedupeKey = `assignment:step:${step.id}:${assignee}:${status}:${stepUpdated}`;
    if (await hasDedupeAudit(request.id, dedupeKey)) {
      return { skipped: true, reason: 'dedupe' };
    }

    const stepLabel = step.step_title || actionLabelForStep(step);
    const title = 'Workflow action assigned';
    const message = `You have a workflow action for ${request.request_number}: ${stepLabel}.`;

    await createInAppNotification({
      dedupeKey,
      recipient_email: assignee,
      type: 'workflow_step_assigned',
      title,
      message,
      request_id: request.id,
      workflow_step_id: step.id,
    });

    await writeAudit(request.id, 'assignment_notification_queued', {
      dedupe_key: dedupeKey,
      recipient: assignee,
      type: 'workflow_step_assigned',
      workflow_step_id: step.id,
      actor: actorEmail || null,
    }, step.id);

    await deliverAssignmentEmail({ request, step, kind: 'step', assignee, dedupeKey });
    return { ok: true, dedupeKey };
  } catch (err) {
    console.warn('[assignment-notifications] notifyWorkflowStepAssignment failed:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  notifyRequestAssignment,
  notifyWorkflowStepAssignment,
  isTestOrDemoRecord,
  dedupeNotificationId,
  ACTIONABLE_STEP_STATUSES,
};
