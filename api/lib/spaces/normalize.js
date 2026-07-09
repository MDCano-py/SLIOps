/**
 * WOS-58 — App spaces + launch registry normalization.
 */

const SAFE_KEY_RE = /^[a-z][a-z0-9_]{1,63}$/;

const ROUTE_TYPES = new Set([
  'template_builder',
  'template_runtime_placeholder',
  'template_submission_new',
  'template_submissions',
  'workflow_queue_placeholder',
]);

const DEFAULT_VISIBLE_ROLES = ['requester', 'employee', 'manager', 'admin', 'hub_admin'];

function normalizeRoleList(roles, { preserveEmpty = false } = {}) {
  if (!Array.isArray(roles)) return preserveEmpty ? [] : [...DEFAULT_VISIBLE_ROLES];
  const cleaned = roles.map((r) => String(r || '').trim()).filter(Boolean);
  if (!cleaned.length) return preserveEmpty ? [] : [...DEFAULT_VISIBLE_ROLES];
  return cleaned;
}

function rolesCanSee(visibleToRoles, permissions, isAdmin, assignedRoleKeys = null) {
  if (isAdmin) return true;
  if (!Array.isArray(visibleToRoles)) return true;
  const cleaned = visibleToRoles.map((r) => String(r || '').trim()).filter(Boolean);
  if (!cleaned.length) return true;
  const perms = Array.isArray(permissions) ? permissions : [];
  const assigned = Array.isArray(assignedRoleKeys)
    ? assignedRoleKeys.map((r) => String(r || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const actorRoles = new Set([...perms.map((p) => String(p).toLowerCase()), ...assigned]);
  return cleaned.some((r) => actorRoles.has(String(r).toLowerCase()));
}

function normalizeSpaceKey(key) {
  const k = String(key || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!SAFE_KEY_RE.test(k)) {
    const err = new Error('Invalid space key — use lowercase letters, numbers, underscores');
    err.code = 'INVALID_KEY';
    err.status = 400;
    throw err;
  }
  return k;
}

function normalizeSpaceInput(input = {}, existing = null) {
  const base = existing || {};
  const key = input.key != null ? normalizeSpaceKey(input.key) : base.key;
  const label = input.label != null ? String(input.label).trim() : base.label;
  if (!label) {
    const err = new Error('label is required');
    err.code = 'VALIDATION';
    err.status = 400;
    throw err;
  }
  return {
    key,
    label,
    description: input.description != null ? String(input.description).trim() || null : base.description ?? null,
    icon: input.icon != null ? String(input.icon).trim() || null : base.icon ?? null,
    status: ['active', 'archived'].includes(input.status) ? input.status : base.status || 'active',
    sort_order:
      input.sort_order != null ? Number(input.sort_order) : base.sort_order != null ? base.sort_order : 0,
    visible_to_roles_json: normalizeRoleList(
      input.visible_to_roles != null ? input.visible_to_roles : base.visible_to_roles_json
    ),
  };
}

function normalizeLaunchConfig(input = {}, template = null) {
  const base = template?.launch_config_json && typeof template.launch_config_json === 'object'
    ? template.launch_config_json
    : {};
  const merged = { ...base, ...(input || {}) };
  const routeType = merged.route_type || 'template_runtime_placeholder';
  if (!ROUTE_TYPES.has(routeType)) {
    const err = new Error(`Invalid route_type: ${routeType}`);
    err.code = 'VALIDATION';
    err.status = 400;
    throw err;
  }
  const visibilityMode =
    merged.visibility_mode === 'specific' || merged.visibility_mode === 'everyone'
      ? merged.visibility_mode
      : Array.isArray(merged.visible_to_roles) && merged.visible_to_roles.length
        ? 'specific'
        : 'everyone';
  const visible_to_roles =
    visibilityMode === 'everyone'
      ? []
      : normalizeRoleList(merged.visible_to_roles, { preserveEmpty: true });
  return {
    enabled: merged.enabled !== false,
    space_key: merged.space_key ? normalizeSpaceKey(merged.space_key) : null,
    label: merged.label != null ? String(merged.label).trim() || null : null,
    description: merged.description != null ? String(merged.description).trim() || null : null,
    icon: merged.icon != null ? String(merged.icon).trim() || null : null,
    route_type: routeType,
    quick_action_enabled: merged.quick_action_enabled === true,
    visibility_mode: visibilityMode,
    visible_to_roles,
    sort_order: merged.sort_order != null ? Number(merged.sort_order) : 0,
  };
}

function inferDefaultSpaceKey(template) {
  const cfg = template?.launch_config_json || {};
  if (cfg.space_key) return cfg.space_key;
  const key = String(template?.key || '');
  const desc = String(template?.description || '');
  if (key.startsWith('doc_') || desc.includes('[document-backed]')) return 'documents';
  if (key.startsWith('form_')) return 'forms';
  return 'workflows';
}

module.exports = {
  ROUTE_TYPES,
  DEFAULT_VISIBLE_ROLES,
  normalizeRoleList,
  normalizeSpaceKey,
  normalizeSpaceInput,
  normalizeLaunchConfig,
  inferDefaultSpaceKey,
  rolesCanSee,
};
