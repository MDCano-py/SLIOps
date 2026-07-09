#!/usr/bin/env node
/**
 * WOS-62 / WOS-64 / WOS-65 — End-to-end template runtime tests.
 * Covers approved v1 runtime submission renderer + workflow action scope.
 * Usage: npm run templates:runtime-mvp-test
 */
const { loadDbEnv } = require('../db/env');
const { sectionedFields } = require('../../api/lib/templates/fixtures');
const { validateSubmissionData } = require('../../api/lib/templates/runtime-validate');
const { rolesCanSee } = require('../../api/lib/spaces/normalize');

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
  delete require.cache[require.resolve('../../api/lib/spaces/postgres.js')];
  return require('../../api/lib/templates/store.js');
}

async function expectError(name, fn, code) {
  try {
    await fn();
    assert(name, false, 'expected error');
  } catch (err) {
    assert(name, !code || err.code === code, err.message);
  }
}

async function main() {
  console.log('=== WOS-62 Template Runtime MVP Test ===\n');

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const store = await loadStore();
  const spaceStore = require('../../api/lib/spaces/store');
  const ts = Date.now();
  const formKey = `runtime-form-${ts}`;
  const wfKey = `runtime-wf-${ts}`;
  const docKey = `runtime-doc-${ts}`;

  const formSchema = sectionedFields(
    [
      { key: 'job_name', type: 'text', label: 'Job Name', required: true },
      { key: 'notes', type: 'textarea', label: 'Notes', required: false },
      { key: 'worker_ack', type: 'signature_ack', label: 'Ack', required: true },
    ],
    'Job Information'
  );

  try {
    const { template: formTpl, draftVersion: formDraft } = await store.createTemplate({
      key: formKey,
      name: 'Runtime Test Form',
      template_kind: 'form',
      createdBy: 'runtime-mvp-test@streamlinecorp.com',
      schema_json: formSchema,
      workflow_json: { steps: [{ step_type: 'Fill', assignee_role: 'requester', field_keys: ['job_name', 'notes', 'worker_ack'] }] },
    });
    await spaceStore.updateTemplateLaunchConfig(
      formTpl.id,
      {
        enabled: true,
        space_key: 'forms',
        label: 'Runtime Test Form',
        visible_to_roles: ['requester', 'manager', 'admin'],
        route_type: 'template_runtime_placeholder',
      },
      'runtime-mvp-test@streamlinecorp.com'
    );
    const formPub = await store.publishDraftVersion(formDraft.id, 'runtime-mvp-test@streamlinecorp.com');
    const launchEntry = await spaceStore.getLaunchEntryForTemplate(formTpl.id, 'forms');
    assert('launch entry resolves active published template version', !!launchEntry && launchEntry.status === 'active');
    assert('launch entry pins version id', launchEntry.template_version_id === formPub.id);

    const bundle = await store.resolveLaunchRuntimeBundle(launchEntry.id);
    assert('runtime bundle has compiled schema', !!bundle.version?.compiled_workflow_json?.sections);

    await spaceStore.setLaunchEntryStatus(launchEntry.id, 'hidden');
    let hiddenErr = null;
    try {
      await store.submitLaunchEntry({
        launchEntryId: launchEntry.id,
        data_json: { job_name: 'A', worker_ack: { acknowledged: true } },
        createdBy: 'runtime-mvp-test@streamlinecorp.com',
      });
    } catch (e) {
      hiddenErr = e;
    }
    assert('hidden launch entry cannot submit', hiddenErr?.code === 'UNAVAILABLE');
    await spaceStore.setLaunchEntryStatus(launchEntry.id, 'active');

    const badValidation = validateSubmissionData(formPub.compiled_workflow_json, { job_name: '' });
    assert('required field validation blocks submit', !badValidation.ok);

    const noWf = await store.submitLaunchEntry({
      launchEntryId: launchEntry.id,
      data_json: { job_name: 'Site A', worker_ack: { acknowledged: true } },
      createdBy: 'requester@streamlinecorp.com',
    });
    assert('valid no-workflow submission creates form_submissions', !!noWf.submission.id);
    assert('no-workflow status submitted', noWf.submission.status === 'submitted');
    assert('submission pins exact template_version_id', noWf.templateVersion.id === formPub.id);
    assert('no workflow step instances', (noWf.stepInstances || []).length === 0);

    const detail = await store.getSubmissionDetail(noWf.submission.id);
    assert('submission detail returns sectioned answers', detail.submission.data_json.job_name === 'Site A');
    assert('audit/history event on submit', detail.events.some((e) => e.event_type === 'submission.created'));

    const formPub2 = await store.publishDraftVersion(
      (
        await store.clonePublishedToDraft(formTpl.id, 'runtime-mvp-test@streamlinecorp.com')
      ).id,
      'runtime-mvp-test@streamlinecorp.com'
    );
    assert('template v2 published', formPub2.version_number === 2);
    const oldDetail = await store.getSubmissionDetail(noWf.submission.id);
    assert('old submission pinned after v2 publish', oldDetail.templateVersion.id === formPub.id);

    const { template: wfTpl, draftVersion: wfDraft } = await store.createTemplate({
      key: wfKey,
      name: 'Runtime WF',
      template_kind: 'workflow',
      createdBy: 'runtime-mvp-test@streamlinecorp.com',
      schema_json: formSchema,
      workflow_json: {
        steps: [
          { step_type: 'Fill', assignee_role: 'requester', field_keys: ['job_name', 'notes'] },
          { step_type: 'Review', assignee_role: 'manager' },
          { step_type: 'Approve', assignee_role: 'admin' },
          { step_type: 'Sign', assignee_role: 'requester' },
          { step_type: 'Upload', assignee_role: 'requester', field_keys: ['notes'] },
        ],
      },
    });
    const wfPub = await store.publishDraftVersion(wfDraft.id, 'runtime-mvp-test@streamlinecorp.com');

    await store.upsertTemplateBinding(formTpl.id, {
      binding_mode: 'optional',
      workflow_template_id: wfTpl.id,
      source_space_key: 'forms',
    });
    await store.retirePublishedVersion(wfPub.id, 'runtime-mvp-test@streamlinecorp.com');
    const optionalNoWf = await store.submitLaunchEntry({
      launchEntryId: launchEntry.id,
      data_json: { job_name: 'Optional path', worker_ack: { acknowledged: true } },
      createdBy: 'runtime-mvp-test@streamlinecorp.com',
    });
    assert('optional workflow binding without workflow allows submit', optionalNoWf.submission.status === 'submitted');
    assert('optional submit notice', !!optionalNoWf.notice);

    const wfDraft2 = await store.createDraftVersion({
      templateId: wfTpl.id,
      createdBy: 'runtime-mvp-test@streamlinecorp.com',
      schema_json: wfPub.schema_json,
      workflow_json: wfPub.workflow_json,
    });
    const wfPub2 = await store.publishDraftVersion(wfDraft2.id, 'runtime-mvp-test@streamlinecorp.com');

    await store.upsertTemplateBinding(formTpl.id, {
      binding_mode: 'required',
      workflow_template_id: wfTpl.id,
      source_space_key: 'forms',
    });
    await store.retirePublishedVersion(wfPub2.id, 'runtime-mvp-test@streamlinecorp.com');
    await expectError('required workflow binding without published workflow blocks submit', () =>
      store.submitLaunchEntry({
        launchEntryId: launchEntry.id,
        data_json: { job_name: 'X', worker_ack: { acknowledged: true } },
        createdBy: 'runtime-mvp-test@streamlinecorp.com',
      }),
      'REQUIRED_WORKFLOW_MISSING'
    );

    const wfDraft3 = await store.createDraftVersion({
      templateId: wfTpl.id,
      createdBy: 'runtime-mvp-test@streamlinecorp.com',
      schema_json: wfPub.schema_json,
      workflow_json: wfPub.workflow_json,
    });
    await store.publishDraftVersion(wfDraft3.id, 'runtime-mvp-test@streamlinecorp.com');

    await store.upsertTemplateBinding(formTpl.id, { binding_mode: 'optional', workflow_template_id: wfTpl.id });

    const { template: docTpl, draftVersion: docDraft } = await store.createTemplate({
      key: docKey,
      name: 'Runtime Doc',
      template_kind: 'document',
      createdBy: 'runtime-mvp-test@streamlinecorp.com',
      schema_json: sectionedFields([{ key: 'document_title', type: 'text', label: 'Title', required: true }]),
      workflow_json: { steps: [{ step_type: 'Fill', assignee_role: 'requester', field_keys: ['document_title'] }] },
    });
    await spaceStore.updateTemplateLaunchConfig(
      docTpl.id,
      { enabled: true, space_key: 'documents', label: 'Runtime Doc', visible_to_roles: ['requester', 'admin'] },
      'runtime-mvp-test@streamlinecorp.com'
    );
    await store.publishDraftVersion(docDraft.id, 'runtime-mvp-test@streamlinecorp.com');
    await store.upsertTemplateBinding(docTpl.id, {
      binding_mode: 'required',
      workflow_template_id: wfTpl.id,
      source_space_key: 'documents',
    });
    const docEntry = await spaceStore.getLaunchEntryForTemplate(docTpl.id, 'documents');
    assert('document launch entry exists', !!docEntry);

    const withWf = await store.submitLaunchEntry({
      launchEntryId: launchEntry.id,
      data_json: { job_name: 'WF path', notes: 'note', worker_ack: { acknowledged: true } },
      createdBy: 'runtime-mvp-test@streamlinecorp.com',
    });
    assert('attached workflow creates step instances', withWf.stepInstances.length === 5);
    assert('workflow submission in_progress', withWf.submission.status === 'in_progress');
    const fillStep = withWf.stepInstances.find((s) => s.step_type === 'Fill');
    assert('Fill step auto-completed at submit', fillStep?.status === 'completed');

    const reviewStep = withWf.stepInstances.find((s) => s.step_type === 'Review');
    const afterReview = await store.actOnSubmissionStep({
      submissionId: withWf.submission.id,
      stepInstanceId: reviewStep.id,
      actionPayload: { action: 'approve', comment: 'Looks good' },
      actorEmail: 'manager@streamlinecorp.com',
    });
    assert('Review action advances', afterReview.submission.current_step_index > withWf.submission.current_step_index);
    assert('Review payload stored', afterReview.stepInstances.find((s) => s.id === reviewStep.id).payload_json.comment === 'Looks good');
    const reviewDone = afterReview.stepInstances.find((s) => s.id === reviewStep.id);
    assert('Review sets acted_by', reviewDone.acted_by === 'manager@streamlinecorp.com');
    assert('Review sets acted_at', !!reviewDone.acted_at);

    const approveStep = afterReview.stepInstances.find((s) => s.step_type === 'Approve' && s.status === 'pending');
    await expectError('Reject requires reason', () =>
      store.actOnSubmissionStep({
        submissionId: withWf.submission.id,
        stepInstanceId: approveStep.id,
        actionPayload: { action: 'reject' },
        actorEmail: 'admin@streamlinecorp.com',
      }),
      'REJECT_REASON_REQUIRED'
    );

    const afterApprove = await store.actOnSubmissionStep({
      submissionId: withWf.submission.id,
      stepInstanceId: approveStep.id,
      actionPayload: { action: 'approve' },
      actorEmail: 'admin@streamlinecorp.com',
    });
    assert('Approve action advances', afterApprove.submission.status === 'in_progress');

    const signStep = afterApprove.stepInstances.find((s) => s.step_type === 'Sign' && s.status === 'pending');
    const afterSign = await store.actOnSubmissionStep({
      submissionId: withWf.submission.id,
      stepInstanceId: signStep.id,
      actionPayload: { action: 'sign', acknowledged: true, signature_text: 'Pat' },
      actorEmail: 'requester@streamlinecorp.com',
    });
    assert('Sign action writes acknowledgement payload', afterSign.stepInstances.find((s) => s.id === signStep.id).payload_json.acknowledged === true);

    const uploadStep = afterSign.stepInstances.find((s) => s.step_type === 'Upload' && s.status === 'pending');
    const afterUpload = await store.actOnSubmissionStep({
      submissionId: withWf.submission.id,
      stepInstanceId: uploadStep.id,
      actionPayload: { action: 'upload', reference: 'https://files.example/ref-1' },
      actorEmail: 'requester@streamlinecorp.com',
    });
    assert('Upload-reference action writes payload', afterUpload.stepInstances.find((s) => s.id === uploadStep.id).payload_json.reference.includes('https://'));
    assert('final step completion marks submission completed', afterUpload.submission.status === 'completed');

    assert(
      'unauthorized role cannot see admin-only launch',
      !rolesCanSee(['admin', 'hub_admin'], ['requester'], false)
    );

    const sb = require('../../template-section-builder.js');
    const html = sb.renderRuntimeFormHtml({
      title: 'T',
      sections: sb.normalizeSections(formSchema),
      templateKind: 'form',
    });
    assert('preview renderer handles sectioned schema without crashing', html.includes('tmpl-runtime-form'));

    await store.deleteTemplateForTest(formKey);
    await store.deleteTemplateForTest(wfKey);
    await store.deleteTemplateForTest(docKey);
  } catch (err) {
    try {
      await store.deleteTemplateForTest(formKey);
      await store.deleteTemplateForTest(wfKey);
      await store.deleteTemplateForTest(docKey);
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
