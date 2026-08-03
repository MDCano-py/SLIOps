/**
 * WOS-58 — App Spaces admin panel + dynamic launch navigation.
 */
(function (global) {
  'use strict';

  const ROLE_OPTIONS = ['requester', 'employee', 'manager', 'operations', 'admin', 'hub_admin'];
  const ROUTE_TYPES = [
    'template_runtime_placeholder',
    'template_builder',
    'template_submission_new',
    'template_submissions',
    'workflow_queue_placeholder',
  ];

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function hubFetch(path, opts) {
    if (typeof global.proxyFetch === 'function') return global.proxyFetch(path, opts);
    return fetch('/api/maintainx?path=' + encodeURIComponent(path), opts);
  }

  async function apiJson(path, opts) {
    const res = await hubFetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText || 'Request failed');
    return data;
  }

  function spaceIconGlyph(icon) {
    const map = {
      form: '📋',
      document: '📄',
      workflow: '⚙️',
      operations: '🏭',
      admin: '🛡️',
      safety: '⛑️',
    };
    return map[icon] || '◆';
  }

  async function fetchRegistry() {
    return apiJson('/hub/spaces/registry');
  }

  async function fetchSpacesAdmin() {
    return apiJson('/hub/spaces');
  }

  async function fetchSpaceEntries(spaceKey) {
    return apiJson('/hub/spaces/' + encodeURIComponent(spaceKey) + '/launch-entries');
  }

  function launchHash(entryId) {
    return '#/launch/' + entryId;
  }

  function spaceHash(spaceKey) {
    return '#/spaces/' + spaceKey;
  }

  function navigateToLaunch(entry) {
    if (!entry) return;
    if (entry.route_type === 'template_builder' && entry.template_id) {
      if (typeof global.switchTab === 'function') {
        global.switchTab('hub-workflows', {
          segments: ['builder', entry.template_id, entry.route_target],
        });
      }
      if (global.streamlineRouter) {
        global.streamlineRouter.setHash(
          '#/workflows/templates/' + entry.template_id + '/versions/' + entry.route_target
        );
      }
      return;
    }
    if (typeof global.switchTab === 'function') {
      global.switchTab('hub-launch', { entryId: entry.id });
    }
    if (global.streamlineRouter) {
      global.streamlineRouter.setHash(launchHash(entry.id));
    }
  }

  async function renderLaunchSpacesNav(container) {
    if (!container) return;
    container.hidden = true;
    container.innerHTML = '';
  }

  async function renderLaunchRuntime(root, entryId) {
    if (!root) return;
    if (global.TemplateRuntimeUI && typeof global.TemplateRuntimeUI.renderLaunchForm === 'function') {
      await global.TemplateRuntimeUI.renderLaunchForm(root, entryId);
      return;
    }
    root.innerHTML = '<div class="hub-empty">Template runtime UI unavailable.</div>';
  }

  async function renderSpaceView(root, spaceKey) {
    if (!root) return;
    root.innerHTML = '<div class="hub-loading">Loading space…</div>';
    try {
      const [spacesData, entriesData] = await Promise.all([
        fetchSpacesAdmin(),
        fetchSpaceEntries(spaceKey).catch(() => ({ entries: [] })),
      ]);
      const space = (spacesData.spaces || []).find((s) => s.key === spaceKey);
      const entries = (entriesData.entries || []).filter((e) => e.status === 'active');
      root.innerHTML = `<div class="hub-panel">
        <div class="hub-panel-head">
          <h2>${esc(space?.label || spaceKey)}</h2>
          <p class="hub-sub" style="margin:4px 0 0">${esc(space?.description || '')}</p>
        </div>
        <div class="hub-panel-body pad">
          ${
            entries.length
              ? `<div class="hub-launch-space-grid">${entries
                  .map(
                    (e) =>
                      `<button type="button" class="hub-launch-space-card" data-launch-entry="${esc(e.id)}">
                        <strong>${esc(e.label)}</strong>
                        <span>${esc(e.description || e.template_key || '')}</span>
                        ${e.quick_action_enabled ? '<em class="hub-launch-quick-tag">Quick action</em>' : ''}
                      </button>`
                  )
                  .join('')}</div>`
              : '<p class="hub-sub">No active launch entries in this space yet. Publish a template with launch settings to add one.</p>'
          }
        </div>
      </div>`;
      root.querySelectorAll('[data-launch-entry]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const data = await apiJson('/hub/launch-entries/' + btn.dataset.launchEntry);
          navigateToLaunch(data.entry);
        });
      });
    } catch (err) {
      root.innerHTML = `<div class="hub-settings-inline-warn"><strong>Space unavailable</strong><span>${esc(err.message)}</span></div>`;
    }
  }

  function rolesCheckboxes(selected, name) {
    const sel = new Set(selected || []);
    return ROLE_OPTIONS.map(
      (r) =>
        `<label class="hub-settings-check hub-settings-check-inline"><input type="checkbox" name="${name}" value="${r}" ${sel.has(r) ? 'checked' : ''} /><span>${r}</span></label>`
    ).join('');
  }

  async function renderAppSpacesAdminPanel(detail) {
    if (!detail) return;
    detail.hidden = false;
    detail.innerHTML = '<div class="hub-loading">Loading app spaces…</div>';
    try {
      const [spacesData, registry] = await Promise.all([fetchSpacesAdmin(), fetchRegistry()]);
      const spaces = spacesData.spaces || [];
      const entriesBySpace = {};
      await Promise.all(
        spaces.map(async (space) => {
          try {
            const d = await fetchSpaceEntries(space.key);
            entriesBySpace[space.key] = d.entries || [];
          } catch {
            entriesBySpace[space.key] = [];
          }
        })
      );

      detail.innerHTML = `<div class="hub-app-spaces-admin">
        <div class="hub-panel hub-settings-detail-panel">
          <div class="hub-panel-head">
            <h2>App Spaces &amp; Launch Registry</h2>
            <p class="hub-sub" style="margin:4px 0 0">Configure where published templates appear without code changes.</p>
          </div>
          <div class="hub-panel-body pad">
            <form id="hubNewSpaceForm" class="hub-settings-form hub-app-spaces-create">
              <p class="action-section-title">Create space</p>
              <div class="hub-settings-form-row">
                <label class="hub-settings-field"><span>Key</span><input type="text" id="hubNewSpaceKey" placeholder="safety" pattern="[a-z][a-z0-9_]*" /></label>
                <label class="hub-settings-field"><span>Label</span><input type="text" id="hubNewSpaceLabel" placeholder="Safety" /></label>
                <label class="hub-settings-field"><span>Icon</span><input type="text" id="hubNewSpaceIcon" placeholder="safety" /></label>
              </div>
              <label class="hub-settings-field"><span>Description</span><input type="text" id="hubNewSpaceDesc" placeholder="Safety forms and permits" /></label>
              <button type="submit" class="hub-btn hub-btn-primary hub-btn-sm">Create space</button>
            </form>
            <div id="hubAppSpacesStatus" class="hub-settings-status" hidden></div>
            <div class="hub-app-spaces-list">
              ${spaces
                .map((space) => {
                  const entries = entriesBySpace[space.key] || [];
                  const entryRows = entries.length
                    ? entries
                        .map(
                          (e) =>
                            `<tr data-entry-id="${esc(e.id)}">
                              <td>${esc(e.label)}</td>
                              <td><code>${esc(e.template_key || '')}</code></td>
                              <td><span class="hub-badge ${e.status === 'active' ? 'tmpl-badge-published' : 'tmpl-badge-retired'}">${esc(e.status)}</span></td>
                              <td>${e.quick_action_enabled ? 'Yes' : '—'}</td>
                              <td>
                                ${e.status === 'active' ? `<button type="button" class="hub-btn hub-btn-ghost hub-btn-sm hub-entry-hide" data-id="${esc(e.id)}">Hide</button>` : `<button type="button" class="hub-btn hub-btn-ghost hub-btn-sm hub-entry-show" data-id="${esc(e.id)}">Show</button>`}
                              </td>
                            </tr>`
                        )
                        .join('')
                    : '<tr><td colspan="5" class="hub-sub">No launch entries</td></tr>';
                  return `<section class="hub-app-space-block" data-space-key="${esc(space.key)}">
                    <div class="hub-app-space-head">
                      <h3>${spaceIconGlyph(space.icon)} ${esc(space.label)} <code class="mono">${esc(space.key)}</code></h3>
                      <span class="hub-badge ${space.status === 'active' ? 'tmpl-badge-published' : 'tmpl-badge-retired'}">${esc(space.status)}</span>
                      ${space.status === 'active' && !['forms', 'documents', 'workflows'].includes(space.key) ? `<button type="button" class="hub-btn hub-btn-ghost hub-btn-sm hub-space-archive" data-key="${esc(space.key)}">Archive</button>` : ''}
                    </div>
                    <p class="hub-sub">${esc(space.description || '')}</p>
                    <table class="hub-table hub-table-compact"><thead><tr><th>Launch</th><th>Template</th><th>Status</th><th>Quick</th><th></th></tr></thead><tbody>${entryRows}</tbody></table>
                  </section>`;
                })
                .join('')}
            </div>
          </div>
        </div>
      </div>`;

      const statusEl = detail.querySelector('#hubAppSpacesStatus');
      const showStatus = (msg, kind) => {
        if (!statusEl) return;
        statusEl.textContent = msg;
        statusEl.hidden = !msg;
        statusEl.className = 'hub-settings-status' + (kind ? ' is-' + kind : '');
      };

      detail.querySelector('#hubNewSpaceForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          showStatus('Creating…', 'loading');
          await apiJson('/hub/spaces', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              key: detail.querySelector('#hubNewSpaceKey')?.value,
              label: detail.querySelector('#hubNewSpaceLabel')?.value,
              description: detail.querySelector('#hubNewSpaceDesc')?.value,
              icon: detail.querySelector('#hubNewSpaceIcon')?.value,
            }),
          });
          showStatus('Space created', 'success');
          await renderAppSpacesAdminPanel(detail);
          const nav = document.getElementById('hubLaunchSpacesNav');
          if (nav) await renderLaunchSpacesNav(nav);
        } catch (err) {
          showStatus(err.message, 'error');
        }
      });

      detail.querySelectorAll('.hub-space-archive').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Archive this space? Launch entries will remain but the space will not appear.')) return;
          try {
            await apiJson('/hub/spaces/' + encodeURIComponent(btn.dataset.key) + '/archive', { method: 'POST' });
            showStatus('Space archived', 'success');
            await renderAppSpacesAdminPanel(detail);
          } catch (err) {
            showStatus(err.message, 'error');
          }
        });
      });

      detail.querySelectorAll('.hub-entry-hide').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await apiJson('/hub/launch-entries/' + btn.dataset.id + '/hide', { method: 'POST' });
            showStatus('Launch entry hidden', 'success');
            await renderAppSpacesAdminPanel(detail);
            const nav = document.getElementById('hubLaunchSpacesNav');
            if (nav) await renderLaunchSpacesNav(nav);
          } catch (err) {
            showStatus(err.message, 'error');
          }
        });
      });

      detail.querySelectorAll('.hub-entry-show').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await apiJson('/hub/launch-entries/' + btn.dataset.id + '/activate', { method: 'POST' });
            showStatus('Launch entry activated', 'success');
            await renderAppSpacesAdminPanel(detail);
            const nav = document.getElementById('hubLaunchSpacesNav');
            if (nav) await renderLaunchSpacesNav(nav);
          } catch (err) {
            showStatus(err.message, 'error');
          }
        });
      });
    } catch (err) {
      detail.innerHTML = `<div class="hub-settings-inline-warn"><strong>App spaces unavailable</strong><span>${esc(err.message)}</span></div>`;
    }
  }

  global.AppSpacesUI = {
    renderLaunchSpacesNav,
    renderLaunchRuntime,
    renderSpaceView,
    renderAppSpacesAdminPanel,
    refreshLaunchNav: async () => {
      const nav = document.getElementById('hubLaunchSpacesNav');
      if (nav) await renderLaunchSpacesNav(nav);
    },
    _test: { ROLE_OPTIONS, ROUTE_TYPES, spaceIconGlyph },
  };
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : typeof global !== 'undefined' ? global : this);
