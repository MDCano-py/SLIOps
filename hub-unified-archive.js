/**
 * WOS-71 — Unified Archive hub page (single sidebar entry, filterable legacy archives).
 */
(function (global) {
  'use strict';

  const ARCHIVE_FILTERS = [
    { key: 'all', label: 'All', tab: null },
    { key: 'forms', label: 'Forms', tab: 'forms-archive', loadKind: 'forms' },
    { key: 'jsa', label: 'JSA', tab: 'jsa-archive', loadKind: 'jsa' },
    { key: 'bol', label: 'BOL', tab: 'bol-archive', loadKind: 'bol' },
    { key: 'work-orders', label: 'Work Orders', tab: 'work-order-archive', loadKind: 'wo' },
    { key: 'parts', label: 'Parts Requests', tab: 'parts-request-archive', loadKind: 'parts' },
    { key: 'ros', label: 'Roll Off Swap', tab: 'roll-off-swap-archive', loadKind: 'ros' },
  ];

  const LEGACY_TAB_TO_FILTER = {
    'forms-archive': 'forms',
    'jsa-archive': 'jsa',
    'bol-archive': 'bol',
    'work-order-archive': 'work-orders',
    'parts-request-archive': 'parts',
    'roll-off-swap-archive': 'ros',
  };

  const FILTER_ALIASES = {
    forms: 'forms',
    form: 'forms',
    submissions: 'forms',
    'submitted-forms': 'forms',
    jsa: 'jsa',
    bol: 'bol',
    parts: 'parts',
    'parts-request': 'parts',
    'parts-requests': 'parts',
    'work-order': 'work-orders',
    'work-orders': 'work-orders',
    wo: 'work-orders',
    ros: 'ros',
    'roll-off-swap': 'ros',
    all: 'all',
  };

  const HASH_FILTER_SEGMENTS = {
    all: '',
    forms: 'forms',
    jsa: 'jsa',
    bol: 'bol',
    'work-orders': 'work-orders',
    parts: 'parts-requests',
    ros: 'roll-off-swap',
  };

  const FILTER_LABELS = {
    forms: 'Forms',
    jsa: 'JSA',
    bol: 'BOL',
    'work-orders': 'Work Orders',
    parts: 'Parts Requests',
    ros: 'Roll Off Swap',
  };

  function parseArchiveRouteFromHash(hash) {
    let h = String(hash || '');
    if (h.startsWith('#')) h = h.slice(1);
    if (h.startsWith('/')) h = h.slice(1);
    const qIdx = h.indexOf('?');
    if (qIdx >= 0) h = h.slice(0, qIdx);
    const segments = h.split('/').filter(Boolean);
    const tab = segments[0] || '';
    const rest = segments.slice(1);
    if (tab === 'archive' || tab === 'archives') {
      const filterKey = rest[0] ? normalizeFilter(rest[0]) : 'all';
      const segs = filterKey === 'all' && rest[0] === 'all' ? rest.slice(1) : rest[0] && normalizeFilter(rest[0]) !== 'all' ? rest.slice(1) : rest;
      return { filter: filterKey, segments: segs };
    }
    return { filter: 'all', segments: [] };
  }

  function getActiveArchiveFilterFromHash(fallback) {
    const parsed = parseArchiveRouteFromHash(global.location?.hash || '');
    if (parsed.filter && parsed.filter !== 'all') return parsed.filter;
    if (fallback) return normalizeFilter(fallback);
    return 'all';
  }

  function esc(s) {
    if (s == null) return '';
    if (typeof global.escapeHtml === 'function') return global.escapeHtml(s);
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeFilter(filter) {
    return FILTER_ALIASES[String(filter || 'all').toLowerCase()] || 'all';
  }

  function filterMeta(filterKey) {
    return ARCHIVE_FILTERS.find((f) => f.key === filterKey) || ARCHIVE_FILTERS[0];
  }

  function filterToLegacyTab(filterKey) {
    const meta = filterMeta(filterKey);
    return meta.tab || null;
  }

  function legacyTabToFilter(tab) {
    return LEGACY_TAB_TO_FILTER[tab] || 'all';
  }

  function buildArchiveHash(filter, segments) {
    const f = normalizeFilter(filter);
    const segs = (segments || []).filter(Boolean);
    if (f === 'all' && !segs.length) return '#/archives';
    if (f === 'all') return '#/archives/all/' + segs.join('/');
    const seg = HASH_FILTER_SEGMENTS[f] || f;
    return '#/archives/' + seg + (segs.length ? '/' + segs.join('/') : '');
  }

  function renderOverviewHtml(counts = {}) {
    const cards = ARCHIVE_FILTERS.filter((f) => f.tab)
      .map(
        (f) => {
          const count = counts[f.key];
          const countLabel =
            typeof count === 'number'
              ? `<span class="hub-archive-overview-count">${count} record${count === 1 ? '' : 's'}</span>`
              : '';
          return `<button type="button" class="hub-archive-overview-card" data-archive-filter="${esc(f.key)}">
            <strong>${esc(f.label)}</strong>
            ${countLabel}
            <span class="hub-sub">Browse archived ${esc(f.label.toLowerCase())} records</span>
          </button>`;
        }
      )
      .join('');
    return `<div class="hub-archive-overview">
      <p class="hub-sub">Choose a category below to browse archived records, or use the filters above.</p>
      <div class="hub-archive-overview-grid">${cards}</div>
    </div>`;
  }

  async function fetchArchiveCounts() {
    const fetchFn = async (path, init = {}) => {
      if (typeof global.proxyFetch === 'function') {
        return global.proxyFetch(path, init);
      }
      const headers = {
        Accept: 'application/json',
        ...(init.headers || {}),
      };
      if (global._portalNoAuth || (global.RbacClient && global.RbacClient.isPortalNoAuthMode && global.RbacClient.isPortalNoAuthMode())) {
        headers['X-Portal-Noauth'] = '1';
      }
      const url = '/api/maintainx?path=' + encodeURIComponent(path);
      return global.fetch(url, { ...init, headers, credentials: 'include' });
    };

    const counts = {};
    const tasks = ARCHIVE_FILTERS.filter((f) => f.tab).map(async (f) => {
      try {
        let path;
        if (f.key === 'jsa' || f.key === 'bol') {
          path = `/archive/${f.loadKind}?page=1&pageSize=1`;
        } else if (f.key === 'parts' || f.key === 'work-orders') {
          path = `/request-archive/${f.key === 'parts' ? 'parts' : 'wo'}`;
        } else if (f.key === 'ros') {
          path = '/forms/roll-off-swap';
        } else if (f.key === 'forms') {
          path = '/hub/templates/submissions?limit=1';
        } else {
          return;
        }
        const res = await fetchFn(path, { headers: { Accept: 'application/json' } });
        if (!res.ok) return;
        const data = await res.json();
        if (f.key === 'jsa' || f.key === 'bol') {
          counts[f.key] = data.total ?? (data.records || []).length;
        } else {
          counts[f.key] = data.count ?? (data.records || []).length;
        }
      } catch {
        /* counts are optional UI polish */
      }
    });
    await Promise.all(tasks);
    return counts;
  }

  function renderFilterBar(activeFilter) {
    return ARCHIVE_FILTERS.map(
      (f) =>
        `<button type="button" class="hub-archive-filter${activeFilter === f.key ? ' is-active' : ''}" data-archive-filter="${esc(f.key)}">${esc(f.label)}</button>`
    ).join('');
  }

  function getPanelId(tab) {
    const map = global.HubUI?.LEGACY_PANEL_IDS || {};
    return map[tab] || null;
  }

  function mountArchivePanel(tab, contentEl) {
    if (!contentEl || !tab) return false;
    const panelId = getPanelId(tab);
    const panel = panelId ? document.getElementById(panelId) : null;
    if (!panel) return false;

    Object.values(global.HubUI?.LEGACY_PANEL_IDS || {}).forEach((id) => {
      const el = document.getElementById(id);
      if (!el || el === panel) return;
      el.classList.remove('hub-archive-embedded', 'hub-legacy-active');
      el.style.display = 'none';
    });

    panel.classList.add('hub-legacy-panel', 'hub-archive-embedded', 'hub-legacy-active');
    panel.style.display = 'block';
    panel.hidden = false;
    panel.removeAttribute('aria-hidden');
    if (panel.parentElement !== contentEl) contentEl.appendChild(panel);
    return true;
  }

  function clearArchiveMount(contentEl) {
    if (!contentEl) return;
    Object.values(global.HubUI?.LEGACY_PANEL_IDS || {}).forEach((id) => {
      const panel = document.getElementById(id);
      if (!panel) return;
      panel.classList.remove('hub-archive-embedded', 'hub-legacy-active');
      panel.style.display = 'none';
    });
    const stash = document.getElementById('hubLegacyPanelStash');
    while (contentEl.firstChild) {
      const child = contentEl.firstChild;
      if (stash) stash.appendChild(child);
      else contentEl.removeChild(child);
    }
  }

  function triggerArchiveLoad(tab) {
    const run = () => {
      if (global.HubArchiveLoaders && typeof global.HubArchiveLoaders.loadForTab === 'function') {
        global.HubArchiveLoaders.loadForTab(tab);
        return;
      }
      if (typeof global.switchTab === 'function') {
        global.switchTab(tab);
      }
    };
    run();
  }

  /**
   * Sync location hash for archive routes without triggering applyRoute.
   */
  function syncArchiveHash(filter, segments) {
    const normalized = normalizeFilter(filter);
    const segs = (segments || []).filter(Boolean);
    const hash = buildArchiveHash(normalized, segs);
    if (global.location && global.location.hash !== hash) {
      try {
        if (!global.location.hash || global.location.hash === '#/') {
          history.replaceState(null, '', hash);
        } else {
          history.pushState(null, '', hash);
        }
        if (typeof global.resetRouteCache === 'function') global.resetRouteCache();
      } catch (e) { /* non-fatal */ }
    }
    global._hubArchiveRoute = { filter: normalized, segments: segs };
    return normalized;
  }

  function resolveArchiveFilter(opts = {}) {
    if (opts.filter != null && String(opts.filter) !== '') {
      return normalizeFilter(opts.filter);
    }
    return getActiveArchiveFilterFromHash(opts.fallback);
  }

  let archiveActivationInFlight = null;

  /**
   * User-facing archive category navigation — mounts the list immediately and
   * syncs the URL. Hash is updated before mount so async overview work cannot
   * overwrite an active category view.
   */
  async function selectArchiveFilter(filter, opts = {}) {
    const normalized = normalizeFilter(filter);
    const segments = (opts.segments || []).filter(Boolean);
    syncArchiveHash(normalized, segments);
    if (global.HubUI && typeof global.HubUI.showHubPage === 'function') {
      global.HubUI.showHubPage('hub-archive');
    }
    if (global.HubUI && typeof global.HubUI.setSidebarForTab === 'function') {
      global.HubUI.setSidebarForTab('hub-archive');
    }
    if (archiveActivationInFlight) {
      await archiveActivationInFlight;
    }
    archiveActivationInFlight = initUnifiedArchive({ filter: normalized, segments });
    try {
      await archiveActivationInFlight;
    } finally {
      archiveActivationInFlight = null;
    }
  }

  function wireFilterButtons(root) {
    root.querySelectorAll('[data-archive-filter]').forEach((btn) => {
      btn.dataset.archiveFilterWired = '1';
    });
  }

  let archiveFilterDelegationWired = false;
  let archiveInitSeq = 0;

  function ensureArchiveFilterDelegation() {
    const root = document.getElementById('hubArchiveRoot');
    if (!root || archiveFilterDelegationWired) return;
    archiveFilterDelegationWired = true;
    root.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-archive-filter]');
      if (!btn || !root.contains(btn)) return;
      event.preventDefault();
      event.stopPropagation();
      selectArchiveFilter(btn.dataset.archiveFilter);
    });
  }

  /**
   * Apply archive route from current hash (hard refresh, back/forward, applyRoute).
   */
  async function applyArchiveRouteFromHash(opts = {}) {
    const hashRoute = parseArchiveRouteFromHash(global.location?.hash || '');
    const filter = resolveArchiveFilter({
      filter: opts.filter || opts.archiveFilter || hashRoute.filter,
    });
    const segments = (opts.segments && opts.segments.length) ? opts.segments : hashRoute.segments;
    if (archiveActivationInFlight) {
      await archiveActivationInFlight;
    }
    archiveActivationInFlight = initUnifiedArchive({ filter, segments });
    try {
      await archiveActivationInFlight;
    } finally {
      archiveActivationInFlight = null;
    }
  }

  /**
   * @param {object} opts — { filter, segments } (filter is explicit when provided)
   */
  async function initUnifiedArchive(opts = {}) {
    const seq = ++archiveInitSeq;
    const filter = resolveArchiveFilter(opts);
    const hashRoute = parseArchiveRouteFromHash(global.location?.hash || '');
    const routeSegments = (opts.segments && opts.segments.length) ? opts.segments : hashRoute.segments;
    const root = document.getElementById('hubArchiveRoot');
    const content = document.getElementById('hubArchiveContent');
    if (!root || !content) return;

    ensureArchiveFilterDelegation();

    if (global.HubUI && typeof global.HubUI.showHubPage === 'function') {
      global.HubUI.showHubPage('hub-archive');
    }
    if (global.HubUI && typeof global.HubUI.setSidebarForTab === 'function') {
      global.HubUI.setSidebarForTab('hub-archive');
    }

    if (seq !== archiveInitSeq) return;

    root.querySelector('.hub-archive-filter-row')?.replaceChildren();
    const filterRow = root.querySelector('.hub-archive-filter-row');
    if (filterRow) filterRow.innerHTML = renderFilterBar(filter);

    clearArchiveMount(content);

    if (seq !== archiveInitSeq) return;

    const meta = filterMeta(filter);
    if (filter === 'all' || !meta.tab) {
      content.innerHTML = renderOverviewHtml();
      wireFilterButtons(content);
      fetchArchiveCounts().then((counts) => {
        if (seq !== archiveInitSeq) return;
        const active = getActiveArchiveFilterFromHash();
        if (active !== 'all') return;
        if (content.querySelector('.hub-archive-embedded')) return;
        const overview = content.querySelector('.hub-archive-overview');
        if (!overview) return;
        overview.outerHTML = renderOverviewHtml(counts);
        wireFilterButtons(content);
      });
      return;
    }

    content.innerHTML = '';
    if (!mountArchivePanel(meta.tab, content)) {
      if (seq !== archiveInitSeq) return;
      const label = FILTER_LABELS[filter] || meta.label || filter;
      content.innerHTML = `<div class="hub-empty">Could not mount ${esc(label)} archive view.</div>`;
      return;
    }

    if (seq !== archiveInitSeq) return;
    triggerArchiveLoad(meta.tab);
  }

  const api = {
    ARCHIVE_FILTERS,
    LEGACY_TAB_TO_FILTER,
    FILTER_LABELS,
    HASH_FILTER_SEGMENTS,
    normalizeFilter,
    filterMeta,
    filterToLegacyTab,
    legacyTabToFilter,
    buildArchiveHash,
    parseArchiveRouteFromHash,
    getActiveArchiveFilterFromHash,
    selectArchiveFilter,
    syncArchiveHash,
    resolveArchiveFilter,
    applyArchiveRouteFromHash,
    initUnifiedArchive,
  };

  global.HubUnifiedArchive = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
