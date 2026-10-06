/**
 * WOS-100 — Simplified vertical workflow builder.
 * Users add/reorder/configure steps; WOS builds the runtime graph internally.
 * No freeform canvas, handles, or edge drawing.
 */
(function (global) {
  'use strict';

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'className') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'disabled' && v) node.disabled = true;
        else node.setAttribute(k, v === true ? '' : String(v));
      });
    }
    (children || []).forEach((c) => {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  const SIMPLE_TYPES = [
    {
      id: 'start',
      label: 'Start',
      description: 'Workflow trigger',
      icon: '▶',
      color: 'start',
      runtimeType: 'trigger.request_created',
      isStart: true,
    },
    {
      id: 'form',
      label: 'Form / Document',
      description: 'Fill a form or generate a document',
      icon: '📄',
      color: 'form',
      runtimeType: 'human.fill',
    },
    {
      id: 'review',
      label: 'Review',
      description: 'Human review step',
      icon: '👁',
      color: 'review',
      runtimeType: 'human.review',
    },
    {
      id: 'approval',
      label: 'Approval',
      description: 'Approve or reject',
      icon: '✓',
      color: 'approval',
      runtimeType: 'human.approve',
    },
    {
      id: 'sign',
      label: 'Sign',
      description: 'Internal or external signature',
      icon: '✍',
      color: 'sign',
      runtimeType: 'human.sign',
    },
    {
      id: 'condition',
      label: 'Condition',
      description: 'Yes / No branch',
      icon: '◇',
      color: 'condition',
      runtimeType: 'logic.condition',
      isCondition: true,
    },
    {
      id: 'notification',
      label: 'Notification',
      description: 'In-app notification',
      icon: '🔔',
      color: 'notify',
      runtimeType: 'notify.in_app',
    },
    {
      id: 'integration',
      label: 'Integration',
      description: 'Emit automation event',
      icon: '↗',
      color: 'integration',
      runtimeType: 'integration.automation_webhook',
    },
    {
      id: 'update_vendor',
      label: 'Update Vendor',
      description: 'Write NDA/MSA status',
      icon: '🏷',
      color: 'system',
      runtimeType: 'logic.update_vendor',
    },
    {
      id: 'end',
      label: 'End',
      description: 'Complete the workflow',
      icon: '■',
      color: 'end',
      runtimeType: 'terminal.complete',
      isTerminal: true,
    },
  ];

  const BY_SIMPLE = Object.fromEntries(SIMPLE_TYPES.map((t) => [t.id, t]));
  const BY_RUNTIME = {};
  SIMPLE_TYPES.forEach((t) => {
    BY_RUNTIME[t.runtimeType] = t;
  });
  BY_RUNTIME['trigger.vendor_request_submitted'] = BY_SIMPLE.start;
  BY_RUNTIME['trigger.request_submitted'] = BY_SIMPLE.start;
  BY_RUNTIME['trigger.form_submitted'] = BY_SIMPLE.start;
  BY_RUNTIME['document.generate'] = Object.assign({}, BY_SIMPLE.form, {
    id: 'generate',
    label: 'Generate Document',
    runtimeType: 'document.generate',
  });
  BY_RUNTIME['terminal.reject'] = Object.assign({}, BY_SIMPLE.end, {
    id: 'reject',
    label: 'Reject / End',
    runtimeType: 'terminal.reject',
  });
  BY_RUNTIME['terminal.cancel'] = BY_RUNTIME['terminal.reject'];
  BY_RUNTIME['human.upload'] = BY_SIMPLE.form;
  BY_RUNTIME['human.provide_info'] = BY_SIMPLE.form;
  BY_RUNTIME['logic.update_request'] = BY_SIMPLE.update_vendor;

  const CONDITION_VARS = [
    'vendor.nda_required',
    'vendor.msa_required',
    'vendor.nda_status',
    'vendor.msa_status',
    'vendor.vendor_ref',
    'vendor.company_name',
    'form.nda_required',
    'form.msa_required',
    'form.legal_approved',
    'request.priority',
    'request.status',
  ];

  function slugifyKey(name) {
    return String(name || 'step')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40) || 'step';
  }

  function uniqueKey(base, used) {
    let k = base || 'step';
    let i = 1;
    while (used.has(k)) {
      k = base + '_' + i;
      i += 1;
    }
    used.add(k);
    return k;
  }

  function isStartType(type) {
    return String(type || '').startsWith('trigger.');
  }
  function isTerminalType(type) {
    return String(type || '').startsWith('terminal.');
  }
  function isConditionType(type) {
    return type === 'logic.condition' || type === 'logic.multi_branch';
  }
  function isHumanType(type) {
    return String(type || '').startsWith('human.');
  }

  function simpleIdForRuntime(type) {
    if (BY_RUNTIME[type]) return BY_RUNTIME[type].id;
    if (isStartType(type)) return 'start';
    if (isTerminalType(type)) return 'end';
    if (isConditionType(type)) return 'condition';
    if (type === 'document.generate') return 'form';
    if (isHumanType(type)) return 'review';
    return 'form';
  }

  function defaultAssignment(roleKey) {
    return {
      mode: roleKey ? 'role' : 'request_creator',
      user_id: null,
      user_email: null,
      role_key: roleKey || null,
      form_field_key: null,
      strategy: 'shared_queue',
      fallback: 'hub_admin',
    };
  }

  function defaultConfigForSimple(simpleId) {
    if (simpleId === 'condition') {
      return {
        outcomes: [
          { key: 'yes', label: 'Yes' },
          { key: 'no', label: 'No' },
        ],
        condition: {
          all: [
            {
              left: { type: 'variable', key: 'vendor.nda_required' },
              operator: 'is_true',
              right: { type: 'literal', value: true },
            },
          ],
        },
      };
    }
    if (simpleId === 'update_vendor') {
      return {
        vendor_ref_source: 'vendor.vendor_ref',
        field: 'nda_status',
        value: 'approved',
        audit_note: 'Updated via workflow',
      };
    }
    if (['form', 'review', 'approval', 'sign'].indexOf(simpleId) >= 0) {
      const role =
        simpleId === 'approval' || simpleId === 'review' ? 'manager' : simpleId === 'sign' ? 'legal' : null;
      return { assignment: defaultAssignment(role) };
    }
    if (simpleId === 'notification') {
      return { title: 'Workflow notification', message: 'A workflow step needs attention.', audience: 'assignee' };
    }
    if (simpleId === 'integration') {
      return { event: 'workflow.step.completed' };
    }
    if (simpleId === 'start') {
      return {};
    }
    return {};
  }

  function defaultName(simpleId) {
    return (BY_SIMPLE[simpleId] && BY_SIMPLE[simpleId].label) || 'Step';
  }

  function ensureGraph(graph) {
    const g = graph && typeof graph === 'object' ? graph : {};
    if (!Array.isArray(g.nodes)) g.nodes = [];
    if (!Array.isArray(g.connections)) g.connections = [];
    g.nodes.forEach((n) => {
      if (!n.config) n.config = {};
      if (typeof n.x !== 'number') n.x = 80;
      if (typeof n.y !== 'number') n.y = 40;
      if (isHumanType(n.type) && !n.config.assignment) {
        n.config.assignment = defaultAssignment(n.config.assignee_role || null);
      }
      if (isConditionType(n.type)) {
        n.config.outcomes = n.config.outcomes || [
          { key: 'yes', label: 'Yes' },
          { key: 'no', label: 'No' },
        ];
        n.config.condition = n.config.condition || defaultConfigForSimple('condition').condition;
      }
    });
    return g;
  }

  function outgoing(connections, key, outcome) {
    return (connections || [])
      .filter((c) => c.source === key)
      .filter((c) => {
        if (!outcome) return true;
        return c.outcome_key === outcome || c.source_handle === outcome || c.label === outcome;
      })
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }

  function primaryOut(node, connections) {
    const list = outgoing(connections, node.key);
    if (!list.length) return null;
    if (isConditionType(node.type)) return null;
    const preferred = ['default', 'out', 'signed', 'approved'];
    for (let i = 0; i < preferred.length; i++) {
      const hit = list.find((c) => c.outcome_key === preferred[i] || c.source_handle === preferred[i]);
      if (hit) return hit;
    }
    return list[0];
  }

  function reachable(fromKey, byKey, connections, limit) {
    const out = new Set();
    const queue = [fromKey];
    let guard = 0;
    const max = limit || 200;
    while (queue.length && guard < max) {
      guard += 1;
      const k = queue.shift();
      if (!k || out.has(k) || !byKey[k]) continue;
      out.add(k);
      outgoing(connections, k).forEach((c) => queue.push(c.target));
    }
    return out;
  }

  function nodeToStep(node) {
    return {
      key: node.key,
      type: node.type,
      simpleId: simpleIdForRuntime(node.type),
      name: node.name || node.key,
      config: JSON.parse(JSON.stringify(node.config || {})),
      branches: null,
    };
  }

  /**
   * Convert runtime graph → simplified vertical model (spine + condition branches).
   */
  function graphToModel(graph) {
    const g = ensureGraph(JSON.parse(JSON.stringify(graph || { nodes: [], connections: [] })));
    const byKey = Object.fromEntries(g.nodes.map((n) => [n.key, n]));
    const start = g.nodes.find((n) => isStartType(n.type)) || g.nodes[0];
    if (!start) return { spine: [] };

    const visited = new Set();

    function collectBranch(startKey, stopSet) {
      const steps = [];
      let cur = startKey;
      while (cur && byKey[cur] && !(stopSet && stopSet.has(cur))) {
        if (visited.has(cur) && !isConditionType(byKey[cur].type)) break;
        const node = byKey[cur];
        if (isConditionType(node.type)) {
          steps.push(expandCondition(node));
          break;
        }
        visited.add(cur);
        steps.push(nodeToStep(node));
        if (isTerminalType(node.type)) break;
        const edge = primaryOut(node, g.connections);
        cur = edge ? edge.target : null;
      }
      return steps;
    }

    function expandCondition(node) {
      visited.add(node.key);
      const yesEdge = outgoing(g.connections, node.key, 'yes')[0];
      const noEdge = outgoing(g.connections, node.key, 'no')[0];
      const yesStart = yesEdge && yesEdge.target;
      const noStart = noEdge && noEdge.target;
      let joinKey = null;
      if (yesStart && noStart) {
        const yR = reachable(yesStart, byKey, g.connections);
        const nR = reachable(noStart, byKey, g.connections);
        const shared = [];
        yR.forEach((k) => {
          if (nR.has(k) && k !== node.key) shared.push(k);
        });
        // Prefer non-terminal join closest to starts (first shared in yes BFS order)
        const yesOrder = Array.from(yR);
        joinKey = yesOrder.find((k) => shared.indexOf(k) >= 0 && !isTerminalType(byKey[k].type)) || null;
      }
      const stop = joinKey ? new Set([joinKey]) : null;
      const yesSteps = yesStart ? collectBranch(yesStart, stop) : [];
      const noSteps = noStart ? collectBranch(noStart, stop) : [];
      const step = nodeToStep(node);
      step.branches = { yes: yesSteps, no: noSteps };
      step._joinKey = joinKey;
      return step;
    }

    const spine = [];
    let cur = start.key;
    while (cur && byKey[cur]) {
      if (visited.has(cur) && !isConditionType(byKey[cur].type)) break;
      const node = byKey[cur];
      if (isConditionType(node.type)) {
        const condStep = expandCondition(node);
        spine.push(condStep);
        if (condStep._joinKey) {
          cur = condStep._joinKey;
          continue;
        }
        break;
      }
      visited.add(cur);
      spine.push(nodeToStep(node));
      if (isTerminalType(node.type)) break;
      const edge = primaryOut(node, g.connections);
      cur = edge ? edge.target : null;
    }

    // Orphans (not visited) — append as disconnected end notes are skipped; they remain in raw graph
    // until next save from simplified model (full replace).
    return { spine };
  }

  /**
   * Convert simplified model → runtime graph with auto layout.
   */
  function modelToGraph(model) {
    const nodes = [];
    const connections = [];
    const used = new Set();
    let y = 40;
    const X_MAIN = 280;
    const X_YES = 80;
    const X_NO = 520;
    let connSeq = 0;

    function addNode(step, x, yPos) {
      const key = uniqueKey(step.key || slugifyKey(step.name), used);
      const type = step.type || (BY_SIMPLE[step.simpleId] && BY_SIMPLE[step.simpleId].runtimeType) || 'human.fill';
      const node = {
        key,
        type,
        name: step.name || defaultName(step.simpleId),
        x: x,
        y: yPos,
        config: step.config && typeof step.config === 'object' ? JSON.parse(JSON.stringify(step.config)) : {},
      };
      if (isHumanType(node.type) && !node.config.assignment) {
        node.config.assignment = defaultAssignment(null);
      }
      if (isConditionType(node.type)) {
        node.config.outcomes = node.config.outcomes || [
          { key: 'yes', label: 'Yes' },
          { key: 'no', label: 'No' },
        ];
        node.config.condition = node.config.condition || defaultConfigForSimple('condition').condition;
      }
      nodes.push(node);
      return node;
    }

    function connect(source, target, handle, label, sort) {
      if (!source || !target) return;
      connSeq += 1;
      const outcome = handle === 'out' ? 'default' : handle;
      connections.push({
        key: 'c_' + connSeq,
        source: source.key,
        target: target.key,
        source_handle: handle,
        target_handle: 'in',
        label: label || '',
        outcome_key: outcome,
        sort_order: sort == null ? 0 : sort,
      });
    }

    function outcomeHandleFor(node) {
      if (isConditionType(node.type)) return 'out';
      if (node.type === 'human.approve' || node.type === 'human.review') return 'approved';
      if (node.type === 'human.sign') return 'signed';
      return 'out';
    }

    function emitSequence(steps, xStart, prevNode, prevHandle) {
      let prev = prevNode;
      let handle = prevHandle || 'out';
      let localY = y;
      (steps || []).forEach((step, idx) => {
        if (step.branches) {
          const cond = addNode(step, X_MAIN, localY);
          localY += 110;
          if (prev) connect(prev, cond, handle, '', 0);
          const yesSteps = (step.branches && step.branches.yes) || [];
          const noSteps = (step.branches && step.branches.no) || [];
          let yesLast = null;
          let noLast = null;
          let yesY = localY;
          let noY = localY;
          if (!yesSteps.length) {
            // leave open — validation will catch missing branch destination if required
          } else {
            yesSteps.forEach((s, i) => {
              const n = addNode(s, X_YES, yesY);
              yesY += 100;
              if (i === 0) connect(cond, n, 'yes', 'Yes', 0);
              else connect(yesLast, n, outcomeHandleFor(yesLast), '', 0);
              yesLast = n;
            });
          }
          if (noSteps.length) {
            noSteps.forEach((s, i) => {
              const n = addNode(s, X_NO, noY);
              noY += 100;
              if (i === 0) connect(cond, n, 'no', 'No', 1);
              else connect(noLast, n, outcomeHandleFor(noLast), '', 0);
              noLast = n;
            });
          }
          localY = Math.max(yesY, noY, localY + 40);
          // Branches end independently (typical End nodes). No automatic join.
          prev = null;
          handle = 'out';
          y = localY;
          return;
        }
        const n = addNode(step, xStart, localY);
        localY += 110;
        if (prev) connect(prev, n, handle, '', idx);
        prev = n;
        handle = outcomeHandleFor(n);
        y = localY;
      });
      return prev;
    }

    emitSequence((model && model.spine) || [], X_MAIN, null, 'out');
    return ensureGraph({ nodes, connections });
  }

  function createStep(simpleId, opts) {
    const meta = BY_SIMPLE[simpleId] || BY_SIMPLE.form;
    const name = (opts && opts.name) || meta.label;
    return {
      key: slugifyKey(name) + '_' + Date.now().toString(36).slice(-4),
      type: meta.runtimeType,
      simpleId: meta.id,
      name,
      config: defaultConfigForSimple(meta.id),
      branches: meta.isCondition ? { yes: [], no: [] } : null,
    };
  }

  function findInList(list, key) {
    for (let i = 0; i < list.length; i++) {
      if (list[i].key === key) return { list, index: i, step: list[i] };
      if (list[i].branches) {
        const y = findInList(list[i].branches.yes || [], key);
        if (y) return y;
        const n = findInList(list[i].branches.no || [], key);
        if (n) return n;
      }
    }
    return null;
  }

  function validateModel(model) {
    const issues = [];
    const spine = (model && model.spine) || [];
    if (!spine.length) {
      issues.push({ severity: 'error', code: 'EMPTY', message: 'Workflow has no steps', key: null });
      return issues;
    }
    if (!spine.some((s) => isStartType(s.type))) {
      issues.push({ severity: 'error', code: 'NO_START', message: 'Add a Start step', key: spine[0] && spine[0].key });
    }
    function walk(steps, path) {
      steps.forEach((s) => {
        if (isConditionType(s.type)) {
          const leaf = s.config && s.config.condition && s.config.condition.all && s.config.condition.all[0];
          if (!leaf || !leaf.left || !leaf.left.key) {
            issues.push({
              severity: 'error',
              code: 'COND_VAR',
              message: 'Condition is missing a variable',
              key: s.key,
            });
          }
          const yes = (s.branches && s.branches.yes) || [];
          const no = (s.branches && s.branches.no) || [];
          if (!yes.length) {
            issues.push({
              severity: 'warning',
              code: 'YES_EMPTY',
              message: 'Yes branch has no steps',
              key: s.key,
            });
          }
          if (!no.length) {
            issues.push({
              severity: 'warning',
              code: 'NO_EMPTY',
              message: 'No branch has no steps',
              key: s.key,
            });
          }
          walk(yes, path + '/yes');
          walk(no, path + '/no');
        }
        if (s.type === 'document.generate' || s.type === 'human.sign') {
          if (!(s.config && s.config.document_definition_id)) {
            issues.push({
              severity: 'warning',
              code: 'DOC',
              message: s.name + ' has no published document selected',
              key: s.key,
            });
          }
        }
        if (isHumanType(s.type)) {
          const a = s.config && s.config.assignment;
          if (!a || (!a.role_key && !a.user_id && a.mode !== 'request_creator' && a.mode !== 'external_participant')) {
            issues.push({
              severity: 'warning',
              code: 'ASSIGN',
              message: s.name + ' needs an assignee (user, role, initiator, or external)',
              key: s.key,
            });
          }
        }
      });
    }
    walk(spine, '');
    if (!spine.some((s) => isTerminalType(s.type) || (s.branches && (s.branches.yes || []).concat(s.branches.no || []).some((x) => isTerminalType(x.type))))) {
      issues.push({
        severity: 'warning',
        code: 'NO_END',
        message: 'Consider adding an End step',
        key: null,
      });
    }
    return issues;
  }

  function mount(host, opts) {
    opts = opts || {};
    const readOnly = !!opts.readOnly;
    let graph = ensureGraph(opts.graph || { nodes: [], connections: [] });
    let model = graphToModel(graph);
    if (!model.spine.length) {
      model = {
        spine: [
          createStep('start', { name: 'Start' }),
          createStep('end', { name: 'End' }),
        ],
      };
      graph = modelToGraph(model);
    }
    let selectedKey = opts.selectedNodeKey || (model.spine[0] && model.spine[0].key);
    let insertCtx = { list: model.spine, index: model.spine.length - 1 }; // after last by default
    let showPicker = false;
    const roles = opts.roles || [];
    const users = opts.users || [];
    const documents = opts.documents || opts.publishedDocuments || [];
    const catalogs = opts.catalogs || {};

    function emitChange() {
      graph = modelToGraph(model);
      if (typeof opts.onChange === 'function') opts.onChange(graph);
      if (typeof opts.onDirty === 'function') opts.onDirty();
    }

    function select(key) {
      selectedKey = key;
      if (typeof opts.onSelect === 'function') opts.onSelect(key);
      render();
    }

    function markInsert(list, index) {
      insertCtx = { list, index };
      showPicker = true;
      render();
    }

    function addAt(simpleId) {
      if (readOnly) return;
      const step = createStep(simpleId);
      const list = insertCtx.list || model.spine;
      let idx = insertCtx.index;
      if (idx < 0) idx = 0;
      if (idx > list.length) idx = list.length;
      // insert AFTER index when coming from + between A and B where index is A's index
      list.splice(idx + 1, 0, step);
      showPicker = false;
      selectedKey = step.key;
      emitChange();
      render();
    }

    function deleteStep(key) {
      if (readOnly) return;
      const found = findInList(model.spine, key);
      if (!found) return;
      if (isStartType(found.step.type) && found.list === model.spine && found.list.filter((s) => isStartType(s.type)).length <= 1) {
        return; // keep at least conceptually one start — still allow delete if user insists? keep one start
      }
      found.list.splice(found.index, 1);
      if (selectedKey === key) selectedKey = (found.list[found.index] || found.list[found.index - 1] || model.spine[0] || {}).key;
      emitChange();
      render();
    }

    function duplicateStep(key) {
      if (readOnly) return;
      const found = findInList(model.spine, key);
      if (!found) return;
      const copy = JSON.parse(JSON.stringify(found.step));
      copy.key = slugifyKey(copy.name) + '_' + Date.now().toString(36).slice(-4);
      copy.name = (copy.name || 'Step') + ' copy';
      found.list.splice(found.index + 1, 0, copy);
      selectedKey = copy.key;
      emitChange();
      render();
    }

    function moveStep(key, dir) {
      if (readOnly) return;
      const found = findInList(model.spine, key);
      if (!found) return;
      const j = found.index + dir;
      if (j < 0 || j >= found.list.length) return;
      const tmp = found.list[found.index];
      found.list[found.index] = found.list[j];
      found.list[j] = tmp;
      emitChange();
      render();
    }

    function selectedStep() {
      const f = findInList(model.spine, selectedKey);
      return f ? f.step : null;
    }

    function renderStepCard(step, list, index, branchLabel) {
      const meta = BY_RUNTIME[step.type] || BY_SIMPLE[step.simpleId] || BY_SIMPLE.form;
      const card = el('div', {
        className: 'swb-card' + (step.key === selectedKey ? ' is-selected' : '') + ' swb-card-' + (meta.color || 'form'),
        tabindex: '0',
        role: 'button',
        'aria-label': step.name,
        onclick: () => select(step.key),
      });
      if (branchLabel) {
        card.appendChild(el('div', { className: 'swb-branch-tag', text: branchLabel }));
      }
      const body = el('div', { className: 'swb-card-body' });
      body.appendChild(el('span', { className: 'swb-card-icon', text: meta.icon || '•', 'aria-hidden': 'true' }));
      const text = el('div', { className: 'swb-card-text' });
      text.appendChild(el('strong', { text: step.name || meta.label }));
      const assign = step.config && step.config.assignment;
      let sub = meta.label;
      if (assign) {
        if (assign.mode === 'role' && assign.role_key) sub = 'Role: ' + assign.role_key;
        else if (assign.mode === 'specific_user' && assign.user_email) sub = assign.user_email;
        else if (assign.mode === 'request_creator') sub = 'Workflow initiator';
        else if (assign.mode === 'external_participant') sub = 'External participant';
      }
      if (step.type === 'document.generate' || step.type === 'human.sign') {
        const docId = step.config && step.config.document_definition_id;
        const doc = documents.find((d) => String(d.id) === String(docId));
        if (doc) sub = doc.name || doc.key || sub;
      }
      text.appendChild(el('span', { className: 'swb-card-sub', text: sub }));
      body.appendChild(text);
      card.appendChild(body);

      if (!readOnly) {
        const menu = el('div', { className: 'swb-card-menu' });
        const btn = el('button', {
          type: 'button',
          className: 'swb-more',
          text: '⋯',
          'aria-label': 'Step actions',
          onclick: (e) => {
            e.stopPropagation();
            const existing = card.querySelector('.swb-menu-pop');
            if (existing) {
              existing.remove();
              return;
            }
            const pop = el('div', { className: 'swb-menu-pop' });
            function item(label, fn) {
              pop.appendChild(
                el('button', {
                  type: 'button',
                  className: 'swb-menu-item',
                  text: label,
                  onclick: (ev) => {
                    ev.stopPropagation();
                    pop.remove();
                    fn();
                  },
                })
              );
            }
            item('Edit', () => select(step.key));
            item('Duplicate', () => duplicateStep(step.key));
            item('Move up', () => moveStep(step.key, -1));
            item('Move down', () => moveStep(step.key, 1));
            item('Insert before', () => {
              insertCtx = { list, index: index - 1 };
              showPicker = true;
              render();
            });
            item('Insert after', () => {
              markInsert(list, index);
            });
            item('Delete', () => deleteStep(step.key));
            card.appendChild(pop);
          },
        });
        menu.appendChild(btn);
        card.appendChild(menu);
      }
      return card;
    }

    function renderPlus(list, afterIndex) {
      if (readOnly) return el('div', { className: 'swb-plus-spacer' });
      return el('button', {
        type: 'button',
        className: 'swb-plus',
        text: '+',
        title: 'Add step here',
        'aria-label': 'Add step here',
        onclick: () => markInsert(list, afterIndex),
      });
    }

    function renderSequence(steps, listRef) {
      const col = el('div', { className: 'swb-seq' });
      if (!steps.length) {
        col.appendChild(renderPlus(listRef, -1));
        return col;
      }
      steps.forEach((step, i) => {
        if (i === 0) col.appendChild(renderPlus(listRef, -1));
        if (step.branches) {
          col.appendChild(renderStepCard(step, listRef, i));
          const fork = el('div', { className: 'swb-fork' });
          const yesCol = el('div', { className: 'swb-fork-col' });
          yesCol.appendChild(el('div', { className: 'swb-fork-label swb-fork-yes', text: 'YES' }));
          yesCol.appendChild(renderSequence(step.branches.yes || [], step.branches.yes));
          const noCol = el('div', { className: 'swb-fork-col' });
          noCol.appendChild(el('div', { className: 'swb-fork-label swb-fork-no', text: 'NO' }));
          noCol.appendChild(renderSequence(step.branches.no || [], step.branches.no));
          fork.appendChild(yesCol);
          fork.appendChild(noCol);
          col.appendChild(fork);
        } else {
          col.appendChild(renderStepCard(step, listRef, i));
        }
        col.appendChild(el('div', { className: 'swb-connector', 'aria-hidden': 'true' }));
        col.appendChild(renderPlus(listRef, i));
      });
      return col;
    }

    function renderInspector(box) {
      box.innerHTML = '';
      box.appendChild(el('h4', { text: 'Step settings' }));
      const step = selectedStep();
      if (!step) {
        box.appendChild(el('p', { className: 'cfg-hint', text: 'Select a step to configure it.' }));
        return;
      }
      const nameInp = el('input', {
        type: 'text',
        className: 'cfg-input',
        value: step.name || '',
        disabled: readOnly ? 'disabled' : null,
        'aria-label': 'Step name',
      });
      nameInp.addEventListener('input', () => {
        step.name = nameInp.value;
        emitChange();
        // light refresh of card titles without full remount of selection
      });
      nameInp.addEventListener('change', () => render());
      box.appendChild(el('label', { className: 'swb-field-label', text: 'Step name' }));
      box.appendChild(nameInp);

      box.appendChild(el('label', { className: 'swb-field-label', text: 'Type' }));
      box.appendChild(el('div', { className: 'cfg-hint', text: (BY_RUNTIME[step.type] || {}).label || step.type }));

      if (isConditionType(step.type)) {
        step.config = step.config || {};
        step.config.condition = step.config.condition || defaultConfigForSimple('condition').condition;
        const leaf = step.config.condition.all[0];
        box.appendChild(el('label', { className: 'swb-field-label', text: 'Variable' }));
        const vars = CONDITION_VARS.slice();
        ((catalogs.builtin_variables || []) || []).forEach((v) => {
          if (v && v.key && vars.indexOf(v.key) < 0) vars.push(v.key);
        });
        const vs = el('select', { className: 'cfg-input', disabled: readOnly ? 'disabled' : null });
        vars.forEach((k) => {
          const o = el('option', { value: k, text: k });
          if (leaf.left && leaf.left.key === k) o.selected = true;
          vs.appendChild(o);
        });
        vs.addEventListener('change', () => {
          leaf.left = { type: 'variable', key: vs.value };
          emitChange();
        });
        box.appendChild(vs);

        box.appendChild(el('label', { className: 'swb-field-label', text: 'Operator' }));
        const os = el('select', { className: 'cfg-input', disabled: readOnly ? 'disabled' : null });
        ['is_true', 'is_false', 'equals', 'not_equals', 'is_empty', 'is_not_empty'].forEach((op) => {
          const o = el('option', { value: op, text: op });
          if (leaf.operator === op) o.selected = true;
          os.appendChild(o);
        });
        os.addEventListener('change', () => {
          leaf.operator = os.value;
          emitChange();
          render();
        });
        box.appendChild(os);

        if (leaf.operator === 'equals' || leaf.operator === 'not_equals') {
          box.appendChild(el('label', { className: 'swb-field-label', text: 'Value' }));
          const vi = el('input', {
            type: 'text',
            className: 'cfg-input',
            value: leaf.right && leaf.right.value != null ? String(leaf.right.value) : '',
            disabled: readOnly ? 'disabled' : null,
          });
          vi.addEventListener('change', () => {
            leaf.right = { type: 'literal', value: vi.value };
            emitChange();
          });
          box.appendChild(vi);
        }
        box.appendChild(
          el('p', {
            className: 'cfg-hint',
            text: 'Yes and No paths are edited in the center. Add steps under each branch with +.',
          })
        );
      }

      if (step.type === 'document.generate' || step.type === 'human.sign' || step.simpleId === 'form') {
        // Allow switching form step to generate document
        if (step.simpleId === 'form' || step.type === 'human.fill') {
          box.appendChild(el('label', { className: 'swb-field-label', text: 'Action' }));
          const act = el('select', { className: 'cfg-input', disabled: readOnly ? 'disabled' : null });
          [
            ['human.fill', 'Fill form'],
            ['document.generate', 'Generate document'],
            ['human.upload', 'Upload document'],
          ].forEach(([val, lab]) => {
            const o = el('option', { value: val, text: lab });
            if (step.type === val) o.selected = true;
            act.appendChild(o);
          });
          act.addEventListener('change', () => {
            step.type = act.value;
            emitChange();
            render();
          });
          box.appendChild(act);
        }

        if (step.type === 'document.generate' || step.type === 'human.sign') {
          box.appendChild(el('label', { className: 'swb-field-label', text: 'Published document' }));
          const ds = el('select', { className: 'cfg-input', disabled: readOnly ? 'disabled' : null });
          ds.appendChild(el('option', { value: '', text: '— Select —' }));
          documents.forEach((d) => {
            const o = el('option', { value: d.id, text: d.name || d.key || d.id });
            if (String(step.config.document_definition_id) === String(d.id)) o.selected = true;
            ds.appendChild(o);
          });
          ds.addEventListener('change', () => {
            step.config.document_definition_id = ds.value || null;
            emitChange();
          });
          box.appendChild(ds);
        }
      }

      if (isHumanType(step.type)) {
        step.config.assignment = step.config.assignment || defaultAssignment(null);
        const a = step.config.assignment;
        box.appendChild(el('label', { className: 'swb-field-label', text: 'Assign to' }));
        const mode = el('select', { className: 'cfg-input', disabled: readOnly ? 'disabled' : null });
        [
          ['request_creator', 'Workflow initiator'],
          ['role', 'Role'],
          ['specific_user', 'User'],
          ['external_participant', 'Vendor / external (email field)'],
        ].forEach(([val, lab]) => {
          const o = el('option', { value: val, text: lab });
          if (a.mode === val) o.selected = true;
          mode.appendChild(o);
        });
        mode.addEventListener('change', () => {
          a.mode = mode.value;
          emitChange();
          render();
        });
        box.appendChild(mode);

        if (a.mode === 'role') {
          box.appendChild(el('label', { className: 'swb-field-label', text: 'Role' }));
          const rs = el('select', { className: 'cfg-input', disabled: readOnly ? 'disabled' : null });
          rs.appendChild(el('option', { value: '', text: '— Select role —' }));
          roles.forEach((r) => {
            const id = r.key || r.id || r.role_key;
            const o = el('option', { value: id, text: r.label || r.name || id });
            if (a.role_key === id) o.selected = true;
            rs.appendChild(o);
          });
          ;['hub_admin', 'manager', 'ap', 'legal', 'requester'].forEach((id) => {
            if (![...rs.options].some((o) => o.value === id)) {
              rs.appendChild(el('option', { value: id, text: id }));
            }
          });
          rs.addEventListener('change', () => {
            a.role_key = rs.value || null;
            emitChange();
          });
          box.appendChild(rs);
        }
        if (a.mode === 'specific_user') {
          box.appendChild(el('label', { className: 'swb-field-label', text: 'User' }));
          const us = el('select', { className: 'cfg-input', disabled: readOnly ? 'disabled' : null });
          us.appendChild(el('option', { value: '', text: '— Select user —' }));
          users.slice(0, 300).forEach((u) => {
            const email = u.email || u.user_email;
            const o = el('option', { value: email, text: (u.displayName || u.name || email) + ' <' + email + '>' });
            if (a.user_email === email || String(a.user_id) === String(u.id)) o.selected = true;
            us.appendChild(o);
          });
          us.addEventListener('change', () => {
            const u = users.find((x) => (x.email || x.user_email) === us.value);
            a.user_email = us.value || null;
            a.user_id = u && u.id ? u.id : null;
            emitChange();
          });
          box.appendChild(us);
        }
        if (a.mode === 'external_participant') {
          box.appendChild(el('label', { className: 'swb-field-label', text: 'Email form field' }));
          const fi = el('input', {
            type: 'text',
            className: 'cfg-input',
            value: a.form_field_key || 'contact_email',
            disabled: readOnly ? 'disabled' : null,
          });
          fi.addEventListener('change', () => {
            a.form_field_key = fi.value || 'contact_email';
            emitChange();
          });
          box.appendChild(fi);
        }
      }

      if (step.type === 'logic.update_vendor') {
        box.appendChild(el('label', { className: 'swb-field-label', text: 'Vendor field' }));
        const fs = el('select', { className: 'cfg-input', disabled: readOnly ? 'disabled' : null });
        [
          ['nda_status', 'NDA status'],
          ['msa_status', 'MSA status'],
        ].forEach(([val, lab]) => {
          const o = el('option', { value: val, text: lab });
          if ((step.config.field || 'nda_status') === val) o.selected = true;
          fs.appendChild(o);
        });
        fs.addEventListener('change', () => {
          step.config.field = fs.value;
          emitChange();
        });
        box.appendChild(fs);
        box.appendChild(el('label', { className: 'swb-field-label', text: 'New value' }));
        const vv = el('input', {
          type: 'text',
          className: 'cfg-input',
          value: step.config.value || 'approved',
          disabled: readOnly ? 'disabled' : null,
        });
        vv.addEventListener('change', () => {
          step.config.value = vv.value || 'approved';
          emitChange();
        });
        box.appendChild(vv);
      }

      if (step.simpleId === 'start' || isStartType(step.type)) {
        box.appendChild(el('label', { className: 'swb-field-label', text: 'Trigger' }));
        const ts = el('select', { className: 'cfg-input', disabled: readOnly ? 'disabled' : null });
        [
          ['trigger.request_created', 'Request created'],
          ['trigger.vendor_request_submitted', 'Vendor request submitted'],
          ['trigger.form_submitted', 'Form submitted'],
        ].forEach(([val, lab]) => {
          const o = el('option', { value: val, text: lab });
          if (step.type === val) o.selected = true;
          ts.appendChild(o);
        });
        ts.addEventListener('change', () => {
          step.type = ts.value;
          emitChange();
          render();
        });
        box.appendChild(ts);
      }
    }

    function renderPicker(overlay) {
      overlay.innerHTML = '';
      const panel = el('div', { className: 'swb-picker' });
      panel.appendChild(el('h4', { text: 'Add step' }));
      panel.appendChild(el('p', { className: 'cfg-hint', text: 'Click a step type to add it to your workflow.' }));
      const grid = el('div', { className: 'swb-picker-grid' });
      SIMPLE_TYPES.forEach((t) => {
        const btn = el('button', {
          type: 'button',
          className: 'swb-picker-item swb-card-' + t.color,
          onclick: () => addAt(t.id),
        });
        btn.appendChild(el('span', { className: 'swb-card-icon', text: t.icon }));
        const tx = el('span', { className: 'swb-picker-text' });
        tx.appendChild(el('strong', { text: t.label }));
        tx.appendChild(el('span', { text: t.description }));
        btn.appendChild(tx);
        grid.appendChild(btn);
      });
      panel.appendChild(grid);
      panel.appendChild(
        el('button', {
          type: 'button',
          className: 'hub-btn',
          text: 'Cancel',
          onclick: () => {
            showPicker = false;
            render();
          },
        })
      );
      overlay.appendChild(panel);
    }

    function render() {
      host.innerHTML = '';
      const rootEl = el('div', { className: 'swb-root' });
      const workspace = el('div', { className: 'swb-workspace' });

      // Left — Add Step
      const left = el('aside', { className: 'swb-left', 'aria-label': 'Add step' });
      left.appendChild(el('h4', { text: 'Add Step' }));
      left.appendChild(el('p', { className: 'cfg-hint', text: 'Click a step type to add it at the selected + insertion point.' }));
      const lib = el('div', { className: 'swb-lib' });
      SIMPLE_TYPES.forEach((t) => {
        const btn = el('button', {
          type: 'button',
          className: 'swb-lib-item',
          disabled: readOnly ? 'disabled' : null,
          onclick: () => {
            if (!insertCtx) insertCtx = { list: model.spine, index: model.spine.length - 1 };
            addAt(t.id);
          },
        });
        btn.appendChild(el('span', { className: 'swb-card-icon', text: t.icon }));
        const tx = el('span');
        tx.appendChild(el('strong', { text: t.label }));
        tx.appendChild(el('span', { className: 'cfg-hint', text: t.description }));
        btn.appendChild(tx);
        lib.appendChild(btn);
      });
      left.appendChild(lib);
      workspace.appendChild(left);

      // Center
      const mid = el('div', { className: 'swb-mid' });
      mid.appendChild(el('div', { className: 'swb-mid-head', text: 'Workflow' }));
      const issues = validateModel(model).filter((i) => i.severity === 'error');
      if (issues.length) {
        const ban = el('div', { className: 'swb-validation' });
        issues.slice(0, 5).forEach((i) => ban.appendChild(el('div', { text: i.message })));
        mid.appendChild(ban);
      }
      const canvas = el('div', { className: 'swb-canvas' });
      canvas.appendChild(renderSequence(model.spine, model.spine));
      mid.appendChild(canvas);
      workspace.appendChild(mid);

      // Right inspector
      const right = el('aside', { className: 'swb-right', 'aria-label': 'Step configuration' });
      renderInspector(right);
      workspace.appendChild(right);

      rootEl.appendChild(workspace);

      if (showPicker && !readOnly) {
        const overlay = el('div', { className: 'swb-picker-overlay' });
        renderPicker(overlay);
        rootEl.appendChild(overlay);
      }

      // Advanced canvas escape hatch
      const foot = el('div', { className: 'swb-footer' });
      foot.appendChild(
        el('span', {
          className: 'cfg-hint',
          text: 'Simplified builder — connections are created automatically. Advanced canvas is optional.',
        })
      );
      if (typeof opts.onOpenAdvanced === 'function') {
        foot.appendChild(
          el('button', {
            type: 'button',
            className: 'hub-link-btn',
            text: 'Open advanced canvas',
            onclick: () => {
              graph = modelToGraph(model);
              opts.onOpenAdvanced(graph);
            },
          })
        );
      }
      rootEl.appendChild(foot);
      host.appendChild(rootEl);
    }

    render();

    return {
      getGraph: () => modelToGraph(model),
      getModel: () => model,
      setGraph: (g) => {
        graph = ensureGraph(g);
        model = graphToModel(graph);
        render();
      },
      validate: () => validateModel(model),
      refresh: render,
      destroy: () => {
        host.innerHTML = '';
      },
    };
  }

  global.HubWorkflowSimpleBuilder = {
    mount,
    graphToModel,
    modelToGraph,
    ensureGraph,
    createStep,
    validateModel,
    SIMPLE_TYPES,
    CONDITION_VARS,
    _test: {
      slugifyKey,
      uniqueKey,
      isStartType,
      isTerminalType,
      isConditionType,
      simpleIdForRuntime,
    },
  };
})(typeof window !== 'undefined' ? window : global);
