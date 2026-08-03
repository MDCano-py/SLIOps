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

async function createHumanTask(client, instance, execution, node) {
  const meta = getNodeType(node.type);
  const taskType = (meta && meta.taskType) || 'Provide Information';
  const cfg = node.config || {};
  const { rows } = await client.query(
    `INSERT INTO cfg_workflow_tasks
      (instance_id, node_execution_id, task_type, status, assigned_user_email, assigned_role, due_at)
     VALUES ($1,$2,$3,'open',$4,$5,$6)
     RETURNING *`,
    [
      instance.id,
      execution.id,
      taskType,
      cfg.assignee_email || null,
      cfg.assignee_role || cfg.required_role || null,
      cfg.due_at || null,
    ]
  );
  await client.query(
    `UPDATE cfg_node_executions
     SET state = 'waiting', assignee_email = $2, assignee_role = $3, updated_at = now()
     WHERE id = $1`,
    [execution.id, cfg.assignee_email || null, cfg.assignee_role || cfg.required_role || null]
  );
  await client.query(
    `UPDATE cfg_workflow_instances SET state = 'waiting', current_node_key = $2, updated_at = now() WHERE id = $1`,
    [instance.id, node.key]
  );
  return rows[0];
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
    return { ok: true, outputs: { document_id: doc.id }, outcome_key: 'success' };
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
        await createHumanTask(client, instance, execution, current);
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

async function completeTask({ taskId, actorEmail, outcome, comment, formValues }) {
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
      const err = new Error('Task is not open');
      err.status = 409;
      err.code = 'TASK_NOT_OPEN';
      throw err;
    }
    await client.query(
      `UPDATE cfg_workflow_tasks
       SET status = 'completed', outcome = $2, comment = $3, form_submission_json = $4::jsonb,
           completed_by = $5, completed_at = now(), updated_at = now()
       WHERE id = $1`,
      [taskId, outcome || 'completed', comment || null, JSON.stringify(formValues || {}), actorEmail || null]
    );
    await client.query(
      `UPDATE cfg_node_executions SET state = 'completed', completed_at = now(), updated_at = now(), outputs_json = $2::jsonb WHERE id = $1`,
      [task.node_execution_id, JSON.stringify({ outcome: outcome || 'completed' })]
    );
    const exec = await client.query(`SELECT * FROM cfg_node_executions WHERE id = $1`, [task.node_execution_id]);
    const nodeKey = exec.rows[0] && exec.rows[0].node_key;
    // Merge form values into instance context
    await client.query(
      `UPDATE cfg_workflow_instances
       SET context_json = jsonb_set(COALESCE(context_json,'{}'::jsonb), '{formSubmission}', COALESCE(context_json->'formSubmission','{}'::jsonb) || $2::jsonb, true),
           state = 'running',
           updated_at = now()
       WHERE id = $1`,
      [task.instance_id, JSON.stringify({ values: formValues || {} })]
    );
    await client.query('COMMIT');
    return advanceInstance(task.instance_id, {
      actorEmail,
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

async function listTasksForUser({ email, roleKeys }) {
  store.assertPostgres();
  const p = getPool();
  const roles = Array.isArray(roleKeys) ? roleKeys : [];
  const { rows } = await p.query(
    `SELECT t.*, i.definition_id, i.related_request_id, i.state AS instance_state
     FROM cfg_workflow_tasks t
     JOIN cfg_workflow_instances i ON i.id = t.instance_id
     WHERE t.status = 'open'
       AND (
         LOWER(COALESCE(t.assigned_user_email,'')) = LOWER($1)
         OR (t.assigned_role IS NOT NULL AND t.assigned_role = ANY($2::text[]))
         OR (t.assigned_user_email IS NULL AND t.assigned_role IS NULL)
       )
     ORDER BY t.created_at DESC
     LIMIT 200`,
    [email || '', roles]
  );
  return rows;
}

module.exports = {
  idempotencyKey,
  startWorkflowInstance,
  advanceInstance,
  completeTask,
  retryFailedNode,
  getInstance,
  listTasksForUser,
};
