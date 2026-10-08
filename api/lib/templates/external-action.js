/**
 * Template-runtime external secure actions — reuses hub action_links crypto + action.html.
 * No fourth token system: same SHA-256 token_hash, expiry, used_at, revoked_at.
 */
const { isExternalAssigneeRole, EXTERNAL_ASSIGNEE_ROLES } = require('./runtime-rbac');

const ACTION_BY_STEP_TYPE = {
  Fill: 'fill',
  Review: 'review',
  Approve: 'approve',
  Sign: 'sign',
  Upload: 'upload',
};

function publicBaseUrl() {
  const base = process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || '';
  return String(base).replace(/\/$/, '');
}

function buildTemplateActionUrl(token) {
  const base = publicBaseUrl();
  const path = `/action.html?t=${encodeURIComponent(token)}`;
  return base ? `${base}${path}` : path;
}

function resolveActionType(stepInstance) {
  const fromType = ACTION_BY_STEP_TYPE[stepInstance?.step_type];
  if (fromType) return fromType;
  return String(stepInstance?.step_type || 'complete').toLowerCase();
}

/**
 * Mint a hub action_link bound to a template submission step.
 * Requires HUB_STORE_MODE=postgres (same as template store).
 */
async function mintTemplateExternalAction({
  submissionId,
  stepInstance,
  recipientEmail,
  expiresInHours = 168,
  createdBy = null,
}) {
  if (!submissionId || !stepInstance?.id) {
    const err = new Error('submissionId and stepInstance are required');
    err.code = 'INVALID_INPUT';
    err.status = 400;
    throw err;
  }
  if (!isExternalAssigneeRole(stepInstance.assignee_role)) {
    const err = new Error('Step is not assigned to an external participant role');
    err.code = 'NOT_EXTERNAL_STEP';
    err.status = 400;
    throw err;
  }
  if (stepInstance.status !== 'pending') {
    const err = new Error('Step is not pending');
    err.code = 'STEP_NOT_PENDING';
    err.status = 409;
    throw err;
  }
  const email = String(recipientEmail || '')
    .trim()
    .toLowerCase();
  if (!email || !email.includes('@')) {
    const err = new Error('Valid recipient_email is required');
    err.code = 'INVALID_EMAIL';
    err.status = 400;
    throw err;
  }

  const hubStore = require('../hub/db');
  const actionType = resolveActionType(stepInstance);
  const { link, token } = await hubStore.createActionLink({
    request_id: null,
    document_id: null,
    workflow_step_id: null,
    submission_id: submissionId,
    workflow_step_instance_id: stepInstance.id,
    recipient_email: email,
    action_type: actionType,
    expires_in_hours: expiresInHours,
    meta: { created_by: createdBy || null, runtime: 'template' },
  });

  return {
    link,
    token,
    action_url: buildTemplateActionUrl(token),
    action_type: actionType,
    expires_at: link.expires_at,
    recipient_email: email,
    submission_id: submissionId,
    workflow_step_instance_id: stepInstance.id,
  };
}

function assertLinkUsable(link) {
  if (!link) {
    const err = new Error('Action link not found');
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }
  if (link.revoked_at) {
    const err = new Error('Action link revoked');
    err.code = 'REVOKED';
    err.status = 410;
    throw err;
  }
  if (link.used_at) {
    const err = new Error('Action link already used');
    err.code = 'ALREADY_USED';
    err.status = 410;
    throw err;
  }
  if (new Date(link.expires_at) < new Date()) {
    const err = new Error('Action link expired');
    err.code = 'EXPIRED';
    err.status = 410;
    throw err;
  }
  if (!link.submission_id || !link.workflow_step_instance_id) {
    const err = new Error('Not a template action link');
    err.code = 'NOT_TEMPLATE_LINK';
    err.status = 400;
    throw err;
  }
}

/**
 * Complete a template step via an existing hub action_link (action.html POST).
 */
async function completeTemplateExternalAction({
  link,
  action,
  body = {},
  clientIp = '',
  userAgent = '',
}) {
  assertLinkUsable(link);
  const templateStore = require('./store');
  const detail = await templateStore.getSubmissionDetail(link.submission_id);
  if (!detail) {
    const err = new Error('Submission not found');
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }
  const step = detail.stepInstances.find((s) => s.id === link.workflow_step_instance_id);
  if (!step) {
    const err = new Error('Workflow step not found for this link');
    err.code = 'STEP_MISMATCH';
    err.status = 403;
    throw err;
  }
  if (step.submission_id && step.submission_id !== link.submission_id) {
    const err = new Error('Token does not match this request');
    err.code = 'REQUEST_MISMATCH';
    err.status = 403;
    throw err;
  }
  if (step.status !== 'pending' || step.step_index !== detail.submission.current_step_index) {
    const err = new Error('This step is not the current actionable step');
    err.code = 'STEP_NOT_CURRENT';
    err.status = 409;
    throw err;
  }
  if (!isExternalAssigneeRole(step.assignee_role)) {
    const err = new Error('Step is no longer an external action');
    err.code = 'NOT_EXTERNAL_STEP';
    err.status = 409;
    throw err;
  }

  const expected = resolveActionType(step);
  const normalizedAction = String(action || '').toLowerCase();
  // Allow complete as alias; reject must match Review/Approve
  if (normalizedAction === 'reject') {
    if (step.step_type !== 'Approve' && step.step_type !== 'Review') {
      const err = new Error('Reject is not allowed for this step');
      err.code = 'ACTION_NOT_ALLOWED';
      err.status = 400;
      throw err;
    }
  } else if (
    normalizedAction !== expected &&
    normalizedAction !== 'complete' &&
    !(expected === 'review' && normalizedAction === 'approve')
  ) {
    const err = new Error(`This link is for ${expected}, not ${normalizedAction}`);
    err.code = 'ACTION_MISMATCH';
    err.status = 403;
    throw err;
  }

  const actorEmail = String(link.recipient_email || '').toLowerCase();
  const actorLabel = `external:${actorEmail}`;

  let actionPayload = {
    action: normalizedAction === 'reject' ? 'reject' : expected === 'sign' ? 'sign' : normalizedAction || expected,
    notes: body.comment || body.notes || null,
    external_via_action_link: true,
    action_link_id: link.id,
    name: body.name || null,
    metadata: { ip: clientIp, user_agent: userAgent, pinned_template_version_id: detail.submission.template_version_id },
  };

  if (step.step_type === 'Sign') {
    actionPayload.acknowledged = true;
    actionPayload.signature_text = body.name || actorEmail;
    if (body.document?.file_url) actionPayload.signature_data_url = body.document.file_url;
  }
  if (step.step_type === 'Upload') {
    actionPayload.reference =
      body.reference || body.file_reference || body.document?.file_name || body.comment || body.notes || 'external-upload';
  }
  if (step.step_type === 'Fill' && body.content_json) {
    actionPayload.data_json = body.content_json;
  }
  if (normalizedAction === 'reject') {
    actionPayload.action = 'reject';
    actionPayload.reason = body.comment || body.notes || body.reason || 'Rejected via secure link';
  }

  const result = await templateStore.actOnSubmissionStep({
    submissionId: link.submission_id,
    stepInstanceId: link.workflow_step_instance_id,
    actionPayload,
    actorEmail: actorLabel,
  });

  const hubStore = require('../hub/db');
  const used = await hubStore.markActionLinkUsed(link.id);
  if (!used) {
    const err = new Error('Action link already used');
    err.code = 'ALREADY_USED';
    err.status = 410;
    throw err;
  }

  return {
    ok: true,
    submission: result.submission || result,
    step_instance_id: link.workflow_step_instance_id,
    actor: actorLabel,
    runtime: 'template',
  };
}

async function buildTemplateActionPayload(link) {
  assertLinkUsable(link);
  const templateStore = require('./store');
  const detail = await templateStore.getSubmissionDetail(link.submission_id);
  if (!detail) {
    const err = new Error('Submission not found');
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }
  const step = detail.stepInstances.find((s) => s.id === link.workflow_step_instance_id);
  if (!step) {
    const err = new Error('Workflow step not found for this link');
    err.code = 'STEP_MISMATCH';
    err.status = 403;
    throw err;
  }
  const compiled = detail.templateVersion?.compiled_workflow_json || {};
  const actionType = link.action_type || resolveActionType(step);
  return {
    runtime: 'template',
    action_type: actionType,
    recipient_email: link.recipient_email,
    expires_at: link.expires_at,
    submission: {
      id: detail.submission.id,
      status: detail.submission.status,
      current_step_index: detail.submission.current_step_index,
      template_version_id: detail.submission.template_version_id,
    },
    request: {
      id: detail.submission.id,
      title: 'External action required',
      request_type: 'template_submission',
      client_notes: null,
    },
    web_document: null,
    form_definition:
      actionType === 'fill'
        ? {
            sections: compiled.sections || [],
            fields: compiled.fields || [],
          }
        : null,
    step: {
      id: step.id,
      step_title: `${step.step_type} — external`,
      step_type: String(step.step_type || '').toLowerCase(),
      action_type: actionType,
      assignee_role: step.assignee_role,
      requires_signature: step.step_type === 'Sign',
      requires_comment: false,
      requires_file_upload: step.step_type === 'Upload',
      review_required: step.step_type === 'Review' || step.step_type === 'Approve',
      instructions: 'Complete only this assigned step. You cannot access other portal areas with this link.',
      step_index: step.step_index,
      status: step.status,
    },
  };
}

module.exports = {
  EXTERNAL_ASSIGNEE_ROLES,
  isExternalAssigneeRole,
  buildTemplateActionUrl,
  resolveActionType,
  mintTemplateExternalAction,
  completeTemplateExternalAction,
  buildTemplateActionPayload,
  assertLinkUsable,
};
