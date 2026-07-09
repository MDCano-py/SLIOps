#!/usr/bin/env node
/**
 * WOS-77 — Shell route consistency (Dashboard / Reports / Analytics).
 * Usage: npm run templates:shell-route-consistency-test
 *
 * Static source checks that route -> active nav -> mounted content stay aligned
 * for the three hub shell routes, and that Analytics has its own route/page/content
 * instead of aliasing to the Operations Dashboard.
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
  console.log('=== WOS-77 Shell Route Consistency Test ===\n');

  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const hubJs = fs.readFileSync(path.join(ROOT, 'hub.js'), 'utf8');

  // --- Analytics is now a distinct tab, not an alias to hub-dashboard ---
  assert(
    'Analytics nav link targets hub-analytics (not hub-dashboard)',
    /data-hub-tab="hub-analytics"[^>]*>[\s\S]*?<span>Analytics<\/span>/.test(indexHtml),
    'Analytics sidebar button must use data-hub-tab="hub-analytics"'
  );
  assert(
    'No nav link maps Analytics label onto hub-dashboard',
    // Tempered match: stay within a single <button> element so we do not span
    // from the Dashboard link across to the separate Analytics link.
    !/<button[^>]*data-hub-tab="hub-dashboard"(?:(?!<\/button>)[\s\S])*?<span>Analytics<\/span>/.test(indexHtml)
  );

  // --- Distinct hub pages exist for all three routes ---
  assert('Dashboard page panel exists', indexHtml.includes('data-hub-page="hub-dashboard"'));
  assert('Reports page panel exists', indexHtml.includes('data-hub-page="hub-reports"'));
  assert('Analytics page panel exists', indexHtml.includes('data-hub-page="hub-analytics"'));
  assert('Analytics page has its own root container', indexHtml.includes('id="hubAnalyticsRoot"'));
  assert(
    'Analytics page title is Analytics (not Operations Dashboard)',
    /id="hubPageAnalytics"[\s\S]*?<h1>Analytics<\/h1>/.test(indexHtml)
  );

  // --- hub-analytics registered as a native tab in both shells ---
  assert('hub.js HUB_NATIVE_TABS includes hub-analytics', /HUB_NATIVE_TABS[\s\S]*?'hub-analytics'/.test(hubJs));
  assert(
    'index.html HUB_NATIVE_TABS includes hub-analytics',
    /const HUB_NATIVE_TABS = \[[^\]]*'hub-analytics'/.test(indexHtml)
  );
  assert('applyRoute knownTabs includes hub-analytics', /knownTabs = \[[^\]]*'hub-analytics'/.test(indexHtml));

  // --- parseHash maps #/dashboard, #/reports, #/analytics to the right tabs ---
  assert(
    'parseHash maps #/dashboard to hub-dashboard',
    /tab === 'dashboard'[\s\S]*?tab: 'hub-dashboard'/.test(indexHtml)
  );
  assert(
    'parseHash maps #/analytics to hub-analytics',
    /tab === 'analytics'[\s\S]*?tab: 'hub-analytics'/.test(indexHtml)
  );
  assert("parseHash maps #/reports to hub-reports", /tab === 'reports'[\s\S]*?tab: 'hub-reports'/.test(indexHtml));

  // --- buildRouteHash keeps each tab on its own hash (for back/forward + hard refresh) ---
  assert("buildRouteHash: hub-dashboard -> #/dashboard", /tab === 'hub-dashboard'\) return '#\/dashboard'/.test(hubJs));
  assert("buildRouteHash: hub-analytics -> #/analytics", /tab === 'hub-analytics'\) return '#\/analytics'/.test(hubJs));
  assert("buildRouteHash: hub-reports -> #/reports", /tab === 'hub-reports'\) return '#\/reports'/.test(hubJs));

  // --- Content is mounted by a dedicated init per tab (no shared dashboard render) ---
  assert('initHubAnalytics render function exists', hubJs.includes('function initHubAnalytics'));
  assert(
    'onTabActivated wires hub-analytics to initHubAnalytics',
    /tabName === 'hub-analytics'\) initHubAnalytics\(\)/.test(hubJs)
  );
  assert(
    'onTabActivated wires hub-dashboard to initDashboard',
    /tabName === 'hub-dashboard'\) initDashboard\(\)/.test(hubJs)
  );
  assert(
    'onTabActivated wires hub-reports to initHubReports',
    /tabName === 'hub-reports'\) initHubReports\(\)/.test(hubJs)
  );

  // --- initHubAnalytics shows its own page + sidebar, never the dashboard page ---
  const analyticsFn = hubJs.slice(hubJs.indexOf('function initHubAnalytics'));
  const analyticsBody = analyticsFn.slice(0, analyticsFn.indexOf('\n  function '));
  assert("initHubAnalytics calls showHubPage('hub-analytics')", analyticsBody.includes("showHubPage('hub-analytics')"));
  assert(
    "initHubAnalytics sets sidebar to hub-analytics",
    analyticsBody.includes("setSidebarForTab('hub-analytics')")
  );
  assert(
    'initHubAnalytics does not mount the dashboard page',
    !analyticsBody.includes("showHubPage('hub-dashboard')")
  );

  // --- setSidebarForTab activates the single matching nav link (no double-highlight) ---
  assert(
    'setSidebarForTab matches active nav by data-hub-tab',
    /setSidebarForTab[\s\S]*?hubTab === tabName/.test(hubJs)
  );

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('RESULT: FAIL');
    process.exit(1);
  }
  console.log('RESULT: PASS');
}

main();
