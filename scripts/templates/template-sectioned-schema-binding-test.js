#!/usr/bin/env node
/**
 * WOS-60 — Sectioned schema + optional workflow binding tests.
 * Usage: npm run templates:section-binding-test
 */
const { loadDbEnv } = require('../db/env');
const { normalizeSchemaJson } = require('../../api/lib/templates/schema-normalize');
const { validateTemplateVersion } = require('../../api/lib/templates/validator');
const { compileTemplateVersion } = require('../../api/lib/templates/compile-workflow');
const { inferTemplateKind, kindForSpace } = require('../../api/lib/templates/template-kind');
const { basicInternalApprovalFixture, sectionedFields } = require('../../api/lib/templates/fixtures');

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
  console.log('=== WOS-60 Sectioned Schema + Workflow Binding Test ===\n');

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const legacyFlat = {
    fields: [
      { key: 'title', type: 'text', label: 'Title', required: true },
      { key: 'notes', type: 'textarea', label: 'Notes', required: false },
    ],
  };
  const normLegacy = normalizeSchemaJson(legacyFlat);
  assert('legacy flat normalizes to one section', normLegacy.ok && normLegacy.schema_json.sections.length === 1);
  assert('legacy flat default section id', normLegacy.schema_json.sections[0].id === 'sec_default');
  assert('legacy flat assigns field ids', normLegacy.schema_json.sections[0].fields.every((f) => f.id));

  const sectioned = sectionedFields([
    { key: 'a', type: 'text', label: 'A', required: true },
    { key: 'b', type: 'text', label: 'B', required: true },
  ]);
  const valid = validateTemplateVersion({
    schema_json: sectioned,
    workflow_json: { steps: [{ step_type: 'Fill', assignee_role: 'requester', field_keys: ['a', 'b'] }] },
    template_kind: 'form',
  });
  assert('sectioned schema validates', valid.ok);

  const dupKeys = validateTemplateVersion({
    schema_json: {
      sections: [
        {
          id: 'sec_a',
          title: 'A',
          description: '',
          fields: [{ id: 'field_a', key: 'dup', type: 'text', label: 'A', required: true }],
        },
        {
          id: 'sec_b',
          title: 'B',
          description: '',
          fields: [{ id: 'field_b', key: 'dup', type: 'text', label: 'B', required: true }],
        },
      ],
    },
    workflow_json: { steps: [{ step_type: 'Fill', assignee_role: 'requester', field_keys: ['dup'] }] },
    template_kind: 'form',
  });
  assert('duplicate field keys across sections fail', !dupKeys.ok);
  assert('duplicate key error code', dupKeys.errors.some((e) => e.code === 'DUPLICATE_FIELD_KEY'));

  const dupIds = validateTemplateVersion({
    schema_json: {
      sections: [
        {
          id: 'sec_a',
          title: 'A',
          description: '',
          fields: [{ id: 'field_same', key: 'a', type: 'text', label: 'A', required: true }],
        },
        {
          id: 'sec_b',
          title: 'B',
          description: '',
          fields: [{ id: 'field_same', key: 'b', type: 'text', label: 'B', required: true }],
        },
      ],
    },
    workflow_json: { steps: [{ step_type: 'Fill', assignee_role: 'requester', field_keys: ['a', 'b'] }] },
    template_kind: 'form',
  });
  assert('duplicate field ids across sections fail', !dupIds.ok);

  const malformed = validateTemplateVersion({
    schema_json: { sections: [{ id: 'sec_x', title: '', fields: [] }] },
    workflow_json: { steps: [{ step_type: 'Fill', assignee_role: 'requester' }] },
    template_kind: 'form',
  });
  assert('malformed section fails', !malformed.ok);

  assert('infer form from forms space', inferTemplateKind({ launch_config_json: { space_key: 'forms' } }) === 'form');
  assert('infer document from documents space', inferTemplateKind({ launch_config_json: { space_key: 'documents' } }) === 'document');
  assert('infer workflow from workflows space', inferTemplateKind({ launch_config_json: { space_key: 'workflows' } }) === 'workflow');
  assert('kindForSpace documents', kindForSpace('documents') === 'document');

  const store = await loadStore();
  const ts = Date.now();
  const formKey = `wos60-form-${ts}`;
  const docKey = `wos60-doc-${ts}`;
  const wfKey = `wos60-wf-${ts}`;
  const unpubKey = `wos60-wf-unpub-${ts}`;

  try {
    const formStarter = {
      template_kind: 'form',
      schema_json: sectionedFields(
        [
          { key: 'form_title', type: 'text', label: 'Form Title', required: true },
          { key: 'submitted_by', type: 'text', label: 'Submitted By', required: true },
        ],
        'Form Details'
      ),
      workflow_json: {
        steps: [{ step_type: 'Fill', assignee_role: 'requester', field_keys: ['form_title', 'submitted_by'] }],
      },
    };
    const { template: formTpl, draftVersion: formDraft } = await store.createTemplate({
      key: formKey,
      name: 'WOS60 Form',
      createdBy: 'section-binding-test@streamlinecorp.com',
      ...formStarter,
    });
    const formPub = await store.publishDraftVersion(formDraft.id, 'section-binding-test@streamlinecorp.com');
    assert('form publishes without binding', formPub.status === 'published');
    assert('form compiled has sections', Array.isArray(formPub.compiled_workflow_json?.sections));
    assert('compiled preserves section order', formPub.compiled_workflow_json.sections[0].title === 'Form Details');
    assert('compiled compatibility fields array', formPub.compiled_workflow_json.fields.length === 2);

    const docStarter = {
      template_kind: 'document',
      schema_json: sectionedFields([{ key: 'document_title', type: 'text', label: 'Document Title', required: true }]),
      workflow_json: { steps: [{ step_type: 'Fill', assignee_role: 'requester', field_keys: ['document_title'] }] },
    };
    const { template: docTpl, draftVersion: docDraft } = await store.createTemplate({
      key: docKey,
      name: 'WOS60 Document',
      createdBy: 'section-binding-test@streamlinecorp.com',
      ...docStarter,
    });
    const docPub = await store.publishDraftVersion(docDraft.id, 'section-binding-test@streamlinecorp.com');
    assert('document publishes without binding', docPub.status === 'published');

    const wfFixture = basicInternalApprovalFixture({ key: wfKey, template_kind: 'workflow' });
    const { template: wfTpl, draftVersion: wfDraft } = await store.createTemplate({
      ...wfFixture,
      createdBy: 'section-binding-test@streamlinecorp.com',
    });

    const unpubKeyLocal = unpubKey;
    const { template: wfUnpub } = await store.createTemplate({
      ...basicInternalApprovalFixture({ key: unpubKeyLocal, template_kind: 'workflow' }),
      createdBy: 'section-binding-test@streamlinecorp.com',
    });
    let attachErr = null;
    try {
      await store.upsertTemplateBinding(formTpl.id, {
        binding_mode: 'optional',
        workflow_template_id: wfUnpub.id,
      });
    } catch (e) {
      attachErr = e;
    }
    assert('unpublished workflow cannot be bound', attachErr?.code === 'NO_PUBLISHED');

    const wfPub = await store.publishDraftVersion(wfDraft.id, 'section-binding-test@streamlinecorp.com');
    assert('workflow template exists independently', wfPub.status === 'published');

    const workflows = await store.listPublishedWorkflowTemplates();
    assert('published workflow listed for binding', workflows.some((w) => w.id === wfTpl.id));

    const optional = await store.upsertTemplateBinding(formTpl.id, {
      binding_mode: 'optional',
      workflow_template_id: wfTpl.id,
      source_space_key: 'forms',
    });
    assert('attach optional workflow to form', optional.binding?.workflow_template_id === wfTpl.id);
    assert('optional binding mode persists', optional.binding_mode === 'optional');

    const required = await store.upsertTemplateBinding(docTpl.id, {
      binding_mode: 'required',
      workflow_template_id: wfTpl.id,
      source_space_key: 'documents',
    });
    assert('attach required workflow to document', required.binding_mode === 'required');

    const removed = await store.deleteTemplateBinding(formTpl.id);
    assert('remove workflow binding', removed.binding_mode === 'none');
    const afterRemove = await store.getTemplateBinding(formTpl.id);
    assert('binding cleared after remove', !afterRemove);

    const compiled = compileTemplateVersion({
      schema_json: formStarter.schema_json,
      workflow_json: formStarter.workflow_json,
      template_kind: 'form',
    });
    assert('compiler template_kind', compiled.template_kind === 'form');
    assert('compiler section field order', compiled.sections[0].fields.map((f) => f.key).join(',') === 'form_title,submitted_by');

    // WOS-58/59 smoke: launch + IA helpers still load
    const ui = require('../../template-registry-ui.js');
    ui.TemplateRegistryUI.applyRoute([], { space: 'forms' });
    assert(
      'WOS-59 IA filter still works',
      ui.TemplateRegistryUI._test.filterTemplatesForContext([
        { key: 'form_x', launch_config_json: { space_key: 'forms' } },
        { key: 'wf_y', launch_config_json: { space_key: 'workflows' } },
      ]).length === 1
    );
  } finally {
    await store.deleteTemplateForTest(formKey);
    await store.deleteTemplateForTest(docKey);
    await store.deleteTemplateForTest(wfKey);
    await store.deleteTemplateForTest(unpubKey);
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
