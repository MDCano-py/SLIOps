/**
 * WOS-22 — Review notification integration test (local Postgres).
 * Usage: npm run notifications:review-test
 */
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
process.env.SKIP_ASSIGNMENT_NOTIFICATIONS = '1';
process.env.SKIP_SIGNATURE_NOTIFICATIONS = '1';
if (!process.env.EMAIL_NOTIFICATIONS_ENABLED) {
  process.env.EMAIL_NOTIFICATIONS_ENABLED = 'false';
}

const REVIEWER_A = (process.env.WOS22_TEST_REVIEWER || 'wos22-reviewer-a@streamlinecorp.com').toLowerCase();
const REVIEWER_B = (process.env.WOS22_TEST_REVIEWER_B || 'wos22-reviewer-b@streamlinecorp.com').toLowerCase();
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

async function loadReviewNotifications() {
  const modPath = require.resolve('../../api/lib/hub/notifications/review-notifications');
  delete require.cache[modPath];
  return require('../../api/lib/hub/notifications/review-notifications');
}

async function cleanup(client) {
  await client.query(`DELETE FROM notifications WHERE request_id IN (
    SELECT id FROM requests WHERE request_number LIKE 'WOS22_REVIEW_TEST-%'
  )`);
  await client.query(`DELETE FROM audit_events WHERE request_id IN (
    SELECT id FROM requests WHERE request_number LIKE 'WOS22_REVIEW_TEST-%'
  )`);
  await client.query(`DELETE FROM web_documents WHERE request_id IN (
    SELECT id FROM requests WHERE request_number LIKE 'WOS22_REVIEW_TEST-%'
  )`);
  await client.query(`DELETE FROM workflow_steps WHERE request_id IN (
    SELECT id FROM requests WHERE request_number LIKE 'WOS22_REVIEW_TEST-%'
  )`);
  await client.query(`DELETE FROM requests WHERE request_number LIKE 'WOS22_REVIEW_TEST-%'`);
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

async function verifyViaFreshClient(requestId, stepId) {
  const client = new Client(getPgClientConfig());
  await client.connect();
  try {
    const results = [];
    const notif = await client.query(
      `SELECT COUNT(*)::int AS n FROM notifications WHERE request_id=$1 AND type='review_requested'`,
      [requestId]
    );
    if ((notif.rows[0]?.n || 0) >= 1) results.push(pass('Reconnect: review_requested notification persisted'));
    else results.push(fail('Reconnect: review notification missing'));

    const audit = await client.query(
      `SELECT COUNT(*)::int AS n FROM audit_events WHERE request_id=$1 AND action='review_notification_queued'`,
      [requestId]
    );
    if ((audit.rows[0]?.n || 0) >= 1) results.push(pass('Reconnect: review_notification_queued audit persisted'));
    else results.push(fail('Reconnect: review audit missing'));

    if (stepId) {
      const step = await client.query('SELECT id, status FROM workflow_steps WHERE id=$1', [stepId]);
      if (step.rowCount === 1) results.push(pass('Reconnect: workflow step persisted'));
      else results.push(fail('Reconnect: workflow step missing'));
    }
    return results;
  } finally {
    await client.end();
  }
}

async function runTests() {
  const store = await loadStore();
  const reviewNotifications = await loadReviewNotifications();
  const sections = [];
  const ids = {};

  const requestNumber = `WOS22_REVIEW_TEST-${RUN_ID}`;
  const created = await store.createRequest(
    {
      request_type: 'document_review',
      request_number: requestNumber,
      title: `WOS-22 review test ${RUN_ID}`,
      status: 'submitted',
      priority: 'normal',
      demo: false,
    },
    'wos22-test@streamlinecorp.com'
  );
  idsrequestId = created.id;

  const webDoc = await store.createWebDocument({
    request_id: created.id,
    document_type_key: 'document_review',
    title: created.title,
    status: 'submitted',
    content_json: { test: true },
    version: 1,
    created_by: 'wos22-test@streamlinecorp.com',
    locked: false,
  });
  ids.webDocId = webDoc.id;

  const stepSection = [];
  const step = await store.saveWorkflowStep({
    request_id: created.id,
    step_order: 1,
    step_type: 'review',
    action_type: 'review',
    step_title: 'WOS-22 safety review',
    assigned_to_email: REVIEWER_A,
    assigned_to_name: 'Reviewer A',
    assigned_type: 'employee',
    status: 'not_started',
    review_required: true,
  });
  ids.stepId = step.id;

  const activated = {
    ...step,
    status: 'waiting',
    started_at: store.nowIso(),
  };

  let r1 = await reviewNotifications.notifyWorkflowStepReview({
    request: created,
    step: activated,
    webDoc,
    previousReviewer: step.assigned_to_email,
    previousStatus: 'not_started',
    actorEmail: 'wos22-test@streamlinecorp.com',
  });
  if (r1.ok) stepSection.push(pass('Review step activation creates review_requested notification'));
  else stepSection.push(fail(`Review step activation failed: ${r1.reason || r1.error}`));

  const client = new Client(getPgClientConfig());
  await client.connect();
  try {
    const notifCount = await countNotifications(client, created.id, 'review_requested', REVIEWER_A);
    if (notifCount >= 1) stepSection.push(pass('In-app review_requested row persisted'));
    else stepSection.push(fail('Missing review_requested notification row'));

    const queued = await countAudit(client, created.id, 'review_notification_queued');
    if (queued >= 1) stepSection.push(pass('review_notification_queued audit written'));
    else stepSection.push(fail('Missing review_notification_queued audit'));

    const dup = await reviewNotifications.notifyWorkflowStepReview({
      request: created,
      step: activated,
      webDoc,
      previousReviewer: step.assigned_to_email,
      previousStatus: 'not_started',
      actorEmail: 'wos22-test@streamlinecorp.com',
    });
    if (dup.skipped && dup.reason === 'dedupe') {
      stepSection.push(pass('Duplicate review notification suppressed (dedupe)'));
    } else {
      const skippedDup = await countAudit(client, created.id, 'review_notification_skipped_duplicate');
      if (skippedDup >= 1) stepSection.push(pass('Duplicate review notification skipped audit written'));
      else stepSection.push(fail('Duplicate review notification was not suppressed'));
    }

    const sameSave = await reviewNotifications.notifyWorkflowStepReview({
      request: created,
      step: activated,
      webDoc,
      previousReviewer: REVIEWER_A,
      previousStatus: 'waiting',
      actorEmail: 'wos22-test@streamlinecorp.com',
    });
    if (sameSave.skipped && sameSave.reason === 'unchanged_step') {
      stepSection.push(pass('Unchanged review step does not notify'));
    } else stepSection.push(fail(`Expected unchanged_step skip, got ${sameSave.reason || 'notify'}`));

    const reassignedStep = {
      ...activated,
      assigned_to_email: REVIEWER_B,
      assigned_to_name: 'Reviewer B',
      status: 'pending',
    };
    const r2 = await reviewNotifications.notifyWorkflowStepReview({
      request: created,
      step: reassignedStep,
      webDoc,
      previousReviewer: REVIEWER_A,
      previousStatus: 'waiting',
      actorEmail: 'wos22-test@streamlinecorp.com',
    });
    if (r2.ok && r2.type === 'review_reassigned') {
      stepSection.push(pass('Reviewer change creates review_reassigned notification'));
    } else if (r2.ok) {
      stepSection.push(pass('Reviewer change creates new review notification'));
    } else stepSection.push(fail(`Reviewer change failed: ${r2.reason || r2.error}`));

    const bCount = await countNotifications(client, created.id, 'review_reassigned', REVIEWER_B);
    if (bCount >= 1) stepSection.push(pass('New reviewer has review_reassigned row'));
    else stepSection.push(fail('New reviewer missing review_reassigned notification'));

    sections.push(['Workflow step review', stepSection]);

    const statusSection = [];
    const { record: inReview } = await store.patchRequest(created.id, { status: 'in_review' });
    const statusNotify = await reviewNotifications.notifyRequestReviewStatus({
      request: inReview,
      webDoc,
      previousStatus: 'submitted',
      reviewerEmail: REVIEWER_B,
      actorEmail: 'wos22-test@streamlinecorp.com',
    });
    if (statusNotify.ok) statusSection.push(pass('Request in_review status triggers review notification'));
    else statusSection.push(fail(`Request review status failed: ${statusNotify.reason || statusNotify.error}`));

    sections.push(['Request review status', statusSection]);

    const emailSection = [];
    const enabled = String(process.env.EMAIL_NOTIFICATIONS_ENABLED).toLowerCase() === 'true';
    if (enabled) {
      emailSection.push(pass('EMAIL_NOTIFICATIONS_ENABLED=true (real send may occur if RESEND_API_KEY set)'));
    } else {
      emailSection.push(pass('EMAIL_NOTIFICATIONS_ENABLED=false — dev console logging only'));
    }
    sections.push(['Email delivery mode', emailSection]);
  } finally {
    await client.end();
  }

  if (store.pool?.end) await store.pool.end();

  sections.push(['Reconnect persistence', await verifyViaFreshClient(idsrequestId, ids.stepId)]);

  const cleanupClient = new Client(getPgClientConfig());
  await cleanupClient.connect();
  try {
    await cleanup(cleanupClient);
  } finally {
    await cleanupClient.end();
  }

  return sections;
}

async function main() {
  console.log('=== WOS-22 Review Notification Test ===');
  console.log(`Host: ${databaseHost() || '(unset)'}`);
  console.log(`Local DB: ${isLocalDatabaseUrl() ? 'yes' : 'no'}`);
  console.log(`Run ID: ${RUN_ID}`);
  console.log(`EMAIL_NOTIFICATIONS_ENABLED: ${process.env.EMAIL_NOTIFICATIONS_ENABLED}`);
  console.log(`SKIP_ASSIGNMENT_NOTIFICATIONS: ${process.env.SKIP_ASSIGNMENT_NOTIFICATIONS}`);

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
  console.log('PASS  All review notification checks passed');
}

main();
