#!/usr/bin/env node
/**
 * WOS-98 — Configuration + Vendor NDA operational chain tests
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
let passed = 0;
let failed = 0;

function assert(name, cond, detail) {
  if (cond) {
    console.log('PASS ', name);
    passed += 1;
  } else {
    console.log('FAIL ', name, detail || '');
    failed += 1;
  }
}

console.log('\n=== WOS-98 Config / Vendor NDA E2E Wiring Test ===\n');

const seeds = require(path.join(root, 'api/lib/configuration/seeds/default-templates.js'));
const ext = require(path.join(root, 'api/lib/configuration/runtime/external-participants.js'));
const engineSrc = fs.readFileSync(path.join(root, 'api/lib/configuration/runtime/engine.js'), 'utf8');
const routesSrc = fs.readFileSync(path.join(root, 'api/lib/configuration/routes.js'), 'utf8');
const cfgSrc = fs.readFileSync(path.join(root, 'hub-configuration-center.js'), 'utf8');
const designerSrc = fs.readFileSync(path.join(root, 'hub-workflow-designer.js'), 'utf8');
const hubSrc = fs.readFileSync(path.join(root, 'hub.js'), 'utf8');
const maintainxSrc = fs.readFileSync(path.join(root, 'api/maintainx.js'), 'utf8');

assert('cfg-action.html exists', fs.existsSync(path.join(root, 'cfg-action.html')));
assert('external participants module exports mint', typeof ext.createExternalParticipant === 'function');
assert('token hash is hex', /^[a-f0-9]{64}$/.test(ext.hashToken('test-token')));

const ndaDoc = seeds.ndaDocumentPayload();
assert('NDA payload has blocks', Array.isArray(ndaDoc.blocks) && ndaDoc.blocks.length >= 3);
assert('NDA payload has body_html', !!ndaDoc.body_html);

const fakeDocId = 'doc-uuid-1';
const wf = seeds.ndaWorkflowPayload(fakeDocId);
const generate = wf.nodes.find((n) => n.key === 'generate');
assert('generate node wired to document', generate && generate.config.document_definition_id === fakeDocId);
assert(
  'sign_external uses external_participant',
  wf.nodes.find((n) => n.key === 'sign_external').config.assignment.mode === 'external_participant'
);
assert(
  'signed edges present',
  wf.connections.some((c) => c.source === 'sign_external' && c.outcome_key === 'signed')
);
assert('repairNdaOperationalWiring exported', typeof seeds.repairNdaOperationalWiring === 'function');

assert('engine mints external participants', /createExternalParticipant/.test(engineSrc));
assert('engine completes external tasks', /completeExternalTask/.test(engineSrc));
assert('engine syncs vendor NDA', /syncVendorNdaOnComplete/.test(engineSrc));
assert('external action routes exist', /external-action/.test(routesSrc));
assert('published-documents route exists', /published-documents/.test(routesSrc));
assert('repair-nda-wiring route exists', /repair-nda-wiring/.test(routesSrc));
assert('SSO allowlists external-action', /external-action/.test(maintainxSrc));

assert('document block drag reorder', /draggable:\s*'true'/.test(cfgSrc) && /cfg-block-drag/.test(cfgSrc));
assert('published documents library UI', /Published Documents library/.test(cfgSrc));
assert('overview cards navigate', /cfg-card-btn/.test(cfgSrc));
assert('designer document picker', /document_definition_id/.test(designerSrc) && /Published document template/.test(designerSrc));
assert('My Tasks sign outcomes', /Sign \/ complete task/.test(hubSrc) || /signed/.test(hubSrc));

// Validation of wired graph
const { validateWorkflowDefinition } = require(path.join(root, 'api/lib/configuration/validation/workflow.js'));
const validation = validateWorkflowDefinition(wf);
const errors = validation.issues.filter((i) => i.severity === 'error');
assert(
  'wired NDA workflow validates',
  errors.length === 0,
  JSON.stringify(errors.slice(0, 5))
);

console.log('\nWOS-98 results: ' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
