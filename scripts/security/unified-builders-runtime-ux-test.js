#!/usr/bin/env node
/**
 * WOS-94 — Unify builders / global fix / New Request / workflow assignment tests
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

console.log('\n=== WOS-94 Unified Builders & Runtime UX Test ===\n');

// --- P0: global is not defined ---
const cfgSrc = fs.readFileSync(path.join(root, 'hub-configuration-center.js'), 'utf8');
assert(
  'configuration center does not use bare `: global)` fallback',
  !/:\s*global\)\s*;?\s*$/m.test(cfgSrc.split('\n').pop()) && !cfgSrc.includes('? window : global)')
);
assert('configuration center uses globalThis-safe bootstrap', /globalThis/.test(cfgSrc));

const unsafeFooters = [
  'hub-form-renderer.js',
  'rbac-client.js',
  'hub.js',
  'hub-workflow-builder.js',
  'app-spaces-ui.js',
].filter((f) => {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  return src.includes('? window : global)');
});
assert('no unsafe window:global footers remain', unsafeFooters.length === 0, unsafeFooters.join(','));

// Simulate browser load without Node global
{
  const sandbox = {
    window: {
      document: { getElementById: () => null },
      HubUI: null,
      proxyFetch: null,
    },
    console,
  };
  sandbox.window.window = sandbox.window;
  try {
    vm.runInNewContext(cfgSrc, sandbox, { filename: 'hub-configuration-center.js' });
    assert('config center loads without global ReferenceError', !!sandbox.window.HubConfigurationCenter);
    assert(
      'openWorkspaceFormBuilder exported',
      typeof sandbox.window.HubConfigurationCenter.openWorkspaceFormBuilder === 'function'
    );
  } catch (err) {
    assert('config center loads without global ReferenceError', false, err.message);
    assert('openWorkspaceFormBuilder exported', false);
  }
}

// Forms registry is canonical — no Up/Down/Remove primary form editor
assert(
  'forms registry has no Up/Down/Remove field editor',
  /function renderFormsRegistry[\s\S]*?function renderRegistry/.test(cfgSrc) &&
    !/function renderFormsRegistry[\s\S]*?text: 'Up'[\s\S]*?function renderRegistry/.test(cfgSrc)
);
assert('config center opens Workspace Forms builder', /openWorkspaceFormBuilder/.test(cfgSrc) && /TemplateRegistryUI|navigateToTemplateSpace|#\/forms/.test(cfgSrc));
assert('forms section is registry not field editor', /canonical: 'workspace_forms'|Workspace Forms builder/.test(cfgSrc));

// New Request
const nrSrc = fs.readFileSync(path.join(root, 'hub-new-request-registry.js'), 'utf8');
const nr = require('../../hub-new-request-registry.js');
assert('requestTypesFromConfiguration exported', typeof nr.requestTypesFromConfiguration === 'function');
assert('merge prefers request types over forms', (() => {
  const types = nr.requestTypesFromConfiguration([
    { id: '1', key: 'nda_request', name: 'NDA Request', status: 'published', published_version: { payload_json: { display_name: 'NDA Request' } } },
  ]);
  const forms = nr.publishedFormsFromRegistry({
    spaces: [{ key: 'forms', entries: [{ id: 'e1', label: 'Counterparty', template_id: 't1' }] }],
  });
  const merged = nr.mergeNewRequestTypes([{ key: 'work_order', label: 'Work Order', category: 'operations' }], forms, types);
  return merged.some((x) => x.render_mode === 'cfg_request_type') && !merged.some((x) => x.render_mode === 'published_form');
})());
assert('test records filtered', nr.isLikelyTestRecord({ label: 'dd' }) && nr.isLikelyTestRecord({ label: 'test' }));
assert('hub.js loads request types for New Request', /requestTypesFromConfiguration|cfg_request_type/.test(fs.readFileSync(path.join(root, 'hub.js'), 'utf8')));

// Workflow assignment validation
const { validateWorkflowDefinition } = require('../../api/lib/configuration/validation/workflow');
{
  const missing = validateWorkflowDefinition({
    nodes: [
      { key: 'start', type: 'trigger.request_created', name: 'Start' },
      { key: 'review', type: 'human.review', name: 'Legal Review', config: {} },
      { key: 'done', type: 'terminal.complete', name: 'Done' },
    ],
    connections: [
      { key: 'c1', source: 'start', target: 'review' },
      { key: 'c2', source: 'review', target: 'done' },
    ],
  });
  assert('missing assignment blocks publish validation', !missing.ok && missing.issues.some((i) => i.code === 'MISSING_ASSIGNMENT'));
}
{
  const ok = validateWorkflowDefinition({
    nodes: [
      { key: 'start', type: 'trigger.request_created', name: 'Start' },
      {
        key: 'review',
        type: 'human.review',
        name: 'Legal Review',
        config: { assignment: { mode: 'role', role_key: 'legal', fallback: 'hub_admin' }, assignee_role: 'legal' },
      },
      { key: 'done', type: 'terminal.complete', name: 'Done' },
    ],
    connections: [
      { key: 'c1', source: 'start', target: 'review' },
      { key: 'c2', source: 'review', target: 'done' },
    ],
  });
  assert('assigned human node validates', ok.ok);
}

// Workflow canvas helpers present
assert('workflow auto-layout present', /function autoLayout|Auto-layout/.test(cfgSrc));
assert('workflow handles present', /nodeHandles|source_handle|cfg-wf-handle/.test(cfgSrc));
assert('assignment inspector present', /Assignment preview|specific_user|shared_queue/.test(cfgSrc));
assert('document live preview present', /Live preview|cfg-doc-preview/.test(cfgSrc));
assert('dashboard live preview present', /cfg-dash-preview/.test(cfgSrc));
assert('published read-only banner copy', /Clone it to a draft to make changes/.test(cfgSrc));

// My Tasks configurable
assert('My Tasks loads configurable workflow tasks', /workflow-runtime\/tasks/.test(fs.readFileSync(path.join(root, 'hub.js'), 'utf8')));

// Report
assert(
  'WOS-94 report exists',
  fs.existsSync(path.join(root, 'docs/reports/WOS_94_UNIFIED_CONFIGURATION_BUILDERS_AND_RUNTIME_UX_REPORT.md'))
);

console.log('\n=== Summary ===');
console.log(`Checks: ${passed} passed, ${failed} failed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
