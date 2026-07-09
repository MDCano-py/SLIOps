#!/usr/bin/env node
/**
 * WOS-44 Vendor Master List — Postgres system-of-record test.
 * Usage: npm run vendor-master:test
 *
 * Requires DATABASE_URL and HUB_STORE_MODE=postgres (setInput set by caller or env).
 * Creates VENDOR_MASTER_TEST-* ref, verifies round-trip, cleans up.
 */
const { loadDbEnv, getPgClientConfig, assertPersistenceTestAllowed } = require('./db/env');
const { buildVendorRecordFromBody, rowToRecord } = require('../api/lib/vendor/record');
const { enrichVendorRecord } = require('../api/lib/vendor/documents');

loadDbEnv();
process.env.HUB_STORE_MODE = 'postgres';
process.env.VENDOR_STORE_MODE = 'postgres';

let passed = 0;
let failed = 0;

function assert(name, cond) {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}`);
  }
}

function deriveOverallStatus(v) {
  if (!v) return 'unknown';
  const explicit = v.overallStatus;
  if (explicit === 'pending_rebekah_review') return 'pending_rebekah';
  if (explicit === 'pending_ap_setup') return 'pending_ap';
  if (explicit === 'pending_contract_review' || explicit === 'pending_dylan_review') return 'pending_contract';
  if (explicit === 'complete') return 'complete';
  if (explicit === 'rejected' || explicit === 'cancelled') return 'rejected';
  const apDone = v.apStatus === 'complete';
  const contractDone = v.contractStatus === 'complete' || v.contractStatus === 'not_required';
  if (apDone && contractDone) return 'complete';
  if (v.assignedTo === 'rebekah' && v.apStatus === 'not_started') return 'pending_rebekah';
  if (v.assignedTo === 'ap' || v.apStatus === 'in_progress') return 'pending_ap';
  if (v.assignedTo === 'dylan' || v.contractStatus === 'in_progress' || v.contractStatus === 'legal_review') {
    return 'pending_contract';
  }
  return 'in_progress';
}

async function loadVendorStore() {
  const storePath = require.resolve('../api/lib/vendor/store.js');
  delete require.cache[storePath];
  delete require.cache[require.resolve('../api/lib/vendor/db/postgres.js')];
  return require('../api/lib/vendor/store.js');
}

async function main() {
  console.log('=== WOS-44 Vendor Master Test ===');

  assertPersistenceTestAllowed();

  const health = await require('../api/lib/vendor/db/postgres').healthCheck();
  assert('Postgres health check', health.ok);

  const store = await loadVendorStore();
  assert('Vendor store uses Postgres mode', store.isVendorPostgresMode());

  const record = buildVendorRecordFromBody(
    {
      companyName: 'Vendor Master Test Co',
      entityType: 'LLC',
      contactName: 'Test Contact',
      contactEmail: 'vendor-master-test@streamlinecorp.com',
      contactPhone: '555-0100',
      serviceDescription: 'WOS-44 validation vendor',
      requestedBy: 'WOS-44 Test Runner',
      msaRequired: true,
      ndaRequired: false,
    },
    { actorEmail: 'vendor-master-test@streamlinecorp.com' }
  );
  const ref = record.refNumber;

  assert('Reference number generated', /^VEN-\d{8}-[A-F0-9]{4}$/.test(record.refNumber));
  assert('Initial overallStatus pending_rebekah_review', record.overallStatus === 'pending_rebekah_review');
  assert('Initial adminStatus pending_review', record.adminStatus === 'pending_review');
  assert('Assigned to rebekah', record.assignedTo === 'rebekah');
  assert('Compliance w9 missing', record.w9Status === 'missing');
  assert('MSA status maps when msaRequired', record.msaStatus === 'required' || record.msaStatus === 'missing');
  enrichVendorRecord(record);
  assert('Document meta present', record.documentMeta && record.documentMeta.w9);

  await store.writeVendorRecord(ref, record);
  const found = await store.readVendorRecord(ref);
  assert('Read back vendor record', !!found && found.record.refNumber === ref);

  const v = found.record;
  assert('Round-trip companyName', v.companyName === record.companyName);
  assert('Round-trip overallStatus', v.overallStatus === 'pending_rebekah_review');
  assert('Round-trip adminStatus', v.adminStatus === 'pending_review');
  assert('deriveOverallStatus maps to pending_rebekah', deriveOverallStatus(v) === 'pending_rebekah');

  // Workflow update
  v.adminStatus = 'complete';
  v.apStatus = 'in_progress';
  v.overallStatus = 'pending_ap_setup';
  v.assignedTo = 'ap';
  v.lastActionDate = new Date().toISOString();
  v.history = [...(v.history || []), { at: v.lastActionDate, event: 'updated', by: 'test', note: 'AP handoff' }];
  await store.writeVendorRecord(ref, v);
  const updated = (await store.readVendorRecord(ref)).record;
  assert('Workflow update persisted', updated.apStatus === 'in_progress' && updated.overallStatus === 'pending_ap_setup');
  assert('deriveOverallStatus after AP handoff', deriveOverallStatus(updated) === 'pending_ap');

  // List includes test record
  const all = await store.getAllVendorRecords();
  assert('List includes test record', all.some((r) => r.refNumber === ref));

  // Direct SQL column check
  const { Client } = require('pg');
  const client = new Client(getPgClientConfig());
  await client.connect();
  try {
    const row = await client.query('SELECT * FROM vendor_master WHERE ref_number = $1', [ref]);
    assert('vendor_master row exists', row.rowCount === 1);
    const mapped = rowToRecord(row.rows[0]);
    assert('SQL row maps service_description', mapped.serviceDescription === record.serviceDescription);
  } finally {
    await client.end();
  }

  await store.deleteVendorRecordForTest(ref);
  const gone = await store.readVendorRecord(ref);
  assert('Test record cleaned up', !gone);

  console.log('\n=== Summary ===');
  if (failed) {
    console.error(`RESULT: FAIL — ${failed} check(s) failed, ${passed} passed`);
    process.exit(1);
  }
  console.log(`RESULT: PASS — ${passed} vendor master checks succeeded.`);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
