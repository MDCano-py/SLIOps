/**
 * WOS-23 — Signature notification integration test (local Postgres).
 * Usage: npm run notifications:signature-test
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
process.env.SKIP_REVIEW_NOTIFICATIONS = '1';
if (!process.env.EMAIL_NOTIFICATIONS_ENABLED) {
  process.env.EMAIL_NOTIFICATIONS_ENABLED = 'false';
}

const SIGNER_A = (process.env.WOS23_TEST_SIGNER || 'wos23-signer-a@streamlinecorp.com').toLowerCase();
const SIGNER_B = (process.env.WOS23_TEST_SIGNER_B || 'wos23-signer-b@streamlinecorp.com').toLowerCase();
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

async function loadSignatureNotifications() {
  const modPath = require.resolve('../../api/lib/hub/notifications/signature-notifications');
  delete require.cache[modPath];
  return require('../../api/lib/hub/notifications/signature-notifications');
}

async function cleanup(client) {
  await client.query(`DELETE FROM notifications WHERE request_id IN (
    SELECT id FROM requests WHERE request_number LIKE 'WOS23_SIGNATURE_TEST-%'
  )`);
  await client.query(`DELETE FROM audit_events WHERE request_id IN (
    SELECT id FROM requests WHERE request_number LIKE 'WOS23_SIGNATURE_TEST-%'
  )`);
  await client.query(`DELETE FROM action_links WHERE request_id IN (
    SELECT id FROM requests WHERE request_number LIKE 'WOS23_SIGNATURE_TEST-%'
  )`);
  await client.query(`DELETE FROM web_documents WHERE request_id IN (
    SELECT id FROM requests WHERE request_number LIKE 'WOS23_SIGNATURE_TEST-%'
  )`);
  await client.query(`DELETE FROM workflow_steps WHERE request_id IN (
    SELECT id FROM requests WHERE request_number LIKE 'WOS23_SIGNATURE_TEST-%'
  )`);
  await client.query(`DELETE FROM requests WHERE request_number LIKE 'WOS23_SIGNATURE_TEST-%'`);
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

async function verifyViaFreshClient(requestId, stepId, linkId) {
  const client = new Client(getPgClientConfig());
  await client.connect();
  try {
    const results = [];
    const notif = await client.query(
      `SELECT COUNT(*)::int AS n FROM notifications WHERE request_id=$1 AND type='signature_requested'`,
      [requestId]
    );
    if ((notif.rows[0]?.n || 0) >= 1) results.push(pass('Reconnect: signature_requested notification persisted'));
    else results.push(fail('Reconnect: signature notification missing'));

    const audit = await client.query(
      `SELECT COUNT(*)::int AS n FROM audit_events WHERE request_id=$1 AND action='signature_notification_queued'`,
      [requestId]
    );
    if ((audit.rows[0]?.n || 0) >= 1) results.push(pass('Reconnect: signature_notification_queued audit persisted'));
    else results.push(fail('Reconnect: signature audit missing'));

    if (stepId) {
      const step = await client.query('SELECT id, status FROM workflow_steps WHERE id=$1', [stepId]);
      if (step.rowCount === 1) results.push(pass('Reconnect: workflow step persisted'));
      else results.push(fail('Reconnect: workflow step missing'));
    }

    if (linkId) {
      const link = await client.query('SELECT id FROM action_links WHERE id=$1', [linkId]);
      if (link.rowCount === 1) results.push(pass('Reconnect: action link persisted'));
      else results.push(fail('Reconnect: action link missing'));
    }
    return results;
  } finally {
    await client.end();
  }
}

async function runTests() {
  const store = await loadStore();
  const signatureNotifications = await loadSignatureNotifications();
  const sections = [];
  const ids = {};

  const requestNumber = `WOS23_SIGNATURE_TEST-${RUN_ID}`;
  const created = await store.createRequest(
    {
      request_type: 'document_signature',
      request_number: requestNumber,
      title: `WOS-23 signature test ${RUN_ID}`,
      status: 'submitted',
      priority: 'normal',
      demo: false,
    },
    'wos23-test@streamlinecorp.com'
  );
  ids.requestId = created.id;

  const webDoc = await store.createWebDocument({
    request_id: created.id,
    document_type_key: 'document_signature',
    title: created.title,
    status: 'submitted',
    content_json: { test: true },
    version: 1,
    created_by: 'wos23-test@streamlinecorp.com',
    locked: false,
  });
  ids.webDocId = webDoc.id;

  const stepSection = [];
  const step = await store.saveWorkflowStep({
    request_id: created.id,
    step_order: 1,
    step_type: 'sign',
    action_type: 'sign',
    step_title: 'WOS-23 client signature',
    assigned_to_email: SIGNER_A,
    assigned_to_name: 'Signer A',
    assigned_type: 'employee',
    status: 'not_started',
    requires_signature: true,
  });
  ids.stepId = step.id;

  const activated = {
    ...step,
    status: 'waiting',
    started_at: store.nowIso(),
  };

  let r1 = await signatureNotifications.notifyWorkflowStepSignature({
    request: created,
    step: activated,
    webDoc,
    previousSigner: step.assigned_to_email,
    previousStatus: 'not_started',
    actorEmail: 'wos23-test@streamlinecorp.com',
  });
  if (r1.ok) stepSection.push(pass('Signature step activation creates signature_requested notification'));
  else stepSection.push(fail(`Signature step activation failed: ${r1.reason || r1.error}`));

  const client = new Client(getPgClientConfig());
  await client.connect();
  try {
    const notifCount = await countNotifications(client, created.id, 'signature_requested', SIGNER_A);
    if (notifCount >= 1) stepSection.push(pass('In-app signature_requested row persisted'));
    else stepSection.push(fail('Missing signature_requested notification row'));

    const queued = await countAudit(client, created.id, 'signature_notification_queued');
    if (queued >= 1) stepSection.push(pass('signature_notification_queued audit written'));
    else stepSection.push(fail('Missing signature_notification_queued audit'));

    const dup = await signatureNotifications.notifyWorkflowStepSignature({
      request: created,
      step: activated,
      webDoc,
      previousSigner: step.assigned_to_email,
      previousStatus: 'not_started',
      actorEmail: 'wos23-test@streamlinecorp.com',
    });
    if (dup.skipped && dup.reason === 'dedupe') {
      stepSection.push(pass('Duplicate signature notification suppressed (dedupe)'));
    } else {
      const skippedDup = await countAudit(client, created.id, 'signature_notification_skipped_duplicate');
      if (skippedDup >= 1) stepSection.push(pass('Duplicate signature notification skipped audit written'));
      else stepSection.push(fail('Duplicate signature notification was not suppressed'));
    }

    const sameSave = await signatureNotifications.notifyWorkflowStepSignature({
      request: created,
      step: activated,
      webDoc,
      previousSigner: SIGNER_A,
      previousStatus: 'waiting',
      actorEmail: 'wos23-test@streamlinecorp.com',
    });
    if (sameSave.skipped && sameSave.reason === 'unchanged_step') {
      stepSection.push(pass('Unchanged signature step does not notify'));
    } else stepSection.push(fail(`Expected unchanged_step skip, got ${sameSave.reason || 'notify'}`));

    const reassignedStep = {
      ...activated,
      assigned_to_email: SIGNER_B,
      assigned_to_name: 'Signer B',
      status: 'pending',
    };
    const r2 = await signatureNotifications.notifyWorkflowStepSignature({
      request: created,
      step: reassignedStep,
      webDoc,
      previousSigner: SIGNER_A,
      previousStatus: 'waiting',
      actorEmail: 'wos23-test@streamlinecorp.com',
    });
    if (r2.ok && r2.type === 'signature_reassigned') {
      stepSection.push(pass('Signer change creates signature_reassigned notification'));
    } else if (r2.ok) {
      stepSection.push(pass('Signer change creates new signature notification'));
    } else stepSection.push(fail(`Signer change failed: ${r2.reason || r2.error}`));

    const bCount = await countNotifications(client, created.id, 'signature_reassigned', SIGNER_B);
    if (bCount >= 1) stepSection.push(pass('New signer has signature_reassigned row'));
    else stepSection.push(fail('New signer missing signature_reassigned notification'));

    sections.push(['Workflow step signature', stepSection]);

    const linkSection = [];
    const { link, token } = await store.createActionLink({
      request_id: created.id,
      workflow_step_id: step.id,
      recipient_email: SIGNER_A,
      action_type: 'sign',
      expires_in_hours: 168,
    });
    ids.linkId = link.id;
    const base = process.env.PORTAL_BASE_URL || 'http://127.0.0.1:3000';
    const actionUrl = `${base.replace(/\/$/, '')}/action.html?t=${encodeURIComponent(token)}`;

    const linkNotify = await signatureNotifications.notifySignatureActionLink({
      request: created,
      step: activated,
      webDoc,
      link,
      actionLinkUrl: actionUrl,
      actorEmail: 'wos23-test@streamlinecorp.com',
    });
    if (linkNotify.ok) linkSection.push(pass('Action link creation triggers signature notification'));
    else linkSection.push(fail(`Action link notification failed: ${linkNotify.reason || linkNotify.error}`));

    const linkDup = await signatureNotifications.notifySignatureActionLink({
      request: created,
      step: activated,
      webDoc,
      link,
      actionLinkUrl: actionUrl,
      actorEmail: 'wos23-test@streamlinecorp.com',
    });
    if (linkDup.skipped && linkDup.reason === 'dedupe') {
      linkSection.push(pass('Duplicate action-link signature notification suppressed'));
    } else linkSection.push(fail('Action link duplicate was not suppressed'));

    sections.push(['Action link signature', linkSection]);

    const statusSection = [];
    const { record: waitingSig } = await store.patchRequest(created.id, { status: 'waiting_on_signature' });
    const statusNotify = await signatureNotifications.notifyRequestSignatureStatus({
      request: waitingSig,
      webDoc,
      previousStatus: 'submitted',
      signerEmail: SIGNER_B,
      actorEmail: 'wos23-test@streamlinecorp.com',
    });
    if (statusNotify.ok) statusSection.push(pass('Request waiting_on_signature triggers signature notification'));
    else statusSection.push(fail(`Request signature status failed: ${statusNotify.reason || statusNotify.error}`));

    sections.push(['Request signature status', statusSection]);

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

  sections.push(['Reconnect persistence', await verifyViaFreshClient(ids.requestId, ids.stepId, ids.linkId)]);

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
  console.log('=== WOS-23 Signature Notification Test ===');
  console.log(`Host: ${databaseHost() || '(unset)'}`);
  console.log(`Local DB: ${isLocalDatabaseUrl() ? 'yes' : 'no'}`);
  console.log(`Run ID: ${RUN_ID}`);
  console.log(`EMAIL_NOTIFICATIONS_ENABLED: ${process.env.EMAIL_NOTIFICATIONS_ENABLED}`);
  console.log(`SKIP_ASSIGNMENT_NOTIFICATIONS: ${process.env.SKIP_ASSIGNMENT_NOTIFICATIONS}`);
  console.log(`SKIP_REVIEW_NOTIFICATIONS: ${process.env.SKIP_REVIEW_NOTIFICATIONS}`);

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
  console.log('PASS  All signature notification checks passed');
}

main();
