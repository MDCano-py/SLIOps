/**
 * /hub/control-room/* routes
 */
const authErrors = require('../auth-errors');
const { recordSecurityAudit } = require('../security-audit');
const { getControlRoomStore } = require('./store');
const {
  CONTROL_ROOM_PERMS,
  hasCrPerm,
  hasElevated,
  canViewControlRoom,
  canAccessCrResource,
} = require('./permissions');

function slugifyKey(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function canManageStations(permissions) {
  return hasElevated(permissions) || hasCrPerm(permissions, CONTROL_ROOM_PERMS.supervisor);
}

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

/** Defense-in-depth: strip embedded ?query from proxied path values. */
function normalizeHubPath(path, req) {
  if (typeof path !== 'string' || !path.includes('?')) return path;
  const qi = path.indexOf('?');
  const embedded = new URLSearchParams(path.slice(qi + 1));
  if (!req.query || typeof req.query !== 'object') req.query = {};
  for (const [k, v] of embedded.entries()) {
    if (k === 'path') continue;
    if (req.query[k] == null) req.query[k] = v;
  }
  return path.slice(0, qi);
}

async function handleControlRoomRoutes(rawPath, req, res, ctx) {
  const path = normalizeHubPath(rawPath, req);
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

  function requirePerm(permId, scope = {}) {
    if (!requireActor()) return false;
    // Shared-capability default: capability required; created_by is never an access gate.
    // Optional stationId/allowedStationIds reserved for future CONTROL_ROOM_STATION_SCOPE=on.
    if (!canAccessCrResource(permissions, permId, scope)) {
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
    const body = { stations, units };
    // Store kind is a diagnostic — only for hub/admin
    if (hasElevated(permissions)) body.store = store.kind;
    return json(res, 200, body);
  }

  // POST /hub/control-room/stations — authorized bootstrap (no fake defaults)
  if (path === '/hub/control-room/stations' && method === 'POST') {
    if (!requireActor()) return true;
    if (!canManageStations(permissions)) return json(res, 403, authErrors.wosForbiddenBody());
    if (typeof store.createStation !== 'function') {
      return json(res, 501, { error: 'Station create not supported by this store', code: 'CR_STORE_UNSUPPORTED' });
    }
    const body = parseBody(req) || {};
    const name = String(body.name || '').trim();
    const key = slugifyKey(body.key || name);
    if (!name || !key) {
      return json(res, 400, { error: 'Station name is required', code: 'CR_STATION_INVALID' });
    }
    try {
      const station = await store.createStation({ key, name });
      recordSecurityAudit('control_room.station_create', {
        actor: actorEmail,
        station_id: station.id,
        key: station.key,
      });
      return json(res, 201, { station });
    } catch (err) {
      return json(res, 400, { error: err.message || 'Could not create station', code: 'CR_STATION_CREATE_FAILED' });
    }
  }

  // POST /hub/control-room/units — authorized bootstrap
  if (path === '/hub/control-room/units' && method === 'POST') {
    if (!requireActor()) return true;
    if (!canManageStations(permissions)) return json(res, 403, authErrors.wosForbiddenBody());
    if (typeof store.createUnit !== 'function') {
      return json(res, 501, { error: 'Unit create not supported by this store', code: 'CR_STORE_UNSUPPORTED' });
    }
    const body = parseBody(req) || {};
    const name = String(body.name || '').trim();
    const stationId = body.station_id || q.station_id;
    const key = slugifyKey(body.key || name);
    if (!stationId || !name || !key) {
      return json(res, 400, {
        error: 'station_id and unit name are required',
        code: 'CR_UNIT_INVALID',
      });
    }
    try {
      const unit = await store.createUnit({ station_id: stationId, key, name });
      recordSecurityAudit('control_room.unit_create', {
        actor: actorEmail,
        station_id: stationId,
        unit_id: unit.id,
        key: unit.key,
      });
      return json(res, 201, { unit });
    } catch (err) {
      return json(res, 400, { error: err.message || 'Could not create unit', code: 'CR_UNIT_CREATE_FAILED' });
    }
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
    if (ctxShift.needs_bootstrap) return json(res, 200, ctxShift);
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
    const body = parseBody(req);
    if (!requirePerm(CONTROL_ROOM_PERMS.log, { stationId: body?.station_id })) return true;
    if (!body || !body.summary) return json(res, 400, { error: 'summary required' });
    let shiftId = body.shift_id;
    let stationId = body.station_id;
    if (!shiftId || !stationId) {
      const cur = await store.ensureActiveShift({ stationId, actorEmail });
      if (cur.needs_bootstrap) {
        return json(res, 409, {
          error: 'Control Room stations not bootstrapped',
          code: 'CR_NEEDS_BOOTSTRAP',
          message: cur.bootstrap_message,
        });
      }
      shiftId = shiftId || cur.shift?.id;
      stationId = stationId || cur.station?.id;
    }
    if (!stationId || !shiftId) {
      return json(res, 409, {
        error: 'Control Room stations not bootstrapped',
        code: 'CR_NEEDS_BOOTSTRAP',
      });
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
    const body = parseBody(req);
    if (!requirePerm(CONTROL_ROOM_PERMS.boardManage, { stationId: body?.station_id })) return true;
    if (!body?.title) return json(res, 400, { error: 'title required' });
    let stationId = body.station_id;
    if (!stationId) {
      const cur = await store.ensureActiveShift({ actorEmail });
      if (cur.needs_bootstrap) {
        return json(res, 409, {
          error: 'Control Room stations not bootstrapped',
          code: 'CR_NEEDS_BOOTSTRAP',
          message: cur.bootstrap_message,
        });
      }
      stationId = cur.station?.id;
    }
    if (!stationId) {
      return json(res, 409, { error: 'Control Room stations not bootstrapped', code: 'CR_NEEDS_BOOTSTRAP' });
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
    const body = parseBody(req);
    if (!requirePerm(CONTROL_ROOM_PERMS.taskManage, { stationId: body?.station_id })) return true;
    if (!body?.title) return json(res, 400, { error: 'title required' });
    let stationId = body.station_id;
    if (!stationId) {
      const cur = await store.ensureActiveShift({ actorEmail });
      if (cur.needs_bootstrap) {
        return json(res, 409, {
          error: 'Control Room stations not bootstrapped',
          code: 'CR_NEEDS_BOOTSTRAP',
          message: cur.bootstrap_message,
        });
      }
      stationId = cur.station?.id;
    }
    if (!stationId) {
      return json(res, 409, { error: 'Control Room stations not bootstrapped', code: 'CR_NEEDS_BOOTSTRAP' });
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
      work_date_from: q.work_date_from,
      work_date_to: q.work_date_to,
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
      if (cur.needs_bootstrap) {
        return json(res, 409, {
          error: 'Control Room stations not bootstrapped',
          code: 'CR_NEEDS_BOOTSTRAP',
          message: cur.bootstrap_message,
        });
      }
      stationId = cur.station?.id;
    }
    if (!stationId) {
      return json(res, 409, {
        error: 'Control Room stations not bootstrapped',
        code: 'CR_NEEDS_BOOTSTRAP',
      });
    }
    const operatorEmail = String(body.operator_email).trim().toLowerCase();
    const operatorUserId = body.operator_user_id
      ? String(body.operator_user_id).trim()
      : operatorEmail;
    const existing = await store.listSchedule({
      station_id: stationId,
      work_date: body.work_date,
    });
    const candidate = {
      id: 'pending',
      station_id: stationId,
      operator_email: operatorEmail,
      starts_at: body.starts_at,
      ends_at: body.ends_at,
    };
    const { detectScheduleOverlaps } = require('./logic');
    const overlaps = detectScheduleOverlaps([...(existing.assignments || []), candidate]);
    if (overlaps.length) {
      return json(res, 409, {
        error: 'Schedule assignment overlaps an existing assignment for this station or operator.',
        code: 'CR_SCHEDULE_OVERLAP',
        overlaps,
      });
    }
    const assignment = await store.createSchedule({
      ...body,
      station_id: stationId,
      operator_email: operatorEmail,
      created_by: actorEmail,
    });
    recordSecurityAudit('control_room.schedule_create', {
      actor: actorEmail,
      schedule_id: assignment.id,
      operator_email: assignment.operator_email,
      operator_user_id: operatorUserId,
    });
    return json(res, 201, {
      assignment: { ...assignment, operator_user_id: operatorUserId },
    });
  }

  const scheduleIdMatch = path.match(/^\/hub\/control-room\/schedule\/([^/]+)$/);
  if (scheduleIdMatch && method === 'PATCH') {
    if (!requirePerm(CONTROL_ROOM_PERMS.scheduleManage)) return true;
    const scheduleId = decodeURIComponent(scheduleIdMatch[1]);
    const body = parseBody(req) || {};
    const existingRow = await store.getScheduleById(scheduleId);
    if (!existingRow) return json(res, 404, { error: 'Schedule assignment not found' });
    const next = {
      operator_email:
        body.operator_email != null
          ? String(body.operator_email).trim().toLowerCase()
          : existingRow.operator_email,
      work_date: body.work_date != null ? body.work_date : existingRow.work_date,
      starts_at: body.starts_at != null ? body.starts_at : existingRow.starts_at,
      ends_at: body.ends_at != null ? body.ends_at : existingRow.ends_at,
      role_context: body.role_context !== undefined ? body.role_context : existingRow.role_context,
    };
    if (new Date(next.ends_at) <= new Date(next.starts_at)) {
      return json(res, 400, { error: 'ends_at must be after starts_at' });
    }
    const dayList = await store.listSchedule({
      station_id: existingRow.station_id,
      work_date: next.work_date,
    });
    const candidate = {
      id: scheduleId,
      station_id: existingRow.station_id,
      operator_email: next.operator_email,
      starts_at: next.starts_at,
      ends_at: next.ends_at,
    };
    const { detectScheduleOverlaps } = require('./logic');
    const peers = (dayList.assignments || []).filter((a) => a.id !== scheduleId);
    const overlaps = detectScheduleOverlaps([...peers, candidate]);
    if (overlaps.length) {
      return json(res, 409, {
        error: 'Schedule assignment overlaps an existing assignment for this station or operator.',
        code: 'CR_SCHEDULE_OVERLAP',
        overlaps,
      });
    }
    const assignment = await store.updateSchedule(scheduleId, {
      ...next,
      updated_by: actorEmail,
    });
    recordSecurityAudit('control_room.schedule_update', {
      actor: actorEmail,
      schedule_id: scheduleId,
      operator_email: assignment.operator_email,
    });
    return json(res, 200, { assignment });
  }

  if (scheduleIdMatch && method === 'DELETE') {
    if (!requirePerm(CONTROL_ROOM_PERMS.scheduleManage)) return true;
    const scheduleId = decodeURIComponent(scheduleIdMatch[1]);
    const existingRow = await store.getScheduleById(scheduleId);
    if (!existingRow) return json(res, 404, { error: 'Schedule assignment not found' });
    await store.deleteSchedule(scheduleId);
    recordSecurityAudit('control_room.schedule_delete', {
      actor: actorEmail,
      schedule_id: scheduleId,
      operator_email: existingRow.operator_email,
    });
    return json(res, 200, { deleted: true, id: scheduleId });
  }

  // Employee directory for schedule assignment (authenticated CR viewers/managers)
  if (path === '/hub/control-room/directory' && method === 'GET') {
    if (!requireActor()) return true;
    if (
      !hasCrPerm(permissions, CONTROL_ROOM_PERMS.scheduleManage) &&
      !hasCrPerm(permissions, CONTROL_ROOM_PERMS.scheduleView) &&
      !canViewControlRoom(permissions)
    ) {
      return json(res, 403, authErrors.wosForbiddenBody());
    }
    const { listEmployees } = require('../user-directory');
    const employees = await listEmployees({ q: q.q || q.search || '' });
    return json(res, 200, {
      employees,
      source: 'local_directory',
      note: 'Uses SLIOps provisioned users. Microsoft Graph is not required.',
    });
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
