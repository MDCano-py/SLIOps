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

/** Inclusive list of YYYY-MM-DD dates between from and to (UTC calendar dates). */
function eachDateInclusive(fromYmd, toYmd) {
  const out = [];
  if (!fromYmd || !toYmd) return out;
  const start = new Date(`${fromYmd}T00:00:00.000Z`);
  const end = new Date(`${toYmd}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return out;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Human-readable local range, e.g. "Mon, Oct 5 · 7:00 PM – Tue, Oct 6 · 7:00 AM".
 * Uses IANA timezone when provided; otherwise runtime/local default.
 * Never returns raw ISO for ordinary display.
 */
function formatDateTimeRange(startsAt, endsAt, timeZone) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '—';
  const optsDate = { weekday: 'short', month: 'short', day: 'numeric', timeZone };
  const optsTime = { hour: 'numeric', minute: '2-digit', timeZone };
  try {
    const dStart = new Intl.DateTimeFormat('en-US', optsDate).format(start);
    const tStart = new Intl.DateTimeFormat('en-US', optsTime).format(start);
    const dEnd = new Intl.DateTimeFormat('en-US', optsDate).format(end);
    const tEnd = new Intl.DateTimeFormat('en-US', optsTime).format(end);
    const sameDay =
      new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(
        start
      ) ===
      new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(end);
    if (sameDay) return `${dStart} · ${tStart} – ${tEnd}`;
    return `${dStart} · ${tStart} – ${dEnd} · ${tEnd}`;
  } catch {
    return `${start.toLocaleString()} – ${end.toLocaleString()}`;
  }
}

function buildGapsByDate(assignments, stationId, fromYmd, toYmd) {
  const gapsByDate = {};
  for (const day of eachDateInclusive(fromYmd, toYmd)) {
    const dayRows = (assignments || []).filter((a) => a.work_date === day || overlapsCalendarDay(a, day));
    gapsByDate[day] = detectCoverageGaps(
      dayRows,
      `${day}T00:00:00.000Z`,
      `${day}T23:59:59.999Z`,
      stationId
    );
  }
  return gapsByDate;
}

function overlapsCalendarDay(assignment, ymd) {
  if (!assignment?.starts_at || !assignment?.ends_at) return false;
  const dayStart = new Date(`${ymd}T00:00:00.000Z`).getTime();
  const dayEnd = new Date(`${ymd}T23:59:59.999Z`).getTime();
  const aStart = new Date(assignment.starts_at).getTime();
  const aEnd = new Date(assignment.ends_at).getTime();
  return aStart < dayEnd && aEnd > dayStart;
}

module.exports = {
  isTaskOverdue,
  detectScheduleOverlaps,
  detectCoverageGaps,
  buildHandoverPayload,
  eachDateInclusive,
  formatDateTimeRange,
  buildGapsByDate,
  overlapsCalendarDay,
};
