#!/usr/bin/env node
/**
 * WOS-52 RDS / staging cutover smoke validation (no secrets in output).
 * Usage: npm run rds-staging-smoke:test
 *
 * On EC2: ensure .env.staging has real DATABASE_URL + PGSSLMODE=require
 * Optional: DATABASE_URL_CONFIRM_PERSISTENCE_TEST=1 for write checks on RDS
 *
 * IMPORTANT: loadDbEnv() must run before requiring hub modules that touch the
 * store (notifications → email-delivery → hub store). Otherwise the hub store
 * can bind to local_json/redis before HUB_STORE_MODE=postgres is applied and
 * outbox rows never land in Postgres outbox_events.
 */
const { Client } = require('pg');
const http = require('http');
const { loadDbEnv, getPgClientConfig, databaseHost, isLocalDatabaseUrl } = require('./db/env');

// Load staging/local env BEFORE hub store consumers are required.
loadDbEnv();

process.env.EMAIL_NOTIFICATIONS_ENABLED = process.env.EMAIL_NOTIFICATIONS_ENABLED || 'false';
process.env.EMAIL_DELIVERY_MODE = process.env.EMAIL_DELIVERY_MODE || 'queued';
process.env.VENDOR_NOTIFY_EMAIL_ADMIN = process.env.VENDOR_NOTIFY_EMAIL_ADMIN || 'smoke-rebekah@test.local';
process.env.VENDOR_NOTIFY_EMAIL_AP = process.env.VENDOR_NOTIFY_EMAIL_AP || 'smoke-ap@test.local';
process.env.VENDOR_NOTIFY_EMAIL_LEGAL = process.env.VENDOR_NOTIFY_EMAIL_LEGAL || 'smoke-dylan@test.local';
process.env.HUB_STORE_MODE = process.env.HUB_STORE_MODE || 'postgres';
process.env.VENDOR_STORE_MODE = process.env.VENDOR_STORE_MODE || process.env.HUB_STORE_MODE;
process.env.HUB_USE_LOCAL_STORE = process.env.HUB_USE_LOCAL_STORE || '0';

const { buildVendorRecordFromBody } = require('../api/lib/vendor/record');
const {
  applyVendorWorkflowTransition,
  attachWorkflowFields,
} = require('../api/lib/vendor/workflow');
const { enrichVendorRecord } = require('../api/lib/vendor/documents');
const { notifyVendorWorkflowEvent } = require('../api/lib/vendor/notifications');
const { countByQueue } = require('../vendor-dashboard-queues');
const { evaluateVendorDetailUi } = require('../api/lib/rbac/vendor-ui-perms');
const { getHubStoreMode, resetHubStoreForTests } = require('../api/lib/hub/db/index.js');

// Ensure any prior eager bind from other requires is cleared; first store use
// after env load must see postgres.
resetHubStoreForTests();

const EXPECTED_MIGRATIONS = [
  '001_init.sql',
  '002_hub_extras.sql',
  '003_workflow_step_action_types.sql',
  '004_integration_events_outbox.sql',
  '005_outbox_events_email_delivery.sql',
  '006_vendor_master.sql',
  '007_form_template_versions.sql',
];

let passed = 0;
let failed = 0;
const issues = [];
const audit = {
  host: null,
  is_local: null,
  env: {},
  migrations: [],
  pm2: 'not_checked_on_workstation',
  health: null,
};

function assert(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    const msg = detail ? `${name}: ${detail}` : name;
    issues.push(msg);
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function redactEnv() {
  const keys = [
    'NODE_ENV',
    'HUB_STORE_MODE',
    'VENDOR_STORE_MODE',
    'PGSSLMODE',
    'INTEGRATION_DISPATCH_MODE',
    'EMAIL_DELIVERY_MODE',
    'EMAIL_NOTIFICATIONS_ENABLED',
    'HUB_WORKER_MODE',
    'HUB_WORKER_ENABLE_INTEGRATIONS',
    'HUB_WORKER_ENABLE_EMAIL',
    'PORTAL_BASE_URL',
    'DATABASE_URL',
    'RESEND_API_KEY',
    'ENTRA_CLIENT_SECRET',
    'BLOB_READ_WRITE_TOKEN',
    'S3_BUCKET',
    'STORAGE_DRIVER',
    'SESSION_SECRET',
  ];
  for (const k of keys) {
    const v = process.env[k];
    if (v === undefined || v === '') {
      audit.env[k] = v === '' ? '(empty)' : '(unset)';
    } else if (k === 'DATABASE_URL') {
      audit.env[k] = `postgresql://***@${databaseHost() || 'unknown-host'}/***`;
    } else if (/SECRET|KEY|TOKEN|PASSWORD/i.test(k)) {
      audit.env[k] = '(set, redacted)';
    } else {
      audit.env[k] = v;
    }
  }
  audit.host = databaseHost() || 'unknown';
  audit.is_local = isLocalDatabaseUrl();
}

async function checkMigrations(client) {
  const r = await client.query('SELECT id, applied_at FROM schema_migrations ORDER BY id');
  audit.migrations = r.rows.map((row) => row.id);
  for (const id of EXPECTED_MIGRATIONS) {
    assert(`migration applied: ${id}`, audit.migrations.includes(id));
  }
}

async function checkTables(client) {
  const tables = ['vendor_master', 'outbox_events', 'integration_events', 'schema_migrations'];
  for (const t of tables) {
    const r = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
      [t]
    );
    assert(`table exists: ${t}`, r.rowCount > 0);
  }
}

async function vendorWorkflowSmoke(client) {
  assert(
    'hub store mode postgres before outbox enqueue',
    getHubStoreMode() === 'postgres',
    `got ${getHubStoreMode()}`
  );

  const ref = `VEN-SMOKE-${Date.now()}`;
  let record = buildVendorRecordFromBody(
    { companyName: 'RDS Smoke Test Co', msaRequired: true },
    { refNumber: ref }
  );
  enrichVendorRecord(record);
  attachWorkflowFields(record);

  assert('vendor create: pending_rebekah_review', record.overallStatus === 'pending_rebekah_review');
  assert('vendor create: assigned rebekah', record.assignedTo === 'rebekah');
  assert('vendor ref format', /^VEN-/.test(record.refNumber));

  const store = require('../api/lib/vendor/store');
  await store.writeVendorRecord(ref, record);

  let t = applyVendorWorkflowTransition(record, 'request_documents', 'smoke@test.local');
  assert('request_documents', t.ok);
  record = t.record;

  t = applyVendorWorkflowTransition(record, 'send_to_ap', 'smoke@test.local');
  assert('send_to_ap', t.ok);
  record = t.record;

  t = applyVendorWorkflowTransition(record, 'mark_ap_complete', 'smoke@test.local');
  assert('mark_ap_complete', t.ok);
  record = t.record;

  enrichVendorRecord(record);
  attachWorkflowFields(record);

  const queues = countByQueue([record], 'rebekah');
  assert('dashboard queues computable', typeof queues.all_active === 'number');

  // Persist outbox event even when EMAIL_NOTIFICATIONS_ENABLED=false /
  // HUB_WORKER_ENABLE_EMAIL=false — those flags affect send/dispatch only.
  const notifyResult = await notifyVendorWorkflowEvent({
    notifyKey: 'sent_to_ap',
    record,
    actor: 'smoke@test.local',
    warnings: [],
  });
  assert(
    'notifyVendorWorkflowEvent queued (not skipped)',
    !!(notifyResult && (notifyResult.queued || notifyResult.outbox_event_id || notifyResult.dedupe_hit)),
    notifyResult?.skipped
      ? `skipped:${notifyResult.reason || 'unknown'}`
      : `result=${JSON.stringify({
          queued: notifyResult?.queued,
          outbox_event_id: notifyResult?.outbox_event_id,
          error: notifyResult?.error,
        })}`
  );

  const outbox = await client.query(
    `SELECT id, status, dedupe_key, payload FROM outbox_events
     WHERE dedupe_key LIKE $1
     ORDER BY created_at DESC LIMIT 5`,
    [`email:vendor:${ref}%`]
  );
  assert(
    'outbox events queued',
    outbox.rows.length >= 1,
    `expected >=1 row in outbox_events for email:vendor:${ref}% (hub_store=${getHubStoreMode()}, email_mode=${process.env.EMAIL_DELIVERY_MODE}, notify=${notifyResult?.outbox_event_id || notifyResult?.reason || 'n/a'})`
  );
  if (outbox.rows[0]) {
    assert(
      'outbox event pending or retrying (not discarded by disable flags)',
      ['pending', 'retrying', 'processing', 'processed', 'sent'].includes(String(outbox.rows[0].status))
    );
  }
  const payloadStr = JSON.stringify(outbox.rows.map((r) => r.payload));
  assert('outbox no blob url', !payloadStr.includes('blob.vercel'));
  assert('outbox no token param', !payloadStr.includes('?token='));

  await client.query(`DELETE FROM outbox_events WHERE dedupe_key LIKE $1`, [`email:vendor:${ref}%`]);
  await store.deleteVendorRecordForTest(ref);

  return record;
}

function rbacSmoke() {
  const viewer = evaluateVendorDetailUi(['view_vendor_list', 'view_vendor_dashboard', 'view_vendor_documents']);
  const ap = evaluateVendorDetailUi([
    'view_management', 'view_vendor_list', 'edit_vendor_workflow', 'manage_vendor_documents',
  ]);
  assert('rbac viewer: no save bar', !viewer.showSaveBar);
  assert('rbac ap: save bar', ap.showSaveBar);
}

async function deliveryStatusSmoke() {
  const store = require('../api/lib/hub/store');
  const { getDeliveryStatusSummary } = require('../api/lib/hub/delivery-status');
  const summary = await getDeliveryStatusSummary(store);
  assert('delivery status summary ok', summary && summary.ok === true);
  assert('delivery status has email counts', summary.email_delivery != null);
}

function fetchHealth(port) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error('health timeout'));
    });
  });
}

async function healthSmoke() {
  const port = 3019 + Math.floor(Math.random() * 100);
  process.env.PORT = String(port);
  process.env.HOST = '127.0.0.1';
  process.env.HUB_STORE_MODE = process.env.HUB_STORE_MODE || 'postgres';
  process.env.HUB_USE_LOCAL_STORE = '0';

  const { createServer } = require('./server-core');
  const srv = createServer({
    envFiles: [],
    port,
    host: '127.0.0.1',
    defaultPort: port,
    defaultHost: '127.0.0.1',
  });
  const { server } = await srv.listen();

  try {
    const health = await fetchHealth(port);
    audit.health = {
      status: health.status,
      ok: health.body.ok,
      store_mode: health.body.store_mode || health.body.hub_store_mode,
      node_env: health.body.node_env,
      store_ok: health.body.store_ok,
    };
    assert('health endpoint ok', health.status === 200 && health.body.ok === true);
    assert('health postgres store mode', String(audit.health.store_mode).includes('postgres'));
  } catch (err) {
    audit.health = { error: err.message };
    assert('health endpoint reachable', false, err.message);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  console.log('=== WOS-52 RDS Staging Cutover Smoke ===\n');

  redactEnv();
  console.log('--- Env audit (redacted) ---');
  console.log(JSON.stringify(audit.env, null, 2));
  console.log(`Host: ${audit.host} (local=${audit.is_local})\n`);

  assert('DATABASE_URL set', !!process.env.DATABASE_URL);
  assert('HUB_STORE_MODE=postgres', (process.env.HUB_STORE_MODE || '').toLowerCase() === 'postgres');
  assert(
    'VENDOR_STORE_MODE=postgres',
    (process.env.VENDOR_STORE_MODE || process.env.HUB_STORE_MODE || '').toLowerCase() === 'postgres'
  );
  assert(
    'PGSSLMODE appropriate',
    audit.is_local
      ? (process.env.PGSSLMODE || 'disable') === 'disable'
      : (process.env.PGSSLMODE || '') === 'require',
    audit.is_local ? 'local expects disable' : 'RDS expects require'
  );

  if (!process.env.DATABASE_URL) {
    console.error('\nCannot continue without DATABASE_URL');
    process.exit(1);
  }

  const client = new Client(getPgClientConfig());
  try {
    await client.connect();
    assert('postgres connection', true);
    await checkMigrations(client);
    await checkTables(client);
    await vendorWorkflowSmoke(client);
  } catch (err) {
    assert('postgres connection', false, err.message);
  } finally {
    await client.end().catch(() => {});
  }

  rbacSmoke();
  await deliveryStatusSmoke().catch((err) => assert('delivery status', false, err.message));

  if (!audit.is_local) {
    console.log('\n--- RDS target detected: run PM2 on EC2 ---');
    console.log('  pm2 start deploy/ecosystem.config.cjs');
    console.log('  pm2 status  # ops-hub-staging + ops-hub-staging-worker');
    console.log('  Note: HUB_WORKER_ENABLE_EMAIL/INTEGRATIONS=false only skips dispatch;');
    console.log('  outbox_events / integration_events must still be persisted by the app.');
  } else {
    await healthSmoke().catch((err) => assert('health smoke', false, err.message));
    console.log('\n--- PM2 ---');
    console.log('PM2 not validated on local workstation; ecosystem.config.cjs defines ops-hub-staging + ops-hub-staging-worker for EC2.');
  }

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('RESULT: FAIL');
    process.exit(1);
  }
  console.log(audit.is_local
    ? 'RESULT: PASS (local cutover simulation — execute same script on EC2 against RDS for WOS-29 Complete)'
    : 'RESULT: PASS (RDS-connected smoke)');
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
