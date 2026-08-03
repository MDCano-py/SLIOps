/**
 * Built-in variable registry (allowlisted keys + categories).
 */

const BUILTIN_VARIABLES = Object.freeze([
  { key: 'organization.name', category: 'organization', label: 'Organization name', type: 'string' },
  { key: 'organization.legal_name', category: 'organization', label: 'Legal name', type: 'string' },
  { key: 'organization.address', category: 'organization', label: 'Address', type: 'string' },
  { key: 'organization.logo_url', category: 'organization', label: 'Logo URL', type: 'string' },
  { key: 'organization.support_email', category: 'organization', label: 'Support email', type: 'string' },
  { key: 'organization.phone', category: 'organization', label: 'Phone', type: 'string' },

  { key: 'request.id', category: 'request', label: 'Request id', type: 'string' },
  { key: 'request.reference_number', category: 'request', label: 'Reference number', type: 'string' },
  { key: 'request.type', category: 'request', label: 'Request type', type: 'string' },
  { key: 'request.title', category: 'request', label: 'Title', type: 'string' },
  { key: 'request.description', category: 'request', label: 'Description', type: 'string' },
  { key: 'request.priority', category: 'request', label: 'Priority', type: 'string' },
  { key: 'request.status', category: 'request', label: 'Status', type: 'string' },
  { key: 'request.created_at', category: 'request', label: 'Created at', type: 'datetime' },
  { key: 'request.updated_at', category: 'request', label: 'Updated at', type: 'datetime' },
  { key: 'request.created_by.name', category: 'request', label: 'Created by name', type: 'string' },
  { key: 'request.created_by.email', category: 'request', label: 'Created by email', type: 'string' },
  { key: 'request.effective_date', category: 'request', label: 'Effective date', type: 'date' },

  { key: 'workflow.id', category: 'workflow', label: 'Workflow instance id', type: 'string' },
  { key: 'workflow.name', category: 'workflow', label: 'Workflow name', type: 'string' },
  { key: 'workflow.version', category: 'workflow', label: 'Workflow version', type: 'number' },
  { key: 'workflow.current_step.name', category: 'workflow', label: 'Current step', type: 'string' },
  { key: 'workflow.current_assignee.name', category: 'workflow', label: 'Current assignee name', type: 'string' },
  { key: 'workflow.current_assignee.email', category: 'workflow', label: 'Current assignee email', type: 'string' },
  { key: 'workflow.started_at', category: 'workflow', label: 'Started at', type: 'datetime' },
  { key: 'workflow.completed_at', category: 'workflow', label: 'Completed at', type: 'datetime' },

  { key: 'current_user.id', category: 'user', label: 'Current user id', type: 'string' },
  { key: 'current_user.name', category: 'user', label: 'Current user name', type: 'string' },
  { key: 'current_user.email', category: 'user', label: 'Current user email', type: 'string' },
  { key: 'current_user.role', category: 'user', label: 'Current user role', type: 'string' },

  { key: 'date.today', category: 'date', label: 'Today (ISO date)', type: 'date' },
  { key: 'date.now', category: 'date', label: 'Now (ISO datetime)', type: 'datetime' },
  { key: 'date.year', category: 'date', label: 'Year', type: 'number' },
  { key: 'date.month', category: 'date', label: 'Month', type: 'number' },
]);

const BUILTIN_BY_KEY = Object.freeze(
  BUILTIN_VARIABLES.reduce((acc, v) => {
    acc[v.key] = v;
    return acc;
  }, {})
);

const VARIABLE_PATTERN = /^\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}$/;
const VARIABLE_FIND = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g;

function listBuiltinVariables() {
  return BUILTIN_VARIABLES.slice();
}

function isBuiltinKey(key) {
  return Object.prototype.hasOwnProperty.call(BUILTIN_BY_KEY, key);
}

function isFormVariableKey(key) {
  return /^form\.[a-zA-Z][a-zA-Z0-9_]*\.[a-zA-Z][a-zA-Z0-9_]*$/.test(key) ||
    /^form\.[a-zA-Z][a-zA-Z0-9_]*$/.test(key);
}

function isCustomVariableKey(key) {
  return /^custom\.[a-zA-Z][a-zA-Z0-9_]*$/.test(key);
}

function isKnownVariableShape(key) {
  return isBuiltinKey(key) || isFormVariableKey(key) || isCustomVariableKey(key);
}

function extractVariableKeys(template) {
  const keys = [];
  const seen = new Set();
  const text = String(template == null ? '' : template);
  let m;
  VARIABLE_FIND.lastIndex = 0;
  while ((m = VARIABLE_FIND.exec(text)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      keys.push(m[1]);
    }
  }
  return keys;
}

module.exports = {
  BUILTIN_VARIABLES,
  BUILTIN_BY_KEY,
  VARIABLE_PATTERN,
  VARIABLE_FIND,
  listBuiltinVariables,
  isBuiltinKey,
  isFormVariableKey,
  isCustomVariableKey,
  isKnownVariableShape,
  extractVariableKeys,
};
