/**
 * WOS-94 Configuration Center — registry / orchestration shell.
 * Forms open the canonical Workspace Forms builder (TemplateRegistryUI).
 * Does not embed a competing form field editor.
 */
(function (root) {
  'use strict';

  const SECTIONS = [
    { id: 'overview', label: 'Overview' },
    { id: 'request_types', label: 'Request Types', kind: 'request_type', path: 'request-types' },
    { id: 'forms', label: 'Forms', canonical: 'workspace_forms' },
    { id: 'documents', label: 'Documents', kind: 'document', path: 'documents' },
    { id: 'workflows', label: 'Workflows', kind: 'workflow', path: 'workflows' },
    { id: 'dashboards', label: 'Dashboards', kind: 'dashboard', path: 'dashboards' },
    { id: 'variables', label: 'Variables' },
    { id: 'saved_views', label: 'Saved Views', kind: 'saved_view', path: 'saved-views' },
    { id: 'validation', label: 'Validation' },
    { id: 'history', label: 'Version History' },
  ];

  const HUMAN_NODE_TYPES = new Set([
    'human.fill',
    'human.review',
    'human.approve',
    'human.reject',
    'human.sign',
    'human.acknowledge',
    'human.provide_info',
    'human.upload',
  ]);

  let state = {
    enabled: false,
    section: 'overview',
    catalogs: null,
    definitions: {},
    workspaceForms: [],
    selectedId: null,
    selected: null,
    designer: null,
    selectedNodeKey: null,
    message: '',
    error: '',
    search: '',
    statusFilter: 'all',
    roles: [],
    users: [],
  };

  function hubFetch(path, opts) {
    const init = {
      method: (opts && opts.method) || 'GET',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    };
    if (opts && opts.body !== undefined) {
      init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    }
    const runner =
      root.HubUI && typeof root.HubUI.hubFetch === 'function'
        ? root.HubUI.hubFetch
        : root.proxyFetch;
    if (typeof runner !== 'function') return Promise.reject(new Error('proxyFetch not available'));
    return runner(path, init).then(async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const err = new Error(data.error || r.statusText || 'Request failed');
        err.status = r.status;
        err.data = data;
        throw err;
      }
      return data;
    });
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        if (k === 'className') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (attrs[k] != null && k !== 'value') node.setAttribute(k, attrs[k]);
        else if (k === 'value') node.value = attrs[k];
      });
    }
    (children || []).forEach((c) => {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function setMsg(text, isError) {
    state.message = isError ? '' : text || '';
    state.error = isError ? text || '' : '';
  }

  function openWorkspaceFormBuilder(templateId, versionId) {
    if (!templateId || !versionId) {
      if (root.HubUI && typeof root.HubUI.navigateToTemplateSpace === 'function') {
        root.HubUI.navigateToTemplateSpace('forms');
        return;
      }
      if (root.streamlineRouter) root.streamlineRouter.setHash('#/forms');
      return;
    }
    const hash =
      root.HubUI && typeof root.HubUI.buildRouteHash === 'function'
        ? root.HubUI.buildRouteHash('hub-forms', {
            segments: ['builder', templateId, versionId],
            space: 'forms',
          })
        : '#/forms/templates/' + templateId + '/versions/' + versionId;
    root._hubTemplateRoute = { space: 'forms', segments: ['builder', templateId, versionId], query: {} };
    if (root.streamlineRouter && typeof root.streamlineRouter.setHash === 'function') {
      root.streamlineRouter.setHash(hash);
    } else if (typeof root.switchTab === 'function') {
      root.switchTab('hub-forms', { space: 'forms', segments: ['builder', templateId, versionId] });
    } else {
      root.location.hash = hash;
    }
  }

  function openNewWorkspaceForm() {
    if (root.HubUI && typeof root.HubUI.navigateToTemplateSpace === 'function') {
      root.HubUI.navigateToTemplateSpace('forms');
    } else if (root.streamlineRouter) {
      root.streamlineRouter.setHash('#/forms');
    }
    // Defer so Forms hub mounts, then click New if present
    setTimeout(() => {
      const btn = document.getElementById('tmplNewBtn');
      if (btn) btn.click();
    }, 350);
  }

  async function loadStatus() {
    try {
      const data = await hubFetch('/hub/configuration/status');
      state.enabled = !!data.enabled;
      return data;
    } catch (err) {
      state.enabled = false;
      setMsg(
        err.status === 503
          ? 'Configuration Center is disabled. Set CONFIGURABLE_PLATFORM_ENABLED=1.'
          : err.message || 'Unable to load status',
        true
      );
      return null;
    }
  }

  async function loadCatalogs() {
    state.catalogs = await hubFetch('/hub/configuration/catalogs');
  }

  async function loadKind(path) {
    const data = await hubFetch('/hub/configuration/' + path);
    state.definitions[path] = data.definitions || [];
    return state.definitions[path];
  }

  async function loadWorkspaceForms() {
    try {
      const data = await hubFetch('/hub/templates');
      state.workspaceForms = (data.templates || []).filter((t) => {
        const kind = t.template_kind || (t.launch_config_json && t.launch_config_json.space_key);
        return kind === 'form' || kind === 'forms' || !t.template_kind;
      });
    } catch {
      state.workspaceForms = [];
    }
  }

  async function loadRolesAndUsers() {
    try {
      const rolesData = await hubFetch('/hub/rbac/roles').catch(() => null);
      state.roles = (rolesData && (rolesData.roles || rolesData)) || [];
    } catch {
      state.roles = [];
    }
    try {
      // Prefer management users list when available
      const usersData = await hubFetch('/users').catch(() => null);
      const list = (usersData && (usersData.users || usersData.items || usersData)) || [];
      state.users = Array.isArray(list) ? list : [];
    } catch {
      state.users = [];
    }
  }

  function sectionMeta(id) {
    return SECTIONS.find((s) => s.id === id) || SECTIONS[0];
  }

  function refresh(rootEl) {
    if (!rootEl) rootEl = document.getElementById('hubConfigurationRoot');
    if (!rootEl) return;
    renderShell(rootEl);
  }

  function renderShell(mount) {
    mount.innerHTML = '';
    mount.className = 'cfg-root';

    if (!state.enabled) {
      mount.appendChild(
        el('div', { className: 'hub-empty cfg-disabled' }, [
          el('h2', { text: 'Configuration Center unavailable' }),
          el('p', { text: state.error || 'Enable CONFIGURABLE_PLATFORM_ENABLED=1 to continue.' }),
        ])
      );
      return;
    }

    const layout = el('div', { className: 'cfg-layout' });
    const nav = el('nav', { className: 'cfg-nav', 'aria-label': 'Configuration sections' });
    SECTIONS.forEach((s) => {
      nav.appendChild(
        el('button', {
          type: 'button',
          className: 'cfg-nav-btn' + (state.section === s.id ? ' is-active' : ''),
          text: s.label,
          onclick: () => {
            state.section = s.id;
            state.selectedId = null;
            state.selected = null;
            state.designer = null;
            state.selectedNodeKey = null;
            setMsg('');
            refresh(mount);
          },
        })
      );
    });
    layout.appendChild(nav);

    const main = el('div', { className: 'cfg-main' });
    if (state.error) main.appendChild(el('div', { className: 'cfg-banner cfg-banner-error', role: 'alert', text: state.error }));
    if (state.message) main.appendChild(el('div', { className: 'cfg-banner cfg-banner-ok', role: 'status', text: state.message }));

    const meta = sectionMeta(state.section);
    if (state.section === 'overview') main.appendChild(renderOverview());
    else if (state.section === 'forms') main.appendChild(renderFormsRegistry());
    else if (state.section === 'variables') main.appendChild(renderVariables());
    else if (state.section === 'validation') main.appendChild(renderValidation());
    else if (state.section === 'history') main.appendChild(renderHistory());
    else if (meta.kind && state.section === 'workflows' && state.selected && state.designer) {
      main.appendChild(renderWorkflowBuilder(meta));
    } else if (meta.kind && state.selected && state.section === 'documents') {
      main.appendChild(renderDocumentBuilder(meta));
    } else if (meta.kind && state.selected && state.section === 'dashboards') {
      main.appendChild(renderDashboardBuilder(meta));
    } else if (meta.kind && state.selected && state.section === 'request_types') {
      main.appendChild(renderRequestTypeEditor(meta));
    } else if (meta.kind) main.appendChild(renderRegistry(meta));
    else main.appendChild(el('p', { text: 'Section not available.' }));

    layout.appendChild(main);
    mount.appendChild(layout);
  }

  function renderOverview() {
    const wrap = el('div', { className: 'hub-panel cfg-panel' });
    wrap.appendChild(el('h2', { text: 'Configuration Center' }));
    wrap.appendChild(
      el('p', {
        className: 'hub-sub cfg-lead',
        text: 'Organize request types, forms, documents, workflows, and dashboards. Forms open in the Workspace Forms builder. Normal users launch request types from New Request — not Configuration Center.',
      })
    );
    const actions = el('div', { className: 'cfg-actions' });
    actions.appendChild(
      el('button', {
        type: 'button',
        className: 'hub-btn hub-btn-primary',
        text: 'Seed default templates',
        onclick: async () => {
          try {
            const res = await hubFetch('/hub/configuration/seed-defaults', { method: 'POST', body: {} });
            setMsg('Seeded ' + (res.seeded || []).length + ' definitions (existing keys skipped).');
          } catch (err) {
            setMsg(err.message || 'Seed failed', true);
          }
          refresh();
        },
      })
    );
    actions.appendChild(
      el('button', {
        type: 'button',
        className: 'hub-btn',
        text: 'Open Workspace Forms',
        onclick: () => openWorkspaceFormBuilder(null, null),
      })
    );
    wrap.appendChild(actions);
    const grid = el('div', { className: 'cfg-card-grid' });
    [
      ['Forms', 'Canonical Workspace Forms builder with live preview'],
      ['Workflows', 'Visual graph with assignments and validation'],
      ['Request types', 'What users start from New Request'],
      ['Documents & dashboards', 'Live-preview builders'],
    ].forEach(([title, desc]) => {
      grid.appendChild(el('div', { className: 'cfg-card' }, [el('strong', { text: title }), el('span', { text: desc })]));
    });
    wrap.appendChild(grid);
    return wrap;
  }

  function toolbar(onSearch) {
    const bar = el('div', { className: 'forms-manage-toolbar cfg-toolbar' });
    const search = el('input', {
      type: 'search',
      className: 'forms-manage-search cfg-input',
      placeholder: 'Search…',
      value: state.search,
      'aria-label': 'Search',
    });
    search.addEventListener('input', () => {
      state.search = search.value;
      if (onSearch) onSearch();
      else refresh();
    });
    const status = el('select', { className: 'cfg-input', 'aria-label': 'Status filter' });
    ['all', 'published', 'draft', 'archived', 'active'].forEach((s) => {
      status.appendChild(el('option', { value: s, text: s === 'all' ? 'All statuses' : s }));
    });
    status.value = state.statusFilter;
    status.addEventListener('change', () => {
      state.statusFilter = status.value;
      refresh();
    });
    bar.appendChild(search);
    bar.appendChild(status);
    return bar;
  }

  function matchesFilters(name, key, status) {
    const q = (state.search || '').trim().toLowerCase();
    if (q && !(String(name || '').toLowerCase().includes(q) || String(key || '').toLowerCase().includes(q))) {
      return false;
    }
    if (state.statusFilter !== 'all' && String(status || '').toLowerCase() !== state.statusFilter) return false;
    return true;
  }

  function renderFormsRegistry() {
    const wrap = el('div', { className: 'hub-panel cfg-panel' });
    const head = el('div', { className: 'cfg-panel-head' });
    head.appendChild(el('div', {}, [
      el('h2', { text: 'Forms' }),
      el('p', {
        className: 'hub-sub',
        text: 'Registry only. Open the Workspace Forms builder to edit structure, preview, workflow attachment, and publish.',
      }),
    ]));
    head.appendChild(
      el('button', {
        type: 'button',
        className: 'hub-btn hub-btn-primary',
        text: 'New form',
        onclick: () => openNewWorkspaceForm(),
      })
    );
    wrap.appendChild(head);
    wrap.appendChild(toolbar());

    const list = (state.workspaceForms || []).filter((t) =>
      matchesFilters(t.name, t.key, t.status)
    );

    if (!list.length) {
      wrap.appendChild(
        el('div', { className: 'hub-empty forms-hub-empty' }, [
          el('p', { text: 'No forms yet. Create one in the Workspace Forms builder.' }),
          el('button', {
            type: 'button',
            className: 'hub-btn hub-btn-primary',
            text: 'Open Forms',
            onclick: () => openWorkspaceFormBuilder(null, null),
          }),
        ])
      );
      return wrap;
    }

    const table = el('div', { className: 'forms-hub-manage' });
    const header = el('div', { className: 'cfg-row cfg-row-static cfg-row-head' }, [
      el('strong', { text: 'Form' }),
      el('span', { text: 'Status' }),
      el('span', { text: 'Updated' }),
      el('span', { text: 'Actions' }),
    ]);
    table.appendChild(header);

    list.forEach((t) => {
      const publishedId = t.current_published_version_id;
      const draftHint = t.status === 'archived' ? 'archived' : publishedId ? 'published' : 'draft';
      const row = el('div', { className: 'cfg-row cfg-row-static' });
      row.appendChild(
        el('div', {}, [
          el('strong', { className: 'forms-manage-form-name', text: t.name || t.key }),
          el('div', { className: 'forms-manage-meta', text: t.key || '' }),
        ])
      );
      row.appendChild(el('span', { className: 'tmpl-badge tmpl-badge-' + draftHint, text: t.status || draftHint }));
      row.appendChild(el('span', { text: t.updated_at ? String(t.updated_at).slice(0, 19).replace('T', ' ') : '—' }));
      const actions = el('div', { className: 'tmpl-actions tmpl-actions-compact' });
      if (publishedId) {
        actions.appendChild(
          el('button', {
            type: 'button',
            className: 'hub-btn hub-btn-sm',
            text: 'View published',
            onclick: () => openWorkspaceFormBuilder(t.id, publishedId),
          })
        );
      }
      actions.appendChild(
        el('button', {
          type: 'button',
          className: 'hub-btn hub-btn-sm hub-btn-primary',
          text: publishedId ? 'Open builder' : 'Continue draft',
          onclick: async () => {
            try {
              if (publishedId) {
                openWorkspaceFormBuilder(t.id, publishedId);
                return;
              }
              // Load template detail for draft version id via list versions if needed
              const detail = await hubFetch('/hub/templates/' + t.id).catch(() => null);
              const draftId =
                (detail && detail.draft_version && detail.draft_version.id) ||
                (detail && detail.template && detail.template.current_draft_version_id) ||
                publishedId;
              if (draftId) openWorkspaceFormBuilder(t.id, draftId);
              else openWorkspaceFormBuilder(null, null);
            } catch (err) {
              setMsg(err.message || 'Unable to open builder', true);
              refresh();
            }
          },
        })
      );
      row.appendChild(actions);
      table.appendChild(row);
    });
    wrap.appendChild(table);
    return wrap;
  }

  function renderRegistry(meta) {
    const wrap = el('div', { className: 'hub-panel cfg-panel' });
    const head = el('div', { className: 'cfg-panel-head' });
    head.appendChild(el('div', {}, [
      el('h2', { text: meta.label }),
      el('p', { className: 'hub-sub', text: 'Select a row to open the dedicated editor. Registries stay separate from builders.' }),
    ]));
    head.appendChild(
      el('button', {
        type: 'button',
        className: 'hub-btn hub-btn-primary',
        text: 'New draft',
        onclick: () => createDraft(meta),
      })
    );
    wrap.appendChild(head);
    wrap.appendChild(toolbar());

    const list = (state.definitions[meta.path] || []).filter((d) =>
      matchesFilters(d.name, d.key, d.status)
    );
    if (!list.length) {
      wrap.appendChild(el('div', { className: 'hub-empty', text: 'No definitions yet. Create a draft or seed defaults from Overview.' }));
      return wrap;
    }

    const table = el('div', { className: 'cfg-table' });
    list.forEach((d) => {
      const row = el('button', {
        type: 'button',
        className: 'cfg-row' + (state.selectedId === d.id ? ' is-active' : ''),
        onclick: () => openDefinition(meta, d.id),
      });
      row.appendChild(el('strong', { text: d.name || d.key }));
      row.appendChild(el('span', { className: 'forms-manage-meta', text: d.key }));
      row.appendChild(el('span', { className: 'cfg-badge', text: d.status }));
      table.appendChild(row);
    });
    wrap.appendChild(table);
    return wrap;
  }

  async function createDraft(meta) {
    const key = prompt('Stable key (e.g. nda_request)');
    if (!key) return;
    const name = prompt('Display name', key) || key;
    let payload = {};
    if (meta.kind === 'workflow') {
      payload = {
        nodes: [
          { key: 'start', type: 'trigger.request_created', name: 'Request created', x: 80, y: 80, config: {} },
          { key: 'done', type: 'terminal.complete', name: 'Complete', x: 80, y: 260, config: {} },
        ],
        connections: [{ key: 'c1', source: 'start', target: 'done', outcome_key: 'default', label: '', sort_order: 0 }],
      };
    } else if (meta.kind === 'document') {
      payload = {
        title: name,
        document_type: 'web_document',
        body_html: '<h1>' + name + '</h1><p>Agreement with {{organization.legal_name}}.</p>',
        blocks: [{ type: 'heading', text: name }, { type: 'paragraph', text: 'Agreement with {{organization.legal_name}}.' }],
        signers: [],
      };
    } else if (meta.kind === 'dashboard') {
      payload = {
        name,
        layout: 'grid',
        widgets: [{ key: 'w1', type: 'my_tasks', title: 'My Tasks', size: 'md', order: 0, config: {} }],
        audience_roles: [],
      };
    } else if (meta.kind === 'request_type') {
      payload = {
        key,
        display_name: name,
        number_prefix: 'REQ-',
        default_priority: 'normal',
        available_priorities: ['low', 'normal', 'high'],
        starting_form_template_id: null,
        workflow_definition_id: null,
      };
    } else if (meta.kind === 'saved_view') {
      payload = { name, owner_type: 'organization', filters: {}, columns: [] };
    }
    try {
      const res = await hubFetch('/hub/configuration/' + meta.path, {
        method: 'POST',
        body: { key, name, payload },
      });
      setMsg('Draft created');
      await loadKind(meta.path);
      await openDefinition(meta, res.definition.id);
    } catch (err) {
      setMsg(err.message || 'Create failed', true);
      refresh();
    }
  }

  async function openDefinition(meta, id) {
    try {
      const res = await hubFetch('/hub/configuration/' + meta.path + '/' + id);
      state.selectedId = id;
      state.selected = res.definition;
      const payload =
        (res.definition.draft_version && res.definition.draft_version.payload_json) ||
        (res.definition.published_version && res.definition.published_version.payload_json) ||
        {};
      if (meta.kind === 'workflow') {
        state.designer = JSON.parse(JSON.stringify(payload));
        ensureWorkflowHandles(state.designer);
        state.selectedNodeKey = null;
      }
      setMsg('');
      refresh();
    } catch (err) {
      setMsg(err.message || 'Load failed', true);
      refresh();
    }
  }

  function editorChrome(meta, title, bodyFn) {
    const def = state.selected;
    const draft = def.draft_version || {};
    const published = def.published_version;
    const isDraft = draft && draft.status === 'draft';
    const wrap = el('div', { className: 'cfg-editor hub-panel' });
    wrap.appendChild(
      el('button', {
        type: 'button',
        className: 'hub-link-btn',
        text: '← Back to registry',
        onclick: () => {
          state.selected = null;
          state.selectedId = null;
          state.designer = null;
          refresh();
        },
      })
    );
    wrap.appendChild(el('h3', { text: title || def.name }));
    if (published && isDraft) {
      wrap.appendChild(
        el('div', {
          className: 'tmpl-readonly-banner',
          text:
            'Editing draft revision ' +
            (draft.revision || 1) +
            '. Published version ' +
            (published.version_number || '') +
            ' remains active until this draft is published.',
        })
      );
    } else if (!isDraft && published) {
      wrap.appendChild(
        el('div', {
          className: 'tmpl-readonly-banner',
          text: 'This published version is read-only. Clone it to a draft to make changes.',
        })
      );
    }
    bodyFn(wrap, { isDraft, draft, published });

    const actions = el('div', { className: 'cfg-actions' });
    if (isDraft) {
      actions.appendChild(el('button', { type: 'button', className: 'hub-btn', text: 'Save draft', onclick: () => saveDraft(meta, wrap) }));
      actions.appendChild(el('button', { type: 'button', className: 'hub-btn', text: 'Validate', onclick: () => validateSelected(meta) }));
      actions.appendChild(el('button', { type: 'button', className: 'hub-btn hub-btn-primary', text: 'Publish', onclick: () => publishSelected(meta) }));
    } else {
      actions.appendChild(
        el('button', {
          type: 'button',
          className: 'hub-btn hub-btn-primary',
          text: 'Clone to draft',
          onclick: async () => {
            try {
              const res = await hubFetch('/hub/configuration/' + meta.path + '/' + def.id + '/duplicate', {
                method: 'POST',
                body: { key: def.key + '_v' + Date.now().toString(36) },
              });
              setMsg('Draft cloned');
              await loadKind(meta.path);
              await openDefinition(meta, res.definition.id);
            } catch (err) {
              setMsg(err.message || 'Clone failed', true);
              refresh();
            }
          },
        })
      );
    }
    actions.appendChild(
      el('button', {
        type: 'button',
        className: 'hub-btn',
        text: 'Archive',
        onclick: async () => {
          if (!confirm('Archive this definition?')) return;
          try {
            await hubFetch('/hub/configuration/' + meta.path + '/' + def.id + '/archive', { method: 'POST', body: {} });
            setMsg('Archived');
            state.selected = null;
            await loadKind(meta.path);
            refresh();
          } catch (err) {
            setMsg(err.message || 'Archive failed', true);
            refresh();
          }
        },
      })
    );
    wrap.appendChild(actions);
    return wrap;
  }

  function collectPayload(meta, editorRoot) {
    if (meta.kind === 'workflow') return state.designer || { nodes: [], connections: [] };
    if (editorRoot && editorRoot._getPayload) return editorRoot._getPayload();
    return (state.selected.draft_version && state.selected.draft_version.payload_json) || {};
  }

  async function saveDraft(meta, editorRoot) {
    try {
      const payload = collectPayload(meta, editorRoot);
      const res = await hubFetch('/hub/configuration/' + meta.path + '/' + state.selected.id, {
        method: 'PUT',
        body: {
          payload,
          expected_revision: state.selected.draft_version && state.selected.draft_version.revision,
        },
      });
      state.selected = res.definition;
      if (meta.kind === 'workflow') {
        state.designer = JSON.parse(JSON.stringify(res.definition.draft_version.payload_json || state.designer));
      }
      setMsg('Draft saved (revision ' + (res.definition.draft_version && res.definition.draft_version.revision) + ')');
      await loadKind(meta.path);
      refresh();
    } catch (err) {
      setMsg((err.data && err.data.error) || err.message || 'Save failed', true);
      refresh();
    }
  }

  async function validateSelected(meta) {
    try {
      const res = await hubFetch('/hub/configuration/' + meta.path + '/' + state.selected.id + '/validate', {
        method: 'POST',
        body: {},
      });
      setMsg(res.ok ? 'Validation passed' : 'Validation issues — see details');
      if (!res.ok) console.warn('cfg validation', res.issues);
      refresh();
    } catch (err) {
      const issues = err.data && err.data.validation;
      setMsg((issues && issues[0] && issues[0].message) || err.message || 'Validation failed', true);
      refresh();
    }
  }

  async function publishSelected(meta) {
    try {
      const res = await hubFetch('/hub/configuration/' + meta.path + '/' + state.selected.id + '/publish', {
        method: 'POST',
        body: { acknowledge_warnings: true },
      });
      state.selected = res.definition;
      setMsg('Published successfully');
      await loadKind(meta.path);
      refresh();
    } catch (err) {
      setMsg((err.data && err.data.error) || err.message || 'Publish failed', true);
      refresh();
    }
  }

  function ensureWorkflowHandles(graph) {
    if (!graph.nodes) graph.nodes = [];
    if (!graph.connections) graph.connections = [];
    graph.nodes.forEach((n) => {
      n.config = n.config || {};
      if (!n.config.assignment) {
        n.config.assignment = {
          mode: HUMAN_NODE_TYPES.has(n.type) ? 'role' : 'none',
          user_id: null,
          user_email: null,
          role_key: n.config.assignee_role || null,
          form_field_key: null,
          strategy: 'shared_queue',
          fallback: 'hub_admin',
        };
      }
    });
  }

  function nodeHandles(node) {
    const handles = [{ id: 'in', side: 'left', label: 'In' }];
    if (node.type === 'logic.condition' || node.type === 'logic.multi_branch') {
      handles.push({ id: 'yes', side: 'right', label: 'Yes', y: 0.35 });
      handles.push({ id: 'no', side: 'right', label: 'No', y: 0.65 });
    } else if (isTerminal(node.type)) {
      /* terminal: input only */
    } else {
      handles.push({ id: 'out', side: 'right', label: 'Out', y: 0.5 });
      if (HUMAN_NODE_TYPES.has(node.type)) {
        handles.push({ id: 'reject', side: 'right', label: 'Reject', y: 0.75 });
      }
    }
    return handles;
  }

  function isTerminal(type) {
    return String(type || '').startsWith('terminal.');
  }

  function handlePoint(node, handleId) {
    const w = 168;
    const h = 72;
    const handles = nodeHandles(node);
    const hnd = handles.find((x) => x.id === handleId) || handles[handles.length - 1];
    const yRatio = hnd && hnd.y != null ? hnd.y : 0.5;
    const x = hnd && hnd.side === 'left' ? node.x : node.x + w;
    const y = node.y + h * yRatio;
    return { x, y };
  }

  function autoLayout(graph) {
    const nodes = graph.nodes || [];
    const connections = graph.connections || [];
    const start = nodes.find((n) => String(n.type).startsWith('trigger.')) || nodes[0];
    if (!start) return;
    const adj = {};
    nodes.forEach((n) => (adj[n.key] = []));
    connections.forEach((c) => {
      if (adj[c.source]) adj[c.source].push(c);
    });
    const depth = {};
    const queue = [start.key];
    depth[start.key] = 0;
    while (queue.length) {
      const cur = queue.shift();
      (adj[cur] || []).forEach((c) => {
        if (depth[c.target] == null) {
          depth[c.target] = depth[cur] + 1;
          queue.push(c.target);
        }
      });
    }
    const columns = {};
    nodes.forEach((n) => {
      const d = depth[n.key] != null ? depth[n.key] : 0;
      if (!columns[d]) columns[d] = [];
      columns[d].push(n);
    });
    Object.keys(columns).forEach((d) => {
      columns[d].forEach((n, i) => {
        n.x = 60 + Number(d) * 220;
        n.y = 60 + i * 110;
      });
    });
  }

  function renderWorkflowBuilder(meta) {
    ensureWorkflowHandles(state.designer);
    const graph = state.designer;
    const readOnly = !(state.selected.draft_version && state.selected.draft_version.status === 'draft');
    return editorChrome(meta, state.selected.name + ' — Workflow', (wrap) => {
      const layout = el('div', { className: 'cfg-wf cfg-wf-v2' });

      const toolbar = el('div', { className: 'cfg-wf-toolbar' });
      const nodeSel = el('select', { className: 'cfg-input', 'aria-label': 'Node type', disabled: readOnly ? 'disabled' : null });
      ((state.catalogs && state.catalogs.node_types) || []).forEach((n) => {
        nodeSel.appendChild(el('option', { value: n.type, text: n.category + ': ' + n.label }));
      });
      toolbar.appendChild(nodeSel);
      if (!readOnly) {
        toolbar.appendChild(
          el('button', {
            type: 'button',
            className: 'hub-btn',
            text: 'Add node',
            onclick: () => {
              const key = 'node_' + Date.now().toString(36);
              graph.nodes.push({
                key,
                type: nodeSel.value,
                name: nodeSel.options[nodeSel.selectedIndex].text.split(': ').pop(),
                x: 80 + (graph.nodes.length % 3) * 200,
                y: 80 + Math.floor(graph.nodes.length / 3) * 110,
                config: {},
              });
              ensureWorkflowHandles(graph);
              state.designer = graph;
              refresh();
            },
          })
        );
        toolbar.appendChild(
          el('button', {
            type: 'button',
            className: 'hub-btn',
            text: 'Auto-layout',
            onclick: () => {
              autoLayout(graph);
              state.designer = graph;
              refresh();
            },
          })
        );
        toolbar.appendChild(
          el('button', {
            type: 'button',
            className: 'hub-btn',
            text: 'Connect…',
            onclick: () => {
              const source = prompt('Source node key', state.selectedNodeKey || '');
              const target = prompt('Target node key');
              if (!source || !target) return;
              const outcome = prompt('Outcome (default / yes / no / approved / rejected)', 'default') || 'default';
              graph.connections.push({
                key: 'c_' + Date.now().toString(36),
                source,
                target,
                source_handle: outcome === 'yes' || outcome === 'no' || outcome === 'reject' ? outcome : 'out',
                target_handle: 'in',
                label: outcome === 'default' ? '' : outcome,
                outcome_key: outcome,
                sort_order: graph.connections.length,
              });
              state.designer = graph;
              refresh();
            },
          })
        );
      }
      layout.appendChild(toolbar);

      const library = el('aside', { className: 'cfg-wf-library' });
      library.appendChild(el('h4', { text: 'Node library' }));
      const cats = {};
      ((state.catalogs && state.catalogs.node_types) || []).forEach((n) => {
        if (!cats[n.category]) cats[n.category] = [];
        cats[n.category].push(n);
      });
      Object.keys(cats).forEach((cat) => {
        library.appendChild(el('div', { className: 'cfg-hint', text: cat }));
        cats[cat].slice(0, 8).forEach((n) => {
          library.appendChild(
            el('button', {
              type: 'button',
              className: 'hub-link-btn',
              text: n.label,
              disabled: readOnly ? 'disabled' : null,
              onclick: () => {
                if (readOnly) return;
                nodeSel.value = n.type;
              },
            })
          );
        });
      });
      layout.appendChild(library);

      const canvas = el('div', { className: 'cfg-wf-canvas', tabindex: '0', 'aria-label': 'Workflow canvas' });
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'cfg-wf-svg');
      const maxX = Math.max(900, ...graph.nodes.map((n) => n.x + 220), 900);
      const maxY = Math.max(520, ...graph.nodes.map((n) => n.y + 140), 520);
      svg.setAttribute('width', String(maxX));
      svg.setAttribute('height', String(maxY));
      svg.setAttribute('viewBox', '0 0 ' + maxX + ' ' + maxY);

      function redrawEdges() {
        while (svg.firstChild) svg.removeChild(svg.firstChild);
        graph.connections.forEach((c) => {
          const a = graph.nodes.find((n) => n.key === c.source);
          const b = graph.nodes.find((n) => n.key === c.target);
          if (!a || !b) return;
          const p1 = handlePoint(a, c.source_handle || (c.outcome_key === 'yes' || c.outcome_key === 'no' ? c.outcome_key : 'out'));
          const p2 = handlePoint(b, c.target_handle || 'in');
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          const midX = (p1.x + p2.x) / 2;
          path.setAttribute('d', 'M ' + p1.x + ' ' + p1.y + ' C ' + midX + ' ' + p1.y + ', ' + midX + ' ' + p2.y + ', ' + p2.x + ' ' + p2.y);
          path.setAttribute('class', 'cfg-wf-edge');
          path.setAttribute('fill', 'none');
          svg.appendChild(path);
          const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          marker.setAttribute('cx', String(p2.x));
          marker.setAttribute('cy', String(p2.y));
          marker.setAttribute('r', '3');
          marker.setAttribute('class', 'cfg-wf-edge-end');
          svg.appendChild(marker);
          if (c.label || (c.outcome_key && c.outcome_key !== 'default')) {
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', String(midX));
            text.setAttribute('y', String((p1.y + p2.y) / 2 - 6));
            text.setAttribute('class', 'cfg-wf-edge-label');
            text.textContent = c.label || c.outcome_key;
            svg.appendChild(text);
          }
        });
      }
      redrawEdges();
      canvas.appendChild(svg);

      const layer = el('div', { className: 'cfg-wf-nodes', style: 'width:' + maxX + 'px;height:' + maxY + 'px' });
      graph.nodes.forEach((n) => {
        const node = el('div', {
          className: 'cfg-wf-node' + (state.selectedNodeKey === n.key ? ' is-selected' : ''),
          'data-node-key': n.key,
          style: 'left:' + n.x + 'px;top:' + n.y + 'px',
          tabindex: '0',
          role: 'button',
          'aria-label': n.name + ' (' + n.type + ')',
        });
        node.appendChild(el('strong', { text: n.name || n.key }));
        node.appendChild(el('span', { text: n.type }));
        const handlesWrap = el('div', { className: 'cfg-wf-handles' });
        nodeHandles(n).forEach((h) => {
          handlesWrap.appendChild(
            el('span', {
              className: 'cfg-wf-handle cfg-wf-handle-' + h.side,
              'data-handle': h.id,
              title: h.label,
              text: '•',
            })
          );
        });
        node.appendChild(handlesWrap);
        if (!readOnly) {
          node.appendChild(
            el('button', {
              type: 'button',
              className: 'hub-link-btn',
              text: 'Delete',
              onclick: (e) => {
                e.stopPropagation();
                graph.nodes = graph.nodes.filter((x) => x.key !== n.key);
                graph.connections = graph.connections.filter((c) => c.source !== n.key && c.target !== n.key);
                state.designer = graph;
                refresh();
              },
            })
          );
        }
        node.addEventListener('click', () => {
          state.selectedNodeKey = n.key;
          refresh();
        });
        if (!readOnly) {
          let dragging = false;
          let ox = 0;
          let oy = 0;
          node.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button')) return;
            dragging = true;
            ox = e.clientX - n.x;
            oy = e.clientY - n.y;
            node.setPointerCapture(e.pointerId);
            state.selectedNodeKey = n.key;
          });
          node.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            n.x = Math.max(0, e.clientX - ox);
            n.y = Math.max(0, e.clientY - oy);
            node.style.left = n.x + 'px';
            node.style.top = n.y + 'px';
            redrawEdges();
          });
          node.addEventListener('pointerup', () => {
            dragging = false;
            state.designer = graph;
          });
        }
        layer.appendChild(node);
      });
      canvas.appendChild(layer);
      layout.appendChild(canvas);

      const side = el('aside', { className: 'cfg-wf-side' });
      side.appendChild(el('h4', { text: 'Node inspector' }));
      const selected = graph.nodes.find((n) => n.key === state.selectedNodeKey);
      if (!selected) {
        side.appendChild(el('p', { className: 'cfg-hint', text: 'Select a node to configure assignment, form, and outcomes.' }));
      } else {
        side.appendChild(el('strong', { text: selected.name || selected.key }));
        side.appendChild(el('div', { className: 'cfg-hint', text: selected.type }));
        if (HUMAN_NODE_TYPES.has(selected.type)) {
          side.appendChild(el('h5', { text: 'Assignment' }));
          const mode = el('select', { className: 'cfg-input', 'aria-label': 'Assignment mode', disabled: readOnly ? 'disabled' : null });
          [
            ['specific_user', 'Specific user'],
            ['role', 'Role (shared queue)'],
            ['request_creator', 'Request creator'],
            ['form_user_field', 'User from form field'],
            ['external_participant', 'External participant (form fields)'],
          ].forEach(([v, label]) => mode.appendChild(el('option', { value: v, text: label })));
          const asg = selected.config.assignment || {};
          mode.value = asg.mode || 'role';
          side.appendChild(mode);

          const roleSel = el('select', { className: 'cfg-input', 'aria-label': 'Role', disabled: readOnly ? 'disabled' : null });
          roleSel.appendChild(el('option', { value: '', text: 'Select role…' }));
          (state.roles.length
            ? state.roles
            : [{ key: 'legal', name: 'Legal' }, { key: 'manager', name: 'Manager' }, { key: 'ap', name: 'Accounting' }, { key: 'requester', name: 'Requester' }, { key: 'hub_admin', name: 'Hub Admin' }]
          ).forEach((r) => {
            const key = r.key || r.id || r.role_key;
            roleSel.appendChild(el('option', { value: key, text: r.name || r.label || key }));
          });
          roleSel.value = asg.role_key || '';
          side.appendChild(roleSel);

          const userSel = el('select', { className: 'cfg-input', 'aria-label': 'User', disabled: readOnly ? 'disabled' : null });
          userSel.appendChild(el('option', { value: '', text: 'Select user…' }));
          (state.users || []).slice(0, 200).forEach((u) => {
            const id = u.id || u.email;
            const active = u.active !== false && u.status !== 'inactive';
            if (!active) return;
            userSel.appendChild(
              el('option', {
                value: String(id),
                text: (u.name || u.display_name || u.email || id) + ' <' + (u.email || '') + '>',
              })
            );
          });
          if (asg.user_id) userSel.value = String(asg.user_id);
          side.appendChild(userSel);

          const fieldInput = el('input', {
            type: 'text',
            className: 'cfg-input',
            placeholder: 'form.field_key',
            value: asg.form_field_key || '',
            'aria-label': 'Form field key',
            disabled: readOnly ? 'disabled' : null,
          });
          side.appendChild(fieldInput);

          const fallback = el('select', { className: 'cfg-input', 'aria-label': 'Fallback', disabled: readOnly ? 'disabled' : null });
          [
            ['hub_admin', 'Route to Hub Admin'],
            ['pause', 'Pause with assignment error'],
            ['request_creator', 'Assign to request creator'],
            ['fallback_role', 'Fallback role'],
          ].forEach(([v, t]) => fallback.appendChild(el('option', { value: v, text: t })));
          fallback.value = asg.fallback || 'hub_admin';
          side.appendChild(fallback);

          const preview = el('div', { className: 'cfg-assign-preview' });
          function updatePreview() {
            const m = mode.value;
            let text = 'Assignment preview\nMode: ' + m;
            if (m === 'role') {
              text += '\nRole: ' + (roleSel.value || '—') + '\nStrategy: Shared queue';
              const match = (state.users || []).filter((u) => {
                const roles = u.roles || u.role_keys || [];
                return Array.isArray(roles) && roles.includes(roleSel.value);
              });
              text += '\nMatching active users: ' + (match.length || '(unknown until runtime)');
            } else if (m === 'specific_user') {
              text += '\nUser ID: ' + (userSel.value || '—');
            } else if (m === 'form_user_field' || m === 'external_participant') {
              text += '\nForm field: ' + (fieldInput.value || '—');
            }
            text += '\nFallback: ' + fallback.value;
            preview.textContent = text;
          }
          updatePreview();
          [mode, roleSel, userSel, fieldInput, fallback].forEach((ctl) => ctl.addEventListener('change', updatePreview));
          fieldInput.addEventListener('input', updatePreview);
          side.appendChild(preview);

          if (!readOnly) {
            side.appendChild(
              el('button', {
                type: 'button',
                className: 'hub-btn hub-btn-sm',
                text: 'Apply assignment',
                onclick: () => {
                  selected.config.assignment = {
                    mode: mode.value,
                    role_key: roleSel.value || null,
                    user_id: userSel.value || null,
                    user_email: null,
                    form_field_key: fieldInput.value || null,
                    strategy: 'shared_queue',
                    fallback: fallback.value,
                  };
                  selected.config.assignee_role = roleSel.value || selected.config.assignee_role;
                  state.designer = graph;
                  setMsg('Assignment updated on node (save draft to persist)');
                  refresh();
                },
              })
            );
          }
        }
        const connList = el('ul', { className: 'cfg-conn-list' });
        graph.connections
          .filter((c) => c.source === selected.key || c.target === selected.key)
          .forEach((c) => {
            const li = el('li', { text: c.source + ' → ' + c.target + (c.label ? ' (' + c.label + ')' : '') });
            if (!readOnly) {
              li.appendChild(
                el('button', {
                  type: 'button',
                  className: 'hub-link-btn',
                  text: 'Remove',
                  onclick: () => {
                    graph.connections = graph.connections.filter((x) => x.key !== c.key);
                    state.designer = graph;
                    refresh();
                  },
                })
              );
            }
            connList.appendChild(li);
          });
        side.appendChild(connList);
      }
      layout.appendChild(side);
      wrap.appendChild(layout);
      wrap._getPayload = () => state.designer;
    });
  }

  function renderDocumentBuilder(meta) {
    const draft = state.selected.draft_version || {};
    const payload = draft.payload_json || {};
    return editorChrome(meta, state.selected.name + ' — Document', (wrap) => {
      const layout = el('div', { className: 'cfg-split' });
      const left = el('div', { className: 'cfg-split-left' });
      const right = el('div', { className: 'cfg-split-right' });
      left.appendChild(el('h4', { text: 'Build' }));
      const title = el('input', { type: 'text', className: 'cfg-input', value: payload.title || '', 'aria-label': 'Title' });
      const body = el('textarea', { className: 'cfg-json', rows: '14', 'aria-label': 'Document body' });
      body.value = payload.body_html || '';
      left.appendChild(el('label', { text: 'Title' }));
      left.appendChild(title);
      left.appendChild(el('label', { text: 'Content (variables insert as tokens)' }));
      left.appendChild(body);

      const picker = el('div', { className: 'cfg-var-picker' });
      picker.appendChild(el('strong', { text: 'Variable picker' }));
      const search = el('input', { type: 'search', className: 'cfg-input', placeholder: 'Search variables…', 'aria-label': 'Search variables' });
      picker.appendChild(search);
      const list = el('div', { className: 'cfg-var-list' });
      function renderVars() {
        list.innerHTML = '';
        const q = search.value.trim().toLowerCase();
        ((state.catalogs && state.catalogs.builtin_variables) || [])
          .filter((v) => !q || v.key.includes(q) || (v.label || '').toLowerCase().includes(q))
          .forEach((v) => {
            const btn = el('button', {
              type: 'button',
              className: 'cfg-var-item',
              onclick: () => {
                body.value += '{{' + v.key + '}}';
                updatePreview();
              },
            });
            btn.appendChild(el('strong', { text: v.label || v.key }));
            btn.appendChild(el('span', { text: '{{' + v.key + '}}' }));
            list.appendChild(btn);
          });
      }
      search.addEventListener('input', renderVars);
      renderVars();
      picker.appendChild(list);
      left.appendChild(picker);

      right.appendChild(el('h4', { text: 'Live preview' }));
      const preview = el('div', { className: 'cfg-doc-preview' });
      function updatePreview() {
        let html = body.value || '';
        html = html.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, k) => '<mark class="cfg-var-token">{{' + k + '}}</mark>');
        preview.innerHTML = html;
      }
      body.addEventListener('input', updatePreview);
      title.addEventListener('input', updatePreview);
      updatePreview();
      right.appendChild(preview);
      right.appendChild(el('p', { className: 'cfg-hint', text: 'PDF generation remains unavailable in this release. Web preview and signatures are supported.' }));

      layout.appendChild(left);
      layout.appendChild(right);
      wrap.appendChild(layout);
      wrap._getPayload = () => ({
        ...payload,
        title: title.value,
        body_html: body.value,
        pdf_status: 'unavailable',
        pdf_message: 'Final sealed PDF generation is not available in this release.',
      });
    });
  }

  function renderDashboardBuilder(meta) {
    const draft = state.selected.draft_version || {};
    const payload = JSON.parse(JSON.stringify(draft.payload_json || {}));
    const widgets = payload.widgets || [];
    return editorChrome(meta, state.selected.name + ' — Dashboard', (wrap) => {
      const layout = el('div', { className: 'cfg-split' });
      const left = el('div', { className: 'cfg-split-left' });
      const right = el('div', { className: 'cfg-split-right' });
      left.appendChild(el('h4', { text: 'Widgets' }));
      const list = el('div', { className: 'cfg-field-list' });
      function redraw() {
        list.innerHTML = '';
        widgets.forEach((w, idx) => {
          const row = el('div', { className: 'cfg-field-row' });
          row.appendChild(el('span', { text: (w.title || w.type) + ' · ' + w.type }));
          row.appendChild(
            el('button', {
              type: 'button',
              className: 'hub-link-btn',
              text: 'Up',
              onclick: () => {
                if (!idx) return;
                const t = widgets[idx - 1];
                widgets[idx - 1] = widgets[idx];
                widgets[idx] = t;
                redraw();
                renderPreview();
              },
            })
          );
          row.appendChild(
            el('button', {
              type: 'button',
              className: 'hub-link-btn',
              text: 'Remove',
              onclick: () => {
                widgets.splice(idx, 1);
                redraw();
                renderPreview();
              },
            })
          );
          list.appendChild(row);
        });
      }
      redraw();
      left.appendChild(list);
      const sel = el('select', { className: 'cfg-input', 'aria-label': 'Widget type' });
      ((state.catalogs && state.catalogs.widget_types) || []).forEach((w) => {
        sel.appendChild(el('option', { value: w.type, text: w.label }));
      });
      left.appendChild(sel);
      left.appendChild(
        el('button', {
          type: 'button',
          className: 'hub-btn',
          text: 'Add widget',
          onclick: () => {
            widgets.push({
              key: 'w_' + (widgets.length + 1),
              type: sel.value,
              title: sel.options[sel.selectedIndex].text,
              size: 'md',
              order: widgets.length,
              config: {},
            });
            redraw();
            renderPreview();
          },
        })
      );

      right.appendChild(el('h4', { text: 'Live preview' }));
      const preview = el('div', { className: 'cfg-dash-preview' });
      function renderPreview() {
        preview.innerHTML = '';
        if (!widgets.length) {
          preview.appendChild(el('div', { className: 'hub-empty', text: 'Add widgets to preview the dashboard layout.' }));
          return;
        }
        widgets.forEach((w) => {
          preview.appendChild(
            el('div', { className: 'cfg-dash-widget cfg-dash-widget-' + (w.size || 'md') }, [
              el('strong', { text: w.title || w.type }),
              el('span', { text: 'Sample data · ' + w.type }),
            ])
          );
        });
      }
      renderPreview();
      right.appendChild(preview);

      layout.appendChild(left);
      layout.appendChild(right);
      wrap.appendChild(layout);
      wrap._getPayload = () => ({
        name: payload.name || state.selected.name,
        description: payload.description || '',
        audience_roles: payload.audience_roles || [],
        layout: payload.layout || 'grid',
        widgets: widgets.map((w, i) => ({ ...w, order: i })),
      });
    });
  }

  function renderRequestTypeEditor(meta) {
    const draft = state.selected.draft_version || {};
    const payload = Object.assign({}, draft.payload_json || {});
    return editorChrome(meta, state.selected.name + ' — Request type', (wrap) => {
      wrap.appendChild(
        el('p', {
          className: 'hub-sub',
          text: 'Request types are what appear on New Request. Attach a published starting form and workflow.',
        })
      );
      const display = el('input', { type: 'text', className: 'cfg-input', value: payload.display_name || '', 'aria-label': 'Display name' });
      const desc = el('textarea', { className: 'cfg-json', rows: '3', 'aria-label': 'Description' });
      desc.value = payload.description || '';
      const prefix = el('input', { type: 'text', className: 'cfg-input', value: payload.number_prefix || 'REQ-', 'aria-label': 'Number prefix' });
      const formSel = el('select', { className: 'cfg-input', 'aria-label': 'Starting form' });
      formSel.appendChild(el('option', { value: '', text: 'Select published form…' }));
      (state.workspaceForms || [])
        .filter((t) => t.current_published_version_id && t.status !== 'archived')
        .forEach((t) => formSel.appendChild(el('option', { value: t.id, text: t.name || t.key })));
      formSel.value = payload.starting_form_template_id || payload.form_definition_id || '';

      const wfSel = el('select', { className: 'cfg-input', 'aria-label': 'Workflow' });
      wfSel.appendChild(el('option', { value: '', text: 'Select published workflow…' }));
      (state.definitions.workflows || [])
        .filter((d) => d.status === 'published')
        .forEach((d) => wfSel.appendChild(el('option', { value: d.id, text: d.name || d.key })));
      wfSel.value = payload.workflow_definition_id || '';

      wrap.appendChild(el('label', { text: 'Display name' }));
      wrap.appendChild(display);
      wrap.appendChild(el('label', { text: 'Description' }));
      wrap.appendChild(desc);
      wrap.appendChild(el('label', { text: 'Request number prefix' }));
      wrap.appendChild(prefix);
      wrap.appendChild(el('label', { text: 'Starting form (Workspace Forms)' }));
      wrap.appendChild(formSel);
      wrap.appendChild(el('label', { text: 'Published workflow' }));
      wrap.appendChild(wfSel);

      const preview = el('div', { className: 'cfg-card', style: 'margin-top:1rem' });
      function updatePreview() {
        preview.innerHTML = '';
        preview.appendChild(el('strong', { text: display.value || 'Request type' }));
        preview.appendChild(el('span', { text: desc.value || 'New Request card preview' }));
        preview.appendChild(el('span', { className: 'cfg-hint', text: 'Prefix ' + (prefix.value || 'REQ-') }));
      }
      [display, desc, prefix].forEach((c) => c.addEventListener('input', updatePreview));
      updatePreview();
      wrap.appendChild(el('h4', { text: 'New Request preview' }));
      wrap.appendChild(preview);

      wrap._getPayload = () => ({
        ...payload,
        key: payload.key || state.selected.key,
        display_name: display.value,
        description: desc.value,
        number_prefix: prefix.value,
        starting_form_template_id: formSel.value || null,
        form_definition_id: formSel.value || null,
        workflow_definition_id: wfSel.value || null,
        active: true,
      });
    });
  }

  function renderVariables() {
    const wrap = el('div', { className: 'hub-panel cfg-panel' });
    wrap.appendChild(el('h2', { text: 'Variables' }));
    wrap.appendChild(el('p', { className: 'hub-sub', text: 'Built-in and custom organization variables. Sensitive values never render to clients.' }));
    const list = el('div', { className: 'cfg-table' });
    ((state.catalogs && state.catalogs.builtin_variables) || []).forEach((v) => {
      list.appendChild(
        el('div', { className: 'cfg-row cfg-row-static' }, [
          el('strong', { text: v.label || v.key }),
          el('span', { text: '{{' + v.key + '}}' }),
          el('span', { className: 'cfg-badge', text: v.category }),
        ])
      );
    });
    wrap.appendChild(list);
    return wrap;
  }

  function renderValidation() {
    const wrap = el('div', { className: 'hub-panel cfg-panel' });
    wrap.appendChild(el('h2', { text: 'Validation' }));
    wrap.appendChild(
      el('p', {
        text: 'Publishing runs server-side validation. Errors block publish. Open a definition and use Validate for actionable results.',
      })
    );
    return wrap;
  }

  function renderHistory() {
    const wrap = el('div', { className: 'hub-panel cfg-panel' });
    wrap.appendChild(el('h2', { text: 'Version history / audit' }));
    const box = el('div', { className: 'cfg-table', text: 'Loading…' });
    wrap.appendChild(box);
    hubFetch('/hub/configuration/audit')
      .then((data) => {
        box.innerHTML = '';
        (data.events || []).slice(0, 50).forEach((e) => {
          box.appendChild(
            el('div', { className: 'cfg-row cfg-row-static' }, [
              el('strong', { text: e.action }),
              el('span', { text: e.definition_kind || '' }),
              el('span', { text: e.actor_email || '' }),
              el('span', { text: e.created_at || '' }),
            ])
          );
        });
        if (!(data.events || []).length) box.appendChild(el('p', { className: 'hub-empty', text: 'No audit events yet.' }));
      })
      .catch((err) => {
        box.textContent = err.message || 'Failed to load audit';
      });
    return wrap;
  }

  async function initHubConfigurationCenter() {
    const mount = document.getElementById('hubConfigurationRoot');
    if (!mount) return;
    setMsg('');
    const status = await loadStatus();
    if (status && status.enabled) {
      try {
        await loadCatalogs();
        await Promise.all([
          loadWorkspaceForms(),
          loadRolesAndUsers(),
          ...SECTIONS.filter((s) => s.path).map((s) => loadKind(s.path).catch(() => [])),
        ]);
      } catch (err) {
        setMsg(err.message || 'Failed to load', true);
      }
    }
    renderShell(mount);
  }

  root.HubConfigurationCenter = {
    init: initHubConfigurationCenter,
    openWorkspaceFormBuilder,
    SECTIONS,
    _test: {
      safeGlobalBootstrap: true,
      openWorkspaceFormBuilder,
    },
  };
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : typeof global !== 'undefined' ? global : this);
