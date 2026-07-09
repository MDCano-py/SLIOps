// Lightweight workflow engine — steps drive request status and progress.

const store = require('./store/index.js');
const { queueN8nEvent } = require('./integrations');
const assignmentNotifications = require('./notifications/assignment-notifications');
const reviewNotifications = require('./notifications/review-notifications');
const signatureNotifications = require('./notifications/signature-notifications');

let documentsModule = null;
function getDocuments() {
  if (!documentsModule) documentsModule = require('./documents');
  return documentsModule;
}

const STATUS_BY_STEP = {
  review: 'in_review',
  approve: 'waiting_on_approval',
  sign: 'waiting_on_signature',
  send_to_maintainx: 'sent_to_maintainx',
};

async function transitionRequestStatus(requestId, newStatus, meta = {}) {
  const existing = await store.getRequest(requestId);
  if (!existing) return { error: 'Request not found', status: 404 };
  if (existing.status === 'closed') {
    return { error: 'Request already closed', status: 409 };
  }
  const { record, oldStatus } = await store.patchRequest(requestId, { status: newStatus });
  if (oldStatus !== newStatus) {
    await store.addStatusHistory({
      request_id: requestId,
      old_status: oldStatus,
      new_status: newStatus,
      changed_by: meta.changed_by,
      changed_by_type: meta.changed_by_type || 'user',
      note: meta.note || '',
      source: meta.source || 'portal',
    });
    await queueN8nEvent('request.status_changed', record, {
      old_status: oldStatus,
      new_status: newStatus,
    });
    await reviewNotifications.notifyRequestReviewStatus({
      request: record,
      previousStatus: oldStatus,
      actorEmail: meta.changed_by,
    });
    await signatureNotifications.notifyRequestSignatureStatus({
      request: record,
      previousStatus: oldStatus,
      actorEmail: meta.changed_by,
    });
  }
  return { record };
}

async function createWorkflowSteps(requestId, steps, actorEmail) {
  const created = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const step = await store.saveWorkflowStep({
      request_id: requestId,
      step_order: s.step_order != null ? s.step_order : i + 1,
      step_type: s.step_type,
      action_type: s.action_type || s.step_type,
      step_title: s.step_title || s.step_type,
      assigned_to_name: s.assigned_to_name || null,
      assigned_to_email: s.assigned_to_email || null,
      assigned_role: s.assigned_role || null,
      assigned_type: s.assigned_type || 'employee',
      status: s.status || 'not_started',
      visible_to_client: !!s.visible_to_client,
      requires_signature: !!s.requires_signature,
      review_required: !!s.review_required,
      requires_comment: !!s.requires_comment,
      requires_file_upload: !!s.requires_file_upload,
      instructions: s.instructions || '',
      started_at: null,
      completed_at: null,
      due_at: s.due_at || null,
      completed_by: null,
      notes: s.notes || '',
    });
    created.push(step);
    await queueN8nEvent('workflow_step.created', await store.getRequest(requestId), { step });
  }
  return created;
}

function computeProgress(steps) {
  const required = steps.filter((s) => s.status !== 'skipped');
  if (!required.length) return { percent: 0, state: 'neutral', completed: 0, total: 0 };
  const completed = required.filter((s) => s.status === 'completed').length;
  const failed = required.some((s) => s.status === 'rejected' || s.status === 'failed');
  const percent = Math.round((completed / required.length) * 100);
  return {
    percent,
    state: failed ? 'warning' : percent >= 100 ? 'complete' : 'active',
    completed,
    total: required.length,
  };
}

async function deriveStatusFromSteps(requestId) {
  const steps = await store.listWorkflowSteps(requestId);
  if (!steps.length) return null;
  const pending = steps.find(
    (s) => !['completed', 'skipped'].includes(s.status)
  );
  if (!pending) {
    const hasRejected = steps.some((s) => s.status === 'rejected');
    return hasRejected ? 'rejected' : 'completed';
  }
  return STATUS_BY_STEP[pending.step_type] || 'in_progress';
}

async function completeWorkflowStep(stepId, actorEmail, payload = {}) {
  const step = await store.getWorkflowStep(stepId);
  if (!step) return { error: 'Workflow step not found', status: 404 };
  if (['completed', 'skipped'].includes(step.status)) {
    return { error: 'Workflow step already completed', status: 409 };
  }
  const priorSteps = await store.listWorkflowSteps(step.request_id);
  const blockers = priorSteps.filter(
    (s) =>
      s.step_order < step.step_order &&
      !['completed', 'skipped'].includes(s.status)
  );
  if (blockers.length) {
    return { error: 'Workflow step cannot be completed yet', status: 409 };
  }

  const updated = await store.saveWorkflowStep({
    ...step,
    status: 'completed',
    started_at: step.started_at || store.nowIso(),
    completed_at: store.nowIso(),
    completed_by: actorEmail,
    notes: payload.notes || step.notes,
  });

  const request = await store.getRequest(step.request_id);
  await store.patchRequest(step.request_id, { current_step: updated.step_title });

  const newStatus = await deriveStatusFromSteps(step.request_id);
  if (newStatus && request.status !== newStatus) {
    await transitionRequestStatus(step.request_id, newStatus, {
      changed_by: actorEmail,
      note: `Step completed: ${updated.step_title}`,
    });
  }

  await queueN8nEvent('workflow_step.completed', await store.getRequest(step.request_id), {
    step: updated,
  });

  await getDocuments().onStepCompleted(updated, actorEmail, payload);

  return { step: updated };
}

async function rejectWorkflowStep(stepId, actorEmail, payload = {}) {
  const step = await store.getWorkflowStep(stepId);
  if (!step) return { error: 'Workflow step not found', status: 404 };
  const updated = await store.saveWorkflowStep({
    ...step,
    status: 'rejected',
    completed_at: store.nowIso(),
    completed_by: actorEmail,
    notes: payload.notes || step.notes,
  });
  await transitionRequestStatus(step.request_id, 'rejected', {
    changed_by: actorEmail,
    note: payload.notes || 'Step rejected',
  });
  await queueN8nEvent('workflow_step.rejected', await store.getRequest(step.request_id), {
    step: updated,
  });
  await getDocuments().onStepRejected(updated, actorEmail, payload);
  return { step: updated };
}

async function transferWorkflowStep(stepId, assignee, actorEmail) {
  const step = await store.getWorkflowStep(stepId);
  if (!step) return { error: 'Workflow step not found', status: 404 };
  const requestBefore = await store.getRequest(step.request_id);
  const previousAssignee = step.assigned_to_email;
  const previousStatus = step.status;
  const updated = await store.saveWorkflowStep({
    ...step,
    assigned_to_email: assignee.email,
    assigned_to_name: assignee.name || assignee.email,
    status: 'pending',
  });
  const { record } = await store.patchRequest(step.request_id, {
    assigned_to: assignee.email,
  });
  const request = record || requestBefore;
  await queueN8nEvent('request.assigned', record, { step: updated });
  if (request) {
    await assignmentNotifications.notifyRequestAssignment({
      request: record || { ...requestBefore, assigned_to: assignee.email },
      previousAssignee: requestBefore?.assigned_to,
      actorEmail,
    });
    await assignmentNotifications.notifyWorkflowStepAssignment({
      request,
      step: updated,
      previousAssignee,
      previousStatus,
      actorEmail,
    });
    if (reviewNotifications.isReviewStep(updated)) {
      await reviewNotifications.notifyWorkflowStepReview({
        request,
        step: updated,
        previousReviewer: previousAssignee,
        previousStatus,
        actorEmail,
      });
    }
    if (signatureNotifications.isSignatureStep(updated)) {
      await signatureNotifications.notifyWorkflowStepSignature({
        request,
        step: updated,
        previousSigner: previousAssignee,
        previousStatus,
        actorEmail,
      });
    }
  }
  return { step: updated };
}

module.exports = {
  transitionRequestStatus,
  createWorkflowSteps,
  computeProgress,
  deriveStatusFromSteps,
  completeWorkflowStep,
  rejectWorkflowStep,
  transferWorkflowStep,
};
