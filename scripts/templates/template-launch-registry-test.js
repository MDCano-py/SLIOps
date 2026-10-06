#!/usr/bin/env node
/**
 * WOS-58 — App spaces + template launch registry tests.
 * Usage: npm run templates:launch-registry-test
 */
const { loadDbEnv } = require('../db/env');
const { basicInternalApprovalFixture } = require('../../api/lib/templates/fixtures');
const { rolesCanSee, inferDefaultSpaceKey } = require('../../api/lib/spaces/normalize');

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

async function main() {
  console.log('=== WOS-58 Template Launch Registry Test ===\n');

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const { templates, spaces } = await loadStores();
  assert('spaces postgres mode', spaces.isSpacesPostgresMode());

  await spaces.ensureDefaultSpaces();
  const allSpaces = await spaces.listSpaces({ includeArchived: true });
  assert('default spaces seeded', allSpaces.some((s) => s.key === 'forms'));
  assert('documents space exists', allSpaces.some((s) => s.key === 'documents'));
  assert('workflows space exists', allSpaces.some((s) => s.key === 'workflows'));

  const safetyKey = `safety_${Date.now()}`;
  const customSpace = await spaces.createSpace(
    { key: safetyKey, label: 'Safety', description: 'Safety launch area', icon: 'safety' },
    'launch-test@streamlinecorp.com'
  );
  assert('create custom space', customSpace.key === safetyKey);

  const testKey = `launch-test-${Date.now()}`;
  const docKey = `doc_launch_${Date.now()}`;
  const fixture = basicInternalApprovalFixture({ key: testKey });
  const docFixture = basicInternalApprovalFixture({ key: docKey, description: '[document-backed] test' });

  let templateId = null;
  let docTemplateId = null;

  try {
    const { template, draftVersion } = await templates.createTemplate({
      ...fixture,
      createdBy: 'launch-test@streamlinecorp.com',
    });
    templateId = template.id;
    assert('create workflow template', !!template.id);

    const registryBefore = await spaces.getLaunchRegistry(['hub_admin'], true);
    const beforeCount = (registryBefore.spaces || []).reduce((n, s) => n + (s.entries || []).length, 0);

    const published = await templates.publishDraftVersion(draftVersion.id, 'launch-test@streamlinecorp.com');
    assert('publish creates launch path', published.status === 'published');

    const entry = await spaces.getLaunchEntryForTemplate(template.id);
    assert('launch entry exists after publish', !!entry);
    assert('launch entry active', entry.status === 'active');
    assert('generic template → workflows space', entry.space_key === 'workflows');
    assert('launch points to published version', entry.template_version_id === published.id);
    assert('route target is version id', entry.route_target === published.id);

    const registryAfter = await spaces.getLaunchRegistry(['hub_admin'], true);
    const afterCount = (registryAfter.spaces || []).reduce((n, s) => n + (s.entries || []).length, 0);
    assert('registry returns dynamic entries', afterCount >= beforeCount + 1);

    const hiddenRegistry = await spaces.getLaunchRegistry(['requester'], false);
    const managerRegistry = await spaces.getLaunchRegistry(['manager'], false);
    const managerHas = (managerRegistry.spaces || []).some((s) =>
      (s.entries || []).some((e) => e.template_id === template.id)
    );
    assert('manager role sees launch entry', managerHas);

    await spaces.updateLaunchEntry(entry.id, { visible_to_roles: ['admin', 'hub_admin'] });
    const restricted = await spaces.getLaunchRegistry(['requester'], false);
    const requesterHas = (restricted.spaces || []).some((s) =>
      (s.entries || []).some((e) => e.template_id === template.id)
    );
    assert('role filter hides from requester', !requesterHas);

    const adminOnly = await spaces.getLaunchRegistry(['admin'], false);
    const adminHas = (adminOnly.spaces || []).some((s) =>
      (s.entries || []).some((e) => e.template_id === template.id)
    );
    assert('authorized admin sees entry', adminHas);

    await spaces.setLaunchEntryStatus(entry.id, 'hidden');
    const hiddenEntry = await spaces.getLaunchEntry(entry.id);
    assert('hidden launch entry status', hiddenEntry.status === 'hidden');
    const registryHidden = await spaces.getLaunchRegistry(['admin'], false);
    const stillVisible = (registryHidden.spaces || []).some((s) =>
      (s.entries || []).some((e) => e.id === entry.id)
    );
    assert('hidden entry not in registry', !stillVisible);

    await spaces.setLaunchEntryStatus(entry.id, 'active');
    await spaces.updateTemplateLaunchConfig(template.id, {
      space_key: safetyKey,
      label: 'Safety Checklist',
      quick_action_enabled: true,
    });
    const draft2 = await templates.clonePublishedToDraft(template.id, 'launch-test@streamlinecorp.com');
    const pub2 = await templates.publishDraftVersion(draft2.id, 'launch-test@streamlinecorp.com');
    const moved = await spaces.getLaunchEntryForTemplate(template.id, safetyKey);
    assert('publish updates custom space', moved.space_key === safetyKey);
    assert('publish updates version pointer', moved.template_version_id === pub2.id);

    const { template: docTpl, draftVersion: docDraft } = await templates.createTemplate({
      ...docFixture,
      createdBy: 'launch-test@streamlinecorp.com',
    });
    docTemplateId = docTpl.id;
    await spaces.updateTemplateLaunchConfig(docTpl.id, {
      space_key: 'documents',
      label: 'Doc Launch Test',
    });
    await templates.publishDraftVersion(docDraft.id, 'launch-test@streamlinecorp.com');
    const docEntry = await spaces.getLaunchEntryForTemplate(docTpl.id, 'documents');
    assert('document context → documents space', docEntry.space_key === 'documents');

    assert(
      'infer document space from key',
      inferDefaultSpaceKey({ key: 'doc_x', description: '' }) === 'documents'
    );
    assert(
      'infer workflows default',
      inferDefaultSpaceKey({ key: 'general_x', description: '' }) === 'workflows'
    );
    assert('rolesCanSee admin bypass', rolesCanSee(['manager'], ['requester'], true));
    assert('rolesCanSee manager', rolesCanSee(['manager', 'admin'], ['manager'], false));

    const draftOnly = await templates.createDraftVersion({
      templateId: template.id,
      createdBy: 'launch-test@streamlinecorp.com',
      schema_json: fixture.schema_json,
      workflow_json: fixture.workflow_json,
    });
    assert('draft alone has no new public entry', draftOnly.status === 'draft');
    const entriesForTpl = await spaces.listLaunchEntriesForSpace(safetyKey, { includeHidden: true });
    const activeForTpl = entriesForTpl.filter((e) => e.template_id === template.id && e.status === 'active');
    assert('only published version on active entry', activeForTpl.length === 1);

    await templates.archiveTemplate(template.id, 'launch-test@streamlinecorp.com');
    const archivedEntry = await spaces.getLaunchEntry(moved.id);
    assert('archive template archives launch entry', archivedEntry.status === 'archived');

    await spaces.archiveSpace(safetyKey, 'launch-test@streamlinecorp.com');
    const archivedSpace = await spaces.getSpaceByKey(safetyKey);
    assert('archive custom space', archivedSpace.status === 'archived');
  } finally {
    if (templateId) {
      try {
        await templates.deleteTemplateForTest(templateId);
      } catch {
        /* ignore */
      }
    }
    if (docTemplateId) {
      try {
        await templates.deleteTemplateForTest(docTemplateId);
      } catch {
        /* ignore */
      }
    }
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
