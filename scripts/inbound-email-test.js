/**
 * WOS-24 — Inbound email processing integration test (local Postgres).
 * Usage: npm run inbound-email:test
 */
const { Client } = require('pg');
const {
  loadDbEnv,
  getPgClientConfig,
  isLocalDatabaseUrl,
  databaseHost,
  assertPersistenceTestAllowed,
} = require('./db/env');

loadDbEnv();
process.env.HUB_STORE_MODE = 'postgres';
process.env.HUB_USE_LOCAL_STORE = '0';
process.env.INBOUND_EMAIL_ENABLED = 'true';
process.env.INBOUND_EMAIL_TEST_MODE = 'true';
process.env.SKIP_ASSIGNMENT_NOTIFICATIONS = '1';
process.env.SKIP_REVIEW_NOTIFICATIONS = '1';
process.env.SKIP_SIGNATURE_NOTIFICATIONS = '1';
if (!process.env.EMAIL_NOTIFICATIONS_ENABLED) {
  process.env.EMAIL_NOTIFICATIONS_ENABLED = 'false';
}

const ASSIGNEE = (process.env.WOS24_TEST_ASSIGNEE || 'wos24-assignee@streamlinecorp.com').toLowerCase();
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
  const storePath = require.resolve('../api/lib/hub/db/postgres');
  delete require.cache[storePath];
  delete require.cache[require.resolve('../api/lib/hub/db/index.js')];
  return require('../api/lib/hub/db/postgres');
}

async function loadProcessor() {
  const modPath = require.resolve('../api/lib/hub/inbound-email/processor');
  delete require.cache[modPath];
  delete require.cache[require.resolve('../api/lib/hub/inbound-email/parser.js')];
  return require('../api/lib/hub/inbound-email/processor');
}

async function cleanup(client) {
  await client.query(`DELETE FROM notifications WHERE request_id IN (
    SELECT id FROM requests WHERE title LIKE 'WOS24_INBOUND_TEST%'
  )`);
  await client.query(`DELETE FROM comments WHERE request_id IN (
    SELECT id FROM requests WHERE title LIKE 'WOS24_INBOUND_TEST%'
  )`);
  await client.query(`DELETE FROM audit_events WHERE request_id IN (
    SELECT id FROM requests WHERE title LIKE 'WOS24_INBOUND_TEST%'
  )`);
  await client.query(`DELETE FROM integration_events WHERE request_id IN (
    SELECT id FROM requests WHERE title LIKE 'WOS24_INBOUND_TEST%'
  )`);
  await client.query(`DELETE FROM action_links WHERE request_id IN (
    SELECT id FROM requests WHERE title LIKE 'WOS24_INBOUND_TEST%'
  )`);
  await client.query(`DELETE FROM requests WHERE title LIKE 'WOS24_INBOUND_TEST%'`);
}

async function countAudit(client, requestId, action) {
  const r = await client.query(
    `SELECT COUNT(*)::int AS n FROM audit_events WHERE request_id=$1 AND action=$2`,
    [requestId, action]
  );
  return r.rows[0]?.n || 0;
}

async function verifyReconnect(requestId, messageId) {
  const client = new Client(getPgClientConfig());
  await client.connect();
  try {
    const results = [];
    const comments = await client.query(
      `SELECT COUNT(*)::int AS n FROM comments WHERE request_id=$1`,
      [requestId]
    );
    if ((comments.rows[0]?.n || 0) >= 1) results.push(pass('Reconnect: inbound comment persisted'));
    else results.push(fail('Reconnect: comment missing'));

    const audit = await client.query(
      `SELECT COUNT(*)::int AS n FROM audit_events WHERE request_id=$1 AND action='inbound_email_matched'`,
      [requestId]
    );
    if ((audit.rows[0]?.n || 0) >= 1) results.push(pass('Reconnect: inbound audit persisted'));
    else results.push(fail('Reconnect: audit missing'));

    const integ = await client.query(
      `SELECT COUNT(*)::int AS n FROM integration_events WHERE event_type='inbound_email' AND dedupe_key LIKE $1`,
      [`inbound:test:${messageId}`]
    );
    if ((integ.rows[0]?.n || 0) >= 1) results.push(pass('Reconnect: integration event persisted'));
    else results.push(fail('Reconnect: integration event missing'));

    return results;
  } finally {
    await client.end();
  }
}

async function runTests() {
  const store = await loadStore();
  const { processInboundEmail } = await loadProcessor();
  const sections = [];
  const ids = {};

  const requestNumber = `WO-${String(RUN_ID % 1000000).padStart(6, '0')}`;
  const created = await store.createRequest(
    {
      request_type: 'work_order',
      request_number: requestNumber,
      title: `WOS24_INBOUND_TEST ${RUN_ID}`,
      status: 'in_review',
      assigned_to: ASSIGNEE,
      demo: false,
    },
    'wos24-test@streamlinecorp.com'
  );
  ids.requestId = created.id;

  const matchSection = [];
  const messageId = `wos24-test-msg-${RUN_ID}`;
  const payload = {
    message_id: messageId,
    from: 'external.sender@example.com',
    to: 'hub@streamlinecorp.com',
    subject: `Re: ${requestNumber} — Pump repair update`,
    text: 'Please see my response attached below.\nThanks.',
    html: '',
    received_at: new Date().toISOString(),
    provider: 'test',
  };

  const r1 = await processInboundEmail(payload);
  if (r1.status === 'processed' && r1.comment_id) {
    matchSection.push(pass('Matched inbound email creates comment'));
  } else {
    matchSection.push(fail(`Expected processed, got ${r1.status}: ${r1.reason || r1.error}`));
  }

  const client = new Client(getPgClientConfig());
  await client.connect();
  try {
    const comments = await store.listComments(created.id);
    if (comments.some((c) => c.body.includes('external.sender@example.com'))) {
      matchSection.push(pass('Comment contains sender and body'));
    } else matchSection.push(fail('Comment body missing expected content'));

    if ((await countAudit(client, created.id, 'inbound_email_matched')) >= 1) {
      matchSection.push(pass('inbound_email_matched audit written'));
    } else matchSection.push(fail('Missing inbound_email_matched audit'));

    if ((await countAudit(client, created.id, 'inbound_email_comment_created')) >= 1) {
      matchSection.push(pass('inbound_email_comment_created audit written'));
    } else matchSection.push(fail('Missing inbound_email_comment_created audit'));

    const notif = await client.query(
      `SELECT COUNT(*)::int AS n FROM notifications WHERE request_id=$1 AND type='inbound_email_comment'`,
      [created.id]
    );
    if ((notif.rows[0]?.n || 0) >= 1) {
      matchSection.push(pass('Assignee inbound_email_comment notification created'));
    } else matchSection.push(fail('Missing inbound notification'));

    const integ = await client.query(
      `SELECT COUNT(*)::int AS n FROM integration_events WHERE event_type='inbound_email' AND dedupe_key=$1`,
      [`inbound:test:${messageId}`]
    );
    if ((integ.rows[0]?.n || 0) >= 1) {
      matchSection.push(pass('Integration event logged'));
    } else matchSection.push(fail('Missing integration event'));

    const dup = await processInboundEmail(payload);
    if (dup.status === 'duplicate') {
      matchSection.push(pass('Duplicate message_id skipped'));
    } else matchSection.push(fail(`Expected duplicate, got ${dup.status}`));

    const commentCount = comments.length;
    const commentsAfter = await store.listComments(created.id);
    if (commentsAfter.length === commentCount) {
      matchSection.push(pass('No duplicate comment on reprocess'));
    } else matchSection.push(fail('Duplicate comment created'));

    sections.push(['Matched inbound email', matchSection]);

    const unmatchedSection = [];
    const unmatched = await processInboundEmail({
      message_id: `wos24-unmatched-${RUN_ID}`,
      from: 'unknown@example.com',
      to: 'hub@streamlinecorp.com',
      subject: 'Hello with no reference',
      text: 'No request number here.',
      provider: 'test',
    });
    if (unmatched.status === 'unmatched') {
      unmatchedSection.push(pass('Unmatched email returns unmatched status'));
    } else unmatchedSection.push(fail(`Expected unmatched, got ${unmatched.status}`));

    const unmatchedComments = await store.listComments(created.id);
    if (unmatchedComments.length === commentsAfter.length) {
      unmatchedSection.push(pass('Unmatched email did not mutate request comments'));
    } else unmatchedSection.push(fail('Unmatched email added unexpected comment'));

    sections.push(['Unmatched inbound email', unmatchedSection]);

    const ambiguousSection = [];
    const ambiguous = await processInboundEmail({
      message_id: `wos24-ambiguous-${RUN_ID}`,
      from: 'unknown@example.com',
      to: 'hub@streamlinecorp.com',
      subject: 'Re: WO-000001 and WO-000002',
      text: 'Multiple references',
      provider: 'test',
    });
    if (ambiguous.status === 'ambiguous') {
      ambiguousSection.push(pass('Ambiguous email returns ambiguous status'));
    } else ambiguousSection.push(fail(`Expected ambiguous, got ${ambiguous.status}`));
    sections.push(['Ambiguous inbound email', ambiguousSection]);

    const tokenSection = [];
    const invalidToken = await processInboundEmail({
      message_id: `wos24-invalid-token-${RUN_ID}`,
      from: 'unknown@example.com',
      to: 'hub@streamlinecorp.com',
      subject: 'Sign please',
      text: 'Open http://127.0.0.1:3000/action.html?t=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      provider: 'test',
    });
    if (invalidToken.status === 'invalid_token') {
      tokenSection.push(pass('Invalid action token returns invalid_token status'));
    } else tokenSection.push(fail(`Expected invalid_token, got ${invalidToken.status}`));

    const { link, token } = await store.createActionLink({
      request_id: created.id,
      recipient_email: 'signer@example.com',
      action_type: 'sign',
      expires_in_hours: 24,
    });
    ids.linkId = link.id;
    const tokenPayload = {
      message_id: `wos24-token-match-${RUN_ID}`,
      from: 'signer@example.com',
      to: 'hub@streamlinecorp.com',
      subject: 'Signing response',
      text: `See ${process.env.PORTAL_BASE_URL || 'http://127.0.0.1:3000'}/action.html?t=${token}`,
      provider: 'test',
    };
    const tokenMatch = await processInboundEmail(tokenPayload);
    if (tokenMatch.status === 'processed') {
      tokenSection.push(pass('Valid action token matches request'));
    } else tokenSection.push(fail(`Token match failed: ${tokenMatch.status}`));

    sections.push(['Action token handling', tokenSection]);
  } finally {
    await client.end();
  }

  if (store.pool?.end) await store.pool.end();

  sections.push(['Reconnect persistence', await verifyReconnect(ids.requestId, messageId)]);

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
  console.log('=== WOS-24 Inbound Email Processing Test ===');
  console.log(`Host: ${databaseHost() || '(unset)'}`);
  console.log(`Local DB: ${isLocalDatabaseUrl() ? 'yes' : 'no'}`);
  console.log(`Run ID: ${RUN_ID}`);
  console.log(`INBOUND_EMAIL_TEST_MODE: ${process.env.INBOUND_EMAIL_TEST_MODE}`);

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
  console.log('PASS  All inbound email processing checks passed');
}

main();
