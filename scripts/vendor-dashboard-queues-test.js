#!/usr/bin/env node
/**
 * WOS-48 Vendor dashboard role-scoped queue test
 */
const {
  QUEUE_IDS,
  inferDashboardPersona,
  queuesVisibleForPersona,
  defaultQueueForPersona,
  filterVendorsByQueue,
  countByQueue,
  matchesQueue,
  isMyQueueVendor,
} = require('../vendor-dashboard-queues.js');
const {
  AP_VENDOR_PRESET,
  DYLAN_LEGAL_PRESET,
  VENDOR_VIEWER_PRESET,
  STANDARD_USER_PRESET,
  REBEKAH_VENDOR_PRESET,
  ADMIN_PRESET,
} = require('../api/lib/rbac/vendor-ui-perms');

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

function vendor(overrides = {}) {
  return {
    refNumber: 'VEN-Q-001',
    companyName: 'Queue Test Co',
    overallStatus: 'pending_rebekah_review',
    assignedTo: 'rebekah',
    assignedOwner: 'rebekah',
    apStatus: 'not_started',
    contractStatus: 'not_started',
    w9Status: 'missing',
    bankingStatus: 'missing',
    requiredDocumentsComplete: false,
    pipelineStage: 'not_started',
    createdAt: new Date().toISOString(),
    lastActionDate: new Date().toISOString(),
    ...overrides,
  };
}

function main() {
  console.log('=== WOS-48 Vendor Dashboard Queues Test ===');

  const rebekahV = vendor();
  const apV = vendor({
    refNumber: 'VEN-Q-AP',
    overallStatus: 'pending_ap_setup',
    assignedTo: 'ap',
    assignedOwner: 'ap',
    apStatus: 'in_progress',
    pipelineStage: 'in_progress',
  });
  const dylanV = vendor({
    refNumber: 'VEN-Q-DY',
    overallStatus: 'pending_dylan_review',
    assignedTo: 'dylan',
    assignedOwner: 'dylan',
    contractStatus: 'legal_review',
    pipelineStage: 'in_progress',
  });
  const completeV = vendor({
    refNumber: 'VEN-Q-DONE',
    overallStatus: 'complete',
    assignedTo: 'none',
    assignedOwner: 'none',
    pipelineStage: 'complete',
    requiredDocumentsComplete: true,
    w9Status: 'approved',
    bankingStatus: 'approved',
  });
  const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const stalledV = vendor({
    refNumber: 'VEN-Q-STALL',
    assignedTo: 'rebekah',
    lastActionDate: oldDate,
    createdAt: oldDate,
  });
  const records = [rebekahV, apV, dylanV, completeV, stalledV];

  assert('queue ids defined', QUEUE_IDS.includes('my_queue') && QUEUE_IDS.includes('all_active'));

  // Persona inference
  assert('standard user persona none', inferDashboardPersona(STANDARD_USER_PRESET) === 'none');
  assert('viewer persona', inferDashboardPersona(VENDOR_VIEWER_PRESET) === 'viewer');
  assert('dylan persona', inferDashboardPersona(DYLAN_LEGAL_PRESET) === 'dylan');
  assert('ops persona for workflow editor', inferDashboardPersona(AP_VENDOR_PRESET) === 'ops');
  assert('admin persona', inferDashboardPersona(ADMIN_PRESET) === 'admin');
  assert('role preview ap', inferDashboardPersona([], 'ap') === 'ap');
  assert('role preview rebekah', inferDashboardPersona([], 'rebekah') === 'rebekah');

  // Queue visibility
  assert('standard user sees no queues', queuesVisibleForPersona('none').length === 0);
  assert('viewer sees all_active not my_queue', queuesVisibleForPersona('viewer').includes('all_active') && !queuesVisibleForPersona('viewer').includes('my_queue'));
  assert('admin sees all queues', queuesVisibleForPersona('admin').length === QUEUE_IDS.length);
  assert('dylan sees my_queue', queuesVisibleForPersona('dylan').includes('my_queue'));

  // Default queue
  assert('ap default my_queue via preview', defaultQueueForPersona('ap') === 'my_queue');
  assert('viewer default all_active', defaultQueueForPersona('viewer') === 'all_active');

  // My queue filtering
  assert('rebekah my queue includes rebekah vendor', isMyQueueVendor(rebekahV, 'rebekah'));
  assert('rebekah my queue excludes ap vendor', !isMyQueueVendor(apV, 'rebekah'));
  assert('ap my queue includes ap vendor', isMyQueueVendor(apV, 'ap'));
  assert('dylan my queue includes dylan vendor', isMyQueueVendor(dylanV, 'dylan'));
  assert('admin my queue includes all active owners', isMyQueueVendor(apV, 'admin') && isMyQueueVendor(dylanV, 'admin'));

  // Queue filters
  const rebekahPending = filterVendorsByQueue(records, 'pending_rebekah', 'admin');
  assert('pending rebekah queue', rebekahPending.some(r => r.refNumber === 'VEN-Q-001'));

  const apPending = filterVendorsByQueue(records, 'pending_ap', 'admin');
  assert('pending ap queue', apPending.some(r => r.refNumber === 'VEN-Q-AP'));

  const dylanPending = filterVendorsByQueue(records, 'pending_dylan', 'admin');
  assert('pending dylan queue', dylanPending.some(r => r.refNumber === 'VEN-Q-DY'));

  const missing = filterVendorsByQueue(records, 'missing_docs', 'admin');
  assert('missing docs queue', missing.length >= 2 && !missing.some(r => r.refNumber === 'VEN-Q-DONE'));

  const stalled = filterVendorsByQueue(records, 'stalled', 'admin');
  assert('stalled queue', stalled.some(r => r.refNumber === 'VEN-Q-STALL'));

  const active = filterVendorsByQueue(records, 'all_active', 'admin');
  assert('all active excludes complete', active.length === 4 && !active.some(r => r.refNumber === 'VEN-Q-DONE'));

  // Counts
  const counts = countByQueue(records, 'admin');
  assert('count my_queue > 0', counts.my_queue >= 3);
  assert('count pending_ap >= 1', counts.pending_ap >= 1);
  assert('count complete not in all_active', counts.all_active === 4);

  // Standard user — no unauthorized queue data leakage in filter (empty when no persona queues)
  assert('standard user filter empty for my_queue', filterVendorsByQueue(records, 'my_queue', 'none').length === 0);

  // matchesQueue uses enriched fields
  assert('matches missing via requiredDocumentsComplete', matchesQueue(rebekahV, 'missing_docs', 'admin'));

  console.log('\n=== Summary ===');
  if (failed) {
    console.error(`RESULT: FAIL — ${failed} check(s) failed, ${passed} passed`);
    process.exit(1);
  }
  console.log(`RESULT: PASS — ${passed} vendor dashboard queue checks succeeded.`);
}

main();
