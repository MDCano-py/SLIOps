/**
 * Pure Control Room helpers (unit-testable without Postgres).
 */

function isTaskOverdue(task, now = new Date()) {
  if (!task) return false;
  if (!['Open', 'In Progress'].includes(task.status)) return false;
  if (!task.due_at) return false;
  return new Date(task.due_at).getTime() < new Date(now).getTime();
}

function detectScheduleOverlaps(assignments) {
  const list = Array.isArray(assignments) ? assignments.slice() : [];
  const overlaps = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      if (a.station_id !== b.station_id) continue;
      if (a.operator_email !== b.operator_email && a.station_id === b.station_id) {
        // same station overlapping windows (coverage conflict for same operator OR same station slot)
      }
      const aStart = new Date(a.starts_at).getTime();
      const aEnd = new Date(a.ends_at).getTime();
      const bStart = new Date(b.starts_at).getTime();
      const bEnd = new Date(b.ends_at).getTime();
      if (aStart < bEnd && bStart < aEnd) {
        if (a.operator_email === b.operator_email || a.station_id === b.station_id) {
          overlaps.push({ a: a.id, b: b.id, operator_email: a.operator_email, station_id: a.station_id });
        }
      }
    }
  }
  return overlaps;
}

function detectCoverageGaps(assignments, dayStart, dayEnd, stationId) {
  const windows = (assignments || [])
    .filter((a) => a.station_id === stationId)
    .map((a) => ({
      start: Math.max(new Date(a.starts_at).getTime(), new Date(dayStart).getTime()),
      end: Math.min(new Date(a.ends_at).getTime(), new Date(dayEnd).getTime()),
    }))
    .filter((w) => w.end > w.start)
    .sort((x, y) => x.start - y.start);

  const gaps = [];
  let cursor = new Date(dayStart).getTime();
  const end = new Date(dayEnd).getTime();
  for (const w of windows) {
    if (w.start > cursor) {
      gaps.push({ starts_at: new Date(cursor).toISOString(), ends_at: new Date(w.start).toISOString() });
    }
    cursor = Math.max(cursor, w.end);
  }
  if (cursor < end) {
    gaps.push({ starts_at: new Date(cursor).toISOString(), ends_at: new Date(end).toISOString() });
  }
  return gaps;
}

function buildHandoverPayload({ logs = [], board = [], tasks = [] }) {
  const importantLogs = logs.filter(
    (l) => l.priority === 'Attention' || l.priority === 'Urgent' || l.carryover || l.follow_up
  );
  const openBoard = board.filter((b) => b.status !== 'Resolved');
  const openTasks = tasks.filter((t) => t.status === 'Open' || t.status === 'In Progress');
  return {
    important_logs: importantLogs.map((l) => l.id),
    attention_urgent_logs: logs.filter((l) => l.priority === 'Attention' || l.priority === 'Urgent').map((l) => l.id),
    unresolved_board: openBoard.map((b) => b.id),
    unfinished_tasks: openTasks.map((t) => t.id),
    carryover_logs: logs.filter((l) => l.carryover).map((l) => l.id),
    maintainx_refs: [
      ...logs.filter((l) => l.maintainx_asset_id || l.maintainx_wo_id).map((l) => ({
        type: 'log',
        id: l.id,
        asset: l.maintainx_asset_id || null,
        wo: l.maintainx_wo_id || null,
      })),
      ...openBoard.filter((b) => b.maintainx_asset_id || b.maintainx_wo_id).map((b) => ({
        type: 'board',
        id: b.id,
        asset: b.maintainx_asset_id || null,
        wo: b.maintainx_wo_id || null,
      })),
    ],
  };
}

module.exports = {
  isTaskOverdue,
  detectScheduleOverlaps,
  detectCoverageGaps,
  buildHandoverPayload,
};
