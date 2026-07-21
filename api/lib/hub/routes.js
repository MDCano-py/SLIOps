// Hub API route handler — mounted from maintainx.js at path prefix /hub/

const store = require('./store/index.js');
const workflow = require('./workflow');
const aging = require('./aging');
const integrations = require('./integrations');
const registry = require('./document-registry');
const documents = require('./documents');
const demoSeed = require('../../../for-dev/hub-demo-seed');
const assignmentNotifications = require('./notifications/assignment-notifications');
const reviewNotifications = require('./notifications/review-notifications');
const signatureNotifications = require('./notifications/signature-notifications');
const { verifyInboundWebhook, processInboundEmail } = require('./inbound-email/processor');
const { REQUEST_TYPES, REQUEST_STATUSES } = require('./constants');
const { getDeliveryStatusSummary } = require('./delivery-status');
const { handleTemplateRoutes } = require('../templates/routes');
const { handleTemplateRuntimeRoutes } = require('../templates/runtime-routes');
const { handleSpaceRoutes } = require('../spaces/routes');
const { handleRbacRoutes } = require('../rbac/routes');

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

function canViewAll(actorEmail, permissions) {
  if (!actorEmail) return false;
  if (Array.isArray(permissions) && permissions.includes('hub_admin')) return true;
  if (Array.isArray(permissions) && permissions.includes('admin')) return true;
  return false;
}

function hasHubPerm(permissions, permId) {
  if (!Array.isArray(permissions)) return false;
  if (permissions.includes('hub_admin') || permissions.includes('admin')) return true;
  return permissions.includes(permId);
}

function canAccessRequest(request, actorEmail, isAdmin) {
  if (!request) return false;
  if (isAdmin) return true;
  const email = (actorEmail || '').toLowerCase();
  if (!email) return false;
  return (
    (request.requester_email || '').toLowerCase() === email ||
    (request.assigned_to || '').toLowerCase() === email
  );
}

function filterRequestForRole(request, { isAdmin, clientView }) {
  if (!request) return null;
  if (isAdmin) return request;
  if (clientView) {
    return {
      id: request.id,
      request_number: request.request_number,
      request_type: request.request_type,
      title: request.title,
      status: request.client_visible_status || request.status,
      client_notes: request.client_notes,
      created_at: request.created_at,
      due_at: request.due_at,
    };
  }
  const out = { ...request };
  delete out.internal_notes;
  return out;
}

async function buildTimeline(requestId) {
  const [history, steps, comments, docs] = await Promise.all([
    store.listStatusHistory(requestId),
    store.listWorkflowSteps(requestId),
    store.listComments(requestId),
    store.listDocuments(requestId),
  ]);
  const events = [];
  const req = await store.getRequest(requestId);
  if (req) {
    events.push({
      type: 'request_created',
      at: req.created_at,
      title: 'Request created',
      detail: req.request_number,
    });
  }
  history.forEach((h) =>
    events.push({
      type: 'status_change',
      at: h.changed_at,
      title: `Status: ${h.old_status || '—'} → ${h.new_status}`,
      detail: h.note,
      by: h.changed_by,
      source: h.source,
    })
  );
  steps.forEach((s) =>
    events.push({
      type: 'workflow_step',
      at: s.completed_at || s.started_at || s.created_at,
      title: s.step_title,
      detail: s.status,
      step_type: s.step_type,
    })
  );
  comments.forEach((c) =>
    events.push({
      type: 'comment',
      at: c.created_at,
      title: 'Comment',
      detail: c.body,
      by: c.author_email,
    })
  );
  docs.forEach((d) =>
    events.push({
      type: 'document',
      at: d.uploaded_at,
      title: d.file_name,
      detail: d.storage_provider,
    })
  );
  if (req?.maintainx_synced_at) {
    events.push({
      type: 'maintainx_sync',
      at: req.maintainx_synced_at,
      title: 'MaintainX sync',
      detail: req.maintainx_sequential_id || req.maintainx_id,
    });
  }
  const audit = await store.listAuditEvents(requestId);
  audit.forEach((a) =>
    events.push({
      type: 'audit',
      at: a.created_at,
      title: a.event_type.replace(/_/g, ' '),
      detail: a.detail,
      by: a.actor_email,
    })
  );
  events.sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
  return events;
}

/**
 * Main hub router. Returns true if handled.
 */
async function handleHubRoute(path, req, res, ctx) {
  const { actorEmail, permissions } = ctx;
  const isAdmin = canViewAll(actorEmail, permissions);
  const method = req.method;

  const rbacHandled = await handleRbacRoutes(path, req, res, {
    actorEmail,
    permissions,
    isAdmin,
  });
  if (rbacHandled) return true;

  const runtimeHandled = await handleTemplateRuntimeRoutes(path, req, res, {
    actorEmail,
    permissions,
    isAdmin,
  });
  if (runtimeHandled) return true;

  const templateHandled = await handleTemplateRoutes(path, req, res, {
    actorEmail,
    permissions,
    isAdmin,
  });
  if (templateHandled) return true;

  const spaceHandled = await handleSpaceRoutes(path, req, res, {
    actorEmail,
    permissions,
    isAdmin,
  });
  if (spaceHandled) return true;

  // ----- Inbound email (webhook; no hub session required) -----
  if (path === '/hub/inbound-email' && method === 'POST') {
    const authResult = verifyInboundWebhook(req);
    if (!authResult.ok) {
      return json(res, authResult.status || 401, { error: authResult.reason || 'unauthorized' });
    }
    const body = parseBody(req);
    if (!body) return json(res, 400, { error: 'Invalid JSON body' });
    const result = await processInboundEmail(body);
    const httpStatus = result.status === 'failed' && !result.skipped ? 500 : 200;
    return json(res, httpStatus, result);
  }

  function requireHubPerm(res, permId) {
    if (!actorEmail) {
      json(res, 401, { error: 'Unauthorized access' });
      return false;
    }
    if (!hasHubPerm(permissions, permId)) {
      json(res, 403, { error: 'Forbidden' });
      return false;
    }
    return true;
  }

  function requireRequestAccess(res, request) {
    if (!canAccessRequest(request, actorEmail, isAdmin)) {
      json(res, 403, { error: 'Unauthorized access' });
      return false;
    }
    return true;
  }

  // ----- Dashboard -----
  if (path === '/hub/dashboard/summary' && method === 'GET') {
    if (!requireHubPerm(res, 'view_hub_dashboard')) return true;
    const listOpts = { limit: 2000 };
    if (!isAdmin && actorEmail) listOpts.my_email = actorEmail;
    const allForSummary = await store.listRequests(listOpts);
    const summary = await aging.buildDashboardSummary(allForSummary);
    return json(res, 200, summary);
  }

  if (path === '/hub/dashboard/aging' && method === 'GET') {
    if (!requireHubPerm(res, 'view_hub_dashboard')) return true;
    const requests = await store.listRequests({
      open_only: true,
      limit: 500,
      my_email: !isAdmin ? actorEmail : undefined,
    });
    const enriched = await aging.enrichRequestsWithAging(requests);
    return json(res, 200, { items: enriched });
  }

  if (path === '/hub/dashboard/open-requests' && method === 'GET') {
    if (!requireHubPerm(res, 'view_hub_dashboard')) return true;
    const requests = await store.listRequests({
      open_only: true,
      limit: parseInt(req.query?.limit || '100', 10),
      my_email: !isAdmin ? actorEmail : undefined,
    });
    const enriched = await aging.enrichRequestsWithAging(requests);
    return json(res, 200, { requests: enriched });
  }

  if (path === '/hub/dashboard/action-required' && method === 'GET') {
    if (!requireHubPerm(res, 'view_hub_dashboard')) return true;
    const listOpts = { open_only: true, limit: 500 };
    if (!isAdmin && actorEmail) listOpts.my_email = actorEmail;
    const requests = await store.listRequests(listOpts);
    const enriched = await aging.enrichRequestsWithAging(requests);
    const items = enriched.filter((r) => {
      if (['stale', 'aging', 'attention'].includes(r.aging?.bucket)) return true;
      if (actorEmail && r.assigned_to === actorEmail) return true;
      return false;
    });
    return json(res, 200, { items: items.slice(0, 50) });
  }

  if (path === '/hub/my-tasks' && method === 'GET') {
    if (!requireHubPerm(res, 'view_hub_requests')) return true;
    const tasks = await documents.listMyTasks(actorEmail, { isAdmin });
    return json(res, 200, tasks);
  }

  if (path === '/hub/notifications' && method === 'GET') {
    if (!actorEmail) return json(res, 401, { error: 'Unauthorized access' });
    const unreadOnly = req.query?.unread === 'true';
    const list = await store.listNotifications(actorEmail, { unreadOnly });
    const unread_count = await store.countUnreadNotifications(actorEmail);
    return json(res, 200, { notifications: list, unread_count });
  }

  if (path === '/hub/notifications/read-all' && method === 'POST') {
    if (!actorEmail) return json(res, 401, { error: 'Unauthorized access' });
    const result = await store.markAllNotificationsRead(actorEmail);
    return json(res, 200, result);
  }

  const notifRead = path.match(/^\/hub\/notifications\/([^/]+)\/read$/);
  if (notifRead && method === 'POST') {
    const n = await store.markNotificationRead(notifRead[1], actorEmail);
    if (!n) return json(res, 404, { error: 'Notification not found' });
    return json(res, 200, n);
  }

  // ----- Client action (public) -----
  const actionGet = path.match(/^\/hub\/action\/([^/]+)$/);
  if (actionGet && method === 'GET') {
    const token = actionGet[1];
    const link = await store.getActionLinkByToken(token);
    if (!link) return json(res, 404, { error: 'Action link not found' });
    if (link.revoked_at) return json(res, 410, { error: 'Action link revoked' });
    if (link.used_at) return json(res, 410, { error: 'Action link already used' });
    if (new Date(link.expires_at) < new Date()) {
      return json(res, 410, { error: 'Action link expired' });
    }
    const request = await store.getRequest(link.request_id);
    const webDoc = await store.getWebDocumentByRequestId(link.request_id);
    const docTypeKey = webDoc?.document_type_key || request?.request_type || '';
    const formDefinition = registry.getFormDefinitionForAction(docTypeKey);
    const step = link.workflow_step_id
      ? await store.getWorkflowStep(link.workflow_step_id)
      : null;
    return json(res, 200, {
      action_type: link.action_type,
      request: filterRequestForRole(request, { clientView: true }),
      web_document: webDoc,
      form_definition: formDefinition,
      document_type_key: docTypeKey,
      step: step
        ? {
            id: step.id,
            step_title: step.step_title,
            step_type: step.step_type,
            action_type: step.action_type || step.step_type,
            requires_signature: step.requires_signature,
            requires_comment: step.requires_comment,
            requires_file_upload: step.requires_file_upload,
            review_required: step.review_required,
            instructions: step.instructions,
          }
        : null,
    });
  }

  const actionPost = path.match(/^\/hub\/action\/([^/]+)\/(complete|sign|fill|comment|upload|reject|approve)$/);
  if (actionPost && method === 'POST') {
    const token = actionPost[1];
    const action = actionPost[2];
    const link = await store.getActionLinkByToken(token);
    if (!link) return json(res, 404, { error: 'Action link not found' });
    if (link.revoked_at) return json(res, 410, { error: 'Action link revoked' });
    if (link.used_at) return json(res, 410, { error: 'Action link already used' });
    if (new Date(link.expires_at) < new Date()) {
      return json(res, 410, { error: 'Action link expired' });
    }
    const body = parseBody(req);
    if (!body) return json(res, 400, { error: 'Invalid JSON body' });
    const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || '';

    if (action === 'fill') {
      const webDoc = await store.getWebDocumentByRequestId(link.request_id);
      if (!webDoc) return json(res, 404, { error: 'Web document not found' });
      if (webDoc.locked) return json(res, 409, { error: 'Document is locked' });
      let content = body.content_json;
      if (typeof content === 'string') {
        try {
          content = JSON.parse(content);
        } catch {
          return json(res, 400, { error: 'content_json must be valid JSON' });
        }
      }
      if (content && typeof content !== 'object') {
        return json(res, 400, { error: 'content_json must be an object' });
      }
      await store.patchWebDocument(webDoc.id, {
        content_json: content ?? webDoc.content_json ?? null,
        version: (webDoc.version || 1) + 1,
      });
      await documents.addAudit({
        request_id: link.request_id,
        document_id: webDoc.id,
        event_type: 'document_updated',
        actor_email: link.recipient_email,
        actor_name: body.name || link.recipient_email,
        detail: 'Web document content updated via action link',
        metadata: { ip: clientIp, user_agent: userAgent },
      });
    }

    if (action === 'comment' && body.comment) {
      await store.addComment({
        request_id: link.request_id,
        author_email: link.recipient_email,
        author_name: body.name || link.recipient_email,
        body: body.comment,
        visible_to_client: true,
      });
    }

    if (link.workflow_step_id) {
      if (action === 'reject') {
        await workflow.rejectWorkflowStep(link.workflow_step_id, link.recipient_email, {
          notes: body.comment || body.notes || 'Rejected via action link',
        });
      } else if (action === 'fill' || action === 'sign' || action === 'complete' || action === 'approve') {
        const sigPayload = {
          notes: body.comment,
          signature: body.document
            ? {
                file_url: body.document.file_url,
                storage_provider: body.document.storage_provider || 'local',
                signer_email: link.recipient_email,
                signer_name: body.name || link.recipient_email,
                signer_ip: clientIp,
                signer_user_agent: userAgent,
              }
            : null,
          metadata: { ip: clientIp, user_agent: userAgent, action },
        };
        await workflow.completeWorkflowStep(link.workflow_step_id, link.recipient_email, sigPayload);
      }
    }

    if (body.document && action !== 'reject') {
      await store.saveDocument({
        request_id: link.request_id,
        workflow_step_id: link.workflow_step_id,
        document_type: body.document.document_type || 'upload',
        file_name: body.document.file_name,
        file_url: body.document.file_url,
        storage_provider: body.document.storage_provider || 'external_url',
        external_storage_url: body.document.external_storage_url,
        uploaded_by: link.recipient_email,
        signed_at: action === 'sign' ? store.nowIso() : null,
        signer_email: link.recipient_email,
        signer_name: body.name || link.recipient_email,
        signer_ip: clientIp,
        signer_user_agent: userAgent,
      });
      await integrations.queueN8nEvent(
        action === 'sign' ? 'document.signed' : 'document.uploaded',
        await store.getRequest(link.request_id)
      );
    }

    if (action !== 'comment') {
      const used = await store.markActionLinkUsed(link.id);
      if (!used) return json(res, 410, { error: 'Action link already used' });
    }
    return json(res, 200, { ok: true });
  }

  // Auth required below
  if (!actorEmail) return json(res, 401, { error: 'Unauthorized access' });

  // ----- Dev demo data (non-production or hub_admin) -----
  function devDemoAllowed() {
    return demoSeed.isDevDemoAllowed(isAdmin);
  }

  if (path === '/hub/dev/status' && method === 'GET') {
    const { getHubStoreMode } = require('./db/config');
    const { getLegacyKvStatus, getStoreMode } = require('../../../for-dev/redis-client');
    const hubMode = getHubStoreMode();
    const legacy = getLegacyKvStatus();
    return json(res, 200, {
      allowed: devDemoAllowed(),
      is_production: process.env.NODE_ENV === 'production',
      store_mode: hubMode === 'postgres' ? 'postgres' : getStoreMode(),
      hub_store_mode: hubMode,
      legacy_kv: legacy.legacy_kv,
    });
  }

  if (path === '/hub/dev/seed-demo-data' && method === 'POST') {
    if (!devDemoAllowed()) {
      return json(res, 403, {
        error: 'Demo seed is only available in local development (NODE_ENV=development)',
      });
    }
    try {
      const result = await demoSeed.seedAllDemoData(actorEmail);
      return json(res, 200, result);
    } catch (err) {
      console.error('[hub] seed-demo-data failed', err);
      return json(res, 500, { error: 'Failed to seed demo data', detail: err.message });
    }
  }

  if (path === '/hub/dev/clear-demo-data' && method === 'POST') {
    if (!devDemoAllowed()) {
      return json(res, 403, {
        error: 'Demo clear is only available in local development (NODE_ENV=development)',
      });
    }
    try {
      const result = await demoSeed.clearDemoData();
      return json(res, 200, result);
    } catch (err) {
      console.error('[hub] clear-demo-data failed', err);
      return json(res, 500, { error: 'Failed to clear demo data', detail: err.message });
    }
  }

  // ----- Requests CRUD -----
  if (path === '/hub/requests' && method === 'GET') {
    if (!requireHubPerm(res, 'view_hub_requests')) return true;
    const q = req.query || {};
    const opts = {
      limit: parseInt(q.limit || '200', 10),
      request_type: q.request_type,
      status: q.status,
      priority: q.priority,
      assigned_to: q.assigned_to,
      search: q.search,
      date_from: q.date_from,
      date_to: q.date_to,
      open_only: q.open_only === 'true',
    };
    if (!isAdmin) opts.my_email = actorEmail;
    if (q.waiting_on_me === 'true' && actorEmail) opts.assigned_to = actorEmail;
    let requests = await store.listRequests(opts);
    requests = await aging.enrichRequestsWithAging(requests);
    if (q.aging_bucket) {
      requests = requests.filter((r) => r.aging?.bucket === q.aging_bucket);
    }
    if (q.include_progress === 'true') {
      const workflow = require('./workflow');
      requests = await Promise.all(
        requests.map(async (r) => {
          const steps = await store.listWorkflowSteps(r.id);
          return { ...r, progress: workflow.computeProgress(steps) };
        })
      );
    }
    return json(res, 200, { requests, count: requests.length });
  }

  if (path === '/hub/requests' && method === 'POST') {
    if (!hasHubPerm(permissions, 'view_hub_requests')) {
      return json(res, 403, { error: 'Forbidden' });
    }
    const body = parseBody(req);
    if (!body) return json(res, 400, { error: 'Invalid JSON body' });
    if (!body.request_type || !REQUEST_TYPES.includes(body.request_type)) {
      return json(res, 400, { error: 'Missing or invalid request_type' });
    }
    if (!body.title) return json(res, 400, { error: 'Missing required field: title' });

    const rec = await store.createRequest(
      {
        ...body,
        form_payload: body.form_payload || body.content_json || null,
        requester_email: body.requester_email || actorEmail,
        requester_name: body.requester_name || actorEmail,
      },
      actorEmail
    );

    await store.addStatusHistory({
      request_id: rec.id,
      old_status: null,
      new_status: rec.status,
      changed_by: actorEmail,
      changed_by_type: 'user',
      note: 'Request created',
    });

    const docType = registry.getDocumentType(body.request_type);
    const steps = await documents.resolveWorkflowSteps({
      ...body,
      requester_email: rec.requester_email,
    });
    const validation = documents.validateWorkflowSteps(steps, docType);
    if (!validation.ok) return json(res, 400, { error: validation.error });

    const webDoc = await documents.createWebDocumentForRequest(
      rec,
      { ...body, content_json: body.content_json || body.form_payload },
      actorEmail
    );

    if (steps.length) {
      await documents.startWorkflow(rec.id, steps, actorEmail);
    } else {
      const freshRequest = await store.getRequest(rec.id);
      if (freshRequest?.assigned_to) {
        await assignmentNotifications.notifyRequestAssignment({
          request: freshRequest,
          previousAssignee: null,
          actorEmail,
        });
      }
    }

    await integrations.queueN8nEvent('request.created', rec);
    return json(res, 201, { ...rec, web_document_id: webDoc.id });
  }

  const reqIdMatch = path.match(/^\/hub\/requests\/([^/]+)(\/.*)?$/);
  if (reqIdMatch) {
    const requestId = reqIdMatch[1];
    const sub = reqIdMatch[2] || '';

    const requestForAccess = await store.getRequest(requestId);

    if (sub === '/web-document' && method === 'PATCH') {
      if (!requireRequestAccess(res, requestForAccess)) return true;
      const body = parseBody(req);
      if (!body) return json(res, 400, { error: 'Invalid JSON body' });
      const webDoc = await store.getWebDocumentByRequestId(requestId);
      if (!webDoc) return json(res, 404, { error: 'Web document not found' });
      if (webDoc.locked) return json(res, 409, { error: 'Document is locked' });
      const steps = await store.listWorkflowSteps(requestId);
      const waitingFill = steps.find(
        (s) => s.status === 'waiting' && (s.action_type === 'fill' || s.step_type === 'fill')
      );
      const canEdit =
        isAdmin ||
        (waitingFill && (waitingFill.assigned_to_email || '').toLowerCase() === (actorEmail || '').toLowerCase()) ||
        (requestForAccess?.requester_email || '').toLowerCase() === (actorEmail || '').toLowerCase();
      if (!canEdit) return json(res, 403, { error: 'Not authorized to edit this document' });
      const patch = {};
      if (body.content_json !== undefined) patch.content_json = body.content_json;
      if (body.rendered_html !== undefined) patch.rendered_html = body.rendered_html;
      if (body.title !== undefined) patch.title = body.title;
      patch.version = (webDoc.version || 1) + 1;
      const updated = await store.patchWebDocument(webDoc.id, patch);
      await documents.addAudit({
        request_id: requestId,
        document_id: webDoc.id,
        event_type: 'document_updated',
        actor_email: actorEmail,
        detail: 'Web document content updated',
      });
      return json(res, 200, { web_document: updated });
    }

    if (sub === '/workflow' && method === 'PUT') {
      if (!isAdmin && !hasHubPerm(permissions, 'hub_admin')) {
        return json(res, 403, { error: 'Admin required to replace workflow' });
      }
      const body = parseBody(req);
      if (!body || !Array.isArray(body.steps)) {
        return json(res, 400, { error: 'Body must include steps array' });
      }
      const existing = await store.listWorkflowSteps(requestId);
      if (existing.some((s) => s.status === 'completed')) {
        return json(res, 409, { error: 'Cannot replace workflow after steps have completed' });
      }
      await store.deleteWorkflowStepsForRequest(requestId);
      const req = requestForAccess || (await store.getRequest(requestId));
      const resolved = await documents.resolveWorkflowStepsAsync({
        workflow_steps: body.steps,
        request_type: req.request_type,
        requester_email: req.requester_email,
        signer_email: body.signer_email,
      });
      const validation = documents.validateWorkflowSteps(resolved, registry.getDocumentType(req.request_type));
      if (!validation.ok) return json(res, 400, { error: validation.error });
      const created = await documents.startWorkflow(requestId, resolved, actorEmail);
      return json(res, 200, { steps: created });
    }

    if (sub === '/timeline' && method === 'GET') {
      if (!requireRequestAccess(res, requestForAccess)) return true;
      const events = await buildTimeline(requestId);
      return json(res, 200, { events });
    }

    if (sub === '/documents' && method === 'GET') {
      if (!requireRequestAccess(res, requestForAccess)) return true;
      const docs = await store.listDocuments(requestId);
      const webDoc = await store.getWebDocumentByRequestId(requestId);
      return json(res, 200, { documents: docs, web_document: webDoc });
    }

    if (sub === '/audit' && method === 'GET') {
      if (!requireRequestAccess(res, requestForAccess)) return true;
      const audit = await store.listAuditEvents(requestId);
      return json(res, 200, { audit });
    }

    if (sub === '/web-document' && method === 'GET') {
      if (!requireRequestAccess(res, requestForAccess)) return true;
      const webDoc = await store.getWebDocumentByRequestId(requestId);
      if (!webDoc) return json(res, 404, { error: 'Web document not found' });
      return json(res, 200, { web_document: webDoc });
    }

    if (sub === '/comments' && method === 'GET') {
      if (!requireRequestAccess(res, requestForAccess)) return true;
      const comments = await store.listComments(requestId);
      return json(res, 200, { comments });
    }

    if (sub === '/comments' && method === 'POST') {
      if (!requireRequestAccess(res, requestForAccess)) return true;
      const body = parseBody(req);
      if (!body) return json(res, 400, { error: 'Invalid JSON body' });
      if (!body.body) return json(res, 400, { error: 'Missing comment body' });
      const c = await store.addComment({
        request_id: requestId,
        author_email: actorEmail,
        author_name: body.author_name || actorEmail,
        body: body.body,
        visible_to_client: !!body.visible_to_client,
      });
      return json(res, 201, c);
    }

    if (sub === '/status' && method === 'PATCH') {
      if (!isAdmin && !requireRequestAccess(res, requestForAccess)) return true;
      const body = parseBody(req);
      if (!body) return json(res, 400, { error: 'Invalid JSON body' });
      if (!body.status || !REQUEST_STATUSES.includes(body.status)) {
        return json(res, 400, { error: 'Invalid status' });
      }
      const result = await workflow.transitionRequestStatus(requestId, body.status, {
        changed_by: actorEmail,
        note: body.note,
      });
      if (result.error) return json(res, result.status || 400, { error: result.error });
      if (body.status === 'closed') {
        await store.patchRequest(requestId, { closed_at: store.nowIso() });
        await integrations.queueN8nEvent('request.closed', result.record);
      }
      return json(res, 200, result.record);
    }

    if (sub === '/workflow-steps' && method === 'POST') {
      // WOS-80 — creating/replacing workflow steps is an administrative
      // operation (parity with the /workflow PUT route). Require an
      // authenticated admin/hub_admin and a real target request; do not
      // allow arbitrary authenticated users to inject steps on any request.
      if (!actorEmail) return json(res, 401, { error: 'Unauthorized access' });
      if (!requestForAccess) return json(res, 404, { error: 'Request not found' });
      if (!isAdmin && !hasHubPerm(permissions, 'hub_admin')) {
        return json(res, 403, { error: 'Admin required to modify workflow steps' });
      }
      const body = parseBody(req);
      const steps = await documents.resolveWorkflowSteps(body || {});
      const created = await documents.startWorkflow(requestId, steps.length ? steps : body.steps || [body], actorEmail);
      return json(res, 201, { steps: created });
    }

    if (sub === '/visibility' && method === 'PATCH' && isAdmin) {
      const body = parseBody(req);
      const settings = await store.setVisibilitySettings(requestId, body);
      return json(res, 200, settings);
    }

    if (!sub && method === 'GET') {
      const rec = requestForAccess || (await store.getRequest(requestId));
      if (!rec) return json(res, 404, { error: 'Request not found' });
      if (!requireRequestAccess(res, rec)) return true;
      const steps = await store.listWorkflowSteps(requestId);
      const progress = workflow.computeProgress(steps);
      const visibility = await store.getVisibilitySettings(requestId);
      const agingInfo = await aging.classifyRequestAging(rec);
      const webDoc = await store.getWebDocumentByRequestId(requestId);
      return json(res, 200, { request: rec, steps, progress, visibility, aging: agingInfo, web_document: webDoc });
    }

    if (!sub && method === 'PATCH') {
      if (!isAdmin) return json(res, 403, { error: 'Admin required to edit requests' });
      const body = parseBody(req);
      const existing = requestForAccess || (await store.getRequest(requestId));
      const { record } = await store.patchRequest(requestId, body);
      if (
        body.assigned_to !== undefined ||
        body.assigned_to_email !== undefined
      ) {
        await assignmentNotifications.notifyRequestAssignment({
          request: record,
          previousAssignee: existing?.assigned_to,
          actorEmail,
        });
      }
      return json(res, 200, record);
    }
  }

  // ----- Workflow steps -----
  const stepMatch = path.match(/^\/hub\/workflow-steps\/([^/]+)(\/complete|\/reject|\/transfer)?$/);
  if (stepMatch) {
    const stepId = stepMatch[1];
    const action = stepMatch[2];
    const body = parseBody(req);
    const stepForAuth = await store.getWorkflowStep(stepId);
    if (!stepForAuth) return json(res, 404, { error: 'Workflow step not found' });
    const reqForStep = await store.getRequest(stepForAuth.request_id);
    const stepAssignee = (stepForAuth.assigned_to_email || '').toLowerCase();
    const canActOnStep =
      isAdmin ||
      stepAssignee === (actorEmail || '').toLowerCase() ||
      canAccessRequest(reqForStep, actorEmail, isAdmin);
    if (!canActOnStep) return json(res, 403, { error: 'Unauthorized access' });

    if (action === '/complete' && method === 'POST') {
      const result = await workflow.completeWorkflowStep(stepId, actorEmail, body);
      if (result.error) return json(res, result.status, { error: result.error });
      return json(res, 200, result);
    }
    if (action === '/reject' && method === 'POST') {
      const result = await workflow.rejectWorkflowStep(stepId, actorEmail, body);
      if (result.error) return json(res, result.status, { error: result.error });
      return json(res, 200, result);
    }
    if (action === '/transfer' && method === 'POST') {
      const result = await workflow.transferWorkflowStep(
        stepId,
        { email: body.assigned_to_email, name: body.assigned_to_name },
        actorEmail
      );
      if (result.error) return json(res, result.status, { error: result.error });
      return json(res, 200, result);
    }
    if (!action && method === 'PATCH') {
      if (!body) return json(res, 400, { error: 'Invalid JSON body' });
      const previousAssignee = stepForAuth.assigned_to_email;
      const previousStatus = stepForAuth.status;
      const updated = await store.saveWorkflowStep({ ...stepForAuth, ...body });
      await assignmentNotifications.notifyWorkflowStepAssignment({
        request: reqForStep,
        step: updated,
        previousAssignee,
        previousStatus,
        actorEmail,
      });
      if (reviewNotifications.isReviewStep(updated)) {
        const webDoc = await store.getWebDocumentByRequestId(stepForAuth.request_id);
        await reviewNotifications.notifyWorkflowStepReview({
          request: reqForStep,
          step: updated,
          webDoc,
          previousReviewer: previousAssignee,
          previousStatus,
          actorEmail,
        });
      }
      if (signatureNotifications.isSignatureStep(updated)) {
        const webDoc = await store.getWebDocumentByRequestId(stepForAuth.request_id);
        await signatureNotifications.notifyWorkflowStepSignature({
          request: reqForStep,
          step: updated,
          webDoc,
          previousSigner: previousAssignee,
          previousStatus,
          actorEmail,
        });
      }
      return json(res, 200, updated);
    }
  }

  // ----- Action links -----
  if (path === '/hub/action-links' && method === 'POST') {
    if (!isAdmin) return json(res, 403, { error: 'Admin required' });
    const body = parseBody(req);
    if (!body) return json(res, 400, { error: 'Invalid JSON body' });
    const { link, token } = await store.createActionLink(body);
    const base = process.env.PORTAL_BASE_URL || '';
    const url = `${base}/action.html?t=${encodeURIComponent(token)}`;
    if (body.action_type === 'sign' || body.action_type === 'signature') {
      const req = body.request_id ? await store.getRequest(body.request_id) : null;
      const step = body.workflow_step_id ? await store.getWorkflowStep(body.workflow_step_id) : null;
      await signatureNotifications.notifySignatureActionLink({
        request: req,
        step,
        link,
        actionLinkUrl: url,
        actorEmail,
      });
    }
    return json(res, 201, {
      link_id: link.id,
      url,
      expires_at: link.expires_at,
    });
  }

  // ----- Integrations -----
  if (path === '/hub/admin/delivery-status' && method === 'GET') {
    if (!isAdmin && !hasHubPerm(permissions, 'hub_admin')) {
      return json(res, 403, { error: 'Admin required' });
    }
    const limit = Math.min(Math.max(1, Number(req.query?.limit) || 10), 50);
    const summary = await getDeliveryStatusSummary(store, { limit });
    return json(res, 200, summary);
  }

  if (path === '/hub/integrations/status' && method === 'GET') {
    if (!isAdmin && !hasHubPerm(permissions, 'hub_admin')) {
      return json(res, 403, { error: 'Admin required' });
    }
    const notificationAutomation = process.env.N8N_WEBHOOK_NOTIFICATION_CREATED
      ? 'configured'
      : process.env.N8N_WEBHOOK_DEFAULT
        ? 'configured'
        : 'not_configured';
    return json(res, 200, {
      portal: { status: 'online', label: 'Operations portal' },
      maintainx: {
        status: process.env.MAINTAINX_API_KEY ? 'configured' : 'not_configured',
        label: 'MaintainX API',
      },
      data_store: {
        status: process.env.UPSTASH_REDIS_REST_URL || process.env.HUB_USE_LOCAL_STORE ? 'configured' : 'not_configured',
        label: 'Request & document storage',
      },
      notification_delivery: {
        status: notificationAutomation,
        label: 'Notification delivery (automation)',
      },
      pending_automation_events: store.countPendingIntegrationEvents
        ? await store.countPendingIntegrationEvents().catch(() => 0)
        : 0,
    });
  }

  if (path === '/hub/integrations/automation/retry' && method === 'POST' && isAdmin) {
    const results = await integrations.retryPendingIntegrationEvents();
    return json(res, 200, { results, label: 'Pending automation deliveries retried' });
  }

  if (path === '/hub/integrations/n8n/retry' && method === 'POST' && isAdmin) {
    const results = await integrations.retryPendingIntegrationEvents();
    return json(res, 200, { results, label: 'Pending automation deliveries retried' });
  }

  if (path === '/hub/integrations/maintainx/create-work-order' && method === 'POST') {
    const body = parseBody(req);
    let requestId = body.request_id;
    if (!requestId) {
      const rec = await store.createRequest(
        {
          request_type: 'work_order',
          title: body.title || 'Work order request',
          description: body.description || '',
          requester_email: actorEmail,
          priority: body.priority || 'normal',
          location: body.locationName || '',
          status: 'submitted',
          form_payload: body,
        },
        actorEmail
      );
      requestId = rec.id;
      await integrations.queueN8nEvent('request.created', rec);
    }
    const result = await integrations.createWorkOrderInMaintainX(
      requestId,
      body.maintainxPayload || body,
      actorEmail
    );
    if (result.error) return json(res, result.status, { error: result.error, detail: result.detail });
    return json(res, 200, result);
  }

  const mxRetry = path.match(/^\/hub\/integrations\/maintainx\/retry\/([^/]+)$/);
  if (mxRetry && method === 'POST') {
    const body = parseBody(req);
    const result = await integrations.retryMaintainXSync(mxRetry[1], body.maintainxPayload || body, actorEmail);
    if (result.error) return json(res, result.status, { error: result.error, detail: result.detail });
    return json(res, 200, result);
  }

  const mxStatus = path.match(/^\/hub\/integrations\/maintainx\/status\/([^/]+)$/);
  if (mxStatus && method === 'GET') {
    const result = await integrations.fetchMaintainXStatus(mxStatus[1]);
    if (result.error) return json(res, result.status, { error: result.error, detail: result.detail });
    return json(res, 200, result);
  }

  // ----- Document / form registry (extensible request types) -----
  if (path === '/hub/registry' && method === 'GET') {
    if (!requireHubPerm(res, 'view_hub_requests')) return true;
    return json(res, 200, registry.getRegistryBundle());
  }

  if (path === '/hub/registry/document-types' && method === 'GET') {
    if (!requireHubPerm(res, 'view_hub_requests')) return true;
    const enabledOnly = req.query?.enabled !== 'false';
    const category = req.query?.category || null;
    return json(res, 200, {
      document_types: registry.listDocumentTypes({ enabledOnly, category }),
      categories: registry.listCategories(),
    });
  }

  const regTypeMatch = path.match(/^\/hub\/registry\/document-types\/([^/]+)$/);
  if (regTypeMatch && method === 'GET') {
    if (!requireHubPerm(res, 'view_hub_requests')) return true;
    const docType = registry.getDocumentType(regTypeMatch[1]);
    if (!docType) return json(res, 404, { error: 'Document type not found' });
    const formDef = registry.getFormDefinition(docType.key);
    const wf = docType.default_workflow_template_id
      ? registry.getWorkflowTemplate(docType.default_workflow_template_id)
      : null;
    return json(res, 200, { document_type: docType, form_definition: formDef, workflow_template: wf });
  }

  const regFormMatch = path.match(/^\/hub\/registry\/form-definitions\/([^/]+)$/);
  if (regFormMatch && method === 'GET') {
    if (!requireHubPerm(res, 'view_hub_requests')) return true;
    const formDef = registry.getFormDefinition(
      regFormMatch[1],
      req.query?.version ? parseInt(req.query.version, 10) : undefined
    );
    if (!formDef) return json(res, 404, { error: 'Form definition not found' });
    return json(res, 200, { form_definition: formDef });
  }

  if (path === '/hub/registry/workflow-templates' && method === 'GET') {
    if (!requireHubPerm(res, 'view_hub_requests')) return true;
    const key = req.query?.key;
    if (key) {
      let wf = registry.getWorkflowTemplate(key);
      const override = await store.getWorkflowTemplateOverride(key);
      if (override?.steps_json?.length) wf = { ...wf, ...override };
      if (!wf) return json(res, 404, { error: 'Workflow template not found' });
      return json(res, 200, { workflow_template: wf });
    }
    return json(res, 200, { workflow_templates: Object.values(registry.WORKFLOW_TEMPLATES) });
  }

  const regTplPut = path.match(/^\/hub\/registry\/workflow-templates\/([^/]+)$/);
  if (regTplPut && method === 'PUT') {
    if (!isAdmin && !hasHubPerm(permissions, 'hub_admin')) {
      return json(res, 403, { error: 'Admin required to save workflow templates' });
    }
    const body = parseBody(req);
    if (!body || !Array.isArray(body.steps_json || body.steps)) {
      return json(res, 400, { error: 'steps_json array required' });
    }
    const base = registry.getWorkflowTemplate(regTplPut[1]) || {};
    const saved = await store.saveWorkflowTemplateOverride(regTplPut[1], {
      ...base,
      id: regTplPut[1],
      key: body.key || base.key || regTplPut[1],
      label: body.label || base.label || regTplPut[1],
      applies_to_document_type: body.applies_to_document_type || base.applies_to_document_type,
      enabled: body.enabled !== false,
      steps_json: body.steps_json || body.steps,
    });
    return json(res, 200, { workflow_template: saved });
  }

  /** @deprecated Use /hub/registry/document-types — kept for backward compatibility */
  if (path === '/hub/form-definitions' && method === 'GET') {
    if (!requireHubPerm(res, 'view_hub_requests')) return true;
    const types = registry.listDocumentTypes({ enabledOnly: true });
    return json(res, 200, {
      forms: types.map((t) => ({
        id: t.key,
        label: t.label,
        tab: t.portal_tab || null,
        hubForm: t.render_mode === 'schema' ? t.key : null,
        render_mode: t.render_mode,
        custom_component: t.custom_component || null,
        category: t.category,
      })),
      document_types: types,
    });
  }

  if (path === '/hub/settings/aging' && method === 'GET') {
    return json(res, 200, await store.getAgingConfig());
  }

  if (path === '/hub/settings/aging' && method === 'PATCH' && isAdmin) {
    const body = parseBody(req);
    await store.redis.set('hub:settings:aging', JSON.stringify(body));
    return json(res, 200, await store.getAgingConfig());
  }

  if (path === '/hub/settings/portal' && method === 'GET') {
    if (!isAdmin && !hasHubPerm(permissions, 'hub_admin')) {
      return json(res, 403, { error: 'Admin required for portal settings' });
    }
    const settings = await store.getPortalSettings();
    return json(res, 200, { settings });
  }

  if (path === '/hub/settings/portal' && method === 'PATCH') {
    if (!isAdmin && !hasHubPerm(permissions, 'hub_admin')) {
      return json(res, 403, { error: 'Admin required for portal settings' });
    }
    const body = parseBody(req);
    if (!body || typeof body !== 'object') {
      return json(res, 400, { error: 'Invalid JSON body' });
    }
    const settings = await store.setPortalSettings(body);
    return json(res, 200, { settings });
  }

  return false;
}

module.exports = { handleHubRoute, buildTimeline, canViewAll };
