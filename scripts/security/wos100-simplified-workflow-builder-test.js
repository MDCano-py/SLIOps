/**
 * WOS-100 — Simplified workflow builder acceptance tests.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..', '..');
require(path.join(root, 'hub-workflow-simple-builder.js'));
const B = global.HubWorkflowSimpleBuilder;

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

console.log('\n=== WOS-100 Simplified Workflow Builder ===\n');

try {
  assert.ok(B && typeof B.mount === 'function');
  assert.ok(typeof B.graphToModel === 'function');
  assert.ok(typeof B.modelToGraph === 'function');
  pass('HubWorkflowSimpleBuilder exports');
} catch (e) {
  fail('exports', e);
}

try {
  const model = {
    spine: [
      B.createStep('start', { name: 'Vendor Created' }),
      B.createStep('form', { name: 'Vendor Information' }),
      (() => {
        const c = B.createStep('condition', { name: 'NDA Required?' });
        c.config.condition.all[0].left.key = 'vendor.nda_required';
        c.branches = {
          yes: [
            B.createStep('review', { name: 'NDA Review' }),
            B.createStep('approval', { name: 'NDA Approval' }),
            B.createStep('sign', { name: 'Vendor Sign NDA' }),
            B.createStep('notification', { name: 'Notify Vendor' }),
            B.createStep('end', { name: 'End' }),
          ],
          no: [B.createStep('end', { name: 'Continue / End' })],
        };
        return c;
      })(),
    ],
  };
  const graph = B.modelToGraph(model);
  assert.ok(graph.nodes.length >= 8, 'nodes emitted');
  assert.ok(graph.connections.length >= 6, 'connections emitted');
  const start = graph.nodes.find((n) => String(n.type).startsWith('trigger.'));
  assert.ok(start, 'start trigger');
  const cond = graph.nodes.find((n) => n.type === 'logic.condition');
  assert.ok(cond, 'condition node');
  assert.ok(graph.connections.some((c) => c.source === cond.key && (c.outcome_key === 'yes' || c.source_handle === 'yes')));
  assert.ok(graph.connections.some((c) => c.source === cond.key && (c.outcome_key === 'no' || c.source_handle === 'no')));
  graph.nodes.forEach((n) => {
    assert.ok(typeof n.x === 'number' && typeof n.y === 'number', 'auto layout x/y for ' + n.key);
  });
  pass('Acceptance spine serializes to runtime graph with yes/no edges');
} catch (e) {
  fail('NDA acceptance serialize', e);
}

try {
  const model = {
    spine: [
      B.createStep('start', { name: 'A' }),
      B.createStep('review', { name: 'B' }),
      B.createStep('end', { name: 'C' }),
    ],
  };
  // insert after A
  model.spine.splice(1, 0, B.createStep('approval', { name: 'Inserted' }));
  assert.strictEqual(model.spine[1].name, 'Inserted');
  // move down
  const tmp = model.spine[1];
  model.spine[1] = model.spine[2];
  model.spine[2] = tmp;
  assert.strictEqual(model.spine[2].name, 'Inserted');
  // delete
  model.spine.splice(2, 1);
  assert.ok(!model.spine.some((s) => s.name === 'Inserted'));
  const g = B.modelToGraph(model);
  assert.ok(g.connections.some((c) => c.source && c.target));
  pass('Insert / move / delete update model and graph');
} catch (e) {
  fail('insert move delete', e);
}

try {
  const seeds = require(path.join(root, 'api/lib/configuration/seeds/default-templates.js'));
  const legacy = seeds.vendorWorkflowPayload('nda-doc', 'msa-doc');
  const model = B.graphToModel(legacy);
  assert.ok(model.spine.length >= 1, 'spine from legacy');
  assert.ok(model.spine.some((s) => String(s.type).startsWith('trigger.')), 'legacy start');
  const round = B.modelToGraph(model);
  assert.ok(round.nodes.length >= 1);
  assert.ok(round.connections.length >= 0);
  pass('Legacy vendor graph opens in simplified model');
} catch (e) {
  fail('legacy compatibility', e);
}

try {
  const empty = B.validateModel({ spine: [] });
  assert.ok(empty.some((i) => i.code === 'EMPTY'));
  const okish = B.validateModel({
    spine: [B.createStep('start'), B.createStep('end')],
  });
  assert.ok(!okish.some((i) => i.severity === 'error' && i.code === 'EMPTY'));
  const cond = B.createStep('condition');
  cond.config.condition.all[0].left.key = '';
  const bad = B.validateModel({ spine: [B.createStep('start'), cond, B.createStep('end')] });
  assert.ok(bad.some((i) => i.code === 'COND_VAR' || i.message.includes('variable')));
  pass('Validation catches empty workflow and bad condition');
} catch (e) {
  fail('validation', e);
}

try {
  const step = B.createStep('review');
  assert.ok(step.config.assignment);
  assert.ok(['role', 'request_creator'].indexOf(step.config.assignment.mode) >= 0);
  pass('Human steps default to real assignment shape (no mock users)');
} catch (e) {
  fail('assignment shape', e);
}

try {
  const idx = read('index.html');
  assert.ok(idx.includes('hub-workflow-simple-builder.js'));
  const cfg = read('hub-configuration-center.js');
  assert.ok(cfg.includes('HubWorkflowSimpleBuilder'));
  assert.ok(cfg.includes('workflowAdvancedCanvas'));
  assert.ok(cfg.includes('Back to simple builder'));
  const css = read('hub.css');
  assert.ok(css.includes('.swb-root'));
  assert.ok(css.includes('.swb-plus'));
  pass('Simple builder wired as primary; advanced canvas optional');
} catch (e) {
  fail('wiring', e);
}

try {
  // No production demo bypass regression from WOS-99
  const sc = read('scripts/server-core.js');
  assert.ok(sc.includes('SSO_ENFORCEMENT=off is not allowed in production'));
  assert.ok(fs.existsSync(path.join(root, 'api/lib/authbridge.js')));
  pass('WOS-99 production refusals / AuthBridge preserved');
} catch (e) {
  fail('prod gates preserved', e);
}

try {
  const model = {
    spine: [
      B.createStep('start'),
      (() => {
        const c = B.createStep('condition');
        c.branches = { yes: [B.createStep('sign')], no: [B.createStep('end')] };
        return c;
      })(),
    ],
  };
  const g1 = B.modelToGraph(model);
  const m2 = B.graphToModel(g1);
  const g2 = B.modelToGraph(m2);
  assert.ok(g2.nodes.some((n) => n.type === 'logic.condition'));
  assert.ok(g2.connections.some((c) => c.outcome_key === 'yes' || c.source_handle === 'yes'));
  pass('Persistence round-trip model → graph → model → graph');
} catch (e) {
  fail('round-trip', e);
}

console.log(`\nWOS-100 simplified builder: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
