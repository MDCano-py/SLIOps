/**
 * WOS-93 Configuration Center UI — forms, documents, workflows, dashboards, variables.
 * Feature-flagged: hidden unless CONFIGURABLE_PLATFORM_ENABLED surfaces via status API.
 */
(function (global) {
  'use strict';

  const SECTIONS = [
    { id: 'overview', label: 'Overview' },
    { id: 'request_types', label: 'Request Types', kind: 'request_type', path: 'request-types' },
    { id: 'forms', label: 'Forms', kind: 'form', path: 'forms' },
    { id: 'documents', label: 'Documents', kind: 'document', path: 'documents' },
    { id: 'workflows', label: 'Workflows', kind: 'workflow', path: 'workflows' },
    { id: 'dashboards', label: 'Dashboards', kind: 'dashboard', path: 'dashboards' },
    { id: 'variables', label: 'Variables' },
    { id: 'saved_views', label: 'Saved Views', kind: 'saved_view', path: 'saved-views' },
    { id: 'validation', label: 'Validation' },
    { id: 'history', label: 'Version History' },
  ];

  let state = {
    enabled: false,
    section: 'overview',
    catalogs: null,
    definitions: {},
    selectedId: null,
    selected: null,
    message: '',
    error: '',
    designer: null,
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
      global.HubUI && typeof global.HubUI.hubFetch === 'function'
        ? global.HubUI.hubFetch
        : global.proxyFetch;
    if (typeof runner !== 'function') {
      return Promise.reject(new Error('proxyFetch not available'));
    }
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
        else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
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

  async function loadStatus() {
    try {
      const data = await hubFetch('/hub/configuration/status');
      state.enabled = !!data.enabled;
      return data;
    } catch (err) {
      state.enabled = false;
      if (err.status === 503) setMsg('Configuration Center is disabled on this environment.', true);
      else setMsg(err.message || 'Unable to load configuration status', true);
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

  function sectionMeta(id) {
    return SECTIONS.find((s) => s.id === id) || SECTIONS[0];
  }

  function renderShell(root) {
    root.innerHTML = '';
    root.className = 'cfg-root';

    if (!state.enabled) {
      root.appendChild(
        el('div', { className: 'cfg-disabled' }, [
          el('h2', { text: 'Configuration Center unavailable' }),
          el('p', {
            text:
              state.error ||
              'Enable CONFIGURABLE_PLATFORM_ENABLED=1 to use configurable forms, documents, workflows, and dashboards.',
          }),
        ])
      );
      return;
    }

    const layout = el('div', { className: 'cfg-layout' });
    const nav = el('nav', { className: 'cfg-nav', 'aria-label': 'Configuration sections' });
    SECTIONS.forEach((s) => {
      const btn = el('button', {
        type: 'button',
        className: 'cfg-nav-btn' + (state.section === s.id ? ' is-active' : ''),
        text: s.label,
        onclick: () => {
          state.section = s.id;
          state.selectedId = null;
          state.selected = null;
          state.designer = null;
          refresh(root);
        },
      });
      nav.appendChild(btn);
    });
    layout.appendChild(nav);

    const main = el('div', { className: 'cfg-main' });
    if (state.error) main.appendChild(el('div', { className: 'cfg-banner cfg-banner-error', text: state.error }));
    if (state.message) main.appendChild(el('div', { className: 'cfg-banner cfg-banner-ok', text: state.message }));

    const meta = sectionMeta(state.section);
    if (state.section === 'overview') main.appendChild(renderOverview());
    else if (state.section === 'variables') main.appendChild(renderVariables());
    else if (state.section === 'validation') main.appendChild(renderValidation());
    else if (state.section === 'history') main.appendChild(renderHistory());
    else if (meta.kind) main.appendChild(renderKindSection(meta));
    else main.appendChild(el('p', { text: 'Section not available.' }));

    layout.appendChild(main);
    root.appendChild(layout);
  }

  function renderOverview() {
    const wrap = el('div', { className: 'cfg-panel' });
    wrap.appendChild(el('h2', { text: 'Configuration Center' }));
    wrap.appendChild(
      el('p', {
        className: 'cfg-lead',
        text: 'Configure request types, forms, documents, workflows, dashboards, and variables without code changes. Existing requests continue on the legacy runtime unless attached to a published configurable request type.',
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
            setMsg('Seeded ' + (res.seeded || []).length + ' template definitions (skipped existing keys).');
            refresh(document.getElementById('hubConfigurationRoot'));
          } catch (err) {
            setMsg(err.message || 'Seed failed', true);
            refresh(document.getElementById('hubConfigurationRoot'));
          }
        },
      })
    );
    wrap.appendChild(actions);
    const grid = el('div', { className: 'cfg-card-grid' });
    [
      ['Forms', 'Build dynamic forms with conditional fields'],
      ['Documents', 'NDA and web document templates with variables'],
      ['Workflows', 'Visual designer with real runtime execution'],
      ['Dashboards', 'Role-aware widget layouts'],
    ].forEach(([title, desc]) => {
      grid.appendChild(
        el('div', { className: 'cfg-card' }, [el('strong', { text: title }), el('span', { text: desc })])
      );
    });
    wrap.appendChild(grid);
    return wrap;
  }

  function renderKindSection(meta) {
    const wrap = el('div', { className: 'cfg-panel' });
    const head = el('div', { className: 'cfg-panel-head' });
    head.appendChild(el('h2', { text: meta.label }));
    head.appendChild(
      el('button', {
        type: 'button',
        className: 'hub-btn hub-btn-primary',
        text: 'New draft',
        onclick: () => createDraft(meta),
      })
    );
    wrap.appendChild(head);

    const list = state.definitions[meta.path] || [];
    const table = el('div', { className: 'cfg-table' });
    if (!list.length) {
      table.appendChild(el('p', { className: 'cfg-empty', text: 'No definitions yet. Create a draft or seed defaults.' }));
    } else {
      list.forEach((d) => {
        const row = el('button', {
          type: 'button',
          className: 'cfg-row' + (state.selectedId === d.id ? ' is-active' : ''),
          onclick: () => openDefinition(meta, d.id),
        });
        row.appendChild(el('strong', { text: d.name || d.key }));
        row.appendChild(el('span', { text: d.key }));
        row.appendChild(el('span', { className: 'cfg-badge', text: d.status }));
        table.appendChild(row);
      });
    }
    wrap.appendChild(table);

    if (state.selected && state.selected.kind === meta.kind) {
      wrap.appendChild(renderEditor(meta));
    }
    return wrap;
  }

  async function createDraft(meta) {
    const key = prompt('Stable key (e.g. nda_intake_form)');
    if (!key) return;
    const name = prompt('Display name', key) || key;
    let payload = {};
    if (meta.kind === 'form') {
      payload = {
        layout: 'one_column',
        sections: [{ key: 'main', title: 'Main', order: 0 }],
        fields: [{ key: 'title', type: 'short_text', label: 'Title', required: true, section_key: 'main', order: 0 }],
      };
    } else if (meta.kind === 'workflow') {
      payload = {
        nodes: [
          { key: 'start', type: 'trigger.request_created', name: 'Start', x: 80, y: 80 },
          { key: 'done', type: 'terminal.complete', name: 'Complete', x: 80, y: 220 },
        ],
        connections: [{ key: 'c1', source: 'start', target: 'done', outcome_key: 'default', sort_order: 0 }],
      };
    } else if (meta.kind === 'document') {
      payload = {
        title: name,
        document_type: 'web_document',
        body_html: '<p>Document for {{organization.name}}</p>',
        signers: [],
      };
    } else if (meta.kind === 'dashboard') {
      payload = {
        name,
        layout: 'grid',
        widgets: [{ key: 'w1', type: 'my_tasks', title: 'My Tasks', size: 'md', order: 0 }],
        audience_roles: [],
      };
    } else if (meta.kind === 'request_type') {
      payload = {
        key,
        display_name: name,
        number_prefix: 'REQ-',
        default_priority: 'normal',
        available_priorities: ['low', 'normal', 'high'],
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
      state.selectedId = res.definition.id;
      state.selected = res.definition;
      if (meta.kind === 'workflow') state.designer = JSON.parse(JSON.stringify(res.definition.draft_version.payload_json));
      refresh(document.getElementById('hubConfigurationRoot'));
    } catch (err) {
      setMsg(err.message || 'Create failed', true);
      refresh(document.getElementById('hubConfigurationRoot'));
    }
  }

  async function openDefinition(meta, id) {
    try {
      const res = await hubFetch('/hub/configuration/' + meta.path + '/' + id);
      state.selectedId = id;
      state.selected = res.definition;
      if (meta.kind === 'workflow') {
        state.designer = JSON.parse(
          JSON.stringify(
            (res.definition.draft_version && res.definition.draft_version.payload_json) ||
              (res.definition.published_version && res.definition.published_version.payload_json) ||
              { nodes: [], connections: [] }
          )
        );
      }
      setMsg('');
      refresh(document.getElementById('hubConfigurationRoot'));
    } catch (err) {
      setMsg(err.message || 'Load failed', true);
      refresh(document.getElementById('hubConfigurationRoot'));
    }
  }

  function renderEditor(meta) {
    const def = state.selected;
    const draft = def.draft_version || {};
    const wrap = el('div', { className: 'cfg-editor' });
    wrap.appendChild(
      el('h3', {
        text:
          def.name +
          ' — draft rev ' +
          (draft.revision || 1) +
          (def.published_version_number ? ' (published v' + def.published_version_number + ')' : ''),
      })
    );

    if (meta.kind === 'workflow') {
      wrap.appendChild(renderWorkflowDesigner());
    } else if (meta.kind === 'form') {
      wrap.appendChild(renderFormBuilder(draft.payload_json || {}));
    } else if (meta.kind === 'document') {
      wrap.appendChild(renderDocumentEditor(draft.payload_json || {}));
    } else if (meta.kind === 'dashboard') {
      wrap.appendChild(renderDashboardEditor(draft.payload_json || {}));
    } else {
      const ta = el('textarea', {
        className: 'cfg-json',
        rows: '16',
        'aria-label': 'Definition JSON',
      });
      ta.value = JSON.stringify(draft.payload_json || {}, null, 2);
      wrap.appendChild(ta);
      wrap._payloadEl = ta;
    }

    const actions = el('div', { className: 'cfg-actions' });
    actions.appendChild(
      el('button', {
        type: 'button',
        className: 'hub-btn',
        text: 'Save draft',
        onclick: () => saveDraft(meta),
      })
    );
    actions.appendChild(
      el('button', {
        type: 'button',
        className: 'hub-btn',
        text: 'Validate',
        onclick: () => validateSelected(meta),
      })
    );
    actions.appendChild(
      el('button', {
        type: 'button',
        className: 'hub-btn hub-btn-primary',
        text: 'Publish',
        onclick: () => publishSelected(meta),
      })
    );
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
            await loadKind(meta.path);
            state.selected = null;
            refresh(document.getElementById('hubConfigurationRoot'));
          } catch (err) {
            setMsg(err.message || 'Archive failed', true);
            refresh(document.getElementById('hubConfigurationRoot'));
          }
        },
      })
    );
    wrap.appendChild(actions);
    wrap._meta = meta;
    return wrap;
  }

  function collectPayload(meta, editorRoot) {
    if (meta.kind === 'workflow') return state.designer || { nodes: [], connections: [] };
    if (editorRoot && editorRoot._getPayload) return editorRoot._getPayload();
    if (editorRoot && editorRoot._payloadEl) {
      try {
        return JSON.parse(editorRoot._payloadEl.value);
      } catch {
        throw new Error('Invalid JSON payload');
      }
    }
    return (state.selected.draft_version && state.selected.draft_version.payload_json) || {};
  }

  async function saveDraft(meta) {
    const editor = document.querySelector('.cfg-editor');
    try {
      const payload = collectPayload(meta, editor);
      const res = await hubFetch('/hub/configuration/' + meta.path + '/' + state.selected.id, {
        method: 'PUT',
        body: {
          payload,
          expected_revision: state.selected.draft_version && state.selected.draft_version.revision,
        },
      });
      state.selected = res.definition;
      setMsg('Draft saved (revision ' + (res.definition.draft_version && res.definition.draft_version.revision) + ')');
      await loadKind(meta.path);
      refresh(document.getElementById('hubConfigurationRoot'));
    } catch (err) {
      setMsg((err.data && err.data.error) || err.message || 'Save failed', true);
      refresh(document.getElementById('hubConfigurationRoot'));
    }
  }

  async function validateSelected(meta) {
    try {
      const res = await hubFetch('/hub/configuration/' + meta.path + '/' + state.selected.id + '/validate', {
        method: 'POST',
        body: {},
      });
      setMsg(res.ok ? 'Validation passed' : 'Validation returned issues — see console');
      if (!res.ok) console.warn('cfg validation', res.issues);
      refresh(document.getElementById('hubConfigurationRoot'));
    } catch (err) {
      const issues = err.data && err.data.validation;
      setMsg((issues && issues[0] && issues[0].message) || err.message || 'Validation failed', true);
      refresh(document.getElementById('hubConfigurationRoot'));
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
      refresh(document.getElementById('hubConfigurationRoot'));
    } catch (err) {
      setMsg((err.data && err.data.error) || err.message || 'Publish failed', true);
      refresh(document.getElementById('hubConfigurationRoot'));
    }
  }

  function renderFormBuilder(payload) {
    const wrap = el('div', { className: 'cfg-form-builder' });
    const fields = (payload.fields || []).slice();
    const list = el('div', { className: 'cfg-field-list' });

    function redraw() {
      list.innerHTML = '';
      fields.forEach((f, idx) => {
        const row = el('div', { className: 'cfg-field-row' });
        row.appendChild(el('span', { text: f.key + ' · ' + f.type + ' · ' + (f.label || '') }));
        row.appendChild(
          el('button', {
            type: 'button',
            className: 'hub-link-btn',
            text: 'Up',
            onclick: () => {
              if (idx === 0) return;
              const t = fields[idx - 1];
              fields[idx - 1] = fields[idx];
              fields[idx] = t;
              fields.forEach((x, i) => (x.order = i));
              redraw();
            },
          })
        );
        row.appendChild(
          el('button', {
            type: 'button',
            className: 'hub-link-btn',
            text: 'Down',
            onclick: () => {
              if (idx >= fields.length - 1) return;
              const t = fields[idx + 1];
              fields[idx + 1] = fields[idx];
              fields[idx] = t;
              fields.forEach((x, i) => (x.order = i));
              redraw();
            },
          })
        );
        row.appendChild(
          el('button', {
            type: 'button',
            className: 'hub-link-btn',
            text: 'Remove',
            onclick: () => {
              fields.splice(idx, 1);
              redraw();
            },
          })
        );
        list.appendChild(row);
      });
    }
    redraw();
    wrap.appendChild(list);

    const addRow = el('div', { className: 'cfg-actions' });
    const typeSel = el('select', { 'aria-label': 'Field type' });
    ((state.catalogs && state.catalogs.field_types) || [{ type: 'short_text', label: 'Short text' }]).forEach((t) => {
      typeSel.appendChild(el('option', { value: t.type, text: t.label }));
    });
    addRow.appendChild(typeSel);
    addRow.appendChild(
      el('button', {
        type: 'button',
        className: 'hub-btn',
        text: 'Add field',
        onclick: () => {
          const key = prompt('Field key');
          if (!key) return;
          fields.push({
            key,
            type: typeSel.value,
            label: key,
            required: false,
            section_key: 'main',
            order: fields.length,
          });
          redraw();
        },
      })
    );
    wrap.appendChild(addRow);
    wrap.appendChild(el('p', { className: 'cfg-hint', text: 'Preview uses published runtime validation. Drag-and-drop is optional; use Up/Down for accessible reordering.' }));

    wrap._getPayload = () => ({
      layout: payload.layout || 'one_column',
      sections: payload.sections || [{ key: 'main', title: 'Main', order: 0 }],
      fields: fields.map((f, i) => ({ ...f, order: i })),
    });
    return wrap;
  }

  function renderDocumentEditor(payload) {
    const wrap = el('div', { className: 'cfg-doc-editor' });
    const title = el('input', { type: 'text', className: 'cfg-input', value: payload.title || '', 'aria-label': 'Document title' });
    const body = el('textarea', { className: 'cfg-json', rows: '12', 'aria-label': 'Document body HTML' });
    body.value = payload.body_html || '';
    wrap.appendChild(el('label', { text: 'Title' }));
    wrap.appendChild(title);
    wrap.appendChild(el('label', { text: 'Body (sanitized HTML; variables like {{organization.name}})' }));
    wrap.appendChild(body);

    const varPanel = el('div', { className: 'cfg-var-panel' });
    varPanel.appendChild(el('strong', { text: 'Insert variable' }));
    ((state.catalogs && state.catalogs.builtin_variables) || []).slice(0, 24).forEach((v) => {
      varPanel.appendChild(
        el('button', {
          type: 'button',
          className: 'hub-link-btn',
          text: v.key,
          onclick: () => {
            body.value += '{{' + v.key + '}}';
          },
        })
      );
    });
    wrap.appendChild(varPanel);
    wrap.appendChild(el('p', { className: 'cfg-hint', text: 'PDF generation: unavailable in this release. Web preview and signatures are supported.' }));

    wrap._getPayload = () => ({
      ...payload,
      title: title.value,
      body_html: body.value,
      pdf_status: 'unavailable',
      pdf_message: 'Final sealed PDF generation is not available in this release.',
    });
    return wrap;
  }

  function renderDashboardEditor(payload) {
    const wrap = el('div', { className: 'cfg-dash-editor' });
    const widgets = (payload.widgets || []).slice();
    const list = el('div', { className: 'cfg-field-list' });
    function redraw() {
      list.innerHTML = '';
      widgets.forEach((w, idx) => {
        const row = el('div', { className: 'cfg-field-row' });
        row.appendChild(el('span', { text: (w.title || w.type) + ' (' + w.type + ')' }));
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
            },
          })
        );
        list.appendChild(row);
      });
    }
    redraw();
    wrap.appendChild(list);
    const sel = el('select', { 'aria-label': 'Widget type' });
    ((state.catalogs && state.catalogs.widget_types) || []).forEach((w) => {
      sel.appendChild(el('option', { value: w.type, text: w.label }));
    });
    wrap.appendChild(sel);
    wrap.appendChild(
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
        },
      })
    );
    wrap._getPayload = () => ({
      name: payload.name || 'Dashboard',
      description: payload.description || '',
      audience_roles: payload.audience_roles || [],
      layout: payload.layout || 'grid',
      widgets: widgets.map((w, i) => ({ ...w, order: i })),
    });
    return wrap;
  }

  function renderWorkflowDesigner() {
    const graph = state.designer || { nodes: [], connections: [] };
    const wrap = el('div', { className: 'cfg-wf' });
    const toolbar = el('div', { className: 'cfg-wf-toolbar' });
    const nodeSel = el('select', { 'aria-label': 'Node type' });
    ((state.catalogs && state.catalogs.node_types) || []).forEach((n) => {
      nodeSel.appendChild(el('option', { value: n.type, text: n.category + ': ' + n.label }));
    });
    toolbar.appendChild(nodeSel);
    toolbar.appendChild(
      el('button', {
        type: 'button',
        className: 'hub-btn',
        text: 'Add node',
        onclick: () => {
          const key = 'node_' + (graph.nodes.length + 1) + '_' + Date.now().toString(36);
          graph.nodes.push({
            key,
            type: nodeSel.value,
            name: nodeSel.options[nodeSel.selectedIndex].text.split(': ').pop(),
            x: 60 + (graph.nodes.length % 4) * 160,
            y: 60 + Math.floor(graph.nodes.length / 4) * 100,
            config: {},
          });
          state.designer = graph;
          refresh(document.getElementById('hubConfigurationRoot'));
        },
      })
    );
    toolbar.appendChild(
      el('button', {
        type: 'button',
        className: 'hub-btn',
        text: 'Connect selected',
        onclick: () => {
          const source = wrap.querySelector('[data-selected-source]')?.getAttribute('data-node-key');
          const target = wrap.querySelector('[data-selected-target]')?.getAttribute('data-node-key');
          // fallback prompts for accessibility
          const s = source || prompt('Source node key');
          const t = target || prompt('Target node key');
          if (!s || !t) return;
          const label = prompt('Outcome label', 'default') || 'default';
          graph.connections.push({
            key: 'c_' + Date.now().toString(36),
            source: s,
            target: t,
            label,
            outcome_key: label.toLowerCase().replace(/\s+/g, '_'),
            sort_order: graph.connections.length,
          });
          state.designer = graph;
          refresh(document.getElementById('hubConfigurationRoot'));
        },
      })
    );
    wrap.appendChild(toolbar);

    const canvas = el('div', { className: 'cfg-wf-canvas', tabindex: '0', 'aria-label': 'Workflow canvas' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'cfg-wf-svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '520');
    svg.setAttribute('viewBox', '0 0 900 520');

    graph.connections.forEach((c) => {
      const a = graph.nodes.find((n) => n.key === c.source);
      const b = graph.nodes.find((n) => n.key === c.target);
      if (!a || !b) return;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(a.x + 70));
      line.setAttribute('y1', String(a.y + 24));
      line.setAttribute('x2', String(b.x + 70));
      line.setAttribute('y2', String(b.y + 24));
      line.setAttribute('class', 'cfg-wf-edge');
      svg.appendChild(line);
      if (c.label) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', String((a.x + b.x) / 2 + 70));
        text.setAttribute('y', String((a.y + b.y) / 2 + 20));
        text.setAttribute('class', 'cfg-wf-edge-label');
        text.textContent = c.label;
        svg.appendChild(text);
      }
    });
    canvas.appendChild(svg);

    const layer = el('div', { className: 'cfg-wf-nodes' });
    let selectedKey = null;
    graph.nodes.forEach((n) => {
      const node = el('div', {
        className: 'cfg-wf-node',
        'data-node-key': n.key,
        style: 'left:' + n.x + 'px;top:' + n.y + 'px',
        tabindex: '0',
        role: 'button',
        'aria-label': n.name + ' (' + n.type + ')',
      });
      node.appendChild(el('strong', { text: n.name || n.key }));
      node.appendChild(el('span', { text: n.type }));
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
            refresh(document.getElementById('hubConfigurationRoot'));
          },
        })
      );

      let dragging = false;
      let ox = 0;
      let oy = 0;
      node.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        dragging = true;
        ox = e.clientX - n.x;
        oy = e.clientY - n.y;
        node.setPointerCapture(e.pointerId);
        selectedKey = n.key;
        layer.querySelectorAll('.cfg-wf-node').forEach((x) => x.classList.remove('is-selected'));
        node.classList.add('is-selected');
      });
      node.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        n.x = Math.max(0, e.clientX - ox);
        n.y = Math.max(0, e.clientY - oy);
        node.style.left = n.x + 'px';
        node.style.top = n.y + 'px';
      });
      node.addEventListener('pointerup', () => {
        dragging = false;
        state.designer = graph;
      });
      node.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? 20 : 8;
        if (e.key === 'ArrowLeft') {
          n.x -= step;
          e.preventDefault();
        }
        if (e.key === 'ArrowRight') {
          n.x += step;
          e.preventDefault();
        }
        if (e.key === 'ArrowUp') {
          n.y -= step;
          e.preventDefault();
        }
        if (e.key === 'ArrowDown') {
          n.y += step;
          e.preventDefault();
        }
        node.style.left = n.x + 'px';
        node.style.top = n.y + 'px';
        state.designer = graph;
      });
      layer.appendChild(node);
    });
    canvas.appendChild(layer);
    wrap.appendChild(canvas);

    const side = el('aside', { className: 'cfg-wf-side' });
    side.appendChild(el('h4', { text: 'Node library & connections' }));
    side.appendChild(
      el('p', {
        className: 'cfg-hint',
        text: 'Select nodes on the canvas, use Connect selected, or enter keys. Cycles are rejected on publish.',
      })
    );
    const connList = el('ul', { className: 'cfg-conn-list' });
    graph.connections.forEach((c, idx) => {
      const li = el('li');
      li.textContent = c.source + ' → ' + c.target + (c.label ? ' (' + c.label + ')' : '');
      li.appendChild(
        el('button', {
          type: 'button',
          className: 'hub-link-btn',
          text: 'Remove',
          onclick: () => {
            graph.connections.splice(idx, 1);
            state.designer = graph;
            refresh(document.getElementById('hubConfigurationRoot'));
          },
        })
      );
      connList.appendChild(li);
    });
    side.appendChild(connList);
    wrap.appendChild(side);
    state.designer = graph;
    return wrap;
  }

  function renderVariables() {
    const wrap = el('div', { className: 'cfg-panel' });
    wrap.appendChild(el('h2', { text: 'Variables' }));
    wrap.appendChild(el('p', { className: 'cfg-lead', text: 'Built-in and custom organization variables. Sensitive values are never rendered to clients.' }));
    const list = el('div', { className: 'cfg-table' });
    ((state.catalogs && state.catalogs.builtin_variables) || []).forEach((v) => {
      list.appendChild(
        el('div', { className: 'cfg-row cfg-row-static' }, [
          el('strong', { text: v.key }),
          el('span', { text: v.label }),
          el('span', { className: 'cfg-badge', text: v.category }),
        ])
      );
    });
    wrap.appendChild(list);
    const form = el('div', { className: 'cfg-actions' });
    const keyInput = el('input', { type: 'text', className: 'cfg-input', placeholder: 'custom.operations_email', 'aria-label': 'Variable key' });
    const labelInput = el('input', { type: 'text', className: 'cfg-input', placeholder: 'Label', 'aria-label': 'Variable label' });
    const valueInput = el('input', { type: 'text', className: 'cfg-input', placeholder: 'Value', 'aria-label': 'Variable value' });
    form.appendChild(keyInput);
    form.appendChild(labelInput);
    form.appendChild(valueInput);
    form.appendChild(
      el('button', {
        type: 'button',
        className: 'hub-btn hub-btn-primary',
        text: 'Save custom variable',
        onclick: async () => {
          try {
            await hubFetch('/hub/configuration/variables', {
              method: 'POST',
              body: { key: keyInput.value, label: labelInput.value, value: valueInput.value, type: 'string' },
            });
            setMsg('Variable saved');
            refresh(document.getElementById('hubConfigurationRoot'));
          } catch (err) {
            setMsg(err.message || 'Save failed', true);
            refresh(document.getElementById('hubConfigurationRoot'));
          }
        },
      })
    );
    wrap.appendChild(form);
    return wrap;
  }

  function renderValidation() {
    const wrap = el('div', { className: 'cfg-panel' });
    wrap.appendChild(el('h2', { text: 'Validation' }));
    wrap.appendChild(
      el('p', {
        text: 'Publishing runs server-side validation for forms, documents, workflows, and dashboards. Errors block publish; warnings may be acknowledged.',
      })
    );
    return wrap;
  }

  function renderHistory() {
    const wrap = el('div', { className: 'cfg-panel' });
    wrap.appendChild(el('h2', { text: 'Version history' }));
    wrap.appendChild(el('p', { text: 'Open a definition and use the History API, or review audit events below.' }));
    const box = el('div', { className: 'cfg-table', id: 'cfgAuditBox', text: 'Loading audit…' });
    wrap.appendChild(box);
    hubFetch('/hub/configuration/audit')
      .then((data) => {
        box.innerHTML = '';
        (data.events || []).slice(0, 40).forEach((e) => {
          box.appendChild(
            el('div', { className: 'cfg-row cfg-row-static' }, [
              el('strong', { text: e.action }),
              el('span', { text: e.definition_kind || '' }),
              el('span', { text: e.actor_email || '' }),
              el('span', { text: e.created_at || '' }),
            ])
          );
        });
        if (!(data.events || []).length) box.appendChild(el('p', { className: 'cfg-empty', text: 'No audit events yet.' }));
      })
      .catch((err) => {
        box.textContent = err.message || 'Failed to load audit';
      });
    return wrap;
  }

  async function refresh(root) {
    if (!root) return;
    renderShell(root);
  }

  async function initHubConfigurationCenter() {
    const root = document.getElementById('hubConfigurationRoot');
    if (!root) return;
    setMsg('');
    const status = await loadStatus();
    if (status && status.enabled) {
      try {
        await loadCatalogs();
        await Promise.all(
          SECTIONS.filter((s) => s.path).map((s) => loadKind(s.path).catch(() => []))
        );
      } catch (err) {
        setMsg(err.message || 'Failed to load catalogs', true);
      }
    }
    renderShell(root);
  }

  global.HubConfigurationCenter = {
    init: initHubConfigurationCenter,
    SECTIONS,
  };
})(typeof window !== 'undefined' ? window : global);
