#!/usr/bin/env node
/**
 * WOS-98 acceptance — navigation, published cfg docs bridge, Vendor Management sidebar
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
let passed = 0;
let failed = 0;

function assert(name, cond, detail) {
  if (cond) {
    console.log('PASS ', name);
    passed += 1;
  } else {
    console.log('FAIL ', name, detail || '');
    failed += 1;
  }
}

console.log('\n=== WOS-98 Navigation & Documents Bridge Acceptance ===\n');

const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const hubJs = fs.readFileSync(path.join(root, 'hub.js'), 'utf8');
const tmplUi = fs.readFileSync(path.join(root, 'template-registry-ui.js'), 'utf8');
const cfgJs = fs.readFileSync(path.join(root, 'hub-configuration-center.js'), 'utf8');
const rbac = fs.readFileSync(path.join(root, 'rbac-client.js'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'api/lib/configuration/routes.js'), 'utf8');
const report = fs.readFileSync(
  path.join(root, 'docs/reports/WOS_98_CONFIG_VENDOR_NDA_OPERATIONAL_CHAIN_REPORT.md'),
  'utf8'
);

// --- Exact URLs (hash routes) ---
assert('Documents URL #/documents/templates', /tab === 'documents'[\s\S]{0,400}hub-documents/.test(indexHtml) || /#\/documents\/templates/.test(hubJs));
assert('Forms URL #/forms', /return '#\/forms'/.test(hubJs));
assert('Configuration URL #/configuration', /return '#\/configuration'/.test(hubJs));
assert('Vendor Management URL #/management/vendors', /#\/management\/vendors/.test(hubJs));
assert('Vendor profile URL pattern', /#\/management\/vendors/.test(hubJs) && /mgmtSection:\s*'vendor'/.test(indexHtml));

// --- Vendor Management sidebar ---
assert(
  'Vendor Management in #hubSidebarNav',
  /id="hubSidebarNav"[\s\S]*?Vendor Management[\s\S]*?<\/nav>/.test(indexHtml)
);
assert(
  'Vendor Management uses mgmt:vendor rbac key',
  /data-mgmt-section="vendor"[\s\S]{0,80}data-rbac-key="mgmt:vendor"/.test(indexHtml) ||
    /data-rbac-key="mgmt:vendor"[\s\S]{0,120}Vendor Management/.test(indexHtml)
);
assert(
  'Vendor Management wires portal-tab management',
  /data-portal-tab="management"[\s\S]{0,80}data-mgmt-section="vendor"/.test(indexHtml)
);

// --- Why Hub Admin sees it ---
assert('hub_admin bypasses hasPerm', /p\.includes\('hub_admin'\)/.test(rbac));
assert('mgmt:vendor maps to vendor section', /'mgmt:vendor':\s*\{\s*section:\s*'vendor'/.test(rbac));

// --- Feature flags ---
assert(
  'CONFIGURABLE_PLATFORM_ENABLED gates cfg docs API',
  /isConfigurablePlatformEnabled|CONFIGURABLE_PLATFORM_ENABLED/.test(
    fs.readFileSync(path.join(root, 'api/lib/configuration/feature-flag.js'), 'utf8')
  )
);
assert('published-documents API route', /published-documents/.test(routes));

// --- Documents active state fix ---
assert(
  'Documents sidebar uses hub-documents not hub-forms',
  /setSidebarForTab\(pageTab === 'hub-documents' \? 'hub-documents' : 'hub-forms'\)/.test(hubJs)
);
assert('setSidebarForTab exact hubTab match', /hubTab && hubTab === tabName/.test(hubJs));
assert('setSidebarForTab management requires section match', /opts\.mgmtSection/.test(hubJs));

// --- Product model labels ---
assert('Config Documents labeled templates', /Documents \(templates\)/.test(cfgJs));
assert('Main Documents clarifies cfg identity', /published configuration templates/.test(tmplUi));
assert('Forms subtitle distinguishes documents', /Document templates are under Documents/.test(indexHtml) || /Document templates are under Documents/.test(tmplUi));
assert('openDocument exported', /openDocument/.test(cfgJs));

// --- Bridge without duplicating into form_templates ---
assert('apiListPublishedCfgDocuments present', /apiListPublishedCfgDocuments/.test(tmplUi));
assert('cfg published section rendered on documents space', /cfgPublishedDocsSectionHtml/.test(tmplUi));
assert('no INSERT into form_templates for cfg docs', !/INSERT INTO form_templates[\s\S]{0,200}mutual_nda/.test(tmplUi));
assert('cfg identity note in UI', /not a form_templates copy|Not duplicated into workspace/.test(tmplUi));

assert('report documents remaining gaps', /Remaining mocked/.test(report));
assert('report lists exact URLs', /#\/documents\/templates|#\/management\/vendors|#\/configuration/.test(report));

console.log('\nWOS-98 nav acceptance: ' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
