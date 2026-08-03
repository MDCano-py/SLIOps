/**
 * Central variable resolver — allowlisted paths only (no dynamic code execution).
 */

const {
  BUILTIN_BY_KEY,
  extractVariableKeys,
  isFormVariableKey,
  isCustomVariableKey,
  VARIABLE_FIND,
} = require('./registry');

function getPath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = String(path).split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    if (Object.prototype.hasOwnProperty.call(cur, p)) {
      cur = cur[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

function formValue(formSubmission, key) {
  if (!formSubmission || typeof formSubmission !== 'object') return undefined;
  const values = formSubmission.values || formSubmission.data_json || formSubmission;
  if (key.startsWith('form.')) {
    const rest = key.slice(5);
    const direct = getPath(values, rest);
    if (direct !== undefined) return direct;
    if (values[rest] !== undefined) return values[rest];
    return values[rest.replace(/\./g, '_')];
  }
  return undefined;
}

function resolveOne(key, ctx) {
  const context = ctx || {};
  if (BUILTIN_BY_KEY[key]) {
    if (key.startsWith('organization.')) {
      return getPath(context.organization || {}, key.slice('organization.'.length));
    }
    if (key.startsWith('request.')) {
      return getPath(context.request || {}, key.slice('request.'.length));
    }
    if (key.startsWith('workflow.')) {
      return getPath(context.workflowInstance || context.workflow || {}, key.slice('workflow.'.length));
    }
    if (key.startsWith('current_user.')) {
      return getPath(context.currentUser || {}, key.slice('current_user.'.length));
    }
    if (key === 'date.today') return new Date().toISOString().slice(0, 10);
    if (key === 'date.now') return new Date().toISOString();
    if (key === 'date.year') return new Date().getFullYear();
    if (key === 'date.month') return new Date().getMonth() + 1;
  }
  if (isFormVariableKey(key)) return formValue(context.formSubmission, key);
  if (isCustomVariableKey(key)) {
    const customs = context.customVariables || {};
    const short = key.slice('custom.'.length);
    const entry = customs[key] || customs[short];
    if (entry && typeof entry === 'object' && entry.sensitive) {
      return { __blocked: true, reason: 'SENSITIVE_VARIABLE' };
    }
    if (entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'value')) {
      return entry.value;
    }
    return entry;
  }
  if (context.runtimeValues && Object.prototype.hasOwnProperty.call(context.runtimeValues, key)) {
    return context.runtimeValues[key];
  }
  return undefined;
}

function resolveVariables(opts) {
  const options = opts || {};
  const template = String(options.template == null ? '' : options.template);
  const mode = options.mode === 'preview' ? 'preview' : 'production';
  const unresolved = [];
  const blocked = [];
  const resolved = {};
  const keys = extractVariableKeys(template);
  for (const key of keys) {
    const value = resolveOne(key, options);
    if (value && typeof value === 'object' && value.__blocked) {
      blocked.push({ key, reason: value.reason });
      resolved[key] = mode === 'preview' ? `⟦blocked:${key}⟧` : '';
      continue;
    }
    if (value === undefined || value === null) {
      unresolved.push(key);
      resolved[key] = mode === 'preview' ? `⟦${key}⟧` : null;
      continue;
    }
    resolved[key] = value;
  }
  const text = template.replace(VARIABLE_FIND, (_, key) => {
    if (Object.prototype.hasOwnProperty.call(resolved, key) && resolved[key] != null) {
      return String(resolved[key]);
    }
    if (mode === 'preview') return `⟦${key}⟧`;
    return `{{${key}}}`;
  });
  return {
    text,
    resolved,
    unresolved,
    blocked,
    ok: unresolved.length === 0 && blocked.length === 0,
  };
}

function resolveValue(key, ctx) {
  return resolveOne(key, ctx);
}

module.exports = {
  resolveVariables,
  resolveValue,
  getPath,
};
