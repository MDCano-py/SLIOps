/**
 * WOS-21 — Assignment notification integration test (local Postgres).
 * Usage: npm run notifications:assignment-test
 */
const crypto = require('crypto');
const { Client } = require('pg');
const {
  loadDbEnv,
  getPgClientConfig,
  isLocalDatabaseUrl,
  databaseHost,
  assertPersistenceTestAllowed,
} = require('../db/env');

loadDbEnv();
process.env.HUB_STORE_MODE = 'postgres';
process.env.HUB_USE_LOCAL_STORE = '0';
process.env.SKIP_REVIEW_NOTIFICATIONS = '1';
process.env.SKIP_SIGNATURE_NOTIFICATIONS = '1';
if (!process.env.EMAIL_NOTIFICATIONS_ENABLED) {
  process.env.EMAIL_NOTIFICATIONS_ENABLED = 'false';
}

const TEST_EMAIL_A = (process.env.WOS21_TEST_ASSIGNEE || 'wos21-assignee-a@streamlinecorp.com').toLowerCase();
const TEST_EMAIL_B = (process.env.WOS21_TEST_ASSIGNEE_B || 'wos21-assignee-b@streamlinecorp.com').toLowerCase();
const RUN_ID = Date.now();

function pass(msg) {
  return { ok: true, msg };
}

function fail(msg) {
  return { ok: false, msg };
}

function printSection(title, results) {
  console.log(`\n## ${title}`);
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.msg}`);
  }
}

async function loadStore() {
  const storePath = require.resolve('../../api/lib/hub/db/postgres');
  delete require.cache[storePath];
  delete require.cache[require.resolve('../../api/lib/hub/db/index.js')];
  return require('../../api/lib/hub/db/postgres');
}

async function loadAssignmentNotifications() {
  const modPath = require.resolve('../../api/lib/hub/notifications/assignment-notifications');
  delete require.cache[modPath];
  return require('../../api/lib/hub/notifications/assignment-notifications');
}

async function cleanup(client) {
  await client.query(`DELETE FROM notifications WHERE request_id IN (
    SELECT id FROM requests WHERE request_number LIKE 'WOS21_ASSIGNMENT_TEST-%'
  )`);
  await client.query(`DELETE FROM audit_events WHERE request_id IN (
    SELECT id FROM requests WHERE request_number LIKE 'WOS21_ASSIGNMENT_TEST-%'
  )`);
  await client.query(`DELETE FROM workflow_steps WHERE request_id IN (
    SELECT id FROM requests WHERE request_number LIKE 'WOS21_ASSIGNMENT_TEST-%'
  )`);
  await client.query(`DELETE FROM requests WHERE request_number LIKE 'WOS21_ASSIGNMENT_TEST-%'`);
}

async function countNotifications(client, requestId, type, recipient) {
  const r = await client.query(
    `SELECT COUNT(*)::int AS n FROM notifications
     WHERE request_id=$1 AND type=$2 AND LOWER(recipient_email)=LOWER($3)`,
    [requestId, type, recipient]
  );
  return r.rows[0]?.n || 0;
}

async function countAudit(client, requestId, action) {
  const r = await client.query(
    `SELECT COUNT(*)::int AS n FROM audit_events WHERE request_id=$1 AND action=$2`,
    [requestId, action]
  );
  return r.rows[0]?.n || 0;
}

async function runTests() {
  const store = await loadStore();
  const assignmentNotifications = await loadAssignmentNotifications();
  const sections = [];
  const ids = {};

  const requestNumber = `WOS21_ASSIGNMENT_TEST-${RUN_ID}`;
  const created = await store.createRequest(
    {
      request_type: 'work_order',
      request_number: requestNumber,
      title: `WOS-21 assignment test ${RUN_ID}`,
      status: 'submitted',
      priority: 'high',
      assigned_to: TEST_EMAIL_A,
      demo: false,
    },
    'wos21-test@streamlinecorp.com'
  );
  ids.requestId = created.id;

  const requestSection = [];

  let n1 = await assignmentNotifications.notifyRequestAssignment({
    request: created,
    previousAssignee: null,
    actorEmail: 'wos21-test@streamlinecorp.com',
  });
  if (n1.ok) requestSection.push(pass('Initial request assignment notification created'));
  else requestSection.push(fail(`Initial request assignment failed: ${n1.reason || n1.error}`));

  const client = new Client(getPgClientConfig());
  await client.connect();
  try {
    const notifCount = await countNotifications(client, created.id, 'request_assigned', TEST_EMAIL_A);
    if (notifCount >= 1) requestSection.push(pass('In-app request_assigned row persisted'));
    else requestSection.push(fail('Missing request_assigned notification row'));

    const queued = await countAudit(client, created.id, 'assignment_notification_queued');
    if (queued >= 1) requestSection.push(pass('assignment_notification_queued audit written'));
    else requestSection.push(fail('Missing assignment_notification_queued audit'));

    const dup = await assignmentNotifications.notifyRequestAssignment({
      request: created,
      previousAssignee: null,
      actorEmail: 'wos21-test@streamlinecorp.com',
    });
    if (dup.skipped && dup.reason === 'dedupe') {
      requestSection.push(pass('Duplicate request assignment suppressed (dedupe)'));
    } else if (dup.skipped && dup.reason === 'unchanged_assignee') {
      requestSection.push(pass('Re-notify with same assignee skipped'));
    } else {
      const notifCount2 = await countNotifications(client, created.id, 'request_assigned', TEST_EMAIL_A);
      if (notifCount2 === notifCount) requestSection.push(pass('No duplicate notification on re-notify'));
      else requestSection.push(fail(`Duplicate notifications: ${notifCount} -> ${notifCount2}`));
    }

    const { record: patchedSame } = await store.patchRequest(created.id, { title: created.title });
    const sameAssign = await assignmentNotifications.notifyRequestAssignment({
      request: patchedSame,
      previousAssignee: TEST_EMAIL_A,
      actorEmail: 'wos21-test@streamlinecorp.com',
    });
    if (sameAssign.skipped && sameAssign.reason === 'unchanged_assignee') {
      requestSection.push(pass('Unchanged assignee does not notify'));
    } else requestSection.push(fail(`Expected unchanged_assignee skip, got ${sameAssign.reason || 'notify'}`));

    const { record: reassigned } = await store.patchRequest(created.id, { assigned_to: TEST_EMAIL_B });
    const n2 = await assignmentNotifications.notifyRequestAssignment({
      request: reassigned,
      previousAssignee: TEST_EMAIL_A,
      actorEmail: 'wos21-test@streamlinecorp.com',
    });
    if (n2.ok) requestSection.push(pass('Assignee change creates new notification'));
    else requestSection.push(fail(`Assignee change notification failed: ${n2.reason || n2.error}`));

    const bCount = await countNotifications(client, created.id, 'request_assigned', TEST_EMAIL_B);
    if (bCount >= 1) requestSection.push(pass('New assignee has request_assigned row'));
    else requestSection.push(fail('New assignee missing notification'));

    sections.push(['Request assignment', requestSection]);

    const stepSection = [];
    const step = await store.saveWorkflowStep({
      request_id: created.id,
      step_order: 1,
      step_type: 'review',
      action_type: 'review',
      step_title: 'WOS-21 review step',
      assigned_to_email: TEST_EMAIL_A,
      assigned_to_name: 'Assignee A',
      assigned_type: 'employee',
      status: 'not_started',
    });
    ids.stepId = step.id;

    const stepNotify = await assignmentNotifications.notifyWorkflowStepAssignment({
      request: reassigned,
      step: { ...step, status: 'waiting', started_at: store.nowIso() },
      previousAssignee: step.assigned_to_email,
      previousStatus: 'not_started',
      actorEmail: 'wos21-test@streamlinecorp.com',
    });
    if (stepNotify.ok) stepSection.push(pass('Workflow step assignment notification created'));
    else stepSection.push(fail(`Step assignment failed: ${stepNotify.reason || stepNotify.error}`));

    const stepCount = await countNotifications(client, created.id, 'workflow_step_assigned', TEST_EMAIL_A);
    if (stepCount >= 1) stepSection.push(pass('In-app workflow_step_assigned row persisted'));
    else stepSection.push(fail('Missing workflow_step_assigned notification'));

    const stepDup = await assignmentNotifications.notifyWorkflowStepAssignment({
      request: reassigned,
      step: { ...step, status: 'waiting', started_at: store.nowIso() },
      previousAssignee: step.assigned_to_email,
      previousStatus: 'not_started',
      actorEmail: 'wos21-test@streamlinecorp.com',
    });
    if (stepDup.skipped) stepSection.push(pass('Duplicate step assignment suppressed'));
    else stepSection.push(fail('Step assignment duplicate was not suppressed'));

    sections.push(['Workflow step assignment', stepSection]);

    const emailSection = [];
    const enabled = String(process.env.EMAIL_NOTIFICATIONS_ENABLED).toLowerCase() === 'true';
    if (enabled) {
      emailSection.push(pass('EMAIL_NOTIFICATIONS_ENABLED=true (real send may occur if RESEND_API_KEY set)'));
    } else {
      emailSection.push(pass('EMAIL_NOTIFICATIONS_ENABLED=false — dev console logging only'));
    }
    sections.push(['Email delivery mode', emailSection]);
  } finally {
    await cleanup(client);
    await client.end();
  }

  if (store.pool?.end) await store.pool.end();
  return sections;
}

async function main() {
  console.log('=== WOS-21 Assignment Notification Test ===');
  console.log(`Host: ${databaseHost() || '(unset)'}`);
  console.log(`Local DB: ${isLocalDatabaseUrl() ? 'yes' : 'no'}`);
  console.log(`Run ID: ${RUN_ID}`);
  console.log(`EMAIL_NOTIFICATIONS_ENABLED: ${process.env.EMAIL_NOTIFICATIONS_ENABLED}`);

  try {
    assertPersistenceTestAllowed();
  } catch (err) {
    console.error(`\nFAIL  ${err.message}`);
    process.exit(1);
  }

  let sections;
  try {
    sections = await runTests();
  } catch (err) {
    console.error('\nFAIL  Unexpected error:', err);
    process.exit(1);
  }

  let failed = 0;
  for (const [title, results] of sections) {
    printSection(title, results);
    failed += results.filter((r) => !r.ok).length;
  }

  console.log('\n=== Summary ===');
  if (failed) {
    console.log(`FAIL  ${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log('PASS  All assignment notification checks passed');
}

main();
