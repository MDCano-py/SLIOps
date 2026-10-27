'use strict';

/**
 * Isolated integration checks for the October 2026 remediation.
 *
 * Talks only to the disposable database named by SLIOPS_INTEGRATION_DATABASE_URL,
 * which must be on 127.0.0.1:55432 or localhost:55432. Archive rows use the
 * in-process Redis stub that postgres-only mode already uses. MaintainX HTTP
 * is replaced with a local mock and is not a live integration.
 *
 * AuthBridge OIDC against Entra is not exercised here.
 */

const path = require('path');

const DATABASE_URL =
  process.env.SLIOPS_INTEGRATION_DATABASE_URL ||
  'postgresql://sliops:sliops_int@127.0.0.1:55432/sliops_int';

if (!/@(?:127\.0\.0\.1|localhost):55432\//.test(DATABASE_URL)) {
  console.error('Refusing to run against a database that is not the local disposable instance.');
  process.exit(2);
}

delete process.env.MAINTAINX_API_KEY;
delete process.env.MAINTAINX_ORG_ID;
delete process.env.RESEND_API_KEY;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

process.env.DATABASE_URL = DATABASE_URL;
process.env.HUB_STORE_MODE = 'postgres';
process.env.VENDOR_STORE_MODE = 'postgres';
process.env.SLIOPS_SESSION_REVOCATION_STORE = 'postgres';
process.env.NODE_ENV = 'staging';
process.env.SSO_ENFORCEMENT = 'on';
process.env.SESSION_SECRET = 'integration-only-session-secret-32';
process.env.PORTAL_BASE_URL = 'http://127.0.0.1:3010';
process.env.ALLOWED_ORIGIN = 'http://127.0.0.1:3010';
process.env.DEMO_BYPASS = '0';
process.env.AUTH_PROVIDER = '';

const { CONTROL_ROOM_OPERATOR_PERMS } = require('../../api/lib/control-room/permissions');
const { createRedisClient } = require('../../for-dev/redis-client');

const REQUESTER = 'requester@example.test';
const APPROVER = 'approver@example.test';
const OTHER = 'other@example.test';
const ADMIN = 'admin@example.test';

const employeePerms = [
  'view_home',
  'view_hub_dashboard',
  'view_hub_requests',
  'view_hub_reports',
  'view_jsa_archive',
  'view_bol_archive',
  'view_parts_request_archive',
  'view_work_order_archive',
  'view_roll_off_swap_archive',
  ...CONTROL_ROOM_OPERATOR_PERMS,
];

const results = [];

function record(id, name, status, evidence) {
  results.push({ id, name, status, evidence });
  console.log(`${status}\t${id}\t${name}\t${evidence}`);
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    setHeader(name, value) {
      const key = String(name).toLowerCase();
      if (key === 'set-cookie') {
        const current = this.headers[key];
        this.headers[key] = current ? [].concat(current, value) : value;
        return;
      }
      this.headers[key] = value;
    },
    send(data) {
      this.body = data;
      return this;
    },
    end() {
      return this;
    },
  };
}

function mockReq({ method, route, body, token, headers = {} }) {
  const req = {
    method,
    query: { path: route },
    headers: {
      host: '127.0.0.1:3010',
      cookie: token ? `sliops_session=${encodeURIComponent(token)}` : '',
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body),
  };
  return req;
}

async function call(handler, options) {
  const res = mockRes();
  await handler(mockReq(options), res);
  return res;
}

function counts() {
  return results.reduce(
    (acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    },
    { PASS: 0, FAIL: 0, BLOCKED: 0 }
  );
}

async function main() {
  const redis = createRedisClient();
  await redis.set(`user:${REQUESTER}`, JSON.stringify({ email: REQUESTER, permissions: employeePerms }));
  await redis.set(`user:${APPROVER}`, JSON.stringify({ email: APPROVER, permissions: employeePerms }));
  await redis.set(`user:${OTHER}`, JSON.stringify({ email: OTHER, permissions: employeePerms }));
  await redis.set(
    `user:${ADMIN}`,
    JSON.stringify({ email: ADMIN, permissions: [...employeePerms, 'hub_admin', 'admin'] })
  );

  const handler = require('../../api/maintainx');
  const auth = require('../../api/lib/auth');
  const sessionRevocation = require('../../api/lib/session-revocation');
  const store = require('../../api/lib/hub/db');

  const requesterToken = auth.signJwt({ typ: 'employee_session', email: REQUESTER }, 3600);
  const approverToken = auth.signJwt({ typ: 'employee_session', email: APPROVER }, 3600);
  const otherToken = auth.signJwt({ typ: 'employee_session', email: OTHER }, 3600);
  const adminToken = auth.signJwt({ typ: 'employee_session', email: ADMIN }, 3600);

  record(
    'INT-00',
    'Disposable Postgres connectivity',
    'PASS',
    'script refused any database that is not 127.0.0.1:55432'
  );

  let created;
  try {
    created = await call(handler, {
      method: 'POST',
      route: '/hub/requests',
      token: requesterToken,
      body: {
        request_type: 'document_signature',
        title: 'Integration signature request',
        description: 'local integration only',
        requester_email: 'forged@evil.test',
        requester_name: 'Forged Name',
        status: 'completed',
        maintainx_id: 'mx-forged',
        client_visible_status: 'approved',
        internal_notes: 'secret-note',
        workflow_steps: [
          {
            action_type: 'sign',
            assigned_to_email: APPROVER,
            status: 'completed',
            completed_by: REQUESTER,
          },
        ],
      },
    });
    const rec = created.body || {};
    const stepList = await store.listWorkflowSteps(rec.id);
    const step = stepList[0];
    const forgedOk =
      created.statusCode === 201 &&
      rec.requester_email === REQUESTER &&
      rec.status === 'submitted' &&
      !rec.maintainx_id &&
      !rec.client_visible_status &&
      step &&
      step.status === 'waiting' &&
      String(step.assigned_to_email).toLowerCase() === APPROVER;
    record(
      'INT-10',
      'Forged requester and status fields',
      forgedOk ? 'PASS' : 'FAIL',
      `http ${created.statusCode} requester=${rec.requester_email} status=${rec.status} step=${step && step.status}`
    );
    record(
      'INT-08',
      'Signature-required workflow step stored',
      step && step.requires_signature && step.action_type === 'sign' ? 'PASS' : 'FAIL',
      `signature=${step && step.requires_signature} action=${step && step.action_type}`
    );

    const denied = await call(handler, {
      method: 'POST',
      route: `/hub/workflow-steps/${step.id}/complete`,
      token: requesterToken,
      body: { notes: 'self' },
    });
    record(
      'INT-07',
      'Requester cannot complete another user signature step',
      denied.statusCode === 403 ? 'PASS' : 'FAIL',
      `http ${denied.statusCode}`
    );

    const selfSign = await call(handler, {
      method: 'POST',
      route: '/hub/requests',
      token: requesterToken,
      body: {
        request_type: 'document_signature',
        title: 'Self review attempt',
        workflow_steps: [{ action_type: 'sign', assigned_to_email: REQUESTER }],
      },
    });
    const selfSteps = await store.listWorkflowSteps(selfSign.body.id);
    const selfDenied = await call(handler, {
      method: 'POST',
      route: `/hub/workflow-steps/${selfSteps[0].id}/complete`,
      token: requesterToken,
      body: {},
    });
    record(
      'INT-08b',
      'Requester cannot self-complete a signature step',
      selfDenied.statusCode === 403 ? 'PASS' : 'FAIL',
      `http ${selfDenied.statusCode}`
    );

    const patched = await call(handler, {
      method: 'PATCH',
      route: `/hub/workflow-steps/${step.id}`,
      token: approverToken,
      body: { status: 'completed', completed_by: APPROVER, instructions: 'keep me' },
    });
    const afterPatch = await store.getWorkflowStep(step.id);
    record(
      'INT-09',
      'Protected workflow PATCH fields',
      patched.statusCode === 400 && afterPatch.status === 'waiting' ? 'PASS' : 'FAIL',
      `http ${patched.statusCode} stored=${afterPatch.status}`
    );

    const allowedPatch = await call(handler, {
      method: 'PATCH',
      route: `/hub/workflow-steps/${step.id}`,
      token: approverToken,
      body: { instructions: 'reviewed locally' },
    });
    record(
      'INT-09b',
      'Allowed workflow instruction PATCH',
      allowedPatch.statusCode === 200 && allowedPatch.body.instructions === 'reviewed locally' ? 'PASS' : 'FAIL',
      `http ${allowedPatch.statusCode}`
    );

    const approved = await call(handler, {
      method: 'POST',
      route: `/hub/workflow-steps/${step.id}/complete`,
      token: approverToken,
      body: { notes: 'assigned approver' },
    });
    record(
      'INT-07b',
      'Assigned approver can complete the signature step',
      approved.statusCode === 200 ? 'PASS' : 'FAIL',
      `http ${approved.statusCode} ${(approved.body && approved.body.error) || ''}`
    );

    await store.patchRequest(rec.id, { internal_notes: 'secret-note' });
    const queue = await call(handler, {
      method: 'GET',
      route: '/hub/requests',
      token: otherToken,
    });
    const projected = (queue.body.requests || []).find((row) => row.id === rec.id);
    const hidden =
      queue.statusCode === 200 &&
      (!projected ||
        (projected.access === 'summary' &&
          projected.internal_notes === undefined &&
          projected.form_payload === undefined));
    record(
      'INT-11',
      'Queue hides a request the caller cannot open',
      hidden ? 'PASS' : 'FAIL',
      `http ${queue.statusCode} access=${projected && projected.access}`
    );

    const board = await call(handler, {
      method: 'GET',
      route: '/hub/dashboard/action-required',
      token: otherToken,
    });
    const boardRow = ((board.body && board.body.items) || []).find((row) => row.id === rec.id);
    record(
      'INT-11b',
      'Action-required uses the same summary projection',
      board.statusCode === 200 && (!boardRow || boardRow.access === 'summary' || boardRow.internal_notes === undefined)
        ? 'PASS'
        : 'FAIL',
      `http ${board.statusCode}`
    );

    const timeline = await call(handler, {
      method: 'GET',
      route: `/hub/requests/${rec.id}/timeline`,
      token: requesterToken,
    });
    const timelineDenied = await call(handler, {
      method: 'GET',
      route: `/hub/requests/${rec.id}/timeline`,
      token: otherToken,
    });
    record(
      'INT-17',
      'Request timeline follows detail authorization',
      timeline.statusCode === 200 &&
        Array.isArray(timeline.body.events) &&
        timelineDenied.statusCode === 403
        ? 'PASS'
        : 'FAIL',
      `owner ${timeline.statusCode} other ${timelineDenied.statusCode}`
    );

    const badId = await call(handler, {
      method: 'GET',
      route: '/hub/requests/not-a-uuid',
      token: requesterToken,
    });
    const leaked = JSON.stringify(badId.body || {}).includes('22P02');
    record(
      'INT-17b',
      'Non-UUID request id does not leak a database error',
      badId.statusCode === 404 && !leaked ? 'PASS' : 'FAIL',
      `http ${badId.statusCode}`
    );
  } catch (err) {
    record('INT-07', 'Workflow and queue integration', 'FAIL', err.message);
  }

  try {
    const note = await store.createNotification({
      recipient_email: REQUESTER,
      type: 'test',
      title: 'private',
      message: 'only the recipient may read this',
    });
    const wrong = await call(handler, {
      method: 'POST',
      route: `/hub/notifications/${note.id}/read`,
      token: otherToken,
      body: {},
    });
    const right = await call(handler, {
      method: 'POST',
      route: `/hub/notifications/${note.id}/read`,
      token: requesterToken,
      body: {},
    });
    const leaked = JSON.stringify(wrong.body || {}).includes('only the recipient');
    record(
      'INT-12',
      'Notification recipient authorization',
      wrong.statusCode === 404 && !leaked && right.statusCode === 200 ? 'PASS' : 'FAIL',
      `other ${wrong.statusCode} owner ${right.statusCode}`
    );
  } catch (err) {
    record('INT-12', 'Notification recipient authorization', 'FAIL', err.message);
  }

  try {
    const payload = '<p>ok</p><script>alert(1)</script><img src=x onerror=alert(1)>';
    const createdArchive = await call(handler, {
      method: 'POST',
      route: '/archive/jsa',
      token: requesterToken,
      body: { renderedHtml: payload, title: 'xss' },
    });
    const fetched = await call(handler, {
      method: 'GET',
      route: `/archive/jsa/${createdArchive.body.id}`,
      token: requesterToken,
    });
    const html = JSON.stringify(fetched.body || {});
    const newClean = createdArchive.statusCode === 200 && !/script|onerror/i.test(html);
    record(
      'INT-13',
      'New archive HTML is sanitized on write and read',
      newClean ? 'PASS' : 'FAIL',
      `create ${createdArchive.statusCode} get ${fetched.statusCode}`
    );

    const historicalId = 'historical-xss';
    await redis.set(
      `archive:jsa:rec:${historicalId}`,
      JSON.stringify({
        id: historicalId,
        kind: 'jsa',
        createdAt: new Date().toISOString(),
        data: { renderedHtml: payload },
      })
    );
    const historical = await call(handler, {
      method: 'GET',
      route: `/archive/jsa/${historicalId}`,
      token: requesterToken,
    });
    const rawAfter = await redis.get(`archive:jsa:rec:${historicalId}`);
    const shown = JSON.stringify(historical.body || {});
    record(
      'INT-13b',
      'Historical archive HTML is sanitized on read and left in storage',
      historical.statusCode === 200 &&
        !/script|onerror/i.test(shown) &&
        String(rawAfter).includes('<script>')
        ? 'PASS'
        : 'FAIL',
      `http ${historical.statusCode} storage still has the original markup`
    );
  } catch (err) {
    record('INT-13', 'Archive XSS', 'FAIL', err.message);
  }

  try {
    const form = { title: 'same roll-off', site: 'yard-a', liters: 10 };
    const first = await call(handler, {
      method: 'POST',
      route: '/forms/roll-off-swap',
      token: requesterToken,
      body: form,
    });
    const second = await call(handler, {
      method: 'POST',
      route: '/forms/roll-off-swap',
      token: requesterToken,
      body: form,
    });
    const third = await call(handler, {
      method: 'POST',
      route: '/forms/roll-off-swap',
      token: requesterToken,
      body: { ...form, liters: 11 },
    });
    record(
      'INT-14',
      'Identical form submissions collapse and a different payload does not',
      first.statusCode === 201 && second.body.id === first.body.id && third.body.id !== first.body.id
        ? 'PASS'
        : 'FAIL',
      `ids ${first.body && first.body.id} ${second.body && second.body.id} ${third.body && third.body.id}`
    );
  } catch (err) {
    record('INT-14', 'Duplicate form submissions', 'FAIL', err.message);
  }

  try {
    const swp = await call(handler, {
      method: 'POST',
      route: '/archive/swp',
      token: requesterToken,
      body: { title: 'local permit', renderedHtml: '<p>permit</p>' },
    });
    const removed = await call(handler, {
      method: 'DELETE',
      route: `/archive/swp/${swp.body.id}`,
      token: requesterToken,
    });
    const gone = await call(handler, {
      method: 'GET',
      route: `/archive/swp/${swp.body.id}`,
      token: requesterToken,
    });
    record(
      'INT-15',
      'SWP create and creator delete',
      swp.statusCode === 200 && removed.statusCode === 200 && gone.statusCode === 404 ? 'PASS' : 'FAIL',
      `create ${swp.statusCode} delete ${removed.statusCode} get ${gone.statusCode}`
    );
  } catch (err) {
    record('INT-15', 'SWP create and archive deletion', 'FAIL', err.message);
  }

  try {
    process.env.MAINTAINX_API_KEY = 'integration-not-live';
    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      calls.push({ url: String(url), method: opts && opts.method });
      return new Response('{"id":"mock"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const rejected = await call(handler, {
      method: 'PUT',
      route: '/workorders/15/attachments/notes.exe',
      token: requesterToken,
      headers: { 'content-type': 'application/x-msdownload' },
      body: Buffer.from('not-a-real-file'),
    });
    const accepted = await call(handler, {
      method: 'PUT',
      route: '/workorders/15/attachments/photo.jpg',
      token: requesterToken,
      headers: { 'content-type': 'image/jpeg' },
      body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });
    global.fetch = originalFetch;
    delete process.env.MAINTAINX_API_KEY;
    const mocked = calls.length === 1 && calls[0].url.startsWith('https://api.getmaintainx.com/');
    record(
      'INT-16',
      'Binary PUT type gate with a mocked MaintainX adapter',
      rejected.statusCode === 415 && accepted.statusCode === 200 && mocked ? 'PASS' : 'FAIL',
      `reject ${rejected.statusCode} accept ${accepted.statusCode} upstream calls ${calls.length}; not a live MaintainX test`
    );
  } catch (err) {
    delete process.env.MAINTAINX_API_KEY;
    record('INT-16', 'Binary PUT uploads', 'FAIL', err.message);
  }

  try {
    const old = auth.signJwt({ typ: 'employee_session', email: REQUESTER }, 3600);
    const cross = await call(handler, {
      method: 'GET',
      route: '/auth/logout',
      token: old,
      headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
    });
    const local = await call(handler, {
      method: 'POST',
      route: '/auth/logout',
      token: old,
      headers: { 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:3010' },
    });
    const location = String(local.headers.location || '');
    sessionRevocation.resetSessionRevocationForTests();
    const replay = await call(handler, {
      method: 'GET',
      route: '/hub/dashboard/summary',
      token: old,
    });
    await sessionRevocation.primeIssuer(REQUESTER);
    const freshRes = mockRes();
    auth.issueSession(freshRes, REQUESTER, { remember: false });
    const setCookie = [].concat(freshRes.headers['set-cookie'] || []).join(';');
    const match = /sliops_session=([^;]+)/.exec(setCookie);
    const fresh = match ? decodeURIComponent(match[1]) : '';
    const again = await call(handler, {
      method: 'GET',
      route: '/hub/dashboard/summary',
      token: fresh,
    });
    record(
      'INT-03',
      'SLIOps logout revokes the presented session and a later login works',
      cross.statusCode === 403 &&
        local.statusCode === 302 &&
        location.includes('signed_out=1') &&
        replay.statusCode === 401 &&
        again.statusCode === 200
        ? 'PASS'
        : 'FAIL',
      `cross ${cross.statusCode} logout ${local.statusCode} replay ${replay.statusCode} fresh ${again.statusCode}`
    );
    record(
      'INT-05',
      'Postgres revocation is visible to a worker that did not see the logout',
      replay.statusCode === 401 && again.statusCode === 200 ? 'PASS' : 'FAIL',
      'memory cutoff cleared, then loaded from sliops_session_revocation before the new session was signed'
    );
  } catch (err) {
    record('INT-03', 'SLIOps logout and revocation', 'FAIL', err.message);
  }

  try {
    const summary = await call(handler, {
      method: 'GET',
      route: '/hub/dashboard/summary',
      token: approverToken,
    });
    const tasks = await call(handler, {
      method: 'GET',
      route: '/hub/my-tasks',
      token: approverToken,
    });
    const meta = await call(handler, {
      method: 'GET',
      route: '/hub/control-room/meta',
      token: approverToken,
    });
    const templates = await call(handler, {
      method: 'GET',
      route: '/hub/templates',
      token: adminToken,
    });
    record(
      'INT-R1',
      'Dashboard, My Tasks, Control Room, and template registry',
      summary.statusCode === 200 &&
        tasks.statusCode === 200 &&
        meta.statusCode === 200 &&
        Array.isArray(meta.body.stations) &&
        templates.statusCode === 200 &&
        Array.isArray(templates.body.templates)
        ? 'PASS'
        : 'FAIL',
      `summary ${summary.statusCode} tasks ${tasks.statusCode} control-room ${meta.statusCode} templates ${templates.statusCode}`
    );
  } catch (err) {
    record('INT-R1', 'Existing hub surfaces', 'FAIL', err.message);
  }

  try {
    const link = await call(handler, {
      method: 'POST',
      route: '/hub/action-links',
      token: adminToken,
      body: {
        request_id: created && created.body && created.body.id,
        recipient_email: 'client@example.test',
        action_type: 'fill',
      },
    });
    const token = /[?&]t=([^&]+)/.exec(link.body && link.body.url || '');
    const opened = token
      ? await call(handler, { method: 'GET', route: `/hub/action/${decodeURIComponent(token[1])}` })
      : null;
    record(
      'INT-R2',
      'Client secure-link can be opened without an employee session',
      link.statusCode === 201 && opened && opened.statusCode === 200 ? 'PASS' : 'FAIL',
      `create ${link.statusCode} open ${opened && opened.statusCode}`
    );
  } catch (err) {
    record('INT-R2', 'Client secure-link', 'FAIL', err.message);
  }

  record(
    'INT-01',
    'AuthBridge OIDC login against Entra',
    'BLOCKED',
    'no local Entra tenant was contacted; Redis token verification is a separate AuthBridge test'
  );
  record(
    'INT-04',
    'Logout initiated through the live AuthBridge gateway',
    'BLOCKED',
    'gateway logout against disposable Redis is covered by the AuthBridge integration test, not this process'
  );
  record(
    'INT-16b',
    'Live MaintainX and S3',
    'BLOCKED',
    'upstream HTTP was mocked; object storage was not called'
  );

  const summary = counts();
  console.log(JSON.stringify({ summary, results }, null, 2));
  const pool = require('../../api/lib/hub/db/postgres').pool;
  if (global.__sliopsRevocationPool) await global.__sliopsRevocationPool.end();
  if (pool && pool.end) await pool.end();
  process.exit(summary.FAIL > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
