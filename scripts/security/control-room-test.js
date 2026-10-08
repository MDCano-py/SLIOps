#!/usr/bin/env node
/**
 * Control Room MVP automated suite (memory store — no Postgres required).
 * Covers create/read/edit log, audit revisions, ack + duplicate ack,
 * board cross-shift persistence, tasks + overdue, handover + carryover,
 * schedule overlap/gap, operator/supervisor permissions, history filters,
 * unauthorized mutations → 403.
 *
 * Usage: npm run security:control-room-test
 */
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

process.env.CONTROL_ROOM_STORE = 'memory';

const {
  createMemoryStore,
  resetControlRoomStoreForTests,
  getControlRoomStore,
} = require(path.join(ROOT, 'api/lib/control-room/store.js'));
const { handleControlRoomRoutes } = require(path.join(ROOT, 'api/lib/control-room/routes.js'));
const { isTaskOverdue, detectScheduleOverlaps, detectCoverageGaps } = require(
  path.join(ROOT, 'api/lib/control-room/logic.js')
);
const {
  canViewControlRoom,
  hasCrPerm,
  canAccessCrResource,
  CONTROL_ROOM_PERMS,
} = require(path.join(ROOT, 'api/lib/control-room/permissions.js'));

let passed = 0;
let failed = 0;
const failures = [];

function assert(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function call(method, routePath, { actorEmail, permissions, body, query } = {}) {
  const req = {
    method,
    body: body || undefined,
    query: query || {},
  };
  const res = mockRes();
  const handled = await handleControlRoomRoutes(routePath, req, res, {
    actorEmail: actorEmail || null,
    permissions: permissions || [],
  });
  return { handled, status: res.statusCode, body: res.body };
}

const OPERATOR = [
  'control_room_view',
  'control_room_log',
  'control_room_acknowledge',
  'control_room_handover',
  'control_room_task_manage',
  'control_room_board_manage',
  'control_room_schedule_view',
];

const SUPERVISOR = [...OPERATOR, 'control_room_schedule_manage', 'control_room_supervisor'];

const VIEW_ONLY = ['control_room_view'];

async function main() {
  console.log('=== Control Room MVP Test ===\n');

  // --- Logic unit checks ---
  assert(
    '19a. overdue calculation (past due Open)',
    isTaskOverdue({ status: 'Open', due_at: '2000-01-01T00:00:00.000Z' }, new Date('2020-01-01'))
  );
  assert(
    '19b. overdue false when Completed',
    !isTaskOverdue({ status: 'Completed', due_at: '2000-01-01T00:00:00.000Z' }, new Date('2020-01-01'))
  );
  assert(
    '13a. schedule overlap detection',
    detectScheduleOverlaps([
      {
        id: 'a',
        station_id: 's1',
        operator_email: 'a@x.com',
        starts_at: '2026-10-05T08:00:00.000Z',
        ends_at: '2026-10-05T16:00:00.000Z',
      },
      {
        id: 'b',
        station_id: 's1',
        operator_email: 'b@x.com',
        starts_at: '2026-10-05T12:00:00.000Z',
        ends_at: '2026-10-05T20:00:00.000Z',
      },
    ]).length === 1
  );
  assert(
    '13b. coverage gap detection',
    detectCoverageGaps(
      [
        {
          id: 'a',
          station_id: 's1',
          starts_at: '2026-10-05T08:00:00.000Z',
          ends_at: '2026-10-05T12:00:00.000Z',
        },
      ],
      '2026-10-05T00:00:00.000Z',
      '2026-10-05T23:59:59.999Z',
      's1'
    ).length >= 1
  );

  // --- Permission helpers ---
  assert('14a. operator can view', canViewControlRoom(OPERATOR));
  assert('14b. view-only can view', canViewControlRoom(VIEW_ONLY));
  assert('14c. empty cannot view', !canViewControlRoom([]));
  assert('15a. supervisor has schedule manage', hasCrPerm(SUPERVISOR, CONTROL_ROOM_PERMS.scheduleManage));
  assert('15b. operator lacks schedule manage', !hasCrPerm(OPERATOR, CONTROL_ROOM_PERMS.scheduleManage));
  assert('15c. operator lacks supervisor', !hasCrPerm(OPERATOR, CONTROL_ROOM_PERMS.supervisor));
  assert(
    'shared resource access ignores created_by',
    canAccessCrResource(OPERATOR, CONTROL_ROOM_PERMS.log, {
      createdBy: 'other@x.com',
      actorEmail: 'op@sliops.test',
      stationId: 'any',
    })
  );
  assert(
    'hub_admin elevated grants all CR',
    canAccessCrResource(['hub_admin'], CONTROL_ROOM_PERMS.supervisor, {})
  );

  // Empty master data (no fake production seed) — seed is opt-in only
  delete process.env.CONTROL_ROOM_MEMORY_SEED;
  resetControlRoomStoreForTests(createMemoryStore());
  let empty = await call('GET', '/hub/control-room/current', {
    actorEmail: 'op@sliops.test',
    permissions: OPERATOR,
  });
  assert(
    'empty stations → needs_bootstrap (no crash)',
    empty.status === 200 && empty.body.needs_bootstrap === true && !empty.body.station
  );
  empty = await call('POST', '/hub/control-room/logs', {
    actorEmail: 'op@sliops.test',
    permissions: OPERATOR,
    body: { summary: 'blocked without station' },
  });
  assert('empty stations → log create 409 CR_NEEDS_BOOTSTRAP', empty.status === 409 && empty.body.code === 'CR_NEEDS_BOOTSTRAP');

  // Bootstrap API without seed
  delete process.env.CONTROL_ROOM_MEMORY_SEED;
  resetControlRoomStoreForTests(createMemoryStore());
  let boot = await call('POST', '/hub/control-room/stations', {
    actorEmail: 'op@sliops.test',
    permissions: OPERATOR,
    body: { name: 'Plant Op Attempt' },
  });
  assert('operator cannot create station', boot.status === 403);
  boot = await call('POST', '/hub/control-room/stations', {
    actorEmail: 'sup@sliops.test',
    permissions: SUPERVISOR,
    body: { name: 'Plant A Control Room', key: 'plant-a' },
  });
  assert('supervisor creates station', boot.status === 201 && boot.body.station?.key === 'plant-a');
  const bootStationId = boot.body.station.id;
  boot = await call('POST', '/hub/control-room/units', {
    actorEmail: 'sup@sliops.test',
    permissions: SUPERVISOR,
    body: { station_id: bootStationId, name: 'Unit 100', key: 'unit-100' },
  });
  assert('supervisor creates unit', boot.status === 201 && boot.body.unit?.key === 'unit-100');
  boot = await call('GET', '/hub/control-room/current', {
    actorEmail: 'op@sliops.test',
    permissions: OPERATOR,
  });
  assert(
    'after bootstrap current has station',
    boot.status === 200 && boot.body.station?.name === 'Plant A Control Room' && !boot.body.needs_bootstrap
  );
  boot = await call('GET', '/hub/control-room/meta', {
    actorEmail: 'op@sliops.test',
    permissions: OPERATOR,
  });
  assert('meta omits store kind for operators', boot.status === 200 && boot.body.store == null);
  boot = await call('GET', '/hub/control-room/meta', {
    actorEmail: 'admin@sliops.test',
    permissions: ['hub_admin'],
  });
  assert('meta includes store kind for hub_admin', boot.status === 200 && boot.body.store === 'memory');

  // Opt-in test seed for remaining suite scenarios
  process.env.CONTROL_ROOM_MEMORY_SEED = '1';
  resetControlRoomStoreForTests(createMemoryStore());
  const store = getControlRoomStore();
  assert('17. memory store kind (Postgres path available separately)', store.kind === 'memory');

  const op = 'op@sliops.test';
  const sup = 'sup@sliops.test';
  const stranger = 'stranger@sliops.test';

  // Current / ensure shift
  let r = await call('GET', '/hub/control-room/current', { actorEmail: op, permissions: OPERATOR });
  assert('current shift loads', r.status === 200 && r.body.shift && r.body.station);
  const stationId = r.body.station.id;
  const shiftId = r.body.shift.id;

  // 1. create/read/edit log
  r = await call('POST', '/hub/control-room/logs', {
    actorEmail: op,
    permissions: OPERATOR,
    body: {
      station_id: stationId,
      shift_id: shiftId,
      category: 'Operations',
      priority: 'Normal',
      summary: 'Pump check',
      details: 'OK',
    },
  });
  assert('1a. create log', r.status === 201 && r.body.log?.id && r.body.log.created_by === op);
  const logId = r.body.log.id;

  r = await call('GET', '/hub/control-room/logs', {
    actorEmail: op,
    permissions: OPERATOR,
    query: { shift_id: shiftId, station_id: stationId },
  });
  assert('1b. read logs', r.status === 200 && (r.body.logs || []).some((l) => l.id === logId));

  r = await call('PATCH', `/hub/control-room/logs/${logId}`, {
    actorEmail: op,
    permissions: OPERATOR,
    body: { summary: 'Pump check (edited)', details: 'Updated note' },
  });
  assert('1c. edit log', r.status === 200 && r.body.log?.summary === 'Pump check (edited)');

  // 2. audit preserved
  r = await call('GET', `/hub/control-room/logs/${logId}/revisions`, {
    actorEmail: op,
    permissions: OPERATOR,
  });
  assert(
    '2. audit revisions preserved',
    r.status === 200 && Array.isArray(r.body.revisions) && r.body.revisions.length >= 2
  );

  // Urgent log for ack tests
  r = await call('POST', '/hub/control-room/logs', {
    actorEmail: op,
    permissions: OPERATOR,
    body: {
      station_id: stationId,
      shift_id: shiftId,
      priority: 'Urgent',
      summary: 'Seal leak',
      carryover: true,
      follow_up: true,
    },
  });
  const urgentId = r.body.log?.id;
  assert('urgent log created', !!urgentId);

  // 3 + 4 acknowledgement
  r = await call('POST', '/hub/control-room/acknowledgements', {
    actorEmail: op,
    permissions: OPERATOR,
    body: { target_type: 'shift_log', target_id: urgentId, shift_id: shiftId },
  });
  assert('3. acknowledgement created', r.status === 201 && r.body.acknowledgement?.user_email === op);
  const ackId = r.body.acknowledgement?.id;

  r = await call('POST', '/hub/control-room/acknowledgements', {
    actorEmail: op,
    permissions: OPERATOR,
    body: { target_type: 'shift_log', target_id: urgentId, shift_id: shiftId },
  });
  assert(
    '4. duplicate acknowledgement returns existing',
    r.status === 200 && r.body.duplicate === true && r.body.acknowledgement?.id === ackId
  );

  // Different user can still append their own ack
  r = await call('POST', '/hub/control-room/acknowledgements', {
    actorEmail: sup,
    permissions: SUPERVISOR,
    body: { target_type: 'shift_log', target_id: urgentId, shift_id: shiftId },
  });
  assert('4b. second user ack is separate append-only row', r.status === 201 && !r.body.duplicate);

  // 5 + 6 board
  r = await call('POST', '/hub/control-room/board', {
    actorEmail: op,
    permissions: OPERATOR,
    body: {
      station_id: stationId,
      title: 'Cooling tower vibration',
      priority: 'Attention',
      status: 'Open',
      linked_log_id: urgentId,
    },
  });
  assert('5a. board create', r.status === 201 && r.body.item?.id);
  const boardId = r.body.item.id;

  r = await call('PATCH', `/hub/control-room/board/${boardId}`, {
    actorEmail: op,
    permissions: OPERATOR,
    body: { status: 'Monitoring', description: 'Watch overnight' },
  });
  assert('5b. board update', r.status === 200 && r.body.item?.status === 'Monitoring');

  // Complete outgoing shift — board must remain
  r = await call('POST', '/hub/control-room/handovers', {
    actorEmail: op,
    permissions: OPERATOR,
    body: {
      station_id: stationId,
      outgoing_note: 'Watch cooling tower + seal leak',
      complete_outgoing_shift: true,
    },
  });
  assert('9. handover generation', r.status === 201 && r.body.handover?.id);
  const handoverId = r.body.handover.id;
  assert(
    '11a. handover payload includes carryover/urgent',
    Array.isArray(r.body.handover.payload?.carryover_logs) &&
      r.body.handover.payload.carryover_logs.includes(urgentId) &&
      r.body.handover.payload.attention_urgent_logs.includes(urgentId)
  );
  assert(
    '11b. unresolved board in handover',
    (r.body.handover.payload?.unresolved_board || []).includes(boardId)
  );

  r = await call('GET', '/hub/control-room/board', {
    actorEmail: op,
    permissions: OPERATOR,
    query: { station_id: stationId, open_only: 'true' },
  });
  assert(
    '6. board persists across shifts',
    r.status === 200 && (r.body.items || []).some((i) => i.id === boardId && i.status !== 'Resolved')
  );

  // New shift after complete
  r = await call('POST', '/hub/control-room/shifts/ensure', {
    actorEmail: op,
    permissions: OPERATOR,
    body: { station_id: stationId, name: 'Incoming' },
  });
  assert('new shift after handover', r.status === 200 && r.body.shift?.id && r.body.shift.id !== shiftId);

  r = await call('POST', `/hub/control-room/handovers/${handoverId}/ack`, {
    actorEmail: sup,
    permissions: SUPERVISOR,
  });
  assert(
    '10. handover acknowledgement',
    r.status === 200 && r.body.handover?.incoming_ack_by === sup && r.body.handover?.incoming_ack_at
  );

  r = await call('POST', `/hub/control-room/board/${boardId}/resolve`, {
    actorEmail: op,
    permissions: OPERATOR,
    body: { resolution_note: 'Vibration normal' },
  });
  assert(
    '5c. board resolve',
    r.status === 200 && r.body.item?.status === 'Resolved' && r.body.item?.resolved_by === op
  );

  // 7 tasks
  const pastDue = new Date(Date.now() - 3600 * 1000).toISOString();
  r = await call('POST', '/hub/control-room/tasks', {
    actorEmail: op,
    permissions: OPERATOR,
    body: {
      station_id: stationId,
      title: 'Inspect seal',
      assignee_email: op,
      due_at: pastDue,
      priority: 'Urgent',
      linked_log_id: urgentId,
    },
  });
  assert('7a. task create/assign', r.status === 201 && r.body.task?.assignee_email === op);
  const taskId = r.body.task.id;
  assert('8. overdue calculation on task', r.body.task.overdue === true);

  r = await call('PATCH', `/hub/control-room/tasks/${taskId}`, {
    actorEmail: op,
    permissions: OPERATOR,
    body: { status: 'Completed', completion_note: 'Replaced gasket' },
  });
  assert(
    '7b. task complete',
    r.status === 200 &&
      r.body.task?.status === 'Completed' &&
      r.body.task?.completed_by === op &&
      r.body.task?.overdue === false
  );

  // 12 schedule
  const workDate = '2026-10-05';
  r = await call('POST', '/hub/control-room/schedule', {
    actorEmail: sup,
    permissions: SUPERVISOR,
    body: {
      station_id: stationId,
      operator_email: op,
      operator_user_id: 'entra-oid-op-test',
      work_date: workDate,
      starts_at: `${workDate}T08:00:00.000Z`,
      ends_at: `${workDate}T16:00:00.000Z`,
      role_context: 'operator',
    },
  });
  assert(
    '12. schedule assignment',
    r.status === 201 &&
      r.body.assignment?.operator_email === op &&
      r.body.assignment?.operator_user_id === 'entra-oid-op-test'
  );

  r = await call('POST', '/hub/control-room/schedule', {
    actorEmail: sup,
    permissions: SUPERVISOR,
    body: {
      station_id: stationId,
      operator_email: 'other@sliops.test',
      work_date: workDate,
      starts_at: `${workDate}T12:00:00.000Z`,
      ends_at: `${workDate}T20:00:00.000Z`,
      role_context: 'operator',
    },
  });
  assert(
    '12b. overlapping assignment rejected 409',
    r.status === 409 && r.body.code === 'CR_SCHEDULE_OVERLAP'
  );

  r = await call('POST', '/hub/control-room/schedule', {
    actorEmail: sup,
    permissions: SUPERVISOR,
    body: {
      station_id: stationId,
      operator_email: 'other@sliops.test',
      work_date: workDate,
      starts_at: `${workDate}T16:00:00.000Z`,
      ends_at: `${workDate}T20:00:00.000Z`,
      role_context: 'operator',
    },
  });
  assert('12c. non-overlapping second assignment', r.status === 201);

  r = await call('GET', '/hub/control-room/schedule', {
    actorEmail: op,
    permissions: OPERATOR,
    query: { station_id: stationId, work_date: workDate },
  });
  assert(
    '13. overlap/gap handling',
    r.status === 200 &&
      Array.isArray(r.body.overlaps) &&
      Array.isArray(r.body.gaps)
  );

  // Directory endpoint (schedule managers)
  const { setEmployeeDirectoryForTests } = require(path.join(ROOT, 'api/lib/user-directory.js'));
  setEmployeeDirectoryForTests(() => [
    { id: 'oid-1', email: op, name: 'Operator One', external_id: 'oid-1' },
    { id: 'oid-2', email: 'other@sliops.test', name: 'Other Op', external_id: 'oid-2' },
  ]);
  r = await call('GET', '/hub/control-room/directory', {
    actorEmail: sup,
    permissions: SUPERVISOR,
    query: { q: 'operator' },
  });
  assert(
    '12d. directory searchable for schedule managers',
    r.status === 200 &&
      (r.body.employees || []).some((e) => e.email === op) &&
      r.body.source === 'local_directory'
  );
  r = await call('GET', '/hub/control-room/directory', {
    actorEmail: 'nobody@sliops.test',
    permissions: [],
  });
  assert('12e. directory denied without CR view', r.status === 403);
  setEmployeeDirectoryForTests(null);

  // Week range + PATCH/DELETE
  r = await call('GET', '/hub/control-room/schedule', {
    actorEmail: op,
    permissions: OPERATOR,
    query: {
      station_id: stationId,
      work_date_from: workDate,
      work_date_to: workDate,
    },
  });
  assert(
    '12f. week/range list returns gaps_by_date',
    r.status === 200 &&
      Array.isArray(r.body.assignments) &&
      r.body.gaps_by_date &&
      Array.isArray(r.body.gaps_by_date[workDate])
  );

  const schedId = (
    await call('GET', '/hub/control-room/schedule', {
      actorEmail: op,
      permissions: OPERATOR,
      query: { station_id: stationId, work_date: workDate },
    })
  ).body.assignments.find((a) => a.operator_email === op)?.id;

  r = await call('PATCH', '/hub/control-room/schedule/' + encodeURIComponent(schedId), {
    actorEmail: op,
    permissions: OPERATOR,
    body: { ends_at: `${workDate}T17:00:00.000Z` },
  });
  assert('12g. operator cannot PATCH schedule 403', r.status === 403);

  r = await call('PATCH', '/hub/control-room/schedule/' + encodeURIComponent(schedId), {
    actorEmail: sup,
    permissions: SUPERVISOR,
    body: {
      starts_at: `${workDate}T09:00:00.000Z`,
      ends_at: `${workDate}T15:00:00.000Z`,
    },
  });
  assert(
    '12h. supervisor PATCH schedule',
    r.status === 200 && r.body.assignment?.starts_at === `${workDate}T09:00:00.000Z`
  );

  r = await call('PATCH', '/hub/control-room/schedule/' + encodeURIComponent(schedId), {
    actorEmail: sup,
    permissions: SUPERVISOR,
    body: {
      starts_at: `${workDate}T16:30:00.000Z`,
      ends_at: `${workDate}T19:00:00.000Z`,
    },
  });
  assert('12i. PATCH overlap rejected 409', r.status === 409 && r.body.code === 'CR_SCHEDULE_OVERLAP');

  const overnightDate = '2026-10-06';
  r = await call('POST', '/hub/control-room/schedule', {
    actorEmail: sup,
    permissions: SUPERVISOR,
    body: {
      station_id: stationId,
      operator_email: 'night@sliops.test',
      work_date: overnightDate,
      starts_at: '2026-10-06T23:00:00.000Z',
      ends_at: '2026-10-07T07:00:00.000Z',
      role_context: 'operator',
    },
  });
  assert('12j. overnight shift create', r.status === 201);
  const nightId = r.body.assignment?.id;

  r = await call('DELETE', '/hub/control-room/schedule/' + encodeURIComponent(nightId), {
    actorEmail: op,
    permissions: OPERATOR,
  });
  assert('12k. operator cannot DELETE 403', r.status === 403);

  r = await call('DELETE', '/hub/control-room/schedule/' + encodeURIComponent(nightId), {
    actorEmail: sup,
    permissions: SUPERVISOR,
  });
  assert('12l. supervisor DELETE schedule', r.status === 200 && r.body.deleted === true);

  // Date formatting helpers
  const { formatDateTimeRange, eachDateInclusive } = require(path.join(ROOT, 'api/lib/control-room/logic.js'));
  const overnightLabel = formatDateTimeRange('2026-10-06T23:00:00.000Z', '2026-10-07T07:00:00.000Z', 'UTC');
  assert(
    '12m. overnight range readable (no raw ISO)',
    !overnightLabel.includes('T23:') &&
      overnightLabel.includes('–') &&
      /Oct/.test(overnightLabel)
  );
  assert(
    '12n. eachDateInclusive week length',
    eachDateInclusive('2026-10-05', '2026-10-11').length === 7
  );

  // Operator cannot manage schedule
  r = await call('POST', '/hub/control-room/schedule', {
    actorEmail: op,
    permissions: OPERATOR,
    body: {
      station_id: stationId,
      operator_email: op,
      work_date: workDate,
      starts_at: `${workDate}T20:00:00.000Z`,
      ends_at: `${workDate}T23:00:00.000Z`,
    },
  });
  assert('14. operator schedule mutate denied 403', r.status === 403);

  // 15 supervisor overview
  r = await call('GET', '/hub/control-room/supervisor', {
    actorEmail: op,
    permissions: OPERATOR,
    query: { station_id: stationId },
  });
  assert('15a. operator supervisor overview denied 403', r.status === 403);

  r = await call('GET', '/hub/control-room/supervisor', {
    actorEmail: sup,
    permissions: SUPERVISOR,
    query: { station_id: stationId },
  });
  assert(
    '15b. supervisor overview',
    r.status === 200 &&
      Array.isArray(r.body.active_operators) &&
      Array.isArray(r.body.open_board_items)
  );

  // 16 history filters
  r = await call('GET', '/hub/control-room/history', {
    actorEmail: op,
    permissions: OPERATOR,
    query: { station_id: stationId, record_type: 'shift_log', priority: 'Urgent' },
  });
  assert(
    '16. history filters',
    r.status === 200 &&
      (r.body.items || []).every((i) => i.record_type === 'shift_log' && i.priority === 'Urgent') &&
      (r.body.items || []).some((i) => i.id === urgentId)
  );

  // 18 unauthorized mutations
  r = await call('POST', '/hub/control-room/logs', {
    actorEmail: stranger,
    permissions: VIEW_ONLY,
    body: { summary: 'Nope', station_id: stationId, shift_id: shiftId },
  });
  assert('18a. view-only log create 403', r.status === 403);

  r = await call('POST', '/hub/control-room/board', {
    actorEmail: stranger,
    permissions: VIEW_ONLY,
    body: { title: 'Nope', station_id: stationId },
  });
  assert('18b. view-only board create 403', r.status === 403);

  r = await call('POST', '/hub/control-room/tasks', {
    actorEmail: stranger,
    permissions: VIEW_ONLY,
    body: { title: 'Nope', station_id: stationId },
  });
  assert('18c. view-only task create 403', r.status === 403);

  r = await call('GET', '/hub/control-room/current', {
    actorEmail: null,
    permissions: [],
  });
  assert('18d. unauthenticated 401', r.status === 401);

  r = await call('GET', '/hub/control-room/current', {
    actorEmail: stranger,
    permissions: [],
  });
  assert('18e. no CR perms 403', r.status === 403);

  // Static wiring checks
  const fs = require('fs');
  const migration = fs.readFileSync(path.join(ROOT, 'migrations/015_control_room.sql'), 'utf8');
  assert('17b. migration defines cr_shift_logs', migration.includes('cr_shift_logs'));
  assert('17c. migration append-only acks', migration.includes('cr_acknowledgements'));
  assert('17d. migration board + tasks + schedule', /cr_board_items/.test(migration) && /cr_tasks/.test(migration) && /cr_schedule_assignments/.test(migration));

  const hubRoutes = fs.readFileSync(path.join(ROOT, 'api/lib/hub/routes.js'), 'utf8');
  assert('wired into hub routes', hubRoutes.includes('handleControlRoomRoutes'));

  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert('UI nav Control Room', indexHtml.includes('hub-control-room') && indexHtml.includes('hub-control-room.js'));

  const catalog = fs.readFileSync(path.join(ROOT, 'api/maintainx.js'), 'utf8');
  assert('permission catalog has control_room_*', catalog.includes("id: 'control_room_view'"));

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('RESULT: FAIL');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
  }
  console.log('RESULT: PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
