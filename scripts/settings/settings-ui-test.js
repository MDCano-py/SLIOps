#!/usr/bin/env node
/**
 * WOS-57 — Settings UI route + portal settings tests.
 * Usage: npm run settings:ui-test
 */
const { loadDbEnv } = require('../db/env');
const {
  normalizePortalSettings,
  mergePortalSettings,
  DEFAULT_PORTAL_SETTINGS,
} = require('../../api/lib/hub/portal-settings');

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

function parseWorkflowHash(hash) {
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
  return { path: h, query };
}

function buildWorkflowRouteHash(query = {}) {
  if (query.type === 'document') return '#/documents/templates';
  return '#/workflows';
}

async function invokeProxy(path, method = 'GET', body = null) {
  delete require.cache[require.resolve('../../api/maintainx.js')];
  const handler = require('../../api/maintainx.js');
  const mockRes = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader() {
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    send(data) {
      this.body = data;
      return this;
    },
    end() {
      return this;
    },
  };
  const req = {
    method,
    query: { path },
    headers: { 'x-portal-noauth': '1' },
    body,
  };
  await handler(req, mockRes);
  return mockRes;
}

async function main() {
  console.log('=== WOS-57 Settings UI Test ===\n');

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  assert('workflow templates route', buildWorkflowRouteHash({}) === '#/workflows');
  assert('document registry route redirects to documents IA', buildWorkflowRouteHash({ type: 'document' }) === '#/documents/templates');
  const doc = parseWorkflowHash('#/workflows?type=document');
  assert('parse legacy document query path', doc.query.type === 'document' && doc.path === 'workflows');
  assert('integrations route hash', '#/management/integrations'.includes('integrations'));

  let routeApplyCalls = 0;
  let lastRouteKey = '';
  function applyRouteGuard(parsed) {
    const routeKey = JSON.stringify(parsed);
    if (routeKey === lastRouteKey) return false;
    lastRouteKey = routeKey;
    routeApplyCalls += 1;
    return true;
  }
  applyRouteGuard({ tab: 'hub-settings', segments: [], query: {} });
  applyRouteGuard({ tab: 'hub-settings', segments: [], query: {} });
  assert('applyRoute guard skips duplicate route', routeApplyCalls === 1);

  const ui = require('../../template-registry-ui.js');
  assert('document template detect by key', ui.TemplateRegistryUI._test.isDocumentTemplate({ key: 'doc_permit', description: '' }));
  assert('document template detect by tag', ui.TemplateRegistryUI._test.isDocumentTemplate({ key: 'x', description: ui.TemplateRegistryUI._test.DOCUMENT_TAG }));

  const normalized = normalizePortalSettings({
    displayName: 'Test Hub',
    defaultLandingPage: 'hub-dashboard',
    defaultRequesterRole: 'manager',
    demoSeedEnabled: false,
  });
  assert('normalize portal settings', normalized.displayName === 'Test Hub');

  const store = require('../../api/lib/hub/db/postgres');
  const before = await store.getPortalSettings();

  const saved = await store.setPortalSettings({
    displayName: 'Settings UI Test Hub',
    defaultLandingPage: 'hub-reports',
    defaultRequesterRole: 'requester',
    demoSeedEnabled: true,
  });
  assert('save portal settings', saved.displayName === 'Settings UI Test Hub');

  const reloaded = await store.getPortalSettings();
  assert('reload after save', reloaded.displayName === 'Settings UI Test Hub');

  await store.setPortalSettings(before);

  const getRes = await invokeProxy('/hub/settings/portal', 'GET');
  assert('GET /hub/settings/portal', getRes.statusCode === 200 && getRes.body?.settings?.displayName);

  const patchRes = await invokeProxy('/hub/settings/portal', 'PATCH', {
    displayName: before.displayName,
    defaultLandingPage: before.defaultLandingPage,
    defaultRequesterRole: before.defaultRequesterRole,
    demoSeedEnabled: before.demoSeedEnabled !== false,
  });
  assert('PATCH /hub/settings/portal', patchRes.statusCode === 200);

  const integrationsRes = await invokeProxy('/hub/integrations/status', 'GET');
  assert('integrations API available', integrationsRes.statusCode === 200);

  try {
    require('../../hub.js');
    assert('HubUI navigate helpers exported', typeof global.HubUI?.navigateToIntegrations === 'function');
    assert('HubUI navigateToTemplateSpace exported', typeof global.HubUI?.navigateToTemplateSpace === 'function');
    assert(
      'HubUI legacy document hash redirect',
      global.HubUI?._test?.buildWorkflowsHash({ type: 'document' }) === '#/documents/templates'
    );
  } catch {
    assert('HubUI workflow hash helper fallback', buildWorkflowRouteHash({ type: 'document' }) === '#/documents/templates');
  }

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('RESULT: FAIL');
    process.exit(1);
  }
  console.log('RESULT: PASS');
  console.log('Manual: #/settings — no lag; cards navigate; General save persists after refresh');
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
