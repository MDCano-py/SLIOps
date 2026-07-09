/**
 * WOS-62 — Template runtime API routes (launch → submit → act).
 */
const templateStore = require('./store');
const { rolesCanSee } = require('../spaces/normalize');
const { canInspectSubmission, canActOnStep } = require('./runtime-rbac');
const rbacPostgres = require('../rbac/postgres');

async function loadActorWorkflowRoles(actorEmail) {
  if (!actorEmail || !rbacPostgres.isAvailable()) return [];
  try {
    return await rbacPostgres.getUserRoleKeys(actorEmail);
  } catch {
    return [];
  }
}

function canManageSpaces(permissions, isAdmin) {
  if (isAdmin) return true;
  if (!Array.isArray(permissions)) return false;
  return permissions.includes('hub_admin') || permissions.includes('admin');
}

function parseBody(req) {
  if (!req.body) return {};
  try {
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return null;
  }
}

function json(res, status, data) {
  return res.status(status).json(data);
}

function storeError(res, err) {
  const status = err.status || 500;
  const body = { error: err.message, code: err.code || 'ERROR' };
  if (err.details) body.validation = err.details;
  return json(res, status, body);
}

async function authorizeLaunchEntry(entry, permissions, isAdmin, actorEmail = null) {
  if (!entry) return { ok: false, status: 404, error: 'Launch entry not found' };
  if (entry.status === 'archived') return { ok: false, status: 410, error: 'Launch entry archived' };
  if (entry.status !== 'active' && !canManageSpaces(permissions, isAdmin)) {
    return { ok: false, status: 404, error: 'Launch entry not available' };
  }
  let assignedRoleKeys = [];
  if (actorEmail) {
    try {
      if (rbacPostgres.isAvailable()) {
        assignedRoleKeys = await rbacPostgres.getUserRoleKeys(actorEmail);
      }
    } catch {
      assignedRoleKeys = [];
    }
  }
  if (!rolesCanSee(entry.visible_to_roles_json, permissions, isAdmin, assignedRoleKeys)) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  return { ok: true };
}

function buildLaunchRuntimeResponse(bundle, binding) {
  const { entry, template, version, boundWorkflowVersion } = bundle;
  const bindingMode = binding?.binding_mode || 'none';
  const hasWorkflow =
    binding &&
    binding.binding_mode !== 'none' &&
    binding.workflow_template_id &&
    boundWorkflowVersion?.status === 'published';
  return {
    launch_entry: entry,
    template,
    template_version: version,
    compiled: version?.compiled_workflow_json || null,
    binding: binding || null,
    binding_mode: bindingMode,
    workflow_attached: !!hasWorkflow,
    workflow_template_version: hasWorkflow ? boundWorkflowVersion : null,
  };
}

/**
 * @returns {boolean} true if handled
 */
async function handleTemplateRuntimeRoutes(path, req, res, ctx) {
  const method = (req.method || 'GET').toUpperCase();
  const { permissions, isAdmin, actorEmail } = ctx;

  if (!path.startsWith('/hub/launch/') && !path.startsWith('/hub/submissions/')) return false;

  if (!templateStore.isTemplatePostgresMode()) {
    json(res, 503, { error: 'Template runtime requires Postgres mode', code: 'POSTGRES_REQUIRED' });
    return true;
  }

  if (!actorEmail) {
    json(res, 401, { error: 'Unauthorized' });
    return true;
  }

  let m = path.match(/^\/hub\/launch\/([^/]+)$/);
  if (m && method === 'GET') {
    try {
      const bundle = await templateStore.resolveLaunchRuntimeBundle(m[1]);
      if (!bundle?.entry) return json(res, 404, { error: 'Launch entry not found' });
      const auth = await authorizeLaunchEntry(bundle.entry, permissions, isAdmin, actorEmail);
      if (!auth.ok) return json(res, auth.status, { error: auth.error, code: auth.status === 403 ? 'FORBIDDEN' : 'UNAVAILABLE' });
      const binding = bundle.binding;
      json(res, 200, buildLaunchRuntimeResponse(bundle, binding));
    } catch (err) {
      storeError(res, err);
    }
    return true;
  }

  m = path.match(/^\/hub\/launch\/([^/]+)\/submit$/);
  if (m && method === 'POST') {
    const body = parseBody(req);
    if (!body) return json(res, 400, { error: 'Invalid JSON body' }), true;
    try {
      const bundle = await templateStore.resolveLaunchRuntimeBundle(m[1]);
      if (!bundle?.entry) return json(res, 404, { error: 'Launch entry not found' });
      const auth = await authorizeLaunchEntry(bundle.entry, permissions, isAdmin, actorEmail);
      if (!auth.ok) return json(res, auth.status, { error: auth.error });
      const result = await templateStore.submitLaunchEntry({
        launchEntryId: m[1],
        data_json: body.data_json || body.data || {},
        createdBy: actorEmail,
      });
      json(res, 201, result);
    } catch (err) {
      storeError(res, err);
    }
    return true;
  }

  m = path.match(/^\/hub\/submissions\/([^/]+)$/);
  if (m && method === 'GET') {
    try {
      const detail = await templateStore.getSubmissionDetail(m[1]);
      if (!detail) return json(res, 404, { error: 'Submission not found' });
      const actorWorkflowRoles = await loadActorWorkflowRoles(actorEmail);
      if (!canInspectSubmission(permissions, isAdmin, detail.submission, actorEmail, actorWorkflowRoles)) {
        return json(res, 403, { error: 'Forbidden' });
      }
      json(res, 200, detail);
    } catch (err) {
      storeError(res, err);
    }
    return true;
  }

  m = path.match(/^\/hub\/submissions\/([^/]+)\/actions$/);
  if (m && method === 'GET') {
    try {
      const detail = await templateStore.getSubmissionDetail(m[1]);
      if (!detail) return json(res, 404, { error: 'Submission not found' });
      const actorWorkflowRoles = await loadActorWorkflowRoles(actorEmail);
      if (!canInspectSubmission(permissions, isAdmin, detail.submission, actorEmail, actorWorkflowRoles)) {
        return json(res, 403, { error: 'Forbidden' });
      }
      const current = detail.stepInstances.find(
        (s) => s.step_index === detail.submission.current_step_index && s.status === 'pending'
      );
      json(res, 200, {
        submission: detail.submission,
        current_step: current || null,
        can_act: current ? canActOnStep(permissions, isAdmin, current, actorWorkflowRoles) : false,
        step_instances: detail.stepInstances,
      });
    } catch (err) {
      storeError(res, err);
    }
    return true;
  }

  m = path.match(/^\/hub\/submissions\/([^/]+)\/actions\/([^/]+)$/);
  if (m && method === 'POST') {
    const body = parseBody(req) || {};
    try {
      const detail = await templateStore.getSubmissionDetail(m[1]);
      if (!detail) return json(res, 404, { error: 'Submission not found' });
      const step = detail.stepInstances.find((s) => s.id === m[2]);
      if (!step) return json(res, 404, { error: 'Step not found' });
      const actorWorkflowRoles = await loadActorWorkflowRoles(actorEmail);
      if (!canActOnStep(permissions, isAdmin, step, actorWorkflowRoles)) {
        return json(res, 403, { error: 'You are not allowed to act on this step' });
      }
      const result = await templateStore.actOnSubmissionStep({
        submissionId: m[1],
        stepInstanceId: m[2],
        actionPayload: body,
        actorEmail,
      });
      json(res, 200, result);
    } catch (err) {
      storeError(res, err);
    }
    return true;
  }

  if (path.startsWith('/hub/launch/') || path.startsWith('/hub/submissions/')) {
    json(res, 404, { error: 'Runtime route not found' });
    return true;
  }

  return false;
}

module.exports = { handleTemplateRuntimeRoutes };
