#!/usr/bin/env node
/**
 * WOS-57 — Functional template builder UI tests (store + UI helpers).
 * Usage: npm run templates:builder-ui-test
 */
const { loadDbEnv } = require('../db/env');
const { newTemplateStarter } = require('../../api/lib/templates/fixtures');
const { validateTemplateVersion } = require('../../api/lib/templates/validator');

loadDbEnv();
process.env.HUB_STORE_MODE = 'postgres';

let passed = 0;
let failed = 0;

function assert(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function loadStore() {
  delete require.cache[require.resolve('../../api/lib/templates/store.js')];
  delete require.cache[require.resolve('../../api/lib/templates/postgres.js')];
  return require('../../api/lib/templates/store.js');
}

async function main() {
  console.log('=== WOS-57 Functional Template Builder UI Test ===\n');

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const { TemplateRegistryUI } = require('../../template-registry-ui.js');
  const starter = newTemplateStarter();
  assert('starter schema validates', validateTemplateVersion(starter).ok);
  assert(
    'description field required in starter',
    starter.schema_json.sections[0].fields.find((f) => f.key === 'description')?.required === true
  );

  const fields = TemplateRegistryUI._test.normalizeFields(starter.schema_json);
  const steps = TemplateRegistryUI._test.normalizeSteps(starter.workflow_json);
  const payload = TemplateRegistryUI._test.buildPayload(fields, steps);
  assert('buildPayload preserves field count', payload.schema_json.sections[0].fields.length === 3);
  assert('buildPayload preserves step count', payload.workflow_json.steps.length === 3);
  assert('Fill step has field_keys', payload.workflow_json.steps[0].field_keys?.length === 3);

  const moved = TemplateRegistryUI._test.moveItem(['a', 'b', 'c'], 1, -1);
  assert('moveItem reorders', moved.join(',') === 'b,a,c');

  const store = await loadStore();
  const testKey = `builder-ui-${Date.now()}`;

  try {
    const { template, draftVersion } = await store.createTemplate({
      key: testKey,
      name: 'Builder UI Test',
      createdBy: 'builder-ui-test@streamlinecorp.com',
      ...starter,
    });
    assert('create template + draft', !!draftVersion.id);

    const updated = await store.updateDraftVersion(draftVersion.id, {
      schema_json: {
        sections: [
          {
            id: 'sec_default',
            title: 'Details',
            description: '',
            fields: [
              ...starter.schema_json.sections[0].fields,
              { id: 'field_priority', key: 'priority', type: 'select', label: 'Priority', required: false, options: ['low', 'high'] },
            ],
          },
        ],
      },
      workflow_json: {
        steps: [
          {
            step_type: 'Fill',
            assignee_role: 'requester',
            field_keys: ['title', 'description', 'requested_by', 'priority'],
          },
          { step_type: 'Review', assignee_role: 'manager' },
          { step_type: 'Approve', assignee_role: 'admin' },
          { step_type: 'Sign', assignee_role: 'requester' },
        ],
      },
    });
    assert('draft update with extra field/step', updated.schema_json.sections[0].fields.length === 4);
    assert('draft update steps count', updated.workflow_json.steps.length === 4);

    const validation = validateTemplateVersion({
      schema_json: updated.schema_json,
      workflow_json: updated.workflow_json,
    });
    assert('updated draft validates', validation.ok);

    const published = await store.publishDraftVersion(updated.id, 'builder-ui-test@streamlinecorp.com');
    assert('publish valid draft', published.status === 'published');
    assert('compiled workflow stored', !!published.compiled_workflow_json?.steps);

    try {
      await store.updateDraftVersion(published.id, { schema_json: { hacked: true } });
      assert('published read-only at store', false);
    } catch (err) {
      assert('published read-only at store', err.code === 'IMMUTABLE');
    }

    const cloned = await store.clonePublishedToDraft(template.id, 'builder-ui-test@streamlinecorp.com');
    assert('clone published to draft', cloned.status === 'draft');

    const listed = await store.listVersionsForTemplate(template.id);
    assert('list versions', listed.length >= 2);
  } finally {
    await store.deleteTemplateForTest(testKey);
  }

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('RESULT: FAIL');
    process.exit(1);
  }
  console.log('RESULT: PASS');
  console.log('Manual UI: #/workflows → New Template → add/reorder fields & steps → Validate → Publish');
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
