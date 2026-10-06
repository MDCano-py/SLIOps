/**
 * WOS-96 — Resolve human-node assignments against real WOS users / RBAC roles.
 */
'use strict';

const FALLBACK = {
  pause: 'pause_with_assignment_error',
  hub_admin: 'route_to_hub_admin',
  fallback_role: 'route_to_fallback_role',
  request_creator: 'assign_to_request_creator',
};

function normalizeMode(raw) {
  const m = String(raw || '').trim();
  if (m === 'role') return 'role_shared_queue';
  if (m === 'form_user_field') return 'user_from_form_field';
  return m || 'role_shared_queue';
}

function normalizeFallback(raw) {
  const f = String(raw || 'hub_admin').trim();
  if (f === 'pause') return FALLBACK.pause;
  if (f === 'hub_admin') return FALLBACK.hub_admin;
  if (f === 'fallback_role') return FALLBACK.fallback_role;
  if (f === 'request_creator') return FALLBACK.request_creator;
  return f;
}

async function findUserById(client, userId) {
  if (!userId) return null;
  try {
    const { rows } = await client.query(
      `SELECT id, email, name, role,
              COALESCE(status, 'active') AS status
       FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );
    return rows[0] || null;
  } catch (err) {
    if (err && err.code === '42703') {
      const { rows } = await client.query(`SELECT id, email, name, role FROM users WHERE id = $1 LIMIT 1`, [userId]);
      return rows[0] ? { ...rows[0], status: 'active' } : null;
    }
    throw err;
  }
}

async function findUserByEmail(client, email) {
  if (!email) return null;
  try {
    const { rows } = await client.query(
      `SELECT id, email, name, role,
              COALESCE(status, 'active') AS status
       FROM users WHERE lower(email) = lower($1) LIMIT 1`,
      [String(email).trim()]
    );
    return rows[0] || null;
  } catch (err) {
    if (err && err.code === '42703') {
      const { rows } = await client.query(
        `SELECT id, email, name, role FROM users WHERE lower(email) = lower($1) LIMIT 1`,
        [String(email).trim()]
      );
      return rows[0] ? { ...rows[0], status: 'active' } : null;
    }
    throw err;
  }
}

function isActiveUser(user) {
  if (!user) return false;
  const status = String(user.status || 'active').toLowerCase();
  return status === 'active' || status === '';
}

async function usersWithRole(client, roleKey) {
  if (!roleKey) return [];
  try {
    const { rows } = await client.query(
      `SELECT u.id, u.email, u.name, u.role, COALESCE(u.status, 'active') AS status
       FROM users u
       JOIN user_roles ur ON lower(ur.user_email) = lower(u.email)
       WHERE ur.role_key = $1
         AND COALESCE(lower(u.status), 'active') = 'active'
       ORDER BY u.name ASC NULLS LAST, u.email ASC`,
      [roleKey]
    );
    return rows;
  } catch (err) {
    if (err && err.code === '42703') {
      const { rows } = await client.query(
        `SELECT u.id, u.email, u.name, u.role
         FROM users u
         JOIN user_roles ur ON lower(ur.user_email) = lower(u.email)
         WHERE ur.role_key = $1
         ORDER BY u.email ASC`,
        [roleKey]
      );
      return rows.map((r) => ({ ...r, status: 'active' }));
    }
    throw err;
  }
}

async function hubAdminUsers(client) {
  const byRole = await usersWithRole(client, 'hub_admin');
  if (byRole.length) return byRole;
  const admins = await usersWithRole(client, 'admin');
  if (admins.length) return admins;
  const { rows } = await client.query(
    `SELECT id, email, name, role, status, is_staging_test_user
     FROM users
     WHERE COALESCE(lower(status), 'active') = 'active'
       AND (
         lower(COALESCE(role,'')) IN ('hub_admin','admin')
         OR permissions @> '["hub_admin"]'::jsonb
         OR permissions @> '["admin"]'::jsonb
       )
     ORDER BY email ASC
     LIMIT 20`
  );
  return rows;
}

/**
 * @returns {Promise<{
 *   ok: boolean,
 *   mode: string,
 *   assignmentKind: 'specific_user'|'shared_role'|'external'|'unresolved',
 *   user?: object,
 *   users?: object[],
 *   roleKey?: string|null,
 *   email?: string|null,
 *   userId?: string|null,
 *   fallbackApplied?: string|null,
 *   error?: string|null,
 *   external?: { name?: string, email?: string }|null
 * }>}
 */
async function resolveAssignment({ client, node, context }) {
  const cfg = (node && node.config) || {};
  const asg = cfg.assignment || {};
  const mode = normalizeMode(asg.mode || (cfg.assignee_email ? 'specific_user' : 'role_shared_queue'));
  const fallback = normalizeFallback(asg.fallback || 'hub_admin');
  const formValues = (context && context.formSubmission && context.formSubmission.values) ||
    (context && context.formSubmission) ||
    {};
  const request = (context && context.request) || {};
  const creatorEmail = request.requester_email || (context && context.requester_email) || null;
  const creatorUserId = request.requester_user_id || (context && context.requester_user_id) || null;

  async function applyFallback(reason) {
    if (fallback === FALLBACK.pause) {
      return {
        ok: false,
        mode,
        assignmentKind: 'unresolved',
        fallbackApplied: fallback,
        error: reason,
      };
    }
    if (fallback === FALLBACK.request_creator) {
      const user = (await findUserById(client, creatorUserId)) || (await findUserByEmail(client, creatorEmail));
      if (user && isActiveUser(user)) {
        return {
          ok: true,
          mode,
          assignmentKind: 'specific_user',
          user,
          userId: user.id,
          email: user.email,
          fallbackApplied: fallback,
          error: reason,
        };
      }
      return {
        ok: false,
        mode,
        assignmentKind: 'unresolved',
        fallbackApplied: fallback,
        error: reason + ' (request creator unavailable)',
      };
    }
    if (fallback === FALLBACK.fallback_role) {
      const roleKey = asg.fallback_role_key || asg.role_key || 'hub_admin';
      const users = await usersWithRole(client, roleKey);
      if (users.length) {
        return {
          ok: true,
          mode,
          assignmentKind: 'shared_role',
          users,
          roleKey,
          fallbackApplied: fallback,
          error: reason,
        };
      }
    }
    // default / route_to_hub_admin
    const admins = await hubAdminUsers(client);
    if (admins.length) {
      return {
        ok: true,
        mode,
        assignmentKind: 'shared_role',
        users: admins,
        roleKey: 'hub_admin',
        fallbackApplied: FALLBACK.hub_admin,
        error: reason,
      };
    }
    return {
      ok: false,
      mode,
      assignmentKind: 'unresolved',
      fallbackApplied: FALLBACK.hub_admin,
      error: reason + ' (no Hub Admin users available)',
    };
  }

  if (mode === 'specific_user') {
    const user =
      (await findUserById(client, asg.user_id || cfg.assignee_user_id)) ||
      (await findUserByEmail(client, asg.user_email || cfg.assignee_email));
    if (user && isActiveUser(user)) {
      return {
        ok: true,
        mode,
        assignmentKind: 'specific_user',
        user,
        userId: user.id,
        email: user.email,
        fallbackApplied: null,
      };
    }
    return applyFallback('Specific user is missing or inactive');
  }

  if (mode === 'request_creator') {
    const user = (await findUserById(client, creatorUserId)) || (await findUserByEmail(client, creatorEmail));
    if (user && isActiveUser(user)) {
      return {
        ok: true,
        mode,
        assignmentKind: 'specific_user',
        user,
        userId: user.id,
        email: user.email,
        fallbackApplied: null,
      };
    }
    return applyFallback('Request creator could not be resolved');
  }

  if (mode === 'role_shared_queue') {
    const roleKey = asg.role_key || cfg.assignee_role || cfg.required_role || null;
    if (!roleKey || roleKey === 'requester') {
      // Requester is not an RBAC role for assignment — treat as request creator
      if (roleKey === 'requester') {
        return resolveAssignment({
          client,
          node: { ...node, config: { ...cfg, assignment: { ...asg, mode: 'request_creator' } } },
          context,
        });
      }
      return applyFallback('Role assignment is missing a role key');
    }
    const users = await usersWithRole(client, roleKey);
    if (!users.length) {
      return applyFallback(`No active users currently have the ${roleKey} role`);
    }
    return {
      ok: true,
      mode,
      assignmentKind: 'shared_role',
      users,
      roleKey,
      fallbackApplied: null,
    };
  }

  if (mode === 'user_from_form_field') {
    const fieldKey = asg.form_field_key || cfg.form_field_key;
    const raw = fieldKey ? formValues[fieldKey] : null;
    if (!raw) {
      return applyFallback(`Form field ${fieldKey || '(missing)'} has no value yet`);
    }
    let user = null;
    if (typeof raw === 'object' && raw.user_id) user = await findUserById(client, raw.user_id);
    if (!user && typeof raw === 'string' && raw.includes('@')) user = await findUserByEmail(client, raw);
    if (!user && typeof raw === 'string') user = await findUserById(client, raw);
    if (user && isActiveUser(user)) {
      return {
        ok: true,
        mode,
        assignmentKind: 'specific_user',
        user,
        userId: user.id,
        email: user.email,
        fallbackApplied: null,
      };
    }
    return applyFallback(`Form field ${fieldKey} did not resolve to an active user`);
  }

  if (mode === 'external_participant') {
    const emailField = asg.form_field_key || asg.email_field_key || 'contact_email';
    const nameField = asg.name_field_key || 'contact_name';
    const email = formValues[emailField] || asg.external_email || null;
    const name = formValues[nameField] || asg.external_name || null;
    if (!email) {
      return applyFallback('External participant email is not available yet');
    }
    return {
      ok: true,
      mode,
      assignmentKind: 'external',
      email: String(email).toLowerCase(),
      external: { name, email: String(email).toLowerCase() },
      fallbackApplied: null,
    };
  }

  if (mode === 'request_creator_manager' || mode === 'previous_participant' || mode === 'client_representative') {
    // Runtime context may provide these; otherwise fallback.
    const hintEmail =
      (context && context[mode] && context[mode].email) ||
      (mode === 'client_representative' && request.client_email) ||
      null;
    if (hintEmail) {
      const user = await findUserByEmail(client, hintEmail);
      if (user && isActiveUser(user)) {
        return {
          ok: true,
          mode,
          assignmentKind: 'specific_user',
          user,
          userId: user.id,
          email: user.email,
          fallbackApplied: null,
        };
      }
    }
    return applyFallback(`${mode} could not be resolved from request context`);
  }

  return applyFallback(`Unsupported assignment mode: ${mode}`);
}

module.exports = {
  resolveAssignment,
  normalizeMode,
  normalizeFallback,
  findUserByEmail,
  findUserById,
  usersWithRole,
  hubAdminUsers,
  isActiveUser,
  FALLBACK,
};
