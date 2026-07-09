#!/usr/bin/env node
/**
 * WOS-47 Vendor document notifications + action visibility test
 */
const { Client } = require('pg');
const { loadDbEnv, getPgClientConfig, assertPersistenceTestAllowed } = require('./db/env');

loadDbEnv();
process.env.HUB_STORE_MODE = 'postgres';
process.env.VENDOR_STORE_MODE = 'postgres';
process.env.EMAIL_NOTIFICATIONS_ENABLED = 'false';
process.env.EMAIL_DELIVERY_MODE = 'queued';
process.env.VENDOR_NOTIFY_EMAIL_ADMIN = 'vendor-notify-rebekah@test.local';
process.env.VENDOR_NOTIFY_EMAIL_AP = 'vendor-notify-ap@test.local';
process.env.VENDOR_NOTIFY_EMAIL_LEGAL = 'vendor-notify-dylan@test.local';

const { buildVendorRecordFromBody } = require('../api/lib/vendor/record');
const {
  enrichVendorRecord,
  attachUploadedFile,
  updateDocumentStatus,
  isRequiredDocumentsComplete,
} = require('../api/lib/vendor/documents');
const { applyVendorWorkflowTransition, attachWorkflowFields } = require('../api/lib/vendor/workflow');
const { enrichVendorSummary } = require('../api/lib/vendor-hybrid-status');
const {
  buildSafeVendorNotifyPayload,
  recipientsForDocEvent,
  notifyVendorDocumentEvent,
  notifyVendorWorkflowEvent,
  notifyAfterDocumentChange,
} = require('../api/lib/vendor/notifications');

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

async function countOutboxForRef(client, refPrefix) {
  const r = await client.query(
    `SELECT id, dedupe_key, payload FROM outbox_events
     WHERE dedupe_key LIKE $1 ORDER BY created_at DESC`,
    [`email:vendor:${refPrefix}%`]
  );
  return r.rows;
}

async function main() {
  console.log('=== WOS-47 Vendor Document Notifications Test ===');
  assertPersistenceTestAllowed();

  const client = new Client(getPgClientConfig());
  await client.connect();

  const ref = `VEN-NOTIF-${Date.now()}`;
  let record = buildVendorRecordFromBody(
    { companyName: 'Notify Test Co', msaRequired: true },
    { refNumber: ref }
  );
  enrichVendorRecord(record);
  attachWorkflowFields(record);

  assert('visibility nextAction present', !!record.nextAction);
  assert('visibility notificationSummary present', !!record.notificationSummary);
  assert('assignedOwnerLabel present', !!record.assignedOwnerLabel);

  // Safe payload — no blob/url/token
  const payload = buildSafeVendorNotifyPayload(record, {
    eventType: 'vendor.doc_received',
    docType: 'w9',
    docStatus: 'received',
  });
  const payloadStr = JSON.stringify(payload);
  assert('payload excludes blob url', !payloadStr.includes('blob.vercel'));
  assert('payload excludes signed token pattern', !payloadStr.includes('?token='));
  assert('payload has ref_number', payload.ref_number === ref);
  assert('payload has action_required', !!payload.action_required);

  // Recipient routing
  assert('docs requested → rebekah', recipientsForDocEvent('vendor.docs_requested', record, null).includes('rebekah'));
  assert('w9 received → ap', recipientsForDocEvent('vendor.doc_received', record, 'w9').includes('ap'));
  assert('msa received → dylan', recipientsForDocEvent('vendor.doc_received', record, 'msa').includes('dylan'));
  assert('missing warning → ap', recipientsForDocEvent('vendor.docs_missing_warning', record, null).includes('ap'));

  // Queue docs requested
  const reqResult = await notifyVendorWorkflowEvent({
    notifyKey: 'documents_requested',
    record,
    actor: 'test@co.com',
  });
  assert('docs requested queues results', Array.isArray(reqResult.results) && reqResult.results.length > 0);

  markRequested: {
    applyVendorWorkflowTransition(record, 'request_documents', 'test@co.com');
    enrichVendorRecord(record);
  }

  // Upload W9 → received notification
  attachUploadedFile(record, 'w9', { filename: 'w9.pdf', size: 100 }, 'uploader@test.com');
  enrichVendorRecord(record);
  await notifyAfterDocumentChange(record, {
    docType: 'w9',
    newStatus: 'received',
    actor: 'uploader@test.com',
    wasDocsComplete: false,
  });

  // Approve banking
  updateDocumentStatus(record, 'banking', 'approved', 'ap@test.com');
  enrichVendorRecord(record);
  await notifyVendorDocumentEvent({
    eventType: 'vendor.doc_approved',
    record,
    docType: 'banking',
    docStatus: 'approved',
    actor: 'ap@test.com',
    dedupeSuffix: 'banking:approved',
  });

  // Send to AP with warnings (non-blocking)
  const beforeAp = isRequiredDocumentsComplete(record);
  const sendAp = applyVendorWorkflowTransition(record, 'send_to_ap', 'rebekah@test.com');
  assert('send_to_ap still succeeds with missing docs', sendAp.ok);
  assert('send_to_ap returns warnings array', Array.isArray(sendAp.warnings));
  await notifyVendorWorkflowEvent({
    notifyKey: 'sent_to_ap',
    record,
    actor: 'rebekah@test.com',
    warnings: sendAp.warnings,
  });

  // Contract docs ready
  record.overallStatus = 'pending_contract_review';
  attachUploadedFile(record, 'msa', { filename: 'msa.pdf', size: 200 }, 'rebekah@test.com');
  await notifyVendorDocumentEvent({
    eventType: 'vendor.contract_docs_ready',
    record,
    docType: 'msa',
    docStatus: 'received',
    actor: 'rebekah@test.com',
    dedupeSuffix: 'msa:contract',
  });

  // Outbox rows exist and payloads safe
  const rows = await countOutboxForRef(client, ref);
  assert('outbox events queued', rows.length >= 3);
  const allPayload = rows.map((r) => JSON.stringify(r.payload || {})).join(' ');
  assert('outbox payload excludes blob urls', !allPayload.includes('blob.vercel-storage'));
  assert('outbox payload excludes raw file content', !allPayload.includes('w9.pdf'));

  const apRows = rows.filter((r) =>
    String(r.payload?.email?.to || r.payload?.recipient_email || '').includes('vendor-notify-ap')
  );
  assert('AP-targeted events queued', apRows.length >= 1);

  const dylanRows = rows.filter((r) =>
    String(r.payload?.email?.to || r.payload?.recipient_email || '').includes('vendor-notify-dylan')
  );
  assert('Dylan-targeted contract events queued', dylanRows.length >= 1);

  // Hybrid + completeness preserved
  const hybrid = enrichVendorSummary({
    assignedTo: record.assignedTo,
    apStatus: record.apStatus,
    contractStatus: record.contractStatus,
    adminStatus: record.adminStatus,
    overallStatus: 'pending_ap',
    w9Status: record.w9Status,
    bankingStatus: record.bankingStatus,
    insuranceStatus: record.insuranceStatus,
    documentCount: 2,
  }, 'pending_ap');
  assert('hybrid fields preserved', hybrid.pipelineStage != null);
  assert('document completeness still computable', typeof isRequiredDocumentsComplete(record) === 'boolean');

  await client.query(`DELETE FROM outbox_events WHERE dedupe_key LIKE $1`, [`email:vendor:${ref}%`]);

  await client.end();

  console.log('\n=== Summary ===');
  if (failed) {
    console.error(`RESULT: FAIL — ${failed} check(s) failed, ${passed} passed`);
    process.exit(1);
  }
  console.log(`RESULT: PASS — ${passed} vendor notification checks succeeded.`);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
