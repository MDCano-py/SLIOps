#!/usr/bin/env node
/**
 * Ensures proxied hub paths with embedded ?query match routes.
 * Usage: npm run security:hub-path-query-normalize-test
 */
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

process.env.CONTROL_ROOM_STORE = 'memory';
process.env.CONTROL_ROOM_MEMORY_SEED = '1';

const {
  createMemoryStore,
  resetControlRoomStoreForTests,
} = require(path.join(ROOT, 'api/lib/control-room/store.js'));
const { handleControlRoomRoutes } = require(path.join(ROOT, 'api/lib/control-room/routes.js'));
const fs = require('fs');

let passed = 0;
let failed = 0;

function assert(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
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

async function call(routePath, { actorEmail, permissions, query } = {}) {
  const req = { method: 'GET', query: query || {} };
  const res = mockRes();
  await handleControlRoomRoutes(routePath, req, res, {
    actorEmail: actorEmail || 'op@sliops.test',
    permissions: permissions || [
      'control_room_view',
      'control_room_log',
      'control_room_acknowledge',
      'control_room_handover',
      'control_room_task_manage',
      'control_room_board_manage',
      'control_room_schedule_view',
    ],
  });
  return { status: res.statusCode, body: res.body, query: req.query };
}

async function main() {
  console.log('=== Hub path query normalize / Control Room route fix ===\n');

  const mx = fs.readFileSync(path.join(ROOT, 'api/maintainx.js'), 'utf8');
  assert(
    'maintainx splits embedded ?query from hub path',
    mx.includes("hubPath.includes('?')") && mx.includes('URLSearchParams')
  );

  resetControlRoomStoreForTests(createMemoryStore());

  let r = await call('/hub/control-room/current');
  assert('current without query works', r.status === 200 && r.body.station);

  r = await call('/hub/control-room/logs?shift_id=abc&station_id=xyz');
  assert(
    'logs with embedded query does not 404',
    r.status === 200 && Array.isArray(r.body.logs),
    `status=${r.status} err=${r.body && r.body.error}`
  );
  assert('embedded shift_id merged into req.query', r.query.shift_id === 'abc');
  assert('embedded station_id merged into req.query', r.query.station_id === 'xyz');

  r = await call('/hub/control-room/meta?station_id=xyz');
  assert('meta with embedded query works', r.status === 200 && Array.isArray(r.body.stations));

  r = await call('/hub/control-room/history?record_type=shift_log&priority=Urgent');
  assert(
    'history with embedded query does not return route-not-found',
    r.status === 200 && Array.isArray(r.body.items),
    `status=${r.status} err=${r.body && r.body.error}`
  );

  r = await call('/hub/control-room/does-not-exist');
  assert(
    'unknown CR path still 404 with Control Room message',
    r.status === 404 && /Control Room route not found/.test(r.body.error || '')
  );

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
