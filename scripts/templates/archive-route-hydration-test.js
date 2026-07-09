#!/usr/bin/env node
/**
 * Archive deep-link + hard refresh route hydration tests.
 * Usage: npm run templates:archive-route-hydration-test
 */
const fs = require('fs');
const path = require('path');
const { ROOT } = require('../db/env');

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

function main() {
  console.log('=== Archive Route Hydration Test ===\n');

  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const hubJs = fs.readFileSync(path.join(ROOT, 'hub.js'), 'utf8');
  const hubCss = fs.readFileSync(path.join(ROOT, 'hub.css'), 'utf8');
  const archive = require('../../hub-unified-archive.js');

  assert('parseArchiveRouteFromHash exported', typeof archive.parseArchiveRouteFromHash === 'function');
  assert('getActiveArchiveFilterFromHash exported', typeof archive.getActiveArchiveFilterFromHash === 'function');

  assert('#/archives → overview/all', archive.parseArchiveRouteFromHash('#/archives').filter === 'all');
  assert('#/archive → overview/all', archive.parseArchiveRouteFromHash('#/archive').filter === 'all');
  assert('#/archives/jsa → jsa', archive.parseArchiveRouteFromHash('#/archives/jsa').filter === 'jsa');
  assert('#/archives/bol → bol', archive.parseArchiveRouteFromHash('#/archives/bol').filter === 'bol');
  assert('#/archives/work-orders → work-orders', archive.parseArchiveRouteFromHash('#/archives/work-orders').filter === 'work-orders');
  assert('#/archives/parts-requests → parts', archive.parseArchiveRouteFromHash('#/archives/parts-requests').filter === 'parts');
  assert('#/archives/roll-off-swap → ros', archive.parseArchiveRouteFromHash('#/archives/roll-off-swap').filter === 'ros');

  assert('buildArchiveHash jsa', archive.buildArchiveHash('jsa') === '#/archives/jsa');
  assert('buildArchiveHash bol', archive.buildArchiveHash('bol') === '#/archives/bol');
  assert('buildArchiveHash work-orders', archive.buildArchiveHash('work-orders') === '#/archives/work-orders');
  assert('buildArchiveHash parts-requests slug', archive.buildArchiveHash('parts') === '#/archives/parts-requests');
  assert('buildArchiveHash roll-off-swap slug', archive.buildArchiveHash('ros') === '#/archives/roll-off-swap');

  assert('init uses hash as filter source', hubJs.includes('parseArchiveRouteFromHash'));
  assert('init uses resolveArchiveFilter or getActiveArchiveFilterFromHash', hubJs.includes('resolveArchiveFilter') || hubJs.includes('getActiveArchiveFilterFromHash'));
  assert('onTabActivated passes route opts to initHubArchive', hubJs.includes('initHubArchive({'));
  assert('hub init forces route hydration', hubJs.includes('applyRoute({ force: true })'));
  assert('hub init resets route cache', hubJs.includes('resetRouteCache'));

  assert('applyRoute gated on HubUI', indexHtml.includes('window.HubUI.navigateShell'));
  assert('applyRoute supports force re-apply', indexHtml.includes('function resetRouteCache'));
  assert('_hubArchiveRoute set before switchTab', (() => {
    const idx = indexHtml.indexOf('global._hubArchiveRoute');
    const switchIdx = indexHtml.indexOf('switchTab(target, routeOpts)', idx);
    return idx >= 0 && switchIdx > idx;
  })());
  assert('parseHash supports singular archive', indexHtml.includes("tab === 'archive' || tab === 'archives'"));
  assert('parseHash supports parts-requests alias', indexHtml.includes("'parts-requests': 'parts'"));

  assert('applyPortalNavPermissions waits for HubUI', indexHtml.includes('window.applyRoute') && indexHtml.includes('window.HubUI'));
  assert('early hub boot class in head', indexHtml.includes('hub-boot-hub'));
  assert('hub boot is unconditional', indexHtml.includes("document.documentElement.classList.add('hub-boot-hub')") && !indexHtml.includes('hubPrefixes'));
  assert('body defaults to hub-mode', indexHtml.includes('<body class="hub-mode">'));
  assert('panel-home hidden by default', indexHtml.includes('id="panel-home" style="display:none;"'));
  assert('panel-hub-shell visible by default', (() => {
    const m = indexHtml.match(/id="panel-hub-shell"[^>]*>/);
    return m && !m[0].includes('display:none');
  })());
  assert('topbar hidden by default', indexHtml.includes('<nav class="topbar" aria-hidden="true" hidden>'));
  assert('hub boot CSS hides legacy panels', hubCss.includes('html.hub-boot-hub main.page > .tab-panel:not(#panel-hub-shell)'));
  assert('hub-mode CSS hides panel-home', hubCss.includes('body.hub-mode #panel-home'));

  assert('archive init sequence guard', fs.readFileSync(path.join(ROOT, 'hub-unified-archive.js'), 'utf8').includes('archiveInitSeq'));
  assert('category empty message helper', indexHtml.includes('archiveCategoryEmptyMessage'));
  assert('switchTab passes opts to onTabActivated', indexHtml.includes('onTabActivated(tabName, opts)'));
  assert('setHash hydrates after pushState', indexHtml.includes('if (!_switchTabInProgress && typeof applyRoute === '));
  assert('selectArchiveFilter exported', archive.selectArchiveFilter && typeof archive.selectArchiveFilter === 'function');
  assert('filter clicks mount directly', fs.readFileSync(path.join(ROOT, 'hub-unified-archive.js'), 'utf8').includes('selectArchiveFilter(btn.dataset.archiveFilter)'));
  assert('navigateShell skips clearLegacyMount for archive', hubJs.includes("if (tabName === 'hub-archive')") && !(() => {
    const idx = hubJs.indexOf('function navigateShell');
    const block = hubJs.slice(idx, idx + 400);
    return block.indexOf('clearLegacyMount') < block.indexOf("'hub-archive'");
  })());
  assert('initHubArchive mounts before permissions', (() => {
    const idx = hubJs.indexOf('async function initHubArchive');
    const block = hubJs.slice(idx, idx + 900);
    const mountIdx = block.indexOf('applyArchiveRouteFromHash');
    const permIdx = block.indexOf('loadPermissionsFromMe');
    return mountIdx >= 0 && permIdx > mountIdx;
  })());
  assert('syncArchiveHash exported', typeof archive.syncArchiveHash === 'function');
  assert('applyArchiveRouteFromHash exported', typeof archive.applyArchiveRouteFromHash === 'function');
  assert('resolveArchiveFilter exported', typeof archive.resolveArchiveFilter === 'function');
  assert('hash synced before mount', (() => {
    const src = fs.readFileSync(path.join(ROOT, 'hub-unified-archive.js'), 'utf8');
    const idx = src.indexOf('async function selectArchiveFilter');
    const end = src.indexOf('function wireFilterButtons', idx);
    const block = src.slice(idx, end);
    return block.indexOf('syncArchiveHash') >= 0
      && block.indexOf('syncArchiveHash') < block.indexOf('initUnifiedArchive');
  })());
  assert('overview counts cannot overwrite embedded list', fs.readFileSync(path.join(ROOT, 'hub-unified-archive.js'), 'utf8').includes('content.querySelector(\'.hub-archive-embedded\')'));
  assert('single filter click delegation', (() => {
    const src = fs.readFileSync(path.join(ROOT, 'hub-unified-archive.js'), 'utf8');
    return src.includes('event.stopPropagation()') && !src.includes('else selectArchiveFilter(filter)');
  })());
  assert('resolveArchiveFilter prefers explicit filter', (() => {
    return archive.resolveArchiveFilter({ filter: 'bol' }) === 'bol'
      && archive.resolveArchiveFilter({ filter: 'jsa' }) === 'jsa';
  })());
  assert('embedded archive panel display block', hubCss.includes('#hubArchiveContent > .hub-legacy-panel.tab-panel.hub-archive-embedded'));
  assert('Documents sidebar uses hub-documents', indexHtml.includes('data-hub-tab="hub-documents"') && !indexHtml.includes('data-portal-tab="parts-request-archive"'));
  assert('plain #/documents maps to hub-documents', (() => {
    const block = indexHtml.slice(indexHtml.indexOf("} else if (tab === 'documents')"), indexHtml.indexOf("} else if (tab === 'management'"));
    return block.includes("'hub-documents'") && !block.includes("'hub-archive'");
  })());

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('RESULT: FAIL');
    process.exit(1);
  }
  console.log('RESULT: PASS');
}

main();
