#!/usr/bin/env node
/**
 * WOS-80 — Unified Archive: dynamic form submissions.
 * Usage: npm run templates:archive-dynamic-forms-test
 *
 * Verifies that submitted dynamic forms are surfaced in the unified Archive:
 *   - the "forms" filter/category exists and routes (#/archives/forms),
 *   - a backend list endpoint reads form_submissions joined to versions/templates
 *     and enforces admin-all / non-admin-own visibility (no ID guessing),
 *   - the frontend loader renders a Forms list and opens the submission detail,
 *   - legacy archive categories remain intact,
 *   - the empty state reads "No submitted form records found."
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
  console.log('=== Archive Dynamic Forms Test ===\n');

  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const hubJs = fs.readFileSync(path.join(ROOT, 'hub.js'), 'utf8');
  const archive = require('../../hub-unified-archive.js');
  const templateStore = require('../../api/lib/templates/store.js');
  const templatePg = require('../../api/lib/templates/postgres.js');
  const routesSrc = fs.readFileSync(path.join(ROOT, 'api/lib/templates/routes.js'), 'utf8');
  const pgSrc = fs.readFileSync(path.join(ROOT, 'api/lib/templates/postgres.js'), 'utf8');

  // ---- Filter / route wiring (functional) ----
  assert('forms filter present in ARCHIVE_FILTERS', archive.ARCHIVE_FILTERS.some((f) => f.key === 'forms'));
  assert('forms label = Forms', archive.FILTER_LABELS.forms === 'Forms');
  assert('normalizeFilter forms', archive.normalizeFilter('forms') === 'forms');
  assert('normalizeFilter submitted-forms alias', archive.normalizeFilter('submitted-forms') === 'forms');
  assert('normalizeFilter submissions alias', archive.normalizeFilter('submissions') === 'forms');
  assert('buildArchiveHash forms', archive.buildArchiveHash('forms') === '#/archives/forms');
  assert('#/archives/forms → forms', archive.parseArchiveRouteFromHash('#/archives/forms').filter === 'forms');
  assert('#/archives/forms/{id} keeps id segment', (() => {
    const r = archive.parseArchiveRouteFromHash('#/archives/forms/abc123');
    return r.filter === 'forms' && r.segments[0] === 'abc123';
  })());

  // legacy categories still resolve (no regression)
  assert('legacy jsa still resolves', archive.normalizeFilter('jsa') === 'jsa');
  assert('legacy parts still resolves', archive.parseArchiveRouteFromHash('#/archives/parts-requests').filter === 'parts');
  assert('legacy ros still resolves', archive.parseArchiveRouteFromHash('#/archives/roll-off-swap').filter === 'ros');

  // ---- Backend list adapter ----
  assert('store exposes listSubmissions', typeof templateStore.listSubmissions === 'function');
  assert('postgres exposes listSubmissions', typeof templatePg.listSubmissions === 'function');
  assert('listSubmissions joins form_template_versions', pgSrc.includes('JOIN form_template_versions'));
  assert('listSubmissions joins form_templates', pgSrc.includes('JOIN form_templates'));
  assert('listSubmissions returns records + count', /return\s*{\s*records,\s*count\s*}/.test(pgSrc));
  assert('listSubmissions scopes by createdBy', pgSrc.includes('lower(fs.created_by) = $'));

  // ---- List route authorization ----
  assert('GET list route exists', routesSrc.includes("subListPath === '/hub/templates/submissions'"));
  assert('list route 401 when unauthenticated', (() => {
    const i = routesSrc.indexOf("subListPath === '/hub/templates/submissions'");
    const block = routesSrc.slice(i, i + 700);
    return block.includes('401') && block.includes('!actorEmail');
  })());
  assert('non-admin scoped to own submissions', (() => {
    const i = routesSrc.indexOf("subListPath === '/hub/templates/submissions'");
    const block = routesSrc.slice(i, i + 700);
    return block.includes('!canManageTemplates(permissions, isAdmin)') && block.includes('opts.createdBy = actorEmail');
  })());

  // ---- Frontend loader / render / open ----
  assert('HubArchiveLoaders wires forms-archive', indexHtml.includes("else if (tabName === 'forms-archive') loadFormsArchive()"));
  assert('loadFormsArchive defined', indexHtml.includes('async function loadFormsArchive('));
  assert('loadFormsArchive fetches submissions list', indexHtml.includes("proxyFetch('/hub/templates/submissions?limit=500')"));
  assert('renderFormsArchiveList defined', indexHtml.includes('function renderFormsArchiveList('));
  assert('forms rows use paginateRecords', indexHtml.includes("paginateRecords('forms'"));
  assert('openFormsArchiveRecord opens submission detail', (() => {
    const i = indexHtml.indexOf('function openFormsArchiveRecord(');
    const block = indexHtml.slice(i, i + 400);
    return block.includes("switchTab('hub-submission', { submissionId })") && block.includes("setHash('#/submissions/' + submissionId)");
  })());
  assert('forms archive panel present', indexHtml.includes('id="panel-forms-archive"'));
  assert('forms archive list container present', indexHtml.includes('id="formsArchiveList"'));

  // ---- Overview count ----
  const archiveSrc = fs.readFileSync(path.join(ROOT, 'hub-unified-archive.js'), 'utf8');
  assert('overview count fetches forms endpoint', archiveSrc.includes("/hub/templates/submissions?limit=1"));

  // ---- Empty state exact copy ----
  assert('forms empty state exact copy', indexHtml.includes("'No submitted form records found.'"));

  // ---- Router registrations ----
  assert('panels map has forms-archive', indexHtml.includes("'forms-archive': document.getElementById('panel-forms-archive')"));
  assert('knownTabs includes forms-archive', indexHtml.includes("'work-order-archive','forms-archive'"));
  assert('archiveMap includes forms', indexHtml.includes("forms: 'forms'"));
  assert('deepLinkUnifiedArchive handles forms', indexHtml.includes("if (filter === 'forms') return openFormsArchiveRecord(id)"));
  assert('hub.js LEGACY_PANEL_IDS forms-archive', hubJs.includes("'forms-archive': 'panel-forms-archive'"));
  assert('hub.js resolveHashTab forms-archive', hubJs.includes("'forms-archive': 'forms'"));

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('RESULT: FAIL');
    process.exit(1);
  }
  console.log('RESULT: PASS');
}

main();
