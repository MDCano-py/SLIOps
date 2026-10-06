/**
 * WOS-93 configuration permission helpers.
 * Maps into the existing PERMISSION_CATALOG (ids must match maintainx.js).
 */

const CONFIG_PERMISSIONS = Object.freeze([
  'configuration.view',
  'configuration.edit',
  'configuration.publish',
  'configuration.archive',
  'workflow.execute',
  'workflow.manage',
  'form.manage',
  'document.manage',
  'dashboard.manage',
  'variable.manage',
]);

const VIEW_ANY = ['configuration.view', 'configuration.edit', 'configuration.publish', 'hub_admin', 'admin'];
const EDIT_ANY = ['configuration.edit', 'configuration.publish', 'hub_admin', 'admin'];
const PUBLISH_ANY = ['configuration.publish', 'hub_admin', 'admin'];
const ARCHIVE_ANY = ['configuration.archive', 'configuration.publish', 'hub_admin', 'admin'];

function hasAny(permissions, needed) {
  if (!Array.isArray(permissions)) return false;
  if (permissions.includes('admin') || permissions.includes('hub_admin')) return true;
  const need = Array.isArray(needed) ? needed : [needed];
  return need.some((id) => permissions.includes(id));
}

function canViewConfiguration(permissions, isAdmin) {
  return !!isAdmin || hasAny(permissions, VIEW_ANY);
}

function canEditConfiguration(permissions, isAdmin) {
  return !!isAdmin || hasAny(permissions, EDIT_ANY);
}

function canPublishConfiguration(permissions, isAdmin) {
  return !!isAdmin || hasAny(permissions, PUBLISH_ANY);
}

function canArchiveConfiguration(permissions, isAdmin) {
  return !!isAdmin || hasAny(permissions, ARCHIVE_ANY);
}

function canManageKind(permissions, isAdmin, kind) {
  if (canEditConfiguration(permissions, isAdmin)) return true;
  const map = {
    form: ['form.manage'],
    document: ['document.manage'],
    workflow: ['workflow.manage'],
    dashboard: ['dashboard.manage'],
    variable: ['variable.manage'],
    request_type: EDIT_ANY,
    saved_view: EDIT_ANY,
  };
  return hasAny(permissions, map[kind] || EDIT_ANY);
}

function canExecuteWorkflow(permissions, isAdmin) {
  return !!isAdmin || hasAny(permissions, ['workflow.execute', 'hub_admin', 'admin']);
}

module.exports = {
  CONFIG_PERMISSIONS,
  canViewConfiguration,
  canEditConfiguration,
  canPublishConfiguration,
  canArchiveConfiguration,
  canManageKind,
  canExecuteWorkflow,
  hasAny,
};
