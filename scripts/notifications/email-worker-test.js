/**
 * WOS-36 — Notification email delivery outbox tests (Postgres).
 */
const crypto = require('crypto');
const { Client } = require('pg');
const { loadDbEnv, getPgClientConfig } = require('../db/env');

loadDbEnv();
process.env.HUB_STORE_MODE = 'postgres';
process.env.HUB_USE_LOCAL_STORE = '0';
process.env.EMAIL_NOTIFICATIONS_ENABLED = 'false';
process.env.SKIP_REVIEW_NOTIFICATIONS = '0';
process.env.SKIP_SIGNATURE_NOTIFICATIONS = '0';

const RUN_ID = Date.now();
const TEST_EMAIL = 'wos36-email-worker@streamlinecorp.com';

function pass(msg) {
  return { ok: true, msg };
}
function fail(msg) {
  return { ok: false, msg };
}

async function loadStore() {
  delete require.cache[require.resolve('../../api/lib/hub/db/postgres.js')];
  return require('../../api/lib/hub/db/postgres.js');
}

async function loadModules() {
  delete require.cache[require.resolve('../../api/lib/hub/notifications/assignment-notifications.js')];
  delete require.cache[require.resolve('../../api/lib/hub/notifications/review-notifications.js')];
  delete require.cache[require.resolve('../../api/lib/hub/notifications/signature-notifications.js')];
  delete require.cache[require.resolve('../../api/lib/hub/email-delivery.js')];
  return {
    assignment: require('../../api/lib/hub/notifications/assignment-notifications.js'),
    review: require('../../api/lib/hub/notifications/review-notifications.js'),
    signature: require('../../api/lib/hub/notifications/signature-notifications.js'),
    emailDelivery: require('../../api/lib/hub/email-delivery.js'),
  };
}

async function countOutbox(client, requestId, channel) {
  const r = await client.query(
    `SELECT COUNT(*)::int AS n FROM outbox_events
     WHERE request_id=$1 AND payload->>'channel'=$2`,
    [requestId, channel]
  );
  return r.rows[0]?.n || 0;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const client = new Client(getPgClientConfig(url));
  await client.connect();
  const results = [];
  let requestId = null;

  try {
    process.env.EMAIL_DELIVERY_MODE = 'inline';
    const store = await loadStore();
    const mods = await loadModules();

    requestId = crypto.randomUUID();
    const requestNumber = `WOS36_EMAIL_${RUN_ID}`;
    await client.query(
      `INSERT INTO requests (id, request_number, request_type, title, status, assigned_to_email, requester_email, created_at, updated_at)
       VALUES ($1,$2,'work_order','WOS-36 email worker test','submitted',$3,$3,now(),now())`,
      [requestId, requestNumber, TEST_EMAIL]
    );

    const request = (await client.query(`SELECT * FROM requests WHERE id=$1`, [requestId])).rows[0];

    const assignResult = await mods.assignment.notifyRequestAssignment({
      request,
      previousAssignee: null,
      actorEmail: 'wos36-test@streamlinecorp.com',
    });
    if (assignResult.ok) results.push(pass('Assignment notification triggers email queue path'));
    else results.push(fail(`Assignment notify failed: ${assignResult.reason || assignResult.error}`));

    const assignOutbox = await countOutbox(client, requestId, 'assignment');
    if (assignOutbox >= 1) results.push(pass('Assignment email queues outbox_events row'));
    else results.push(fail(`Missing assignment outbox row (count=${assignOutbox})`));

    const step = await store.saveWorkflowStep({
      request_id: requestId,
      step_order: 1,
      step_type: 'review',
      action_type: 'review',
      step_title: 'WOS-36 review',
      assigned_to_email: TEST_EMAIL,
      status: 'waiting',
    });

    process.env.SKIP_ASSIGNMENT_NOTIFICATIONS = '1';
    delete require.cache[require.resolve('../../api/lib/hub/notifications/review-notifications.js')];
    const reviewMod = require('../../api/lib/hub/notifications/review-notifications.js');

    const reviewResult = await reviewMod.notifyWorkflowStepReview({
      request,
      step,
      previousReviewer: null,
      previousStatus: 'not_started',
      actorEmail: 'wos36-test@streamlinecorp.com',
    });
    if (reviewResult.ok) results.push(pass('Review notification triggers email queue path'));
    else results.push(fail(`Review notify failed: ${reviewResult.reason || reviewResult.error}`));

    const reviewOutbox = await countOutbox(client, requestId, 'review');
    if (reviewOutbox >= 1) results.push(pass('Review email queues outbox_events row'));
    else results.push(fail(`Missing review outbox row (count=${reviewOutbox})`));

    const signStep = await store.saveWorkflowStep({
      request_id: requestId,
      step_order: 2,
      step_type: 'sign',
      action_type: 'sign',
      step_title: 'WOS-36 sign',
      assigned_to_email: TEST_EMAIL,
      status: 'waiting',
      requires_signature: true,
    });

    process.env.SKIP_REVIEW_NOTIFICATIONS = '1';
    delete require.cache[require.resolve('../../api/lib/hub/notifications/signature-notifications.js')];
    const sigMod = require('../../api/lib/hub/notifications/signature-notifications.js');

    const { link } = await store.createActionLink({
      request_id: requestId,
      workflow_step_id: signStep.id,
      recipient_email: TEST_EMAIL,
      action_type: 'sign',
      expires_in_hours: 24,
    });

    const sigResult = await sigMod.notifySignatureActionLink({
      request,
      step: signStep,
      link,
      actionLinkUrl: `http://127.0.0.1:3000/action.html?t=[test]`,
      actorEmail: 'wos36-test@streamlinecorp.com',
    });
    if (sigResult.ok) results.push(pass('Signature notification triggers email queue path'));
    else results.push(fail(`Signature notify failed: ${sigResult.reason || sigResult.error}`));

    const sigOutbox = await countOutbox(client, requestId, 'signature');
    if (sigOutbox >= 1) results.push(pass('Signature email queues outbox_events row'));
    else results.push(fail(`Missing signature outbox row (count=${sigOutbox})`));

    const processed = await client.query(
      `SELECT COUNT(*)::int AS n FROM outbox_events WHERE request_id=$1 AND status='processed'`,
      [requestId]
    );
    if ((processed.rows[0]?.n || 0) >= 1) {
      results.push(pass('Inline mode marks at least one email delivery processed'));
    } else {
      results.push(fail('Inline mode did not mark processed rows'));
    }

    const dupDedupe = mods.emailDelivery.buildEmailDedupeKey(`assignment:request:${requestId}:${TEST_EMAIL}:dup-test`);
    const ev1 = await store.queueEmailDeliveryEvent({
      event_type: 'email.send',
      dedupe_key: dupDedupe,
      request_id: requestId,
      payload: {
        channel: 'assignment',
        request_id: requestId,
        notification_dedupe_key: `assignment:request:${requestId}:${TEST_EMAIL}:dup-test`,
        recipient_email: TEST_EMAIL,
        email: { to: TEST_EMAIL, subject: 'dup', text: 'dup' },
        audit: { sent: 'assignment_email_sent', failed: 'assignment_email_failed' },
      },
    });
    const ev2 = await store.queueEmailDeliveryEvent({
      event_type: 'email.send',
      dedupe_key: dupDedupe,
      request_id: requestId,
      payload: { channel: 'assignment', email: { to: TEST_EMAIL, subject: 'dup2' } },
    });
    if (ev2?.dedupe_hit && ev2.id === ev1.id) {
      results.push(pass('Duplicate email dedupe_key does not create duplicate row'));
    } else {
      results.push(fail('Email dedupe_key did not prevent duplicate insert'));
    }

    const retryEv = await store.queueEmailDeliveryEvent({
      event_type: 'email.send',
      dedupe_key: `email:wos36-retry:${RUN_ID}`,
      request_id: requestId,
      payload: {
        channel: 'assignment',
        request_id: requestId,
        notification_dedupe_key: `wos36-retry:${RUN_ID}`,
        email: { to: TEST_EMAIL, subject: 'retry test' },
        audit: { sent: 'assignment_email_sent', failed: 'assignment_email_failed' },
      },
    });
    const failed = await store.markEmailDeliveryFailed(retryEv.id, 'simulated provider failure');
    if (failed?.status === 'retrying' && failed.next_attempt_at) {
      results.push(pass('Failed delivery marks retrying with next_attempt_at'));
    } else {
      results.push(fail(`Retry state unexpected: ${failed?.status}`));
    }

    let dead = failed;
    for (let i = 0; i < 10; i++) {
      dead = await store.markEmailDeliveryFailed(retryEv.id, 'simulated provider failure');
      if (dead?.status === 'dead_lettered') break;
    }
    if (dead?.status === 'dead_lettered') {
      results.push(pass('Max attempts marks dead_lettered'));
    } else {
      results.push(fail(`Expected dead_lettered, got ${dead?.status}`));
    }

    process.env.EMAIL_DELIVERY_MODE = 'queued';
    process.env.SKIP_ASSIGNMENT_NOTIFICATIONS = '0';
    delete require.cache[require.resolve('../../api/lib/hub/email-delivery.js')];
    delete require.cache[require.resolve('../../api/lib/hub/notifications/assignment-notifications.js')];
    const queuedAssignment = require('../../api/lib/hub/notifications/assignment-notifications.js');
    const queuedReq = (await client.query(`SELECT * FROM requests WHERE id=$1`, [requestId])).rows[0];
    const beforeQueued = await client.query(
      `SELECT COUNT(*)::int AS n FROM outbox_events WHERE request_id=$1 AND status='pending'`,
      [requestId]
    );
    await queuedAssignment.notifyRequestAssignment({
      request: {
        ...queuedReq,
        assigned_to_email: 'wos36-queued-b@streamlinecorp.com',
        assigned_to: 'wos36-queued-b@streamlinecorp.com',
        updated_at: new Date().toISOString(),
      },
      previousAssignee: TEST_EMAIL,
      actorEmail: 'wos36-test@streamlinecorp.com',
    });
    const afterQueued = await client.query(
      `SELECT COUNT(*)::int AS n FROM outbox_events WHERE request_id=$1 AND status='pending'`,
      [requestId]
    );
    if ((afterQueued.rows[0]?.n || 0) > (beforeQueued.rows[0]?.n || 0)) {
      results.push(pass('Queued mode leaves pending outbox_events without inline send'));
    } else {
      results.push(fail('Queued mode did not increase pending outbox count'));
    }

    await store.releaseStaleEmailDeliveryLocks(1000);
    const lockEv = await store.queueEmailDeliveryEvent({
      event_type: 'email.send',
      dedupe_key: `email:wos36-lock:${RUN_ID}`,
      request_id: requestId,
      payload: {
        channel: 'assignment',
        request_id: requestId,
        email: { to: TEST_EMAIL, subject: 'lock test' },
        audit: { sent: 'assignment_email_sent', failed: 'assignment_email_failed' },
      },
    });
    await client.query(
      `UPDATE outbox_events SET status='processing', locked_at=now()-interval '10 minutes', locked_by='test' WHERE id=$1`,
      [lockEv.id]
    );
    const released = await store.releaseStaleEmailDeliveryLocks(60_000);
    if (released.includes(lockEv.id)) results.push(pass('releaseStaleEmailDeliveryLocks works'));
    else results.push(fail('Stale email lock not released'));
  } catch (err) {
    results.push(fail(`Unexpected error: ${err.message}`));
  } finally {
    if (requestId) {
      await client.query(`DELETE FROM outbox_events WHERE request_id=$1`, [requestId]).catch(() => {});
      await client.query(`DELETE FROM notifications WHERE request_id=$1`, [requestId]).catch(() => {});
      await client.query(`DELETE FROM audit_events WHERE request_id=$1`, [requestId]).catch(() => {});
      await client.query(`DELETE FROM action_links WHERE request_id=$1`, [requestId]).catch(() => {});
      await client.query(`DELETE FROM workflow_steps WHERE request_id=$1`, [requestId]).catch(() => {});
      await client.query(`DELETE FROM requests WHERE id=$1`, [requestId]).catch(() => {});
    }
    await client.end();
  }

  console.log('=== WOS-36 Notification Email Delivery Worker Test ===');
  let failures = 0;
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.msg}`);
    if (!r.ok) failures += 1;
  }
  console.log('\n=== Summary ===');
  if (failures === 0) {
    console.log('RESULT: PASS — email delivery outbox checks succeeded.');
    process.exit(0);
  } else {
    console.log(`RESULT: FAIL — ${failures} check(s) failed.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
