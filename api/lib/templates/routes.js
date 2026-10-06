/**
 * WOS-55/56/57 — Admin form template versioning routes (thin handlers).
 */
const templateStore = require('../templates/store');
const spaceStore = require('../spaces/store');
const { validateTemplateVersion } = require('./validator');
const { normalizeSchemaJson } = require('./schema-normalize');
const { importSchemaInput, mergeImportedSchema, validateImportedSchema, workflowPublishNotice } = require('./schema-import');
const { kindForSpace, normalizeTemplateKind } = require('./template-kind');
const { canInspectSubmission } = require('./runtime-rbac');
const rbacPostgres = require('../rbac/postgres');
const { recordSecurityAudit } = require('../security-audit');
const authErrors = require('../auth-errors');

// WOS-80 — resolve an actor's workflow role keys for submission authorization
// (mirrors the runtime router helper). Fails open to [] on any error.
async function loadActorWorkflowRoles(actorEmail) {
  if (!actorEmail || !rbacPostgres.isAvailable()) return [];
  try {
    return await rbacPostgres.getUserRoleKeys(actorEmail);
  } catch {
    return [];
  }
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

function canManageTemplates(permissions, isAdmin) {
  if (isAdmin) return true;
  if (!Array.isArray(permissions)) return false;
  return permissions.includes('hub_admin') || permissions.includes('admin');
}

function storeError(res, err) {
  const status = err.status || 500;
  const body = { error: err.message, code: err.code || 'ERROR' };
  if (err.details) body.validation = err.details;
  return json(res, status, body);
}

/**
 * @returns {boolean} true if handled
 */
async function handleTemplateRoutes(path, req, res, ctx) {
  const method = (req.method || 'GET').toUpperCase();
  const { permissions, isAdmin, actorEmail } = ctx;

  if (!path.startsWith('/hub/templates')) return false;

  if (!templateStore.isTemplatePostgresMode()) {
    json(res, 503, {
      error: 'Template store requires Postgres mode',
      detail: 'Set HUB_STORE_MODE=postgres and DATABASE_URL (see .env.local.postgres.example)',
      code: 'POSTGRES_REQUIRED',
    });
    return true;
  }

  const adminOnly = (handler) => async () => {
    if (!canManageTemplates(permissions, isAdmin)) {
      json(res, 403, { error: 'Admin required for template management' });
      return;
    }
    return handler();
  };

  if (path === '/hub/templates' && method === 'GET') {
    if (!canManageTemplates(permissions, isAdmin)) {
      json(res, 403, { error: 'Admin required for template management' });
      return true;
    }
    try {
      const templates = await templateStore.listTemplates();
      json(res, 200, { templates });
    } catch (err) {
      storeError(res, err);
    }
    return true;
  }

  if (path === '/hub/templates' && method === 'POST') {
    await adminOnly(async () => {
      const body = parseBody(req);
      if (!body || !body.key || !body.name) {
        json(res, 400, { error: 'key and name are required' });
        return;
      }
      try {
        const result = await templateStore.createTemplate({
          key: body.key,
          name: body.name,
          description: body.description || null,
          createdBy: actorEmail,
          schema_json: body.schema_json || {},
          workflow_json: body.workflow_json || {},
          validation_json: body.validation_json || {},
          template_kind: normalizeTemplateKind(body.template_kind) || kindForSpace(body.space_key),
          launch_config_json: body.launch_config_json || null,
        });
        json(res, 201, result);
      } catch (err) {
        storeError(res, err);
      }
    })();
    return true;
  }

  // WOS-80 — unified archive: list dynamic form submissions. Admin/hub_admin
  // see all submitted forms; non-admins only see submissions they created
  // (workflow-actor access to specific submissions remains via the submission
  // detail route). Returns { records, count } for the archive view.
  const [subListPath, subListQuery] = path.split('?');
  if (subListPath === '/hub/templates/submissions' && method === 'GET') {
    if (!actorEmail) {
      json(res, 401, authErrors.wosAuthRequiredBody('Unauthorized access'));
      return true;
    }
    try {
      const query = new URLSearchParams(subListQuery || '');
      const opts = {
        limit: query.get('limit') || 500,
        offset: query.get('offset') || 0,
      };
      if (!canManageTemplates(permissions, isAdmin)) {
        opts.createdBy = actorEmail;
      }
      const result = await templateStore.listSubmissions(opts);
      json(res, 200, result);
    } catch (err) {
      storeError(res, err);
    }
    return true;
  }

  const subGetMatch = path.match(/^\/hub\/templates\/submissions\/([^/]+)$/);
  if (subGetMatch && method === 'GET') {
    // WOS-80 — authorize submission reads (was previously unguarded IDOR).
    // Unauthenticated → 401; otherwise only admins, the submission creator,
    // or an actor whose workflow roles permit inspection may read it.
    if (!actorEmail) {
      json(res, 401, authErrors.wosAuthRequiredBody('Unauthorized access'));
      return true;
    }
    const bundle = await templateStore.getSubmissionWithVersion(subGetMatch[1]);
    if (!bundle) {
      json(res, 404, { error: 'Submission not found' });
      return true;
    }
    const actorWorkflowRoles = await loadActorWorkflowRoles(actorEmail);
    if (!canInspectSubmission(permissions, isAdmin, bundle.submission, actorEmail, actorWorkflowRoles)) {
      json(res, 403, { error: 'Forbidden' });
      return true;
    }
    json(res, 200, bundle);
    return true;
  }

  const versionGetMatch = path.match(/^\/hub\/templates\/versions\/([^/]+)$/);
  if (versionGetMatch && method === 'GET') {
    if (!canManageTemplates(permissions, isAdmin)) {
      json(res, 403, { error: 'Admin required for template management' });
      return true;
    }
    const version = await templateStore.getVersion(versionGetMatch[1]);
    if (!version) {
      json(res, 404, { error: 'Version not found' });
      return true;
    }
    const template = await templateStore.getTemplate(version.template_id);
    json(res, 200, { template, version });
    return true;
  }

  const versionPutMatch = path.match(/^\/hub\/templates\/versions\/([^/]+)$/);
  if (versionPutMatch && method === 'PUT') {
    await adminOnly(async () => {
      const body = parseBody(req) || {};
      try {
        const updated = await templateStore.updateDraftVersion(
          versionPutMatch[1],
          {
            schema_json: body.schema_json,
            workflow_json: body.workflow_json,
            validation_json: body.validation_json,
          },
          actorEmail
        );
        json(res, 200, { version: updated });
      } catch (err) {
        storeError(res, err);
      }
    })();
    return true;
  }

  const validateMatch = path.match(/^\/hub\/templates\/versions\/([^/]+)\/validate$/);
  if (validateMatch && method === 'POST') {
    await adminOnly(async () => {
      const body = parseBody(req) || {};
      let schema_json = body.schema_json;
      let workflow_json = body.workflow_json;
      if (schema_json === undefined || workflow_json === undefined) {
        const version = await templateStore.getVersion(validateMatch[1]);
        if (!version) {
          json(res, 404, { error: 'Version not found' });
          return;
        }
        schema_json = schema_json !== undefined ? schema_json : version.schema_json;
        workflow_json = workflow_json !== undefined ? workflow_json : version.workflow_json;
      }
      const result = validateTemplateVersion({
        schema_json,
        workflow_json,
        template_kind: body.template_kind,
      });
      json(res, 200, result);
    })();
    return true;
  }

  const publishMatch = path.match(/^\/hub\/templates\/versions\/([^/]+)\/publish$/);
  if (publishMatch && method === 'POST') {
    await adminOnly(async () => {
      try {
        const published = await templateStore.publishDraftVersion(publishMatch[1], actorEmail);
        const template = await templateStore.getTemplate(published.template_id);
        recordSecurityAudit('template.publish', {
          actor: actorEmail,
          template_id: published.template_id,
          version_id: publishMatch[1],
        });
        json(res, 200, { publishedVersion: published, template });
      } catch (err) {
        storeError(res, err);
      }
    })();
    return true;
  }

  const retireMatch = path.match(/^\/hub\/templates\/versions\/([^/]+)\/retire$/);
  if (retireMatch && method === 'POST') {
    await adminOnly(async () => {
      try {
        const retired = await templateStore.retirePublishedVersion(retireMatch[1], actorEmail);
        json(res, 200, { version: retired });
      } catch (err) {
        storeError(res, err);
      }
    })();
    return true;
  }

  const versionsListMatch = path.match(/^\/hub\/templates\/([^/]+)\/versions$/);
  if (versionsListMatch && method === 'GET') {
    if (!canManageTemplates(permissions, isAdmin)) {
      json(res, 403, { error: 'Admin required for template management' });
      return true;
    }
    const versions = await templateStore.listVersionsForTemplate(versionsListMatch[1]);
    if (versions === null) {
      json(res, 404, { error: 'Template not found' });
      return true;
    }
    json(res, 200, { versions });
    return true;
  }

  const launchConfigMatch = path.match(/^\/hub\/templates\/([^/]+)\/launch-config$/);
  if (launchConfigMatch && method === 'GET') {
    await adminOnly(async () => {
      try {
        const template = await templateStore.getTemplate(launchConfigMatch[1]);
        if (!template) {
          json(res, 404, { error: 'Template not found' });
          return;
        }
        const config = await spaceStore.getTemplateLaunchConfig(template.id);
        const entry = await spaceStore.getLaunchEntryForTemplate(template.id);
        json(res, 200, { ...config, launch_entry: entry });
      } catch (err) {
        storeError(res, err);
      }
    })();
    return true;
  }

  if (launchConfigMatch && method === 'PUT') {
    await adminOnly(async () => {
      const body = parseBody(req);
      if (!body) {
        json(res, 400, { error: 'Invalid JSON body' });
        return;
      }
      try {
        const template = await templateStore.getTemplate(launchConfigMatch[1]);
        if (!template) {
          json(res, 404, { error: 'Template not found' });
          return;
        }
        const result = await spaceStore.updateTemplateLaunchConfig(template.id, body, actorEmail);
        json(res, 200, result);
      } catch (err) {
        storeError(res, err);
      }
    })();
    return true;
  }

  if (path === '/hub/workflow-templates' && method === 'GET') {
    if (!canManageTemplates(permissions, isAdmin)) {
      json(res, 403, { error: 'Admin required for template management' });
      return true;
    }
    try {
      const workflows = await templateStore.listPublishedWorkflowTemplates();
      json(res, 200, { workflows });
    } catch (err) {
      storeError(res, err);
    }
    return true;
  }

  if (path === '/hub/templates/schema/normalize' && method === 'POST') {
    await adminOnly(async () => {
      const body = parseBody(req) || {};
      const result = normalizeSchemaJson(body.schema_json || {}, { assignIds: body.assign_ids !== false });
      json(res, 200, result);
    })();
    return true;
  }

  if (path === '/hub/templates/import/normalize' && method === 'POST') {
    await adminOnly(async () => {
      const body = parseBody(req) || {};
      const input = body.input != null ? body.input : body.schema_json != null ? body.schema_json : body.text;
      const result = importSchemaInput(input, { inputKind: body.input_kind || body.inputKind || 'json' });
      if (result.ok && body.validate !== false) {
        result.validation = validateImportedSchema(result.schema_json, body.template_kind);
        result.publish_notices = workflowPublishNotice(body.workflow_json, body.binding_mode);
      }
      json(res, 200, result);
    })();
    return true;
  }

  const importApplyMatch = path.match(/^\/hub\/templates\/([^/]+)\/versions\/([^/]+)\/import\/apply$/);
  if (importApplyMatch && method === 'POST') {
    await adminOnly(async () => {
      const body = parseBody(req) || {};
      const templateId = importApplyMatch[1];
      const versionId = importApplyMatch[2];
      const template = await templateStore.getTemplate(templateId);
      if (!template) {
        json(res, 404, { error: 'Template not found' });
        return;
      }
      const version = await templateStore.getVersion(versionId);
      if (!version) {
        json(res, 404, { error: 'Version not found' });
        return;
      }
      if (version.status !== 'draft') {
        json(res, 409, { error: 'Import can only apply to draft versions', code: 'IMMUTABLE' });
        return;
      }
      const normalized = importSchemaInput(body.schema_json || body.input, { inputKind: body.input_kind || 'json' });
      if (!normalized.ok) {
        json(res, 400, { error: 'Import normalization failed', validation: { errors: normalized.errors }, warnings: normalized.warnings });
        return;
      }
      const mode = body.mode === 'append' ? 'append' : 'replace';
      const merged = mergeImportedSchema(version.schema_json, normalized.schema_json, mode);
      const validation = validateImportedSchema(merged, template.template_kind);
      if (!validation.ok) {
        json(res, 400, { error: 'Imported schema failed validation', validation, warnings: normalized.warnings });
        return;
      }
      let bindingMode = 'none';
      try {
        const binding = await templateStore.getTemplateBinding(template.id);
        bindingMode = binding?.binding_mode || 'none';
      } catch {
        bindingMode = 'none';
      }
      const publish_notices = workflowPublishNotice(version.workflow_json, bindingMode);
      try {
        const updated = await templateStore.updateDraftVersion(
          versionId,
          { schema_json: merged, workflow_json: version.workflow_json },
          actorEmail
        );
        json(res, 200, {
          version: updated,
          mode,
          warnings: normalized.warnings,
          warnings_grouped: normalized.warnings_grouped,
          validation,
          publish_notices,
          field_count: normalized.field_count,
          section_count: normalized.section_count,
        });
      } catch (err) {
        storeError(res, err);
      }
    })();
    return true;
  }

  const bindingMatch = path.match(/^\/hub\/templates\/([^/]+)\/binding$/);
  if (bindingMatch && method === 'GET') {
    await adminOnly(async () => {
      try {
        const template = await templateStore.getTemplate(bindingMatch[1]);
        if (!template) {
          json(res, 404, { error: 'Template not found' });
          return;
        }
        const binding = await templateStore.getTemplateBinding(template.id);
        json(res, 200, { binding, binding_mode: binding?.binding_mode || 'none', template });
      } catch (err) {
        storeError(res, err);
      }
    })();
    return true;
  }

  if (bindingMatch && method === 'PUT') {
    await adminOnly(async () => {
      const body = parseBody(req);
      if (!body) {
        json(res, 400, { error: 'Invalid JSON body' });
        return;
      }
      try {
        const template = await templateStore.getTemplate(bindingMatch[1]);
        if (!template) {
          json(res, 404, { error: 'Template not found' });
          return;
        }
        const result = await templateStore.upsertTemplateBinding(template.id, body, actorEmail);
        json(res, 200, result);
      } catch (err) {
        storeError(res, err);
      }
    })();
    return true;
  }

  if (bindingMatch && method === 'DELETE') {
    await adminOnly(async () => {
      try {
        const template = await templateStore.getTemplate(bindingMatch[1]);
        if (!template) {
          json(res, 404, { error: 'Template not found' });
          return;
        }
        const result = await templateStore.deleteTemplateBinding(template.id, actorEmail);
        json(res, 200, result);
      } catch (err) {
        storeError(res, err);
      }
    })();
    return true;
  }

  const archiveMatch = path.match(/^\/hub\/templates\/([^/]+)\/archive$/);
  if (archiveMatch && method === 'POST') {
    await adminOnly(async () => {
      try {
        const template = await templateStore.archiveTemplate(archiveMatch[1], actorEmail);
        recordSecurityAudit('template.archive', { actor: actorEmail, template_id: archiveMatch[1] });
        json(res, 200, { template });
      } catch (err) {
        storeError(res, err);
      }
    })();
    return true;
  }

  const deleteMatch = path.match(/^\/hub\/templates\/([^/]+)\/delete$/);
  if (deleteMatch && method === 'POST') {
    await adminOnly(async () => {
      try {
        const result = await templateStore.deleteDraftTemplate(deleteMatch[1]);
        recordSecurityAudit('template.delete', { actor: actorEmail, template_id: deleteMatch[1] });
        json(res, 200, result);
      } catch (err) {
        storeError(res, err);
      }
    })();
    return true;
  }

  const tplMatch = path.match(/^\/hub\/templates\/([^/]+)$/);
  if (tplMatch && method === 'GET') {
    if (!canManageTemplates(permissions, isAdmin)) {
      json(res, 403, { error: 'Admin required for template management' });
      return true;
    }
    const template = await templateStore.getTemplate(tplMatch[1]);
    if (!template) {
      json(res, 404, { error: 'Template not found' });
      return true;
    }
    const [draft, published, versions] = await Promise.all([
      templateStore.getLatestDraftVersion(template.id),
      templateStore.getCurrentPublishedVersion(template.id),
      templateStore.listVersionsForTemplate(template.id),
    ]);
    json(res, 200, { template, draftVersion: draft, publishedVersion: published, versions });
    return true;
  }

  const draftMatch = path.match(/^\/hub\/templates\/([^/]+)\/drafts$/);
  if (draftMatch && method === 'POST') {
    await adminOnly(async () => {
      const body = parseBody(req) || {};
      try {
        const draft = await templateStore.createDraftVersion({
          templateId: draftMatch[1],
          createdBy: actorEmail,
          schema_json: body.schema_json || {},
          workflow_json: body.workflow_json || {},
          validation_json: body.validation_json || {},
        });
        json(res, 201, { draftVersion: draft });
      } catch (err) {
        storeError(res, err);
      }
    })();
    return true;
  }

  const cloneMatch = path.match(/^\/hub\/templates\/([^/]+)\/clone-draft$/);
  if (cloneMatch && method === 'POST') {
    await adminOnly(async () => {
      try {
        const draft = await templateStore.clonePublishedToDraft(cloneMatch[1], actorEmail);
        json(res, 201, { draftVersion: draft });
      } catch (err) {
        storeError(res, err);
      }
    })();
    return true;
  }

  const submissionMatch = path.match(/^\/hub\/templates\/([^/]+)\/submissions$/);
  if (submissionMatch && method === 'POST') {
    const body = parseBody(req) || {};
    try {
      const template = await templateStore.getTemplate(submissionMatch[1]);
      if (!template) {
        json(res, 404, { error: 'Template not found' });
        return true;
      }
      const result = await templateStore.createSubmission({
        templateId: template.id,
        data_json: body.data_json || body.data || {},
        createdBy: actorEmail,
      });
      json(res, 201, result);
    } catch (err) {
      storeError(res, err);
    }
    return true;
  }

  json(res, 404, { error: 'Template route not found' });
  return true;
}

module.exports = { handleTemplateRoutes };
