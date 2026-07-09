/**
 * WOS-37 — Hub worker baseline validation (Postgres, once mode).
 */
const crypto = require('crypto');
const { Client } = require('pg');
const { loadDbEnv, getPgClientConfig } = require('./db/env');

loadDbEnv();

process.env.HUB_STORE_MODE = 'postgres';
process.env.HUB_USE_LOCAL_STORE = '0';
process.env.INTEGRATION_DISPATCH_MODE = 'queued';
process.env.EMAIL_DELIVERY_MODE = 'queued';
process.env.EMAIL_NOTIFICATIONS_ENABLED = 'false';
process.env.HUB_WORKER_MODE = 'once';
process.env.HUB_WORKER_ENABLE_INTEGRATIONS = 'true';
process.env.HUB_WORKER_ENABLE_EMAIL = 'true';
process.env.HUB_WORKER_ENABLE_STALE_LOCK_RECOVERY = 'true';

const RUN_ID = Date.now();

function pass(msg) {
  return { ok: true, msg };
}
function fail(msg) {
  return { ok: false, msg };
}

async function loadStore() {
  delete require.cache[require.resolve('../api/lib/hub/db/postgres.js')];
  delete require.cache[require.resolve('../api/lib/hub/worker.js')];
  delete require.cache[require.resolve('../api/lib/hub/integrations.js')];
  delete require.cache[require.resolve('../api/lib/hub/email-delivery.js')];
  return require('../api/lib/hub/db/postgres.js');
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
    const store = await loadStore();
    const worker = require('../api/lib/hub/worker.js');

    requestId = crypto.randomUUID();
    const requestNumber = `WOS37_WORKER_${RUN_ID}`;
    await client.query(
      `INSERT INTO requests (id, request_number, request_type, title, status, requester_email, created_at, updated_at)
       VALUES ($1,$2,'work_order','WOS-37 worker test','submitted','wos37@streamlinecorp.com',now(),now())`,
      [requestId, requestNumber]
    );

    // Isolate this test from pending rows left by notification tests in queued mode.
    await client.query(
      `DELETE FROM outbox_events WHERE status IN ('pending','retrying','processing') AND event_type='email.send'`
    );
    await client.query(
      `DELETE FROM integration_events WHERE status IN ('pending','retrying','processing') AND event_type <> 'inbound_email'`
    );

    const integEv = await store.createIntegrationEvent({
      event_type: 'request.created',
      request_id: requestId,
      dedupe_key: `wos37:integration:${RUN_ID}`,
      payload: { dedupe_key: `wos37:integration:${RUN_ID}`, request_id: requestId, event_type: 'request.created' },
      destination_system: 'n8n',
      source_system: 'wos_hub',
    });
    if (integEv?.status === 'pending') results.push(pass('Seed pending integration event'));
    else results.push(fail('Integration event not pending'));

    const emailEv = await store.queueEmailDeliveryEvent({
      event_type: 'email.send',
      dedupe_key: `email:wos37:${RUN_ID}`,
      request_id: requestId,
      payload: {
        channel: 'assignment',
        request_id: requestId,
        notification_dedupe_key: `wos37:${RUN_ID}`,
        recipient_email: 'wos37@streamlinecorp.com',
        email: {
          to: 'wos37@streamlinecorp.com',
          subject: 'WOS-37 worker test',
          text: 'Worker test body',
        },
        audit: { sent: 'assignment_email_sent', failed: 'assignment_email_failed' },
      },
    });
    if (emailEv?.status === 'pending') results.push(pass('Seed pending email outbox event'));
    else results.push(fail('Email outbox event not pending'));

    const inboundId = crypto.randomUUID();
    await client.query(
      `INSERT INTO integration_events (id, event_type, request_id, payload, status, attempts, dedupe_key, created_at, updated_at, destination_system, source_system)
       VALUES ($1,'inbound_email',$2,'{"reason":"test"}'::jsonb,'processed',0,$3,now(),now(),'inbound_audit','inbound_email')`,
      [inboundId, requestId, `wos37:inbound:${RUN_ID}`]
    );

    const { ticks, lastSummary, config } = await worker.runHubWorker(
      { mode: 'once', workerId: 'wos37-test-worker', batchSize: 20 },
      { shouldStop: () => false }
    );

    if (ticks === 1) results.push(pass('Worker once mode completed one tick'));
    else results.push(fail(`Expected 1 tick, got ${ticks}`));

    if (config.mode === 'once') results.push(pass('Worker config mode is once'));
    else results.push(fail('Worker mode not once'));

    const emailAfter = await client.query(`SELECT status, processed_at FROM outbox_events WHERE id=$1`, [emailEv.id]);
    if (emailAfter.rows[0]?.status === 'processed') {
      results.push(pass('Worker processed queued email delivery event'));
    } else {
      results.push(fail(`Email status after worker: ${emailAfter.rows[0]?.status}`));
    }

    const integAfter = await client.query(
      `SELECT status, last_error, attempts FROM integration_events WHERE id=$1`,
      [integEv.id]
    );
    const integRow = integAfter.rows[0];
    if (
      integRow?.status === 'processed' ||
      integRow?.last_error ||
      (integRow?.attempts || 0) > 0 ||
      integRow?.status === 'retrying'
    ) {
      results.push(pass('Worker attempted queued integration event dispatch'));
    } else {
      results.push(fail(`Integration unchanged after worker: ${JSON.stringify(integRow)}`));
    }

    const staleInteg = await store.createIntegrationEvent({
      event_type: 'request.status_changed',
      request_id: requestId,
      dedupe_key: `wos37:stale-integ:${RUN_ID}`,
      payload: { dedupe_key: `wos37:stale-integ:${RUN_ID}` },
    });
    await client.query(
      `UPDATE integration_events SET status='processing', locked_at=now()-interval '10 minutes', locked_by='stale-test' WHERE id=$1`,
      [staleInteg.id]
    );

    const staleEmail = await store.queueEmailDeliveryEvent({
      event_type: 'email.send',
      dedupe_key: `email:wos37:stale:${RUN_ID}`,
      request_id: requestId,
      payload: {
        channel: 'assignment',
        request_id: requestId,
        email: { to: 'wos37@streamlinecorp.com', subject: 'stale' },
        audit: { sent: 'assignment_email_sent', failed: 'assignment_email_failed' },
      },
    });
    await client.query(
      `UPDATE outbox_events SET status='processing', locked_at=now()-interval '10 minutes', locked_by='stale-test' WHERE id=$1`,
      [staleEmail.id]
    );

    const released = await worker.recoverStaleLocks(config);
    if (released.integration.includes(staleInteg.id)) {
      results.push(pass('Stale integration lock released'));
    } else {
      results.push(fail('Stale integration lock not released'));
    }
    if (released.email.includes(staleEmail.id)) {
      results.push(pass('Stale email lock released'));
    } else {
      results.push(fail('Stale email lock not released'));
    }

    const staleIntegAfter = await client.query(`SELECT status, locked_at FROM integration_events WHERE id=$1`, [
      staleInteg.id,
    ]);
    if (staleIntegAfter.rows[0]?.status === 'pending' && !staleIntegAfter.rows[0]?.locked_at) {
      results.push(pass('Released integration event returned to pending'));
    } else {
      results.push(fail('Released integration event state incorrect'));
    }

    const staleEmailAfter = await client.query(`SELECT status, locked_at FROM outbox_events WHERE id=$1`, [
      staleEmail.id,
    ]);
    if (staleEmailAfter.rows[0]?.status === 'pending' && !staleEmailAfter.rows[0]?.locked_at) {
      results.push(pass('Released email event returned to pending'));
    } else {
      results.push(fail('Released email event state incorrect'));
    }

    const pendingInbound = crypto.randomUUID();
    await client.query(
      `INSERT INTO integration_events (id, event_type, request_id, payload, status, attempts, dedupe_key, created_at, updated_at)
       VALUES ($1,'inbound_email',$2,'{}'::jsonb,'pending',0,$3,now(),now())`,
      [pendingInbound, requestId, `wos37:inbound-pending:${RUN_ID}`]
    );
    await worker.runWorkerTick({ ...config, batchSize: 20, enableStaleLockRecovery: true });
    const pendingInboundAfter = await client.query(`SELECT status, locked_by FROM integration_events WHERE id=$1`, [
      pendingInbound,
    ]);
    if (pendingInboundAfter.rows[0]?.status === 'pending' && !pendingInboundAfter.rows[0]?.locked_by) {
      results.push(pass('Worker does not claim inbound_email delivery events'));
    } else {
      results.push(fail('Worker incorrectly claimed inbound_email event'));
    }

    const inboundAfter = await client.query(`SELECT status FROM integration_events WHERE id=$1`, [inboundId]);
    if (inboundAfter.rows[0]?.status === 'processed') {
      results.push(pass('Inbound email audit event not modified by worker'));
    } else {
      results.push(fail(`Inbound email event status changed: ${inboundAfter.rows[0]?.status}`));
    }

    const failEmail = await store.queueEmailDeliveryEvent({
      event_type: 'email.send',
      dedupe_key: `email:wos37:fail:${RUN_ID}`,
      request_id: requestId,
      payload: {
        channel: 'assignment',
        request_id: requestId,
        email: { to: '', subject: 'fail' },
        audit: { sent: 'assignment_email_sent', failed: 'assignment_email_failed' },
      },
    });
    await worker.runWorkerTick({ ...config, batchSize: 20 });
    const failAfter = await client.query(`SELECT status FROM outbox_events WHERE id=$1`, [failEmail.id]);
    if (failAfter.rows[0]?.status === 'processed') {
      results.push(pass('No-recipient email marked processed (dev skip path)'));
    } else {
      results.push(fail(`Unexpected fail email status: ${failAfter.rows[0]?.status}`));
    }

    if (lastSummary?.integration?.length >= 0 && lastSummary?.email?.length >= 0) {
      results.push(pass('Worker tick returned integration and email summaries'));
    } else {
      results.push(fail('Worker tick summary missing'));
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

  console.log('=== WOS-37 Hub Worker Test ===');
  let failures = 0;
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.msg}`);
    if (!r.ok) failures += 1;
  }
  console.log('\n=== Summary ===');
  if (failures === 0) {
    console.log('RESULT: PASS — hub worker baseline checks succeeded.');
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
