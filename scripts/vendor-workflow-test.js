#!/usr/bin/env node
/**
 * WOS-45 Vendor Workflow Routing Test
 */
const { loadDbEnv, assertPersistenceTestAllowed } = require('./db/env');
const { buildVendorRecordFromBody } = require('../api/lib/vendor/record');
const {
  applyVendorWorkflowTransition,
  isVendorComplete,
  getVendorActionRequired,
  WORKFLOW_ACTIONS,
} = require('../api/lib/vendor/workflow');
const {
  enrichVendorSummary,
  derivePipelineStage,
} = require('../api/lib/vendor-hybrid-status');

loadDbEnv();
process.env.HUB_STORE_MODE = 'postgres';
process.env.VENDOR_STORE_MODE = 'postgres';
process.env.EMAIL_NOTIFICATIONS_ENABLED = 'false';
process.env.EMAIL_DELIVERY_MODE = 'queued';

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
  const explicit = v.overallStatus;
  if (explicit === 'pending_rebekah_review') return 'pending_rebekah';
  if (explicit === 'pending_ap_setup') return 'pending_ap';
  if (explicit === 'pending_contract_review' || explicit === 'pending_dylan_review') return 'pending_contract';
  if (explicit === 'complete') return 'complete';
  return explicit || 'in_progress';
}

async function loadVendorStore() {
  const storePath = require.resolve('../api/lib/vendor/store.js');
  delete require.cache[storePath];
  delete require.cache[require.resolve('../api/lib/vendor/db/postgres.js')];
  return require('../api/lib/vendor/store.js');
}

async function main() {
  console.log('=== WOS-45 Vendor Workflow Routing Test ===');
  assertPersistenceTestAllowed();

  const store = await loadVendorStore();
  const ref = `VEN-WF-TEST-${Date.now()}`;

  // 1. New vendor starts pending Rebekah review
  let record = buildVendorRecordFromBody(
    { companyName: 'Workflow Test Co', requestedBy: 'Tester', msaRequired: true, ndaRequired: false },
    { refNumber: ref, actorEmail: 'wf-test@streamlinecorp.com' }
  );
  assert('New vendor overallStatus pending_rebekah_review', record.overallStatus === 'pending_rebekah_review');
  assert('New vendor assignedTo rebekah', record.assignedTo === 'rebekah');
  assert('New vendor adminStatus pending_review', record.adminStatus === 'pending_review');
  assert('Action required for new vendor', getVendorActionRequired(record).toLowerCase().includes('review'));

  await store.writeVendorRecord(ref, record);

  // 2. Request documents
  let t = applyVendorWorkflowTransition(record, 'request_documents', 'rebekah@test.com', { note: 'Need W9' });
  assert('request_documents succeeds', t.ok);
  assert('collecting_documents adminStatus', t.record.adminStatus === 'collecting_documents');
  assert('still pending_rebekah_review', t.record.overallStatus === 'pending_rebekah_review');
  record = t.record;

  // 3. Send to AP
  t = applyVendorWorkflowTransition(record, 'send_to_ap', 'rebekah@test.com', { note: 'Docs complete' });
  assert('send_to_ap succeeds', t.ok);
  assert('overall pending_ap_setup', t.record.overallStatus === 'pending_ap_setup');
  assert('assignedTo ap', t.record.assignedTo === 'ap');
  assert('apStatus in_progress', t.record.apStatus === 'in_progress');
  assert('admin sent_to_ap', t.record.adminStatus === 'sent_to_ap');
  assert('notify sent_to_ap', t.notify === 'sent_to_ap');
  record = t.record;

  // Invalid: send_to_ap again
  const bad = applyVendorWorkflowTransition(record, 'send_to_ap', 'ap@test.com');
  assert('invalid send_to_ap rejected', !bad.ok);

  // 4. AP complete → contract (MSA required)
  t = applyVendorWorkflowTransition(record, 'mark_ap_complete', 'ap@test.com', { note: 'AP setup done' });
  assert('mark_ap_complete succeeds', t.ok);
  assert('apStatus complete', t.record.apStatus === 'complete');
  assert('routes to pending_contract_review', t.record.overallStatus === 'pending_contract_review');
  assert('assignedTo rebekah for contract', t.record.assignedTo === 'rebekah');
  assert('notify ap_complete_contract', t.notify === 'ap_complete_contract');
  record = t.record;

  // 5. Send to Dylan
  t = applyVendorWorkflowTransition(record, 'send_to_dylan', 'rebekah@test.com', { note: 'Legal edits needed' });
  assert('send_to_dylan succeeds', t.ok);
  assert('pending_dylan_review overall', t.record.overallStatus === 'pending_dylan_review');
  assert('contract pending_dylan_review', t.record.contractStatus === 'pending_dylan_review');
  assert('assignedTo dylan', t.record.assignedTo === 'dylan');
  record = t.record;

  // 6. Contract complete + AP complete → vendor complete
  t = applyVendorWorkflowTransition(record, 'mark_contract_complete', 'dylan@test.com');
  assert('mark_contract_complete succeeds', t.ok);
  assert('vendor complete', t.record.overallStatus === 'complete');
  assert('assignedTo none', t.record.assignedTo === 'none');
  assert('isVendorComplete', isVendorComplete(t.record));
  assert('notify vendor_complete', t.notify === 'vendor_complete');
  record = t.record;

  // History entries
  const workflowHistory = record.history.filter((h) => h.event === 'workflow');
  assert('history workflow entries appended', workflowHistory.length >= 5);
  assert('history has action field', workflowHistory.every((h) => h.action && h.previous && h.next));

  await store.writeVendorRecord(ref, record);

  // 7. AP complete with no contract required
  const ref2 = `VEN-WF-NOC-${Date.now()}`;
  let noContract = buildVendorRecordFromBody(
    { companyName: 'No Contract Co', msaRequired: false, ndaRequired: false },
    { refNumber: ref2 }
  );
  applyVendorWorkflowTransition(noContract, 'send_to_ap', 'rebekah@test.com');
  const done = applyVendorWorkflowTransition(noContract, 'mark_ap_complete', 'ap@test.com');
  assert('no contract AP complete → vendor complete', done.record.overallStatus === 'complete');
  await store.deleteVendorRecordForTest(ref2);

  // 8. WOS-43 hybrid enrichment still works on routed record
  const hybridInput = {
    refNumber: record.refNumber,
    assignedTo: record.assignedTo,
    apStatus: record.apStatus,
    contractStatus: record.contractStatus,
    adminStatus: record.adminStatus,
    overallStatus: deriveOverallStatus(record),
    w9Status: record.w9Status,
    bankingStatus: record.bankingStatus,
    insuranceStatus: record.insuranceStatus,
    documentCount: 0,
  };
  const enriched = enrichVendorSummary(hybridInput, deriveOverallStatus(record));
  assert('hybrid pipelineStage complete', enriched.pipelineStage === 'complete');
  assert('hybrid deptAdmin complete', enriched.deptAdmin === 'complete');

  // In-progress hybrid during AP phase
  let inProg = buildVendorRecordFromBody({ companyName: 'Hybrid' }, { refNumber: `VEN-HYB-${Date.now()}` });
  applyVendorWorkflowTransition(inProg, 'send_to_ap', 'r@test.com');
  const hyb = enrichVendorSummary(
    {
      assignedTo: inProg.assignedTo,
      apStatus: inProg.apStatus,
      contractStatus: inProg.contractStatus,
      adminStatus: inProg.adminStatus,
      overallStatus: deriveOverallStatus(inProg),
      w9Status: inProg.w9Status,
      bankingStatus: inProg.bankingStatus,
      insuranceStatus: inProg.insuranceStatus,
      documentCount: 0,
    },
    deriveOverallStatus(inProg)
  );
  assert('hybrid in_progress during AP', hyb.pipelineStage === 'in_progress');
  assert('hybrid deptAp in_progress', hyb.deptAp === 'in_progress');

  // RBAC actions documented
  assert('workflow actions defined', WORKFLOW_ACTIONS.length >= 10);

  await store.deleteVendorRecordForTest(ref);

  console.log('\n=== Summary ===');
  if (failed) {
    console.error(`RESULT: FAIL — ${failed} check(s) failed, ${passed} passed`);
    process.exit(1);
  }
  console.log(`RESULT: PASS — ${passed} vendor workflow checks succeeded.`);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
