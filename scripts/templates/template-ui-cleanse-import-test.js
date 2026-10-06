#!/usr/bin/env node
/**
 * WOS-66 correction — canonical import types + schema-only validation + UI cleanse tests.
 * Usage: npm run templates:ui-cleanse-import-test
 */
const { loadDbEnv } = require('../db/env');
const { sectionedFields } = require('../../api/lib/templates/fixtures');
const {
  importSchemaInput,
  sanitizeText,
  mergeImportedSchema,
  validateImportedSchema,
  CANONICAL_TYPES,
} = require('../../api/lib/templates/schema-import');
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
  console.log('=== WOS-66 Correction — Import + UI Cleanse Test ===\n');

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const sb = require('../../template-section-builder.js');

  const canonicalTypes = {
    sections: [
      {
        title: 'Canonical',
        fields: [
          { key: 'd', label: 'D', type: 'dropdown', options: ['A', 'B'], required: true },
          { key: 'l', label: 'L', type: 'long_text' },
          { key: 'f', label: 'F', type: 'file_ref' },
          { key: 's', label: 'S', type: 'signature_ack', required: true },
        ],
      },
    ],
  };
  const canonResult = importSchemaInput(canonicalTypes);
  const fields = canonResult.schema_json.sections[0].fields;
  assert('canonical dropdown stays dropdown', fields.find((f) => f.key === 'd').type === 'dropdown');
  assert('canonical long_text stays long_text', fields.find((f) => f.key === 'l').type === 'long_text');
  assert('canonical file_ref stays file_ref', fields.find((f) => f.key === 'f').type === 'file_ref');
  assert('canonical signature_ack stays signature_ack', fields.find((f) => f.key === 's').type === 'signature_ack');
  assert('no false warnings for canonical types', !(canonResult.warnings || []).some((w) => /dropdown|long_text|file_ref/.test(w) && /converted/i.test(w)));

  const aliasResult = importSchemaInput({
    sections: [
      {
        title: 'Aliases',
        fields: [
          { key: 'a', label: 'A', type: 'select', options: ['1'] },
          { key: 'b', label: 'B', type: 'textarea' },
          { key: 'c', label: 'C', type: 'file' },
        ],
      },
    ],
  });
  const aliasFields = aliasResult.schema_json.sections[0].fields;
  assert('UI alias select maps to dropdown', aliasFields.find((f) => f.key === 'a').type === 'dropdown');
  assert('UI alias textarea maps to long_text', aliasFields.find((f) => f.key === 'b').type === 'long_text');
  assert('UI alias file maps to file_ref', aliasFields.find((f) => f.key === 'c').type === 'file_ref');
  assert('select alias emits type warning', (aliasResult.warnings || []).some((w) => /select.*dropdown/i.test(w)));
  assert('textarea alias emits type warning', (aliasResult.warnings || []).some((w) => /textarea.*long_text/i.test(w)));
  assert('file alias emits type warning', (aliasResult.warnings || []).some((w) => /file.*file_ref/i.test(w)));

  const schemaOnly = validateImportedSchema(canonResult.schema_json, 'form');
  assert('import schema validation passes without workflow', schemaOnly.ok);
  assert('import schema validation has no EMPTY_STEPS', !(schemaOnly.errors || []).some((e) => e.code === 'EMPTY_STEPS'));

  const fullEmptyWf = validateTemplateVersion({
    schema_json: canonResult.schema_json,
    workflow_json: { steps: [] },
    template_kind: 'form',
  });
  assert('full publish validator still blocks EMPTY_STEPS', !fullEmptyWf.ok && fullEmptyWf.errors.some((e) => e.code === 'EMPTY_STEPS'));

  const flat = importSchemaInput({ fields: [{ key: 'notes', label: 'Notes', type: 'textarea' }] });
  assert('flat fields import wraps into section', flat.ok && flat.schema_json.sections.length === 1);

  const aiStyle = importSchemaInput({
    questions: [
      { title: 'Name', type: 'short_answer', required: true },
      { title: 'PPE', type: 'multiple_choice', choices: ['Hat'] },
    ],
  });
  assert('AI questions map to canonical fields', aiStyle.ok && aiStyle.field_count === 2);

  const xss = importSchemaInput({
    sections: [{ title: '<script>x</script>T', fields: [{ key: 'x', label: '<b>Hi</b>', type: 'text' }] }],
  });
  assert('HTML/script sanitized', xss.ok && !xss.schema_json.sections[0].title.includes('<script'));

  assert('sanitizeText strips tags', sanitizeText('<b>x</b>') === 'x');
  assert('CANONICAL_TYPES includes dropdown', CANONICAL_TYPES.has('dropdown'));

  const store = await loadStore();
  const ts = Date.now();
  const formKey = `ui-import-corr-${ts}`;

  try {
    const { template, draftVersion } = await store.createTemplate({
      key: formKey,
      name: 'Import Correction Test',
      template_kind: 'form',
      createdBy: 'ui-cleanse-test@streamlinecorp.com',
      schema_json: sectionedFields([{ key: 'old_field', type: 'text', label: 'Old', required: true }]),
      workflow_json: { steps: [] },
    });

    const merged = mergeImportedSchema(draftVersion.schema_json, canonResult.schema_json, 'replace');
    const updated = await store.updateDraftVersion(draftVersion.id, {
      schema_json: merged,
      workflow_json: { steps: [{ step_type: 'Fill', assignee_role: 'requester', field_keys: ['d', 'l', 'f', 's'] }] },
    });
    const saved = updated.schema_json.sections[0].fields;
    assert('apply-to-draft saves canonical dropdown', saved.some((f) => f.type === 'dropdown'));
    assert('apply-to-draft saves canonical long_text', saved.some((f) => f.type === 'long_text'));
    assert('apply-to-draft saves canonical file_ref', saved.some((f) => f.type === 'file_ref'));

    const pub = await store.publishDraftVersion(draftVersion.id, 'ui-cleanse-test@streamlinecorp.com');
    assert('imported form publishes after workflow configured', !!pub.compiled_workflow_json);

    const runtimeHtml = sb.renderRuntimeFormHtml({
      title: 'T',
      sections: sb.normalizeSections(updated.schema_json),
      templateKind: 'form',
      spaceKey: 'forms',
      versionNumber: pub.version_number,
    });
    assert('runtime form renders after canonical import', runtimeHtml.includes('tmpl-runtime-form'));

    const previewPanel = sb.renderImportPreviewPanel({
      sections: sb.normalizeSections(canonResult.schema_json),
      sectionCount: 1,
      fieldCount: 4,
      warningsGrouped: canonResult.warnings_grouped,
      validation: schemaOnly,
      publishNotices: ['Workflow steps must be configured before publish.'],
    });
    assert('import preview panel renders section cards', previewPanel.includes('tmpl-import-preview-section'));
    assert('import preview panel shows field types', previewPanel.includes('dropdown'));

    await store.deleteTemplateForTest(formKey);
  } catch (err) {
    try {
      await store.deleteTemplateForTest(formKey);
    } catch (_) {
      /* ignore */
    }
    throw err;
  }

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
