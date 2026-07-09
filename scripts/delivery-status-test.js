/**
 * WOS-40 — Admin delivery status endpoint validation.
 */
const crypto = require('crypto');
const { Client } = require('pg');
const { loadDbEnv, getPgClientConfig } = require('./db/env');

loadDbEnv();
process.env.HUB_STORE_MODE = 'postgres';
process.env.HUB_USE_LOCAL_STORE = '0';
process.env.INTEGRATION_DISPATCH_MODE = 'queued';
process.env.EMAIL_DELIVERY_MODE = 'queued';

const RUN_ID = Date.now();

function pass(msg) {
  return { ok: true, msg };
}
function fail(msg) {
  return { ok: false, msg };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  delete require.cache[require.resolve('../api/lib/hub/db/postgres.js')];
  delete require.cache[require.resolve('../api/lib/hub/delivery-status.js')];

  const store = require('../api/lib/hub/db/postgres.js');
  const deliveryStatus = require('../api/lib/hub/delivery-status.js');

  const client = new Client(getPgClientConfig(url));
  await client.connect();
  const results = [];
  let requestId = null;

  try {
    requestId = crypto.randomUUID();
    await client.query(
      `INSERT INTO requests (id, request_number, request_type, title, status, requester_email, created_at, updated_at)
       VALUES ($1,$2,'work_order','WOS-40 delivery status test','submitted','wos40@streamlinecorp.com',now(),now())`,
      [requestId, `WOS40_${RUN_ID}`]
    );

    await store.createIntegrationEvent({
      event_type: 'request.created',
      request_id: requestId,
      dedupe_key: `wos40:integ-dead:${RUN_ID}`,
      payload: {
        dedupe_key: `wos40:integ-dead:${RUN_ID}`,
        action_token: 'secret-should-not-appear',
        request_id: requestId,
      },
      destination_system: 'n8n',
    });
    const integRow = await client.query(
      `SELECT id FROM integration_events WHERE dedupe_key=$1`,
      [`wos40:integ-dead:${RUN_ID}`]
    );
    await client.query(
      `UPDATE integration_events SET status='dead_lettered', last_error='simulated n8n failure', last_attempt_at=now(), attempts=8 WHERE id=$1`,
      [integRow.rows[0].id]
    );

    await store.queueEmailDeliveryEvent({
      event_type: 'email.send',
      dedupe_key: `email:wos40:fail:${RUN_ID}`,
      request_id: requestId,
      payload: {
        channel: 'signature',
        request_id: requestId,
        recipient_email: 'signer@example.com',
        notification_id: crypto.randomUUID(),
        action_link_url: 'http://127.0.0.1:3000/action.html?t=raw-token-must-redact',
        action_link_id: crypto.randomUUID(),
        email: { to: 'signer@example.com', subject: 'Sign please', text: 'body' },
        audit: { sent: 'signature_email_sent', failed: 'signature_email_failed' },
      },
    });
    const emailRow = await client.query(`SELECT id FROM outbox_events WHERE dedupe_key=$1`, [
      `email:wos40:fail:${RUN_ID}`,
    ]);
    await client.query(
      `UPDATE outbox_events SET status='retrying', last_error='Resend HTTP 502', last_attempt_at=now(), attempts=2 WHERE id=$1`,
      [emailRow.rows[0].id]
    );

    await store.queueEmailDeliveryEvent({
      event_type: 'email.send',
      dedupe_key: `email:wos40:pending:${RUN_ID}`,
      request_id: requestId,
      payload: {
        channel: 'assignment',
        request_id: requestId,
        recipient_email: 'assignee@example.com',
        email: { to: 'assignee@example.com', subject: 'Pending', text: 'x' },
        audit: { sent: 'assignment_email_sent', failed: 'assignment_email_failed' },
      },
    });

    const summary = await deliveryStatus.getDeliveryStatusSummary(store, { limit: 5 });

    if (summary.ok) results.push(pass('getDeliveryStatusSummary returns ok'));
    else results.push(fail('summary not ok'));

    if (summary.integration_events?.dead_lettered >= 1) {
      results.push(pass('Integration dead_lettered count present'));
    } else {
      results.push(fail(`Expected dead_lettered >= 1, got ${summary.integration_events?.dead_lettered}`));
    }

    if (summary.email_delivery?.pending >= 1 && summary.email_delivery?.retrying >= 1) {
      results.push(pass('Email pending and retrying counts present'));
    } else {
      results.push(
        fail(
          `Email counts unexpected pending=${summary.email_delivery?.pending} retrying=${summary.email_delivery?.retrying}`
        )
      );
    }

    const integFail = summary.integration_events?.recent_failures?.[0];
    if (integFail?.last_error?.includes('n8n')) {
      results.push(pass('Recent integration failure includes error context'));
    } else {
      results.push(fail('Missing integration failure row'));
    }

    if (integFail && !JSON.stringify(integFail).includes('secret-should-not-appear')) {
      results.push(pass('Integration failure row excludes raw payload secrets'));
    } else {
      results.push(fail('Integration failure exposed secrets'));
    }

    const emailFail = summary.email_delivery?.recent_failures?.find((r) => r.channel === 'signature');
    if (emailFail?.recipient_email === 'signer@example.com') {
      results.push(pass('Email failure includes recipient (sanitized)'));
    } else {
      results.push(fail('Missing email failure row'));
    }

    const emailJson = JSON.stringify(emailFail || {});
    if (!emailJson.includes('raw-token-must-redact') && !emailJson.includes('action_link_url')) {
      results.push(pass('Email failure excludes action link tokens'));
    } else {
      results.push(fail('Email failure exposed action link token'));
    }

    if (summary.worker?.integration_dispatch_mode === 'queued') {
      results.push(pass('Worker config summary included'));
    } else {
      results.push(fail('Worker config missing or wrong'));
    }

    await client.query(
      `INSERT INTO integration_events (id, event_type, request_id, payload, status, attempts, dedupe_key, created_at, updated_at)
       VALUES ($1,'inbound_email',$2,'{}'::jsonb,'processed',0,$3,now(),now())`,
      [crypto.randomUUID(), requestId, `wos40:inbound:${RUN_ID}`]
    );
    const summary2 = await deliveryStatus.getDeliveryStatusSummary(store, { limit: 5 });
    const inboundInFailures = (summary2.integration_events?.recent_failures || []).some(
      (r) => r.event_type === 'inbound_email'
    );
    if (!inboundInFailures) {
      results.push(pass('Inbound email audit events excluded from integration failures'));
    } else {
      results.push(fail('Inbound email incorrectly listed in failures'));
    }
  } catch (err) {
    results.push(fail(`Unexpected error: ${err.message}`));
  } finally {
    if (requestId) {
      await client.query(`DELETE FROM outbox_events WHERE request_id=$1`, [requestId]).catch(() => {});
      await client.query(`DELETE FROM integration_events WHERE request_id=$1`, [requestId]).catch(() => {});
      await client.query(`DELETE FROM requests WHERE id=$1`, [requestId]).catch(() => {});
    }
    await client.end();
  }

  console.log('=== WOS-40 Delivery Status Test ===');
  let failures = 0;
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.msg}`);
    if (!r.ok) failures += 1;
  }
  console.log('\n=== Summary ===');
  if (failures === 0) {
    console.log('RESULT: PASS — delivery status checks succeeded.');
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
