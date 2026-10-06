/**
 * Control Room capability helpers (existing SLIOps RBAC — no parallel system).
 *
 * Resource scope (current default — until Streamline defines station isolation):
 * - Operational CR records are shared among users who hold the required
 *   control_room_* capability for the action.
 * - Do NOT use created_by === actor as an access gate.
 * - Station isolation is NOT enforced. Helpers accept an optional stationId so
 *   scoping can be added later without redesigning routes/APIs.
 */

const CONTROL_ROOM_PERMS = Object.freeze({
  view: 'control_room_view',
  log: 'control_room_log',
  acknowledge: 'control_room_acknowledge',
  handover: 'control_room_handover',
  taskManage: 'control_room_task_manage',
  boardManage: 'control_room_board_manage',
  scheduleView: 'control_room_schedule_view',
  scheduleManage: 'control_room_schedule_manage',
  supervisor: 'control_room_supervisor',
});

/** Operator pack — view + day-to-day shift work (no schedule edit / supervisor). */
const CONTROL_ROOM_OPERATOR_PERMS = Object.freeze([
  CONTROL_ROOM_PERMS.view,
  CONTROL_ROOM_PERMS.log,
  CONTROL_ROOM_PERMS.acknowledge,
  CONTROL_ROOM_PERMS.handover,
  CONTROL_ROOM_PERMS.taskManage,
  CONTROL_ROOM_PERMS.boardManage,
  CONTROL_ROOM_PERMS.scheduleView,
]);

/** Privileged pack — operator + schedule manage + supervisor overview. */
const CONTROL_ROOM_SUPERVISOR_PERMS = Object.freeze([
  ...CONTROL_ROOM_OPERATOR_PERMS,
  CONTROL_ROOM_PERMS.scheduleManage,
  CONTROL_ROOM_PERMS.supervisor,
]);

/**
 * Future hook: set process.env.CONTROL_ROOM_STATION_SCOPE=on and pass
 * allowedStationIds on the auth context when product defines isolation.
 * Until then this always returns true when the caller has the capability.
 */
function isStationScopeEnabled() {
  return String(process.env.CONTROL_ROOM_STATION_SCOPE || '').toLowerCase() === 'on';
}

function hasElevated(permissions) {
  const p = Array.isArray(permissions) ? permissions : [];
  return p.includes('admin') || p.includes('hub_admin');
}

function hasCrPerm(permissions, id) {
  if (hasElevated(permissions)) return true;
  const p = Array.isArray(permissions) ? permissions : [];
  return p.includes(id);
}

function hasAnyCrPerm(permissions, ids) {
  return (Array.isArray(ids) ? ids : [ids]).some((id) => hasCrPerm(permissions, id));
}

function canViewControlRoom(permissions) {
  return hasAnyCrPerm(permissions, [
    CONTROL_ROOM_PERMS.view,
    CONTROL_ROOM_PERMS.log,
    CONTROL_ROOM_PERMS.acknowledge,
    CONTROL_ROOM_PERMS.handover,
    CONTROL_ROOM_PERMS.taskManage,
    CONTROL_ROOM_PERMS.boardManage,
    CONTROL_ROOM_PERMS.scheduleView,
    CONTROL_ROOM_PERMS.supervisor,
  ]);
}

/**
 * Shared-capability resource access.
 * @param {string[]} permissions
 * @param {string} requiredPerm - control_room_* capability for the action
 * @param {{ stationId?: string|null, allowedStationIds?: string[]|null, createdBy?: string|null, actorEmail?: string|null }} [scope]
 * @returns {boolean}
 */
function canAccessCrResource(permissions, requiredPerm, scope = {}) {
  if (!hasCrPerm(permissions, requiredPerm)) return false;
  // Explicitly ignore created_by ownership — operational records are shared.
  void scope.createdBy;
  void scope.actorEmail;
  if (!isStationScopeEnabled()) return true;
  const stationId = scope.stationId || null;
  if (!stationId) return false;
  const allowed = Array.isArray(scope.allowedStationIds) ? scope.allowedStationIds : null;
  if (!allowed) return false;
  return allowed.includes(stationId);
}

module.exports = {
  CONTROL_ROOM_PERMS,
  CONTROL_ROOM_OPERATOR_PERMS,
  CONTROL_ROOM_SUPERVISOR_PERMS,
  hasElevated,
  hasCrPerm,
  hasAnyCrPerm,
  canViewControlRoom,
  canAccessCrResource,
  isStationScopeEnabled,
};
