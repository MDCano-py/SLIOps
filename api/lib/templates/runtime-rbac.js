/**
 * WOS-62 / WOS-72 — Runtime RBAC helpers for launch + submission actions.
 */

const EXTERNAL_ASSIGNEE_ROLES = new Set(['client', 'vendor', 'external']);

const ADMIN_ROLES = new Set(['admin', 'hub_admin', 'operations']);

function isExternalAssigneeRole(role) {
  return EXTERNAL_ASSIGNEE_ROLES.has(String(role || '').trim().toLowerCase());
}

function userAssigneeRoles(permissions, isAdmin, assignedRoleKeys = null) {
  const roles = new Set(['requester', 'employee']);
  if (Array.isArray(assignedRoleKeys)) {
    assignedRoleKeys.forEach((k) => {
      const key = String(k || '').trim().toLowerCase();
      if (key) roles.add(key);
    });
  }
  if (!Array.isArray(permissions)) permissions = [];
  if (isAdmin) {
    return new Set(['admin', 'hub_admin', 'requester', 'employee', 'manager', 'ap', 'legal', 'operations']);
  }
  permissions.forEach((p) => {
    const perm = String(p).toLowerCase();
    if (perm === 'hub_admin' || perm === 'admin') roles.add('admin');
    if (perm === 'manager' || perm.includes('manager')) roles.add('manager');
    if (perm === 'operations' || perm.includes('operations')) roles.add('operations');
    if (perm === 'ap' || perm.includes('_ap')) roles.add('ap');
    if (perm === 'legal' || perm.includes('legal')) roles.add('legal');
  });
  return roles;
}

function canInspectSubmission(permissions, isAdmin, submission, actorEmail, assignedRoleKeys = null) {
  if (isAdmin) return true;
  if (submission?.created_by && actorEmail && submission.created_by === actorEmail) return true;
  return userAssigneeRoles(permissions, false, assignedRoleKeys).has('admin');
}

function canActOnStep(permissions, isAdmin, stepInstance, assignedRoleKeys = null) {
  if (!stepInstance || stepInstance.status !== 'pending') return false;
  // External assignee steps are secure-link only (action.html) — portal session cannot act.
  if (isExternalAssigneeRole(stepInstance.assignee_role)) return false;
  if (isAdmin) return true;
  const role = stepInstance.assignee_role || 'requester';
  return userAssigneeRoles(permissions, false, assignedRoleKeys).has(role);
}

module.exports = {
  userAssigneeRoles,
  canInspectSubmission,
  canActOnStep,
  ADMIN_ROLES,
  isExternalAssigneeRole,
  EXTERNAL_ASSIGNEE_ROLES,
};
