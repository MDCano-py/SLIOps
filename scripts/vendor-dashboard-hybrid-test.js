#!/usr/bin/env node
/**
 * WOS-43 Vendor Dashboard Hybrid Status Test
 * Validates pipeline/dept mapping without touching vendor KV storage.
 */
const {
  derivePipelineStage,
  deriveDeptStatuses,
  enrichVendorSummary,
} = require('../api/lib/vendor-hybrid-status.js');

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

function baseVendor(overrides = {}) {
  return {
    refNumber: 'VEN-TEST-001',
    assignedTo: 'rebekah',
    apStatus: 'not_started',
    contractStatus: 'not_started',
    w9Status: 'not_received',
    bankingStatus: 'not_received',
    insuranceStatus: 'not_received',
    documentCount: 0,
    overallStatus: 'pending_rebekah',
    ...overrides,
  };
}

console.log('=== WOS-43 Vendor Dashboard Hybrid Test ===');

// Not started — fresh submission
const fresh = baseVendor();
assert('Fresh vendor → not_started pipeline', derivePipelineStage(fresh) === 'not_started');
const freshDept = deriveDeptStatuses(fresh);
assert('Fresh vendor admin in_progress', freshDept.admin === 'in_progress');
assert('Fresh vendor ap not_started', freshDept.ap === 'not_started');

// In progress — admin still but docs uploaded
const withDoc = baseVendor({ documentCount: 1 });
assert('Vendor with doc → in_progress pipeline', derivePipelineStage(withDoc) === 'in_progress');

// In progress — pending AP
const pendingAp = baseVendor({
  assignedTo: 'ap',
  apStatus: 'in_progress',
  overallStatus: 'pending_ap',
  w9Status: 'received',
});
assert('Pending AP → in_progress pipeline', derivePipelineStage(pendingAp) === 'in_progress');
assert('Pending AP dept active', deriveDeptStatuses(pendingAp).ap === 'in_progress');
assert('Admin complete when past rebekah', deriveDeptStatuses(pendingAp).admin === 'complete');

// Complete
const done = baseVendor({
  assignedTo: 'complete',
  apStatus: 'complete',
  contractStatus: 'complete',
  overallStatus: 'complete',
  w9Status: 'received',
  bankingStatus: 'received',
  insuranceStatus: 'received',
});
assert('Complete vendor → complete pipeline', derivePipelineStage(done) === 'complete');
assert('All depts complete', Object.values(deriveDeptStatuses(done)).every(s => s === 'complete'));

// Contract not required
const noContract = baseVendor({
  contractStatus: 'not_required',
  assignedTo: 'ap',
  apStatus: 'in_progress',
  overallStatus: 'pending_ap',
});
assert('Contract not_required → contract complete badge state', deriveDeptStatuses(noContract).contract === 'complete');

// enrichVendorSummary preserves overallStatus from server derivation
const enriched = enrichVendorSummary({
  refNumber: 'VEN-X',
  assignedTo: 'rebekah',
  apStatus: 'not_started',
  contractStatus: 'not_started',
  w9Status: 'not_received',
  bankingStatus: 'not_received',
  insuranceStatus: 'not_received',
  documentCount: 0,
}, 'pending_rebekah');
assert('enrichVendorSummary adds pipelineStage', enriched.pipelineStage === 'not_started');
assert('enrichVendorSummary adds deptAdmin', enriched.deptAdmin === 'in_progress');
assert('enrichVendorSummary keeps overallStatus', enriched.overallStatus === 'pending_rebekah');

console.log('\n=== Summary ===');
if (failed) {
  console.error(`RESULT: FAIL — ${failed} check(s) failed, ${passed} passed`);
  process.exit(1);
}
console.log(`RESULT: PASS — ${passed} hybrid mapping checks succeeded.`);
