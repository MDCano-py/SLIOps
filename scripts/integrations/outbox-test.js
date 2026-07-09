/**
 * WOS-35 — Integration events outbox foundation tests (Postgres).
 */
const crypto = require('crypto');
const { Client } = require('pg');
const { loadDbEnv, getPgClientConfig } = require('../db/env');

loadDbEnv();

const RUN_ID = `WOS35_OUTBOX_${Date.now()}`;
const TEST_EMAIL = 'wos35-outbox-test@streamlinecorp.com';

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
  if ((process.env.HUB_STORE_MODE || '').toLowerCase() !== 'postgres') {
    console.warn('WARN  HUB_STORE_MODE should be postgres for outbox tests');
  }

  delete require.cache[require.resolve('../../api/lib/hub/db/postgres.js')];
  delete require.cache[require.resolve('../../api/lib/hub/integration-events.js')];
  delete require.cache[require.resolve('../../api/lib/hub/integrations.js')];

  const store = require('../../api/lib/hub/db/postgres.js');
  const integrationEvents = require('../../api/lib/hub/integration-events.js');

  const client = new Client(getPgClientConfig(url));
  await client.connect();

  const results = [];
  let requestId = null;
  let eventIds = [];

  try {
    requestId = crypto.randomUUID();
    const requestNumber = `WOS35-${Date.now()}`;
    await client.query(
      `INSERT INTO requests (id, request_number, request_type, title, status, requester_email, created_at, updated_at)
       VALUES ($1,$2,'work_order','Outbox test','submitted',$3,now(),now())`,
      [requestId, requestNumber, TEST_EMAIL]
    );
    results.push(pass('Seed request for outbox test'));

    const dedupeKey = `${RUN_ID}:dedupe`;
    const ev1 = await store.createIntegrationEvent({
      event_type: 'persistence.test',
      request_id: requestId,
      dedupe_key: dedupeKey,
      payload: { run_id: RUN_ID, action_token: 'secret-token-should-redact' },
      destination_system: 'n8n',
      source_system: 'wos_hub',
    });
    eventIds.push(ev1.id);
    if (ev1?.id && ev1.status === 'pending') results.push(pass('createIntegrationEvent inserts pending row'));
    else results.push(fail('createIntegrationEvent did not return pending row'));

    if (ev1.payload?.action_token === '[redacted]') {
      results.push(pass('sanitizeIntegrationPayload redacts secrets'));
    } else {
      results.push(fail(`payload secret not redacted: ${ev1.payload?.action_token}`));
    }

    const evDup = await store.createIntegrationEvent({
      event_type: 'persistence.test',
      request_id: requestId,
      dedupe_key: dedupeKey,
      payload: { run_id: RUN_ID, duplicate: true },
    });
    if (evDup?.dedupe_hit && evDup.id === ev1.id) {
      results.push(pass('duplicate dedupe_key returns existing event (no duplicate row)'));
    } else {
      results.push(fail('dedupe_key did not prevent duplicate unsafe insert'));
    }

    const colRes = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='integration_events'`
    );
    const cols = new Set(colRes.rows.map((r) => r.column_name));
    for (const col of [
      'next_attempt_at',
      'locked_at',
      'locked_by',
      'processed_at',
      'last_attempt_at',
      'source_system',
      'destination_system',
    ]) {
      if (cols.has(col)) results.push(pass(`migration column present: ${col}`));
      else results.push(fail(`missing migration column: ${col}`));
    }

    const failed = await store.markIntegrationEventFailed(ev1.id, 'simulated dispatch failure');
    if (failed?.status === 'retrying' && failed.attempts === 1 && failed.next_attempt_at) {
      results.push(pass('markIntegrationEventFailed sets retrying + next_attempt_at'));
    } else {
      results.push(fail(`retry metadata unexpected: status=${failed?.status} attempts=${failed?.attempts}`));
    }

    const processed = await store.markIntegrationEventProcessed(ev1.id, { status: 'processed' });
    if (processed?.status === 'processed' && processed.processed_at) {
      results.push(pass('markIntegrationEventProcessed sets processed_at'));
    } else {
      results.push(fail('markIntegrationEventProcessed failed'));
    }

    const staleEv = await store.createIntegrationEvent({
      event_type: 'request.created',
      request_id: requestId,
      dedupe_key: `${RUN_ID}:stale-lock`,
      payload: { run_id: RUN_ID },
    });
    eventIds.push(staleEv.id);
    await client.query(
      `UPDATE integration_events SET status='processing', locked_at=now()-interval '10 minutes', locked_by='test-worker' WHERE id=$1`,
      [staleEv.id]
    );
    const released = await store.releaseStaleIntegrationEventLocks(60_000);
    if (released.includes(staleEv.id)) {
      results.push(pass('releaseStaleIntegrationEventLocks releases stale processing lock'));
    } else {
      results.push(fail(`stale lock not released: ${JSON.stringify(released)}`));
    }
    const afterRelease = await client.query(`SELECT status, locked_at FROM integration_events WHERE id=$1`, [
      staleEv.id,
    ]);
    if (afterRelease.rows[0]?.status === 'pending' && !afterRelease.rows[0]?.locked_at) {
      results.push(pass('released event returned to pending'));
    } else {
      results.push(fail('released event state incorrect'));
    }
    await store.markIntegrationEventProcessed(staleEv.id, { status: 'processed' });

    const claimEv = await store.createIntegrationEvent({
      event_type: `wos35.claim.${RUN_ID}`,
      request_id: requestId,
      dedupe_key: `${RUN_ID}:claim`,
      payload: { run_id: RUN_ID },
    });
    eventIds.push(claimEv.id);
    const claimed = await store.claimIntegrationEvents({
      limit: 5,
      workerId: 'wos35-test-worker',
      eventTypes: [`wos35.claim.${RUN_ID}`],
    });
    const claimedRow = claimed.find((row) => row.id === claimEv.id);
    if (claimedRow && claimedRow.status === 'processing' && claimedRow.locked_by === 'wos35-test-worker') {
      results.push(pass('claimIntegrationEvents uses SKIP LOCKED claim'));
    } else {
      results.push(
        fail(
          `claimIntegrationEvents did not claim pending event (claimed=${claimed.length}, target=${claimEv.id})`
        )
      );
    }

    process.env.INTEGRATION_DISPATCH_MODE = 'queued';
    delete require.cache[require.resolve('../../api/lib/hub/integrations.js')];
    const integrations = require('../../api/lib/hub/integrations.js');
    const reqRow = (await client.query(`SELECT * FROM requests WHERE id=$1`, [requestId])).rows[0];
    const queued = await integrations.queueN8nEvent('request.created', reqRow, { wos35: true });
    if (queued?.queued || queued?.status === 'pending') {
      results.push(pass('queueN8nEvent queued mode persists without requiring inline dispatch'));
    } else {
      results.push(fail(`queued mode unexpected result: ${JSON.stringify({ queued: queued?.queued, status: queued?.status })}`));
    }
    if (integrationEvents.getIntegrationDispatchMode() === 'queued') {
      results.push(pass('INTEGRATION_DISPATCH_MODE=queued honored'));
    } else {
      results.push(fail('INTEGRATION_DISPATCH_MODE not queued'));
    }
  } catch (err) {
    results.push(fail(`Unexpected error: ${err.message}`));
  } finally {
    if (requestId) {
      await client.query(`DELETE FROM integration_events WHERE request_id=$1`, [requestId]).catch(() => {});
      await client.query(`DELETE FROM requests WHERE id=$1`, [requestId]).catch(() => {});
    }
    await client.end();
  }

  console.log('=== WOS-35 Integration Outbox Test ===');
  let failures = 0;
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.msg}`);
    if (!r.ok) failures += 1;
  }
  console.log('\n=== Summary ===');
  if (failures === 0) {
    console.log('RESULT: PASS — outbox foundation checks succeeded.');
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
