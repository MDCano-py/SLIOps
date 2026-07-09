#!/usr/bin/env node
/**
 * WOS-56 — Template publish validator + compiled workflow contract tests.
 * Usage: npm run templates:validator-test
 */
const { loadDbEnv } = require('../db/env');
const { validateTemplateVersion } = require('../../api/lib/templates/validator');
const { compileTemplateVersion } = require('../../api/lib/templates/compile-workflow');
const { basicInternalApprovalFixture } = require('../../api/lib/templates/fixtures');

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

async function expectPublishError(name, store, versionId, code) {
  try {
    await store.publishDraftVersion(versionId, 'validator-test@streamlinecorp.com');
    assert(name, false, 'expected publish to fail');
  } catch (err) {
    assert(name, err.code === code, `${err.code}: ${err.message}`);
    if (code === 'VALIDATION_FAILED') {
      assert(`${name} has errors`, Array.isArray(err.details?.errors) && err.details.errors.length > 0);
    }
  }
}

async function loadStore() {
  delete require.cache[require.resolve('../../api/lib/templates/store.js')];
  delete require.cache[require.resolve('../../api/lib/templates/postgres.js')];
  return require('../../api/lib/templates/store.js');
}

function validFixture(key) {
  return basicInternalApprovalFixture({ key });
}

async function main() {
  console.log('=== WOS-56 Template Publish Validator Test ===\n');

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const store = await loadStore();
  const testKey = `validator-test-${Date.now()}`;
  const fixture = validFixture(testKey);

  // --- Unit validator cases (no DB) ---
  const unitValid = validateTemplateVersion({
    schema_json: fixture.schema_json,
    workflow_json: fixture.workflow_json,
  });
  assert('unit: valid template passes validation', unitValid.ok);

  const dupKey = validateTemplateVersion({
    schema_json: {
      fields: [
        { key: 'title', type: 'text', label: 'A', required: true },
        { key: 'title', type: 'text', label: 'B', required: false },
      ],
    },
    workflow_json: fixture.workflow_json,
  });
  assert('unit: duplicate field key fails', !dupKey.ok);
  assert('unit: duplicate field key code', dupKey.errors.some((e) => e.code === 'DUPLICATE_FIELD_KEY'));

  const badKey = validateTemplateVersion({
    schema_json: {
      fields: [{ key: '1bad', type: 'text', label: 'Bad', required: true }],
    },
    workflow_json: fixture.workflow_json,
  });
  assert('unit: invalid field key fails', !badKey.ok);

  const unknownType = validateTemplateVersion({
    schema_json: {
      fields: [{ key: 'foo', type: 'magic', label: 'Foo', required: true }],
    },
    workflow_json: fixture.workflow_json,
  });
  assert('unit: unknown field type fails', !unknownType.ok);

  const selectNoOpts = validateTemplateVersion({
    schema_json: {
      fields: [{ key: 'pick', type: 'select', label: 'Pick', required: true }],
    },
    workflow_json: fixture.workflow_json,
  });
  assert('unit: select without options fails', !selectNoOpts.ok);

  assert('unit: missing fields array fails', !validateTemplateVersion({ schema_json: {}, workflow_json: fixture.workflow_json }).ok);
  assert('unit: missing workflow steps fails', !validateTemplateVersion({ schema_json: fixture.schema_json, workflow_json: {} }).ok);

  const unknownStep = validateTemplateVersion({
    schema_json: fixture.schema_json,
    workflow_json: { steps: [{ step_type: 'Teleport', assignee_role: 'admin' }] },
  });
  assert('unit: unknown step type fails', !unknownStep.ok);

  const noFill = validateTemplateVersion({
    schema_json: fixture.schema_json,
    workflow_json: { steps: [{ step_type: 'Review', assignee_role: 'manager' }] },
  });
  assert('unit: missing Fill step fails', !noFill.ok);

  const reviewFirst = validateTemplateVersion({
    schema_json: fixture.schema_json,
    workflow_json: {
      steps: [
        { step_type: 'Review', assignee_role: 'manager' },
        { step_type: 'Fill', assignee_role: 'requester' },
      ],
    },
  });
  assert('unit: Review before Fill fails', !reviewFirst.ok);

  const signNoRole = validateTemplateVersion({
    schema_json: fixture.schema_json,
    workflow_json: {
      steps: [
        { step_type: 'Fill', assignee_role: 'requester' },
        { step_type: 'Sign' },
      ],
    },
  });
  assert('unit: Sign without assignee_role fails', !signNoRole.ok);

  const badRole = validateTemplateVersion({
    schema_json: fixture.schema_json,
    workflow_json: {
      steps: [
        { step_type: 'Fill', assignee_role: 'requester' },
        { step_type: 'Review', assignee_role: 'unknown_role' },
      ],
    },
  });
  assert('unit: unknown assignee role fails', !badRole.ok);

  const badFieldRef = validateTemplateVersion({
    schema_json: fixture.schema_json,
    workflow_json: {
      steps: [
        { step_type: 'Fill', assignee_role: 'requester', field_keys: ['missing_field'] },
      ],
    },
  });
  assert('unit: step references missing field key fails', !badFieldRef.ok);

  const compiled = compileTemplateVersion({
    schema_json: fixture.schema_json,
    workflow_json: fixture.workflow_json,
    template_kind: 'workflow',
  });
  assert('unit: compile has fields and steps', compiled.fields.length === 3 && compiled.steps.length === 3);
  assert('unit: compile has sections', Array.isArray(compiled.sections) && compiled.sections[0].fields.length === 3);
  assert('unit: compile template_kind', compiled.template_kind === 'workflow');
  assert('unit: compile Fill has field_keys', compiled.steps[0].field_keys?.length >= 3);
  assert('unit: compile Review has action', compiled.steps[1].action === 'review');

  try {
    const { template, draftVersion } = await store.createTemplate({
      ...fixture,
      createdBy: 'validator-test@streamlinecorp.com',
    });

    const published = await store.publishDraftVersion(draftVersion.id, 'validator-test@streamlinecorp.com');
    assert('valid template publishes successfully', published.status === 'published');
    assert('publish writes validation_json', published.validation_json?.ok === true);
    assert('publish writes compiled_workflow_json', published.compiled_workflow_json?.version === 1);
    assert('compiled has normalized step types', published.compiled_workflow_json.steps[0].step_type === 'Fill');

    const sub = await store.createSubmission({
      templateId: template.id,
      data_json: { title: 'Test', requested_by: 'User' },
      createdBy: 'validator-test@streamlinecorp.com',
    });
    assert('submission uses compiled workflow step order', sub.stepInstances.map((s) => s.step_index).join(',') === '0,1,2');
    assert('submission step types from compiled contract', sub.stepInstances[0].step_type === 'Fill');

    await expectPublishError('published version remains immutable', store, published.id, 'NOT_DRAFT');

    // Invalid publish leaves draft
    const badKey2 = `validator-bad-${Date.now()}`;
    const { draftVersion: badDraft } = await store.createTemplate({
      ...validFixture(badKey2),
      schema_json: {
        fields: [
          { key: 'title', type: 'text', label: 'Title', required: true },
          { key: 'title', type: 'text', label: 'Dup', required: false },
        ],
      },
      createdBy: 'validator-test@streamlinecorp.com',
    });
    await expectPublishError('failed publish leaves version as draft', store, badDraft.id, 'VALIDATION_FAILED');
    const stillDraft = await store.getVersion(badDraft.id);
    assert('version still draft after failed publish', stillDraft.status === 'draft');
    await store.deleteTemplateForTest(badKey2);

    // Version pinning after v2 publish
    const pinKey = `validator-pin-${Date.now()}`;
    const pinFixture = validFixture(pinKey);
    const { template: pinTpl, draftVersion: pinDraft1 } = await store.createTemplate({
      ...pinFixture,
      createdBy: 'validator-test@streamlinecorp.com',
    });
    const v1 = await store.publishDraftVersion(pinDraft1.id, 'validator-test@streamlinecorp.com');
    const sub1 = await store.createSubmission({
      templateId: pinTpl.id,
      data_json: { title: 'V1 sub', requested_by: 'A' },
      createdBy: 'validator-test@streamlinecorp.com',
    });
    const draft2 = await store.clonePublishedToDraft(pinTpl.id, 'validator-test@streamlinecorp.com');
    await store.updateDraftVersion(draft2.id, {
      schema_json: {
        sections: [
          {
            id: 'sec_default',
            title: 'Details',
            description: '',
            fields: [
              ...pinFixture.schema_json.sections[0].fields,
              { id: 'field_notes', key: 'notes', type: 'textarea', label: 'Notes', required: false },
            ],
          },
        ],
      },
      workflow_json: {
        steps: [
          {
            step_type: 'Fill',
            assignee_role: 'requester',
            field_keys: ['title', 'description', 'requested_by', 'notes'],
          },
          { step_type: 'Review', assignee_role: 'manager' },
          { step_type: 'Sign', assignee_role: 'legal' },
        ],
      },
    });
    await store.publishDraftVersion(draft2.id, 'validator-test@streamlinecorp.com');
    const sub1Reload = await store.getSubmissionWithVersion(sub1.submission.id);
    assert('old submission remains pinned to version 1', sub1Reload.templateVersion.id === v1.id);
    await store.deleteTemplateForTest(pinKey);
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
