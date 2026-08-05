/**
 * Configurable workflow runtime engine.
 * Extends platform capabilities without replacing legacy request workflow.
 */

const { Pool } = require('pg');
const { resolvePgSsl } = require('../../hub/db/pg-ssl');
const store = require('../store');
const { evaluateCondition } = require('../conditions');
const { isStartNodeType, isTerminalNodeType, isHumanNodeType, getNodeType } = require('../nodes/registry');
const { resolveVariables } = require('../variables/resolver');
const { sanitizeHtml } = require('../sanitize');
const { resolveAssignment, findUserByEmail, hubAdminUsers } = require('./resolve-assignment');
const {
  notifyTaskAssigned,
  notifyAssignmentFailed,
  dismissRoleCandidateNotifications,
  notifyWorkflowCompleted,
} = require('./task-notifications');
const {
  createExternalParticipant,
  getExternalParticipantByToken,
  listGeneratedDocsForInstance,
} = require('./external-participants');

let pool = null;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: resolvePgSsl(process.env.DATABASE_URL),
    });
  }
  return pool;
}

function idempotencyKey(instanceId, nodeKey, attempt, op) {
  return `${instanceId}:${nodeKey}:${attempt}:${op || 'exec'}`;
}

async function loadPublishedWorkflow(definitionId) {
  const def = await store.getDefinition(definitionId);
  if (!def || def.kind !== 'workflow' || !def.published_version) {
    const err = new Error('Published workflow not found');
    err.status = 404;
    err.code = 'WORKFLOW_NOT_FOUND';
    throw err;
  }
  return def;
}

function findStartNode(nodes) {
  return (nodes || []).find((n) => isStartNodeType(n.type)) || null;
}

function outgoing(connections, nodeKey, outcomeKey) {
  const list = (connections || [])
    .filter((c) => c.source === nodeKey)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  if (outcomeKey) {
    const matched = list.filter((c) => c.outcome_key === outcomeKey || c.label === outcomeKey);
    if (matched.length) return matched;
  }
  return list;
}

async function startWorkflowInstance({
  workflowDefinitionId,
  actorEmail,
  relatedRequestId,
  relatedSubmissionId,
  context,
}) {
  store.assertPostgres();
  const def = await loadPublishedWorkflow(workflowDefinitionId);
  const payload = def.published_version.payload_json || {};
  const nodes = payload.nodes || [];
  const start = findStartNode(nodes);
  if (!start) {
    const err = new Error('Workflow has no start node');
    err.status = 400;
    err.code = 'NO_START';
    throw err;
  }
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const inst = await client.query(
      `INSERT INTO cfg_workflow_instances
        (definition_id, version_id, runtime_type, related_request_id, related_submission_id, state, current_node_key, context_json, created_by, started_at)
       VALUES ($1,$2,'configurable',$3,$4,'running',$5,$6::jsonb,$7,now())
       RETURNING *`,
      [
        def.id,
        def.published_version.id,
        relatedRequestId || null,
        relatedSubmissionId || null,
        start.key,
        JSON.stringify(context || {}),
        actorEmail || null,
      ]
    );
    const instance = inst.rows[0];
    await store.writeAudit(client, {
      actor_email: actorEmail,
      action: 'workflow.start',
      definition_kind: 'workflow',
      definition_id: def.id,
      version_id: def.published_version.id,
      after_summary: { instance_id: instance.id, start: start.key },
      meta_json: { related_request_id: relatedRequestId || null },
    });
    await client.query('COMMIT');
    await advanceInstance(instance.id, { actorEmail });
    return getInstance(instance.id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getInstance(id) {
  store.assertPostgres();
  const p = getPool();
  const { rows } = await p.query(`SELECT * FROM cfg_workflow_instances WHERE id = $1`, [id]);
  if (!rows[0]) return null;
  const execs = await p.query(
    `SELECT * FROM cfg_node_executions WHERE instance_id = $1 ORDER BY created_at ASC`,
    [id]
  );
  const tasks = await p.query(
    `SELECT * FROM cfg_workflow_tasks WHERE instance_id = $1 ORDER BY created_at ASC`,
    [id]
  );
  return { ...rows[0], executions: execs.rows, tasks: tasks.rows };
}

async function createNodeExecution(client, instance, node, attempt = 1) {
  const key = idempotencyKey(instance.id, node.key, attempt, 'exec');
  const existing = await client.query(
    `SELECT * FROM cfg_node_executions WHERE idempotency_key = $1`,
    [key]
  );
  if (existing.rows[0]) return existing.rows[0];
  const { rows } = await client.query(
    `INSERT INTO cfg_node_executions
      (instance_id, node_key, node_type, state, attempt, idempotency_key, started_at)
     VALUES ($1,$2,$3,'running',$4,$5,now())
     RETURNING *`,
    [instance.id, node.key, node.type, attempt, key]
  );
  return rows[0];
}

async function completeExecution(client, executionId, outputs, state = 'completed') {
  await client.query(
    `UPDATE cfg_node_executions
     SET state = $2, outputs_json = $3::jsonb, completed_at = now(), updated_at = now()
     WHERE id = $1`,
    [executionId, state, JSON.stringify(outputs || {})]
  );
}

async function failExecution(client, executionId, summary) {
  await client.query(
    `UPDATE cfg_node_executions
     SET state = 'failed', error_summary = $2, completed_at = now(), updated_at = now()
     WHERE id = $1`,
    [executionId, String(summary || 'failed').slice(0, 2000)]
  );
}

async function createHumanTask(client, instance, execution, node, context) {
  const meta = getNodeType(node.type);
  const taskType = (meta && meta.taskType) || 'Provide Information';
  const cfg = node.config || {};
  const resolution = await resolveAssignment({ client, node, context: context || instance.context_json || {} });

  if (!resolution.ok) {
    await client.query(
      `UPDATE cfg_node_executions
       SET state = 'waiting', assignment_error = $2, assignment_mode = $3, updated_at = now()
       WHERE id = $1`,
      [execution.id, resolution.error || 'Assignment failed', resolution.mode]
    );
    await client.query(
      `UPDATE cfg_workflow_instances
       SET state = 'waiting', current_node_key = $2, failure_summary = $3, updated_at = now()
       WHERE id = $1`,
      [instance.id, node.key, resolution.error || 'Assignment failed']
    );
    const admins = await hubAdminUsers(client);
    await notifyAssignmentFailed({
      client,
      instance,
      node,
      error: resolution.error || 'Assignment failed',
      adminUsers: admins,
    });
    await store.writeAudit(client, {
      actor_email: context && context.currentUser && context.currentUser.email,
      action: 'workflow.assignment_failed',
      definition_kind: 'workflow',
      definition_id: instance.definition_id,
      version_id: instance.version_id,
      after_summary: { instance_id: instance.id, node: node.key, error: resolution.error },
      meta_json: { related_request_id: instance.related_request_id || null },
    });
    return { task: null, resolution, blocked: true };
  }

  const assignedEmail =
    resolution.assignmentKind === 'specific_user'
      ? resolution.email
      : resolution.assignmentKind === 'external'
        ? resolution.email
        : null;
  const assignedUserId = resolution.assignmentKind === 'specific_user' ? resolution.userId : null;
  const assignedRole = resolution.assignmentKind === 'shared_role' ? resolution.roleKey : null;
  const summaryParts = [];
  if (resolution.assignmentKind === 'specific_user' && resolution.user) {
    summaryParts.push(resolution.user.name || resolution.user.email);
  } else if (resolution.assignmentKind === 'shared_role') {
    summaryParts.push(`Role ${resolution.roleKey} · ${(resolution.users || []).length} eligible`);
  } else if (resolution.assignmentKind === 'external') {
    summaryParts.push(`External ${resolution.email}`);
  }
  if (resolution.fallbackApplied) summaryParts.push(`Fallback: ${resolution.fallbackApplied}`);

  const { rows } = await client.query(
    `INSERT INTO cfg_workflow_tasks
      (instance_id, node_execution_id, task_type, status, title, instructions,
       assignment_mode, assigned_user_email, assigned_user_id, assigned_role,
       related_request_id, assignment_summary, fallback_applied, due_at)
     VALUES ($1,$2,$3,'open',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      instance.id,
      execution.id,
      taskType,
      node.name || taskType,
      cfg.instructions || cfg.description || null,
      resolution.mode,
      assignedEmail,
      assignedUserId,
      assignedRole,
      instance.related_request_id || null,
      summaryParts.join(' · ') || null,
      resolution.fallbackApplied || null,
      cfg.due_at || null,
    ]
  );
  const task = rows[0];

  await client.query(
    `UPDATE cfg_node_executions
     SET state = 'waiting',
         assignee_email = $2,
         assignee_role = $3,
         assigned_user_id = $4,
         assignment_mode = $5,
         assignment_error = NULL,
         updated_at = now()
     WHERE id = $1`,
    [execution.id, assignedEmail, assignedRole, assignedUserId, resolution.mode]
  );
  await client.query(
    `UPDATE cfg_workflow_instances SET state = 'waiting', current_node_key = $2, failure_summary = NULL, updated_at = now() WHERE id = $1`,
    [instance.id, node.key]
  );

  const requestNumber =
    (context && context.request && context.request.request_number) ||
    (instance.context_json && instance.context_json.request && instance.context_json.request.request_number) ||
    null;

  let externalLink = null;
  if (resolution.assignmentKind === 'external' && resolution.email) {
    try {
      const minted = await createExternalParticipant(client, {
        taskId: task.id,
        instanceId: instance.id,
        relatedRequestId: instance.related_request_id,
        email: resolution.email,
        displayName: (resolution.external && resolution.external.name) || null,
        meta: { node_key: node.key, task_type: taskType },
      });
      externalLink = { actionUrl: minted.actionUrl, expires_at: minted.participant.expires_at };
      resolution.externalActionUrl = minted.actionUrl;
      await client.query(
        `UPDATE cfg_workflow_tasks
         SET assignment_summary = COALESCE(assignment_summary,'') || $2,
             updated_at = now()
         WHERE id = $1`,
        [task.id, ' · Secure link issued']
      );
    } catch (err) {
      if (!(err && err.code === '42P01')) {
        console.warn('[cfg-runtime] external participant mint failed', err.message || err);
      }
    }
  }

  await notifyTaskAssigned({
    client,
    task,
    instance,
    resolution,
    node,
    requestNumber,
  });

  await store.writeAudit(client, {
    actor_email: context && context.currentUser && context.currentUser.email,
    action: 'workflow.task_created',
    definition_kind: 'workflow',
    definition_id: instance.definition_id,
    version_id: instance.version_id,
    after_summary: {
      instance_id: instance.id,
      task_id: task.id,
      mode: resolution.mode,
      role: assignedRole,
      user_id: assignedUserId,
      external_link: !!externalLink,
    },
    meta_json: { related_request_id: instance.related_request_id || null },
  });

  return { task, resolution, blocked: false, externalLink };
}

async function generateDocument(client, instance, node, context) {
  const cfg = node.config || {};
  let body = cfg.body_html || '';
  let title = cfg.title || node.name || 'Generated document';
  if (cfg.document_definition_id) {
    const docDef = await store.getDefinition(cfg.document_definition_id);
    if (docDef && docDef.published_version && docDef.published_version.payload_json) {
      const payload = docDef.published_version.payload_json;
      body = payload.body_html || body;
      if (!body && Array.isArray(payload.blocks) && payload.blocks.length) {
        body = payload.blocks
          .map((b) => {
            if (b.type === 'heading') return `<h2>${b.text || ''}</h2>`;
            if (b.type === 'paragraph') return `<p>${b.text || ''}</p>`;
            if (b.type === 'list') {
              const items = b.items || String(b.text || '').split('\n');
              return `<ul>${items.filter(Boolean).map((i) => `<li>${i}</li>`).join('')}</ul>`;
            }
            if (b.type === 'divider') return '<hr>';
            if (b.type === 'variable') return `<p>{{${b.key || b.text || ''}}}</p>`;
            if (b.type === 'signature') return '<div class="cfg-doc-sig">Signature: ______________________</div>';
            if (b.type === 'initial') return '<div class="cfg-doc-sig">Initials: ______</div>';
            if (b.type === 'acknowledgement') return `<div class="cfg-doc-sig">☐ ${b.text || 'I acknowledge'}</div>`;
            if (b.type === 'conditional') return `<div>${b.text || ''}</div>`;
            return `<p>${b.text || ''}</p>`;
          })
          .join('\n');
      }
      title = payload.title || title;
    }
  }
  const customVariables = await store.getCustomVariableMap().catch(() => ({}));
  const resolved = resolveVariables({
    template: body,
    organization: context.organization,
    request: context.request,
    formSubmission: context.formSubmission,
    workflowInstance: {
      id: instance.id,
      name: context.workflow_name,
      version: context.workflow_version,
      current_step: { name: node.name },
    },
    currentUser: context.currentUser,
    customVariables,
    mode: 'production',
  });
  const { rows } = await client.query(
    `INSERT INTO cfg_generated_documents
      (definition_id, version_id, instance_id, related_request_id, title, body_html, status, pdf_status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'generated','unavailable',$7)
     RETURNING *`,
    [
      cfg.document_definition_id || null,
      null,
      instance.id,
      instance.related_request_id || null,
      title,
      sanitizeHtml(resolved.text),
      context.currentUser && context.currentUser.email,
    ]
  );
  return rows[0];
}

async function executeAutomaticNode(client, instance, node, context) {
  const type = node.type;
  if (type.startsWith('trigger.')) {
    return { ok: true, outputs: { triggered: true } };
  }
  if (type.startsWith('assign.')) {
    return {
      ok: true,
      outputs: {
        assignee_email: (node.config || {}).assignee_email || null,
        assignee_role: (node.config || {}).assignee_role || null,
      },
    };
  }
  if (type === 'logic.condition' || type === 'logic.multi_branch') {
    const condition = (node.config || {}).condition;
    const result = evaluateCondition(condition, {
      formSubmission: context.formSubmission,
      request: context.request,
      workflowInstance: instance,
      currentUser: context.currentUser,
      customVariables: context.customVariables,
      runtimeValues: context.runtimeValues,
    });
    return {
      ok: result.ok,
      outputs: { condition_value: !!result.value },
      outcome_key: result.value ? 'yes' : 'no',
      condition_result: result,
      error: result.ok ? null : result.error,
    };
  }
  if (type.startsWith('logic.')) {
    return { ok: true, outputs: { applied: true } };
  }
  if (type.startsWith('notify.')) {
    return { ok: true, outputs: { notified: true, channel: type } };
  }
  if (type === 'document.generate') {
    const doc = await generateDocument(client, instance, node, context);
    return { ok: true, outputs: { document_id: doc.id }, outcome_key: 'default' };
  }
  if (type.startsWith('document.')) {
    return { ok: true, outputs: { document_action: type } };
  }
  if (type.startsWith('integration.')) {
    // Integrations are optional; record intentional no-op when not configured.
    return {
      ok: true,
      outputs: {
        integration: type,
        status: 'skipped_not_configured',
        message: 'Integration node recorded without invoking secrets; configure Automation/MaintainX/object storage separately.',
      },
      outcome_key: 'success',
    };
  }
  if (isTerminalNodeType(type)) {
    return { ok: true, outputs: { terminal: type }, terminal: type };
  }
  return { ok: true, outputs: { skipped: true } };
}

async function advanceInstance(instanceId, { actorEmail, fromNodeKey, outcomeKey } = {}) {
  store.assertPostgres();
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const instRes = await client.query(`SELECT * FROM cfg_workflow_instances WHERE id = $1 FOR UPDATE`, [instanceId]);
    const instance = instRes.rows[0];
    if (!instance) {
      const err = new Error('Instance not found');
      err.status = 404;
      throw err;
    }
    if (['completed', 'cancelled', 'rejected', 'failed'].includes(instance.state)) {
      await client.query('COMMIT');
      return getInstance(instanceId);
    }
    const ver = await client.query(`SELECT * FROM cfg_versions WHERE id = $1`, [instance.version_id]);
    const payload = (ver.rows[0] && ver.rows[0].payload_json) || {};
    const nodes = payload.nodes || [];
    const connections = payload.connections || [];
    const byKey = Object.fromEntries(nodes.map((n) => [n.key, n]));
    let currentKey = fromNodeKey || instance.current_node_key;
    let current = byKey[currentKey];
    if (!current) {
      await client.query(
        `UPDATE cfg_workflow_instances SET state = 'failed', failure_summary = $2, updated_at = now() WHERE id = $1`,
        [instanceId, 'Current node missing from definition version']
      );
      await client.query('COMMIT');
      return getInstance(instanceId);
    }

    const context = {
      ...(instance.context_json || {}),
      currentUser: { email: actorEmail },
    };
    if (instance.related_request_id && !context.request) {
      try {
        const reqRes = await client.query(
          `SELECT id, request_number, title, status, requester_email, requester_name, priority, request_type, form_payload
           FROM requests WHERE id = $1`,
          [instance.related_request_id]
        );
        if (reqRes.rows[0]) {
          context.request = reqRes.rows[0];
          const creator = await findUserByEmail(client, reqRes.rows[0].requester_email);
          if (creator) {
            context.request.requester_user_id = creator.id;
            context.requester_user_id = creator.id;
          }
          context.requester_email = reqRes.rows[0].requester_email;
          if (reqRes.rows[0].form_payload && typeof reqRes.rows[0].form_payload === 'object') {
            context.formSubmission = context.formSubmission || {
              values: reqRes.rows[0].form_payload.values || reqRes.rows[0].form_payload,
            };
          }
        }
      } catch {
        /* requests table may be unavailable in isolated tests */
      }
    }

    // If resuming with an outcome, move along that edge first
    if (outcomeKey) {
      const edges = outgoing(connections, current.key, outcomeKey);
      const next = edges[0];
      if (!next) {
        await client.query(
          `UPDATE cfg_workflow_instances SET state = 'failed', failure_summary = $2, updated_at = now() WHERE id = $1`,
          [instanceId, `No outgoing path for outcome ${outcomeKey}`]
        );
        await client.query('COMMIT');
        return getInstance(instanceId);
      }
      current = byKey[next.target];
      currentKey = current && current.key;
      await client.query(
        `UPDATE cfg_workflow_instances SET current_node_key = $2, state = 'running', updated_at = now() WHERE id = $1`,
        [instanceId, currentKey]
      );
    }

    let guard = 0;
    while (current && guard < 50) {
      guard += 1;
      const execution = await createNodeExecution(client, instance, current, 1);
      if (isHumanNodeType(current.type)) {
        await createHumanTask(client, instance, execution, current, context);
        await client.query('COMMIT');
        return getInstance(instanceId);
      }

      const result = await executeAutomaticNode(client, instance, current, context);
      if (!result.ok) {
        await failExecution(client, execution.id, result.error || 'Node failed');
        await client.query(
          `UPDATE cfg_workflow_instances SET state = 'failed', failure_summary = $2, current_node_key = $3, updated_at = now() WHERE id = $1`,
          [instanceId, result.error || 'Node failed', current.key]
        );
        await client.query('COMMIT');
        return getInstance(instanceId);
      }
      await completeExecution(client, execution.id, result.outputs);
      if (result.condition_result) {
        await client.query(
          `UPDATE cfg_node_executions SET condition_result_json = $2::jsonb WHERE id = $1`,
          [execution.id, JSON.stringify(result.condition_result)]
        );
      }

      if (result.terminal) {
        const state =
          result.terminal === 'terminal.reject'
            ? 'rejected'
            : result.terminal === 'terminal.cancel'
              ? 'cancelled'
              : result.terminal === 'terminal.fail'
                ? 'failed'
                : 'completed';
        await client.query(
          `UPDATE cfg_workflow_instances
           SET state = $2, completed_at = now(), updated_at = now(), current_node_key = $3
           WHERE id = $1`,
          [instanceId, state, current.key]
        );
        if (state === 'completed') {
          await syncVendorNdaOnComplete(client, instance).catch((err) => {
            console.warn('[cfg-runtime] vendor NDA sync failed', err.message || err);
          });
          const ctxJson = instance.context_json || {};
          const requesterEmail = ctxJson.requester_email || (ctxJson.request && ctxJson.request.requester_email);
          if (requesterEmail) {
            await notifyWorkflowCompleted({
              client,
              instance,
              recipient: { email: requesterEmail, name: ctxJson.request && ctxJson.request.requester_name },
            }).catch(() => {});
          }
        }
        await client.query('COMMIT');
        return getInstance(instanceId);
      }

      const edges = outgoing(connections, current.key, result.outcome_key);
      // Prefer unconditional / default when multiple
      let nextEdge = edges.find((e) => !e.condition) || edges[0];
      for (const e of edges) {
        if (!e.condition) continue;
        const cond = evaluateCondition(e.condition, {
          formSubmission: context.formSubmission,
          request: context.request,
          runtimeValues: { ...(context.runtimeValues || {}), ...(result.outputs || {}) },
        });
        if (cond.ok && cond.value) {
          nextEdge = e;
          break;
        }
      }
      if (!nextEdge) {
        await client.query(
          `UPDATE cfg_workflow_instances SET state = 'failed', failure_summary = $2, updated_at = now() WHERE id = $1`,
          [instanceId, `No outgoing connection from ${current.key}`]
        );
        await client.query('COMMIT');
        return getInstance(instanceId);
      }
      current = byKey[nextEdge.target];
      await client.query(
        `UPDATE cfg_workflow_instances SET current_node_key = $2, updated_at = now() WHERE id = $1`,
        [instanceId, current ? current.key : null]
      );
    }

    await client.query('COMMIT');
    return getInstance(instanceId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function completeTask({ taskId, actorEmail, actorUserId, roleKeys, outcome, comment, formValues }) {
  store.assertPostgres();
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT * FROM cfg_workflow_tasks WHERE id = $1 FOR UPDATE`, [taskId]);
    const task = rows[0];
    if (!task) {
      const err = new Error('Task not found');
      err.status = 404;
      throw err;
    }
    if (!['open', 'claimed', 'in_progress'].includes(task.status)) {
      const err = new Error('Task is not open');
      err.status = 409;
      err.code = 'TASK_NOT_OPEN';
      throw err;
    }

    const actor = actorUserId
      ? (await client.query(`SELECT id, email FROM users WHERE id = $1`, [actorUserId])).rows[0]
      : await findUserByEmail(client, actorEmail);
    const email = (actor && actor.email) || actorEmail || '';
    const roles = Array.isArray(roleKeys) ? roleKeys : [];

    const isAssignee =
      (task.assigned_user_email && email && task.assigned_user_email.toLowerCase() === email.toLowerCase()) ||
      (task.assigned_user_id && actor && String(task.assigned_user_id) === String(actor.id));
    const isClaimer =
      (task.claimed_by_email && email && task.claimed_by_email.toLowerCase() === email.toLowerCase()) ||
      (task.claimed_by_user_id && actor && String(task.claimed_by_user_id) === String(actor.id));
    const isRoleCandidate =
      task.assigned_role &&
      !task.assigned_user_id &&
      roles.includes(task.assigned_role) &&
      (task.status === 'open' || isClaimer);

    if (!isAssignee && !isClaimer && !isRoleCandidate) {
      const err = new Error('Not authorized to complete this task');
      err.status = 403;
      err.code = 'FORBIDDEN_TASK';
      throw err;
    }

    // Shared-role open tasks must be claimed first (atomic)
    if (task.assigned_role && !task.assigned_user_id && task.status === 'open' && !isClaimer) {
      const claim = await client.query(
        `UPDATE cfg_workflow_tasks
         SET claimed_by_user_id = $2,
             claimed_by_email = $3,
             claimed_at = now(),
             status = 'claimed',
             updated_at = now()
         WHERE id = $1
           AND status = 'open'
           AND claimed_by_user_id IS NULL
         RETURNING *`,
        [taskId, actor && actor.id, email]
      );
      if (!claim.rows[0]) {
        const err = new Error('Task was claimed by another user');
        err.status = 409;
        err.code = 'TASK_CLAIMED';
        throw err;
      }
      await dismissRoleCandidateNotifications({
        client,
        taskId,
        exceptUserId: actor && actor.id,
      });
    }

    await client.query(
      `UPDATE cfg_workflow_tasks
       SET status = 'completed', outcome = $2, comment = $3, form_submission_json = $4::jsonb,
           completed_by = $5, completed_at = now(), updated_at = now()
       WHERE id = $1`,
      [taskId, outcome || 'completed', comment || null, JSON.stringify(formValues || {}), email || null]
    );
    await client.query(
      `UPDATE cfg_node_executions SET state = 'completed', completed_at = now(), updated_at = now(), outputs_json = $2::jsonb WHERE id = $1`,
      [task.node_execution_id, JSON.stringify({ outcome: outcome || 'completed' })]
    );
    const exec = await client.query(`SELECT * FROM cfg_node_executions WHERE id = $1`, [task.node_execution_id]);
    const nodeKey = exec.rows[0] && exec.rows[0].node_key;
    await client.query(
      `UPDATE cfg_workflow_instances
       SET context_json = jsonb_set(COALESCE(context_json,'{}'::jsonb), '{formSubmission}', COALESCE(context_json->'formSubmission','{}'::jsonb) || $2::jsonb, true),
           state = 'running',
           updated_at = now()
       WHERE id = $1`,
      [task.instance_id, JSON.stringify({ values: formValues || {} })]
    );
    await store.writeAudit(client, {
      actor_email: email,
      action: 'workflow.task_completed',
      definition_kind: 'workflow',
      after_summary: { task_id: taskId, outcome: outcome || 'completed' },
      meta_json: { instance_id: task.instance_id, related_request_id: task.related_request_id || null },
    });
    await client.query('COMMIT');
    return advanceInstance(task.instance_id, {
      actorEmail: email,
      fromNodeKey: nodeKey,
      outcomeKey: outcome || 'default',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function claimTask({ taskId, actorEmail, actorUserId, roleKeys }) {
  store.assertPostgres();
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT * FROM cfg_workflow_tasks WHERE id = $1 FOR UPDATE`, [taskId]);
    const task = rows[0];
    if (!task) {
      const err = new Error('Task not found');
      err.status = 404;
      throw err;
    }
    if (task.status !== 'open') {
      const err = new Error('Task is not available to claim');
      err.status = 409;
      err.code = 'TASK_NOT_OPEN';
      throw err;
    }
    const actor = actorUserId
      ? (await client.query(`SELECT id, email, name FROM users WHERE id = $1`, [actorUserId])).rows[0]
      : await findUserByEmail(client, actorEmail);
    if (!actor) {
      const err = new Error('Actor user not found');
      err.status = 403;
      throw err;
    }
    const roles = Array.isArray(roleKeys) ? roleKeys : [];
    const allowed =
      (task.assigned_role && roles.includes(task.assigned_role)) ||
      (task.assigned_user_id && String(task.assigned_user_id) === String(actor.id)) ||
      (task.assigned_user_email && task.assigned_user_email.toLowerCase() === actor.email.toLowerCase());
    if (!allowed) {
      const err = new Error('Not authorized to claim this task');
      err.status = 403;
      throw err;
    }
    const claim = await client.query(
      `UPDATE cfg_workflow_tasks
       SET claimed_by_user_id = $2,
           claimed_by_email = $3,
           claimed_at = now(),
           status = 'claimed',
           updated_at = now()
       WHERE id = $1
         AND status = 'open'
         AND claimed_by_user_id IS NULL
       RETURNING *`,
      [taskId, actor.id, actor.email]
    );
    if (!claim.rows[0]) {
      const err = new Error('Task was claimed by another user');
      err.status = 409;
      err.code = 'TASK_CLAIMED';
      throw err;
    }
    await dismissRoleCandidateNotifications({ client, taskId, exceptUserId: actor.id });
    await store.writeAudit(client, {
      actor_email: actor.email,
      action: 'workflow.task_claimed',
      definition_kind: 'workflow',
      after_summary: { task_id: taskId, claimed_by: actor.id },
      meta_json: { instance_id: task.instance_id },
    });
    await client.query('COMMIT');
    return claim.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function listTasksForUser({ email, roleKeys, userId }) {
  store.assertPostgres();
  const p = getPool();
  const roles = Array.isArray(roleKeys) ? roleKeys : [];
  const { rows } = await p.query(
    `SELECT t.*, i.definition_id, i.related_request_id, i.state AS instance_state, i.version_id,
            i.current_node_key,
            r.request_number, r.title AS request_title, r.priority AS request_priority
     FROM cfg_workflow_tasks t
     JOIN cfg_workflow_instances i ON i.id = t.instance_id
     LEFT JOIN requests r ON r.id = COALESCE(t.related_request_id, i.related_request_id)
     WHERE t.status IN ('open', 'claimed', 'in_progress')
       AND (
         ($3::uuid IS NOT NULL AND t.assigned_user_id = $3::uuid)
         OR ($3::uuid IS NOT NULL AND t.claimed_by_user_id = $3::uuid)
         OR LOWER(COALESCE(t.assigned_user_email,'')) = LOWER($1)
         OR LOWER(COALESCE(t.claimed_by_email,'')) = LOWER($1)
         OR (
           t.assigned_role IS NOT NULL
           AND t.assigned_user_id IS NULL
           AND t.status = 'open'
           AND t.assigned_role = ANY($2::text[])
         )
       )
     ORDER BY t.created_at DESC
     LIMIT 200`,
    [email || '', roles, userId || null]
  );
  return rows;
}

/**
 * Create a hub request from a published request type and start its pinned workflow version.
 */
async function startFromRequestType({
  requestTypeDefinitionId,
  actorEmail,
  title,
  description,
  priority,
  formValues,
  relatedSubmissionId,
}) {
  store.assertPostgres();
  const def = await store.getDefinition(requestTypeDefinitionId);
  if (!def || def.kind !== 'request_type' || !def.published_version) {
    const err = new Error('Published request type not found');
    err.status = 404;
    err.code = 'REQUEST_TYPE_NOT_FOUND';
    throw err;
  }
  const payload = def.published_version.payload_json || {};
  const workflowDefinitionId = payload.workflow_definition_id;
  if (!workflowDefinitionId) {
    const err = new Error('Request type has no published workflow attached');
    err.status = 400;
    err.code = 'NO_WORKFLOW';
    throw err;
  }
  const wf = await loadPublishedWorkflow(workflowDefinitionId);
  const hubStore = require('../../hub/store');
  const actor = await (async () => {
    const p = getPool();
    const { rows } = await p.query(`SELECT id, email, name FROM users WHERE lower(email) = lower($1) LIMIT 1`, [
      actorEmail || '',
    ]);
    return rows[0] || null;
  })();

  const prefix = payload.number_prefix || 'REQ-';
  const displayName = payload.display_name || def.name;
  const requestTypeKey = payload.key || def.key || 'general_request';

  const rec = await hubStore.createRequest(
    {
      request_type: 'general_request',
      title: title || displayName,
      description: description || payload.description || '',
      priority: priority || payload.default_priority || 'normal',
      requester_email: actorEmail,
      requester_name: (actor && actor.name) || actorEmail,
      form_payload: {
        values: formValues || {},
        request_type_definition_id: def.id,
        request_type_version_id: def.published_version.id,
        request_type_key: requestTypeKey,
        workflow_definition_id: wf.id,
        workflow_version_id: wf.published_version.id,
        starting_form_template_id: payload.starting_form_template_id || null,
        number_prefix: prefix,
      },
    },
    actorEmail
  );

  // Prefer human-readable prefix from request type when possible
  if (prefix && rec.request_number && !String(rec.request_number).startsWith(String(prefix).replace(/-$/, ''))) {
    try {
      const p = getPool();
      const cleanPrefix = String(prefix).replace(/-?$/, '');
      const seqKey = `cfg_${requestTypeKey}`;
      await p.query(
        `INSERT INTO request_sequences (request_type, seq) VALUES ($1, 0) ON CONFLICT (request_type) DO NOTHING`,
        [seqKey]
      );
      const seq = await p.query(`UPDATE request_sequences SET seq = seq + 1 WHERE request_type=$1 RETURNING seq`, [seqKey]);
      const n = seq.rows[0]?.seq || 1;
      const requestNumber = `${cleanPrefix}-${String(n).padStart(4, '0')}`;
      await p.query(`UPDATE requests SET request_number = $2, updated_at = now() WHERE id = $1`, [rec.id, requestNumber]);
      rec.request_number = requestNumber;
    } catch {
      /* keep default number */
    }
  }

  const instance = await startWorkflowInstance({
    workflowDefinitionId: wf.id,
    actorEmail,
    relatedRequestId: rec.id,
    relatedSubmissionId: relatedSubmissionId || null,
    context: {
      request_type_id: def.id,
      request_type_key: requestTypeKey,
      request_type_version_id: def.published_version.id,
      workflow_version_id: wf.published_version.id,
      form_template_id: payload.starting_form_template_id || null,
      requester_email: actorEmail,
      requester_user_id: actor && actor.id,
      request: {
        id: rec.id,
        request_number: rec.request_number,
        title: rec.title,
        requester_email: rec.requester_email,
        requester_user_id: actor && actor.id,
        priority: rec.priority,
      },
      formSubmission: { values: formValues || {} },
      currentUser: { email: actorEmail, id: actor && actor.id, name: actor && actor.name },
    },
  });

  // Pin request-type / form version ids on instance when columns exist
  try {
    const p = getPool();
    await p.query(
      `UPDATE cfg_workflow_instances
       SET request_type_definition_id = $2,
           request_type_version_id = $3,
           form_template_id = $4,
           started_by_user_id = $5,
           updated_at = now()
       WHERE id = $1`,
      [
        instance.id,
        def.id,
        def.published_version.id,
        payload.starting_form_template_id || null,
        actor && actor.id,
      ]
    );
  } catch {
    /* pre-migration */
  }

  return { request: rec, instance: await getInstance(instance.id) };
}

async function retryFailedNode({ instanceId, actorEmail }) {
  const instance = await getInstance(instanceId);
  if (!instance) {
    const err = new Error('Instance not found');
    err.status = 404;
    throw err;
  }
  if (instance.state !== 'failed') {
    const err = new Error('Instance is not failed');
    err.status = 409;
    err.code = 'NOT_FAILED';
    throw err;
  }
  const p = getPool();
  await p.query(
    `UPDATE cfg_workflow_instances SET state = 'running', failure_summary = NULL, updated_at = now() WHERE id = $1`,
    [instanceId]
  );
  return advanceInstance(instanceId, { actorEmail });
}

async function syncVendorNdaOnComplete(client, instance) {
  const ctx = instance.context_json || {};
  const values = (ctx.formSubmission && ctx.formSubmission.values) || {};
  const vendorRef = values.vendor_ref || values.vendor_reference || values.vendor_id || null;
  if (!vendorRef) return null;
  try {
    const { readVendorRecord, writeVendorRecord } = require('../../vendor/db/postgres');
    const { updateDocumentStatus } = require('../../vendor/documents');
    const found = await readVendorRecord(String(vendorRef).trim());
    if (!found || !found.record) return null;
    const actor = { email: 'system@workflow', name: 'Workflow runtime' };
    const result = updateDocumentStatus(found.record, 'nda', 'approved', actor, {
      note: `NDA signed via configurable workflow instance ${instance.id}`,
    });
    if (!result.ok) return null;
    await writeVendorRecord(String(vendorRef).trim(), result.record);
    await store.writeAudit(client, {
      actor_email: 'system@workflow',
      action: 'workflow.vendor_nda_synced',
      definition_kind: 'workflow',
      after_summary: { vendor_ref: vendorRef, instance_id: instance.id, nda_status: 'approved' },
      meta_json: { related_request_id: instance.related_request_id || null },
    });
    return { vendor_ref: vendorRef, nda_status: 'approved' };
  } catch (err) {
    console.warn('[cfg-runtime] syncVendorNdaOnComplete', err.message || err);
    return null;
  }
}

async function completeExternalTask({ token, outcome, signature, comment, acknowledged }) {
  store.assertPostgres();
  const p = getPool();
  const client = await p.connect();
  let row;
  try {
    row = await getExternalParticipantByToken(client, token);
    if (!row) {
      const err = new Error('Invalid or unknown action link');
      err.status = 404;
      err.code = 'INVALID_TOKEN';
      throw err;
    }
    if (row.completed_at) {
      const err = new Error('This action link was already used');
      err.status = 409;
      err.code = 'ALREADY_COMPLETED';
      throw err;
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      const err = new Error('This action link has expired');
      err.status = 410;
      err.code = 'EXPIRED_TOKEN';
      throw err;
    }
    if (!['open', 'claimed', 'in_progress'].includes(row.task_status)) {
      const err = new Error('Task is no longer open');
      err.status = 409;
      err.code = 'TASK_NOT_OPEN';
      throw err;
    }
  } finally {
    client.release();
  }

  const instance = await completeTask({
    taskId: row.task_id,
    actorEmail: row.email,
    outcome: outcome || 'signed',
    comment: comment || null,
    formValues: {
      external_signature: signature || null,
      external_acknowledged: !!acknowledged,
    },
  });

  const mark = await p.connect();
  try {
    await mark.query(
      `UPDATE cfg_external_participants
       SET completed_at = now(), updated_at = now(),
           meta_json = COALESCE(meta_json,'{}'::jsonb) || $2::jsonb
       WHERE id = $1 AND completed_at IS NULL`,
      [
        row.id,
        JSON.stringify({
          completed_outcome: outcome || 'signed',
          signature: signature ? { present: true, length: String(signature).length } : null,
          comment: comment || null,
          acknowledged: !!acknowledged,
        }),
      ]
    );
  } finally {
    mark.release();
  }
  return instance;
}

async function getExternalActionPayload(token) {
  store.assertPostgres();
  const p = getPool();
  const client = await p.connect();
  try {
    const row = await getExternalParticipantByToken(client, token);
    if (!row) {
      const err = new Error('Invalid or unknown action link');
      err.status = 404;
      err.code = 'INVALID_TOKEN';
      throw err;
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      const err = new Error('This action link has expired');
      err.status = 410;
      err.code = 'EXPIRED_TOKEN';
      throw err;
    }
    const docs = await listGeneratedDocsForInstance(client, row.instance_id);
    return {
      email: row.email,
      display_name: row.display_name,
      task_title: row.task_title,
      task_type: row.task_type,
      instructions: row.instructions,
      expires_at: row.expires_at,
      completed: !!row.completed_at,
      related_request_id: row.related_request_id || row.task_request_id,
      documents: docs.map((d) => ({
        id: d.id,
        title: d.title,
        body_html: d.body_html,
        status: d.status,
      })),
    };
  } finally {
    client.release();
  }
}

async function getInstanceByRequestId(requestId) {
  store.assertPostgres();
  if (!requestId) return null;
  const p = getPool();
  const { rows } = await p.query(
    `SELECT id FROM cfg_workflow_instances WHERE related_request_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [requestId]
  );
  if (!rows[0]) return null;
  return getInstance(rows[0].id);
}

module.exports = {
  idempotencyKey,
  startWorkflowInstance,
  startFromRequestType,
  advanceInstance,
  completeTask,
  claimTask,
  retryFailedNode,
  getInstance,
  getInstanceByRequestId,
  listTasksForUser,
  completeExternalTask,
  getExternalActionPayload,
  syncVendorNdaOnComplete,
};
