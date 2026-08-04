#!/usr/bin/env node
/**
 * WOS-96 — production workflow runtime, assignments, notifications, registry alignment
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
let passed = 0;
let failed = 0;

function assert(name, cond, detail) {
  if (cond) {
    console.log('PASS ', name);
    passed += 1;
  } else {
    console.log('FAIL ', name, detail || '');
    failed += 1;
  }
}

console.log('\n=== WOS-96 Production Workflow Runtime & Notifications Test ===\n');

const cfgUi = fs.readFileSync(path.join(root, 'hub-configuration-center.js'), 'utf8');
assert('forms registry uses Published/Draft/Archived labels', /statusLabel[\s\S]*Published[\s\S]*Draft/.test(cfgUi));
assert('forms registry uses compact status badge class', /cfg-status-badge|cfg-forms-registry-row/.test(cfgUi));
assert('forms registry does not show raw Active as status text', !/text: t\.status \|\| draftHint/.test(cfgUi));

const hubCss = fs.readFileSync(path.join(root, 'hub.css'), 'utf8');
assert('forms registry grid columns defined', /cfg-forms-registry-row/.test(hubCss) && /fit-content/.test(hubCss));

const migration = fs.readFileSync(path.join(root, 'migrations/014_workflow_runtime_notifications.sql'), 'utf8');
assert('migration adds assigned_user_id', /assigned_user_id/.test(migration));
assert('migration adds claim columns', /claimed_by_user_id/.test(migration));
assert('migration adds notification dedupe_key', /dedupe_key/.test(migration));
assert('migration adds cfg_external_participants', /cfg_external_participants/.test(migration));

const resolve = require('../../api/lib/configuration/runtime/resolve-assignment');
assert('normalizeMode maps role → role_shared_queue', resolve.normalizeMode('role') === 'role_shared_queue');
assert('normalizeMode maps form_user_field', resolve.normalizeMode('form_user_field') === 'user_from_form_field');
assert('normalizeFallback hub_admin', resolve.normalizeFallback('hub_admin') === 'route_to_hub_admin');
assert('normalizeFallback pause', resolve.normalizeFallback('pause') === 'pause_with_assignment_error');

{
  // Mock client for specific_user + role + fallback
  const users = [
    { id: 'u-ops', email: 'ops@example.com', name: 'Ops User', role: 'operations', status: 'active' },
    { id: 'u-ap', email: 'ap@example.com', name: 'AP User', role: 'ap', status: 'active' },
    { id: 'u-admin', email: 'admin@example.com', name: 'Hub Admin', role: 'hub_admin', status: 'active' },
    { id: 'u-inactive', email: 'gone@example.com', name: 'Gone', role: 'operations', status: 'inactive' },
  ];
  const roleMap = {
    operations: ['u-ops'],
    ap: ['u-ap'],
    hub_admin: ['u-admin'],
    admin: ['u-admin'],
  };
  const client = {
    async query(sql, params) {
      if (/FROM users WHERE id/.test(sql)) {
        return { rows: users.filter((u) => u.id === params[0]) };
      }
      if (/FROM users WHERE lower\(email\)/.test(sql)) {
        return { rows: users.filter((u) => u.email.toLowerCase() === String(params[0]).toLowerCase()) };
      }
      if (/JOIN user_roles/.test(sql)) {
        const ids = roleMap[params[0]] || [];
        return { rows: users.filter((u) => ids.includes(u.id) && u.status === 'active') };
      }
      if (/permissions @>/.test(sql)) {
        return { rows: users.filter((u) => u.id === 'u-admin') };
      }
      return { rows: [] };
    },
  };

  (async () => {
    const specific = await resolve.resolveAssignment({
      client,
      node: { config: { assignment: { mode: 'specific_user', user_id: 'u-ops', fallback: 'hub_admin' } } },
      context: {},
    });
    assert('specific_user resolves active user', specific.ok && specific.userId === 'u-ops');

    const inactive = await resolve.resolveAssignment({
      client,
      node: { config: { assignment: { mode: 'specific_user', user_id: 'u-inactive', fallback: 'hub_admin' } } },
      context: {},
    });
    assert('inactive specific_user falls back to hub_admin', inactive.ok && inactive.roleKey === 'hub_admin');

    const role = await resolve.resolveAssignment({
      client,
      node: { config: { assignment: { mode: 'role', role_key: 'operations', fallback: 'hub_admin' } } },
      context: {},
    });
    assert('role_shared_queue lists eligible users', role.ok && role.assignmentKind === 'shared_role' && role.users.length === 1);

    const emptyRole = await resolve.resolveAssignment({
      client,
      node: { config: { assignment: { mode: 'role', role_key: 'legal', fallback: 'hub_admin' } } },
      context: {},
    });
    assert('empty role falls back to hub_admin', emptyRole.ok && emptyRole.fallbackApplied === 'route_to_hub_admin');

    const creator = await resolve.resolveAssignment({
      client,
      node: { config: { assignment: { mode: 'request_creator', fallback: 'hub_admin' } } },
      context: { request: { requester_email: 'ops@example.com' } },
    });
    assert('request_creator resolves by email', creator.ok && creator.email === 'ops@example.com');

    const pause = await resolve.resolveAssignment({
      client,
      node: { config: { assignment: { mode: 'role', role_key: 'legal', fallback: 'pause' } } },
      context: {},
    });
    assert('pause fallback does not invent assignee', !pause.ok && pause.fallbackApplied === 'pause_with_assignment_error');

    const engineSrc = fs.readFileSync(path.join(root, 'api/lib/configuration/runtime/engine.js'), 'utf8');
    assert('engine uses resolveAssignment', /resolveAssignment/.test(engineSrc));
    assert('engine creates task notifications', /notifyTaskAssigned/.test(engineSrc));
    assert('engine claimTask exported', /claimTask/.test(engineSrc) && /module\.exports[\s\S]*claimTask/.test(engineSrc));
    assert('engine startFromRequestType creates request', /startFromRequestType/.test(engineSrc) && /createRequest/.test(engineSrc));
    assert('claim uses conditional update', /claimed_by_user_id IS NULL/.test(engineSrc));
    assert('completeTask authorizes assignee/claimer/role', /FORBIDDEN_TASK|Not authorized to complete/.test(engineSrc));
    assert('listTasksForUser does not expose unassigned-to-everyone', !/assigned_user_email IS NULL AND t\.assigned_role IS NULL/.test(engineSrc));

    const routes = fs.readFileSync(path.join(root, 'api/lib/configuration/routes.js'), 'utf8');
    assert('start-request-type route exists', /start-request-type/.test(routes));
    assert('claim route exists', routes.includes('/claim'));
    assert('by-request instance route exists', routes.includes('by-request'));
    assert('routes pass roleKeys to listTasksForUser', /roleKeys/.test(routes));

    const hub = fs.readFileSync(path.join(root, 'hub.js'), 'utf8');
    assert('New Request uses start-request-type', /start-request-type/.test(hub));
    assert('My Tasks claims role tasks', /\/claim/.test(hub));
    assert('Request Detail loads cfg instance by request', /instances\/by-request/.test(hub));
    assert('notification badge caps at 9+', /9\+/.test(hub));

    const notify = fs.readFileSync(path.join(root, 'api/lib/configuration/runtime/task-notifications.js'), 'utf8');
    assert('dedupe keys for assigned + role', /task_assigned:/.test(notify) && /role_task_available:/.test(notify));

    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert(
      'npm script registered',
      !!packageJson.scripts['security:wos96-production-workflow-runtime-test']
    );

    console.log('\nResults:', passed, 'passed,', failed, 'failed\n');
    process.exit(failed ? 1 : 0);
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
