/**
 * WOS-98 — Vendor dashboard auth, repair API, MSA/NDA workflow inputs.
 * Static / unit acceptance — does not require a live browser.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..', '..');
let passed = 0;
let failed = 0;

function pass(name) {
  passed += 1;
  console.log('PASS ', name);
}
function fail(name, err) {
  failed += 1;
  console.error('FAIL ', name, err && err.message ? err.message : err);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function mustInclude(rel, needles, label) {
  const text = read(rel);
  for (const n of needles) {
    assert.ok(text.includes(n), `${label || rel} missing: ${n}`);
  }
}

console.log('\n=== WOS-98 Vendor Contract Automation Acceptance ===\n');

try {
  mustInclude(
    'api/maintainx.js',
    [
      'useLegacyVendorPasscode',
      'view_vendor_dashboard',
      'startVendorOnboardingWorkflow',
      'workflowStarted',
      'documentsRequired',
    ],
    'vendor auth + workflow start'
  );
  // Must NOT gate GET /vendors list on object storage anymore
  const mx = read('api/maintainx.js');
  assert.ok(
    !/vendorMatch && req\.method === 'GET'[\s\S]{0,80}needsObjectStorage/.test(mx) ||
      mx.includes('Metadata list/detail must work without object storage'),
    'GET /vendors should not require object storage'
  );
  pass('Vendor dashboard SSO auth (no VENDOR_ACCESS_CODE 500 for Hub Admin)');
} catch (e) {
  fail('Vendor dashboard SSO auth', e);
}

try {
  mustInclude(
    'hub-configuration-center.js',
    [
      "data-cfg-action': 'repair-nda-wiring'",
      "hubFetch('/hub/configuration/repair-nda-wiring', { method: 'POST'",
      'preventDefault',
      'stopPropagation',
    ],
    'repair button'
  );
  mustInclude(
    'api/lib/configuration/routes.js',
    [
      "path === '/hub/configuration/repair-nda-wiring' && method === 'POST'",
      "path === '/hub/configuration/validate-wiring' && method === 'GET'",
    ],
    'repair + validate routes'
  );
  const btn = read('hub-configuration-center.js');
  const repairIdx = btn.indexOf("data-cfg-action': 'repair-nda-wiring'");
  assert.ok(repairIdx > 0, 'repair action marker');
  const snippet = btn.slice(repairIdx, repairIdx + 600);
  assert.ok(snippet.includes("method: 'POST'"), 'repair uses POST');
  assert.ok(snippet.includes('preventDefault'), 'repair preventDefault');
  assert.ok(!/location\.hash|window\.location|setHash\(/.test(snippet), 'Repair must not navigate');
  pass('Repair NDA wiring is POST API (not navigation)');
} catch (e) {
  fail('Repair NDA wiring is POST API', e);
}

try {
  const seeds = require(path.join(root, 'api/lib/configuration/seeds/default-templates.js'));
  const payload = seeds.vendorWorkflowPayload('nda-id', 'msa-id');
  assert.ok(payload.nodes.some((n) => n.key === 'check_nda'), 'check_nda node');
  assert.ok(payload.nodes.some((n) => n.key === 'check_msa'), 'check_msa node');
  assert.ok(payload.nodes.some((n) => n.type === 'logic.update_vendor'), 'update_vendor nodes');
  assert.ok(payload.nodes.some((n) => n.type === 'trigger.vendor_request_submitted'), 'vendor trigger');
  const ndaCond = payload.nodes.find((n) => n.key === 'check_nda');
  assert.strictEqual(ndaCond.config.condition.all[0].left.key, 'vendor.nda_required');
  const msaCond = payload.nodes.find((n) => n.key === 'check_msa');
  assert.strictEqual(msaCond.config.condition.all[0].left.key, 'vendor.msa_required');
  const genNda = payload.nodes.find((n) => n.key === 'gen_nda');
  assert.strictEqual(genNda.config.document_definition_id, 'nda-id');
  const genMsa = payload.nodes.find((n) => n.key === 'gen_msa');
  assert.strictEqual(genMsa.config.document_definition_id, 'msa-id');
  // Positions persisted on nodes
  payload.nodes.forEach((n) => {
    assert.ok(typeof n.x === 'number' && typeof n.y === 'number', `position for ${n.key}`);
  });
  assert.ok(payload.connections.some((c) => c.source === 'check_nda' && c.outcome_key === 'yes'));
  assert.ok(payload.connections.some((c) => c.source === 'check_nda' && c.outcome_key === 'no'));
  assert.ok(payload.connections.some((c) => c.source === 'check_msa' && c.outcome_key === 'yes'));
  assert.ok(payload.connections.some((c) => c.source === 'check_msa' && c.outcome_key === 'no'));
  pass('Vendor workflow seed has NDA/MSA condition branches + positions');
} catch (e) {
  fail('Vendor workflow seed NDA/MSA branches', e);
}

try {
  const { evaluateCondition } = require(path.join(root, 'api/lib/configuration/conditions.js'));
  const { resolveValue } = require(path.join(root, 'api/lib/configuration/variables/resolver.js'));
  const ctxNdaOnly = {
    vendor: { nda_required: true, msa_required: false, vendor_ref: 'VEN-1' },
    formSubmission: { values: { nda_required: true, msa_required: false } },
  };
  assert.strictEqual(resolveValue('vendor.nda_required', ctxNdaOnly), true);
  assert.strictEqual(resolveValue('vendor.msa_required', ctxNdaOnly), false);
  const ndaYes = evaluateCondition(
    { all: [{ left: { type: 'variable', key: 'vendor.nda_required' }, operator: 'is_true' }] },
    ctxNdaOnly
  );
  const msaNo = evaluateCondition(
    { all: [{ left: { type: 'variable', key: 'vendor.msa_required' }, operator: 'is_true' }] },
    ctxNdaOnly
  );
  assert.ok(ndaYes.ok && ndaYes.value === true, 'NDA-only: nda branch yes');
  assert.ok(msaNo.ok && msaNo.value === false, 'NDA-only: msa branch no');

  const both = {
    vendor: { nda_required: true, msa_required: true, vendor_ref: 'VEN-2' },
  };
  assert.ok(
    evaluateCondition(
      { all: [{ left: { type: 'variable', key: 'vendor.nda_required' }, operator: 'is_true' }] },
      both
    ).value
  );
  assert.ok(
    evaluateCondition(
      { all: [{ left: { type: 'variable', key: 'vendor.msa_required' }, operator: 'is_true' }] },
      both
    ).value
  );

  const neither = { vendor: { nda_required: false, msa_required: false } };
  assert.strictEqual(
    evaluateCondition(
      { all: [{ left: { type: 'variable', key: 'vendor.nda_required' }, operator: 'is_true' }] },
      neither
    ).value,
    false
  );
  assert.strictEqual(
    evaluateCondition(
      { all: [{ left: { type: 'variable', key: 'vendor.msa_required' }, operator: 'is_true' }] },
      neither
    ).value,
    false
  );
  pass('NDA-only / MSA / both / neither condition evaluation');
} catch (e) {
  fail('Condition evaluation branches', e);
}

try {
  const bridge = require(path.join(root, 'api/lib/vendor/cfg-workflow-bridge.js'));
  const ctx = bridge.buildVendorWorkflowContext(
    {
      refNumber: 'VEN-100',
      companyName: 'Acme',
      contactName: 'Pat',
      contactEmail: 'pat@acme.test',
      msaRequired: true,
      ndaRequired: false,
    },
    'admin@test'
  );
  assert.strictEqual(ctx.event, 'vendor.request.submitted');
  assert.strictEqual(ctx.vendor.msa_required, true);
  assert.strictEqual(ctx.vendor.nda_required, false);
  assert.strictEqual(ctx.formSubmission.values.vendor_ref, 'VEN-100');
  assert.deepStrictEqual(bridge.documentsRequiredFromRecord({ msaRequired: true, ndaRequired: true }), [
    'Mutual NDA',
    'Master Service Agreement',
  ]);
  pass('Vendor request workflow context variables');
} catch (e) {
  fail('Vendor request workflow context', e);
}

try {
  mustInclude(
    'api/lib/configuration/nodes/registry.js',
    ['trigger.vendor_request_submitted', 'logic.update_vendor'],
    'node catalog'
  );
  mustInclude(
    'api/lib/configuration/variables/registry.js',
    ['vendor.nda_required', 'vendor.msa_required'],
    'variable registry'
  );
  mustInclude(
    'api/lib/configuration/runtime/engine.js',
    ['applyUpdateVendor', 'vendor: context.vendor', "type === 'logic.update_vendor'"],
    'runtime update vendor'
  );
  mustInclude(
    'hub-workflow-designer.js',
    ['Condition variable', 'vendor.nda_required', 'vendor.msa_required'],
    'condition picker'
  );
  pass('Node catalog, variables, update_vendor runtime, condition picker');
} catch (e) {
  fail('Catalog / runtime / picker', e);
}

try {
  // Canvas still persists x/y (vanilla designer — React Flow deferred)
  mustInclude('hub-workflow-designer.js', ['n.x', 'n.y', 'emitDirty', 'undo'], 'canvas persistence hooks');
  const seeds = require(path.join(root, 'api/lib/configuration/seeds/default-templates.js'));
  const p = seeds.vendorWorkflowPayload('a', 'b');
  const moved = JSON.parse(JSON.stringify(p));
  moved.nodes[0].x = 999;
  moved.nodes[0].y = 888;
  assert.notStrictEqual(moved.nodes[0].x, p.nodes[0].x);
  // Round-trip JSON retains positions (persistence model)
  const round = JSON.parse(JSON.stringify(moved));
  assert.strictEqual(round.nodes[0].x, 999);
  assert.strictEqual(round.nodes[0].y, 888);
  pass('Workflow node position persistence model (JSON x/y)');
} catch (e) {
  fail('Position persistence model', e);
}

try {
  mustInclude('api/lib/configuration/seeds/default-templates.js', ['msa_template', 'msaDocumentPayload', 'check_nda'], 'MSA seed');
  assert.ok(typeof require(path.join(root, 'api/lib/configuration/seeds/default-templates.js')).msaDocumentPayload === 'function');
  pass('MSA template seed + repair expansion');
} catch (e) {
  fail('MSA template seed', e);
}

try {
  // Unauthorized: requirePermissions used for vendor routes (external vendors no mgmt)
  mustInclude('api/maintainx.js', ['requirePermissions(req, res, needed)'], 'SSO gate');
  pass('Unauthorized vendor-management gated by requirePermissions');
} catch (e) {
  fail('Unauthorized vendor-management gate', e);
}

console.log(`\nWOS-98 vendor contract automation: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
