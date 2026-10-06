#!/usr/bin/env node
/**
 * WOS-55 — Template version data model + copy-on-write publish logic.
 * Usage: npm run templates:versioning-test
 */
const { loadDbEnv } = require('../db/env');
const { basicInternalApprovalFixture } = require('../../api/lib/templates/fixtures');
const { flattenSchemaFields } = require('../../api/lib/templates/schema-normalize');

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

async function expectError(name, fn, code) {
  try {
    await fn();
    assert(name, false, 'expected error');
  } catch (err) {
    assert(name, !code || err.code === code, err.message);
  }
}

async function loadStore() {
  delete require.cache[require.resolve('../../api/lib/templates/store.js')];
  delete require.cache[require.resolve('../../api/lib/templates/postgres.js')];
  return require('../../api/lib/templates/store.js');
}

async function main() {
  console.log('=== WOS-55 Template Versioning Test ===\n');

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const store = await loadStore();
  assert('template store postgres mode', store.isTemplatePostgresMode());

  const health = await store.healthCheck();
  assert('template store health', health.ok && health.table);

  const testKey = `template-test-${Date.now()}`;
  const fixture = basicInternalApprovalFixture({ key: testKey });

  try {
    const { template, draftVersion } = await store.createTemplate({
      ...fixture,
      createdBy: 'templates-test@streamlinecorp.com',
    });
    assert('create template', !!template.id);
    assert('create template creates draft', draftVersion.status === 'draft');
    assert('draft has null version_number', draftVersion.version_number == null);

    const v1 = await store.publishDraftVersion(draftVersion.id, 'templates-test@streamlinecorp.com');
    assert('publish version 1', v1.status === 'published' && v1.version_number === 1);
    assert('compiled workflow on publish', Array.isArray(v1.compiled_workflow_json?.steps));
    assert('compiled workflow step count', v1.compiled_workflow_json.steps.length === 3);
    assert('compiled workflow has fields', Array.isArray(v1.compiled_workflow_json.fields));
    assert('validation_json stored on publish', v1.validation_json?.ok === true);

    const tplAfterV1 = await store.getTemplate(template.id);
    assert('current_published_version_id set', tplAfterV1.current_published_version_id === v1.id);

    await expectError('published version cannot be edited', () =>
      store.updateDraftVersion(v1.id, { schema_json: { hacked: true } }), 'IMMUTABLE');

    const sub1 = await store.createSubmission({
      templateId: template.id,
      data_json: { title: 'First submission', requested_by: 'Alice' },
      createdBy: 'alice@streamlinecorp.com',
    });
    assert('submission pins version 1', sub1.templateVersion.id === v1.id);
    assert('submission id set', !!sub1.submission.id);
    assert('workflow step instances created', sub1.stepInstances.length === 3);
    assert('step instances ordered', sub1.stepInstances[0].step_index === 0);
    assert('step types from workflow', sub1.stepInstances.map((s) => s.step_type).join(',') === 'Fill,Review,Sign');

    const draft2 = await store.clonePublishedToDraft(template.id, 'templates-test@streamlinecorp.com');
    assert('clone published to draft', draft2.status === 'draft');
    assert('clone is new row', draft2.id !== v1.id);

    const editedDraft = await store.updateDraftVersion(draft2.id, {
      schema_json: {
        sections: [
          {
            id: 'sec_default',
            title: 'Details',
            description: '',
            fields: [
              ...fixture.schema_json.sections[0].fields,
              {
                id: 'field_priority',
                key: 'priority',
                type: 'select',
                label: 'Priority',
                required: false,
                options: ['low', 'medium', 'high'],
              },
            ],
          },
        ],
      },
    });
    assert('draft can be edited', flattenSchemaFields(editedDraft.schema_json).length === 4);

    const v2 = await store.publishDraftVersion(draft2.id, 'templates-test@streamlinecorp.com');
    assert('publish version 2', v2.version_number === 2);
    assert('v2 schema has priority field', flattenSchemaFields(v2.schema_json).some((f) => f.key === 'priority'));

    const tplAfterV2 = await store.getTemplate(template.id);
    assert('current published updated to v2', tplAfterV2.current_published_version_id === v2.id);

    const sub1Reload = await store.getSubmissionWithVersion(sub1.submission.id);
    assert('old submission still version 1', sub1Reload.templateVersion.id === v1.id);
    assert(
      'old submission schema unchanged',
      !flattenSchemaFields(sub1Reload.templateVersion.schema_json).some((f) => f.key === 'priority')
    );

    const sub2 = await store.createSubmission({
      templateId: template.id,
      data_json: { title: 'Second submission', requested_by: 'Bob', priority: 'high' },
      createdBy: 'bob@streamlinecorp.com',
    });
    assert('new submission pins version 2', sub2.templateVersion.id === v2.id);

    const retiredV1 = await store.retirePublishedVersion(v1.id, 'templates-test@streamlinecorp.com');
    assert('retire version 1', retiredV1.status === 'retired');

    const sub1AfterRetire = await store.getSubmissionWithVersion(sub1.submission.id);
    assert('retired v1 submission still loads', sub1AfterRetire.templateVersion.id === v1.id);
    assert('retired v1 schema still readable', flattenSchemaFields(sub1AfterRetire.templateVersion.schema_json).length === 3);

    await store.archiveTemplate(template.id, 'templates-test@streamlinecorp.com');
    await expectError('archived template blocks new submissions', () =>
      store.createSubmission({
        templateId: template.id,
        data_json: { title: 'Blocked' },
        createdBy: 'test@streamlinecorp.com',
      }), 'ARCHIVED');
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
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
