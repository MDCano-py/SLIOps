#!/usr/bin/env node
/**
 * WOS-46 Vendor Document Storage + Required Docs Tracking Test
 */
const { loadDbEnv, assertPersistenceTestAllowed } = require('./db/env');
const { buildVendorRecordFromBody } = require('../api/lib/vendor/record');
const {
  ensureDocumentMeta,
  attachUploadedFile,
  updateDocumentStatus,
  getMissingRequiredDocuments,
  isRequiredDocumentsComplete,
  computeDocumentSummary,
  normalizeDocStatus,
  enrichVendorRecord,
} = require('../api/lib/vendor/documents');
const { applyVendorWorkflowTransition } = require('../api/lib/vendor/workflow');
const { enrichVendorSummary } = require('../api/lib/vendor-hybrid-status');

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

async function loadVendorStore() {
  delete require.cache[require.resolve('../api/lib/vendor/store.js')];
  delete require.cache[require.resolve('../api/lib/vendor/db/postgres.js')];
  return require('../api/lib/vendor/store.js');
}

async function main() {
  console.log('=== WOS-46 Vendor Documents Test ===');
  assertPersistenceTestAllowed();

  const store = await loadVendorStore();
  const ref = `VEN-DOC-TEST-${Date.now()}`;

  // Default requirements
  let record = buildVendorRecordFromBody(
    { companyName: 'Doc Test Co', msaRequired: true, ndaRequired: false },
    { refNumber: ref }
  );
  enrichVendorRecord(record);
  assert('W9 required by default', record.documentMeta.w9.required === true);
  assert('Banking required by default', record.documentMeta.banking.required === true);
  assert('Insurance not required by default', record.documentMeta.insurance.required === false);
  assert('W9 status missing', normalizeDocStatus(record.documentMeta.w9.status) === 'missing');
  assert('MSA required when flag set', record.documentMeta.msa.required === true);
  enrichVendorRecord(record);
  assert('MSA flat status required when msaRequired', record.msaStatus === 'required' || record.msaStatus === 'missing');
  assert('NDA not required when flag false', record.documentMeta.nda.required === false);
  assert('requiredDocumentsComplete false initially', record.requiredDocumentsComplete === false);

  await store.writeVendorRecord(ref, record);

  // Manual status update
  const req = updateDocumentStatus(record, 'w9', 'requested', 'test@co.com', { note: 'Please send W9' });
  assert('manual status update ok', req.ok);
  assert('w9 requested', record.documentMeta.w9.status === 'requested');
  assert('history has document_status', record.history.some(h => h.event === 'document_status' && h.docType === 'w9'));

  // Upload received
  attachUploadedFile(record, 'w9', { filename: 'w9.pdf', size: 1024 }, 'uploader@test.com');
  assert('upload sets received', record.documentMeta.w9.status === 'received');
  assert('upload adds file metadata', record.documentMeta.w9.files.length === 1);
  assert('file metadata has no url', !record.documentMeta.w9.files[0].url);

  // Approved stays approved on upload
  updateDocumentStatus(record, 'banking', 'approved', 'ap@test.com');
  attachUploadedFile(record, 'banking', { filename: 'bank.pdf', size: 512 }, 'ap@test.com');
  assert('approved stays approved after upload', record.documentMeta.banking.status === 'approved');

  // MSA/NDA required record completeness
  updateDocumentStatus(record, 'w9', 'approved', 'rebekah@test.com');
  assert('missing list excludes approved w9', !getMissingRequiredDocuments(record).some(d => d.docType === 'w9'));

  updateDocumentStatus(record, 'w9', 'approved', 'rebekah@test.com');
  updateDocumentStatus(record, 'banking', 'missing', 'test@co.com');
  attachUploadedFile(record, 'msa', { filename: 'msa.pdf', size: 200 }, 'rebekah@test.com');
  updateDocumentStatus(record, 'msa', 'approved', 'rebekah@test.com');
  assert('not complete with banking missing', !isRequiredDocumentsComplete(record));
  const missing = getMissingRequiredDocuments(record);
  assert('missingRequiredDocuments lists banking', missing.some(d => d.docType === 'banking'));

  updateDocumentStatus(record, 'banking', 'received', 'ap@test.com');
  enrichVendorRecord(record);
  assert('requiredDocumentsComplete when satisfied', record.requiredDocumentsComplete === true);
  assert('documentSummary present', !!record.documentSummary.w9);

  await store.writeVendorRecord(ref, record);
  const roundTrip = (await store.readVendorRecord(ref)).record;
  enrichVendorRecord(roundTrip);
  assert('round-trip documentSummary', roundTrip.documentSummary.w9.status === 'approved');

  // Workflow includes document visibility
  let wf = buildVendorRecordFromBody({ companyName: 'WF Doc' }, { refNumber: `VEN-DOC-WF-${Date.now()}` });
  applyVendorWorkflowTransition(wf, 'request_documents', 'r@test.com');
  assert('request_documents marks missing as requested', wf.documentMeta.w9.status === 'requested');

  const sendAp = applyVendorWorkflowTransition(wf, 'send_to_ap', 'r@test.com');
  assert('send_to_ap warns on missing docs', Array.isArray(sendAp.warnings) && sendAp.warnings.length > 0);

  // Hybrid still works
  const hybrid = enrichVendorSummary({
    assignedTo: record.assignedTo,
    apStatus: record.apStatus,
    contractStatus: record.contractStatus,
    adminStatus: record.adminStatus,
    overallStatus: 'pending_rebekah',
    w9Status: record.w9Status,
    bankingStatus: record.bankingStatus,
    insuranceStatus: record.insuranceStatus,
    documentCount: 2,
  }, 'pending_rebekah');
  assert('hybrid enrichment works', hybrid.pipelineStage != null);

  await store.deleteVendorRecordForTest(ref);

  console.log('\n=== Summary ===');
  if (failed) {
    console.error(`RESULT: FAIL — ${failed} check(s) failed, ${passed} passed`);
    process.exit(1);
  }
  console.log(`RESULT: PASS — ${passed} vendor document checks succeeded.`);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
