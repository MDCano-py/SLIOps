/**
 * WOS-96 — Persist in-app notifications for configurable workflow tasks.
 */
'use strict';

const crypto = require('crypto');

async function insertNotification(client, input) {
  const id = input.id || crypto.randomUUID();
  const dedupe = input.dedupe_key || null;
  try {
    await client.query(
      `INSERT INTO notifications
        (id, recipient_email, recipient_name, type, title, message, request_id, document_id, workflow_step_id,
         read_at, created_at, recipient_user_id, cfg_workflow_task_id, cfg_workflow_instance_id,
         action_url, priority, dedupe_key)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,
         NULL,now(),$10,$11,$12,
         $13,$14,$15)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        id,
        (input.recipient_email || '').toLowerCase(),
        input.recipient_name || null,
        input.type,
        input.title,
        input.message,
        input.request_id || null,
        input.document_id || null,
        null,
        input.recipient_user_id || null,
        input.cfg_workflow_task_id || null,
        input.cfg_workflow_instance_id || null,
        input.action_url || null,
        input.priority || 'normal',
        dedupe,
      ]
    );
  } catch (err) {
    // Pre-migration or missing unique constraint — fall back to legacy insert without dedupe uniqueness
    if (err && (err.code === '42703' || err.code === '42P10' || /dedupe_key|recipient_user_id|cfg_workflow/.test(String(err.message)))) {
      await client.query(
        `INSERT INTO notifications
          (id, recipient_email, recipient_name, type, title, message, request_id, document_id, workflow_step_id, read_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,now())
         ON CONFLICT (id) DO NOTHING`,
        [
          id,
          (input.recipient_email || '').toLowerCase(),
          input.recipient_name || null,
          input.type,
          input.title,
          input.message,
          input.request_id || null,
          null,
          null,
        ]
      );
      return { id, legacy: true };
    }
    throw err;
  }
  return { id };
}

async function notifyTaskAssigned({ client, task, instance, resolution, node, requestNumber }) {
  if (!task || !resolution || !resolution.ok) return [];
  const title = node && node.name ? `${node.name}` : task.task_type || 'Task assigned';
  const reqLabel = requestNumber || instance.related_request_id || 'Request';
  const actionUrl = instance.related_request_id
    ? `#/hub/requests/${instance.related_request_id}`
    : `#/hub/my-tasks`;
  const created = [];

  if (resolution.assignmentKind === 'specific_user' && resolution.user) {
    const u = resolution.user;
    const dedupe = `task_assigned:${task.id}:${u.id}`;
    await insertNotification(client, {
      recipient_email: u.email,
      recipient_name: u.name || u.email,
      recipient_user_id: u.id,
      type: 'task_assigned',
      title: 'Review required',
      message: `${reqLabel}: ${title} has been assigned to you.`,
      request_id: instance.related_request_id || null,
      cfg_workflow_task_id: task.id,
      cfg_workflow_instance_id: instance.id,
      action_url: actionUrl,
      dedupe_key: dedupe,
      priority: 'high',
    });
    created.push({ user_id: u.id, email: u.email, type: 'task_assigned' });
    return created;
  }

  if (resolution.assignmentKind === 'shared_role' && Array.isArray(resolution.users)) {
    for (const u of resolution.users) {
      const dedupe = `role_task_available:${task.id}:${u.id}`;
      await insertNotification(client, {
        recipient_email: u.email,
        recipient_name: u.name || u.email,
        recipient_user_id: u.id,
        type: 'task_available_for_role',
        title: `Task available to ${resolution.roleKey || 'your role'}`,
        message: `${reqLabel} requires ${title}. Review and claim the task.`,
        request_id: instance.related_request_id || null,
        cfg_workflow_task_id: task.id,
        cfg_workflow_instance_id: instance.id,
        action_url: actionUrl,
        dedupe_key: dedupe,
        priority: 'high',
      });
      created.push({ user_id: u.id, email: u.email, type: 'task_available_for_role' });
    }
  }

  if (resolution.assignmentKind === 'external' && resolution.email) {
    // External participants use secure links; still record an admin-facing note via hub_admin if needed.
    // In-app bell is for internal users only.
  }

  return created;
}

async function notifyAssignmentFailed({ client, instance, node, error, adminUsers }) {
  const users = Array.isArray(adminUsers) ? adminUsers : [];
  const created = [];
  for (const u of users) {
    const dedupe = `assignment_failed:${instance.id}:${node.key}:${u.id}`;
    await insertNotification(client, {
      recipient_email: u.email,
      recipient_name: u.name || u.email,
      recipient_user_id: u.id,
      type: 'assignment_failed',
      title: 'Assignment failed',
      message: `${node.name || node.key}: ${error}`,
      request_id: instance.related_request_id || null,
      cfg_workflow_instance_id: instance.id,
      action_url: instance.related_request_id ? `#/hub/requests/${instance.related_request_id}` : '#/hub/my-tasks',
      dedupe_key: dedupe,
      priority: 'high',
    });
    created.push(u.email);
  }
  return created;
}

async function dismissRoleCandidateNotifications({ client, taskId, exceptUserId }) {
  try {
    await client.query(
      `UPDATE notifications
       SET dismissed_at = now(), read_at = COALESCE(read_at, now())
       WHERE cfg_workflow_task_id = $1
         AND type = 'task_available_for_role'
         AND dismissed_at IS NULL
         AND ($2::uuid IS NULL OR recipient_user_id IS DISTINCT FROM $2::uuid)`,
      [taskId, exceptUserId || null]
    );
  } catch (err) {
    if (err && err.code === '42703') return;
    throw err;
  }
}

async function notifyWorkflowCompleted({ client, instance, recipient }) {
  if (!recipient || !recipient.email) return;
  await insertNotification(client, {
    recipient_email: recipient.email,
    recipient_name: recipient.name || recipient.email,
    recipient_user_id: recipient.id || null,
    type: 'request_completed',
    title: 'Request completed',
    message: 'Your request workflow has completed.',
    request_id: instance.related_request_id || null,
    cfg_workflow_instance_id: instance.id,
    action_url: instance.related_request_id ? `#/hub/requests/${instance.related_request_id}` : '#/hub',
    dedupe_key: `request_completed:${instance.id}:${recipient.email}`,
  });
}

module.exports = {
  insertNotification,
  notifyTaskAssigned,
  notifyAssignmentFailed,
  dismissRoleCandidateNotifications,
  notifyWorkflowCompleted,
};
