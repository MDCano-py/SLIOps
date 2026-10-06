/**
 * /hub/control-room/* routes
 */
const authErrors = require('../auth-errors');
const { recordSecurityAudit } = require('../security-audit');
const { getControlRoomStore } = require('./store');
const { CONTROL_ROOM_PERMS, hasCrPerm, canViewControlRoom } = require('./permissions');

function json(res, status, body) {
  res.status(status).json(body);
  return true;
}

function parseBody(req) {
  if (!req.body) return null;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return typeof req.body === 'object' ? req.body : null;
}

function queryOf(req) {
  return req.query || {};
}

async function handleControlRoomRoutes(path, req, res, ctx) {
  if (!path.startsWith('/hub/control-room')) return false;

  const { actorEmail, permissions } = ctx;
  const method = req.method;
  const store = getControlRoomStore();
  const q = queryOf(req);

  function requireActor() {
    if (!actorEmail) {
      json(res, 401, authErrors.wosAuthRequiredBody());
      return false;
    }
    return true;
  }

  function requirePerm(permId) {
    if (!requireActor()) return false;
    if (!hasCrPerm(permissions, permId)) {
      json(res, 403, authErrors.wosForbiddenBody());
      return false;
    }
    return true;
  }

  if (!canViewControlRoom(permissions) && method === 'GET') {
    if (!requireActor()) return true;
    return json(res, 403, authErrors.wosForbiddenBody());
  }

  // GET /hub/control-room/meta
  if (path === '/hub/control-room/meta' && method === 'GET') {
    if (!requireActor()) return true;
    if (!canViewControlRoom(permissions)) return json(res, 403, authErrors.wosForbiddenBody());
    const stations = await store.listStations();
    const units = await store.listUnits(q.station_id || stations[0]?.id);
    return json(res, 200, { stations, units, store: store.kind });
  }

  // POST /hub/control-room/shifts/ensure — ensure active shift + assignment
  if (path === '/hub/control-room/shifts/ensure' && method === 'POST') {
    if (!requireActor()) return true;
    if (!canViewControlRoom(permissions)) return json(res, 403, authErrors.wosForbiddenBody());
    const body = parseBody(req) || {};
    const ctxShift = await store.ensureActiveShift({
      stationId: body.station_id || q.station_id,
      actorEmail,
      startsAt: body.starts_at,
      endsAt: body.ends_at,
      name: body.name,
    });
    recordSecurityAudit('control_room.shift_ensure', {
      actor: actorEmail,
      shift_id: ctxShift.shift?.id,
      station_id: ctxShift.station?.id,
    });
    return json(res, 200, ctxShift);
  }

  // GET /hub/control-room/current
  if (path === '/hub/control-room/current' && method === 'GET') {
    if (!requireActor()) return true;
    if (!canViewControlRoom(permissions)) return json(res, 403, authErrors.wosForbiddenBody());
    let ctxShift = await store.getCurrentShiftContext(q.station_id, actorEmail);
    if (!ctxShift.shift) {
      ctxShift = await store.ensureActiveShift({ stationId: q.station_id, actorEmail });
    }
    return json(res, 200, ctxShift);
  }

  // Logs
  if (path === '/hub/control-room/logs' && method === 'GET') {
    if (!requireActor()) return true;
    if (!canViewControlRoom(permissions)) return json(res, 403, authErrors.wosForbiddenBody());
    const logs = await store.listLogs({
      shift_id: q.shift_id,
      station_id: q.station_id,
      unit_id: q.unit_id,
      category: q.category,
      priority: q.priority,
      ack: q.ack,
    });
    return json(res, 200, { logs });
  }

  if (path === '/hub/control-room/logs' && method === 'POST') {
    if (!requirePerm(CONTROL_ROOM_PERMS.log)) return true;
    const body = parseBody(req);
    if (!body || !body.summary) return json(res, 400, { error: 'summary required' });
    let shiftId = body.shift_id;
    let stationId = body.station_id;
    if (!shiftId || !stationId) {
      const cur = await store.ensureActiveShift({ stationId, actorEmail });
      shiftId = shiftId || cur.shift?.id;
      stationId = stationId || cur.station?.id;
    }
    const log = await store.createLog({
      ...body,
      shift_id: shiftId,
      station_id: stationId,
      created_by: actorEmail,
    });
    recordSecurityAudit('control_room.log_create', {
      actor: actorEmail,
      log_id: log.id,
      shift_id: log.shift_id,
      priority: log.priority,
    });
    return json(res, 201, { log });
  }

  const logMatch = path.match(/^\/hub\/control-room\/logs\/([^/]+)(?:\/(revisions))?$/);
  if (logMatch) {
    const logId = decodeURIComponent(logMatch[1]);
    const sub = logMatch[2];
    if (sub === 'revisions' && method === 'GET') {
      if (!requireActor()) return true;
      if (!canViewControlRoom(permissions)) return json(res, 403, authErrors.wosForbiddenBody());
      const revisions = await store.listLogRevisions(logId);
      return json(res, 200, { revisions });
    }
    if (method === 'PATCH') {
      if (!requirePerm(CONTROL_ROOM_PERMS.log)) return true;
      const body = parseBody(req) || {};
      const log = await store.updateLog(logId, body, actorEmail);
      if (!log) return json(res, 404, { error: 'Log not found' });
      recordSecurityAudit('control_room.log_update', { actor: actorEmail, log_id: logId });
      return json(res, 200, { log });
    }
  }

  // Acknowledgements
  if (path === '/hub/control-room/acknowledgements' && method === 'POST') {
    if (!requirePerm(CONTROL_ROOM_PERMS.acknowledge)) return true;
    const body = parseBody(req);
    if (!body?.target_type || !body?.target_id) {
      return json(res, 400, { error: 'target_type and target_id required' });
    }
    const result = await store.acknowledge({
      target_type: body.target_type,
      target_id: body.target_id,
      user_email: actorEmail,
      shift_id: body.shift_id || null,
    });
    recordSecurityAudit('control_room.acknowledge', {
      actor: actorEmail,
      target_type: body.target_type,
      target_id: body.target_id,
      duplicate: result.duplicate,
    });
    return json(res, result.duplicate ? 200 : 201, result);
  }

  // Board
  if (path === '/hub/control-room/board' && method === 'GET') {
    if (!requireActor()) return true;
    if (!canViewControlRoom(permissions)) return json(res, 403, authErrors.wosForbiddenBody());
    const items = await store.listBoard({
      station_id: q.station_id,
      status: q.status,
      open_only: q.open_only === 'true',
    });
    return json(res, 200, { items });
  }

  if (path === '/hub/control-room/board' && method === 'POST') {
    if (!requirePerm(CONTROL_ROOM_PERMS.boardManage)) return true;
    const body = parseBody(req);
    if (!body?.title) return json(res, 400, { error: 'title required' });
    let stationId = body.station_id;
    if (!stationId) {
      const cur = await store.ensureActiveShift({ actorEmail });
      stationId = cur.station?.id;
    }
    const item = await store.createBoard({ ...body, station_id: stationId, created_by: actorEmail });
    recordSecurityAudit('control_room.board_create', { actor: actorEmail, board_id: item.id });
    return json(res, 201, { item });
  }

  const boardMatch = path.match(/^\/hub\/control-room\/board\/([^/]+)(?:\/(resolve))?$/);
  if (boardMatch) {
    const boardId = decodeURIComponent(boardMatch[1]);
    const action = boardMatch[2];
    if (action === 'resolve' && method === 'POST') {
      if (!requirePerm(CONTROL_ROOM_PERMS.boardManage)) return true;
      const body = parseBody(req) || {};
      const item = await store.resolveBoard(boardId, actorEmail, body.resolution_note);
      if (!item) return json(res, 404, { error: 'Board item not found' });
      recordSecurityAudit('control_room.board_resolve', { actor: actorEmail, board_id: boardId });
      return json(res, 200, { item });
    }
    if (method === 'PATCH') {
      if (!requirePerm(CONTROL_ROOM_PERMS.boardManage)) return true;
      const body = parseBody(req) || {};
      const item = await store.updateBoard(boardId, body, actorEmail);
      if (!item) return json(res, 404, { error: 'Board item not found' });
      recordSecurityAudit('control_room.board_update', { actor: actorEmail, board_id: boardId });
      return json(res, 200, { item });
    }
  }

  // Tasks
  if (path === '/hub/control-room/tasks' && method === 'GET') {
    if (!requireActor()) return true;
    if (!canViewControlRoom(permissions)) return json(res, 403, authErrors.wosForbiddenBody());
    const tasks = await store.listTasks({
      station_id: q.station_id,
      assignee_email: q.assignee_email,
      status: q.status,
      open_only: q.open_only === 'true',
    });
    return json(res, 200, { tasks });
  }

  if (path === '/hub/control-room/tasks' && method === 'POST') {
    if (!requirePerm(CONTROL_ROOM_PERMS.taskManage)) return true;
    const body = parseBody(req);
    if (!body?.title) return json(res, 400, { error: 'title required' });
    let stationId = body.station_id;
    if (!stationId) {
      const cur = await store.ensureActiveShift({ actorEmail });
      stationId = cur.station?.id;
    }
    const task = await store.createTask({ ...body, station_id: stationId, created_by: actorEmail });
    recordSecurityAudit('control_room.task_create', { actor: actorEmail, task_id: task.id });
    return json(res, 201, { task });
  }

  const taskMatch = path.match(/^\/hub\/control-room\/tasks\/([^/]+)$/);
  if (taskMatch && method === 'PATCH') {
    if (!requirePerm(CONTROL_ROOM_PERMS.taskManage)) return true;
    const taskId = decodeURIComponent(taskMatch[1]);
    const body = parseBody(req) || {};
    const task = await store.updateTask(taskId, body, actorEmail);
    if (!task) return json(res, 404, { error: 'Task not found' });
    recordSecurityAudit('control_room.task_update', {
      actor: actorEmail,
      task_id: taskId,
      status: task.status,
    });
    return json(res, 200, { task });
  }

  // Handover
  if (path === '/hub/control-room/handovers' && method === 'GET') {
    if (!requireActor()) return true;
    if (!canViewControlRoom(permissions)) return json(res, 403, authErrors.wosForbiddenBody());
    const handovers = await store.listHandovers(q.station_id);
    return json(res, 200, { handovers });
  }

  if (path === '/hub/control-room/handovers' && method === 'POST') {
    if (!requirePerm(CONTROL_ROOM_PERMS.handover)) return true;
    const body = parseBody(req) || {};
    const cur = await store.ensureActiveShift({ stationId: body.station_id, actorEmail });
    if (!cur.shift) return json(res, 400, { error: 'No active shift' });
    const handover = await store.createHandover({
      outgoing_shift_id: body.outgoing_shift_id || cur.shift.id,
      incoming_shift_id: body.incoming_shift_id || null,
      station_id: body.station_id || cur.station.id,
      outgoing_note: body.outgoing_note,
      outgoing_by: actorEmail,
    });
    if (body.complete_outgoing_shift) {
      await store.completeShift(handover.outgoing_shift_id);
    }
    recordSecurityAudit('control_room.handover_submit', {
      actor: actorEmail,
      handover_id: handover.id,
      outgoing_shift_id: handover.outgoing_shift_id,
    });
    return json(res, 201, { handover });
  }

  const hoMatch = path.match(/^\/hub\/control-room\/handovers\/([^/]+)\/ack$/);
  if (hoMatch && method === 'POST') {
    if (!requirePerm(CONTROL_ROOM_PERMS.handover)) return true;
    const id = decodeURIComponent(hoMatch[1]);
    const handover = await store.ackHandover(id, actorEmail);
    if (!handover) return json(res, 404, { error: 'Handover not found' });
    recordSecurityAudit('control_room.handover_ack', { actor: actorEmail, handover_id: id });
    return json(res, 200, { handover });
  }

  // Schedule
  if (path === '/hub/control-room/schedule' && method === 'GET') {
    if (!requireActor()) return true;
    if (
      !hasCrPerm(permissions, CONTROL_ROOM_PERMS.scheduleView) &&
      !hasCrPerm(permissions, CONTROL_ROOM_PERMS.supervisor) &&
      !canViewControlRoom(permissions)
    ) {
      return json(res, 403, authErrors.wosForbiddenBody());
    }
    const result = await store.listSchedule({
      station_id: q.station_id,
      work_date: q.work_date,
      operator_email: q.operator_email,
    });
    return json(res, 200, result);
  }

  if (path === '/hub/control-room/schedule' && method === 'POST') {
    if (!requirePerm(CONTROL_ROOM_PERMS.scheduleManage)) return true;
    const body = parseBody(req);
    if (!body?.operator_email || !body?.work_date || !body?.starts_at || !body?.ends_at) {
      return json(res, 400, { error: 'operator_email, work_date, starts_at, ends_at required' });
    }
    let stationId = body.station_id;
    if (!stationId) {
      const cur = await store.ensureActiveShift({ actorEmail });
      stationId = cur.station?.id;
    }
    const assignment = await store.createSchedule({
      ...body,
      station_id: stationId,
      created_by: actorEmail,
    });
    recordSecurityAudit('control_room.schedule_create', {
      actor: actorEmail,
      schedule_id: assignment.id,
      operator_email: assignment.operator_email,
    });
    return json(res, 201, { assignment });
  }

  // History
  if (path === '/hub/control-room/history' && method === 'GET') {
    if (!requireActor()) return true;
    if (!canViewControlRoom(permissions)) return json(res, 403, authErrors.wosForbiddenBody());
    const items = await store.listHistory({
      station_id: q.station_id,
      unit_id: q.unit_id,
      shift_id: q.shift_id,
      operator: q.operator,
      category: q.category,
      priority: q.priority,
      record_type: q.record_type,
      status: q.status,
      date_from: q.date_from,
      date_to: q.date_to,
    });
    return json(res, 200, { items });
  }

  // Supervisor
  if (path === '/hub/control-room/supervisor' && method === 'GET') {
    if (!requirePerm(CONTROL_ROOM_PERMS.supervisor)) return true;
    const overview = await store.getSupervisorOverview(q.station_id);
    return json(res, 200, overview);
  }

  return json(res, 404, { error: 'Control Room route not found', path });
}

module.exports = { handleControlRoomRoutes };
