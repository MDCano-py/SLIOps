/**
 * In-memory Control Room store for automated tests (no Postgres required).
 */
const crypto = require('crypto');
const { isTaskOverdue, detectScheduleOverlaps, detectCoverageGaps, buildHandoverPayload } = require('./logic');

function uuid() {
  return crypto.randomUUID();
}
function nowIso() {
  return new Date().toISOString();
}

function createMemoryStore() {
  const db = {
    stations: [],
    units: [],
    shifts: [],
    assignments: [],
    logs: [],
    revisions: [],
    acks: [],
    board: [],
    tasks: [],
    handovers: [],
    schedule: [],
  };

  const stationId = uuid();
  const unitId = uuid();
  db.stations.push({ id: stationId, key: 'main', name: 'Main Station', active: true });
  db.units.push({ id: unitId, station_id: stationId, key: 'unit-1', name: 'Unit 1', active: true });

  async function listStations() {
    return db.stations.filter((s) => s.active);
  }
  async function listUnits(stationIdFilter) {
    return db.units.filter((u) => u.active && (!stationIdFilter || u.station_id === stationIdFilter));
  }

  async function ensureActiveShift({ stationId: sid, actorEmail, startsAt, endsAt, name }) {
    const station = db.stations.find((s) => s.id === sid) || db.stations[0];
    let shift = db.shifts.find((s) => s.station_id === station.id && s.status === 'active');
    if (!shift) {
      const start = startsAt ? new Date(startsAt) : new Date();
      const end = endsAt ? new Date(endsAt) : new Date(start.getTime() + 12 * 3600 * 1000);
      shift = {
        id: uuid(),
        station_id: station.id,
        name: name || 'Shift',
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        status: 'active',
        created_by: actorEmail,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      db.shifts.push(shift);
    }
    if (actorEmail && !db.assignments.some((a) => a.shift_id === shift.id && a.operator_email === actorEmail && a.active)) {
      db.assignments.push({
        id: uuid(),
        shift_id: shift.id,
        operator_email: actorEmail,
        role_context: 'operator',
        active: true,
        created_at: nowIso(),
      });
    }
    return getCurrentShiftContext(station.id, actorEmail);
  }

  async function getCurrentShiftContext(stationIdFilter, actorEmail) {
    const station = db.stations.find((s) => s.id === stationIdFilter) || db.stations[0];
    const shift = db.shifts.find((s) => s.station_id === station.id && s.status === 'active') || null;
    const assignments = shift ? db.assignments.filter((a) => a.shift_id === shift.id && a.active) : [];
    const logs = shift ? db.logs.filter((l) => l.shift_id === shift.id) : [];
    const unacked = logs.filter((l) => (l.priority === 'Attention' || l.priority === 'Urgent') && !db.acks.some((a) => a.target_type === 'shift_log' && a.target_id === l.id));
    const openBoard = db.board.filter((b) => b.station_id === station.id && b.status !== 'Resolved');
    const openTasks = db.tasks.filter((t) => t.station_id === station.id && (t.status === 'Open' || t.status === 'In Progress'));
    const recent = logs
      .slice()
      .sort((a, b) => new Date(b.event_at) - new Date(a.event_at))
      .slice(0, 10);
    return {
      station,
      shift,
      assignments,
      current_time: nowIso(),
      unacknowledged_count: unacked.length,
      open_board_count: openBoard.length,
      open_task_count: openTasks.length,
      recent_important: recent.filter((l) => l.priority !== 'Normal' || l.follow_up),
      actor_email: actorEmail || null,
    };
  }

  async function createLog(input) {
    const row = {
      id: uuid(),
      shift_id: input.shift_id,
      station_id: input.station_id,
      unit_id: input.unit_id || null,
      category: input.category || 'Operations',
      priority: input.priority || 'Normal',
      summary: input.summary,
      details: input.details || null,
      event_at: input.event_at || nowIso(),
      follow_up: !!input.follow_up,
      carryover: !!input.carryover,
      maintainx_asset_id: input.maintainx_asset_id || null,
      maintainx_asset_label: input.maintainx_asset_label || null,
      maintainx_wo_id: input.maintainx_wo_id || null,
      maintainx_wo_label: input.maintainx_wo_label || null,
      created_by: input.created_by,
      created_at: nowIso(),
      updated_by: null,
      updated_at: nowIso(),
    };
    db.logs.push(row);
    db.revisions.push({
      id: uuid(),
      log_id: row.id,
      revision_no: 1,
      snapshot: { ...row },
      changed_by: input.created_by,
      changed_at: nowIso(),
    });
    return row;
  }

  async function updateLog(id, patch, actor) {
    const row = db.logs.find((l) => l.id === id);
    if (!row) return null;
    Object.assign(row, {
      summary: patch.summary != null ? patch.summary : row.summary,
      details: patch.details != null ? patch.details : row.details,
      category: patch.category || row.category,
      priority: patch.priority || row.priority,
      follow_up: patch.follow_up != null ? !!patch.follow_up : row.follow_up,
      carryover: patch.carryover != null ? !!patch.carryover : row.carryover,
      unit_id: patch.unit_id !== undefined ? patch.unit_id : row.unit_id,
      event_at: patch.event_at || row.event_at,
      maintainx_asset_id: patch.maintainx_asset_id !== undefined ? patch.maintainx_asset_id : row.maintainx_asset_id,
      maintainx_asset_label: patch.maintainx_asset_label !== undefined ? patch.maintainx_asset_label : row.maintainx_asset_label,
      maintainx_wo_id: patch.maintainx_wo_id !== undefined ? patch.maintainx_wo_id : row.maintainx_wo_id,
      maintainx_wo_label: patch.maintainx_wo_label !== undefined ? patch.maintainx_wo_label : row.maintainx_wo_label,
      updated_by: actor,
      updated_at: nowIso(),
    });
    const revNo = db.revisions.filter((r) => r.log_id === id).length + 1;
    db.revisions.push({
      id: uuid(),
      log_id: id,
      revision_no: revNo,
      snapshot: { ...row },
      changed_by: actor,
      changed_at: nowIso(),
    });
    return row;
  }

  async function listLogs(filters = {}) {
    let rows = db.logs.slice();
    if (filters.shift_id) rows = rows.filter((l) => l.shift_id === filters.shift_id);
    if (filters.station_id) rows = rows.filter((l) => l.station_id === filters.station_id);
    if (filters.unit_id) rows = rows.filter((l) => l.unit_id === filters.unit_id);
    if (filters.category) rows = rows.filter((l) => l.category === filters.category);
    if (filters.priority) rows = rows.filter((l) => l.priority === filters.priority);
    if (filters.ack === 'unacked') {
      rows = rows.filter((l) => !db.acks.some((a) => a.target_type === 'shift_log' && a.target_id === l.id));
    }
    if (filters.ack === 'acked') {
      rows = rows.filter((l) => db.acks.some((a) => a.target_type === 'shift_log' && a.target_id === l.id));
    }
    rows.sort((a, b) => new Date(b.event_at) - new Date(a.event_at));
    return rows.map((l) => ({
      ...l,
      acknowledgements: db.acks.filter((a) => a.target_type === 'shift_log' && a.target_id === l.id),
      overdue: false,
    }));
  }

  async function listLogRevisions(logId) {
    return db.revisions.filter((r) => r.log_id === logId).sort((a, b) => a.revision_no - b.revision_no);
  }

  async function acknowledge({ target_type, target_id, user_email, shift_id }) {
    const existing = db.acks.find(
      (a) => a.target_type === target_type && a.target_id === target_id && a.user_email === user_email
    );
    if (existing) return { acknowledgement: existing, duplicate: true };
    const row = {
      id: uuid(),
      target_type,
      target_id,
      user_email,
      shift_id: shift_id || null,
      acknowledged_at: nowIso(),
    };
    db.acks.push(row);
    return { acknowledgement: row, duplicate: false };
  }

  async function createBoard(input) {
    const row = {
      id: uuid(),
      station_id: input.station_id,
      unit_id: input.unit_id || null,
      title: input.title,
      description: input.description || null,
      category: input.category || 'Operations',
      priority: input.priority || 'Normal',
      status: input.status || 'Open',
      owner_email: input.owner_email || null,
      target_date: input.target_date || null,
      linked_log_id: input.linked_log_id || null,
      maintainx_asset_id: input.maintainx_asset_id || null,
      maintainx_asset_label: input.maintainx_asset_label || null,
      maintainx_wo_id: input.maintainx_wo_id || null,
      maintainx_wo_label: input.maintainx_wo_label || null,
      created_by: input.created_by,
      created_at: nowIso(),
      updated_by: null,
      updated_at: nowIso(),
      resolved_by: null,
      resolved_at: null,
      resolution_note: null,
    };
    db.board.push(row);
    return row;
  }

  async function updateBoard(id, patch, actor) {
    const row = db.board.find((b) => b.id === id);
    if (!row) return null;
    Object.assign(row, {
      title: patch.title != null ? patch.title : row.title,
      description: patch.description !== undefined ? patch.description : row.description,
      category: patch.category || row.category,
      priority: patch.priority || row.priority,
      status: patch.status || row.status,
      owner_email: patch.owner_email !== undefined ? patch.owner_email : row.owner_email,
      target_date: patch.target_date !== undefined ? patch.target_date : row.target_date,
      unit_id: patch.unit_id !== undefined ? patch.unit_id : row.unit_id,
      updated_by: actor,
      updated_at: nowIso(),
    });
    if (patch.status === 'Resolved' && row.status === 'Resolved') {
      row.resolved_by = actor;
      row.resolved_at = row.resolved_at || nowIso();
      row.resolution_note = patch.resolution_note != null ? patch.resolution_note : row.resolution_note;
    }
    return row;
  }

  async function resolveBoard(id, actor, note) {
    return updateBoard(id, { status: 'Resolved', resolution_note: note || null }, actor);
  }

  async function listBoard(filters = {}) {
    let rows = db.board.slice();
    if (filters.station_id) rows = rows.filter((b) => b.station_id === filters.station_id);
    if (filters.status) rows = rows.filter((b) => b.status === filters.status);
    if (filters.open_only) rows = rows.filter((b) => b.status !== 'Resolved');
    return rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  async function createTask(input) {
    const row = {
      id: uuid(),
      station_id: input.station_id,
      unit_id: input.unit_id || null,
      title: input.title,
      description: input.description || null,
      assignee_email: input.assignee_email || null,
      due_at: input.due_at || null,
      priority: input.priority || 'Normal',
      source: input.source || 'manual',
      status: input.status || 'Open',
      linked_log_id: input.linked_log_id || null,
      linked_board_id: input.linked_board_id || null,
      created_by: input.created_by,
      created_at: nowIso(),
      updated_at: nowIso(),
      completed_by: null,
      completed_at: null,
      completion_note: null,
    };
    db.tasks.push(row);
    return enrichTask(row);
  }

  function enrichTask(row) {
    return { ...row, overdue: isTaskOverdue(row) };
  }

  async function updateTask(id, patch, actor) {
    const row = db.tasks.find((t) => t.id === id);
    if (!row) return null;
    Object.assign(row, {
      title: patch.title != null ? patch.title : row.title,
      description: patch.description !== undefined ? patch.description : row.description,
      assignee_email: patch.assignee_email !== undefined ? patch.assignee_email : row.assignee_email,
      due_at: patch.due_at !== undefined ? patch.due_at : row.due_at,
      priority: patch.priority || row.priority,
      status: patch.status || row.status,
      updated_at: nowIso(),
    });
    if (patch.status === 'Completed') {
      row.completed_by = actor;
      row.completed_at = nowIso();
      row.completion_note = patch.completion_note || null;
    }
    return enrichTask(row);
  }

  async function listTasks(filters = {}) {
    let rows = db.tasks.slice();
    if (filters.station_id) rows = rows.filter((t) => t.station_id === filters.station_id);
    if (filters.assignee_email) rows = rows.filter((t) => t.assignee_email === filters.assignee_email);
    if (filters.status) rows = rows.filter((t) => t.status === filters.status);
    if (filters.open_only) rows = rows.filter((t) => t.status === 'Open' || t.status === 'In Progress');
    return rows.map(enrichTask).sort((a, b) => new Date(a.due_at || 0) - new Date(b.due_at || 0));
  }

  async function completeShift(shiftId) {
    const shift = db.shifts.find((s) => s.id === shiftId);
    if (!shift) return null;
    shift.status = 'completed';
    shift.updated_at = nowIso();
    return shift;
  }

  async function createHandover({ outgoing_shift_id, incoming_shift_id, station_id, outgoing_note, outgoing_by }) {
    const logs = db.logs.filter((l) => l.shift_id === outgoing_shift_id);
    const board = db.board.filter((b) => b.station_id === station_id);
    const tasks = db.tasks.filter((t) => t.station_id === station_id);
    const payload = buildHandoverPayload({ logs, board, tasks });
    const row = {
      id: uuid(),
      outgoing_shift_id,
      incoming_shift_id: incoming_shift_id || null,
      station_id,
      outgoing_note: outgoing_note || null,
      outgoing_by,
      outgoing_at: nowIso(),
      incoming_ack_by: null,
      incoming_ack_at: null,
      payload,
      created_at: nowIso(),
    };
    db.handovers.push(row);
    return row;
  }

  async function ackHandover(id, userEmail) {
    const row = db.handovers.find((h) => h.id === id);
    if (!row) return null;
    row.incoming_ack_by = userEmail;
    row.incoming_ack_at = nowIso();
    await acknowledge({
      target_type: 'handover',
      target_id: id,
      user_email: userEmail,
      shift_id: row.incoming_shift_id,
    });
    return row;
  }

  async function listHandovers(stationId) {
    return db.handovers
      .filter((h) => !stationId || h.station_id === stationId)
      .sort((a, b) => new Date(b.outgoing_at) - new Date(a.outgoing_at));
  }

  async function createSchedule(input) {
    const row = {
      id: uuid(),
      station_id: input.station_id,
      operator_email: input.operator_email,
      work_date: input.work_date,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      role_context: input.role_context || null,
      created_by: input.created_by,
      created_at: nowIso(),
      updated_by: null,
      updated_at: nowIso(),
    };
    db.schedule.push(row);
    return row;
  }

  async function listSchedule(filters = {}) {
    let rows = db.schedule.slice();
    if (filters.station_id) rows = rows.filter((s) => s.station_id === filters.station_id);
    if (filters.work_date) rows = rows.filter((s) => s.work_date === filters.work_date);
    if (filters.operator_email) rows = rows.filter((s) => s.operator_email === filters.operator_email);
    const overlaps = detectScheduleOverlaps(rows);
    let gaps = [];
    if (filters.station_id && filters.work_date) {
      const dayStart = `${filters.work_date}T00:00:00.000Z`;
      const dayEnd = `${filters.work_date}T23:59:59.999Z`;
      gaps = detectCoverageGaps(rows, dayStart, dayEnd, filters.station_id);
    }
    return { assignments: rows.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at)), overlaps, gaps };
  }

  async function getSupervisorOverview(stationId) {
    const ctx = await getCurrentShiftContext(stationId);
    const logs = await listLogs({ station_id: ctx.station.id });
    const unackedImportant = logs.filter(
      (l) => (l.priority === 'Attention' || l.priority === 'Urgent') && !(l.acknowledgements || []).length
    );
    const openBoard = await listBoard({ station_id: ctx.station.id, open_only: true });
    const tasks = await listTasks({ station_id: ctx.station.id, open_only: true });
    const overdue = tasks.filter((t) => t.overdue);
    const handovers = await listHandovers(ctx.station.id);
    const pendingHandover = handovers.find((h) => !h.incoming_ack_at) || null;
    const today = nowIso().slice(0, 10);
    const schedule = await listSchedule({ station_id: ctx.station.id, work_date: today });
    return {
      active_operators: (ctx.assignments || []).map((a) => a.operator_email),
      coverage_gaps: schedule.gaps,
      overlaps: schedule.overlaps,
      unacknowledged_attention_urgent: unackedImportant,
      open_board_items: openBoard,
      overdue_tasks: overdue,
      pending_handover: pendingHandover,
      units_with_issues: [
        ...new Set([
          ...openBoard.map((b) => b.unit_id).filter(Boolean),
          ...unackedImportant.map((l) => l.unit_id).filter(Boolean),
        ]),
      ],
      recent_important: ctx.recent_important,
      current: ctx,
    };
  }

  async function listHistory(filters = {}) {
    const items = [];
    for (const l of await listLogs(filters)) {
      items.push({
        record_type: 'shift_log',
        id: l.id,
        at: l.event_at,
        station_id: l.station_id,
        unit_id: l.unit_id,
        operator: l.created_by,
        category: l.category,
        priority: l.priority,
        status: null,
        summary: l.summary,
        shift_id: l.shift_id,
      });
    }
    for (const b of await listBoard(filters)) {
      items.push({
        record_type: 'board',
        id: b.id,
        at: b.created_at,
        station_id: b.station_id,
        unit_id: b.unit_id,
        operator: b.created_by,
        category: b.category,
        priority: b.priority,
        status: b.status,
        summary: b.title,
        shift_id: null,
      });
    }
    for (const t of await listTasks(filters)) {
      items.push({
        record_type: 'task',
        id: t.id,
        at: t.created_at,
        station_id: t.station_id,
        unit_id: t.unit_id,
        operator: t.created_by,
        category: null,
        priority: t.priority,
        status: t.status,
        summary: t.title,
        shift_id: null,
      });
    }
    for (const h of await listHandovers(filters.station_id)) {
      items.push({
        record_type: 'handover',
        id: h.id,
        at: h.outgoing_at,
        station_id: h.station_id,
        unit_id: null,
        operator: h.outgoing_by,
        category: null,
        priority: null,
        status: h.incoming_ack_at ? 'acknowledged' : 'pending',
        summary: h.outgoing_note || 'Handover',
        shift_id: h.outgoing_shift_id,
      });
    }
    for (const a of db.acks) {
      items.push({
        record_type: 'acknowledgement',
        id: a.id,
        at: a.acknowledged_at,
        station_id: filters.station_id || null,
        unit_id: null,
        operator: a.user_email,
        category: null,
        priority: null,
        status: null,
        summary: `${a.target_type}:${a.target_id}`,
        shift_id: a.shift_id,
      });
    }
    let out = items;
    if (filters.record_type) out = out.filter((i) => i.record_type === filters.record_type);
    if (filters.priority) out = out.filter((i) => i.priority === filters.priority);
    if (filters.category) out = out.filter((i) => i.category === filters.category);
    if (filters.operator) out = out.filter((i) => i.operator === filters.operator);
    if (filters.status) out = out.filter((i) => i.status === filters.status);
    if (filters.shift_id) out = out.filter((i) => i.shift_id === filters.shift_id);
    if (filters.date_from) out = out.filter((i) => new Date(i.at) >= new Date(filters.date_from));
    if (filters.date_to) out = out.filter((i) => new Date(i.at) <= new Date(filters.date_to));
    return out.sort((a, b) => new Date(b.at) - new Date(a.at));
  }

  return {
    kind: 'memory',
    listStations,
    listUnits,
    ensureActiveShift,
    getCurrentShiftContext,
    createLog,
    updateLog,
    listLogs,
    listLogRevisions,
    acknowledge,
    createBoard,
    updateBoard,
    resolveBoard,
    listBoard,
    createTask,
    updateTask,
    listTasks,
    completeShift,
    createHandover,
    ackHandover,
    listHandovers,
    createSchedule,
    listSchedule,
    getSupervisorOverview,
    listHistory,
    _db: db,
  };
}

module.exports = { createMemoryStore };
