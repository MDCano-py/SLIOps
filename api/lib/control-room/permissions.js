/**
 * Control Room capability helpers (existing SLIOps RBAC — no parallel system).
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

module.exports = {
  CONTROL_ROOM_PERMS,
  hasElevated,
  hasCrPerm,
  hasAnyCrPerm,
  canViewControlRoom,
};
