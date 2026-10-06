#!/usr/bin/env node
/**
 * WOS-97 — functional workflow node connection authoring tests
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

console.log('\n=== WOS-97 Functional Workflow Connection Authoring Test ===\n');

const designerSrc = fs.readFileSync(path.join(root, 'hub-workflow-designer.js'), 'utf8');
const cssSrc = fs.readFileSync(path.join(root, 'hub.css'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert('handle drag starts linking', /linking\s*=\s*\{\s*source:/.test(designerSrc));
assert('finishLinking completes on canvas pointerup', /function finishLinking/.test(designerSrc) && /finishLinking\(e\)/.test(designerSrc));
assert('Escape cancels linking', /Escape.*linking|linking.*Escape/.test(designerSrc));
assert('decision handles Yes/No or Approved/Rejected', /Approved/.test(designerSrc) && /Rejected/.test(designerSrc) && /Yes/.test(designerSrc));
assert('start has no input handle', /if \(!isStartType\(node\.type\)\) handles\.push\(\{ id: 'in'/.test(designerSrc));
assert('terminals have no outputs', /if \(isTerminalType\(node\.type\)\)[\s\S]{0,40}return handles/.test(designerSrc));
assert('Connect nodes dialog present', /Connect workflow steps/.test(designerSrc));
assert('Outputs inspector section', /Outputs/.test(designerSrc) && /Not connected/.test(designerSrc));
assert('edge selection + remove', /selectedEdgeKey/.test(designerSrc) && /Remove connection/.test(designerSrc));
assert('undo/redo for connections', /function undo\(/.test(designerSrc) && /function redo\(/.test(designerSrc) && /pushHistory/.test(designerSrc));
assert('quick-add next step', /Add next step/.test(designerSrc) && /offerAddNextStep/.test(designerSrc));
assert('accessible handle aria-labels', /Connect from /.test(designerSrc) && /Connect to /.test(designerSrc));
assert('revision loop support', /is_revision/.test(designerSrc));
assert('no permanent Remove in raw connection list', !/cfg-conn-list[\s\S]{0,400}text: 'Remove'/.test(designerSrc));
assert('CSS edge hit targets', /wfd-edge-hit/.test(cssSrc));
assert('CSS compatible target styling', /is-compatible-target/.test(cssSrc));
assert('modal form supports select', /inputType === 'select'/.test(indexHtml));
assert('no n8n branding', !/n8n\.io|powered by n8n/i.test(designerSrc));

const {
  normalizeWorkflowGraph,
  validateWorkflowDefinition,
  detectCycle,
  wouldCreateCycle,
} = require(path.join(root, 'api/lib/configuration/validation/workflow.js'));

{
  const normalized = normalizeWorkflowGraph({
    nodes: [
      { key: 'start', type: 'trigger.request_created', name: 'Request Created' },
      { key: 'fill', type: 'human.fill', name: 'Fill Form' },
    ],
    connections: [
      { key: 'c1', source: 'start', target: 'fill', source_handle: 'out', target_handle: 'in' },
    ],
  });
  assert('normalize persists source_handle', normalized.connections[0].source_handle === 'out');
  assert('normalize maps out → default outcome', normalized.connections[0].outcome_key === 'default');
}

{
  const missing = validateWorkflowDefinition({
    nodes: [
      { key: 'start', type: 'trigger.request_created', name: 'Request Created' },
      { key: 'cond', type: 'logic.condition', name: 'Does Legal approve?', config: {} },
      { key: 'end', type: 'terminal.complete', name: 'Complete' },
    ],
    connections: [
      { key: 'c1', source: 'start', target: 'cond', source_handle: 'out', outcome_key: 'default' },
      { key: 'c2', source: 'cond', target: 'end', source_handle: 'yes', outcome_key: 'yes' },
    ],
  });
  assert(
    'missing No branch blocks publish',
    missing.issues.some((i) => i.code === 'MISSING_OUTCOME_CONNECTION' && /No/.test(i.message))
  );
}

{
  const sequential = validateWorkflowDefinition({
    nodes: [
      { key: 'start', type: 'trigger.request_created', name: 'Request Created' },
      { key: 'fill', type: 'human.fill', name: 'Fill Form' },
      { key: 'end', type: 'terminal.complete', name: 'Complete' },
    ],
    connections: [
      { key: 'c1', source: 'start', target: 'fill', source_handle: 'out', outcome_key: 'default' },
    ],
  });
  assert(
    'missing sequential output blocks publish',
    sequential.issues.some((i) => i.code === 'MISSING_SEQUENTIAL_OUTPUT')
  );
}

{
  const self = validateWorkflowDefinition({
    nodes: [
      { key: 'start', type: 'trigger.request_created', name: 'Start' },
      { key: 'a', type: 'human.fill', name: 'A' },
      { key: 'end', type: 'terminal.complete', name: 'End' },
    ],
    connections: [
      { key: 'c1', source: 'start', target: 'a', source_handle: 'out', outcome_key: 'default' },
      { key: 'c2', source: 'a', target: 'a', source_handle: 'out', outcome_key: 'default' },
      { key: 'c3', source: 'a', target: 'end', source_handle: 'out', outcome_key: 'default' },
    ],
  });
  assert('self-connection rejected', self.issues.some((i) => i.code === 'SELF_CONNECTION'));
}

{
  const nodes = [
    { key: 'a', type: 'human.fill' },
    { key: 'b', type: 'human.review' },
  ];
  const conns = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'a' },
  ];
  assert('raw cycle detected', detectCycle(nodes, conns) === true);
  assert('wouldCreateCycle true for return', wouldCreateCycle(nodes, [{ source: 'a', target: 'b' }], 'b', 'a') === true);
  assert(
    'revision edge excluded from cycle check',
    detectCycle(nodes, [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a', is_revision: true },
    ]) === false
  );
}

{
  const branched = validateWorkflowDefinition({
    nodes: [
      { key: 'start', type: 'trigger.request_created', name: 'Request Created' },
      { key: 'ops', type: 'human.review', name: 'Operations Review' },
      { key: 'cond', type: 'logic.condition', name: 'Approved?', config: {} },
      { key: 'acct', type: 'human.review', name: 'Accounting Review' },
      { key: 'fix', type: 'human.fill', name: 'Return for Corrections' },
      { key: 'end', type: 'terminal.complete', name: 'Complete' },
    ],
    connections: [
      { key: 'c1', source: 'start', target: 'ops', source_handle: 'out', outcome_key: 'default' },
      { key: 'c2', source: 'ops', target: 'cond', source_handle: 'approved', outcome_key: 'approved' },
      { key: 'c3', source: 'ops', target: 'fix', source_handle: 'rejected', outcome_key: 'rejected' },
      { key: 'c4', source: 'cond', target: 'acct', source_handle: 'yes', outcome_key: 'yes' },
      { key: 'c5', source: 'cond', target: 'fix', source_handle: 'no', outcome_key: 'no' },
      { key: 'c6', source: 'acct', target: 'end', source_handle: 'approved', outcome_key: 'approved' },
      { key: 'c7', source: 'acct', target: 'fix', source_handle: 'rejected', outcome_key: 'rejected' },
      { key: 'c8', source: 'fix', target: 'ops', source_handle: 'out', outcome_key: 'default', is_revision: true, label: 'Revision' },
    ],
  });
  const hard = branched.issues.filter((i) => i.severity === 'error' && i.code === 'CYCLE_REJECTED');
  assert('valid branched + revision publishes without cycle error', hard.length === 0, JSON.stringify(branched.issues.filter((i) => i.severity === 'error')));
}

// Designer geometry + handles via VM
{
  const sandbox = { window: {}, console };
  sandbox.window.window = sandbox.window;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(designerSrc, sandbox, { filename: 'hub-workflow-designer.js' });
  const D = sandbox.window.HubWorkflowDesigner;
  assert('HubWorkflowDesigner exported', !!D);

  const start = { key: 'start', type: 'trigger.request_created', name: 'Start', x: 10, y: 20 };
  const review = { key: 'rev', type: 'human.review', name: 'Review', x: 100, y: 40, config: {} };
  const cond = { key: 'cond', type: 'logic.condition', name: 'Cond', x: 200, y: 40, config: {} };
  const end = { key: 'end', type: 'terminal.complete', name: 'Done', x: 300, y: 40 };

  assert('start has only Continue output', D.nodeHandles(start).length === 1 && D.nodeHandles(start)[0].id === 'out');
  assert('review has Approved+Rejected', D.nodeHandles(review).filter((h) => h.side === 'right').map((h) => h.id).join(',') === 'approved,rejected');
  assert('condition has yes/no', D.nodeHandles(cond).filter((h) => h.side === 'right').map((h) => h.id).join(',') === 'yes,no');
  assert('terminal has no outputs', D.nodeHandles(end).every((h) => h.side === 'left'));

  const p1 = D.handlePoint(review, 'approved');
  const moved = { ...review, x: review.x + 50 };
  const p2 = D.handlePoint(moved, 'approved');
  assert('moving source updates handle point', p2.x === p1.x + 50 && p2.y === p1.y);

  const graph = {
    nodes: [start, review, end],
    connections: [
      { key: 'c1', source: 'start', target: 'rev', source_handle: 'out', outcome_key: 'default' },
      { key: 'c2', source: 'rev', target: 'end', source_handle: 'approved', outcome_key: 'approved' },
    ],
  };
  D.autoLayout(graph);
  assert('auto-layout preserves connection count', graph.connections.length === 2);
  assert('auto-layout keeps semantic edges', graph.connections.every((c) => c.source && c.target && c.source_handle));
}

// Runtime uses outcome_key, not position
{
  const engineSrc = fs.readFileSync(path.join(root, 'api/lib/configuration/runtime/engine.js'), 'utf8');
  assert('runtime matches by outcome_key', /outcome_key === outcomeKey/.test(engineSrc));
  assert('runtime does not sort by x position', !/sort\(.*\.x/.test(engineSrc));
}

console.log('\nWOS-97 results: ' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
