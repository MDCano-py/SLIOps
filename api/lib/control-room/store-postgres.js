/**
 * Postgres Control Room store — uses hub pool/tx.
 */
const hubPg = require('../hub/db/postgres');
const { isTaskOverdue, detectScheduleOverlaps, detectCoverageGaps, buildHandoverPayload } = require('./logic');

const { pool, tx, nowIso, generateId } = hubPg;

function createPostgresStore() {
  async function listStations() {
    const r = await pool.query('SELECT * FROM cr_stations WHERE active = true ORDER BY name');
    return r.rows;
  }
  async function listUnits(stationId) {
    const r = stationId
      ? await pool.query('SELECT * FROM cr_units WHERE active = true AND station_id=$1 ORDER BY name', [stationId])
      : await pool.query('SELECT * FROM cr_units WHERE active = true ORDER BY name');
    return r.rows;
  }

  async function ensureActiveShift({ stationId, actorEmail, startsAt, endsAt, name }) {
    return tx(async (c) => {
      let st = stationId;
      if (!st) {
        const s = await c.query('SELECT id FROM cr_stations WHERE key=$1', ['main']);
        st = s.rows[0]?.id;
      }
      let shift = (
        await c.query(
          `SELECT * FROM cr_shifts WHERE station_id=$1 AND status='active' ORDER BY starts_at DESC LIMIT 1`,
          [st]
        )
      ).rows[0];
      if (!shift) {
        const start = startsAt ? new Date(startsAt) : new Date();
        const end = endsAt ? new Date(endsAt) : new Date(start.getTime() + 12 * 3600 * 1000);
        const ins = await c.query(
          `INSERT INTO cr_shifts (station_id, name, starts_at, ends_at, status, created_by)
           VALUES ($1,$2,$3,$4,'active',$5) RETURNING *`,
          [st, name || 'Shift', start.toISOString(), end.toISOString(), actorEmail || null]
        );
        shift = ins.rows[0];
      }
      if (actorEmail) {
        await c.query(
          `INSERT INTO cr_shift_assignments (shift_id, operator_email, role_context, active)
           VALUES ($1,$2,'operator',true)
           ON CONFLICT (shift_id, operator_email) DO UPDATE SET active=true`,
          [shift.id, actorEmail]
        );
      }
      return getCurrentShiftContext(st, actorEmail);
    });
  }

  async function getCurrentShiftContext(stationId, actorEmail) {
    let st = stationId;
    if (!st) {
      const s = await pool.query(`SELECT * FROM cr_stations WHERE key='main' LIMIT 1`);
      st = s.rows[0]?.id;
    }
    const station = (await pool.query('SELECT * FROM cr_stations WHERE id=$1', [st])).rows[0];
    const shift = (
      await pool.query(
        `SELECT * FROM cr_shifts WHERE station_id=$1 AND status='active' ORDER BY starts_at DESC LIMIT 1`,
        [st]
      )
    ).rows[0];
    const assignments = shift
      ? (await pool.query(`SELECT * FROM cr_shift_assignments WHERE shift_id=$1 AND active=true`, [shift.id])).rows
      : [];
    const unacked = shift
      ? (
          await pool.query(
            `SELECT COUNT(*)::int AS n FROM cr_shift_logs l
             WHERE l.shift_id=$1 AND l.priority IN ('Attention','Urgent')
               AND NOT EXISTS (
                 SELECT 1 FROM cr_acknowledgements a
                 WHERE a.target_type='shift_log' AND a.target_id=l.id
               )`,
            [shift.id]
          )
        ).rows[0].n
      : 0;
    const openBoard = (
      await pool.query(`SELECT COUNT(*)::int AS n FROM cr_board_items WHERE station_id=$1 AND status<>'Resolved'`, [st])
    ).rows[0].n;
    const openTasks = (
      await pool.query(
        `SELECT COUNT(*)::int AS n FROM cr_tasks WHERE station_id=$1 AND status IN ('Open','In Progress')`,
        [st]
      )
    ).rows[0].n;
    const recent = shift
      ? (
          await pool.query(
            `SELECT * FROM cr_shift_logs WHERE shift_id=$1 ORDER BY event_at DESC LIMIT 10`,
            [shift.id]
          )
        ).rows
      : [];
    return {
      station,
      shift: shift || null,
      assignments,
      current_time: nowIso(),
      unacknowledged_count: unacked,
      open_board_count: openBoard,
      open_task_count: openTasks,
      recent_important: recent.filter((l) => l.priority !== 'Normal' || l.follow_up),
      actor_email: actorEmail || null,
    };
  }

  async function createLog(input) {
    return tx(async (c) => {
      const id = generateId();
      const r = await c.query(
        `INSERT INTO cr_shift_logs (
          id, shift_id, station_id, unit_id, category, priority, summary, details, event_at,
          follow_up, carryover, maintainx_asset_id, maintainx_asset_label, maintainx_wo_id, maintainx_wo_label, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [
          id,
          input.shift_id,
          input.station_id,
          input.unit_id || null,
          input.category || 'Operations',
          input.priority || 'Normal',
          input.summary,
          input.details || null,
          input.event_at || nowIso(),
          !!input.follow_up,
          !!input.carryover,
          input.maintainx_asset_id || null,
          input.maintainx_asset_label || null,
          input.maintainx_wo_id || null,
          input.maintainx_wo_label || null,
          input.created_by,
        ]
      );
      const row = r.rows[0];
      await c.query(
        `INSERT INTO cr_shift_log_revisions (log_id, revision_no, snapshot, changed_by)
         VALUES ($1,1,$2::jsonb,$3)`,
        [row.id, JSON.stringify(row), input.created_by]
      );
      return row;
    });
  }

  async function updateLog(id, patch, actor) {
    return tx(async (c) => {
      const cur = (await c.query('SELECT * FROM cr_shift_logs WHERE id=$1', [id])).rows[0];
      if (!cur) return null;
      const r = await c.query(
        `UPDATE cr_shift_logs SET
          summary=COALESCE($2,summary), details=COALESCE($3,details), category=COALESCE($4,category),
          priority=COALESCE($5,priority), follow_up=COALESCE($6,follow_up), carryover=COALESCE($7,carryover),
          unit_id=COALESCE($8,unit_id), event_at=COALESCE($9,event_at),
          maintainx_asset_id=COALESCE($10,maintainx_asset_id), maintainx_asset_label=COALESCE($11,maintainx_asset_label),
          maintainx_wo_id=COALESCE($12,maintainx_wo_id), maintainx_wo_label=COALESCE($13,maintainx_wo_label),
          updated_by=$14, updated_at=now()
         WHERE id=$1 RETURNING *`,
        [
          id,
          patch.summary ?? null,
          patch.details ?? null,
          patch.category ?? null,
          patch.priority ?? null,
          patch.follow_up != null ? !!patch.follow_up : null,
          patch.carryover != null ? !!patch.carryover : null,
          patch.unit_id ?? null,
          patch.event_at ?? null,
          patch.maintainx_asset_id ?? null,
          patch.maintainx_asset_label ?? null,
          patch.maintainx_wo_id ?? null,
          patch.maintainx_wo_label ?? null,
          actor,
        ]
      );
      const row = r.rows[0];
      const rev = (
        await c.query(`SELECT COALESCE(MAX(revision_no),0)+1 AS n FROM cr_shift_log_revisions WHERE log_id=$1`, [id])
      ).rows[0].n;
      await c.query(
        `INSERT INTO cr_shift_log_revisions (log_id, revision_no, snapshot, changed_by) VALUES ($1,$2,$3::jsonb,$4)`,
        [id, rev, JSON.stringify(row), actor]
      );
      return row;
    });
  }

  async function listLogs(filters = {}) {
    const clauses = [];
    const params = [];
    function add(sql, v) {
      params.push(v);
      clauses.push(`${sql}$${params.length}`);
    }
    if (filters.shift_id) add('shift_id=', filters.shift_id);
    if (filters.station_id) add('station_id=', filters.station_id);
    if (filters.unit_id) add('unit_id=', filters.unit_id);
    if (filters.category) add('category=', filters.category);
    if (filters.priority) add('priority=', filters.priority);
    let where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    if (filters.ack === 'unacked') {
      where += (where ? ' AND ' : 'WHERE ') +
        `NOT EXISTS (SELECT 1 FROM cr_acknowledgements a WHERE a.target_type='shift_log' AND a.target_id=cr_shift_logs.id)`;
    }
    if (filters.ack === 'acked') {
      where += (where ? ' AND ' : 'WHERE ') +
        `EXISTS (SELECT 1 FROM cr_acknowledgements a WHERE a.target_type='shift_log' AND a.target_id=cr_shift_logs.id)`;
    }
    const rows = (await pool.query(`SELECT * FROM cr_shift_logs ${where} ORDER BY event_at DESC LIMIT 500`, params)).rows;
    const ids = rows.map((r) => r.id);
    let acks = [];
    if (ids.length) {
      acks = (await pool.query(
        `SELECT * FROM cr_acknowledgements WHERE target_type='shift_log' AND target_id = ANY($1::uuid[])`,
        [ids]
      )).rows;
    }
    return rows.map((l) => ({
      ...l,
      acknowledgements: acks.filter((a) => a.target_id === l.id),
    }));
  }

  async function listLogRevisions(logId) {
    const r = await pool.query(
      `SELECT * FROM cr_shift_log_revisions WHERE log_id=$1 ORDER BY revision_no`,
      [logId]
    );
    return r.rows;
  }

  async function acknowledge({ target_type, target_id, user_email, shift_id }) {
    try {
      const r = await pool.query(
        `INSERT INTO cr_acknowledgements (target_type, target_id, user_email, shift_id)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [target_type, target_id, user_email, shift_id || null]
      );
      return { acknowledgement: r.rows[0], duplicate: false };
    } catch (err) {
      if (err && err.code === '23505') {
        const existing = (
          await pool.query(
            `SELECT * FROM cr_acknowledgements WHERE target_type=$1 AND target_id=$2 AND user_email=$3`,
            [target_type, target_id, user_email]
          )
        ).rows[0];
        return { acknowledgement: existing, duplicate: true };
      }
      throw err;
    }
  }

  async function createBoard(input) {
    const r = await pool.query(
      `INSERT INTO cr_board_items (
        station_id, unit_id, title, description, category, priority, status, owner_email, target_date,
        linked_log_id, maintainx_asset_id, maintainx_asset_label, maintainx_wo_id, maintainx_wo_label, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [
        input.station_id,
        input.unit_id || null,
        input.title,
        input.description || null,
        input.category || 'Operations',
        input.priority || 'Normal',
        input.status || 'Open',
        input.owner_email || null,
        input.target_date || null,
        input.linked_log_id || null,
        input.maintainx_asset_id || null,
        input.maintainx_asset_label || null,
        input.maintainx_wo_id || null,
        input.maintainx_wo_label || null,
        input.created_by,
      ]
    );
    return r.rows[0];
  }

  async function updateBoard(id, patch, actor) {
    const r = await pool.query(
      `UPDATE cr_board_items SET
        title=COALESCE($2,title), description=COALESCE($3,description), category=COALESCE($4,category),
        priority=COALESCE($5,priority), status=COALESCE($6,status), owner_email=COALESCE($7,owner_email),
        target_date=COALESCE($8,target_date), unit_id=COALESCE($9,unit_id),
        updated_by=$10, updated_at=now(),
        resolved_by=CASE WHEN $6='Resolved' THEN $10 ELSE resolved_by END,
        resolved_at=CASE WHEN $6='Resolved' THEN COALESCE(resolved_at, now()) ELSE resolved_at END,
        resolution_note=CASE WHEN $6='Resolved' THEN COALESCE($11, resolution_note) ELSE resolution_note END
       WHERE id=$1 RETURNING *`,
      [
        id,
        patch.title ?? null,
        patch.description ?? null,
        patch.category ?? null,
        patch.priority ?? null,
        patch.status ?? null,
        patch.owner_email ?? null,
        patch.target_date ?? null,
        patch.unit_id ?? null,
        actor,
        patch.resolution_note ?? null,
      ]
    );
    return r.rows[0] || null;
  }

  async function resolveBoard(id, actor, note) {
    return updateBoard(id, { status: 'Resolved', resolution_note: note || null }, actor);
  }

  async function listBoard(filters = {}) {
    const params = [];
    const clauses = [];
    if (filters.station_id) {
      params.push(filters.station_id);
      clauses.push(`station_id=$${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      clauses.push(`status=$${params.length}`);
    }
    if (filters.open_only) clauses.push(`status<>'Resolved'`);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return (await pool.query(`SELECT * FROM cr_board_items ${where} ORDER BY created_at DESC LIMIT 500`, params)).rows;
  }

  async function createTask(input) {
    const r = await pool.query(
      `INSERT INTO cr_tasks (
        station_id, unit_id, title, description, assignee_email, due_at, priority, source, status,
        linked_log_id, linked_board_id, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        input.station_id,
        input.unit_id || null,
        input.title,
        input.description || null,
        input.assignee_email || null,
        input.due_at || null,
        input.priority || 'Normal',
        input.source || 'manual',
        input.status || 'Open',
        input.linked_log_id || null,
        input.linked_board_id || null,
        input.created_by,
      ]
    );
    const row = r.rows[0];
    return { ...row, overdue: isTaskOverdue(row) };
  }

  async function updateTask(id, patch, actor) {
    const r = await pool.query(
      `UPDATE cr_tasks SET
        title=COALESCE($2,title), description=COALESCE($3,description),
        assignee_email=COALESCE($4,assignee_email), due_at=COALESCE($5,due_at),
        priority=COALESCE($6,priority), status=COALESCE($7,status), updated_at=now(),
        completed_by=CASE WHEN $7='Completed' THEN $8 ELSE completed_by END,
        completed_at=CASE WHEN $7='Completed' THEN COALESCE(completed_at, now()) ELSE completed_at END,
        completion_note=CASE WHEN $7='Completed' THEN COALESCE($9, completion_note) ELSE completion_note END
       WHERE id=$1 RETURNING *`,
      [
        id,
        patch.title ?? null,
        patch.description ?? null,
        patch.assignee_email ?? null,
        patch.due_at ?? null,
        patch.priority ?? null,
        patch.status ?? null,
        actor,
        patch.completion_note ?? null,
      ]
    );
    const row = r.rows[0];
    return row ? { ...row, overdue: isTaskOverdue(row) } : null;
  }

  async function listTasks(filters = {}) {
    const params = [];
    const clauses = [];
    if (filters.station_id) {
      params.push(filters.station_id);
      clauses.push(`station_id=$${params.length}`);
    }
    if (filters.assignee_email) {
      params.push(filters.assignee_email);
      clauses.push(`assignee_email=$${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      clauses.push(`status=$${params.length}`);
    }
    if (filters.open_only) clauses.push(`status IN ('Open','In Progress')`);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = (await pool.query(`SELECT * FROM cr_tasks ${where} ORDER BY due_at NULLS LAST LIMIT 500`, params)).rows;
    return rows.map((t) => ({ ...t, overdue: isTaskOverdue(t) }));
  }

  async function completeShift(shiftId) {
    const r = await pool.query(
      `UPDATE cr_shifts SET status='completed', updated_at=now() WHERE id=$1 RETURNING *`,
      [shiftId]
    );
    return r.rows[0] || null;
  }

  async function createHandover({ outgoing_shift_id, incoming_shift_id, station_id, outgoing_note, outgoing_by }) {
    const logs = (await pool.query(`SELECT * FROM cr_shift_logs WHERE shift_id=$1`, [outgoing_shift_id])).rows;
    const board = (await pool.query(`SELECT * FROM cr_board_items WHERE station_id=$1`, [station_id])).rows;
    const tasks = (await pool.query(`SELECT * FROM cr_tasks WHERE station_id=$1`, [station_id])).rows;
    const payload = buildHandoverPayload({ logs, board, tasks });
    const r = await pool.query(
      `INSERT INTO cr_handovers (outgoing_shift_id, incoming_shift_id, station_id, outgoing_note, outgoing_by, payload)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING *`,
      [outgoing_shift_id, incoming_shift_id || null, station_id, outgoing_note || null, outgoing_by, JSON.stringify(payload)]
    );
    return r.rows[0];
  }

  async function ackHandover(id, userEmail) {
    return tx(async (c) => {
      const r = await c.query(
        `UPDATE cr_handovers SET incoming_ack_by=$2, incoming_ack_at=now() WHERE id=$1 RETURNING *`,
        [id, userEmail]
      );
      const row = r.rows[0];
      if (!row) return null;
      await c.query(
        `INSERT INTO cr_acknowledgements (target_type, target_id, user_email, shift_id)
         VALUES ('handover',$1,$2,$3)
         ON CONFLICT (target_type, target_id, user_email) DO NOTHING`,
        [id, userEmail, row.incoming_shift_id]
      );
      return row;
    });
  }

  async function listHandovers(stationId) {
    const r = stationId
      ? await pool.query(`SELECT * FROM cr_handovers WHERE station_id=$1 ORDER BY outgoing_at DESC LIMIT 100`, [stationId])
      : await pool.query(`SELECT * FROM cr_handovers ORDER BY outgoing_at DESC LIMIT 100`);
    return r.rows;
  }

  async function createSchedule(input) {
    const r = await pool.query(
      `INSERT INTO cr_schedule_assignments
        (station_id, operator_email, work_date, starts_at, ends_at, role_context, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        input.station_id,
        input.operator_email,
        input.work_date,
        input.starts_at,
        input.ends_at,
        input.role_context || null,
        input.created_by,
      ]
    );
    return r.rows[0];
  }

  async function listSchedule(filters = {}) {
    const params = [];
    const clauses = [];
    if (filters.station_id) {
      params.push(filters.station_id);
      clauses.push(`station_id=$${params.length}`);
    }
    if (filters.work_date) {
      params.push(filters.work_date);
      clauses.push(`work_date=$${params.length}`);
    }
    if (filters.operator_email) {
      params.push(filters.operator_email);
      clauses.push(`operator_email=$${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const assignments = (
      await pool.query(`SELECT * FROM cr_schedule_assignments ${where} ORDER BY starts_at`, params)
    ).rows;
    const overlaps = detectScheduleOverlaps(assignments);
    let gaps = [];
    if (filters.station_id && filters.work_date) {
      gaps = detectCoverageGaps(
        assignments,
        `${filters.work_date}T00:00:00.000Z`,
        `${filters.work_date}T23:59:59.999Z`,
        filters.station_id
      );
    }
    return { assignments, overlaps, gaps };
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
    // Delegate filter assembly similar to memory store via SQL unions would be large;
    // compose from list helpers for consistency.
    const memLike = {
      logs: await listLogs(filters),
      board: await listBoard(filters),
      tasks: await listTasks(filters),
      handovers: await listHandovers(filters.station_id),
    };
    const items = [];
    for (const l of memLike.logs) {
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
    for (const b of memLike.board) {
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
    for (const t of memLike.tasks) {
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
    for (const h of memLike.handovers) {
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
    let out = items;
    if (filters.record_type) out = out.filter((i) => i.record_type === filters.record_type);
    if (filters.priority) out = out.filter((i) => i.priority === filters.priority);
    if (filters.operator) out = out.filter((i) => i.operator === filters.operator);
    if (filters.status) out = out.filter((i) => i.status === filters.status);
    if (filters.shift_id) out = out.filter((i) => i.shift_id === filters.shift_id);
    return out.sort((a, b) => new Date(b.at) - new Date(a.at));
  }

  return {
    kind: 'postgres',
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
  };
}

module.exports = { createPostgresStore };
