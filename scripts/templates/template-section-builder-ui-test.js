#!/usr/bin/env node
/**
 * WOS-61 — Section builder UI helpers + sectioned draft/publish tests.
 * Usage: npm run templates:section-builder-ui-test
 */
const { loadDbEnv } = require('../db/env');
const { validateTemplateVersion } = require('../../api/lib/templates/validator');
const { compileTemplateVersion } = require('../../api/lib/templates/compile-workflow');

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
  delete require.cache[require.resolve('../../api/lib/templates/bindings-postgres.js')];
  return require('../../api/lib/templates/store.js');
}

async function main() {
  console.log('=== WOS-61 Section Builder UI Test ===\n');

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const sb = require('../../template-section-builder.js');
  const { TemplateRegistryUI } = require('../../template-registry-ui.js');
  const t = TemplateRegistryUI._test;

  const safetyStarter = t.SAFETY_FORM_STARTER;
  const sections = t.normalizeSections(safetyStarter.schema_json);
  assert('safety starter has 4 sections', sections.length === 4);
  assert('safety section titles', sections.map((s) => s.title).join('|') === 'Job Information|Hazard Review|PPE / Controls|Signatures');

  let working = sections.map((s) => ({ ...s, fields: (s.fields || []).map((f) => ({ ...f })) }));
  working.push({
    id: 'sec_extra',
    title: 'Extra Section',
    description: 'Added in test',
    collapsed: false,
    fields: [],
  });
  working = sb.moveItem(working, working.length - 1, -1);
  assert('reorder sections via moveItem', working[3].id === 'sec_extra');

  working[0].title = 'Job Information (renamed)';
  working[1].fields.push({
    id: 'field_moved',
    key: 'moved_field',
    label: 'Moved Field',
    type: 'text',
    required: false,
    options: [],
  });
  const movedField = working[1].fields.pop();
  working[2].fields.push(movedField);
  assert('move field between sections', working[2].fields.some((f) => f.key === 'moved_field'));

  const dupPayload = sb.buildPayloadFromSections(
    [
      {
        id: 'sec_a',
        title: 'A',
        description: '',
        fields: [{ id: 'f1', key: 'dup', label: 'A', type: 'text', required: true }],
      },
      {
        id: 'sec_b',
        title: 'B',
        description: '',
        fields: [{ id: 'f2', key: 'dup', label: 'B', type: 'text', required: true }],
      },
    ],
    [{ step_type: 'Fill', assignee_role: 'requester', field_keys: ['dup'] }]
  );
  const dupVal = validateTemplateVersion({ ...dupPayload, template_kind: 'form' });
  assert('duplicate field keys across sections fail validation', !dupVal.ok);
  assert('duplicate key error references code', dupVal.errors.some((e) => e.code === 'DUPLICATE_FIELD_KEY'));

  const previewHtml = sb.renderPreviewHtml({
    title: 'Safety Preview',
    templateKind: 'form',
    sections: working,
    bindingMode: 'optional',
  });
  assert('preview renderer returns shell html', previewHtml.includes('tmpl-preview-shell'));
  assert('preview shows section cards', previewHtml.includes('tmpl-preview-section-card'));
  assert('preview shows submit footer', previewHtml.includes('Submit preview'));
  assert('preview does not crash on signature field', !previewHtml.includes('undefined'));

  const formatted = sb.formatValidationErrors(dupVal.errors, working);
  assert('validation UX includes section context', formatted.includes('Section:') || formatted.includes('code'));

  const store = await loadStore();
  const testKey = `section-builder-ui-${Date.now()}`;

  try {
    const { template, draftVersion } = await store.createTemplate({
      key: testKey,
      name: 'Section Builder UI Test',
      createdBy: 'section-builder-ui-test@streamlinecorp.com',
      template_kind: 'form',
      schema_json: sb.buildPayloadFromSections(working, safetyStarter.workflow_json.steps).schema_json,
      workflow_json: safetyStarter.workflow_json,
    });
    assert('create sectioned draft', !!draftVersion.id);

    const reloaded = await store.getVersion(draftVersion.id);
    const reloadedSections = t.normalizeSections(reloaded.schema_json);
    assert('sectioned schema reloads', reloadedSections.length === working.length);
    assert('section order persists on reload', reloadedSections[0].title === 'Job Information (renamed)');
    assert('field in moved section persists', reloadedSections[2].fields.some((f) => f.key === 'moved_field'));

    const published = await store.publishDraftVersion(draftVersion.id, 'section-builder-ui-test@streamlinecorp.com');
    assert('publish sectioned draft', published.status === 'published');

    const compiled = published.compiled_workflow_json || compileTemplateVersion(published);
    assert('compiled contract has sections array', Array.isArray(compiled.sections) && compiled.sections.length >= 4);
    assert(
      'compiled contract preserves section boundaries',
      compiled.sections.some((s) => s.id === 'sec_job_info') && compiled.sections.some((s) => s.id === 'sec_signatures')
    );
    assert('compiled flat fields include moved field', compiled.fields.some((f) => f.key === 'moved_field'));

    const wfKey = `wf-bind-${Date.now()}`;
    const { template: wfTemplate, draftVersion: wfDraft } = await store.createTemplate({
      key: wfKey,
      name: 'Binding Workflow',
      createdBy: 'section-builder-ui-test@streamlinecorp.com',
      template_kind: 'workflow',
      ...t.starterForSpace('workflows'),
    });
    const wfPub = await store.publishDraftVersion(wfDraft.id, 'section-builder-ui-test@streamlinecorp.com');
    const optional = await store.upsertTemplateBinding(template.id, {
      binding_mode: 'optional',
      workflow_template_id: wfTemplate.id,
      source_space_key: 'forms',
    });
    assert('workflow binding still works', optional.binding_mode === 'optional' && optional.binding?.workflow_template_id === wfTemplate.id);

    try {
      await store.updateDraftVersion(published.id, { schema_json: { hacked: true } });
      assert('published version read-only', false);
    } catch (err) {
      assert('published version read-only', err.code === 'IMMUTABLE');
    }

    await store.deleteTemplateBinding(template.id);
    await store.deleteTemplateForTest(testKey);
    await store.deleteTemplateForTest(wfKey);
  } catch (err) {
    try {
      await store.deleteTemplateForTest(testKey);
    } catch {
      /* ignore */
    }
    throw err;
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
