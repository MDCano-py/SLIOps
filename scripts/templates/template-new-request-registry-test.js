#!/usr/bin/env node
/**
 * WOS-69 — New Request form registry wiring + legacy parity tests.
 * Usage: npm run templates:new-request-registry-test
 */
const fs = require('fs');
const path = require('path');
const { loadDbEnv } = require('../db/env');
const { basicInternalApprovalFixture } = require('../../api/lib/templates/fixtures');
const { listDocumentTypes } = require('../../api/lib/hub/document-registry');

loadDbEnv();
process.env.HUB_STORE_MODE = process.env.HUB_STORE_MODE || 'postgres';

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

function readRepoFile(rel) {
  return fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
}

async function loadStores() {
  delete require.cache[require.resolve('../../api/lib/templates/store.js')];
  delete require.cache[require.resolve('../../api/lib/templates/postgres.js')];
  delete require.cache[require.resolve('../../api/lib/spaces/store.js')];
  delete require.cache[require.resolve('../../api/lib/spaces/postgres.js')];
  return {
    templates: require('../../api/lib/templates/store.js'),
    spaces: require('../../api/lib/spaces/store.js'),
  };
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
  console.log('=== WOS-69 New Request Form Registry Wiring Test ===\n');

  const indexHtml = readRepoFile('index.html');
  const hubJs = readRepoFile('hub.js');
  const registryJs = readRepoFile('template-registry-ui.js');
  const runtimeJs = readRepoFile('template-runtime-ui.js');
  const sectionJs = readRepoFile('template-section-builder.js');
  const nrModule = require('../../hub-new-request-registry.js');
  const ui = require('../../template-registry-ui.js');
  const t = ui.TemplateRegistryUI._test;

  assert('HubNewRequestRegistry module loads', !!nrModule.LEGACY_REQUEST_TYPE_KEYS);
  assert('legacy keys count', nrModule.LEGACY_REQUEST_TYPE_KEYS.length === 9);

  const legacyFromRegistry = listDocumentTypes({ enabledOnly: true }).map((d) => d.key);
  assert(
    'document-registry legacy keys present in helper',
    nrModule.LEGACY_REQUEST_TYPE_KEYS.every((k) => legacyFromRegistry.includes(k)),
    `missing: ${nrModule.LEGACY_REQUEST_TYPE_KEYS.filter((k) => !legacyFromRegistry.includes(k)).join(', ')}`
  );

  const mockRegistry = {
    spaces: [
      {
        key: 'forms',
        entries: [
          {
            id: 'le_pub_1',
            template_id: 'tpl_1',
            template_key: 'safety_check',
            label: 'Safety Checklist',
            description: 'Daily safety walkthrough',
            sort_order: 1,
          },
        ],
      },
    ],
  };
  const published = nrModule.publishedFormsFromRegistry(mockRegistry);
  assert('publishedFormsFromRegistry maps entries', published.length === 1);
  assert('published form render_mode', published[0].render_mode === 'published_form');
  assert('published form launch_entry_id', published[0].launch_entry_id === 'le_pub_1');
  assert('published form category', published[0].category === 'published_forms');
  assert('card action label for published form', nrModule.cardActionLabel(published[0]) === 'Fill out form');
  assert('isPublishedFormCard', nrModule.isPublishedFormCard(published[0]) === true);

  const merged = nrModule.mergeNewRequestTypes(
    [{ key: 'work_order', label: 'Work Order' }],
    published
  );
  assert('mergeNewRequestTypes combines legacy + published', merged.length === 2);

  const grouped = nrModule.groupNewRequestTypes(merged);
  assert('groupNewRequestTypes splits legacy/published', grouped.legacy.length === 1 && grouped.published.length === 1);

  assert('hub-new-request-registry script in index', indexHtml.includes('hub-new-request-registry.js'));
  assert('New Request page route', indexHtml.includes('id="hubPageNewRequest"'));
  assert('New Request plain subtitle', indexHtml.includes('Choose an available request type'));
  assert('no launch registry jargon in New Request subtitle', !indexHtml.includes('schema forms render here'));

  assert('hub fetchLaunchRegistry', hubJs.includes("hubFetch('/hub/spaces/registry')"));
  assert('hub initNewRequestHub uses HubNewRequestRegistry', hubJs.includes('HubNewRequestRegistry'));
  assert('hub renderNewRequestTypeGrid published forms section', hubJs.includes("'Published forms'"));
  assert('hub published form inline runtime', hubJs.includes("render === 'published_form'") && hubJs.includes('TemplateRuntimeUI.renderLaunchForm'));
  assert('hub dynamic card class', hubJs.includes('hub-type-item-dynamic'));
  assert('published_forms category label in hub', hubJs.includes("published_forms: 'Published forms'"));
  assert('no app-spaces in New Request category labels', !hubJs.includes("app-spaces:"));

  assert('forms page New Request hint', registryJs.includes('Team members start published forms from'));
  assert('delete draft API client', registryJs.includes('/delete'));
  assert('Delete draft button label', registryJs.includes('Delete draft'));
  assert('Archive form button label', registryJs.includes('Archive form'));
  assert('canDeleteDraftTemplate exported', typeof t.canDeleteDraftTemplate === 'function');
  assert(
    'canDeleteDraftTemplate true for draft-only',
    t.canDeleteDraftTemplate({ status: 'active', current_published_version_id: null }) === true
  );
  assert(
    'canDeleteDraftTemplate false for published',
    t.canDeleteDraftTemplate({ status: 'active', current_published_version_id: 'v1' }) === false
  );

  assert('builder field key in details only', registryJs.includes('tmpl-field-details') && registryJs.includes('Field key'));
  assert('builder summary row no key meta class', !registryJs.includes('tmpl-field-key-meta'));
  assert('runtime onCancel for New Request', runtimeJs.includes('onCancel'));
  assert('runtime back to New Request on error', runtimeJs.includes('Back to New Request'));
  assert('runtime form uses labels not keys in readonly', sectionJs.includes('tmpl-runtime-readonly-label'));
  assert('runtime plain eyebrow', sectionJs.includes('Published form · Fill out and submit'));
  assert('submission record human labels', sectionJs.includes('tmpl-runtime-readonly-label') && sectionJs.includes('f.label'));

  assert('no Launch Registry in user-facing registry UI', !registryJs.match(/Launch Registry/i));
  assert('no Template Studio nav label in index', !indexHtml.includes('>Template Studio<'));

  const legacyLabels = [
    'Work Order',
    'Parts / Material',
    'Document Review',
    'Document Signature',
    'General Request',
    'BOL',
    'Safe Work Permit',
    'JSA',
    'Equipment Request',
  ];
  legacyLabels.forEach((label) => {
    assert(`legacy type in document-registry: ${label}`, listDocumentTypes({ enabledOnly: true }).some((d) => d.label === label));
  });

  if (!process.env.DATABASE_URL) {
    console.log('\nSkipping DB integration tests (DATABASE_URL not set)\n');
    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    process.exit(failed ? 1 : 0);
  }

  const { templates, spaces } = await loadStores();
  await spaces.ensureDefaultSpaces();

  const ts = Date.now();
  const draftKey = `nr-draft-${ts}`;
  const pubKey = `nr-pub-${ts}`;
  const archiveKey = `nr-arch-${ts}`;

  let draftTplId = null;
  let pubTplId = null;
  let archTplId = null;

  try {
    const draftFixture = basicInternalApprovalFixture({
      key: draftKey,
      name: 'NR Draft Only',
      template_kind: 'form',
    });
    const { template: draftTpl } = await templates.createTemplate({
      ...draftFixture,
      createdBy: 'nr-registry-test@streamlinecorp.com',
    });
    draftTplId = draftTpl.id;

    const { template: pubTpl, draftVersion: pubDraft } = await templates.createTemplate({
      ...basicInternalApprovalFixture({ key: pubKey, name: 'NR Published Form', template_kind: 'form' }),
      createdBy: 'nr-registry-test@streamlinecorp.com',
    });
    pubTplId = pubTpl.id;
    await spaces.updateTemplateLaunchConfig(
      pubTpl.id,
      {
        enabled: true,
        space_key: 'forms',
        label: 'NR Published Form',
        visible_to_roles: ['requester', 'manager', 'admin'],
        route_type: 'template_runtime_placeholder',
      },
      'nr-registry-test@streamlinecorp.com'
    );
    await templates.publishDraftVersion(pubDraft.id, 'nr-registry-test@streamlinecorp.com');

    const registryAfterPub = await spaces.getLaunchRegistry(['requester'], false);
    const formsEntries = (registryAfterPub.spaces || []).find((s) => s.key === 'forms')?.entries || [];
    const pubEntry = formsEntries.find((e) => e.template_id === pubTplId);
    assert('published form in launch registry', !!pubEntry);

    const nrCards = nrModule.publishedFormsFromRegistry(registryAfterPub);
    assert('published form appears as New Request card', nrCards.some((c) => c.launch_entry_id === pubEntry.id));

    const draftRegistry = nrModule.publishedFormsFromRegistry({ spaces: [{ key: 'forms', entries: [] }] });
    assert('draft-only template not in registry cards', !draftRegistry.some((c) => c.template_id === draftTplId));

    const bundle = await templates.resolveLaunchRuntimeBundle(pubEntry.id);
    const fields = bundle.version?.compiled_workflow_json?.fields || [];
    assert('runtime bundle has fields', fields.length > 0);
    const sb = require('../../template-section-builder.js');
    const runtimeHtml = sb.renderRuntimeFormHtml({
      title: 'NR Published Form',
      sections: bundle.version.compiled_workflow_json.sections,
      templateKind: 'form',
      spaceKey: 'forms',
    });
    fields.forEach((f) => {
      assert(`runtime HTML shows label not key: ${f.key}`, runtimeHtml.includes(f.label) && !runtimeHtml.includes(`>${f.key}<`));
    });

    const submitResult = await templates.submitLaunchEntry({
      launchEntryId: pubEntry.id,
      data_json: { title: 'Test submission', description: 'ok', requested_by: 'nr-registry-test@streamlinecorp.com' },
      submittedBy: 'nr-registry-test@streamlinecorp.com',
    });
    assert('submit creates submission', !!submitResult.submission?.id);

    await templates.deleteDraftTemplate(draftTplId);
    const draftGone = await templates.getTemplate(draftTplId);
    assert('draft with no submissions can be deleted', !draftGone);
    draftTplId = null;

    const { template: archTpl, draftVersion: archDraft } = await templates.createTemplate({
      ...basicInternalApprovalFixture({ key: archiveKey, name: 'NR Archive Test', template_kind: 'form' }),
      createdBy: 'nr-registry-test@streamlinecorp.com',
    });
    archTplId = archTpl.id;
    await spaces.updateTemplateLaunchConfig(
      archTpl.id,
      { enabled: true, space_key: 'forms', label: 'NR Archive Test', visible_to_roles: ['requester'] },
      'nr-registry-test@streamlinecorp.com'
    );
    await templates.publishDraftVersion(archDraft.id, 'nr-registry-test@streamlinecorp.com');

    await expectError(
      'published form cannot hard-delete',
      async () => {
        await templates.deleteDraftTemplate(pubTplId);
      },
      'PUBLISHED'
    );

    await templates.archiveTemplate(archTplId, 'nr-registry-test@streamlinecorp.com');
    const registryAfterArchive = await spaces.getLaunchRegistry(['requester'], false);
    const archCards = nrModule.publishedFormsFromRegistry(registryAfterArchive);
    assert('archived form not in New Request cards', !archCards.some((c) => c.template_id === archTplId));

    await expectError(
      'form with submissions cannot hard-delete',
      async () => {
        await templates.deleteDraftTemplate(pubTplId);
      },
      'PUBLISHED'
    );
  } finally {
    for (const id of [draftTplId, pubTplId, archTplId].filter(Boolean)) {
      try {
        const tpl = await templates.getTemplate(id);
        if (tpl && tpl.status === 'active' && !tpl.current_published_version_id) {
          await templates.deleteDraftTemplate(id);
        }
      } catch {
        /* cleanup best-effort */
      }
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
