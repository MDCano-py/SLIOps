#!/usr/bin/env node
/**
 * WOS-95 — curated workflow designer, dialogs, document/dashboard UX tests
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

console.log('\n=== WOS-95 Curated Workflow Designer & UI Refinement Test ===\n');

const criticalFiles = [
  'hub-configuration-center.js',
  'hub-workflow-designer.js',
  'hub.js',
];

criticalFiles.forEach((f) => {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  assert(f + ' has no window.prompt(', !/\bwindow\.prompt\s*\(/.test(src));
  assert(f + ' has no window.confirm(', !/\bwindow\.confirm\s*\(/.test(src));
  assert(f + ' has no window.alert(', !/\bwindow\.alert\s*\(/.test(src));
});

const cfg = fs.readFileSync(path.join(root, 'hub-configuration-center.js'), 'utf8');
assert('create draft uses streamlineModal.form', /modal\.form\(/.test(cfg) || /streamlineModal[\s\S]*\.form\(/.test(cfg));
assert('archive uses wosConfirm / streamlineModal', /wosConfirm|streamlineModal/.test(cfg) && !/if\s*\(\s*!confirm\(/.test(cfg));
assert('Archive lives in More menu', /text: 'More'/.test(cfg) && /text: 'Archive'/.test(cfg));
assert('breadcrumb / back action present', /cfg-breadcrumb|cfg-back-btn/.test(cfg));
assert('unsaved state model present', /Unsaved changes|markDirty|cfg-unsaved/.test(cfg));
assert('workflow uses HubWorkflowDesigner', /HubWorkflowDesigner/.test(cfg) && /Designer\.mount|\.mount\(host/.test(cfg));
assert('document structured blocks default', /Document structure|blocks\.push/.test(cfg));
assert('dashboard widget structure + live preview', /Widget structure|Live dashboard preview/.test(cfg));
assert('no permanent Delete button in config workflow canvas', !/text: 'Delete'/.test(cfg) || /Remove node/.test(cfg));

const designerSrc = fs.readFileSync(path.join(root, 'hub-workflow-designer.js'), 'utf8');
assert('designer has curated categories', /Start/.test(designerSrc) && /People/.test(designerSrc) && /Decisions/.test(designerSrc));
assert('designer has minimap', /wfd-minimap/.test(designerSrc));
assert('designer has outline', /wfd-outline/.test(designerSrc));
assert('designer has fit/auto-layout', /fitToView|autoLayout/.test(designerSrc));
assert('designer blocks second start', /Replace start|countStarts/.test(designerSrc));
assert('mode-specific assignment forms', /Who should complete this step|specific_user|request_creator/.test(designerSrc));
assert('no n8n product branding/assets', !/n8n\.io|powered by n8n|N8N Logo/i.test(designerSrc));
assert('no .ee. path references as imports', !/\.ee\./.test(designerSrc));

const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert('portalSignOut uses streamlineModal', /portalSignOut[\s\S]{0,400}streamlineModal/.test(indexHtml));
assert('sign-out copy present', /You will need to sign in again to access the Operations Workflow Hub/.test(indexHtml));
assert('streamlineModal.form exists', /form\(opts\)\s*\{/.test(indexHtml));
assert('hub-workflow-designer.js loaded', /hub-workflow-designer\.js/.test(indexHtml));
assert('focusCancel supported for confirm', /focusCancel/.test(indexHtml));

const hubJs = fs.readFileSync(path.join(root, 'hub.js'), 'utf8');
assert('hub.js sign-out fallback avoids window.confirm', !/window\.confirm\('Are you sure you want to sign out/.test(hubJs));

// Load designer in vm
{
  const sandbox = { window: {}, console };
  sandbox.window.window = sandbox.window;
  sandbox.globalThis = sandbox;
  try {
    vm.runInNewContext(fs.readFileSync(path.join(root, 'hub-workflow-designer.js'), 'utf8'), sandbox, {
      filename: 'hub-workflow-designer.js',
    });
    const D = sandbox.window.HubWorkflowDesigner;
    assert('HubWorkflowDesigner exported', !!D);
    assert('slugifyKey works', D.slugifyKey('Operations Leadership Dashboard') === 'operations_leadership_dashboard');
    assert('slugify strips unsupported', D.slugifyKey('Hello!!! World@@') === 'hello_world');

    const graph = {
      nodes: [
        { key: 'start', type: 'trigger.request_created', name: 'Start', x: 0, y: 0 },
        { key: 'a', type: 'human.review', name: 'Review', x: 0, y: 0, config: {} },
        { key: 'end', type: 'terminal.complete', name: 'Done', x: 0, y: 0 },
      ],
      connections: [
        { key: 'c1', source: 'start', target: 'a', source_handle: 'out', target_handle: 'in', outcome_key: 'default' },
        { key: 'c2', source: 'a', target: 'end', source_handle: 'out', target_handle: 'in', outcome_key: 'default' },
      ],
    };
    D.autoLayout(graph);
    assert('auto-layout positions start leftmost', graph.nodes.find((n) => n.key === 'start').x < graph.nodes.find((n) => n.key === 'a').x);
    assert('auto-layout includes all nodes', graph.nodes.every((n) => n.x != null && n.y != null));

    const p1 = D.handlePoint(graph.nodes[0], 'out');
    const moved = { ...graph.nodes[0], x: graph.nodes[0].x + 40 };
    const p2 = D.handlePoint(moved, 'out');
    assert('moving node updates handle geometry', p2.x === p1.x + 40 && p2.y === p1.y);

    assert('exactly one start counted', D.countStarts(graph) === 1);
    graph.nodes.push({ key: 'start2', type: 'trigger.manual', name: 'Other', x: 10, y: 10 });
    assert('duplicate starts detected', D.countStarts(graph) === 2);

    const html = D.blocksToHtml([
      { type: 'heading', text: 'NDA' },
      { type: 'paragraph', text: 'Hello {{organization.legal_name}}' },
    ]);
    assert('blocksToHtml renders heading', /<h2>NDA<\/h2>/.test(html));
    const preview = D.renderPreviewHtml(html, true);
    assert('sample preview resolves known vars', preview.includes('Streamline Operations LLC'));
    assert('unresolved vars highlighted', D.renderPreviewHtml('{{missing.key}}', true).includes('is-unresolved'));
  } catch (err) {
    assert('HubWorkflowDesigner exported', false, err.message);
  }
}

// Config center loads
{
  const sandbox = {
    window: {
      document: { getElementById: () => null },
      HubUI: null,
      proxyFetch: null,
      HubWorkflowDesigner: { slugifyKey: (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') },
      streamlineModal: { form: async () => null, confirm: async () => false, alert: async () => true },
    },
    console,
  };
  sandbox.window.window = sandbox.window;
  sandbox.globalThis = sandbox;
  try {
    vm.runInNewContext(cfg, sandbox, { filename: 'hub-configuration-center.js' });
    assert('config center loads', !!sandbox.window.HubConfigurationCenter);
    assert('slugifyKey exported', typeof sandbox.window.HubConfigurationCenter.slugifyKey === 'function');
  } catch (err) {
    assert('config center loads', false, err.message);
  }
}

const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
assert('gitignore ignores reference/n8n', /reference\//.test(gitignore) && /n8n-master\//.test(gitignore));

const audit = fs.readFileSync(path.join(root, 'docs/reports/WOS_95_N8N_REFERENCE_AUDIT.md'), 'utf8');
assert('n8n audit exists', /Sustainable Use License/.test(audit));
assert('audit says no source copied', /No n8n source code was copied|Copied source[\s\S]*None/i.test(audit));
assert('audit confirms no .ee. copied', /No `\.ee\.` source copied|No `\.ee\.` files or directories were opened/i.test(audit));

console.log('\nResults:', passed, 'passed,', failed, 'failed\n');
process.exit(failed ? 1 : 0);
