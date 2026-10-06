/**
 * Workflow graph validation — cycles rejected; one start; ≥1 terminal.
 */

const { LIMITS } = require('../limits');
const { getNodeType, isStartNodeType, isTerminalNodeType } = require('../nodes/registry');
const { validateConditionShape } = require('../conditions');
const { safeKey, stripControlChars } = require('../sanitize');

function normalizeWorkflowGraph(payload) {
  const body = payload || {};
  const nodes = Array.isArray(body.nodes) ? body.nodes : [];
  const connections = Array.isArray(body.connections) ? body.connections : [];
  return {
    nodes: nodes.slice(0, LIMITS.MAX_WORKFLOW_NODES).map((n, i) => ({
      key: safeKey(n.key || `node_${i + 1}`) || `node_${i + 1}`,
      type: String(n.type || ''),
      name: stripControlChars(n.name || n.type || `Node ${i + 1}`).slice(0, LIMITS.MAX_LABEL_LENGTH),
      description: stripControlChars(n.description || '').slice(0, 2000),
      x: Number.isFinite(n.x) ? n.x : 80 + (i % 5) * 180,
      y: Number.isFinite(n.y) ? n.y : 80 + Math.floor(i / 5) * 120,
      config: n.config && typeof n.config === 'object' ? n.config : {},
    })),
    connections: connections.slice(0, LIMITS.MAX_WORKFLOW_CONNECTIONS).map((c, i) => ({
      key: safeKey(c.key || `conn_${i + 1}`) || `conn_${i + 1}`,
      source: safeKey(c.source || ''),
      target: safeKey(c.target || ''),
      source_handle: safeKey(c.source_handle || (c.outcome_key === 'default' ? 'out' : c.outcome_key) || 'out') || 'out',
      target_handle: safeKey(c.target_handle || 'in') || 'in',
      label: stripControlChars(c.label || '').slice(0, 80),
      outcome_key: (() => {
        const raw = c.outcome_key || c.source_handle || c.label || 'default';
        const key = safeKey(raw === 'out' ? 'default' : raw) || 'default';
        return key === 'out' ? 'default' : key;
      })(),
      condition: c.condition || null,
      is_revision: !!(c.is_revision || /revision/i.test(String(c.label || ''))),
      sort_order: Number.isFinite(c.sort_order) ? c.sort_order : i,
    })),
  };
}

function detectCycle(nodes, connections) {
  const adj = {};
  for (const n of nodes) adj[n.key] = [];
  for (const c of connections) {
    if (c.is_revision) continue;
    if (adj[c.source]) adj[c.source].push(c.target);
  }
  const visiting = new Set();
  const visited = new Set();
  function dfs(node) {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of adj[node] || []) {
      if (dfs(next)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  }
  for (const n of nodes) {
    if (dfs(n.key)) return true;
  }
  return false;
}

function wouldCreateCycle(nodes, connections, source, target) {
  const probe = connections.concat([{ source, target, is_revision: false }]);
  return detectCycle(nodes, probe);
}

function validateWorkflowDefinition(payload) {
  const issues = [];
  const graph = normalizeWorkflowGraph(payload);
  const { nodes, connections } = graph;

  if (nodes.length > LIMITS.MAX_WORKFLOW_NODES) {
    issues.push({
      severity: 'error',
      code: 'TOO_MANY_NODES',
      message: `Workflows may have at most ${LIMITS.MAX_WORKFLOW_NODES} nodes`,
      entity: 'workflow',
    });
  }
  if (connections.length > LIMITS.MAX_WORKFLOW_CONNECTIONS) {
    issues.push({
      severity: 'error',
      code: 'TOO_MANY_CONNECTIONS',
      message: `Workflows may have at most ${LIMITS.MAX_WORKFLOW_CONNECTIONS} connections`,
      entity: 'workflow',
    });
  }

  const keys = new Set();
  const startNodes = [];
  const terminalNodes = [];
  for (const n of nodes) {
    if (!n.key) {
      issues.push({ severity: 'error', code: 'NODE_KEY_REQUIRED', message: 'Each node needs a key', entity: 'node' });
      continue;
    }
    if (keys.has(n.key)) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_NODE_KEY',
        message: `Duplicate node key: ${n.key}`,
        entity: 'node',
        affected: n.key,
      });
    }
    keys.add(n.key);
    const meta = getNodeType(n.type);
    if (!meta) {
      issues.push({
        severity: 'error',
        code: 'UNKNOWN_NODE_TYPE',
        message: `Unknown node type: ${n.type}`,
        entity: 'node',
        affected: n.key,
      });
    }
    if (isStartNodeType(n.type)) startNodes.push(n);
    if (isTerminalNodeType(n.type)) terminalNodes.push(n);
    if (n.config && n.config.condition) {
      issues.push(...validateConditionShape(n.config.condition));
    }
    const metaType = getNodeType(n.type);
    if (metaType && metaType.category === 'human') {
      const asg = (n.config && n.config.assignment) || {};
      const mode = asg.mode || (n.config && n.config.assignee_role ? 'role' : null);
      const hasAssignment =
        (mode === 'specific_user' && asg.user_id) ||
        (mode === 'role' && (asg.role_key || (n.config && n.config.assignee_role))) ||
        mode === 'request_creator' ||
        mode === 'form_user_field' ||
        mode === 'external_participant' ||
        (n.config && n.config.assignee_role);
      if (!hasAssignment) {
        issues.push({
          severity: 'error',
          code: 'MISSING_ASSIGNMENT',
          message: `"${n.name || n.key}" has no assignment. Choose a user, role, or dynamic assignment source.`,
          entity: 'node',
          affected: n.key,
          suggested_correction: 'Open the node inspector and set Assignment',
        });
      }
    }
  }

  if (startNodes.length !== 1) {
    issues.push({
      severity: 'error',
      code: 'START_NODE_COUNT',
      message: 'Workflow must have exactly one start/trigger node',
      entity: 'workflow',
      suggested_correction: 'Keep a single trigger node (for example Request created)',
    });
  }
  if (terminalNodes.length < 1) {
    issues.push({
      severity: 'error',
      code: 'TERMINAL_REQUIRED',
      message: 'Workflow must have at least one terminal node',
      entity: 'workflow',
    });
  }

  for (const c of connections) {
    if (!keys.has(c.source) || !keys.has(c.target)) {
      issues.push({
        severity: 'error',
        code: 'INVALID_CONNECTION',
        message: `Connection ${c.key} references missing nodes`,
        entity: 'connection',
        affected: c.key,
      });
      continue;
    }
    if (c.source === c.target) {
      issues.push({
        severity: 'error',
        code: 'SELF_CONNECTION',
        message: `Connection ${c.key} cannot connect a node to itself`,
        entity: 'connection',
        affected: c.key,
      });
    }
    const targetNode = nodes.find((n) => n.key === c.target);
    if (targetNode && isStartNodeType(targetNode.type)) {
      issues.push({
        severity: 'error',
        code: 'START_HAS_INBOUND',
        message: `Start node "${targetNode.name || targetNode.key}" cannot have an incoming connection`,
        entity: 'connection',
        affected: c.key,
      });
    }
    if (c.condition) issues.push(...validateConditionShape(c.condition));
  }

  // Required outcomes must be connected
  function outcomeHandlesFor(node) {
    if (node.type === 'logic.condition' || node.type === 'logic.multi_branch') {
      const outs = (node.config && node.config.outcomes) || [
        { key: 'yes', label: 'Yes' },
        { key: 'no', label: 'No' },
      ];
      return outs.map((o) => ({ key: o.key || o.id, label: o.label || o.key }));
    }
    if (node.type === 'human.approve' || node.type === 'human.review') {
      return [
        { key: 'approved', label: 'Approved' },
        { key: 'rejected', label: 'Rejected' },
      ];
    }
    if (node.type === 'human.sign') {
      return [
        { key: 'signed', label: 'Signed' },
        { key: 'declined', label: 'Declined' },
      ];
    }
    if (isTerminalNodeType(node.type)) return [];
    if (isStartNodeType(node.type)) return [{ key: 'out', label: 'Continue' }];
    return [{ key: 'out', label: 'Continue' }];
  }

  function isDecisionNode(n) {
    return (
      n.type === 'logic.condition' ||
      n.type === 'logic.multi_branch' ||
      n.type === 'human.approve' ||
      n.type === 'human.review' ||
      n.type === 'human.sign'
    );
  }

  for (const n of nodes) {
    if (isTerminalNodeType(n.type)) continue;
    const outs = outcomeHandlesFor(n);
    // Start nodes still need outbound
    for (const o of outs) {
      const outcomeKey = o.key === 'out' ? 'default' : o.key;
      const has = connections.some(
        (c) =>
          c.source === n.key &&
          (c.source_handle === o.key ||
            c.outcome_key === outcomeKey ||
            c.outcome_key === o.key ||
            (o.key === 'out' && (!c.source_handle || c.source_handle === 'out') && (c.outcome_key === 'default' || !c.outcome_key)))
      );
      if (!has && (isDecisionNode(n) || isStartNodeType(n.type))) {
        issues.push({
          severity: 'error',
          code: 'MISSING_OUTCOME_CONNECTION',
          message: `The “${o.label}” output from “${n.name || n.key}” is not connected.`,
          entity: 'node',
          affected: n.key,
          suggested_correction: 'Connect this output handle to the next step',
        });
      } else if (!has && !isStartNodeType(n.type) && !isTerminalNodeType(n.type)) {
        issues.push({
          severity: 'error',
          code: 'MISSING_SEQUENTIAL_OUTPUT',
          message: `“${n.name || n.key}” has no outgoing connection.`,
          entity: 'node',
          affected: n.key,
          suggested_correction: 'Drag from the output handle to the next step',
        });
      }
    }
  }

  // Duplicate source+outcome pairs
  const seenOutcomes = new Set();
  for (const c of connections) {
    const handle = c.source_handle || c.outcome_key || 'out';
    const sig = `${c.source}::${handle}`;
    if (seenOutcomes.has(sig)) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_OUTCOME_CONNECTION',
        message: `Node ${c.source} already has a connection from outcome “${handle}”`,
        entity: 'connection',
        affected: c.key,
      });
    }
    seenOutcomes.add(sig);
  }

  if (detectCycle(nodes, connections)) {
    issues.push({
      severity: 'error',
      code: 'CYCLE_REJECTED',
      message: 'Unsupported workflow cycle detected. Mark intentional return paths as revision connections.',
      entity: 'workflow',
      suggested_correction: 'Remove loops or use a controlled revision edge back to a human step',
    });
  }

  // Reachability: every non-start node should have an inbound edge; terminals reachable from start
  if (startNodes.length === 1 && nodes.length) {
    const start = startNodes[0].key;
    const adj = {};
    for (const n of nodes) adj[n.key] = [];
    for (const c of connections) {
      if (adj[c.source]) adj[c.source].push(c.target);
    }
    const reachable = new Set();
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      if (reachable.has(cur)) continue;
      reachable.add(cur);
      for (const next of adj[cur] || []) queue.push(next);
    }
    for (const n of nodes) {
      if (n.key !== start && !connections.some((c) => c.target === n.key)) {
        issues.push({
          severity: 'warning',
          code: 'DISCONNECTED_NODE',
          message: `Node ${n.name || n.key} has no inbound connection`,
          entity: 'node',
          affected: n.key,
        });
      }
    }
    for (const t of terminalNodes) {
      if (!reachable.has(t.key)) {
        issues.push({
          severity: 'error',
          code: 'TERMINAL_UNREACHABLE',
          message: `Terminal node ${t.name || t.key} is not reachable from start`,
          entity: 'node',
          affected: t.key,
        });
      }
    }
  }

  return {
    ok: !issues.some((i) => i.severity === 'error'),
    issues,
    normalized: graph,
  };
}

module.exports = {
  validateWorkflowDefinition,
  normalizeWorkflowGraph,
  detectCycle,
  wouldCreateCycle,
};
