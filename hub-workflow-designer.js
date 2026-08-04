/**
 * WOS-95 — Curated workflow canvas designer.
 * Interaction quality inspired by studying a third-party workflow editor as a design reference;
 * no third-party source was copied. See docs/reports/WOS_95_N8N_REFERENCE_AUDIT.md
 */
(function (root) {
  'use strict';

  const NODE_W = 220;
  const NODE_H = 88;
  const HUMAN_TYPES = new Set([
    'human.fill',
    'human.review',
    'human.approve',
    'human.reject',
    'human.sign',
    'human.acknowledge',
    'human.provide_info',
    'human.upload',
  ]);

  const CATEGORY_ORDER = [
    'Start',
    'People',
    'Decisions',
    'Documents',
    'Notifications',
    'Automation',
    'Request updates',
    'End',
  ];

  const CATEGORY_MAP = {
    trigger: 'Start',
    human: 'People',
    logic: 'Decisions',
    document: 'Documents',
    notification: 'Notifications',
    integration: 'Automation',
    assignment: 'Request updates',
    terminal: 'End',
  };

  const CATEGORY_ICON = {
    Start: '▶',
    People: '👤',
    Decisions: '◇',
    Documents: '📄',
    Notifications: '✉',
    Automation: '⚙',
    'Request updates': '↺',
    End: '■',
  };

  const SAMPLE_VARS = {
    'organization.legal_name': 'Streamline Operations LLC',
    'organization.name': 'Streamline Operations',
    'request.number': 'REQ-1042',
    'request.title': 'Vendor onboarding',
    'current_user.name': 'Alex Morgan',
    'current_user.email': 'alex@streamlineinnovations.com',
    'assignee.name': 'Jordan Lee',
    'date.today': 'August 4, 2026',
  };

  function esc(s) {
    if (s == null) return '';
    if (typeof root.escapeHtml === 'function') return root.escapeHtml(s);
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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

  function slugifyKey(name) {
    return String(name || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 64);
  }

  function isStartType(type) {
    return String(type || '').startsWith('trigger.');
  }

  function isTerminalType(type) {
    return String(type || '').startsWith('terminal.');
  }

  function isHumanType(type) {
    return HUMAN_TYPES.has(type);
  }

  function uiCategory(nodeTypeMeta) {
    if (!nodeTypeMeta) return 'Automation';
    if (nodeTypeMeta.type === 'logic.set_variable' || nodeTypeMeta.type === 'logic.update_request' || nodeTypeMeta.type === 'logic.change_status') {
      return 'Request updates';
    }
    if (String(nodeTypeMeta.type || '').startsWith('assign.')) return 'Request updates';
    if (nodeTypeMeta.type === 'logic.condition' || nodeTypeMeta.type === 'logic.multi_branch' || nodeTypeMeta.type === 'logic.wait' || nodeTypeMeta.type === 'logic.delay_until' || nodeTypeMeta.type === 'logic.wait_for_action' || nodeTypeMeta.type === 'logic.merge') {
      return 'Decisions';
    }
    return CATEGORY_MAP[nodeTypeMeta.category] || 'Automation';
  }

  function nodeHandles(node) {
    const handles = [];
    if (!isStartType(node.type)) handles.push({ id: 'in', side: 'left', label: 'In', y: 0.5 });
    if (node.type === 'logic.condition' || node.type === 'logic.multi_branch') {
      const outs = (node.config && node.config.outcomes) || [
        { key: 'yes', label: 'Yes' },
        { key: 'no', label: 'No' },
      ];
      outs.forEach((o, i) => {
        handles.push({
          id: o.key || o.id || String(i),
          side: 'right',
          label: o.label || o.key || 'Out',
          y: (i + 1) / (outs.length + 1),
        });
      });
    } else if (isTerminalType(node.type)) {
      /* input only */
    } else {
      handles.push({ id: 'out', side: 'right', label: 'Done', y: 0.42 });
      if (isHumanType(node.type)) {
        handles.push({ id: 'reject', side: 'right', label: 'Rejected', y: 0.72 });
      }
    }
    return handles;
  }

  function handlePoint(node, handleId) {
    const handles = nodeHandles(node);
    let hnd = handles.find((x) => x.id === handleId);
    if (!hnd && (handleId === 'yes' || handleId === 'no' || handleId === 'reject')) {
      hnd = handles.find((x) => x.id === handleId);
    }
    if (!hnd) hnd = handles.find((x) => x.side === 'right') || handles[handles.length - 1] || { side: 'right', y: 0.5 };
    const yRatio = hnd.y != null ? hnd.y : 0.5;
    const x = hnd.side === 'left' ? node.x : node.x + NODE_W;
    const y = node.y + NODE_H * yRatio;
    return { x, y };
  }

  function ensureGraph(graph) {
    if (!graph.nodes) graph.nodes = [];
    if (!graph.connections) graph.connections = [];
    graph.nodes.forEach((n) => {
      n.x = Number(n.x) || 80;
      n.y = Number(n.y) || 80;
      n.config = n.config || {};
      if (isHumanType(n.type) && !n.config.assignment) {
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
    return graph;
  }

  function countStarts(graph) {
    return (graph.nodes || []).filter((n) => isStartType(n.type)).length;
  }

  function autoLayout(graph) {
    ensureGraph(graph);
    const nodes = graph.nodes;
    const connections = graph.connections;
    const start = nodes.find((n) => isStartType(n.type)) || nodes[0];
    if (!start) return;
    const adj = {};
    nodes.forEach((n) => (adj[n.key] = []));
    connections.forEach((c) => {
      if (adj[c.source]) adj[c.source].push(c);
    });
    const depth = {};
    const lane = {};
    const queue = [start.key];
    depth[start.key] = 0;
    lane[start.key] = 0;
    while (queue.length) {
      const cur = queue.shift();
      const outs = adj[cur] || [];
      outs.forEach((c, i) => {
        if (depth[c.target] == null) {
          depth[c.target] = depth[cur] + 1;
          const branchDown = c.outcome_key === 'no' || c.outcome_key === 'reject' || c.outcome_key === 'rejected' || /reject/i.test(c.label || '');
          lane[c.target] = (lane[cur] || 0) + (branchDown ? 1 : i > 0 ? i : 0);
          queue.push(c.target);
        }
      });
    }
    const columns = {};
    nodes.forEach((n) => {
      const d = depth[n.key] != null ? depth[n.key] : 99;
      if (!columns[d]) columns[d] = [];
      columns[d].push(n);
    });
    Object.keys(columns)
      .map(Number)
      .sort((a, b) => a - b)
      .forEach((d) => {
        columns[d]
          .sort((a, b) => (lane[a.key] || 0) - (lane[b.key] || 0))
          .forEach((n, i) => {
            n.x = 48 + d * (NODE_W + 72);
            n.y = 48 + (lane[n.key] != null ? lane[n.key] : i) * (NODE_H + 48);
          });
      });
  }

  function graphBounds(graph) {
    const nodes = graph.nodes || [];
    if (!nodes.length) return { minX: 0, minY: 0, maxX: 400, maxY: 300 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    nodes.forEach((n) => {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NODE_W);
      maxY = Math.max(maxY, n.y + NODE_H);
    });
    return { minX, minY, maxX, maxY };
  }

  function assignmentSummary(node, roles, users) {
    const asg = (node.config && node.config.assignment) || {};
    if (!isHumanType(node.type)) return '';
    if (asg.mode === 'specific_user') {
      const u = (users || []).find((x) => String(x.id || x.email) === String(asg.user_id));
      return u ? u.name || u.display_name || u.email : 'Specific user';
    }
    if (asg.mode === 'role') {
      const r = (roles || []).find((x) => (x.key || x.id || x.role_key) === asg.role_key);
      return (r && (r.name || r.label)) || asg.role_key || 'Role queue';
    }
    if (asg.mode === 'request_creator') return 'Request creator';
    if (asg.mode === 'form_user_field') return 'Form field user';
    if (asg.mode === 'external_participant') return 'External participant';
    return 'Unassigned';
  }

  function shortDesc(node, catalogByType) {
    const meta = catalogByType[node.type];
    if (node.config && node.config.description) return node.config.description;
    return (meta && meta.label) || node.type;
  }

  /**
   * Mount curated workspace into `host`.
   * opts: { graph, readOnly, catalogs, roles, users, selectedNodeKey, onChange, onSelect, onDirty, templates }
   */
  function mount(host, opts) {
    const graph = ensureGraph(opts.graph || { nodes: [], connections: [] });
    const readOnly = !!opts.readOnly;
    const catalogs = opts.catalogs || {};
    const nodeTypes = catalogs.node_types || [];
    const catalogByType = {};
    nodeTypes.forEach((n) => {
      catalogByType[n.type] = n;
    });
    let selectedKey = opts.selectedNodeKey || null;
    let panX = 0;
    let panY = 0;
    let zoom = 1;
    let linking = null;
    let libraryCollapsed = false;
    let inspectorCollapsed = false;
    let outlineOpen = true;
    let recentTypes = [];

    const rootEl = el('div', { className: 'wfd-root' + (readOnly ? ' is-readonly' : '') });
    host.innerHTML = '';
    host.appendChild(rootEl);

    function emitChange() {
      if (typeof opts.onChange === 'function') opts.onChange(graph);
    }
    function emitDirty() {
      if (typeof opts.onDirty === 'function') opts.onDirty();
      emitChange();
    }
    function emitSelect(key) {
      selectedKey = key;
      if (typeof opts.onSelect === 'function') opts.onSelect(key);
      render();
    }

    function addNode(type, at) {
      if (readOnly) return;
      if (isStartType(type) && countStarts(graph) >= 1) {
        const modal = root.streamlineModal;
        if (modal && modal.confirm) {
          modal
            .confirm({
              title: 'Replace start node?',
              body: 'Workflows support exactly one start. Replace the existing start with this trigger?',
              confirmLabel: 'Replace start',
              cancelLabel: 'Cancel',
            })
            .then((ok) => {
              if (!ok) return;
              graph.nodes = graph.nodes.filter((n) => !isStartType(n.type));
              graph.connections = graph.connections.filter((c) => graph.nodes.some((n) => n.key === c.source) && graph.nodes.some((n) => n.key === c.target));
              placeNode(type, at);
            });
          return;
        }
        return;
      }
      placeNode(type, at);
    }

    function placeNode(type, at) {
      const meta = catalogByType[type] || { type, label: type };
      const key = 'node_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const node = {
        key,
        type,
        name: meta.label || type,
        x: at && at.x != null ? at.x : 80 + (graph.nodes.length % 3) * 40,
        y: at && at.y != null ? at.y : 80 + graph.nodes.length * 24,
        config: {},
      };
      graph.nodes.push(node);
      ensureGraph(graph);
      recentTypes = [type].concat(recentTypes.filter((t) => t !== type)).slice(0, 6);
      emitDirty();
      emitSelect(key);
    }

    function removeNode(key) {
      if (readOnly) return;
      graph.nodes = graph.nodes.filter((n) => n.key !== key);
      graph.connections = graph.connections.filter((c) => c.source !== key && c.target !== key);
      if (selectedKey === key) selectedKey = null;
      emitDirty();
      render();
    }

    function removeConnection(ckey) {
      if (readOnly) return;
      graph.connections = graph.connections.filter((c) => c.key !== ckey);
      emitDirty();
      render();
    }

    function connect(source, sourceHandle, target, targetHandle) {
      if (readOnly || source === target) return false;
      const exists = graph.connections.some(
        (c) => c.source === source && c.target === target && (c.source_handle || 'out') === sourceHandle
      );
      if (exists) return false;
      if (isStartType((graph.nodes.find((n) => n.key === target) || {}).type)) return false;
      const outcome = sourceHandle === 'out' ? 'default' : sourceHandle;
      graph.connections.push({
        key: 'c_' + Date.now().toString(36),
        source,
        target,
        source_handle: sourceHandle,
        target_handle: targetHandle || 'in',
        label: outcome === 'default' ? '' : outcome,
        outcome_key: outcome,
        sort_order: graph.connections.length,
      });
      emitDirty();
      return true;
    }

    function fitToView() {
      const canvas = rootEl.querySelector('.wfd-canvas');
      if (!canvas) return;
      const b = graphBounds(graph);
      const pad = 48;
      const w = Math.max(1, b.maxX - b.minX + pad * 2);
      const h = Math.max(1, b.maxY - b.minY + pad * 2);
      const vw = canvas.clientWidth || 800;
      const vh = canvas.clientHeight || 520;
      zoom = Math.max(0.35, Math.min(1.25, Math.min(vw / w, vh / h)));
      panX = (vw - w * zoom) / 2 - b.minX * zoom + pad * zoom;
      panY = (vh - h * zoom) / 2 - b.minY * zoom + pad * zoom;
      applyTransform();
      paintMinimap();
    }

    function applyTransform() {
      const world = rootEl.querySelector('.wfd-world');
      if (world) world.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')';
      const zoomLabel = rootEl.querySelector('.wfd-zoom-label');
      if (zoomLabel) zoomLabel.textContent = Math.round(zoom * 100) + '%';
    }

    function paintEdges(svg, preview) {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      marker.setAttribute('id', 'wfdArrow');
      marker.setAttribute('viewBox', '0 0 10 10');
      marker.setAttribute('refX', '9');
      marker.setAttribute('refY', '5');
      marker.setAttribute('markerWidth', '6');
      marker.setAttribute('markerHeight', '6');
      marker.setAttribute('orient', 'auto-start-reverse');
      const tip = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      tip.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
      tip.setAttribute('class', 'wfd-arrow');
      marker.appendChild(tip);
      defs.appendChild(marker);
      svg.appendChild(defs);

      graph.connections.forEach((c) => {
        const a = graph.nodes.find((n) => n.key === c.source);
        const b = graph.nodes.find((n) => n.key === c.target);
        if (!a || !b) return;
        const srcH = c.source_handle || (c.outcome_key === 'yes' || c.outcome_key === 'no' || c.outcome_key === 'reject' ? c.outcome_key : 'out');
        const p1 = handlePoint(a, srcH);
        const p2 = handlePoint(b, c.target_handle || 'in');
        const midX = (p1.x + p2.x) / 2;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M ' + p1.x + ' ' + p1.y + ' C ' + midX + ' ' + p1.y + ', ' + midX + ' ' + p2.y + ', ' + p2.x + ' ' + p2.y);
        path.setAttribute('class', 'wfd-edge');
        path.setAttribute('fill', 'none');
        path.setAttribute('marker-end', 'url(#wfdArrow)');
        svg.appendChild(path);
        if (c.label || (c.outcome_key && c.outcome_key !== 'default')) {
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', String(midX));
          text.setAttribute('y', String((p1.y + p2.y) / 2 - 8));
          text.setAttribute('class', 'wfd-edge-label');
          text.setAttribute('text-anchor', 'middle');
          text.textContent = c.label || c.outcome_key;
          svg.appendChild(text);
        }
      });

      if (preview && preview.from && preview.to) {
        const midX = (preview.from.x + preview.to.x) / 2;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute(
          'd',
          'M ' + preview.from.x + ' ' + preview.from.y + ' C ' + midX + ' ' + preview.from.y + ', ' + midX + ' ' + preview.to.y + ', ' + preview.to.x + ' ' + preview.to.y
        );
        path.setAttribute('class', 'wfd-edge wfd-edge-preview');
        path.setAttribute('fill', 'none');
        svg.appendChild(path);
      }
    }

    function paintMinimap() {
      const mm = rootEl.querySelector('.wfd-minimap-svg');
      const canvas = rootEl.querySelector('.wfd-canvas');
      if (!mm || !canvas) return;
      while (mm.firstChild) mm.removeChild(mm.firstChild);
      const b = graphBounds(graph);
      const pad = 40;
      const w = Math.max(1, b.maxX - b.minX + pad * 2);
      const h = Math.max(1, b.maxY - b.minY + pad * 2);
      mm.setAttribute('viewBox', b.minX - pad + ' ' + (b.minY - pad) + ' ' + w + ' ' + h);
      graph.nodes.forEach((n) => {
        const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        r.setAttribute('x', String(n.x));
        r.setAttribute('y', String(n.y));
        r.setAttribute('width', String(NODE_W));
        r.setAttribute('height', String(NODE_H));
        r.setAttribute('class', 'wfd-mm-node' + (n.key === selectedKey ? ' is-selected' : '') + (isStartType(n.type) ? ' is-start' : '') + (isTerminalType(n.type) ? ' is-end' : ''));
        r.setAttribute('rx', '4');
        mm.appendChild(r);
      });
      const vw = canvas.clientWidth / zoom;
      const vh = canvas.clientHeight / zoom;
      const vx = -panX / zoom;
      const vy = -panY / zoom;
      const vp = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      vp.setAttribute('x', String(vx));
      vp.setAttribute('y', String(vy));
      vp.setAttribute('width', String(vw));
      vp.setAttribute('height', String(vh));
      vp.setAttribute('class', 'wfd-mm-viewport');
      mm.appendChild(vp);
    }

    function buildLibrary(aside) {
      aside.innerHTML = '';
      aside.appendChild(el('div', { className: 'wfd-panel-head' }, [el('strong', { text: 'Node library' })]));
      const search = el('input', {
        type: 'search',
        className: 'cfg-input wfd-search',
        placeholder: 'Search nodes…',
        'aria-label': 'Search nodes',
      });
      aside.appendChild(search);
      const list = el('div', { className: 'wfd-library-list' });
      aside.appendChild(list);

      function redrawLib() {
        list.innerHTML = '';
        const q = search.value.trim().toLowerCase();
        const byCat = {};
        CATEGORY_ORDER.forEach((c) => (byCat[c] = []));
        nodeTypes.forEach((n) => {
          const cat = uiCategory(n);
          if (!byCat[cat]) byCat[cat] = [];
          if (q && !(n.label || '').toLowerCase().includes(q) && !(n.type || '').toLowerCase().includes(q) && !cat.toLowerCase().includes(q)) return;
          byCat[cat].push(n);
        });
        if (recentTypes.length && !q) {
          list.appendChild(el('div', { className: 'wfd-cat-label', text: 'Recently used' }));
          recentTypes.forEach((t) => {
            const meta = catalogByType[t];
            if (meta) list.appendChild(libItem(meta));
          });
        }
        CATEGORY_ORDER.forEach((cat) => {
          const items = byCat[cat] || [];
          if (!items.length) return;
          list.appendChild(el('div', { className: 'wfd-cat-label', text: cat }));
          items.forEach((n) => list.appendChild(libItem(n)));
        });
      }

      function libItem(n) {
        const cat = uiCategory(n);
        const btn = el('button', {
          type: 'button',
          className: 'wfd-lib-item',
          disabled: readOnly ? 'disabled' : null,
          title: n.type,
          onclick: () => addNode(n.type),
        });
        btn.appendChild(el('span', { className: 'wfd-lib-icon', text: CATEGORY_ICON[cat] || '•' }));
        const text = el('span', { className: 'wfd-lib-text' });
        text.appendChild(el('strong', { text: n.label }));
        text.appendChild(el('span', { text: cat }));
        btn.appendChild(text);
        if (!readOnly) {
          btn.draggable = true;
          btn.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('application/wos-node-type', n.type);
            e.dataTransfer.effectAllowed = 'copy';
          });
        }
        return btn;
      }
      search.addEventListener('input', redrawLib);
      redrawLib();
    }

    function buildInspector(aside) {
      aside.innerHTML = '';
      aside.appendChild(el('div', { className: 'wfd-panel-head' }, [el('strong', { text: 'Node inspector' })]));
      const selected = graph.nodes.find((n) => n.key === selectedKey);
      if (!selected) {
        aside.appendChild(el('p', { className: 'cfg-hint', text: 'Select a node to configure its behavior.' }));
        return;
      }
      const meta = catalogByType[selected.type] || {};
      const tabs = el('div', { className: 'wfd-tabs', role: 'tablist' });
      const panes = { General: el('div', { className: 'wfd-tab-pane' }), Assignment: el('div', { className: 'wfd-tab-pane' }), Advanced: el('div', { className: 'wfd-tab-pane' }) };
      let active = 'General';
      if (isHumanType(selected.type)) active = 'Assignment';

      function showTab(name) {
        active = name;
        Object.keys(panes).forEach((k) => {
          panes[k].hidden = k !== name;
        });
        tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === name));
      }

      ['General', 'Assignment', 'Advanced'].forEach((name) => {
        if (name === 'Assignment' && !isHumanType(selected.type)) return;
        tabs.appendChild(
          el('button', {
            type: 'button',
            className: 'wfd-tab' + (name === active ? ' is-active' : ''),
            'data-tab': name,
            text: name,
            onclick: () => showTab(name),
          })
        );
      });
      aside.appendChild(tabs);

      // General
      panes.General.appendChild(el('label', { text: 'Node name' }));
      const nameInput = el('input', {
        type: 'text',
        className: 'cfg-input',
        value: selected.name || '',
        disabled: readOnly ? 'disabled' : null,
        'aria-label': 'Node name',
      });
      nameInput.addEventListener('input', () => {
        selected.name = nameInput.value;
        emitDirty();
        const title = rootEl.querySelector('.wfd-node[data-node-key="' + selected.key + '"] .wfd-node-title');
        if (title) title.textContent = selected.name;
      });
      panes.General.appendChild(nameInput);
      panes.General.appendChild(el('label', { text: 'Description' }));
      const desc = el('textarea', {
        className: 'cfg-json',
        rows: '2',
        disabled: readOnly ? 'disabled' : null,
        'aria-label': 'Description',
      });
      desc.value = (selected.config && selected.config.description) || '';
      desc.addEventListener('input', () => {
        selected.config.description = desc.value;
        emitDirty();
      });
      panes.General.appendChild(desc);
      panes.General.appendChild(el('div', { className: 'cfg-hint', text: 'Type: ' + (meta.label || selected.type) }));

      if (selected.type === 'logic.condition' || selected.type === 'logic.multi_branch') {
        panes.General.appendChild(el('h5', { text: 'Branch labels' }));
        const outs = (selected.config.outcomes = selected.config.outcomes || [
          { key: 'yes', label: 'Yes' },
          { key: 'no', label: 'No' },
        ]);
        outs.forEach((o, i) => {
          const row = el('div', { className: 'wfd-branch-row' });
          const inp = el('input', {
            type: 'text',
            className: 'cfg-input',
            value: o.label || o.key,
            disabled: readOnly ? 'disabled' : null,
            'aria-label': 'Branch ' + (i + 1),
          });
          inp.addEventListener('input', () => {
            o.label = inp.value;
            emitDirty();
            render();
          });
          row.appendChild(inp);
          panes.General.appendChild(row);
        });
      }

      // Assignment (mode-specific)
      if (isHumanType(selected.type)) {
        panes.Assignment.appendChild(el('label', { text: 'Who should complete this step?' }));
        const mode = el('select', { className: 'cfg-input', 'aria-label': 'Assignment mode', disabled: readOnly ? 'disabled' : null });
        [
          ['specific_user', 'Specific user'],
          ['role', 'Role or shared queue'],
          ['request_creator', 'Request creator'],
          ['request_creator_manager', "Request creator's manager"],
          ['form_user_field', 'User from form field'],
          ['previous_participant', 'Previous participant'],
          ['client_representative', 'Client representative'],
          ['external_participant', 'External participant'],
        ].forEach(([v, t]) => mode.appendChild(el('option', { value: v, text: t })));
        const asg = selected.config.assignment || {};
        mode.value = asg.mode || 'role';
        panes.Assignment.appendChild(mode);

        const fields = el('div', { className: 'wfd-assign-fields' });
        panes.Assignment.appendChild(fields);
        const preview = el('div', { className: 'cfg-assign-preview', 'aria-live': 'polite' });
        panes.Assignment.appendChild(preview);

        function persistAssignment() {
          selected.config.assignment = selected.config.assignment || {};
          emitDirty();
          const sum = rootEl.querySelector('.wfd-node[data-node-key="' + selected.key + '"] .wfd-node-assign');
          if (sum) sum.textContent = assignmentSummary(selected, opts.roles, opts.users);
        }

        function redrawAssign() {
          fields.innerHTML = '';
          const m = mode.value;
          selected.config.assignment = selected.config.assignment || {};
          selected.config.assignment.mode = m;

          if (m === 'specific_user') {
            fields.appendChild(el('label', { text: 'User' }));
            const userSel = el('select', { className: 'cfg-input', 'aria-label': 'User', disabled: readOnly ? 'disabled' : null });
            userSel.appendChild(el('option', { value: '', text: 'Searchable user…' }));
            (opts.users || []).slice(0, 300).forEach((u) => {
              if (u.active === false || u.status === 'inactive') return;
              userSel.appendChild(
                el('option', {
                  value: String(u.id || u.email),
                  text: (u.name || u.display_name || u.email || '') + (u.email ? ' · ' + u.email : ''),
                })
              );
            });
            if (asg.user_id) userSel.value = String(asg.user_id);
            userSel.addEventListener('change', () => {
              selected.config.assignment.user_id = userSel.value || null;
              selected.config.assignment.role_key = null;
              selected.config.assignment.form_field_key = null;
              persistAssignment();
              updatePreview();
            });
            fields.appendChild(userSel);
          } else if (m === 'role') {
            fields.appendChild(el('label', { text: 'Role or shared queue' }));
            const roleSel = el('select', { className: 'cfg-input', 'aria-label': 'Role', disabled: readOnly ? 'disabled' : null });
            roleSel.appendChild(el('option', { value: '', text: 'Select role…' }));
            (opts.roles || [])
              .filter((r) => {
                const key = r.key || r.id || r.role_key;
                return key && key !== 'requester';
              })
              .forEach((r) => {
                const key = r.key || r.id || r.role_key;
                roleSel.appendChild(el('option', { value: key, text: r.name || r.label || key }));
              });
            roleSel.value = asg.role_key || '';
            roleSel.addEventListener('change', () => {
              selected.config.assignment.role_key = roleSel.value || null;
              selected.config.assignee_role = roleSel.value || null;
              selected.config.assignment.user_id = null;
              persistAssignment();
              updatePreview();
            });
            fields.appendChild(roleSel);
            fields.appendChild(el('label', { text: 'Strategy' }));
            const strat = el('select', { className: 'cfg-input', 'aria-label': 'Strategy', disabled: readOnly ? 'disabled' : null });
            [
              ['shared_queue', 'Shared queue'],
              ['round_robin', 'Round robin'],
              ['first_available', 'First available'],
            ].forEach(([v, t]) => strat.appendChild(el('option', { value: v, text: t })));
            strat.value = asg.strategy || 'shared_queue';
            strat.addEventListener('change', () => {
              selected.config.assignment.strategy = strat.value;
              persistAssignment();
              updatePreview();
            });
            fields.appendChild(strat);
          } else if (m === 'form_user_field' || m === 'external_participant') {
            fields.appendChild(el('label', { text: m === 'external_participant' ? 'Email field mapping' : 'User field key' }));
            const fieldInput = el('input', {
              type: 'text',
              className: 'cfg-input',
              value: asg.form_field_key || '',
              placeholder: 'contact_email',
              disabled: readOnly ? 'disabled' : null,
              'aria-label': 'Form field key',
            });
            fieldInput.addEventListener('input', () => {
              selected.config.assignment.form_field_key = fieldInput.value || null;
              persistAssignment();
              updatePreview();
            });
            fields.appendChild(fieldInput);
            if (m === 'external_participant') {
              fields.appendChild(el('p', { className: 'cfg-hint', text: 'Resolved after the form is completed. Secure link expiration uses organization defaults.' }));
            }
          } else if (m === 'request_creator_manager' || m === 'previous_participant' || m === 'client_representative') {
            fields.appendChild(
              el('p', {
                className: 'cfg-hint',
                text: 'Resolved at runtime from request context. Preview will remain pending until a live request exists.',
              })
            );
          } else if (m === 'request_creator') {
            fields.appendChild(el('p', { className: 'cfg-hint', text: 'Assigns the person who created the request. This is not an RBAC role.' }));
          }

          fields.appendChild(el('label', { text: 'Fallback' }));
          const fallback = el('select', { className: 'cfg-input', 'aria-label': 'Fallback', disabled: readOnly ? 'disabled' : null });
          [
            ['hub_admin', 'Route to Hub Admin'],
            ['pause', 'Pause with assignment error'],
            ['request_creator', 'Assign to request creator'],
            ['fallback_role', 'Fallback role'],
          ].forEach(([v, t]) => fallback.appendChild(el('option', { value: v, text: t })));
          fallback.value = asg.fallback || 'hub_admin';
          fallback.addEventListener('change', () => {
            selected.config.assignment.fallback = fallback.value;
            persistAssignment();
            updatePreview();
          });
          fields.appendChild(fallback);
          updatePreview();
        }

        function updatePreview() {
          const a = selected.config.assignment || {};
          const lines = ['Assignment preview', '', 'Mode', mode.options[mode.selectedIndex].text, ''];
          if (a.mode === 'role') {
            const roleKey = a.role_key || '—';
            const role = (opts.roles || []).find((r) => (r.key || r.id || r.role_key) === roleKey);
            lines.push('Role', (role && (role.name || role.label)) || roleKey, '');
            const match = (opts.users || []).filter((u) => {
              if (u.active === false || u.status === 'inactive') return false;
              const roles = u.roles || u.role_keys || [];
              return Array.isArray(roles) && roles.includes(roleKey);
            });
            lines.push('Active eligible users', String(match.length));
            if (match.length) {
              match.slice(0, 8).forEach((u) => lines.push(u.name || u.display_name || u.email));
            } else if (roleKey && roleKey !== '—') {
              lines.push('No active users currently have this role.');
              lines.push('Choose another assignment or configure a fallback.');
            }
          } else if (a.mode === 'specific_user') {
            const u = (opts.users || []).find((x) => String(x.id || x.email) === String(a.user_id));
            lines.push('User', u ? (u.name || u.display_name || u.email) : a.user_id || '—');
            if (u) lines.push(u.email || '', u.active === false ? 'Inactive' : 'Active');
          } else if (a.mode === 'request_creator') {
            lines.push('Resolved from', 'Request creator at runtime');
          } else if (a.mode === 'form_user_field' || a.mode === 'external_participant') {
            lines.push('Form field', a.form_field_key || '—');
            lines.push('Runtime resolution pending until the form is submitted.');
          } else {
            lines.push('Runtime resolution pending', 'Depends on request context.');
          }
          lines.push('', 'Fallback', a.fallback || 'hub_admin');
          preview.textContent = lines.join('\n');
        }

        mode.addEventListener('change', () => {
          persistAssignment();
          redrawAssign();
        });
        redrawAssign();
      }

      // Advanced
      panes.Advanced.appendChild(el('label', { text: 'Node key' }));
      panes.Advanced.appendChild(el('input', { type: 'text', className: 'cfg-input', value: selected.key, disabled: 'disabled' }));
      if (!readOnly) {
        panes.Advanced.appendChild(
          el('button', {
            type: 'button',
            className: 'hub-btn hub-btn-sm',
            text: 'Remove node',
            onclick: async () => {
              const modal = root.streamlineModal;
              const ok = modal
                ? await modal.confirm({
                    title: 'Remove node?',
                    body: 'This removes the node and its connections from the draft.',
                    confirmLabel: 'Remove',
                    cancelLabel: 'Cancel',
                    danger: true,
                  })
                : true;
              if (ok) removeNode(selected.key);
            },
          })
        );
      }

      const conns = graph.connections.filter((c) => c.source === selected.key || c.target === selected.key);
      if (conns.length) {
        panes.Advanced.appendChild(el('h5', { text: 'Connections' }));
        const ul = el('ul', { className: 'cfg-conn-list' });
        conns.forEach((c) => {
          const li = el('li', { text: c.source + ' → ' + c.target + (c.label ? ' (' + c.label + ')' : '') });
          if (!readOnly) {
            li.appendChild(
              el('button', {
                type: 'button',
                className: 'hub-link-btn',
                text: 'Remove',
                onclick: async () => {
                  const modal = root.streamlineModal;
                  const ok = modal
                    ? await modal.confirm({
                        title: 'Remove connection?',
                        body: 'This disconnects the two nodes in the draft.',
                        confirmLabel: 'Remove',
                        cancelLabel: 'Cancel',
                      })
                    : true;
                  if (ok) removeConnection(c.key);
                },
              })
            );
          }
          ul.appendChild(li);
        });
        panes.Advanced.appendChild(ul);
      }

      Object.keys(panes).forEach((k) => aside.appendChild(panes[k]));
      showTab(active);
    }

    function buildOutline(box) {
      box.innerHTML = '';
      box.appendChild(el('strong', { text: 'Outline' }));
      const start = graph.nodes.find((n) => isStartType(n.type));
      if (!start) {
        box.appendChild(el('p', { className: 'cfg-hint', text: 'No start node yet.' }));
        return;
      }
      const children = {};
      graph.connections.forEach((c) => {
        if (!children[c.source]) children[c.source] = [];
        children[c.source].push(c);
      });
      const seen = new Set();
      function walk(key, depth) {
        if (seen.has(key) || depth > 20) return;
        seen.add(key);
        const n = graph.nodes.find((x) => x.key === key);
        if (!n) return;
        const row = el('button', {
          type: 'button',
          className: 'wfd-outline-item' + (key === selectedKey ? ' is-selected' : ''),
          style: 'padding-left:' + (8 + depth * 12) + 'px',
          text: n.name || n.key,
          onclick: () => {
            emitSelect(key);
            centerSelection();
          },
        });
        box.appendChild(row);
        (children[key] || []).forEach((c) => walk(c.target, depth + 1));
      }
      walk(start.key, 0);
      const disconnected = graph.nodes.filter((n) => !seen.has(n.key));
      if (disconnected.length) {
        box.appendChild(el('div', { className: 'wfd-outline-warn', text: 'Disconnected' }));
        disconnected.forEach((n) => {
          box.appendChild(
            el('button', {
              type: 'button',
              className: 'wfd-outline-item is-warn',
              text: n.name || n.key,
              onclick: () => emitSelect(n.key),
            })
          );
        });
      }
    }

    function centerSelection() {
      const n = graph.nodes.find((x) => x.key === selectedKey);
      const canvas = rootEl.querySelector('.wfd-canvas');
      if (!n || !canvas) return;
      const vw = canvas.clientWidth;
      const vh = canvas.clientHeight;
      panX = vw / 2 - (n.x + NODE_W / 2) * zoom;
      panY = vh / 2 - (n.y + NODE_H / 2) * zoom;
      applyTransform();
      paintMinimap();
    }

    function render() {
      const scrollLib = libraryCollapsed;
      const scrollIns = inspectorCollapsed;
      rootEl.innerHTML = '';

      const workspace = el('div', { className: 'wfd-workspace' + (scrollLib ? ' lib-collapsed' : '') + (scrollIns ? ' ins-collapsed' : '') });

      // Library
      const lib = el('aside', { className: 'wfd-library', 'aria-label': 'Node library' });
      if (!scrollLib) buildLibrary(lib);
      else lib.appendChild(el('button', { type: 'button', className: 'hub-link-btn', text: 'Library', onclick: () => { libraryCollapsed = false; render(); } }));
      workspace.appendChild(lib);

      // Canvas column
      const mid = el('div', { className: 'wfd-mid' });
      const tools = el('div', { className: 'wfd-canvas-tools' });
      if (!readOnly) {
        tools.appendChild(
          el('button', {
            type: 'button',
            className: 'hub-btn hub-btn-sm',
            text: 'Auto-layout',
            onclick: () => {
              autoLayout(graph);
              emitDirty();
              render();
              fitToView();
            },
          })
        );
      }
      tools.appendChild(el('button', { type: 'button', className: 'hub-btn hub-btn-sm', text: 'Fit workflow', onclick: () => fitToView() }));
      tools.appendChild(el('button', { type: 'button', className: 'hub-btn hub-btn-sm', text: 'Center selection', onclick: () => centerSelection() }));
      tools.appendChild(
        el('button', {
          type: 'button',
          className: 'hub-btn hub-btn-sm',
          text: 'Reset zoom',
          onclick: () => {
            zoom = 1;
            panX = 24;
            panY = 24;
            applyTransform();
            paintMinimap();
          },
        })
      );
      tools.appendChild(
        el('button', {
          type: 'button',
          className: 'hub-link-btn',
          text: libraryCollapsed ? 'Show library' : 'Hide library',
          onclick: () => {
            libraryCollapsed = !libraryCollapsed;
            render();
          },
        })
      );
      tools.appendChild(
        el('button', {
          type: 'button',
          className: 'hub-link-btn',
          text: inspectorCollapsed ? 'Show inspector' : 'Hide inspector',
          onclick: () => {
            inspectorCollapsed = !inspectorCollapsed;
            render();
          },
        })
      );
      tools.appendChild(el('span', { className: 'wfd-zoom-label', text: Math.round(zoom * 100) + '%' }));
      mid.appendChild(tools);

      const canvas = el('div', { className: 'wfd-canvas', tabindex: '0', 'aria-label': 'Workflow canvas' });
      const world = el('div', { className: 'wfd-world' });
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'wfd-svg');
      const b = graphBounds(graph);
      const worldW = Math.max(1200, b.maxX + 200);
      const worldH = Math.max(800, b.maxY + 200);
      svg.setAttribute('width', String(worldW));
      svg.setAttribute('height', String(worldH));
      svg.setAttribute('viewBox', '0 0 ' + worldW + ' ' + worldH);
      world.appendChild(svg);

      if (!graph.nodes.length) {
        const empty = el('div', { className: 'wfd-empty' });
        empty.appendChild(el('h3', { text: 'Build your workflow' }));
        empty.appendChild(el('p', { text: 'Add a trigger to begin, or start from a template.' }));
        const actions = el('div', { className: 'wfd-empty-actions' });
        if (!readOnly) {
          actions.appendChild(
            el('button', {
              type: 'button',
              className: 'hub-btn hub-btn-primary',
              text: 'Add request-created trigger',
              onclick: () => addNode('trigger.request_created', { x: 80, y: 120 }),
            })
          );
          if (typeof opts.onChooseTemplate === 'function') {
            actions.appendChild(
              el('button', {
                type: 'button',
                className: 'hub-btn',
                text: 'Choose template',
                onclick: () => opts.onChooseTemplate(),
              })
            );
          }
        }
        empty.appendChild(actions);
        canvas.appendChild(empty);
      }

      const layer = el('div', { className: 'wfd-nodes', style: 'width:' + worldW + 'px;height:' + worldH + 'px' });
      graph.nodes.forEach((n) => {
        const cat = uiCategory(catalogByType[n.type] || { category: String(n.type).split('.')[0], type: n.type });
        const node = el('div', {
          className:
            'wfd-node wfd-node-' +
            cat.replace(/\s+/g, '-').toLowerCase() +
            (n.key === selectedKey ? ' is-selected' : '') +
            (isStartType(n.type) ? ' is-start' : '') +
            (isTerminalType(n.type) ? ' is-end' : ''),
          'data-node-key': n.key,
          style: 'left:' + n.x + 'px;top:' + n.y + 'px;width:' + NODE_W + 'px',
          tabindex: '0',
          role: 'button',
          'aria-label': (n.name || n.key) + ', ' + cat,
        });
        const head = el('div', { className: 'wfd-node-head' });
        head.appendChild(el('span', { className: 'wfd-node-icon', text: CATEGORY_ICON[cat] || '•', 'aria-hidden': 'true' }));
        head.appendChild(el('strong', { className: 'wfd-node-title', text: n.name || n.key }));
        if (!readOnly) {
          const more = el('button', {
            type: 'button',
            className: 'wfd-node-more',
            text: '⋯',
            'aria-label': 'Node menu',
            onclick: async (e) => {
              e.stopPropagation();
              const modal = root.streamlineModal;
              const ok = modal
                ? await modal.confirm({
                    title: 'Remove node?',
                    body: 'Remove “' + (n.name || n.key) + '” and its connections?',
                    confirmLabel: 'Remove',
                    cancelLabel: 'Cancel',
                    danger: true,
                  })
                : true;
              if (ok) removeNode(n.key);
            },
          });
          head.appendChild(more);
        }
        node.appendChild(head);
        node.appendChild(el('div', { className: 'wfd-node-desc', text: shortDesc(n, catalogByType) }));
        if (isHumanType(n.type)) {
          node.appendChild(el('div', { className: 'wfd-node-assign', text: assignmentSummary(n, opts.roles, opts.users) }));
        }
        nodeHandles(n).forEach((h) => {
          const handle = el('button', {
            type: 'button',
            className: 'wfd-handle wfd-handle-' + h.side,
            'data-handle': h.id,
            'data-side': h.side,
            style: 'top:' + h.y * 100 + '%',
            title: h.label,
            'aria-label': h.label + ' handle',
            text: h.side === 'right' ? h.label : '',
          });
          if (!readOnly) {
            handle.addEventListener('pointerdown', (e) => {
              e.stopPropagation();
              e.preventDefault();
              if (h.side !== 'right') return;
              linking = { source: n.key, handle: h.id, from: handlePoint(n, h.id) };
              canvas.setPointerCapture(e.pointerId);
            });
            handle.addEventListener('pointerup', (e) => {
              if (!linking) return;
              const targetEl = document.elementFromPoint(e.clientX, e.clientY);
              const targetNode = targetEl && targetEl.closest && targetEl.closest('.wfd-node');
              const targetHandle = targetEl && targetEl.closest && targetEl.closest('.wfd-handle-left');
              if (targetNode) {
                const tkey = targetNode.getAttribute('data-node-key');
                const th = targetHandle ? targetHandle.getAttribute('data-handle') : 'in';
                connect(linking.source, linking.handle, tkey, th);
              }
              linking = null;
              paintEdges(svg, null);
            });
          }
          node.appendChild(handle);
        });
        node.addEventListener('click', () => emitSelect(n.key));
        node.addEventListener('keydown', (e) => {
          if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            if (!readOnly) removeNode(n.key);
          }
        });
        if (!readOnly) {
          let dragging = false;
          let ox = 0;
          let oy = 0;
          node.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.wfd-handle') || e.target.closest('.wfd-node-more')) return;
            dragging = true;
            const rect = canvas.getBoundingClientRect();
            ox = (e.clientX - rect.left - panX) / zoom - n.x;
            oy = (e.clientY - rect.top - panY) / zoom - n.y;
            node.setPointerCapture(e.pointerId);
            emitSelect(n.key);
          });
          node.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            const rect = canvas.getBoundingClientRect();
            n.x = Math.max(0, (e.clientX - rect.left - panX) / zoom - ox);
            n.y = Math.max(0, (e.clientY - rect.top - panY) / zoom - oy);
            node.style.left = n.x + 'px';
            node.style.top = n.y + 'px';
            paintEdges(svg, null);
            paintMinimap();
          });
          node.addEventListener('pointerup', () => {
            if (dragging) {
              dragging = false;
              emitDirty();
            }
          });
        }
        layer.appendChild(node);
      });
      world.appendChild(layer);
      canvas.appendChild(world);
      mid.appendChild(canvas);

      const footer = el('div', { className: 'wfd-footer' });
      footer.appendChild(el('span', { text: graph.nodes.length + ' nodes · ' + graph.connections.length + ' connections' }));
      if (countStarts(graph) > 1) footer.appendChild(el('span', { className: 'wfd-footer-warn', text: 'Multiple start nodes — only one is allowed' }));
      mid.appendChild(footer);

      const mmWrap = el('div', { className: 'wfd-minimap', 'aria-label': 'Minimap' });
      const mmSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      mmSvg.setAttribute('class', 'wfd-minimap-svg');
      mmWrap.appendChild(mmSvg);
      mid.appendChild(mmWrap);

      if (outlineOpen) {
        const outline = el('div', { className: 'wfd-outline' });
        buildOutline(outline);
        mid.appendChild(outline);
      }

      workspace.appendChild(mid);

      const ins = el('aside', { className: 'wfd-inspector', 'aria-label': 'Node inspector' });
      if (!scrollIns) buildInspector(ins);
      else ins.appendChild(el('button', { type: 'button', className: 'hub-link-btn', text: 'Inspector', onclick: () => { inspectorCollapsed = false; render(); } }));
      workspace.appendChild(ins);

      rootEl.appendChild(workspace);
      paintEdges(svg, null);
      applyTransform();
      paintMinimap();

      // Pan / zoom
      let panning = false;
      let panOx = 0;
      let panOy = 0;
      canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.92 : 1.08;
        zoom = Math.max(0.35, Math.min(1.8, zoom * delta));
        applyTransform();
        paintMinimap();
      }, { passive: false });
      canvas.addEventListener('pointerdown', (e) => {
        if (e.button === 1 || e.shiftKey || e.target === canvas || e.target === world || e.target === svg) {
          panning = true;
          panOx = e.clientX - panX;
          panOy = e.clientY - panY;
          canvas.setPointerCapture(e.pointerId);
        }
      });
      canvas.addEventListener('pointermove', (e) => {
        if (linking) {
          const rect = canvas.getBoundingClientRect();
          const to = {
            x: (e.clientX - rect.left - panX) / zoom,
            y: (e.clientY - rect.top - panY) / zoom,
          };
          paintEdges(svg, { from: linking.from, to });
          return;
        }
        if (!panning) return;
        panX = e.clientX - panOx;
        panY = e.clientY - panOy;
        applyTransform();
        paintMinimap();
      });
      canvas.addEventListener('pointerup', () => {
        panning = false;
        if (linking) {
          linking = null;
          paintEdges(svg, null);
        }
      });
      canvas.addEventListener('dragover', (e) => {
        if (readOnly) return;
        e.preventDefault();
      });
      canvas.addEventListener('drop', (e) => {
        if (readOnly) return;
        e.preventDefault();
        const type = e.dataTransfer.getData('application/wos-node-type');
        if (!type) return;
        const rect = canvas.getBoundingClientRect();
        addNode(type, {
          x: (e.clientX - rect.left - panX) / zoom - NODE_W / 2,
          y: (e.clientY - rect.top - panY) / zoom - NODE_H / 2,
        });
      });

      if (readOnly || opts.autoFit) {
        requestAnimationFrame(() => fitToView());
      }
    }

    render();

    return {
      getGraph: () => graph,
      fitToView,
      autoLayout: () => {
        autoLayout(graph);
        emitDirty();
        render();
        fitToView();
      },
      select: emitSelect,
      refresh: render,
    };
  }

  function blocksToHtml(blocks) {
    return (blocks || [])
      .map((b) => {
        if (b.type === 'heading') return '<h2>' + esc(b.text || '') + '</h2>';
        if (b.type === 'paragraph') return '<p>' + esc(b.text || '').replace(/\n/g, '<br>') + '</p>';
        if (b.type === 'list') {
          const items = (b.items || String(b.text || '').split('\n')).filter(Boolean);
          return '<ul>' + items.map((i) => '<li>' + esc(i) + '</li>').join('') + '</ul>';
        }
        if (b.type === 'divider') return '<hr>';
        if (b.type === 'variable') return '<p><mark class="cfg-var-token">{{' + esc(b.key || b.text || '') + '}}</mark></p>';
        if (b.type === 'signature') return '<div class="cfg-doc-sig">Signature: ______________________</div>';
        if (b.type === 'initial') return '<div class="cfg-doc-sig">Initials: ______</div>';
        if (b.type === 'acknowledgement') return '<div class="cfg-doc-sig">☐ I acknowledge</div>';
        if (b.type === 'table') return '<table class="cfg-doc-table"><tr><td>' + esc(b.text || 'Cell') + '</td><td></td></tr></table>';
        if (b.type === 'conditional') return '<div class="cfg-doc-cond">[If ' + esc(b.condition || 'condition') + '] ' + esc(b.text || '') + '</div>';
        return '<p>' + esc(b.text || '') + '</p>';
      })
      .join('\n');
  }

  function renderPreviewHtml(html, sampleMode) {
    return String(html || '').replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, k) => {
      if (sampleMode && SAMPLE_VARS[k]) return '<mark class="cfg-var-token is-sample">' + esc(SAMPLE_VARS[k]) + '</mark>';
      if (sampleMode) return '<mark class="cfg-var-token is-unresolved">{{' + esc(k) + '}}</mark>';
      return '<mark class="cfg-var-token">{{' + esc(k) + '}}</mark>';
    });
  }

  root.HubWorkflowDesigner = {
    mount,
    autoLayout,
    ensureGraph,
    slugifyKey,
    isStartType,
    isTerminalType,
    isHumanType,
    nodeHandles,
    handlePoint,
    countStarts,
    graphBounds,
    blocksToHtml,
    renderPreviewHtml,
    SAMPLE_VARS,
    CATEGORY_ORDER,
    NODE_W,
    NODE_H,
    _test: {
      slugifyKey,
      handlePoint,
      autoLayout,
      countStarts,
      isStartType,
    },
  };
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : typeof global !== 'undefined' ? global : this);
