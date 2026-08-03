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
      label: stripControlChars(c.label || '').slice(0, 80),
      outcome_key: safeKey(c.outcome_key || c.label || 'default') || 'default',
      condition: c.condition || null,
      sort_order: Number.isFinite(c.sort_order) ? c.sort_order : i,
    })),
  };
}

function detectCycle(nodes, connections) {
  const adj = {};
  for (const n of nodes) adj[n.key] = [];
  for (const c of connections) {
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
    }
    if (c.condition) issues.push(...validateConditionShape(c.condition));
  }

  if (detectCycle(nodes, connections)) {
    issues.push({
      severity: 'error',
      code: 'CYCLE_REJECTED',
      message: 'Workflow cycles are not allowed in this version',
      entity: 'workflow',
      suggested_correction: 'Remove loops or model revisions as a return edge that ends in a controlled human step without unbounded cycling',
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
};
