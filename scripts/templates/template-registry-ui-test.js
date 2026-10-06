#!/usr/bin/env node
/**
 * WOS-57 — Template registry API + UI module smoke tests.
 * Usage: npm run templates:registry-ui-test
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
  console.log('=== WOS-57 Template Registry UI Test ===\n');

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const ui = require('../../template-registry-ui.js');
  assert('TemplateRegistryUI module loads', !!ui.TemplateRegistryUI);
  assert('starter schema valid', validateTemplateVersion(newTemplateStarter()).ok);
  assert('slugKey helper', ui.TemplateRegistryUI._test.slugKey('My Template!') === 'my_template');

  const store = await loadStore();
  const testKey = `registry-ui-${Date.now()}`;

  try {
    const created = await store.createTemplate({
      key: testKey,
      name: 'Registry UI Test',
      description: 'WOS-57',
      createdBy: 'registry-ui-test@streamlinecorp.com',
      ...newTemplateStarter(),
    });
    assert('create template + draft', !!created.draftVersion?.id);

    const listed = await store.listTemplates();
    assert('list templates includes new', listed.some((t) => t.key === testKey));

    const detail = await store.getTemplate(created.template.id);
    const versions = await store.listVersionsForTemplate(created.template.id);
    assert('list versions for template', Array.isArray(versions) && versions.length >= 1);
    assert('draft version listed', versions.some((v) => v.status === 'draft'));

    const published = await store.publishDraftVersion(created.draftVersion.id, 'registry-ui-test@streamlinecorp.com');
    assert('publish valid draft', published.status === 'published');

    try {
      await store.updateDraftVersion(published.id, { schema_json: { hacked: true } });
      assert('published immutable', false, 'expected error');
    } catch (err) {
      assert('published immutable', err.code === 'IMMUTABLE');
    }

    const badDraft = await store.createDraftVersion({
      templateId: created.template.id,
      schema_json: {
        fields: [
          { key: 'a', type: 'text', label: 'A', required: true },
          { key: 'a', type: 'text', label: 'Dup', required: false },
        ],
      },
      workflow_json: newTemplateStarter().workflow_json,
    });
    try {
      await store.publishDraftVersion(badDraft.id, 'registry-ui-test@streamlinecorp.com');
      assert('invalid publish fails', false);
    } catch (err) {
      assert('invalid publish fails', err.code === 'VALIDATION_FAILED');
      assert('invalid publish stays draft', (await store.getVersion(badDraft.id)).status === 'draft');
    }

    const cloned = await store.clonePublishedToDraft(created.template.id, 'registry-ui-test@streamlinecorp.com');
    assert('clone published to draft', cloned.status === 'draft' && cloned.id !== published.id);

    const opened = await store.getVersion(cloned.id);
    assert('open draft version', opened.status === 'draft');
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
  console.log('Note: Browser UI verified manually — open #/workflows as hub_admin.');
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
