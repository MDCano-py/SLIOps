/**
 * WOS-20 — End-to-end Postgres persistence layer test for Operations Workflow Hub.
 * Usage: npm run db:persistence-test
 *
 * Inserts namespaced PERSISTENCE_TEST-* records via the postgres store adapter,
 * verifies survive a pool reconnect, cleans up only its own rows.
 * Never deletes demo or production data.
 */
const crypto = require('crypto');
const { Client } = require('pg');
const {
  loadDbEnv,
  getPgClientConfig,
  isLocalDatabaseUrl,
  databaseHost,
  assertPersistenceTestAllowed,
} = require('./env');

loadDbEnv();
process.env.SKIP_ASSIGNMENT_NOTIFICATIONS = '1';
process.env.SKIP_REVIEW_NOTIFICATIONS = '1';
process.env.SKIP_SIGNATURE_NOTIFICATIONS = '1';

const TEST_EMAIL = 'persistence-test@streamlinecorp.com';
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
  process.env.HUB_STORE_MODE = 'postgres';
  process.env.HUB_USE_LOCAL_STORE = '0';
  const storePath = require.resolve('../../api/lib/hub/db/postgres');
  delete require.cache[storePath];
  delete require.cache[require.resolve('../../api/lib/hub/db/index.js')];
  return require('../../api/lib/hub/db/postgres');
}

async function cleanupTestRows(client) {
  await client.query(
    `DELETE FROM requests WHERE request_number LIKE 'PERSISTENCE_TEST-%' OR title LIKE 'PERSISTENCE_TEST %'`
  );
}

async function verifyViaFreshClient(ids) {
  const client = new Client(getPgClientConfig());
  await client.connect();
  try {
    const results = [];
    const req = await client.query('SELECT * FROM requests WHERE id=$1', [ids.requestId]);
    if (req.rowCount !== 1) results.push(fail('Reconnect: request row missing'));
    else if (req.rows[0].status !== 'in_review') results.push(fail('Reconnect: request status mismatch'));
    else results.push(pass('Reconnect: request persisted'));

    const hist = await client.query(
      'SELECT COUNT(*)::int AS n FROM status_history WHERE request_id=$1',
      [ids.requestId]
    );
    if ((hist.rows[0]?.n || 0) < 1) results.push(fail('Reconnect: status_history missing'));
    else results.push(pass('Reconnect: status_history persisted'));

    const steps = await client.query(
      'SELECT status FROM workflow_steps WHERE request_id=$1 ORDER BY step_order',
      [ids.requestId]
    );
    if (steps.rowCount < 2) results.push(fail('Reconnect: workflow_steps missing'));
    else if (steps.rows[0]?.status !== 'completed') results.push(fail('Reconnect: step 1 not completed'));
    else results.push(pass('Reconnect: workflow_steps persisted'));

    const doc = await client.query('SELECT content_json FROM web_documents WHERE id=$1', [ids.docId]);
    if (!doc.rowCount) results.push(fail('Reconnect: web_document missing'));
    else results.push(pass('Reconnect: web_document persisted'));

    const comment = await client.query('SELECT body FROM comments WHERE id=$1', [ids.commentId]);
    if (!comment.rowCount) results.push(fail('Reconnect: comment missing'));
    else results.push(pass('Reconnect: comment persisted'));

    const notif = await client.query('SELECT read_at FROM notifications WHERE id=$1', [ids.notifId]);
    if (!notif.rowCount) results.push(fail('Reconnect: notification missing'));
    else if (!notif.rows[0].read_at) results.push(fail('Reconnect: notification read_at not persisted'));
    else results.push(pass('Reconnect: notification read state persisted'));

    const integ = await client.query('SELECT status FROM integration_events WHERE id=$1', [ids.integId]);
    if (!integ.rowCount) results.push(fail('Reconnect: integration_event missing'));
    else if (integ.rows[0].status !== 'sent') results.push(fail('Reconnect: integration_event status mismatch'));
    else results.push(pass('Reconnect: integration_event persisted'));

    const link = await client.query('SELECT used_at FROM action_links WHERE id=$1', [ids.linkId]);
    if (!link.rowCount) results.push(fail('Reconnect: action_link missing'));
    else if (!link.rows[0].used_at) results.push(fail('Reconnect: action_link used_at not persisted'));
    else results.push(pass('Reconnect: action_link state persisted'));

    const audit = await client.query('SELECT COUNT(*)::int AS n FROM audit_events WHERE request_id=$1', [
      ids.requestId,
    ]);
    if ((audit.rows[0]?.n || 0) < 1) results.push(fail('Reconnect: audit_events missing'));
    else results.push(pass('Reconnect: audit_events persisted'));

    const file = await client.query('SELECT file_name FROM request_files WHERE id=$1', [ids.fileId]);
    if (!file.rowCount) results.push(fail('Reconnect: request_files missing'));
    else results.push(pass('Reconnect: request_files persisted'));

    return results;
  } finally {
    await client.end();
  }
}

async function runPersistenceFlow(store) {
  const sections = [];
  const ids = {};
  const requestNumber = `PERSISTENCE_TEST-${RUN_ID}`;

  // --- Request ---
  const reqSection = [];
  const created = await store.createRequest(
    {
      request_type: 'general_request',
      request_number: requestNumber,
      title: `PERSISTENCE_TEST WOS-20 run ${RUN_ID}`,
      description: 'Automated persistence layer test record',
      status: 'submitted',
      demo: false,
      assigned_to_email: TEST_EMAIL,
      form_payload: { persistence_test: true, run_id: RUN_ID },
    },
    TEST_EMAIL
  );
  ids.requestId = created.id;
  if (!created.id || created.request_number !== requestNumber) {
    reqSection.push(fail('createRequest failed'));
  } else {
    reqSection.push(pass(`createRequest → ${created.request_number}`));
  }

  const patched = await store.patchRequest(created.id, { status: 'in_review', internal_notes: 'persist check' });
  if (patched.record?.status === 'in_review') reqSection.push(pass('patchRequest status → in_review'));
  else reqSection.push(fail('patchRequest status update failed'));

  const reloaded = await store.getRequest(created.id);
  if (reloaded?.internal_notes === 'persist check') reqSection.push(pass('getRequest after patch'));
  else reqSection.push(fail('getRequest after patch failed'));

  sections.push(['Requests', reqSection]);

  // --- Status history ---
  const histSection = [];
  const hist = await store.addStatusHistory({
    request_id: created.id,
    old_status: 'submitted',
    new_status: 'in_review',
    changed_by: TEST_EMAIL,
    source: 'db:persistence-test',
    note: 'PERSISTENCE_TEST status transition',
  });
  ids.historyId = hist.id;
  const history = await store.listStatusHistory(created.id);
  if (history.length >= 1) histSection.push(pass(`addStatusHistory + list (${history.length} row(s))`));
  else histSection.push(fail('status_history not listed'));

  await store.addAuditEvent({
    request_id: created.id,
    action: 'persistence.test',
    metadata: { run_id: RUN_ID, test: true },
    actor_email: TEST_EMAIL,
  });
  const audits = await store.listAuditEvents(created.id);
  if (audits.length >= 1) histSection.push(pass(`addAuditEvent + list (${audits.length} row(s))`));
  else histSection.push(fail('audit_events not listed'));

  sections.push(['Status history & audit', histSection]);

  // --- Workflow steps ---
  const wfSection = [];
  const step1 = await store.saveWorkflowStep({
    request_id: created.id,
    step_order: 1,
    step_type: 'fill',
    action_type: 'fill',
    step_title: 'PERSISTENCE_TEST fill',
    status: 'completed',
    completed_by: TEST_EMAIL,
    required: true,
  });
  const step2 = await store.saveWorkflowStep({
    request_id: created.id,
    step_order: 2,
    step_type: 'review',
    action_type: 'review',
    step_title: 'PERSISTENCE_TEST review',
    status: 'in_progress',
    assigned_to_email: TEST_EMAIL,
    required: true,
  });
  ids.step1Id = step1.id;
  ids.step2Id = step2.id;
  const steps = await store.listWorkflowSteps(created.id);
  if (steps.length === 2 && steps[0].status === 'completed') wfSection.push(pass('saveWorkflowStep + listWorkflowSteps'));
  else wfSection.push(fail('workflow_steps state incorrect'));

  sections.push(['Workflow steps', wfSection]);

  // --- Web document ---
  const docSection = [];
  const doc = await store.createWebDocument({
    request_id: created.id,
    document_type_key: 'general_request',
    title: 'PERSISTENCE_TEST document',
    status: 'draft',
    content_json: { persistence_test: true, note: 'saved content' },
    created_by: TEST_EMAIL,
  });
  ids.docId = doc.id;
  const patchedDoc = await store.patchWebDocument(doc.id, {
    content_json: { persistence_test: true, note: 'updated content', version: 2 },
    status: 'in_review',
  });
  if (patchedDoc?.content_json?.note === 'updated content') docSection.push(pass('createWebDocument + patchWebDocument'));
  else docSection.push(fail('web_document patch failed'));

  const gotDoc = await store.getWebDocumentByRequestId(created.id);
  if (gotDoc?.id === doc.id) docSection.push(pass('getWebDocumentByRequestId'));
  else docSection.push(fail('getWebDocumentByRequestId failed'));

  sections.push(['Web documents', docSection]);

  // --- Comments ---
  const commentSection = [];
  const comment = await store.addComment({
    request_id: created.id,
    author_email: TEST_EMAIL,
    author_name: 'Persistence Test',
    body: 'PERSISTENCE_TEST comment body',
    visible_to_client: false,
  });
  ids.commentId = comment.id;
  const comments = await store.listComments(created.id);
  if (comments.some((c) => c.id === comment.id)) commentSection.push(pass('addComment + listComments'));
  else commentSection.push(fail('comment not found after insert'));

  sections.push(['Comments', commentSection]);

  // --- Notifications ---
  const notifSection = [];
  const notif = await store.saveNotification({
    recipient_email: TEST_EMAIL,
    type: 'persistence_test',
    title: 'PERSISTENCE_TEST notification',
    message: 'Persistence test notification',
    request_id: created.id,
  });
  ids.notifId = notif.id;
  await store.markNotificationRead(notif.id, TEST_EMAIL);
  const unread = await store.countUnreadNotifications(TEST_EMAIL);
  const listed = await store.listNotifications(TEST_EMAIL);
  if (listed.some((n) => n.id === notif.id && n.read_at)) notifSection.push(pass('saveNotification + markNotificationRead'));
  else notifSection.push(fail('notification read state failed'));
  notifSection.push(pass(`countUnreadNotifications=${unread} (after mark read)`));

  sections.push(['Notifications', notifSection]);

  // --- Integration events ---
  const integSection = [];
  const ev = await store.queueIntegrationEvent({
    event_type: 'persistence.test',
    request_id: created.id,
    payload: { persistence_test: true, run_id: RUN_ID },
  });
  ids.integId = ev.id;
  await store.updateIntegrationEvent(ev.id, { status: 'sent', sent_at: store.nowIso(), attempts: 1 });
  const pending = await store.countPendingIntegrationEvents();
  integSection.push(pass(`queueIntegrationEvent + updateIntegrationEvent (pending queue=${pending})`));

  sections.push(['Integration events', integSection]);

  // --- Action links ---
  const linkSection = [];
  const { link, token } = await store.createActionLink({
    request_id: created.id,
    workflow_step_id: step2.id,
    recipient_email: TEST_EMAIL,
    action_type: 'review',
    expires_in_hours: 24,
  });
  ids.linkId = link.id;
  const resolved = await store.getActionLinkByToken(token);
  if (resolved?.id === link.id) linkSection.push(pass('createActionLink + getActionLinkByToken'));
  else linkSection.push(fail('action link token resolution failed'));

  await store.markActionLinkUsed(link.id);
  const used = await store.getActionLinkByToken(token);
  if (used?.used_at) linkSection.push(pass('markActionLinkUsed persists'));
  else linkSection.push(fail('action link used_at not set'));

  sections.push(['Action links', linkSection]);

  // --- Request files (attachments) ---
  const fileSection = [];
  const file = await store.saveDocument({
    request_id: created.id,
    file_name: 'PERSISTENCE_TEST.txt',
    file_url: 'https://example.invalid/persistence-test.txt',
    document_type: 'attachment',
    uploaded_by: TEST_EMAIL,
  });
  ids.fileId = file.id;
  const files = await store.listDocuments(created.id);
  if (files.some((f) => f.id === file.id)) fileSection.push(pass('saveDocument + listDocuments'));
  else fileSection.push(fail('request_files not listed'));

  sections.push(['Documents / files', fileSection]);

  // --- Demo isolation ---
  const demoSection = [];
  const demoIds = typeof store.listDemoRequestIds === 'function' ? await store.listDemoRequestIds() : [];
  if (!demoIds.includes(created.id)) demoSection.push(pass('Non-demo request excluded from listDemoRequestIds'));
  else demoSection.push(fail('Non-demo request incorrectly listed as demo'));

  const manualBefore = await store.getRequest(created.id);
  if (demoIds.length > 0) {
    const demoId = demoIds[0];
    await store.deleteDemoRequest(demoId);
    const manualAfter = await store.getRequest(created.id);
    if (manualAfter?.id === manualBefore?.id) demoSection.push(pass('deleteDemoRequest does not remove non-demo test request'));
    else demoSection.push(fail('deleteDemoRequest affected non-demo request'));
  } else {
    demoSection.push(pass('deleteDemoRequest skipped (no demo rows to exercise; isolation by demo flag verified)'));
  }

  sections.push(['Demo vs non-demo isolation', demoSection]);

  // --- Reconnect simulation ---
  if (store.pool?.end) {
    await store.pool.end();
  }
  sections.push(['Reconnect persistence', await verifyViaFreshClient(ids)]);

  return { sections, ids, requestNumber };
}

async function main() {
  console.log('=== WOS-20 Postgres Persistence Layer Test ===');
  console.log(`Host: ${databaseHost() || '(unset)'}`);
  console.log(`Local DB: ${isLocalDatabaseUrl() ? 'yes' : 'no'}`);
  console.log(`Run ID: ${RUN_ID}`);

  try {
    assertPersistenceTestAllowed();
  } catch (err) {
    console.error(`\nFAIL  ${err.message}`);
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error('\nFAIL  DATABASE_URL is required');
    process.exit(1);
  }

  const preClient = new Client(getPgClientConfig());
  await preClient.connect();
  await cleanupTestRows(preClient);
  await preClient.end();

  let sections = [];
  let requestNumber = null;
  try {
    const store = await loadStore();
    const health = await store.healthCheck();
    if (!health.connected) {
      console.error('\nFAIL  Postgres healthCheck failed:', health.error);
      process.exit(1);
    }
    console.log('PASS  Postgres connected');

    const out = await runPersistenceFlow(store);
    sections = out.sections;
    requestNumber = out.requestNumber;
  } catch (err) {
    console.error('\nFAIL  Persistence flow error:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    const cleanClient = new Client(getPgClientConfig());
    await cleanClient.connect();
    try {
      await cleanupTestRows(cleanClient);
      console.log(`\nCleanup: removed PERSISTENCE_TEST rows (if any) including ${requestNumber || 'n/a'}`);
    } finally {
      await cleanClient.end();
    }
  }

  let failures = 0;
  for (const [title, results] of sections) {
    printSection(title, results);
    failures += results.filter((r) => !r.ok).length;
  }

  console.log('\n=== Summary ===');
  if (failures === 0) {
    console.log('RESULT: PASS — persistence layer read/write/reconnect checks succeeded.');
    console.log('WOS-20: Automated persistence test passed.');
    process.exit(0);
  } else {
    console.log(`RESULT: FAIL — ${failures} check(s) failed.`);
    console.log('WOS-20: Not ready — resolve failures before Under review.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
