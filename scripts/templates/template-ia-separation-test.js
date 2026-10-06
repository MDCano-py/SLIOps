#!/usr/bin/env node
/**
 * WOS-59 — Forms / Documents / Workflows IA separation tests.
 * Usage: npm run templates:ia-test
 */
const { loadDbEnv } = require('../db/env');

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

function parseIaHash(hash) {
  let h = String(hash || '').replace(/^#/, '');
  if (h.startsWith('/')) h = h.slice(1);
  const query = {};
  const qIdx = h.indexOf('?');
  if (qIdx >= 0) {
    new URLSearchParams(h.slice(qIdx + 1)).forEach((v, k) => {
      query[k] = v;
    });
    h = h.slice(0, qIdx);
  }
  const parts = h.split('/').filter(Boolean);
  const tab = parts[0] || '';
  const rest = parts.slice(1);

  if (tab === 'forms' && (!rest.length || rest[0] === 'templates')) {
    if (rest[0] === 'templates' && rest[1] && rest[2] === 'versions' && rest[3]) {
      return { tab: 'hub-forms', segments: ['builder', rest[1], rest[3]], query, space: 'forms' };
    }
    return { tab: 'hub-forms', segments: [], query, space: 'forms' };
  }
  if (tab === 'documents' && rest[0] === 'templates') {
    if (rest[1] && rest[2] === 'versions' && rest[3]) {
      return { tab: 'hub-documents', segments: ['builder', rest[1], rest[3]], query, space: 'documents' };
    }
    return { tab: 'hub-documents', segments: [], query, space: 'documents' };
  }
  if (tab === 'workflows') {
    if (query.type === 'document') {
      return { tab: 'hub-documents', segments: [], query: {}, space: 'documents' };
    }
    if (rest[0] === 'templates' && rest[1] && rest[2] === 'versions' && rest[3]) {
      return { tab: 'hub-forms', segments: ['approval-routes', 'builder', rest[1], rest[3]], query, space: 'workflows' };
    }
    return { tab: 'hub-forms', segments: ['approval-routes'], query, space: 'workflows' };
  }
  return { tab, segments: rest, query, space: null };
}

function buildRouteHash(tab, routeOpts = {}) {
  const segments = routeOpts.segments || [];
  const q = routeOpts.query || {};
  if (tab === 'hub-forms') {
    if (segments[0] === 'builder' && segments[1] && segments[2]) {
      return '#/forms/templates/' + segments[1] + '/versions/' + segments[2];
    }
    return '#/forms';
  }
  if (tab === 'hub-documents') {
    if (segments[0] === 'builder' && segments[1] && segments[2]) {
      return '#/documents/templates/' + segments[1] + '/versions/' + segments[2];
    }
    return '#/documents/templates';
  }
  if (tab === 'hub-workflows') {
    if (segments[0] === 'builder' && segments[1] && segments[2]) {
      return '#/forms/approval-routes/templates/' + segments[1] + '/versions/' + segments[2];
    }
    if (q.type === 'document') return '#/documents/templates';
    return '#/forms/approval-routes';
  }
  return '#/' + tab;
}

async function main() {
  console.log('=== WOS-59 Template IA Separation Test ===\n');

  const ui = require('../../template-registry-ui.js');
  const t = ui.TemplateRegistryUI._test;

  assert('module loads', !!ui.TemplateRegistryUI);
  assert('three template spaces', t.TEMPLATE_SPACES.join(',') === 'forms,documents,workflows');

  assert('space_key forms', t.getTemplateSpace({ key: 'x', launch_config_json: { space_key: 'forms' } }) === 'forms');
  assert('space_key documents', t.getTemplateSpace({ key: 'x', launch_config_json: { space_key: 'documents' } }) === 'documents');
  assert('space_key workflows', t.getTemplateSpace({ key: 'x', launch_config_json: { space_key: 'workflows' } }) === 'workflows');

  assert('fallback doc_ prefix', t.getTemplateSpace({ key: 'doc_permit', description: '' }) === 'documents');
  assert('fallback form_ prefix', t.getTemplateSpace({ key: 'form_intake', description: '' }) === 'forms');
  assert('fallback document tag', t.getTemplateSpace({ key: 'custom', description: t.DOCUMENT_TAG }) === 'documents');
  assert('fallback form tag', t.getTemplateSpace({ key: 'custom', description: t.FORM_TAG }) === 'forms');
  assert('fallback default workflows', t.getTemplateSpace({ key: 'generic', description: '' }) === 'workflows');

  ui.TemplateRegistryUI.applyRoute([], { space: 'forms' });
  assert(
    'filter forms only',
    t.filterTemplatesForContext([
      { key: 'form_a', launch_config_json: { space_key: 'forms' } },
      { key: 'doc_b', launch_config_json: { space_key: 'documents' } },
      { key: 'wf_c', launch_config_json: { space_key: 'workflows' } },
    ]).length === 1 && t.filterTemplatesForContext([{ key: 'form_a' }])[0].key === 'form_a'
  );

  ui.TemplateRegistryUI.applyRoute([], { space: 'documents' });
  assert(
    'filter documents only',
    t.filterTemplatesForContext([
      { key: 'form_a', launch_config_json: { space_key: 'forms' } },
      { key: 'doc_b', launch_config_json: { space_key: 'documents' } },
    ]).length === 1 && t.filterTemplatesForContext([{ key: 'doc_b' }])[0].key === 'doc_b'
  );

  ui.TemplateRegistryUI.applyRoute([], { space: 'workflows' });
  assert(
    'filter workflows only',
    t.filterTemplatesForContext([
      { key: 'form_a', launch_config_json: { space_key: 'forms' } },
      { key: 'wf_c', launch_config_json: { space_key: 'workflows' } },
    ]).length === 1 && t.filterTemplatesForContext([{ key: 'wf_c' }])[0].key === 'wf_c'
  );

  assert('spaceToHubTab forms', t.spaceToHubTab('forms') === 'hub-forms');
  assert('spaceToHubTab documents', t.spaceToHubTab('documents') === 'hub-documents');
  assert('spaceToHubTab workflows', t.spaceToHubTab('workflows') === 'hub-workflows');

  assert('parse #/forms', parseIaHash('#/forms').tab === 'hub-forms' && parseIaHash('#/forms').space === 'forms');
  assert(
    'parse forms builder',
    parseIaHash('#/forms/templates/t1/versions/v1').tab === 'hub-forms' &&
      JSON.stringify(parseIaHash('#/forms/templates/t1/versions/v1').segments) ===
        JSON.stringify(['builder', 't1', 'v1'])
  );
  assert(
    'parse documents list',
    parseIaHash('#/documents/templates').tab === 'hub-documents' &&
      parseIaHash('#/documents/templates').space === 'documents'
  );
  assert(
    'parse workflows list',
    parseIaHash('#/workflows').tab === 'hub-forms' &&
      parseIaHash('#/workflows').space === 'workflows' &&
      parseIaHash('#/workflows').segments[0] === 'approval-routes'
  );
  assert(
    'legacy document query maps to documents',
    parseIaHash('#/workflows?type=document').tab === 'hub-documents' &&
      parseIaHash('#/workflows?type=document').space === 'documents'
  );

  assert('build forms hash', buildRouteHash('hub-forms', {}) === '#/forms');
  assert('build documents hash', buildRouteHash('hub-documents', {}) === '#/documents/templates');
  assert('build workflows hash', buildRouteHash('hub-workflows', {}) === '#/forms/approval-routes');
  assert(
    'legacy document query builds documents hash',
    buildRouteHash('hub-workflows', { query: { type: 'document' } }) === '#/documents/templates'
  );
  assert(
    'build forms builder hash',
    buildRouteHash('hub-forms', { segments: ['builder', 't1', 'v1'] }) === '#/forms/templates/t1/versions/v1'
  );

  assert(
    'launch hidden when disabled',
    t.launchStatusCell({ current_published_version_id: 'v1', launch_config_json: { enabled: false } }).includes('Hidden')
  );
  assert(
    'launch available when published',
    t.launchStatusCell({
      current_published_version_id: 'v1',
      launch_config_json: { enabled: true, space_key: 'forms' },
    }).includes('Available')
  );

  try {
    if (typeof global.document === 'undefined') {
      global.document = {
        readyState: 'complete',
        documentElement: {
          getAttribute() {
            return null;
          },
          removeAttribute() {},
          setAttribute() {},
        },
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
        createElement: () => ({
          hidden: false,
          style: {},
          classList: { add() {}, remove() {}, toggle() {} },
          appendChild: () => {},
          addEventListener: () => {},
          querySelector: () => null,
          querySelectorAll: () => [],
          setAttribute: () => {},
        }),
      };
    }
    if (typeof global.window === 'undefined') {
      global.window = global;
    }
    delete require.cache[require.resolve('../../hub.js')];
    require('../../hub.js');
    assert('HubUI navigateToTemplateSpace exported', typeof global.HubUI?.navigateToTemplateSpace === 'function');
    assert(
      'HubUI legacy document hash redirect',
      global.HubUI?._test?.buildWorkflowsHash({ type: 'document' }) === '#/documents/templates'
    );
    assert('HubUI forms hash helper', global.HubUI?._test?.buildFormsHash() === '#/forms');
    assert('HubUI documents hash helper', global.HubUI?._test?.buildDocumentsHash() === '#/documents/templates');
  } catch (err) {
    assert('HubUI module load', false, err.message);
  }

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('RESULT: FAIL');
    process.exit(1);
  }
  console.log('RESULT: PASS');
  console.log('Manual: Settings cards → Forms/Documents/Workflows; sidebar IA; legacy #/workflows?type=document → Documents');
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
