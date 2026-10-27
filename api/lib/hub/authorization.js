/**
 * Hub request and workflow authorization helpers.
 * Identity, workflow state, and queue projection are decided here so routes
 * cannot trust client-supplied ownership or completion fields.
 */

const SECOND_PERSON_ACTIONS = new Set(['review', 'approve', 'sign', 'signature']);

const CLIENT_CREATE_FIELDS = [
  'request_type',
  'title',
  'description',
  'priority',
  'location',
  'department',
  'due_at',
  'form_payload',
  'content_json',
  'requester_company',
];

const QUEUE_SUMMARY_FIELDS = [
  'id',
  'request_number',
  'request_type',
  'title',
  'status',
  'priority',
  'created_at',
  'updated_at',
  'due_at',
  'location',
  'demo',
];

const STEP_PATCH_FIELDS = ['notes', 'instructions', 'due_at'];

const STEP_PROTECTED_FIELDS = [
  'status',
  'completed_by',
  'completed_by_email',
  'completed_at',
  'assigned_user_email',
  'assigned_to_email',
  'assigned_to',
  'assigned_to_name',
  'signed_at',
  'signature',
  'requires_signature',
  'started_at',
];

function emailOf(value) {
  return String(value || '').trim().toLowerCase();
}

function hasOverride(permissions, isAdmin) {
  if (isAdmin) return true;
  if (!Array.isArray(permissions)) return false;
  return (
    permissions.includes('admin') ||
    permissions.includes('hub_admin') ||
    permissions.includes('workflow_override')
  );
}

function canAssignRequests(permissions, isAdmin) {
  if (isAdmin) return true;
  if (!Array.isArray(permissions)) return false;
  return (
    permissions.includes('admin') ||
    permissions.includes('hub_admin') ||
    permissions.includes('assign_hub_requests')
  );
}

function canAccessRequest(request, actorEmail, isAdmin) {
  if (!request) return false;
  if (isAdmin) return true;
  const email = emailOf(actorEmail);
  if (!email) return false;
  return (
    emailOf(request.requester_email) === email ||
    emailOf(request.assigned_to || request.assigned_to_email) === email
  );
}

function isSecondPersonStep(step) {
  if (!step) return false;
  const action = emailOf(step.action_type || step.step_type);
  return !!(step.requires_signature || step.review_required || SECOND_PERSON_ACTIONS.has(action));
}

function stepAssignee(step) {
  return emailOf(step?.assigned_to_email || step?.assigned_user_email);
}

/**
 * Complete/reject authority is the stored assignee, or an audited override.
 * A requester may complete a step that is actually assigned to them when it
 * is not a second-person review or signature. Unassigned fill work stays
 * with the requester. Second-person steps cannot be self-reviewed.
 */
function canCompleteOrRejectStep(step, request, actorEmail, ctx = {}) {
  const actor = emailOf(actorEmail);
  const assignee = stepAssignee(step);
  const requester = emailOf(request?.requester_email);
  if (hasOverride(ctx.permissions, ctx.isAdmin)) {
    return { ok: true, via: 'override' };
  }
  if (!actor) return { ok: false, reason: 'unauthenticated' };
  if (isSecondPersonStep(step) && actor === requester && (!assignee || assignee === actor)) {
    return { ok: false, reason: 'self_review' };
  }
  if (assignee && assignee === actor) return { ok: true, via: 'assignee' };
  if (!assignee && !isSecondPersonStep(step) && actor === requester) {
    return { ok: true, via: 'requester_task' };
  }
  return { ok: false, reason: 'not_assignee' };
}

function workflowStepPatch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Invalid JSON body', status: 400 };
  }
  const forbidden = STEP_PROTECTED_FIELDS.filter((key) =>
    Object.prototype.hasOwnProperty.call(body, key)
  );
  if (forbidden.length) {
    return { error: 'Field is not client-writable', status: 400, fields: forbidden };
  }
  const patch = {};
  for (const key of STEP_PATCH_FIELDS) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  return { patch };
}

function trustedCreateInput(body, actorEmail, ctx = {}) {
  const source = body && typeof body === 'object' ? body : {};
  const input = {};
  for (const key of CLIENT_CREATE_FIELDS) {
    if (source[key] !== undefined) input[key] = source[key];
  }
  input.request_type = source.request_type;
  input.title = source.title;
  input.requester_email = emailOf(actorEmail);
  input.requester_name = ctx.actorName || actorEmail || '';
  input.requester_type = 'employee';
  input.status = 'submitted';
  input.client_visible_status = null;
  input.maintainx_id = null;
  input.maintainx_sequential_id = null;
  input.external_storage_url = null;
  input.archive_kind = null;
  input.archive_id = null;
  input.internal_notes = '';
  delete input.created_at;
  delete input.updated_at;
  delete input.completed_at;
  delete input.closed_at;
  delete input.id;
  delete input.request_number;
  if (canAssignRequests(ctx.permissions, ctx.isAdmin)) {
    const assignee = source.assigned_to || source.assigned_to_email;
    if (assignee) input.assigned_to = emailOf(assignee);
  }
  return input;
}

function projectQueueRecord(request, actorEmail, isAdmin) {
  if (!request) return request;
  if (canAccessRequest(request, actorEmail, isAdmin)) {
    if (isAdmin) return request;
    const full = { ...request };
    delete full.internal_notes;
    return full;
  }
  const summary = { access: 'summary' };
  for (const key of QUEUE_SUMMARY_FIELDS) summary[key] = request[key];
  if (request.aging) summary.aging = request.aging;
  return summary;
}

module.exports = {
  CLIENT_CREATE_FIELDS,
  QUEUE_SUMMARY_FIELDS,
  canAccessRequest,
  canAssignRequests,
  canCompleteOrRejectStep,
  isSecondPersonStep,
  workflowStepPatch,
  trustedCreateInput,
  projectQueueRecord,
};
