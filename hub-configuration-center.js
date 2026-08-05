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
    dirty: false,
    lastSavedAt: null,
    validationOk: null,
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

  function markDirty() {
    state.dirty = true;
  }

  function clearDirty() {
    state.dirty = false;
    state.lastSavedAt = new Date();
  }

  function slugifyKey(name) {
    if (root.HubWorkflowDesigner && typeof root.HubWorkflowDesigner.slugifyKey === 'function') {
      return root.HubWorkflowDesigner.slugifyKey(name);
    }
    return String(name || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 64);
  }

  function kindLabel(kind) {
    const map = {
      request_type: 'Request type',
      document: 'Document',
      workflow: 'Workflow',
      dashboard: 'Dashboard',
      saved_view: 'Saved view',
      form: 'Form',
    };
    return map[kind] || kind || 'Definition';
  }

  async function wosConfirm(opts) {
    const modal = root.streamlineModal;
    if (modal && typeof modal.confirm === 'function') return modal.confirm(opts);
    return true;
  }

  async function wosAlert(opts) {
    const modal = root.streamlineModal;
    if (modal && typeof modal.alert === 'function') return modal.alert(opts);
  }

  async function promptCreateDraft(meta) {
    const modal = root.streamlineModal;
    const title = 'Create ' + kindLabel(meta.kind).toLowerCase();
    if (!modal || typeof modal.form !== 'function') {
      await wosAlert({ title: 'Unavailable', body: 'Create dialog is not available.' });
      return null;
    }
    const existing = new Set((state.definitions[meta.path] || []).map((d) => d.key));
    return modal.form({
      title,
      okLabel: 'Create draft',
      cancelLabel: 'Cancel',
      fields: [
        { name: 'name', label: 'Display name', required: true, placeholder: 'Operations Leadership Dashboard' },
        {
          name: 'key',
          label: 'Stable key',
          required: true,
          placeholder: 'operations_leadership_dashboard',
          hint: 'Generated from the display name. Becomes restricted after publication.',
        },
        { name: 'description', label: 'Description', multiline: true, placeholder: 'Optional' },
      ],
      onFieldInput(field, value, values, api) {
        if (field === 'name') api.setField('key', slugifyKey(value));
      },
      validate(values) {
        const key = slugifyKey(values.key || values.name);
        if (!/^[a-z][a-z0-9_]*$/.test(key)) return 'Stable key must start with a letter and use lowercase letters, numbers, and underscores.';
        if (existing.has(key)) return 'That stable key is already in use. Choose another.';
        return null;
      },
    });
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
        text: 'Repair NDA wiring',
        onclick: async () => {
          try {
            const res = await hubFetch('/hub/configuration/repair-nda-wiring', { method: 'POST', body: {} });
            setMsg('Repaired ' + ((res.repaired && res.repaired.length) || 0) + ' NDA definition(s).');
          } catch (err) {
            setMsg(err.message || 'Repair failed', true);
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
      ['forms', 'Forms', 'Canonical Workspace Forms builder with live preview'],
      ['workflows', 'Workflows', 'Visual graph with assignments and validation'],
      ['request_types', 'Request types', 'What users start from New Request'],
      ['documents', 'Published documents', 'Templates available to attach and launch'],
    ].forEach(([section, title, desc]) => {
      grid.appendChild(
        el('button', {
          type: 'button',
          className: 'cfg-card cfg-card-btn',
          onclick: () => {
            state.section = section;
            state.selected = null;
            state.selectedId = null;
            refresh();
          },
        }, [el('strong', { text: title }), el('span', { text: desc })])
      );
    });
    wrap.appendChild(grid);

    const pub = el('div', { className: 'cfg-published-docs', style: 'margin-top:1.25rem' });
    pub.appendChild(el('h3', { text: 'Published Documents library' }));
    pub.appendChild(
      el('p', {
        className: 'cfg-hint',
        text: 'Published templates appear here for attach, preview, and request-type use. Publishing no longer leaves documents stranded.',
      })
    );
    const docs = (state.definitions.documents || []).filter((d) => d.status === 'published');
    if (!docs.length) {
      pub.appendChild(el('p', { className: 'cfg-hint', text: 'No published documents yet. Seed defaults or publish a draft.' }));
    } else {
      const table = el('div', { className: 'cfg-table' });
      docs.forEach((d) => {
        const row = el('div', { className: 'cfg-row cfg-row-static' });
        row.appendChild(el('strong', { text: d.name || d.key }));
        row.appendChild(el('span', { className: 'cfg-badge', text: 'Published' }));
        row.appendChild(
          el('button', {
            type: 'button',
            className: 'hub-link-btn',
            text: 'Open',
            onclick: () => openDefinition({ kind: 'document', path: 'documents', label: 'Documents' }, d.id),
          })
        );
        row.appendChild(
          el('button', {
            type: 'button',
            className: 'hub-link-btn',
            text: 'Use in workflow',
            onclick: () => {
              state.section = 'workflows';
              state.selected = null;
              setMsg('Open a workflow and select a Generate Document node to attach “' + (d.name || d.key) + '”.');
              refresh();
            },
          })
        );
        table.appendChild(row);
      });
      pub.appendChild(table);
    }
    wrap.appendChild(pub);
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

    const table = el('div', { className: 'forms-hub-manage cfg-forms-registry' });
    const header = el('div', { className: 'cfg-row cfg-row-static cfg-row-head cfg-forms-registry-row' }, [
      el('strong', { text: 'Form' }),
      el('span', { text: 'Status' }),
      el('span', { text: 'Updated' }),
      el('span', { text: 'Actions' }),
    ]);
    table.appendChild(header);

    list.forEach((t) => {
      const publishedId = t.current_published_version_id;
      const lifecycle =
        t.status === 'archived'
          ? 'archived'
          : publishedId
            ? 'published'
            : 'draft';
      const statusLabel =
        lifecycle === 'published' ? 'Published' : lifecycle === 'archived' ? 'Archived' : 'Draft';
      const row = el('div', { className: 'cfg-row cfg-row-static cfg-forms-registry-row' });
      row.appendChild(
        el('div', { className: 'cfg-forms-registry-name' }, [
          el('strong', { className: 'forms-manage-form-name', text: t.name || t.key }),
          el('div', { className: 'forms-manage-meta', text: t.key || '' }),
        ])
      );
      row.appendChild(
        el('span', {
          className: 'tmpl-badge tmpl-badge-' + lifecycle + ' cfg-status-badge',
          text: statusLabel,
        })
      );
      row.appendChild(
        el('span', {
          className: 'cfg-forms-registry-updated',
          text: t.updated_at ? String(t.updated_at).slice(0, 19).replace('T', ' ') : '—',
        })
      );
      const actions = el('div', { className: 'tmpl-actions tmpl-actions-compact cfg-forms-registry-actions' });
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
    const values = await promptCreateDraft(meta);
    if (!values) return;
    const name = String(values.name || '').trim();
    const key = slugifyKey(values.key || name);
    const description = String(values.description || '').trim();
    let payload = {};
    if (meta.kind === 'workflow') {
      payload = {
        nodes: [
          { key: 'start', type: 'trigger.request_created', name: 'Request created', x: 80, y: 120, config: {} },
          { key: 'done', type: 'terminal.complete', name: 'Complete', x: 380, y: 120, config: {} },
        ],
        connections: [{ key: 'c1', source: 'start', target: 'done', source_handle: 'out', target_handle: 'in', outcome_key: 'default', label: '', sort_order: 0 }],
      };
    } else if (meta.kind === 'document') {
      payload = {
        title: name,
        document_type: 'web_document',
        description,
        body_html: '',
        blocks: [
          { type: 'heading', text: name },
          { type: 'paragraph', text: 'Agreement with {{organization.legal_name}}.' },
          { type: 'signature', text: '' },
        ],
        signers: [],
      };
      if (root.HubWorkflowDesigner) payload.body_html = root.HubWorkflowDesigner.blocksToHtml(payload.blocks);
    } else if (meta.kind === 'dashboard') {
      payload = {
        name,
        description,
        layout: 'grid',
        widgets: [{ key: 'w1', type: 'my_tasks', title: 'My Tasks', size: 'md', order: 0, config: {} }],
        audience_roles: [],
      };
    } else if (meta.kind === 'request_type') {
      payload = {
        key,
        display_name: name,
        description,
        number_prefix: 'REQ-',
        default_priority: 'normal',
        available_priorities: ['low', 'normal', 'high'],
        starting_form_template_id: null,
        workflow_definition_id: null,
      };
    } else if (meta.kind === 'saved_view') {
      payload = { name, description, owner_type: 'organization', filters: {}, columns: [] };
    }
    try {
      const res = await hubFetch('/hub/configuration/' + meta.path, {
        method: 'POST',
        body: { key, name, description, payload },
      });
      setMsg('Draft created');
      clearDirty();
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
      state.dirty = false;
      state.lastSavedAt = null;
      state.validationOk = null;
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

    const crumb = el('nav', { className: 'cfg-breadcrumb', 'aria-label': 'Breadcrumb' });
    crumb.appendChild(
      el('button', {
        type: 'button',
        className: 'cfg-back-btn',
        text: 'Configuration Center',
        onclick: () => {
          state.section = 'overview';
          state.selected = null;
          state.selectedId = null;
          state.designer = null;
          state.dirty = false;
          refresh();
        },
      })
    );
    crumb.appendChild(el('span', { className: 'cfg-crumb-sep', text: '/', 'aria-hidden': 'true' }));
    crumb.appendChild(
      el('button', {
        type: 'button',
        className: 'cfg-back-btn',
        text: meta.label || kindLabel(meta.kind),
        onclick: () => {
          state.selected = null;
          state.selectedId = null;
          state.designer = null;
          state.dirty = false;
          refresh();
        },
      })
    );
    crumb.appendChild(el('span', { className: 'cfg-crumb-sep', text: '/', 'aria-hidden': 'true' }));
    crumb.appendChild(el('span', { className: 'cfg-crumb-current', text: def.name || def.key }));
    wrap.appendChild(crumb);

    const header = el('div', { className: 'cfg-editor-header' });
    const headMain = el('div', { className: 'cfg-editor-head-main' });
    headMain.appendChild(el('h3', { className: 'cfg-editor-title', text: title || def.name }));
    const metaRow = el('div', { className: 'cfg-editor-meta' });
    metaRow.appendChild(el('span', { className: 'cfg-badge', text: kindLabel(meta.kind) }));
    metaRow.appendChild(el('span', { className: 'cfg-badge', text: isDraft ? 'Draft' : 'Published' }));
    metaRow.appendChild(
      el('span', {
        className: 'cfg-hint',
        text: isDraft
          ? 'Version draft · rev ' + (draft.revision || 1)
          : 'Version ' + (published && published.version_number != null ? published.version_number : def.published_version_number || '—'),
      })
    );
    if (state.dirty) metaRow.appendChild(el('span', { className: 'cfg-unsaved', text: 'Unsaved changes' }));
    else if (state.lastSavedAt) metaRow.appendChild(el('span', { className: 'cfg-saved', text: 'Saved just now' }));
    if (state.validationOk === true) metaRow.appendChild(el('span', { className: 'cfg-badge cfg-badge-ok', text: 'Valid' }));
    if (state.validationOk === false) metaRow.appendChild(el('span', { className: 'cfg-badge cfg-badge-err', text: 'Validation issues' }));
    headMain.appendChild(metaRow);
    header.appendChild(headMain);

    const actions = el('div', { className: 'cfg-editor-actions' });
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
    const moreWrap = el('div', { className: 'cfg-more-wrap' });
    const moreBtn = el('button', { type: 'button', className: 'hub-btn', text: 'More', 'aria-haspopup': 'true' });
    const moreMenu = el('div', { className: 'cfg-more-menu', hidden: 'hidden' });
    moreMenu.appendChild(
      el('button', {
        type: 'button',
        className: 'cfg-more-item',
        text: 'Archive',
        onclick: async () => {
          moreMenu.hidden = true;
          const ok = await wosConfirm({
            title: 'Archive definition?',
            body: 'Archived definitions leave the active registry. Published runtime behavior may be affected.',
            confirmLabel: 'Archive',
            cancelLabel: 'Cancel',
            danger: true,
          });
          if (!ok) return;
          try {
            await hubFetch('/hub/configuration/' + meta.path + '/' + def.id + '/archive', { method: 'POST', body: {} });
            setMsg('Archived');
            state.selected = null;
            state.dirty = false;
            await loadKind(meta.path);
            refresh();
          } catch (err) {
            setMsg(err.message || 'Archive failed', true);
            refresh();
          }
        },
      })
    );
    moreBtn.addEventListener('click', () => {
      moreMenu.hidden = !moreMenu.hidden;
    });
    moreWrap.appendChild(moreBtn);
    moreWrap.appendChild(moreMenu);
    actions.appendChild(moreWrap);
    header.appendChild(actions);
    wrap.appendChild(header);

    if (published && isDraft) {
      wrap.appendChild(
        el('div', {
          className: 'tmpl-readonly-banner',
          text:
            'Editing draft version ' +
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
      clearDirty();
      setMsg('Draft saved');
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
      state.validationOk = !!res.ok;
      setMsg(res.ok ? 'Validation passed' : 'Validation issues — see details');
      if (!res.ok) console.warn('cfg validation', res.issues);
      refresh();
    } catch (err) {
      state.validationOk = false;
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
      if (meta.kind === 'document') {
        setMsg('Published successfully — available in Published Documents library on Overview.');
      } else {
        setMsg('Published successfully');
      }
      await loadKind(meta.path);
      refresh();
    } catch (err) {
      setMsg((err.data && err.data.error) || err.message || 'Publish failed', true);
      refresh();
    }
  }

  function ensureWorkflowHandles(graph) {
    if (root.HubWorkflowDesigner && typeof root.HubWorkflowDesigner.ensureGraph === 'function') {
      root.HubWorkflowDesigner.ensureGraph(graph);
      return;
    }
    if (!graph.nodes) graph.nodes = [];
    if (!graph.connections) graph.connections = [];
    graph.nodes.forEach((n) => {
      n.config = n.config || {};
      if (HUMAN_NODE_TYPES.has(n.type) && !n.config.assignment) {
        n.config.assignment = {
          mode: 'role',
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

  function renderWorkflowBuilder(meta) {
    ensureWorkflowHandles(state.designer);
    const readOnly = !(state.selected.draft_version && state.selected.draft_version.status === 'draft');
    return editorChrome(meta, state.selected.name, (wrap) => {
      const host = el('div', { className: 'cfg-wf-host' });
      wrap.appendChild(host);
      wrap._getPayload = () => state.designer;
      const Designer = root.HubWorkflowDesigner;
      if (!Designer || typeof Designer.mount !== 'function') {
        host.appendChild(el('p', { className: 'cfg-hint', text: 'Workflow designer failed to load.' }));
        return;
      }
      Designer.mount(host, {
        graph: state.designer,
        readOnly,
        autoFit: readOnly || !(state.designer.nodes || []).length,
        catalogs: state.catalogs || {},
        roles: state.roles,
        users: state.users,
        documents: (state.definitions.documents || []).filter((d) => d.status === 'published'),
        selectedNodeKey: state.selectedNodeKey,
        onSelect: (key) => {
          state.selectedNodeKey = key;
        },
        onChange: (graph) => {
          state.designer = graph;
        },
        onDirty: () => {
          markDirty();
          const metaRow = wrap.querySelector('.cfg-editor-meta');
          if (metaRow && !metaRow.querySelector('.cfg-unsaved')) {
            metaRow.appendChild(el('span', { className: 'cfg-unsaved', text: 'Unsaved changes' }));
          }
          const saved = metaRow && metaRow.querySelector('.cfg-saved');
          if (saved) saved.remove();
        },
        onChooseTemplate: async () => {
          const modal = root.streamlineModal;
          if (!modal || !modal.form) return;
          const pick = await modal.form({
            title: 'Choose workflow template',
            okLabel: 'Apply template',
            fields: [
              {
                name: 'template',
                label: 'Template key',
                defaultValue: 'basic_approval',
                hint: 'basic_approval · request_review_complete · conditional_approval · vendor_onboarding · purchase_approval',
              },
            ],
          });
          if (!pick) return;
          const key = String(pick.template || '').trim();
          let payload = {
            nodes: [
              { key: 'start', type: 'trigger.request_created', name: 'Request created', x: 60, y: 120 },
              {
                key: 'review',
                type: 'human.review',
                name: 'Review',
                x: 320,
                y: 120,
                config: { assignment: { mode: 'role', role_key: 'manager', strategy: 'shared_queue', fallback: 'hub_admin' } },
              },
              { key: 'done', type: 'terminal.complete', name: 'Complete', x: 580, y: 120 },
            ],
            connections: [
              { key: 'c1', source: 'start', target: 'review', source_handle: 'out', target_handle: 'in', outcome_key: 'default', label: '', sort_order: 0 },
              { key: 'c2', source: 'review', target: 'done', source_handle: 'out', target_handle: 'in', outcome_key: 'default', label: '', sort_order: 1 },
            ],
          };
          if (key === 'request_review_complete') {
            payload = {
              nodes: [
                { key: 'start', type: 'trigger.request_created', name: 'Request created', x: 60, y: 100 },
                {
                  key: 'fill',
                  type: 'human.fill',
                  name: 'Complete form',
                  x: 300,
                  y: 100,
                  config: { assignment: { mode: 'request_creator', fallback: 'hub_admin' } },
                },
                {
                  key: 'review',
                  type: 'human.review',
                  name: 'Review',
                  x: 540,
                  y: 100,
                  config: { assignment: { mode: 'role', role_key: 'manager', strategy: 'shared_queue', fallback: 'hub_admin' } },
                },
                { key: 'done', type: 'terminal.complete', name: 'Complete', x: 780, y: 100 },
              ],
              connections: [
                { key: 'c1', source: 'start', target: 'fill', source_handle: 'out', target_handle: 'in', outcome_key: 'default', sort_order: 0 },
                { key: 'c2', source: 'fill', target: 'review', source_handle: 'out', target_handle: 'in', outcome_key: 'default', sort_order: 1 },
                { key: 'c3', source: 'review', target: 'done', source_handle: 'out', target_handle: 'in', outcome_key: 'default', sort_order: 2 },
              ],
            };
          } else if (key === 'conditional_approval') {
            payload = {
              nodes: [
                { key: 'start', type: 'trigger.form_submitted', name: 'Form submitted', x: 60, y: 140 },
                {
                  key: 'cond',
                  type: 'logic.condition',
                  name: 'Needs approval?',
                  x: 300,
                  y: 140,
                  config: { outcomes: [{ key: 'yes', label: 'Yes' }, { key: 'no', label: 'No' }] },
                },
                {
                  key: 'approve',
                  type: 'human.approve',
                  name: 'Approve',
                  x: 560,
                  y: 60,
                  config: { assignment: { mode: 'role', role_key: 'manager', strategy: 'shared_queue', fallback: 'hub_admin' } },
                },
                { key: 'done', type: 'terminal.complete', name: 'Complete', x: 820, y: 140 },
              ],
              connections: [
                { key: 'c1', source: 'start', target: 'cond', source_handle: 'out', target_handle: 'in', outcome_key: 'default', sort_order: 0 },
                { key: 'c2', source: 'cond', target: 'approve', source_handle: 'yes', target_handle: 'in', outcome_key: 'yes', label: 'Yes', sort_order: 1 },
                { key: 'c3', source: 'cond', target: 'done', source_handle: 'no', target_handle: 'in', outcome_key: 'no', label: 'No', sort_order: 2 },
                { key: 'c4', source: 'approve', target: 'done', source_handle: 'out', target_handle: 'in', outcome_key: 'default', sort_order: 3 },
              ],
            };
          } else if (key === 'vendor_onboarding') {
            payload = {
              nodes: [
                { key: 'start', type: 'trigger.request_created', name: 'Vendor onboarding started', x: 60, y: 80 },
                {
                  key: 'fill',
                  type: 'human.fill',
                  name: 'Vendor information',
                  x: 300,
                  y: 80,
                  config: { assignment: { mode: 'request_creator', fallback: 'hub_admin' } },
                },
                {
                  key: 'ops',
                  type: 'human.review',
                  name: 'Operations review',
                  x: 540,
                  y: 80,
                  config: { assignment: { mode: 'role', role_key: 'manager', strategy: 'shared_queue', fallback: 'hub_admin' } },
                },
                {
                  key: 'acct',
                  type: 'human.review',
                  name: 'Accounting review',
                  x: 780,
                  y: 80,
                  config: { assignment: { mode: 'role', role_key: 'ap', strategy: 'shared_queue', fallback: 'hub_admin' } },
                },
                { key: 'done', type: 'terminal.complete', name: 'Complete', x: 1020, y: 80 },
                { key: 'reject', type: 'terminal.reject', name: 'Rejected', x: 780, y: 220 },
              ],
              connections: [
                { key: 'c1', source: 'start', target: 'fill', source_handle: 'out', target_handle: 'in', outcome_key: 'default', sort_order: 0 },
                { key: 'c2', source: 'fill', target: 'ops', source_handle: 'out', target_handle: 'in', outcome_key: 'default', sort_order: 1 },
                { key: 'c3', source: 'ops', target: 'acct', source_handle: 'out', target_handle: 'in', outcome_key: 'default', sort_order: 2 },
                { key: 'c4', source: 'acct', target: 'done', source_handle: 'out', target_handle: 'in', outcome_key: 'default', sort_order: 3 },
                { key: 'c5', source: 'acct', target: 'reject', source_handle: 'reject', target_handle: 'in', outcome_key: 'reject', label: 'Rejected', sort_order: 4 },
              ],
            };
          }
          state.designer = JSON.parse(JSON.stringify(payload));
          ensureWorkflowHandles(state.designer);
          markDirty();
          refresh();
        },
      });
    });
  }


  function renderDocumentBuilder(meta) {
    const draft = state.selected.draft_version || {};
    const payload = JSON.parse(JSON.stringify(draft.payload_json || {}));
    let blocks = Array.isArray(payload.blocks) && payload.blocks.length
      ? payload.blocks
      : [
          { type: 'heading', text: payload.title || state.selected.name || 'Document' },
          { type: 'paragraph', text: 'Agreement with {{organization.legal_name}}.' },
        ];
    let sampleMode = true;
    let showAdvanced = false;
    let autosaveState = 'saved';
    let blockHistory = [];
    let blockFuture = [];
    const Designer = root.HubWorkflowDesigner;

    function pushBlockHistory() {
      blockHistory.push(JSON.parse(JSON.stringify(blocks)));
      if (blockHistory.length > 40) blockHistory.shift();
      blockFuture.length = 0;
    }

    return editorChrome(meta, state.selected.name, (wrap) => {
      const layout = el('div', { className: 'cfg-split cfg-doc-split' });
      const left = el('div', { className: 'cfg-split-left' });
      const right = el('div', { className: 'cfg-split-right' });

      const saveStatus = el('div', { className: 'cfg-save-status', text: 'Saved', 'aria-live': 'polite' });
      left.appendChild(saveStatus);
      left.appendChild(el('h4', { text: 'Document structure' }));
      const title = el('input', {
        type: 'text',
        className: 'cfg-input',
        value: payload.title || '',
        'aria-label': 'Title',
      });
      left.appendChild(el('label', { text: 'Title' }));
      left.appendChild(title);

      const blockTools = el('div', { className: 'cfg-toolbar' });
      blockTools.appendChild(
        el('button', {
          type: 'button',
          className: 'hub-btn hub-btn-sm',
          text: 'Undo',
          onclick: () => {
            if (!blockHistory.length) return;
            blockFuture.push(JSON.parse(JSON.stringify(blocks)));
            blocks = blockHistory.pop();
            markDirty();
            redrawBlocks();
            updatePreview();
          },
        })
      );
      blockTools.appendChild(
        el('button', {
          type: 'button',
          className: 'hub-btn hub-btn-sm',
          text: 'Redo',
          onclick: () => {
            if (!blockFuture.length) return;
            blockHistory.push(JSON.parse(JSON.stringify(blocks)));
            blocks = blockFuture.pop();
            markDirty();
            redrawBlocks();
            updatePreview();
          },
        })
      );
      left.appendChild(blockTools);

      const blockList = el('div', { className: 'cfg-block-list', role: 'list' });
      left.appendChild(blockList);

      const addRow = el('div', { className: 'cfg-toolbar' });
      [
        ['heading', 'Heading'],
        ['paragraph', 'Paragraph'],
        ['list', 'List'],
        ['table', 'Table'],
        ['divider', 'Divider'],
        ['variable', 'Variable'],
        ['conditional', 'Conditional'],
        ['signature', 'Signature'],
        ['initial', 'Initial'],
        ['acknowledgement', 'Acknowledgement'],
      ].forEach(([type, label]) => {
        addRow.appendChild(
          el('button', {
            type: 'button',
            className: 'hub-btn hub-btn-sm',
            text: label,
            onclick: () => {
              pushBlockHistory();
              blocks.push({
                type,
                text: type === 'variable' ? '' : label,
                key: type === 'variable' ? 'organization.legal_name' : undefined,
                items: type === 'list' ? ['Item one', 'Item two'] : undefined,
                condition: type === 'conditional' ? 'request.priority == high' : undefined,
              });
              markDirty();
              redrawBlocks();
              updatePreview();
            },
          })
        );
      });
      left.appendChild(addRow);

      const picker = el('div', { className: 'cfg-var-picker' });
      picker.appendChild(el('strong', { text: 'Insert variable' }));
      const search = el('input', {
        type: 'search',
        className: 'cfg-input',
        placeholder: 'Search variables…',
        'aria-label': 'Search variables',
      });
      picker.appendChild(search);
      const varList = el('div', { className: 'cfg-var-list' });
      function renderVars() {
        varList.innerHTML = '';
        const q = search.value.trim().toLowerCase();
        const cats = {};
        ((state.catalogs && state.catalogs.builtin_variables) || []).forEach((v) => {
          if (q && !(v.key || '').includes(q) && !(v.label || '').toLowerCase().includes(q)) return;
          const cat = v.category || 'Custom';
          if (!cats[cat]) cats[cat] = [];
          cats[cat].push(v);
        });
        Object.keys(cats).forEach((cat) => {
          varList.appendChild(el('div', { className: 'cfg-hint', text: cat }));
          cats[cat].forEach((v) => {
            const btn = el('button', {
              type: 'button',
              className: 'cfg-var-item',
              onclick: () => {
                blocks.push({ type: 'variable', key: v.key, text: v.label || v.key });
                markDirty();
                redrawBlocks();
                updatePreview();
              },
            });
            btn.appendChild(el('strong', { text: v.label || v.key }));
            btn.appendChild(el('span', { text: '{{' + v.key + '}} · ' + (v.data_type || 'text') }));
            varList.appendChild(btn);
          });
        });
      }
      search.addEventListener('input', renderVars);
      renderVars();
      picker.appendChild(varList);
      left.appendChild(picker);

      const advToggle = el('button', {
        type: 'button',
        className: 'hub-link-btn',
        text: 'Advanced source',
        onclick: () => {
          showAdvanced = !showAdvanced;
          advWrap.hidden = !showAdvanced;
          advToggle.textContent = showAdvanced ? 'Hide advanced source' : 'Advanced source';
        },
      });
      left.appendChild(advToggle);
      const advWrap = el('div', { hidden: 'hidden' });
      const body = el('textarea', { className: 'cfg-json', rows: '8', 'aria-label': 'Advanced HTML source' });
      body.value = payload.body_html || (Designer ? Designer.blocksToHtml(blocks) : '');
      body.addEventListener('input', () => {
        markDirty();
        updatePreview();
      });
      advWrap.appendChild(el('p', { className: 'cfg-hint', text: 'Raw HTML remains sanitized on save. Prefer structured blocks for authoring.' }));
      advWrap.appendChild(body);
      left.appendChild(advWrap);

      right.appendChild(el('h4', { text: 'Live document preview' }));
      const toggle = el('div', { className: 'cfg-toolbar' });
      toggle.appendChild(
        el('button', {
          type: 'button',
          className: 'hub-btn hub-btn-sm',
          text: 'Preview sample values',
          onclick: () => {
            sampleMode = true;
            updatePreview();
          },
        })
      );
      toggle.appendChild(
        el('button', {
          type: 'button',
          className: 'hub-btn hub-btn-sm',
          text: 'Show variable keys',
          onclick: () => {
            sampleMode = false;
            updatePreview();
          },
        })
      );
      right.appendChild(toggle);
      const preview = el('div', { className: 'cfg-doc-preview cfg-doc-page' });
      right.appendChild(preview);
      right.appendChild(
        el('p', {
          className: 'cfg-hint',
          text: 'PDF generation remains unavailable in this release. Web preview and signatures are supported.',
        })
      );

      function redrawBlocks() {
        blockList.innerHTML = '';
        blocks.forEach((b, idx) => {
          const row = el('div', {
            className: 'cfg-block-row',
            draggable: 'true',
            role: 'listitem',
            'data-block-index': String(idx),
            'aria-label': 'Block ' + (idx + 1) + ' ' + b.type,
          });
          const handle = el('button', {
            type: 'button',
            className: 'cfg-block-drag',
            text: '⋮⋮',
            title: 'Drag to reorder',
            'aria-label': 'Drag handle for block ' + (idx + 1),
          });
          handle.addEventListener('mousedown', (e) => e.stopPropagation());
          row.appendChild(handle);
          row.appendChild(el('span', { className: 'cfg-badge', text: b.type }));

          const collapsed = !!b._collapsed;
          const toggle = el('button', {
            type: 'button',
            className: 'hub-link-btn',
            text: collapsed ? 'Expand' : 'Collapse',
            onclick: () => {
              b._collapsed = !b._collapsed;
              redrawBlocks();
            },
          });
          row.appendChild(toggle);

          if (!collapsed) {
            const input = el('input', {
              type: 'text',
              className: 'cfg-input',
              value: b.type === 'variable' ? b.key || '' : b.text || '',
              'aria-label': 'Block ' + (idx + 1) + ' content',
            });
            input.addEventListener('input', () => {
              if (b.type === 'variable') b.key = input.value;
              else b.text = input.value;
              markDirty();
              syncHtmlFromBlocks();
              updatePreview();
            });
            row.appendChild(input);
          } else {
            row.appendChild(
              el('span', {
                className: 'cfg-hint',
                text: (b.type === 'variable' ? b.key : b.text) || '(empty)',
              })
            );
          }

          const moves = el('div', { className: 'cfg-block-actions' });
          moves.appendChild(
            el('button', {
              type: 'button',
              className: 'hub-link-btn',
              text: '↑',
              'aria-label': 'Move block up',
              disabled: idx === 0 ? 'disabled' : null,
              onclick: () => {
                if (idx === 0) return;
                pushBlockHistory();
                const t = blocks[idx - 1];
                blocks[idx - 1] = blocks[idx];
                blocks[idx] = t;
                markDirty();
                redrawBlocks();
                updatePreview();
              },
            })
          );
          moves.appendChild(
            el('button', {
              type: 'button',
              className: 'hub-link-btn',
              text: '↓',
              'aria-label': 'Move block down',
              disabled: idx === blocks.length - 1 ? 'disabled' : null,
              onclick: () => {
                if (idx >= blocks.length - 1) return;
                pushBlockHistory();
                const t = blocks[idx + 1];
                blocks[idx + 1] = blocks[idx];
                blocks[idx] = t;
                markDirty();
                redrawBlocks();
                updatePreview();
              },
            })
          );
          moves.appendChild(
            el('button', {
              type: 'button',
              className: 'hub-link-btn',
              text: 'Duplicate',
              onclick: () => {
                pushBlockHistory();
                blocks.splice(idx + 1, 0, JSON.parse(JSON.stringify(b)));
                markDirty();
                redrawBlocks();
                updatePreview();
              },
            })
          );
          moves.appendChild(
            el('button', {
              type: 'button',
              className: 'hub-link-btn',
              text: 'Remove',
              onclick: () => {
                pushBlockHistory();
                blocks.splice(idx, 1);
                markDirty();
                redrawBlocks();
                syncHtmlFromBlocks();
                updatePreview();
              },
            })
          );
          row.appendChild(moves);

          row.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', String(idx));
            e.dataTransfer.effectAllowed = 'move';
            row.classList.add('is-dragging');
          });
          row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
          row.addEventListener('dragover', (e) => {
            e.preventDefault();
            row.classList.add('is-drop-target');
          });
          row.addEventListener('dragleave', () => row.classList.remove('is-drop-target'));
          row.addEventListener('drop', (e) => {
            e.preventDefault();
            row.classList.remove('is-drop-target');
            const from = Number(e.dataTransfer.getData('text/plain'));
            const to = idx;
            if (!Number.isFinite(from) || from === to) return;
            pushBlockHistory();
            const [moved] = blocks.splice(from, 1);
            blocks.splice(to, 0, moved);
            markDirty();
            redrawBlocks();
            syncHtmlFromBlocks();
            updatePreview();
          });

          blockList.appendChild(row);
        });
        syncHtmlFromBlocks();
      }

      function syncHtmlFromBlocks() {
        if (Designer) body.value = Designer.blocksToHtml(blocks);
      }

      function updatePreview() {
        const html = showAdvanced ? body.value : Designer ? Designer.blocksToHtml(blocks) : body.value;
        const rendered = Designer ? Designer.renderPreviewHtml(html, sampleMode) : html;
        preview.innerHTML = '<article class="cfg-doc-article">' + rendered + '</article>';
      }

      title.addEventListener('input', () => {
        markDirty();
        updatePreview();
      });

      redrawBlocks();
      updatePreview();

      layout.appendChild(left);
      layout.appendChild(right);
      wrap.appendChild(layout);
      wrap._getPayload = () => ({
        ...payload,
        title: title.value,
        blocks: blocks.map((b) => {
          const copy = { ...b };
          delete copy._collapsed;
          return copy;
        }),
        body_html: showAdvanced ? body.value : Designer ? Designer.blocksToHtml(blocks) : body.value,
        pdf_status: 'unavailable',
        pdf_message: 'Final sealed PDF generation is not available in this release.',
      });
      wrap._validateBlocks = () => {
        for (let i = 0; i < blocks.length; i++) {
          const b = blocks[i];
          if (b.type === 'variable' && !(b.key || '').trim()) {
            return { index: i, message: 'Variable block is missing a key' };
          }
          if ((b.type === 'heading' || b.type === 'paragraph') && !(b.text || '').trim()) {
            return { index: i, message: b.type + ' block is empty' };
          }
        }
        return null;
      };
    });
  }

  function renderDashboardBuilder(meta) {
    const draft = state.selected.draft_version || {};
    const payload = JSON.parse(JSON.stringify(draft.payload_json || {}));
    const widgets = payload.widgets || [];
    return editorChrome(meta, state.selected.name, (wrap) => {
      const layout = el('div', { className: 'cfg-split' });
      const left = el('div', { className: 'cfg-split-left' });
      const right = el('div', { className: 'cfg-split-right' });
      left.appendChild(el('h4', { text: 'Widget structure' }));
      const list = el('div', { className: 'cfg-field-list' });

      function redraw() {
        list.innerHTML = '';
        if (!widgets.length) {
          list.appendChild(el('p', { className: 'cfg-hint', text: 'Add widgets to build the dashboard layout.' }));
        }
        widgets.forEach((w, idx) => {
          const row = el('div', { className: 'cfg-field-row' });
          const titleIn = el('input', {
            type: 'text',
            className: 'cfg-input',
            value: w.title || w.type,
            'aria-label': 'Widget title',
          });
          titleIn.addEventListener('input', () => {
            w.title = titleIn.value;
            markDirty();
            renderPreview();
          });
          const size = el('select', { className: 'cfg-input', 'aria-label': 'Widget size' });
          [
            ['sm', 'Small'],
            ['md', 'Medium'],
            ['lg', 'Large'],
          ].forEach(([v, t]) => size.appendChild(el('option', { value: v, text: t })));
          size.value = w.size || 'md';
          size.addEventListener('change', () => {
            w.size = size.value;
            markDirty();
            renderPreview();
          });
          row.appendChild(el('span', { className: 'cfg-badge', text: w.type }));
          row.appendChild(titleIn);
          row.appendChild(size);
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
                markDirty();
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
                markDirty();
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
      ((state.catalogs && state.catalogs.widget_types) || [{ type: 'my_tasks', label: 'My Tasks' }]).forEach((w) => {
        sel.appendChild(el('option', { value: w.type, text: w.label || w.type }));
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
            markDirty();
            redraw();
            renderPreview();
          },
        })
      );

      right.appendChild(el('h4', { text: 'Live dashboard preview' }));
      const preview = el('div', { className: 'cfg-dash-preview cfg-dash-grid' });
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
              el('div', { className: 'cfg-dash-sample', text: w.type === 'my_tasks' ? '3 open tasks' : '12 items' }),
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
    slugifyKey,
    _test: {
      safeGlobalBootstrap: true,
      openWorkspaceFormBuilder,
      slugifyKey,
      markDirty,
      clearDirty,
    },
  };
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : typeof global !== 'undefined' ? global : this);
