/**
 * WOS-93 Configuration Center API routes — /hub/configuration/*
 */

const { isConfigurablePlatformEnabled, disabledPayload } = require('./feature-flag');
const perms = require('./permissions');
const store = require('./store');
const { validateDefinitionPayload, validateSubmission } = require('./validation');
const { listBuiltinVariables, resolveVariables } = require('./variables');
const { listFieldTypes } = require('./fields/registry');
const { listNodeTypes } = require('./nodes/registry');
const { listWidgetTypes } = require('./widgets/registry');
const { OPERATORS } = require('./conditions');
const engine = require('./runtime/engine');
const { seedDefaultTemplates, repairNdaOperationalWiring } = require('./seeds/default-templates');

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

function kindFromPath(segment) {
  const map = {
    'request-types': 'request_type',
    forms: 'form',
    documents: 'document',
    workflows: 'workflow',
    dashboards: 'dashboard',
    'saved-views': 'saved_view',
  };
  return map[segment] || null;
}

/**
 * @returns {Promise<boolean>} true if handled
 */
async function handleConfigurationRoutes(path, req, res, ctx) {
  if (!path.startsWith('/hub/configuration') && !path.startsWith('/hub/workflow-runtime')) {
    return false;
  }

  if (!isConfigurablePlatformEnabled()) {
    json(res, 503, disabledPayload());
    return true;
  }

  const method = (req.method || 'GET').toUpperCase();
  const { actorEmail, permissions, isAdmin } = ctx;
  let roleKeys = Array.isArray(ctx.roleKeys) ? ctx.roleKeys.slice() : [];
  let actorUserId = ctx.actorUserId || null;
  if ((!roleKeys.length || !actorUserId) && actorEmail) {
    try {
      const rbacPg = require('../rbac/postgres');
      if (!roleKeys.length && rbacPg.isAvailable()) {
        roleKeys = await rbacPg.getUserRoleKeys(actorEmail);
      }
    } catch {
      /* keep empty */
    }
  }

  // ----- meta / catalogs (view) -----
  if (path === '/hub/configuration/status' && method === 'GET') {
    if (!perms.canViewConfiguration(permissions, isAdmin)) {
      json(res, 403, { error: 'Forbidden' });
      return true;
    }
    json(res, 200, {
      enabled: true,
      postgres: store.isPostgresMode(),
      permissions: {
        view: perms.canViewConfiguration(permissions, isAdmin),
        edit: perms.canEditConfiguration(permissions, isAdmin),
        publish: perms.canPublishConfiguration(permissions, isAdmin),
      },
    });
    return true;
  }

  if (path === '/hub/configuration/catalogs' && method === 'GET') {
    if (!perms.canViewConfiguration(permissions, isAdmin)) {
      json(res, 403, { error: 'Forbidden' });
      return true;
    }
    json(res, 200, {
      field_types: listFieldTypes(),
      node_types: listNodeTypes(),
      widget_types: listWidgetTypes(),
      operators: OPERATORS,
      builtin_variables: listBuiltinVariables(),
    });
    return true;
  }

  if (path === '/hub/configuration/variables/resolve' && method === 'POST') {
    if (!perms.canViewConfiguration(permissions, isAdmin)) {
      json(res, 403, { error: 'Forbidden' });
      return true;
    }
    const body = parseBody(req);
    if (!body) return json(res, 400, { error: 'Invalid JSON' }), true;
    let customVariables = {};
    try {
      if (store.isPostgresMode()) customVariables = await store.getCustomVariableMap();
    } catch {
      customVariables = {};
    }
    const result = resolveVariables({
      template: body.template || '',
      organization: body.organization,
      request: body.request,
      formSubmission: body.formSubmission,
      workflowInstance: body.workflowInstance,
      currentUser: body.currentUser || { email: actorEmail, name: actorEmail },
      customVariables,
      runtimeValues: body.runtimeValues,
      mode: body.mode === 'production' ? 'production' : 'preview',
    });
    json(res, 200, result);
    return true;
  }

  if (path === '/hub/configuration/variables' && method === 'GET') {
    if (!perms.canViewConfiguration(permissions, isAdmin)) {
      json(res, 403, { error: 'Forbidden' });
      return true;
    }
    try {
      const custom = store.isPostgresMode() ? await store.listVariables({ includeSensitive: false }) : [];
      json(res, 200, { builtin: listBuiltinVariables(), custom });
    } catch (err) {
      storeError(res, err);
    }
    return true;
  }

  if (path === '/hub/configuration/variables' && method === 'POST') {
    if (!perms.canManageKind(permissions, isAdmin, 'variable') && !perms.canEditConfiguration(permissions, isAdmin)) {
      json(res, 403, { error: 'Forbidden' });
      return true;
    }
    const body = parseBody(req);
    if (!body) return json(res, 400, { error: 'Invalid JSON' }), true;
    try {
      const row = await store.upsertVariable(body, actorEmail);
      json(res, 200, { variable: row });
    } catch (err) {
      storeError(res, err);
    }
    return true;
  }

  if (path === '/hub/configuration/validate' && method === 'POST') {
    if (!perms.canViewConfiguration(permissions, isAdmin)) {
      json(res, 403, { error: 'Forbidden' });
      return true;
    }
    const body = parseBody(req);
    if (!body || !body.kind) return json(res, 400, { error: 'kind required' }), true;
    const result = validateDefinitionPayload(body.kind, body.payload || {});
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  if (path === '/hub/configuration/forms/validate-submission' && method === 'POST') {
    if (!perms.canViewConfiguration(permissions, isAdmin) && !perms.canExecuteWorkflow(permissions, isAdmin)) {
      json(res, 403, { error: 'Forbidden' });
      return true;
    }
    const body = parseBody(req);
    if (!body) return json(res, 400, { error: 'Invalid JSON' }), true;
    const result = validateSubmission(body.form || body.definition || {}, body.values || {});
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  if (path === '/hub/configuration/seed-defaults' && method === 'POST') {
    if (!perms.canPublishConfiguration(permissions, isAdmin)) {
      json(res, 403, { error: 'Forbidden' });
      return true;
    }
    try {
      const result = await seedDefaultTemplates(actorEmail);
      json(res, 200, result);
    } catch (err) {
      storeError(res, err);
    }
    return true;
  }

  if (path === '/hub/configuration/repair-nda-wiring' && method === 'POST') {
    if (!perms.canPublishConfiguration(permissions, isAdmin)) {
      json(res, 403, { error: 'Forbidden' });
      return true;
    }
    try {
      const repaired = await repairNdaOperationalWiring(actorEmail);
      json(res, 200, { repaired });
    } catch (err) {
      storeError(res, err);
    }
    return true;
  }

  if (path === '/hub/configuration/published-documents' && method === 'GET') {
    if (!perms.canViewConfiguration(permissions, isAdmin)) {
      json(res, 403, { error: 'Forbidden' });
      return true;
    }
    try {
      const definitions = await store.listDefinitions({ kind: 'document' });
      const published = definitions
        .filter((d) => d.status === 'published')
        .map((d) => ({
          id: d.id,
          key: d.key,
          name: d.name,
          description: d.description,
          status: d.status,
          updated_at: d.updated_at,
        }));
      json(res, 200, { documents: published });
    } catch (err) {
      storeError(res, err);
    }
    return true;
  }

  // Public token routes (SSO allowlisted in maintainx.js)
  if (path.match(/^\/hub\/configuration\/external-action\/[^/]+$/) && method === 'GET') {
    const token = decodeURIComponent(path.split('/').pop());
    try {
      const payload = await engine.getExternalActionPayload(token);
      json(res, 200, payload);
    } catch (err) {
      storeError(res, err);
    }
    return true;
  }

  if (path.match(/^\/hub\/configuration\/external-action\/[^/]+\/complete$/) && method === 'POST') {
    const token = decodeURIComponent(path.split('/')[4]);
    const body = parseBody(req) || {};
    try {
      const instance = await engine.completeExternalTask({
        token,
        outcome: body.outcome || 'signed',
        signature: body.signature || null,
        comment: body.comment || null,
        acknowledged: !!body.acknowledged,
      });
      json(res, 200, { ok: true, instance });
    } catch (err) {
      storeError(res, err);
    }
    return true;
  }

  if (path === '/hub/configuration/audit' && method === 'GET') {
    if (!perms.canViewConfiguration(permissions, isAdmin)) {
      json(res, 403, { error: 'Forbidden' });
      return true;
    }
    try {
      const events = await store.listAuditEvents({ limit: 100 });
      json(res, 200, { events });
    } catch (err) {
      storeError(res, err);
    }
    return true;
  }

  // ----- CRUD by kind -----
  const kindMatch = path.match(/^\/hub\/configuration\/(request-types|forms|documents|workflows|dashboards|saved-views)(?:\/([^/]+))?(?:\/(publish|archive|duplicate|history|validate))?$/);
  if (kindMatch) {
    const kind = kindFromPath(kindMatch[1]);
    const id = kindMatch[2];
    const action = kindMatch[3];

    if (!id && method === 'GET') {
      if (!perms.canViewConfiguration(permissions, isAdmin)) {
        json(res, 403, { error: 'Forbidden' });
        return true;
      }
      try {
        const definitions = await store.listDefinitions({ kind });
        json(res, 200, { definitions });
      } catch (err) {
        storeError(res, err);
      }
      return true;
    }

    if (!id && method === 'POST') {
      if (!perms.canManageKind(permissions, isAdmin, kind)) {
        json(res, 403, { error: 'Forbidden' });
        return true;
      }
      const body = parseBody(req);
      if (!body || !body.key) {
        json(res, 400, { error: 'key is required' });
        return true;
      }
      try {
        const definition = await store.createDraftDefinition({
          kind,
          key: body.key,
          name: body.name || body.key,
          description: body.description,
          payload: body.payload || body,
          actorEmail,
        });
        json(res, 201, { definition });
      } catch (err) {
        storeError(res, err);
      }
      return true;
    }

    if (id && method === 'GET' && !action) {
      if (!perms.canViewConfiguration(permissions, isAdmin)) {
        json(res, 403, { error: 'Forbidden' });
        return true;
      }
      try {
        const definition = await store.getDefinition(id);
        if (!definition || definition.kind !== kind) {
          json(res, 404, { error: 'Not found' });
          return true;
        }
        json(res, 200, { definition });
      } catch (err) {
        storeError(res, err);
      }
      return true;
    }

    if (id && method === 'PUT' && !action) {
      if (!perms.canManageKind(permissions, isAdmin, kind)) {
        json(res, 403, { error: 'Forbidden' });
        return true;
      }
      const body = parseBody(req);
      if (!body) return json(res, 400, { error: 'Invalid JSON' }), true;
      try {
        const definition = await store.updateDraftVersion({
          definitionId: id,
          expectedRevision: body.expected_revision != null ? body.expected_revision : body.revision,
          payload: body.payload || body,
          actorEmail,
        });
        json(res, 200, { definition });
      } catch (err) {
        storeError(res, err);
      }
      return true;
    }

    if (id && action === 'validate' && method === 'POST') {
      if (!perms.canViewConfiguration(permissions, isAdmin)) {
        json(res, 403, { error: 'Forbidden' });
        return true;
      }
      try {
        const definition = await store.getDefinition(id);
        if (!definition || definition.kind !== kind) {
          json(res, 404, { error: 'Not found' });
          return true;
        }
        const payload =
          (definition.draft_version && definition.draft_version.payload_json) ||
          (definition.published_version && definition.published_version.payload_json) ||
          {};
        const result = validateDefinitionPayload(kind, payload);
        json(res, result.ok ? 200 : 400, result);
      } catch (err) {
        storeError(res, err);
      }
      return true;
    }

    if (id && action === 'publish' && method === 'POST') {
      if (!perms.canPublishConfiguration(permissions, isAdmin)) {
        json(res, 403, { error: 'Forbidden' });
        return true;
      }
      const body = parseBody(req) || {};
      try {
        const definition = await store.publishDefinition({
          definitionId: id,
          actorEmail,
          acknowledgeWarnings: !!body.acknowledge_warnings,
        });
        json(res, 200, { definition });
      } catch (err) {
        storeError(res, err);
      }
      return true;
    }

    if (id && action === 'archive' && method === 'POST') {
      if (!perms.canArchiveConfiguration(permissions, isAdmin)) {
        json(res, 403, { error: 'Forbidden' });
        return true;
      }
      try {
        const definition = await store.archiveDefinition({ definitionId: id, actorEmail });
        json(res, 200, { definition });
      } catch (err) {
        storeError(res, err);
      }
      return true;
    }

    if (id && action === 'duplicate' && method === 'POST') {
      if (!perms.canManageKind(permissions, isAdmin, kind)) {
        json(res, 403, { error: 'Forbidden' });
        return true;
      }
      const body = parseBody(req) || {};
      try {
        const definition = await store.duplicateDefinition({
          definitionId: id,
          actorEmail,
          newKey: body.key,
        });
        json(res, 201, { definition });
      } catch (err) {
        storeError(res, err);
      }
      return true;
    }

    if (id && action === 'history' && method === 'GET') {
      if (!perms.canViewConfiguration(permissions, isAdmin)) {
        json(res, 403, { error: 'Forbidden' });
        return true;
      }
      try {
        const versions = await store.listVersionHistory(id);
        json(res, 200, { versions });
      } catch (err) {
        storeError(res, err);
      }
      return true;
    }
  }

  // ----- workflow runtime -----
  if (path === '/hub/workflow-runtime/start-request-type' && method === 'POST') {
    if (!actorEmail) {
      json(res, 401, { error: 'Authentication required' });
      return true;
    }
    const body = parseBody(req) || {};
    if (!body.request_type_definition_id) {
      json(res, 400, { error: 'request_type_definition_id required' });
      return true;
    }
    try {
      const result = await engine.startFromRequestType({
        requestTypeDefinitionId: body.request_type_definition_id,
        actorEmail,
        title: body.title,
        description: body.description,
        priority: body.priority,
        formValues: body.values || body.form_values || {},
        relatedSubmissionId: body.related_submission_id || null,
      });
      json(res, 201, result);
    } catch (err) {
      storeError(res, err);
    }
    return true;
  }

  if (path === '/hub/workflow-runtime/start' && method === 'POST') {
    if (!perms.canExecuteWorkflow(permissions, isAdmin) && !perms.canPublishConfiguration(permissions, isAdmin)) {
      json(res, 403, { error: 'Forbidden' });
      return true;
    }
    const body = parseBody(req);
    if (!body || !body.workflow_definition_id) {
      json(res, 400, { error: 'workflow_definition_id required' });
      return true;
    }
    try {
      const instance = await engine.startWorkflowInstance({
        workflowDefinitionId: body.workflow_definition_id,
        actorEmail,
        relatedRequestId: body.related_request_id,
        relatedSubmissionId: body.related_submission_id,
        context: body.context || {},
      });
      json(res, 201, { instance });
    } catch (err) {
      storeError(res, err);
    }
    return true;
  }

  if (path.match(/^\/hub\/workflow-runtime\/instances\/by-request\/[^/]+$/) && method === 'GET') {
    if (!actorEmail) {
      json(res, 401, { error: 'Authentication required' });
      return true;
    }
    const requestId = path.split('/').pop();
    try {
      const instance = await engine.getInstanceByRequestId(requestId);
      if (!instance) {
        json(res, 404, { error: 'Not found' });
        return true;
      }
      json(res, 200, { instance });
    } catch (err) {
      storeError(res, err);
    }
    return true;
  }

  if (path.match(/^\/hub\/workflow-runtime\/instances\/[^/]+$/) && method === 'GET') {
    if (!perms.canViewConfiguration(permissions, isAdmin) && !perms.canExecuteWorkflow(permissions, isAdmin)) {
      json(res, 403, { error: 'Forbidden' });
      return true;
    }
    const id = path.split('/').pop();
    try {
      const instance = await engine.getInstance(id);
      if (!instance) {
        json(res, 404, { error: 'Not found' });
        return true;
      }
      json(res, 200, { instance });
    } catch (err) {
      storeError(res, err);
    }
    return true;
  }

  if (path.match(/^\/hub\/workflow-runtime\/instances\/[^/]+\/retry$/) && method === 'POST') {
    if (!perms.canExecuteWorkflow(permissions, isAdmin) && !isAdmin) {
      json(res, 403, { error: 'Forbidden' });
      return true;
    }
    const id = path.split('/')[4];
    try {
      const instance = await engine.retryFailedNode({ instanceId: id, actorEmail });
      json(res, 200, { instance });
    } catch (err) {
      storeError(res, err);
    }
    return true;
  }

  if (path.match(/^\/hub\/workflow-runtime\/tasks\/[^/]+\/claim$/) && method === 'POST') {
    if (!actorEmail) {
      json(res, 401, { error: 'Authentication required' });
      return true;
    }
    const taskId = path.split('/')[4];
    try {
      const task = await engine.claimTask({
        taskId,
        actorEmail,
        actorUserId,
        roleKeys,
      });
      json(res, 200, { task });
    } catch (err) {
      storeError(res, err);
    }
    return true;
  }

  if (path.match(/^\/hub\/workflow-runtime\/tasks\/[^/]+\/complete$/) && method === 'POST') {
    if (!actorEmail && !isAdmin) {
      json(res, 401, { error: 'Authentication required' });
      return true;
    }
    const taskId = path.split('/')[4];
    const body = parseBody(req) || {};
    try {
      const instance = await engine.completeTask({
        taskId,
        actorEmail,
        actorUserId,
        roleKeys,
        outcome: body.outcome,
        comment: body.comment,
        formValues: body.values || body.form_values,
      });
      json(res, 200, { instance });
    } catch (err) {
      storeError(res, err);
    }
    return true;
  }

  if (path === '/hub/workflow-runtime/tasks' && method === 'GET') {
    if (!actorEmail) {
      json(res, 401, { error: 'Authentication required' });
      return true;
    }
    try {
      const tasks = await engine.listTasksForUser({
        email: actorEmail,
        roleKeys,
        userId: actorUserId,
      });
      json(res, 200, { tasks });
    } catch (err) {
      storeError(res, err);
    }
    return true;
  }

  json(res, 404, { error: 'Configuration route not found' });
  return true;
}

module.exports = {
  handleConfigurationRoutes,
};
