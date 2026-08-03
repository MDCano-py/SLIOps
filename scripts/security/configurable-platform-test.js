#!/usr/bin/env node
/**
 * WOS-93 configurable platform unit + static readiness tests (no DB required).
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

const { isConfigurablePlatformEnabled, disabledPayload } = require('../../api/lib/configuration/feature-flag');
const { resolveVariables } = require('../../api/lib/configuration/variables/resolver');
const { evaluateCondition, validateConditionShape } = require('../../api/lib/configuration/conditions');
const { validateFormDefinition, validateSubmission } = require('../../api/lib/configuration/validation/form');
const { validateWorkflowDefinition, detectCycle } = require('../../api/lib/configuration/validation/workflow');
const { validateDocumentDefinition } = require('../../api/lib/configuration/validation/document');
const { sanitizeHtml } = require('../../api/lib/configuration/sanitize');
const { idempotencyKey } = require('../../api/lib/configuration/runtime/engine');
const perms = require('../../api/lib/configuration/permissions');
const { listFieldTypes } = require('../../api/lib/configuration/fields/registry');
const { listNodeTypes } = require('../../api/lib/configuration/nodes/registry');

console.log('\n=== WOS-93 Configurable Platform Test ===\n');

// Feature flag
assert('flag off by default', isConfigurablePlatformEnabled({}) === false);
assert('flag on with 1', isConfigurablePlatformEnabled({ CONFIGURABLE_PLATFORM_ENABLED: '1' }) === true);
assert('disabled payload has code', disabledPayload().code === 'CONFIGURABLE_PLATFORM_DISABLED');

// Variables
{
  const r = resolveVariables({
    template: 'Hello {{organization.name}} — {{request.reference_number}}',
    organization: { name: 'Streamline' },
    request: { reference_number: 'NDA-1' },
    mode: 'production',
  });
  assert('variable resolve fills values', r.text === 'Hello Streamline — NDA-1' && r.ok);
}
{
  const r = resolveVariables({
    template: 'X {{missing.var}}',
    mode: 'preview',
  });
  assert('preview shows unresolved', r.text.includes('⟦missing.var⟧') && r.unresolved.includes('missing.var'));
}
{
  const r = resolveVariables({
    template: 'Secret {{custom.token}}',
    customVariables: { 'custom.token': { value: 'abc', sensitive: true } },
    mode: 'preview',
  });
  assert('sensitive variable blocked', r.blocked.length === 1 && !r.text.includes('abc'));
}

// Conditions
{
  const r = evaluateCondition(
    {
      all: [
        {
          left: { type: 'variable', key: 'form.total_cost' },
          operator: 'greater_than',
          right: { type: 'literal', value: 10000 },
        },
      ],
    },
    { formSubmission: { values: { total_cost: 15000 } } }
  );
  assert('condition greater_than true', r.ok && r.value === true);
}
{
  const issues = validateConditionShape({ all: [{ operator: 'explode', left: { type: 'literal', value: 1 } }] });
  assert('unsupported operator rejected', issues.some((i) => i.code === 'UNSUPPORTED_OPERATOR'));
}
{
  let deep = { all: [] };
  let cur = deep;
  for (let i = 0; i < 12; i++) {
    const next = { all: [] };
    cur.all.push(next);
    cur = next;
  }
  const issues = validateConditionShape(deep);
  assert('deep nesting rejected', issues.some((i) => i.code === 'CONDITION_TOO_DEEP'));
}

// Forms
{
  const v = validateFormDefinition({
    fields: [
      { key: 'legal_name', type: 'short_text', label: 'Legal name', required: true },
      { key: 'legal_name', type: 'email', label: 'dup' },
    ],
  });
  assert('duplicate field key rejected', !v.ok && v.issues.some((i) => i.code === 'DUPLICATE_FIELD_KEY'));
}
{
  const def = validateFormDefinition({
    fields: [
      { key: 'title', type: 'short_text', label: 'Title', required: true },
      {
        key: 'explain',
        type: 'long_text',
        label: 'Explain',
        required_condition: {
          all: [
            {
              left: { type: 'variable', key: 'form.total_cost' },
              operator: 'greater_than',
              right: { type: 'literal', value: 10000 },
            },
          ],
        },
      },
      { key: 'total_cost', type: 'currency', label: 'Total', required: true },
    ],
  }).normalized;
  const miss = validateSubmission(def, { title: 'x', total_cost: 12000 });
  assert('conditional required enforced', !miss.ok && miss.issues.some((i) => i.affected === 'explain'));
  const ok = validateSubmission(def, { title: 'x', total_cost: 12000, explain: 'needed' });
  assert('conditional required satisfied', ok.ok);
}

// Workflow
{
  const bad = validateWorkflowDefinition({
    nodes: [
      { key: 'a', type: 'trigger.request_created', name: 'A' },
      { key: 'b', type: 'terminal.complete', name: 'B' },
    ],
    connections: [
      { key: 'c1', source: 'a', target: 'b' },
      { key: 'c2', source: 'b', target: 'a' },
    ],
  });
  assert('cycle rejected on publish validate', !bad.ok && bad.issues.some((i) => i.code === 'CYCLE_REJECTED'));
}
{
  const good = validateWorkflowDefinition({
    nodes: [
      { key: 'start', type: 'trigger.request_created', name: 'Start' },
      { key: 'fill', type: 'human.fill', name: 'Fill' },
      { key: 'done', type: 'terminal.complete', name: 'Done' },
    ],
    connections: [
      { key: 'c1', source: 'start', target: 'fill' },
      { key: 'c2', source: 'fill', target: 'done' },
    ],
  });
  assert('valid sequential workflow passes', good.ok);
}
assert(
  'detectCycle helper',
  detectCycle(
    [{ key: 'a' }, { key: 'b' }],
    [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' },
    ]
  ) === true
);

// Documents / sanitize
{
  const doc = validateDocumentDefinition({
    title: 'NDA',
    body_html: '<p onclick="alert(1)">Hi {{organization.name}}<script>bad()</script></p>',
  });
  assert('document sanitizes script', doc.ok && !doc.normalized.body_html.includes('<script') && !doc.normalized.body_html.includes('onclick'));
}
assert('sanitize strips javascript url', !sanitizeHtml('<a href="javascript:alert(1)">x</a>').includes('javascript:'));

// Permissions
assert('admin can view config', perms.canViewConfiguration(['admin'], false));
assert('employee cannot edit config', !perms.canEditConfiguration(['view_home'], false));
assert('configuration.publish can publish', perms.canPublishConfiguration(['configuration.publish'], false));

// Registries
assert('field registry has short_text', listFieldTypes().some((f) => f.type === 'short_text'));
assert('node registry has terminal.complete', listNodeTypes().some((n) => n.type === 'terminal.complete'));
assert('idempotency key stable', idempotencyKey('i', 'n', 1, 'exec') === 'i:n:1:exec');

// Static wiring
const routes = fs.readFileSync(path.join(root, 'api/lib/hub/routes.js'), 'utf8');
const maintainx = fs.readFileSync(path.join(root, 'api/maintainx.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const hubJs = fs.readFileSync(path.join(root, 'hub.js'), 'utf8');
const rbac = fs.readFileSync(path.join(root, 'rbac-client.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations/013_configurable_platform.sql'), 'utf8');
const envEx = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
const envSt = fs.readFileSync(path.join(root, '.env.staging.example'), 'utf8');

assert('hub routes mount configuration', /handleConfigurationRoutes/.test(routes));
assert('permission catalog includes configuration.view', /configuration\.view/.test(maintainx));
assert('nav has Configuration Center', /hub-configuration/.test(indexHtml) && /Configuration Center/.test(indexHtml));
assert('hash maps configuration', /tab === 'configuration'/.test(indexHtml) || /hub-configuration/.test(indexHtml));
assert('hub.js wires initHubConfigurationCenter', /initHubConfigurationCenter/.test(hubJs));
assert('rbac rules for configuration', /hub-configuration/.test(rbac) && /configuration\.view/.test(rbac));
assert('migration creates cfg_definitions', /CREATE TABLE IF NOT EXISTS cfg_definitions/.test(migration));
assert('migration creates cfg_workflow_instances', /cfg_workflow_instances/.test(migration));
assert('.env.example documents flag', /CONFIGURABLE_PLATFORM_ENABLED/.test(envEx));
assert('.env.staging.example documents flag', /CONFIGURABLE_PLATFORM_ENABLED/.test(envSt));
assert('no eval in configuration lib', !fs.readFileSync(path.join(root, 'api/lib/configuration/conditions.js'), 'utf8').includes('eval('));
assert(
  'no new Function in resolver',
  !/\bnew\s+Function\b/.test(fs.readFileSync(path.join(root, 'api/lib/configuration/variables/resolver.js'), 'utf8'))
);
assert('UI script included', /hub-configuration-center\.js/.test(indexHtml));
assert('report exists', fs.existsSync(path.join(root, 'docs/reports/WOS_93_CONFIGURABLE_PLATFORM_BUILDER_REPORT.md')));
assert('compat strategy exists', fs.existsSync(path.join(root, 'docs/architecture/WOS_93_COMPATIBILITY_STRATEGY.md')));

console.log('\n=== Summary ===');
console.log(`Checks: ${passed} passed, ${failed} failed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
