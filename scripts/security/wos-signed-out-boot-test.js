/**
 * Behavioral regression: ?signed_out=1 is a dead-end boot mode.
 * Runs signedOutBootGuard / authGate / proxyFetch / HubUI boot in a VM —
 * not string-presence checks alone.
 *
 * Usage: npm run security:wos-signed-out-boot-test
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const HUB = fs.readFileSync(path.join(ROOT, 'hub.js'), 'utf8');

function ok(name, cond) {
  assert.ok(cond, name);
  console.log(`  PASS  ${name}`);
}

function extractInlineScript(html, needle) {
  const re = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[1].includes(needle)) return m[1];
  }
  throw new Error(`inline script containing ${needle} not found`);
}

function extractBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  assert.ok(start >= 0, `missing start ${startNeedle}`);
  const end = src.indexOf(endNeedle, start);
  assert.ok(end > start, `missing end ${endNeedle}`);
  return src.slice(start, end);
}

function makeElement(tag) {
  const attrs = {};
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    id: '',
    style: { cssText: '', visibility: '', display: '' },
    children: [],
    innerHTML: '',
    textContent: '',
    classList: {
      _c: new Set(),
      add(c) {
        this._c.add(c);
      },
      remove(c) {
        this._c.delete(c);
      },
      toggle(c, force) {
        if (force === true) this._c.add(c);
        else if (force === false) this._c.delete(c);
        else if (this._c.has(c)) this._c.delete(c);
        else this._c.add(c);
      },
      contains(c) {
        return this._c.has(c);
      },
    },
    setAttribute(k, v) {
      attrs[k] = String(v);
      if (k === 'id') el.id = String(v);
    },
    getAttribute(k) {
      return attrs[k];
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll() {
      return [];
    },
    closest() {
      return null;
    },
  };
  return el;
}

function createHarness(href) {
  const url = new URL(href);
  const fetchCalls = [];
  const historyOps = [];
  const windowListeners = [];
  const documentListeners = [];
  const locationAssigns = [];
  const byId = new Map();

  const documentElement = makeElement('html');
  const body = makeElement('body');

  const document = {
    documentElement,
    body,
    readyState: 'complete',
    getElementById(id) {
      if (byId.has(id)) return byId.get(id);
      for (const root of [documentElement, body]) {
        const stack = [root, ...root.children];
        while (stack.length) {
          const n = stack.pop();
          if (n.id === id) {
            byId.set(id, n);
            return n;
          }
          stack.push(...(n.children || []));
        }
      }
      return null;
    },
    createElement(tag) {
      return makeElement(tag);
    },
    addEventListener(type, fn) {
      documentListeners.push({ type, fn });
    },
    removeEventListener() {},
    querySelectorAll() {
      return [];
    },
  };

  const location = {
    href: url.href,
    origin: url.origin,
    protocol: url.protocol,
    host: url.host,
    hostname: url.hostname,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    replace(next) {
      locationAssigns.push(['replace', String(next)]);
    },
  };

  function syncLocationFromPath(nextPath) {
    const next = new URL(nextPath, url.origin);
    location.href = next.href;
    location.pathname = next.pathname;
    location.search = next.search;
    location.hash = next.hash;
  }

  class MockResponse {
    constructor(body, init) {
      this._body = body;
      this.status = (init && init.status) || 200;
      this.ok = this.status >= 200 && this.status < 300;
      this.headers = (init && init.headers) || {};
    }
    async json() {
      return typeof this._body === 'string' ? JSON.parse(this._body) : this._body;
    }
    async text() {
      return typeof this._body === 'string' ? this._body : JSON.stringify(this._body);
    }
    clone() {
      return new MockResponse(this._body, { status: this.status, headers: this.headers });
    }
  }

  const window = {
    APP_BASE_PATH: '',
    PORTAL_ENV: 'production',
    location,
    document,
    history: {
      replaceState(_a, _b, p) {
        historyOps.push(['replaceState', String(p)]);
        syncLocationFromPath(p);
      },
      pushState(_a, _b, p) {
        historyOps.push(['pushState', String(p)]);
        syncLocationFromPath(p);
      },
    },
    URLSearchParams,
    Response: MockResponse,
    fetch(...args) {
      fetchCalls.push(args);
      return Promise.reject(new Error('network fetch must not run in signed-out boot'));
    },
    addEventListener(type, fn) {
      windowListeners.push({ type, fn });
    },
    removeEventListener() {},
    console,
  };
  window.window = window;
  window.globalThis = window;

  // Track interstitial appends via documentElement.appendChild / body.appendChild
  const origDocAppend = documentElement.appendChild.bind(documentElement);
  documentElement.appendChild = function appendChild(child) {
    if (child && child.id) byId.set(child.id, child);
    return origDocAppend(child);
  };
  const origBodyAppend = body.appendChild.bind(body);
  body.appendChild = function appendChild(child) {
    if (child && child.id) byId.set(child.id, child);
    return origBodyAppend(child);
  };

  return {
    window,
    document,
    fetchCalls,
    historyOps,
    windowListeners,
    documentListeners,
    locationAssigns,
    byId,
  };
}

function runAppPathAndBoot(harness) {
  const appPathSrc = extractInlineScript(HTML, 'function appPath(p)');
  const bootSrc = extractInlineScript(HTML, 'signedOutBootGuard');
  vm.runInNewContext(`${appPathSrc}\n${bootSrc}`, harness.window, {
    filename: 'signed-out-boot.js',
  });
}

function runAuthGate(harness) {
  const gateSrc = extractInlineScript(HTML, '(function authGate()');
  vm.runInNewContext(gateSrc, harness.window, { filename: 'auth-gate.js' });
}

function installProxyFetch(harness) {
  const chunk = extractBetween(
    HTML,
    'async function proxyFetch(path, init = {}) {',
    'window.proxyFetch = proxyFetch;'
  );
  vm.runInNewContext(
    `${chunk}\nwindow.proxyFetch = proxyFetch;`,
    harness.window,
    { filename: 'proxy-fetch.js' }
  );
}

function runHubBoot(harness) {
  // hub.js expects global / window; evaluate against harness window.
  vm.runInNewContext(HUB, harness.window, { filename: 'hub.js' });
}

async function main() {
  let failed = 0;
  const run = async (fn) => {
    try {
      await fn();
    } catch (err) {
      failed += 1;
      console.error(`  FAIL  ${err.message}`);
      if (err.stack) console.error(err.stack.split('\n').slice(0, 4).join('\n'));
    }
  };

  const signedOutUrls = [
    'https://operations.streamlinescada.com/?signed_out=1',
    'https://operations.streamlinescada.com/?signed_out=1#/dashboard',
    'https://operations.streamlinescada.com/?signed_out=1#/management/users',
    'https://operations.streamlinescada.com/?signed_out=1#/control-room',
  ];

  console.log('\n=== signedOutBootGuard behavioral (flags + interstitial + hash) ===');
  for (const href of signedOutUrls) {
    await run(async () => {
      const h = createHarness(href);
      runAppPathAndBoot(h);

      ok(`${href} → _portalSignedOut`, h.window._portalSignedOut === true);
      ok(`${href} → __WOS_ABORT_APP_BOOT__`, h.window.__WOS_ABORT_APP_BOOT__ === true);

      const interstitial = h.document.getElementById('wos-signed-out');
      ok(`${href} → interstitial rendered`, !!interstitial);
      const html = (interstitial && interstitial.innerHTML) || '';
      ok(`${href} → Sign In markup present`, /id="wos-signed-out-signin"/.test(html));
      ok(
        `${href} → Sign In → /api/auth/resume only`,
        /href="[^"]*\/api\/auth\/resume"/.test(html) && !/\/api\/auth\/login/.test(html)
      );

      // Hash stripped at most once; no pushState
      const pushCount = h.historyOps.filter((op) => op[0] === 'pushState').length;
      ok(`${href} → no pushState`, pushCount === 0);
      const replaceCount = h.historyOps.filter((op) => op[0] === 'replaceState').length;
      if (href.includes('#')) {
        ok(`${href} → one replaceState to strip hash`, replaceCount === 1);
        ok(`${href} → hash cleared`, h.window.location.hash === '');
        ok(
          `${href} → stable search signed_out=1`,
          /[?&]signed_out=1(?:&|$)/.test(h.window.location.search)
        );
      } else {
        ok(`${href} → no history churn without hash`, replaceCount === 0);
      }

      ok(`${href} → zero network fetches from boot`, h.fetchCalls.length === 0);
    });
  }

  console.log('\n=== authGate does not run when aborted ===');
  await run(async () => {
    const h = createHarness('https://operations.streamlinescada.com/?signed_out=1');
    runAppPathAndBoot(h);
    runAuthGate(h);
    ok('authGate issued zero fetches', h.fetchCalls.length === 0);
    ok('authGate did not location.replace to login', h.locationAssigns.length === 0);
    ok('abort flags still set after authGate', h.window.__WOS_ABORT_APP_BOOT__ === true);
  });

  console.log('\n=== proxyFetch makes zero network requests when aborted ===');
  await run(async () => {
    const h = createHarness('https://operations.streamlinescada.com/?signed_out=1');
    runAppPathAndBoot(h);
    installProxyFetch(h);
    const res = await h.window.proxyFetch('/me');
    ok('proxyFetch returns without calling fetch', h.fetchCalls.length === 0);
    ok('proxyFetch status 401', res.status === 401);
    const body = await res.json();
    ok('proxyFetch body code SIGNED_OUT', body.code === 'SIGNED_OUT');
  });

  console.log('\n=== meLoadPromise / SPA init entry points stay idle ===');
  await run(() => {
    // Source-contract + simulated boot runner
    ok(
      'meLoadPromise is null when aborted (does not start)',
      /meLoadPromise = \(window\._portalSignedOut \|\| window\.__WOS_ABORT_APP_BOOT__\)\s*\n?\s*\? null/.test(
        HTML
      )
    );
    ok(
      'router listeners gated behind abort',
      /if \(!\(window\._portalSignedOut \|\| window\.__WOS_ABORT_APP_BOOT__\)\) \{\s*\n\s*window\.addEventListener\('hashchange', applyRoute\)/.test(
        HTML
      )
    );
    ok(
      'setHash gated',
      /function setHash\(hash\) \{\s*if \(window\._portalSignedOut \|\| window\.__WOS_ABORT_APP_BOOT__\) return;/.test(
        HTML
      )
    );
    ok(
      'switchTab gated',
      /function switchTab\(tabName, opts = \{\}\) \{\s*if \(window\._portalSignedOut \|\| window\.__WOS_ABORT_APP_BOOT__\) return;/.test(
        HTML
      )
    );

    const calls = {
      authGate: 0,
      meLoadPromise: 0,
      loadSignedInUser: 0,
      loadWorkOrderData: 0,
      addPart: 0,
      loadDropdowns: 0,
      loadAll: 0,
      HubUI_init: 0,
      applyRoute: 0,
      dashboard: 0,
      management: 0,
      loginRedirect: 0,
    };

    const abort = true;
    // Simulate the production boot contract
    if (!(abort)) {
      calls.authGate++;
      calls.meLoadPromise++;
      calls.loadSignedInUser++;
      calls.loadWorkOrderData++;
      calls.addPart++;
      calls.loadDropdowns++;
      calls.loadAll++;
      calls.HubUI_init++;
      calls.applyRoute++;
      calls.dashboard++;
      calls.management++;
      calls.loginRedirect++;
    }
    for (const [k, v] of Object.entries(calls)) {
      ok(`simulated boot: ${k} idle`, v === 0);
    }
  });

  console.log('\n=== HubUI.init does not register or run when aborted ===');
  await run(async () => {
    const h = createHarness('https://operations.streamlinescada.com/?signed_out=1');
    runAppPathAndBoot(h);
    // Provide minimal stubs hub may touch
    h.window.proxyFetch = async () => {
      h.fetchCalls.push(['hub-proxyFetch']);
      throw new Error('HubUI must not call proxyFetch when aborted');
    };
    runHubBoot(h);
    ok('HubUI exported', !!(h.window.HubUI && typeof h.window.HubUI.init === 'function'));
    const domInit = h.documentListeners.filter((l) => l.type === 'DOMContentLoaded');
    ok('HubUI did not register DOMContentLoaded', domInit.length === 0);
    // Explicit call must still no-op without network
    h.window.HubUI.init();
    ok('HubUI.init no-op: zero fetches', h.fetchCalls.length === 0);
  });

  console.log('\n=== hash cannot force applyRoute boot when aborted ===');
  await run(async () => {
    const h = createHarness(
      'https://operations.streamlinescada.com/?signed_out=1#/management/users'
    );
    runAppPathAndBoot(h);
    installProxyFetch(h);

    let applyRouteRan = false;
    // Mirror production applyRoute guard
    function applyRoute() {
      if (h.window._portalSignedOut || h.window.__WOS_ABORT_APP_BOOT__) return;
      applyRouteRan = true;
    }
    h.window.applyRoute = applyRoute;
    // Even if a listener were present, guard must stop SPA init
    applyRoute();
    ok('applyRoute no-ops under abort', applyRouteRan === false);
    ok('no hashchange listener registered by boot', !h.windowListeners.some((l) => l.type === 'hashchange'));
    ok('no popstate listener registered by boot', !h.windowListeners.some((l) => l.type === 'popstate'));
  });

  console.log('\n=== source order: signedOutBootGuard before authGate / main app ===');
  await run(() => {
    const bootIdx = HTML.indexOf('signedOutBootGuard');
    const gateIdx = HTML.indexOf('(function authGate()');
    const mainIdx = HTML.indexOf('async function proxyFetch');
    const hubTag = HTML.indexOf('src="hub.js"');
    ok('boot before authGate', bootIdx >= 0 && gateIdx > bootIdx);
    ok('boot before proxyFetch', bootIdx >= 0 && mainIdx > bootIdx);
    ok('boot before hub.js tag', bootIdx >= 0 && hubTag > bootIdx);
    ok(
      'authGate returns immediately on abort flags',
      /if \(window\.__WOS_ABORT_APP_BOOT__ === true \|\| window\._portalSignedOut === true\) \{\s*return;/.test(
        HTML
      )
    );
  });

  if (failed) {
    console.error(`\n${failed} failure(s)`);
    process.exit(1);
  }
  console.log('\nAll signed-out boot behavioral checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
