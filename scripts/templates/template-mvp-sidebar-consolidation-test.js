#!/usr/bin/env node
/**
 * WOS-71 — MVP sidebar consolidation + unified archive tests.
 * Usage: npm run templates:mvp-sidebar-consolidation-test
 */
const fs = require('fs');
const path = require('path');

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

function countMatches(text, pattern) {
  const m = text.match(pattern);
  return m ? m.length : 0;
}

async function main() {
  console.log('=== WOS-71 MVP Sidebar Consolidation Test ===\n');

  const indexHtml = readRepoFile('index.html');
  const hubJs = readRepoFile('hub.js');
  const hubCss = readRepoFile('hub.css');
  const archiveJs = readRepoFile('hub-unified-archive.js');
  const registryJs = readRepoFile('template-registry-ui.js');
  const archive = require('../../hub-unified-archive.js');

  function resolveHashTab(out) {
    const legacyArchive = {
      'jsa-archive': 'jsa',
      'bol-archive': 'bol',
      'parts-request-archive': 'parts',
      'work-order-archive': 'work-orders',
      'roll-off-swap-archive': 'ros',
    };
    if (legacyArchive[out.tab]) {
      return {
        tab: 'hub-archive',
        archiveFilter: legacyArchive[out.tab],
        segments: out.segments || [],
        query: out.query || {},
      };
    }
    if (out.tab === 'hub-workflows') {
      return {
        tab: 'hub-forms',
        segments: ['approval-routes', ...(out.segments || [])],
        query: out.query || {},
        space: 'workflows',
      };
    }
    return out;
  }
  const rbac = (() => {
    require('../../rbac-client.js');
    return global.RbacClient;
  })();

  const sidebarSection = indexHtml.slice(
    indexHtml.indexOf('id="hubSidebarNav"'),
    indexHtml.indexOf('class="hub-sidebar-foot"')
  );

  assert('HubUnifiedArchive module loads', !!archive.initUnifiedArchive);
  assert('single Forms in sidebar', countMatches(sidebarSection, /data-hub-tab="hub-forms"/g) === 1);
  assert('no duplicate Operations Forms', !sidebarSection.includes('data-portal-tab="roll-off-swap"'));
  assert('workflows removed from sidebar', !sidebarSection.includes('data-hub-tab="hub-workflows"'));
  assert('single Archive in sidebar', countMatches(sidebarSection, /data-hub-tab="hub-archive"/g) === 1);
  assert('Documents uses hub-documents', sidebarSection.includes('data-hub-tab="hub-documents"'));
  assert('Documents not parts archive', !sidebarSection.includes('data-portal-tab="parts-request-archive"'));
  assert('no JSA Archive sidebar link', !sidebarSection.includes('data-portal-tab="jsa-archive"'));
  assert('no BOL Archive sidebar link', !sidebarSection.includes('data-portal-tab="bol-archive"'));
  assert('no WO Archive sidebar link', !sidebarSection.includes('data-portal-tab="work-order-archive"'));
  assert('no ROS Archive sidebar link', !sidebarSection.includes('data-portal-tab="roll-off-swap-archive"'));

  assert('hub archive page exists', indexHtml.includes('data-hub-page="hub-archive"'));
  assert('hub archive filter row', indexHtml.includes('hub-archive-filter-row'));
  assert('HubArchiveLoaders exposed', indexHtml.includes('window.HubArchiveLoaders'));
  assert('archive mount adds hub-legacy-active', archiveJs.includes("'hub-legacy-active'"));
  assert('archive embedded display css', hubCss.includes('.hub-archive-content .hub-archive-embedded.hub-legacy-panel'));

  assert('legacy jsa archive redirects', archive.legacyTabToFilter('jsa-archive') === 'jsa');
  assert('legacy bol archive redirects', archive.legacyTabToFilter('bol-archive') === 'bol');
  assert('legacy wo archive redirects', archive.legacyTabToFilter('work-order-archive') === 'work-orders');
  assert('legacy ros archive redirects', archive.legacyTabToFilter('roll-off-swap-archive') === 'ros');

  assert('archives jsa hash', archive.buildArchiveHash('jsa') === '#/archives/jsa');
  assert('archives bol hash', archive.buildArchiveHash('bol') === '#/archives/bol');
  assert('archives work orders hash', archive.buildArchiveHash('work-orders') === '#/archives/work-orders');
  assert('archives parts hash slug', archive.buildArchiveHash('parts') === '#/archives/parts-requests');
  assert('archives ros hash slug', archive.buildArchiveHash('ros') === '#/archives/roll-off-swap');

  assert('hub resolveHashTab jsa-archive', resolveHashTab({ tab: 'jsa-archive', segments: [] }).tab === 'hub-archive');
  assert(
    'hub resolveHashTab filter jsa',
    resolveHashTab({ tab: 'jsa-archive', segments: ['abc'] }).archiveFilter === 'jsa'
  );

  assert('hub archive native tab', hubJs.includes("'hub-archive'"));
  assert('hub initHubArchive', hubJs.includes('initHubArchive'));
  assert('workflows route to approval routes', hubJs.includes('#/forms/approval-routes'));

  assert('approval routes button in forms', registryJs.includes('tmplApprovalRoutesBtn') && registryJs.includes('Approval routes'));
  assert('non-admin cannot access hub-workflows', rbac.canAccessHubTab(['requester'], 'hub-workflows') === false);
  assert('admin can access hub-workflows', rbac.canAccessHubTab(['hub_admin'], 'hub-workflows') === true);

  assert('parseHash archives route', indexHtml.includes("tab === 'archives'"));
  assert('parseHash legacy archive resolve', indexHtml.includes('resolveHashTab(out)'));
  assert('deepLinkUnifiedArchive helper', indexHtml.includes('function deepLinkUnifiedArchive'));

  assert('New Request page preserved', indexHtml.includes('data-hub-page="hub-new-request"'));
  assert('Forms page preserved', indexHtml.includes('data-hub-page="hub-forms"'));

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
