/**
 * Web-native document workflow — documents, templates, tasks, notifications, audit.
 */
const store = require('./store/index.js');
const assignmentNotifications = require('./notifications/assignment-notifications');
const reviewNotifications = require('./notifications/review-notifications');
const signatureNotifications = require('./notifications/signature-notifications');
const registry = require('./document-registry');

const WEB_DOC_STATUSES = [
  'draft',
  'submitted',
  'in_workflow',
  'waiting_on_review',
  'waiting_on_signature',
  'completed',
  'locked',
  'rejected',
];

const ACTION_TYPE_MAP = {
  fill: 'fill',
  intake: 'fill',
  fulfill: 'fill',
  review: 'review',
  approve: 'approve',
  sign: 'sign',
  maintainx: 'approve',
};

function mapStepTypeToAction(stepType) {
  return ACTION_TYPE_MAP[stepType] || 'review';
}

function expandTemplateStep(step, index, body) {
  const actionType = step.action_type || mapStepTypeToAction(step.step_type);
  const email =
    step.assigned_to_email ||
    (actionType === 'sign' && body.signer_email) ||
    (actionType === 'fill' ? body.requester_email : null) ||
    null;
  return {
    step_order: step.step_order != null ? step.step_order : index + 1,
    step_type: step.step_type || actionType,
    action_type: actionType,
    step_title: step.step_title || step.step_type || actionType,
    assigned_to_email: email,
    assigned_to_name: step.assigned_to_name || email,
    assigned_type: step.assigned_type || (email && !String(email).includes('@streamline') ? 'client' : 'employee'),
    status: step.status || (index === 0 ? 'waiting' : 'not_started'),
    required: step.required !== false,
    visible_to_client: !!step.visible_to_client,
    requires_signature: actionType === 'sign' || !!step.requires_signature,
    review_required: actionType === 'review' || !!step.review_required,
    requires_comment: !!step.requires_comment,
    requires_file_upload: !!step.requires_file_upload,
    instructions: step.instructions || '',
    due_at: step.due_at || null,
  };
}

function resolveWorkflowSteps(body) {
  return resolveWorkflowStepsAsync(body);
}

async function resolveWorkflowStepsAsync(body) {
  if (Array.isArray(body.workflow_steps) && body.workflow_steps.length) {
    return body.workflow_steps.map((s, i) => expandTemplateStep(s, i, body));
  }
  const docType = registry.getDocumentType(body.request_type);
  if (docType?.default_workflow_template_id) {
    let tpl = registry.getWorkflowTemplate(docType.default_workflow_template_id);
    const override = await store.getWorkflowTemplateOverride(docType.default_workflow_template_id);
    if (override?.steps_json?.length) tpl = override;
    if (tpl?.steps_json?.length) {
      return tpl.steps_json.map((s, i) => expandTemplateStep(s, i, body));
    }
  }
  const fd = registry.getFormDefinition(body.request_type);
  if (fd?.workflow_steps?.length) {
    return fd.workflow_steps.map((s, i) => expandTemplateStep(s, i, body));
  }
  if (body.form_payload || body.content_json) {
    return [
      expandTemplateStep(
        {
          step_type: 'fill',
          action_type: 'fill',
          step_title: 'Complete form',
          assigned_to_email: body.requester_email,
        },
        0,
        body
      ),
    ];
  }
  return [];
}

function validateWorkflowSteps(steps, docType) {
  if (!steps.length) return { ok: true };
  const routed = steps.filter((s) => s.action_type !== 'fill');
  if (routed.length >= 2) return { ok: true };
  if (steps.length === 1 && steps[0].action_type === 'fill') return { ok: true };
  if (docType?.allow_custom_workflow === false && routed.length < 2) {
    return { ok: false, error: 'Routed document workflows require at least 2 assigned steps.' };
  }
  return { ok: true };
}

async function createWebDocumentForRequest(request, body, actorEmail) {
  const content = body.content_json || body.form_payload || null;
  const doc = await store.createWebDocument({
    request_id: request.id,
    document_type_key: request.request_type,
    title: request.title,
    status: 'submitted',
    content_json: content,
    rendered_html: body.rendered_html || null,
    version: 1,
    created_by: actorEmail,
    current_owner: actorEmail,
    locked: false,
  });
  await addAudit({
    request_id: request.id,
    document_id: doc.id,
    event_type: 'document_created',
    actor_email: actorEmail,
    detail: request.title,
  });
  return doc;
}

async function addAudit({ request_id, document_id, workflow_step_id, event_type, actor_email, actor_name, detail, metadata }) {
  return store.addAuditEvent({
    request_id,
    document_id: document_id || null,
    workflow_step_id: workflow_step_id || null,
    event_type,
    actor_email: actor_email || 'system',
    actor_name: actor_name || null,
    detail: detail || '',
    metadata: metadata || {},
  });
}

async function notifyRecipient({
  recipient_email,
  recipient_name,
  type,
  title,
  message,
  request_id,
  document_id,
  workflow_step_id,
}) {
  if (!recipient_email) return null;
  const n = await store.createNotification({
    recipient_email,
    recipient_name,
    type,
    title,
    message,
    request_id,
    document_id,
    workflow_step_id,
  });
  await store.queueIntegrationEvent({
    event_type: 'notification.created',
    request_id,
    workflow_step_id,
    payload: { notification_id: n.id, type, recipient_email, title },
  });
  return n;
}

async function activateStepAndNotify(step, request, webDoc) {
  const previousAssignee = step.assigned_to_email;
  const previousStatus = step.status;
  const updated = await store.saveWorkflowStep({
    ...step,
    status: step.status === 'not_started' ? 'waiting' : step.status,
    started_at: step.started_at || store.nowIso(),
  });
  const assignee = updated.assigned_to_email;
  if (assignee) {
    await assignmentNotifications.notifyWorkflowStepAssignment({
      request,
      step: updated,
      previousAssignee,
      previousStatus,
      actorEmail: 'system',
    });
    await addAudit({
      request_id: request.id,
      document_id: webDoc?.id,
      workflow_step_id: updated.id,
      event_type: 'step_assigned',
      actor_email: 'system',
      detail: `Assigned to ${assignee}`,
    });
    if (['sign', 'review', 'approve', 'fill'].includes(updated.action_type) && updated.assigned_type === 'client') {
      const actionLinkResult = await maybeCreateActionLink(updated, request);
      if (signatureNotifications.isSignatureStep(updated) && actionLinkResult) {
        await signatureNotifications.notifyWorkflowStepSignature({
          request,
          step: updated,
          webDoc,
          previousSigner: previousAssignee,
          previousStatus,
          actorEmail: 'system',
          actionLinkUrl: actionLinkResult.url,
          actionLinkId: actionLinkResult.link?.id,
        });
      }
    } else if (signatureNotifications.isSignatureStep(updated)) {
      await signatureNotifications.notifyWorkflowStepSignature({
        request,
        step: updated,
        webDoc,
        previousSigner: previousAssignee,
        previousStatus,
        actorEmail: 'system',
      });
    }
    if (reviewNotifications.isReviewStep(updated)) {
      await reviewNotifications.notifyWorkflowStepReview({
        request,
        step: updated,
        webDoc,
        previousReviewer: previousAssignee,
        previousStatus,
        actorEmail: 'system',
      });
    }
  }
  await store.patchRequest(request.id, {
    assigned_to: assignee || request.assigned_to,
    current_step: updated.step_title,
  });
  if (assignee && assignee !== (request.assigned_to || '')) {
    await assignmentNotifications.notifyRequestAssignment({
      request: { ...request, assigned_to: assignee },
      previousAssignee: request.assigned_to,
      actorEmail: 'system',
    });
  }
  return updated;
}

async function maybeCreateActionLink(step, request) {
  if (!step.assigned_to_email) return null;
  const actionType =
    step.action_type === 'sign' || step.requires_signature
      ? 'sign'
      : step.action_type === 'review'
        ? 'review'
        : step.action_type === 'fill'
          ? 'fill'
          : 'complete';
  const { link, token } = await store.createActionLink({
    request_id: request.id,
    workflow_step_id: step.id,
    recipient_email: step.assigned_to_email,
    action_type: actionType,
    expires_in_hours: 168,
  });
  const base = process.env.PORTAL_BASE_URL || '';
  const url = `${base}/action.html?t=${encodeURIComponent(token)}`;
  await addAudit({
    request_id: request.id,
    workflow_step_id: step.id,
    event_type: 'notification_sent',
    actor_email: 'system',
    detail: 'Action link created',
    metadata: { link_id: link.id },
  });
  return { link, url };
}

async function startWorkflow(requestId, steps, actorEmail) {
  const workflow = require('./workflow');
  const created = await workflow.createWorkflowSteps(requestId, steps, actorEmail);
  const request = await store.getRequest(requestId);
  const webDoc = await store.getWebDocumentByRequestId(requestId);
  if (webDoc) {
    await store.patchWebDocument(webDoc.id, { status: 'in_workflow' });
  }
  await addAudit({
    request_id: requestId,
    document_id: webDoc?.id,
    event_type: 'workflow_started',
    actor_email: actorEmail,
    detail: `${created.length} step(s)`,
  });
  const first =
    created.find((s) => s.status === 'waiting') ||
    created.find((s) => s.status === 'not_started') ||
    created.find((s) => !['completed', 'skipped'].includes(s.status));
  if (first) await activateStepAndNotify(first, request, webDoc);
  return created;
}

async function onStepCompleted(step, actorEmail, payload = {}) {
  const request = await store.getRequest(step.request_id);
  const webDoc = await store.getWebDocumentByRequestId(step.request_id);
  const actionType = step.action_type || mapStepTypeToAction(step.step_type);

  if (payload.signature?.file_url) {
    await store.saveDocument({
      request_id: step.request_id,
      workflow_step_id: step.id,
      document_type: 'signature',
      file_name: 'signature.png',
      file_url: payload.signature.file_url,
      storage_provider: payload.signature.storage_provider || 'local',
      uploaded_by: actorEmail,
      signed_at: store.nowIso(),
      signer_email: payload.signature.signer_email || actorEmail,
      signer_name: payload.signature.signer_name || actorEmail,
      signer_ip: payload.signature.signer_ip || null,
      signer_user_agent: payload.signature.signer_user_agent || null,
    });
  }

  await addAudit({
    request_id: step.request_id,
    document_id: webDoc?.id,
    workflow_step_id: step.id,
    event_type: actionType === 'sign' ? 'signature_completed' : actionType === 'review' ? 'review_completed' : 'step_completed',
    actor_email: actorEmail,
    detail: step.step_title,
    metadata: payload.metadata || {},
  });

  const steps = await store.listWorkflowSteps(step.request_id);
  const next = steps.find((s) => s.status === 'not_started');
  if (next) {
    await activateStepAndNotify(next, request, webDoc);
    if (webDoc) {
      const st =
        next.action_type === 'sign'
          ? 'waiting_on_signature'
          : next.action_type === 'review'
            ? 'waiting_on_review'
            : 'in_workflow';
      await store.patchWebDocument(webDoc.id, { status: st, current_owner: next.assigned_to_email });
      if (st === 'waiting_on_review') {
        await reviewNotifications.notifyDocumentReview({
          request,
          webDoc: { ...webDoc, status: st, current_owner: next.assigned_to_email },
          previousDocStatus: webDoc.status,
          reviewerEmail: next.assigned_to_email,
          actorEmail,
        });
      }
      if (st === 'waiting_on_signature') {
        await signatureNotifications.notifyDocumentSignature({
          request,
          webDoc: { ...webDoc, status: st, current_owner: next.assigned_to_email },
          previousDocStatus: webDoc.status,
          signerEmail: next.assigned_to_email,
          actorEmail,
        });
      }
    }
    return { completed: step, next };
  }

  const allDone = steps.every((s) => ['completed', 'skipped'].includes(s.status));
  if (allDone && webDoc) {
    await store.patchWebDocument(webDoc.id, {
      status: 'locked',
      locked: true,
      locked_at: store.nowIso(),
      completed_at: store.nowIso(),
    });
    await addAudit({
      request_id: step.request_id,
      document_id: webDoc.id,
      event_type: 'document_locked',
      actor_email: actorEmail,
      detail: 'Workflow completed',
    });
    await notifyRecipient({
      recipient_email: request.requester_email,
      recipient_name: request.requester_name,
      type: 'document_completed',
      title: `${request.request_number} completed`,
      message: `"${request.title}" has completed all workflow steps.`,
      request_id: request.id,
      document_id: webDoc.id,
    });
  }
  return { completed: step, next: null };
}

async function onStepRejected(step, actorEmail, payload = {}) {
  const webDoc = await store.getWebDocumentByRequestId(step.request_id);
  if (webDoc) {
    await store.patchWebDocument(webDoc.id, { status: 'rejected', locked: true, locked_at: store.nowIso() });
  }
  await addAudit({
    request_id: step.request_id,
    document_id: webDoc?.id,
    workflow_step_id: step.id,
    event_type: 'rejected',
    actor_email: actorEmail,
    detail: payload.notes || 'Step rejected',
  });
  const request = await store.getRequest(step.request_id);
  if (request?.requester_email) {
    await notifyRecipient({
      recipient_email: request.requester_email,
      recipient_name: request.requester_name,
      type: 'document_rejected',
      title: `${request.request_number} rejected`,
      message: payload.notes || 'A workflow step was rejected.',
      request_id: request.id,
      document_id: webDoc?.id,
      workflow_step_id: step.id,
    });
  }
}

async function listMyTasks(actorEmail, { isAdmin = false } = {}) {
  const email = (actorEmail || '').toLowerCase();
  const [requests, allSteps] = await Promise.all([
    store.listRequests({ limit: 500, open_only: true }),
    store.listAllWaitingSteps(),
  ]);

  const fill = [];
  const review = [];
  const sign = [];
  const waitingOnMe = [];
  const waitingOnOthers = [];
  const completed = [];

  const waitingOnClient = [];

  for (const req of requests) {
    const steps = allSteps.filter((s) => s.request_id === req.id);
    const webDoc = await store.getWebDocumentByRequestId(req.id);
    const mySteps = steps.filter((s) => (s.assigned_to_email || '').toLowerCase() === email);
    const waitingSteps = steps.filter((s) => s.status === 'waiting');

    for (const s of mySteps.filter((x) => x.status === 'waiting')) {
      const item = { request: req, step: s, web_document: webDoc };
      waitingOnMe.push(item);
      const act = s.action_type || mapStepTypeToAction(s.step_type);
      if (act === 'fill') fill.push(item);
      else if (act === 'review' || act === 'approve') review.push(item);
      else if (act === 'sign') sign.push(item);
    }

    if (waitingSteps.length && !mySteps.some((s) => s.status === 'waiting')) {
      if ((req.requester_email || '').toLowerCase() === email || isAdmin) {
        waitingOnOthers.push({ request: req, steps: waitingSteps, web_document: webDoc });
      }
    }

    const clientWaiting = waitingSteps.filter((s) => s.assigned_type === 'client');
    if (clientWaiting.length && ((req.requester_email || '').toLowerCase() === email || isAdmin)) {
      waitingOnClient.push({ request: req, steps: clientWaiting, web_document: webDoc });
    }
  }

  const closed = await store.listRequests({ limit: 100 });
  for (const req of closed.filter((r) => ['completed', 'closed'].includes(r.status)).slice(0, 20)) {
    if ((req.requester_email || '').toLowerCase() === email || (req.assigned_to || '').toLowerCase() === email) {
      completed.push({ request: req, web_document: await store.getWebDocumentByRequestId(req.id) });
    }
  }

  return { fill, review, sign, waiting_on_me: waitingOnMe, waiting_on_others: waitingOnOthers, waiting_on_client: waitingOnClient, recently_completed: completed };
}

module.exports = {
  WEB_DOC_STATUSES,
  mapStepTypeToAction,
  resolveWorkflowSteps,
  resolveWorkflowStepsAsync,
  validateWorkflowSteps,
  createWebDocumentForRequest,
  startWorkflow,
  onStepCompleted,
  onStepRejected,
  addAudit,
  notifyRecipient,
  listMyTasks,
  maybeCreateActionLink,
};
