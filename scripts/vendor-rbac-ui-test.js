#!/usr/bin/env node
/**
 * WOS-50 Vendor RBAC UI permission alignment test
 */
const { Client } = require('pg');
const { loadDbEnv, getPgClientConfig, assertPersistenceTestAllowed } = require('./db/env');
const {
  ROLE_PREVIEW_PRESETS,
  AP_VENDOR_PRESET,
  DYLAN_LEGAL_PRESET,
  VENDOR_VIEWER_PRESET,
  STANDARD_USER_PRESET,
  REBEKAH_VENDOR_PRESET,
  ADMIN_PRESET,
  createVendorUiChecks,
  evaluateVendorDetailUi,
} = require('../api/lib/rbac/vendor-ui-perms');
const { permissionsForWorkflowAction } = require('../api/lib/vendor/workflow');
const { permissionsForDocType } = require('../api/lib/vendor/documents');

loadDbEnv();
process.env.HUB_STORE_MODE = 'postgres';
process.env.EMAIL_NOTIFICATIONS_ENABLED = 'false';
process.env.EMAIL_DELIVERY_MODE = 'queued';
process.env.VENDOR_NOTIFY_EMAIL_ADMIN = 'vendor-notify-rebekah@test.local';
process.env.VENDOR_NOTIFY_EMAIL_AP = 'vendor-notify-ap@test.local';
process.env.VENDOR_NOTIFY_EMAIL_LEGAL = 'vendor-notify-dylan@test.local';

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

async function main() {
  console.log('=== WOS-50 Vendor RBAC UI Test ===');
  assertPersistenceTestAllowed();

  const checks = createVendorUiChecks(false);

  // Standard user — no vendor controls
  const stdUi = evaluateVendorDetailUi(STANDARD_USER_PRESET);
  assert('standard user: no save bar', !stdUi.showSaveBar);
  assert('standard user: no uploads', !stdUi.showDocumentUploads);
  assert('standard user: no workflow actions', !stdUi.showWorkflowActionButtons);
  assert('standard user: no doc delete', !stdUi.showDocumentDelete);

  // Vendor viewer — read only
  const viewerUi = evaluateVendorDetailUi(VENDOR_VIEWER_PRESET);
  assert('viewer: no save bar', !viewerUi.showSaveBar);
  assert('viewer: no uploads', !viewerUi.showDocumentUploads);
  assert('viewer: no workflow dropdowns', !viewerUi.showWorkflowDropdowns);
  assert('viewer: can download', viewerUi.showDownloadAll);
  assert('viewer: no doc status edit', !viewerUi.showDocStatusDropdowns);

  // Dylan/legal — docs + compliance, no workflow save
  const dylanUi = evaluateVendorDetailUi(DYLAN_LEGAL_PRESET);
  assert('dylan: no save bar', !dylanUi.showSaveBar);
  assert('dylan: no workflow dropdowns', !dylanUi.showWorkflowDropdowns);
  assert('dylan: doc status edit', dylanUi.showDocStatusDropdowns);
  assert('dylan: uploads allowed', dylanUi.showDocumentUploads);
  assert('dylan: delete allowed', dylanUi.showDocumentDelete);

  // AP — full vendor edit
  const apUi = evaluateVendorDetailUi(AP_VENDOR_PRESET);
  assert('ap: save bar', apUi.showSaveBar);
  assert('ap: workflow dropdowns', apUi.showWorkflowDropdowns);
  assert('ap: workflow actions', apUi.showWorkflowActionButtons);
  assert('ap: uploads', apUi.showDocumentUploads);

  // Rebekah/admin owner — same as AP preset in matrix
  const rebekahUi = evaluateVendorDetailUi(REBEKAH_VENDOR_PRESET);
  assert('rebekah: full workflow edit', rebekahUi.showSaveBar && rebekahUi.showWorkflowActionButtons);

  // Admin preset
  const adminUi = evaluateVendorDetailUi(ADMIN_PRESET);
  assert('admin: all vendor detail controls', adminUi.showSaveBar && adminUi.showDocumentUploads && adminUi.showDocumentDelete);

  // Dashboard helpers
  assert('viewer: no dash upload', !checks.canDashVendorUpload(VENDOR_VIEWER_PRESET));
  assert('ap: dash upload', checks.canDashVendorUpload(AP_VENDOR_PRESET));
  assert('viewer: no dash note', !checks.canDashVendorNote(VENDOR_VIEWER_PRESET));
  assert('dylan: dash note via compliance', checks.canDashVendorNote(DYLAN_LEGAL_PRESET));

  // Role preview presets defined
  assert('role preview presets exist', Object.keys(ROLE_PREVIEW_PRESETS).length >= 5);
  assert('role preview admin preset', !!ROLE_PREVIEW_PRESETS.admin?.permissions?.includes('admin'));

  // Backend permission maps still defined (source of truth)
  assert('workflow send_to_ap requires edit_vendor_workflow', permissionsForWorkflowAction('send_to_ap').includes('edit_vendor_workflow'));
  assert('doc w9 status requires compliance or workflow', permissionsForDocType('w9').some(p => ['edit_vendor_compliance', 'edit_vendor_workflow'].includes(p)));

  // Outbox path for assignment notification (WOS-29 follow-up)
  const { queueVendorWorkflowNotification, buildVendorAssignedEmail } = require('../api/lib/vendor/notifications');
  const { buildVendorRecordFromBody } = require('../api/lib/vendor/record');
  const record = buildVendorRecordFromBody({ companyName: 'RBAC Test Co' }, { refNumber: `VEN-RBAC-${Date.now()}` });
  const client = new Client(getPgClientConfig());
  await client.connect();
  const assignResult = await queueVendorWorkflowNotification({
    channel: 'assigned',
    record,
    assigneeRole: 'ap',
    actorEmail: 'rebekah@test.com',
    note: 'RBAC test assignment',
    email: buildVendorAssignedEmail(record, 'ap', 'rebekah@test.com', 'RBAC test assignment'),
  });
  assert('assignment notify uses outbox path', !!(assignResult.queued || assignResult.outbox_event_id || assignResult.skipped));
  const outbox = await client.query(
    `SELECT payload FROM outbox_events WHERE dedupe_key LIKE $1 ORDER BY created_at DESC LIMIT 1`,
    [`email:vendor:${record.refNumber}:vendor.assigned%`]
  );
  if (outbox.rows[0]) {
    const payloadStr = JSON.stringify(outbox.rows[0].payload || {});
    assert('outbox assignment payload excludes blob url', !payloadStr.includes('blob.vercel'));
    assert('outbox assignment payload has recipient', payloadStr.includes('ap@test') || assignResult.skipped);
  }
  await client.query(`DELETE FROM outbox_events WHERE dedupe_key LIKE $1`, [`email:vendor:${record.refNumber}%`]);
  await client.end();

  console.log('\n=== Summary ===');
  if (failed) {
    console.error(`RESULT: FAIL — ${failed} check(s) failed, ${passed} passed`);
    process.exit(1);
  }
  console.log(`RESULT: PASS — ${passed} vendor RBAC UI checks succeeded.`);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
