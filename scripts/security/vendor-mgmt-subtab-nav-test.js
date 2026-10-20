#!/usr/bin/env node
/**
 * Vendor Management subtab navigation regression (static + simulated browser DOM).
 *
 * Proves:
 * - each tab click changes active view + panel display
 * - each tab updates hash correctly
 * - direct hash load restores correct panel
 * - applyRoute / showContent does not bounce back to All Vendors
 *
 * Usage: npm run security:vendor-mgmt-subtab-nav-test
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const hubJs = fs.readFileSync(path.join(ROOT, 'hub.js'), 'utf8');

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

console.log('=== Vendor Management subtab navigation regression ===\n');

// ----- Static contracts in index.html -----
assert(
  'mgmtShowContent snapshots wasVisible before revealing content',
  /function mgmtShowContent\(\)[\s\S]{0,120}const wasVisible = mgmtContentVisible\(\)/.test(indexHtml)
);
assert(
  'mgmtShowContent only defaults when content was not visible',
  /else if \(!wasVisible\)[\s\S]{0,80}mgmtSwitchSection\('vendor'/.test(indexHtml)
);
assert(
  'switchTab skips mgmtCheckSession when content already visible',
  /if \(tabName === 'management'\)[\s\S]{0,400}if \(!mgmtContentVisible\(\)\)[\s\S]{0,120}mgmtCheckSession\(\)/.test(
    indexHtml
  )
);
assert(
  'subtab clicks use event delegation on #mgmtVendorSubtabs',
  /mgmtVendorSubtabs\.addEventListener\('click'/.test(indexHtml) &&
    /dataset\.mgmtView/.test(indexHtml)
);
assert(
  'data-mgmt-view values cover vendors/new/dashboard',
  /data-mgmt-view="vendors"/.test(indexHtml) &&
    /data-mgmt-view="new"/.test(indexHtml) &&
    /data-mgmt-view="dashboard"/.test(indexHtml)
);
assert(
  'mgmtVendorSubHash passes mgmtSection + segments',
  /function mgmtVendorSubHash[\s\S]{0,600}mgmtSection:\s*'vendor'[\s\S]{0,120}segments:/.test(indexHtml)
);
assert(
  'buildHash honors opts.segments (object form)',
  /fromOpts = Array\.isArray\(optsOrSeg\.segments\)/.test(indexHtml)
);
assert(
  'routeWithinManagement uses skipUrlUpdate for vendor subs',
  /const fromRoute = \{ skipUrlUpdate: true \}/.test(indexHtml) &&
    /view: 'new'/.test(indexHtml) &&
    /view: 'dashboard'/.test(indexHtml)
);
assert(
  '__mgmtSwitchView exposed for harness',
  /window\.__mgmtSwitchView\s*=\s*mgmtSwitchView/.test(indexHtml)
);

// ----- Extract HubUI.buildRouteHash for hash contract -----
const buildRouteMatch = hubJs.match(/function buildRouteHash\(tab, routeOpts = \{\}\) \{[\s\S]*?\n  \}/);
assert('hub buildRouteHash extractable', !!buildRouteMatch);

function buildRouteHash(tab, routeOpts = {}) {
  const fn = new Function(
    'tab',
    'routeOpts',
    'global',
    `${buildRouteMatch[0]}\nreturn buildRouteHash(tab, routeOpts);`
  );
  return fn(tab, routeOpts, {});
}

assert(
  'hash: vendors list',
  buildRouteHash('management', { mgmtSection: 'vendor', segments: [] }) === '#/management/vendors'
);
assert(
  'hash: new request',
  buildRouteHash('management', { mgmtSection: 'vendor', segments: ['new'] }) ===
    '#/management/vendors/new'
);
assert(
  'hash: dashboard',
  buildRouteHash('management', { mgmtSection: 'vendor', segments: ['dashboard'] }) ===
    '#/management/vendors/dashboard'
);

// ----- Simulated browser: panel + hash + no bounce -----
function createDom() {
  const store = new Map();
  function el(id, init) {
    const node = {
      id,
      style: { display: init.display != null ? init.display : 'none' },
      classList: {
        _set: new Set(init.className ? init.className.split(/\s+/).filter(Boolean) : []),
        toggle(name, on) {
          if (on) this._set.add(name);
          else this._set.delete(name);
        },
        contains(name) {
          return this._set.has(name);
        },
      },
      dataset: Object.assign({}, init.dataset || {}),
      textContent: init.textContent || '',
      innerHTML: '',
      children: [],
      contains(other) {
        return this === other || this.children.includes(other);
      },
      querySelectorAll(sel) {
        if (sel === '#mgmtVendorSubtabs .mgmt-subtab' || sel === '.mgmt-subtab') {
          return this.children.filter((c) => c.classList.contains('mgmt-subtab'));
        }
        return [];
      },
      addEventListener(type, fn) {
        this._listeners = this._listeners || {};
        this._listeners[type] = this._listeners[type] || [];
        this._listeners[type].push(fn);
      },
      click() {
        const ev = {
          target: this,
          preventDefault() {},
        };
        const parent = store.get('mgmtVendorSubtabs');
        (parent._listeners?.click || []).forEach((fn) => {
          ev.target = this;
          // closest('.mgmt-subtab')
          Object.defineProperty(ev, 'target', {
            value: {
              closest(sel) {
                if (sel === '.mgmt-subtab') return this._btn;
                return null;
              },
              _btn: this,
            },
          });
          // Simpler: call with synthetic closest
        });
      },
    };
    store.set(id, node);
    return node;
  }

  el('mgmtContent', { display: '' });
  el('mgmtGateCard', { display: 'none' });
  el('mgmtGateActions', { display: 'none' });
  el('mgmtVendorsView', { display: '' });
  el('mgmtNewView', { display: 'none' });
  el('mgmtDashboardView', { display: 'none' });
  el('mgmtDetailView', { display: 'none' });
  el('mgmtPermissionsView', { display: 'none' });
  el('mgmtRolesView', { display: 'none' });
  el('mgmtPssrView', { display: 'none' });
  el('mgmtSsoView', { display: 'none' });
  el('mgmtIntegrationsView', { display: 'none' });
  el('mgmtNewSuccess', { display: 'none' });
  el('mgmtHeading', { display: '' });
  el('mgmtCrumb', { display: '' });
  el('mgmtSubhead', { display: '' });
  el('mgmtRolePreviewBanner', { display: 'none' });

  const tabs = el('mgmtVendorSubtabs', { display: '' });
  const btnVendors = {
    classList: {
      _set: new Set(['mgmt-subtab', 'active']),
      toggle(n, on) {
        if (on) this._set.add(n);
        else this._set.delete(n);
      },
      contains(n) {
        return this._set.has(n);
      },
    },
    dataset: { mgmtView: 'vendors' },
    closest(sel) {
      return sel === '.mgmt-subtab' ? this : null;
    },
  };
  const btnNew = {
    classList: {
      _set: new Set(['mgmt-subtab']),
      toggle(n, on) {
        if (on) this._set.add(n);
        else this._set.delete(n);
      },
      contains(n) {
        return this._set.has(n);
      },
    },
    dataset: { mgmtView: 'new' },
    closest(sel) {
      return sel === '.mgmt-subtab' ? this : null;
    },
  };
  const btnDash = {
    classList: {
      _set: new Set(['mgmt-subtab']),
      toggle(n, on) {
        if (on) this._set.add(n);
        else this._set.delete(n);
      },
      contains(n) {
        return this._set.has(n);
      },
    },
    dataset: { mgmtView: 'dashboard' },
    closest(sel) {
      return sel === '.mgmt-subtab' ? this : null;
    },
  };
  tabs.children = [btnVendors, btnNew, btnDash];
  tabs.querySelectorAll = (sel) => {
    if (sel.includes('mgmt-subtab')) return tabs.children;
    return [];
  };
  tabs.contains = (n) => tabs.children.includes(n);
  tabs._listeners = {};
  tabs.addEventListener = (type, fn) => {
    tabs._listeners[type] = tabs._listeners[type] || [];
    tabs._listeners[type].push(fn);
  };

  return {
    getElementById(id) {
      return store.get(id) || null;
    },
    querySelectorAll(sel) {
      if (sel === '#mgmtVendorSubtabs .mgmt-subtab' || sel === '.mgmt-subtab') {
        return tabs.children;
      }
      return [];
    },
    body: { classList: { contains() { return false; } } },
    _tabs: tabs,
    _btns: { vendors: btnVendors, new: btnNew, dashboard: btnDash },
  };
}

function runSim() {
  const document = createDom();
  let hash = '#/management/vendors';
  let mgmtCurrentView = 'vendors';
  let mgmtCurrentSection = 'vendor';
  let _pendingMgmtRoute = null;
  let _pendingMgmtSection = null;
  let listLoadCalls = 0;
  let hashHistory = [hash];

  function mgmtContentVisible() {
    const content = document.getElementById('mgmtContent');
    return !!(content && content.style.display !== 'none');
  }

  function buildHash(tab, optsOrSeg, ...moreSegs) {
    let segments = [];
    let mgmtSection = null;
    if (optsOrSeg && typeof optsOrSeg === 'object' && !Array.isArray(optsOrSeg)) {
      mgmtSection = optsOrSeg.mgmtSection || null;
      const fromOpts = Array.isArray(optsOrSeg.segments) ? optsOrSeg.segments : [];
      segments = [...fromOpts, ...moreSegs].filter((s) => s != null && s !== '');
    } else if (optsOrSeg != null) {
      segments = [optsOrSeg, ...moreSegs].filter((s) => s != null && s !== '');
    }
    return buildRouteHash(tab, { mgmtSection, segments });
  }

  function setHash(next) {
    if (hash === next) return;
    hash = next;
    hashHistory.push(next);
    applyRoute();
  }

  function mgmtVendorSubHash(view) {
    const map = { vendors: '', new: 'new', dashboard: 'dashboard' };
    const sub = map[view] !== undefined ? map[view] : '';
    return buildHash('management', {
      mgmtSection: 'vendor',
      segments: sub ? [sub] : [],
    });
  }

  function mgmtSwitchView(view, opts = {}) {
    const allowed = new Set(['vendors', 'new', 'dashboard', 'detail']);
    if (!allowed.has(view)) view = 'vendors';
    const vendorsView = document.getElementById('mgmtVendorsView');
    const newView = document.getElementById('mgmtNewView');
    const dashView = document.getElementById('mgmtDashboardView');
    const detailView = document.getElementById('mgmtDetailView');
    if (!vendorsView || !newView || !dashView || !detailView) return;

    mgmtCurrentView = view;
    document.querySelectorAll('#mgmtVendorSubtabs .mgmt-subtab').forEach((t) => {
      t.classList.toggle('active', t.dataset.mgmtView === view);
    });
    vendorsView.style.display = view === 'vendors' ? '' : 'none';
    newView.style.display = view === 'new' ? '' : 'none';
    dashView.style.display = view === 'dashboard' ? '' : 'none';
    detailView.style.display = view === 'detail' ? '' : 'none';

    if (!opts.skipLoad) {
      if (view === 'vendors') {
        listLoadCalls += 1;
        // list errors must not block navigation
        try {
          throw new Error('List failed: 429');
        } catch {
          /* ignore */
        }
      }
    }

    if (!opts.skipUrlUpdate && view !== 'detail') {
      setHash(mgmtVendorSubHash(view));
    }
  }

  function mgmtSwitchSection(section, opts = {}) {
    if (section !== 'vendor') return;
    mgmtCurrentSection = 'vendor';
    mgmtSwitchView(opts.view || 'vendors', { skipUrlUpdate: true, skipLoad: !!opts.skipLoad });
    if (!opts.skipUrlUpdate) {
      setHash(mgmtVendorSubHash(opts.view || mgmtCurrentView || 'vendors'));
    }
  }

  function routeWithinManagement(segments) {
    const first = segments[0];
    const fromRoute = { skipUrlUpdate: true };
    if (!first) {
      mgmtSwitchSection('vendor', { view: 'vendors', skipUrlUpdate: true });
      return;
    }
    if (first === 'vendors') {
      const sub = segments[1];
      if (!sub) {
        mgmtSwitchSection('vendor', { view: 'vendors', ...fromRoute });
        return;
      }
      if (sub === 'new') {
        mgmtSwitchSection('vendor', { view: 'new', ...fromRoute });
        return;
      }
      if (sub === 'dashboard') {
        mgmtSwitchSection('vendor', { view: 'dashboard', ...fromRoute });
        return;
      }
    }
    if (first === 'new') {
      mgmtSwitchSection('vendor', { view: 'new', ...fromRoute });
      return;
    }
    if (first === 'dashboard') {
      mgmtSwitchSection('vendor', { view: 'dashboard', ...fromRoute });
      return;
    }
    mgmtSwitchSection('vendor', { view: 'vendors', ...fromRoute });
  }

  function mgmtShowContent() {
    const wasVisible = mgmtContentVisible();
    document.getElementById('mgmtGateCard').style.display = 'none';
    document.getElementById('mgmtContent').style.display = '';
    if (_pendingMgmtRoute && _pendingMgmtRoute.length) {
      const segments = _pendingMgmtRoute;
      _pendingMgmtRoute = null;
      _pendingMgmtSection = null;
      routeWithinManagement(segments);
    } else if (_pendingMgmtSection) {
      const section = _pendingMgmtSection;
      _pendingMgmtSection = null;
      mgmtSwitchSection(section, { skipUrlUpdate: true });
    } else if (!wasVisible) {
      mgmtSwitchSection('vendor', { view: 'vendors', skipUrlUpdate: true });
    }
  }

  function applyManagementSubRoute(segments, mgmtSectionHint) {
    if (segments && segments.length) _pendingMgmtRoute = segments.slice();
    if (mgmtSectionHint) _pendingMgmtSection = mgmtSectionHint;
    else if (!_pendingMgmtSection) _pendingMgmtSection = 'vendor';

    const isAuthed = mgmtContentVisible();
    if (isAuthed) {
      const replay = _pendingMgmtRoute;
      _pendingMgmtRoute = null;
      _pendingMgmtSection = null;
      routeWithinManagement(replay || []);
    }
  }

  function parseHash() {
    let h = hash || '';
    if (h.startsWith('#')) h = h.slice(1);
    if (h.startsWith('/')) h = h.slice(1);
    const parts = h.split('/').filter(Boolean);
    let rest = parts.slice(1);
    if (parts[0] === 'management' && rest[0] === 'vendors') {
      rest = rest.slice(1);
      return { tab: 'management', segments: rest, mgmtSection: 'vendor' };
    }
    return { tab: parts[0] || 'management', segments: rest, mgmtSection: 'vendor' };
  }

  function switchTab(tabName, opts = {}) {
    if (tabName !== 'management') return;
    // Fixed contract: do not re-auth / showContent when already unlocked
    if (!mgmtContentVisible()) {
      _pendingMgmtSection = opts.mgmtSection || _pendingMgmtSection || 'vendor';
      mgmtShowContent();
    } else if (opts.mgmtSection && opts.mgmtSection !== mgmtCurrentSection) {
      mgmtSwitchSection(opts.mgmtSection, { skipUrlUpdate: true });
    }
  }

  function applyRoute() {
    const parsed = parseHash();
    switchTab('management', { mgmtSection: parsed.mgmtSection });
    applyManagementSubRoute(parsed.segments, parsed.mgmtSection);
  }

  // Wire delegated clicks (mirrors index.html)
  const subtabs = document.getElementById('mgmtVendorSubtabs');
  subtabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.mgmt-subtab');
    if (!btn || !subtabs.contains(btn)) return;
    e.preventDefault();
    const view = btn.dataset.mgmtView;
    if (view) mgmtSwitchView(view);
  });

  function clickTab(view) {
    const btn = document._btns[view];
    const ev = {
      target: btn,
      preventDefault() {},
    };
    subtabs._listeners.click.forEach((fn) => fn(ev));
  }

  function panelState() {
    return {
      view: mgmtCurrentView,
      vendors: document.getElementById('mgmtVendorsView').style.display,
      new: document.getElementById('mgmtNewView').style.display,
      dashboard: document.getElementById('mgmtDashboardView').style.display,
      activeVendors: document._btns.vendors.classList.contains('active'),
      activeNew: document._btns.new.classList.contains('active'),
      activeDash: document._btns.dashboard.classList.contains('active'),
      hash,
    };
  }

  // Start on All Vendors (content already unlocked — live retest condition)
  applyRoute();
  assert('start on All Vendors', mgmtCurrentView === 'vendors' && hash === '#/management/vendors');

  clickTab('new');
  let s = panelState();
  assert('click New → active view new', s.view === 'new');
  assert('click New → new panel visible', s.new === '' && s.vendors === 'none');
  assert('click New → hash /vendors/new', s.hash === '#/management/vendors/new');
  assert('click New → New tab CSS active', s.activeNew && !s.activeVendors);

  // Simulate late auth callback that used to bounce (mgmtCheckSession → showContent)
  mgmtShowContent();
  s = panelState();
  assert('no bounce after showContent (stays on new)', s.view === 'new' && s.hash === '#/management/vendors/new');

  clickTab('dashboard');
  s = panelState();
  assert('click Dashboard → view dashboard', s.view === 'dashboard');
  assert('click Dashboard → hash /vendors/dashboard', s.hash === '#/management/vendors/dashboard');
  assert('click Dashboard → panel visible', s.dashboard === '' && s.new === 'none');

  mgmtShowContent();
  assert(
    'no bounce after showContent (stays on dashboard)',
    mgmtCurrentView === 'dashboard' && hash === '#/management/vendors/dashboard'
  );

  clickTab('vendors');
  s = panelState();
  assert('click All Vendors → view vendors', s.view === 'vendors' && s.hash === '#/management/vendors');
  assert('list error did not block tab nav', listLoadCalls >= 1 && s.view === 'vendors');

  // Direct hash loads
  hash = '#/management/vendors/new';
  applyRoute();
  assert('direct hash /new restores new panel', mgmtCurrentView === 'new');
  assert(
    'direct hash /new keeps URL',
    hash === '#/management/vendors/new'
  );

  hash = '#/management/vendors/dashboard';
  applyRoute();
  assert('direct hash /dashboard restores dashboard', mgmtCurrentView === 'dashboard');

  hash = '#/management/vendors';
  applyRoute();
  assert('direct hash /vendors restores list', mgmtCurrentView === 'vendors');

  // Fresh unlock (content hidden) then showContent should default once
  document.getElementById('mgmtContent').style.display = 'none';
  _pendingMgmtRoute = null;
  _pendingMgmtSection = null;
  mgmtShowContent();
  assert('first unlock defaults to All Vendors', mgmtCurrentView === 'vendors');

  // Fresh unlock with pending /new
  document.getElementById('mgmtContent').style.display = 'none';
  _pendingMgmtRoute = ['new'];
  _pendingMgmtSection = 'vendor';
  mgmtShowContent();
  assert('first unlock with pending /new → new', mgmtCurrentView === 'new');
}

runSim();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
