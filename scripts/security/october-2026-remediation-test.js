#!/usr/bin/env node
/**
 * October 2026 remediation regressions.
 * Local fixtures only. Does not call staging or production.
 */
'use strict';

const assert = require('assert');
const { createMemoryRedisStub, resetRedisClientForTests } = require('../../for-dev/redis-client');
const { sanitizeRenderedHtml } = require('../../api/lib/html-sanitize');
const hubAuthz = require('../../api/lib/hub/authorization');
const idem = require('../../api/lib/archive-idempotency');
const sessionRevocation = require('../../api/lib/session-revocation');
const logoutCsrf = require('../../api/lib/logout-csrf');
const upload = require('../../api/lib/maintainx-upload');

const SECRET = 'unit-test-session-secret-32chars-min';

function ok(name, cond) {
  assert.ok(cond, name);
  console.log(`  PASS  ${name}`);
}

async function main() {
  process.env.SESSION_SECRET = SECRET;
  delete process.env.SLIOPS_SESSION_REVOCATION_STORE;
  const auth = require('../../api/lib/auth');
  sessionRevocation.resetSessionRevocationForTests();
  idem.resetArchiveIdempotencyForTests();
  resetRedisClientForTests();

  console.log('\n=== stored HTML snapshot ===');
  const img = sanitizeRenderedHtml('<img src=x onerror="window.__retestW03=1">');
  ok('img onerror stripped', !/onerror/i.test(img) && !img.includes('__retestW03'));
  const script = sanitizeRenderedHtml('<script>window.__retestW03=1</script><b>Keep</b>');
  ok('script removed and bold kept', !/script/i.test(script) && script.includes('<b>'));
  const link = sanitizeRenderedHtml('<a href="javascript:alert(1)">x</a>');
  ok('javascript url removed', !/javascript:/i.test(link));
  const table = sanitizeRenderedHtml('<table><tr><td>BOL</td></tr></table>');
  ok('table formatting kept', table.includes('<td>'));

  console.log('\n=== workflow separation ===');
  const request = { requester_email: 'a@example.com' };
  const signStep = {
    action_type: 'sign',
    requires_signature: true,
    assigned_to_email: 'b@example.com',
  };
  const asRequester = hubAuthz.canCompleteOrRejectStep(signStep, request, 'a@example.com', {});
  ok('requester cannot complete another user signature step', asRequester.ok === false);
  const asAssignee = hubAuthz.canCompleteOrRejectStep(signStep, request, 'b@example.com', {});
  ok('assignee can complete signature step', asAssignee.ok === true && asAssignee.via === 'assignee');
  const selfSign = hubAuthz.canCompleteOrRejectStep(
    { ...signStep, assigned_to_email: 'a@example.com' },
    request,
    'a@example.com',
    {}
  );
  ok('requester cannot self-sign a signature step', selfSign.ok === false && selfSign.reason === 'self_review');
  const fill = hubAuthz.canCompleteOrRejectStep(
    { action_type: 'fill', assigned_to_email: 'a@example.com' },
    request,
    'a@example.com',
    {}
  );
  ok('requester can complete an assigned fill step', fill.ok === true);
  const admin = hubAuthz.canCompleteOrRejectStep(signStep, request, 'a@example.com', {
    isAdmin: true,
  });
  ok('admin override is explicit', admin.ok === true && admin.via === 'override');
  const stranger = hubAuthz.canCompleteOrRejectStep(signStep, request, 'c@example.com', {});
  ok('unrelated user cannot complete the step', stranger.ok === false);
  const patched = hubAuthz.workflowStepPatch({
    status: 'completed',
    completed_by: 'b@example.com',
    completed_at: '2000-01-01T00:00:00Z',
    assigned_user_email: 'a@example.com',
    notes: 'ok',
  });
  ok('protected step fields are rejected', patched.status === 400);
  const notes = hubAuthz.workflowStepPatch({ notes: 'checked' });
  ok('notes remain writable', notes.patch && notes.patch.notes === 'checked');

  console.log('\n=== create-field trust and queue projection ===');
  const created = hubAuthz.trustedCreateInput(
    {
      request_type: 'general_request',
      title: 'Lift',
      requester_email: 'b@example.com',
      requester_name: 'B',
      status: 'approved',
      client_visible_status: 'completed',
      maintainx_id: 'mx-1',
      archive_id: 'arch',
      created_at: '2001-01-01T00:00:00Z',
      assigned_to_email: 'b@example.com',
      description: 'notes',
    },
    'a@example.com',
    {}
  );
  ok('requester email comes from the actor', created.requester_email === 'a@example.com');
  ok('status is server-initialized', created.status === 'submitted');
  ok('maintainx id is not client-writable', created.maintainx_id == null);
  ok('archive id is not client-writable', created.archive_id == null);
  ok('unprivileged caller cannot assign', !created.assigned_to);
  const assigned = hubAuthz.trustedCreateInput(
    { request_type: 'general_request', title: 'Lift', assigned_to: 'b@example.com' },
    'a@example.com',
    { isAdmin: true }
  );
  ok('admin may assign', assigned.assigned_to === 'b@example.com');

  const foreign = {
    id: '11111111-1111-4111-8111-111111111111',
    request_number: 'REQ-1',
    request_type: 'general_request',
    title: 'Peer',
    status: 'submitted',
    priority: 'normal',
    created_at: '2026-10-23T00:00:00Z',
    updated_at: '2026-10-23T00:00:00Z',
    requester_email: 'b@example.com',
    internal_notes: 'secret',
    client_notes: 'client secret',
    form_payload: { secret: true },
    maintainx_id: 'mx',
    external_storage_url: 's3://bucket/key',
  };
  const summary = hubAuthz.projectQueueRecord(foreign, 'a@example.com', false);
  ok('queue summary omits form payload', summary.form_payload === undefined);
  ok('queue summary omits notes and storage', summary.internal_notes === undefined && summary.external_storage_url === undefined);
  ok('queue summary keeps the title', summary.title === 'Peer' && summary.access === 'summary');
  const own = hubAuthz.projectQueueRecord({ ...foreign, requester_email: 'a@example.com' }, 'a@example.com', false);
  ok('accessible row keeps payload and hides internal notes', own.form_payload && own.internal_notes === undefined);

  console.log('\n=== idempotent archive create ===');
  const payload = { title: 'RETEST', locationName: 'Yard', notes: 'same' };
  const runs = await Promise.all(
    Array.from({ length: 8 }, () =>
      idem.withArchiveIdempotency('roll-off-swap', 'a@example.com', payload, async () => ({
        id: `id-${Math.random()}`,
      }))
    )
  );
  const ids = new Set(runs.map((item) => item.record.id));
  ok('eight identical creates share one id', ids.size === 1);
  ok('seven calls replay', runs.filter((item) => item.replayed).length === 7);
  const other = await idem.withArchiveIdempotency(
    'roll-off-swap',
    'a@example.com',
    { ...payload, notes: 'different' },
    async () => ({ id: 'distinct' })
  );
  ok('distinct payload is not deduped', other.record.id === 'distinct' && other.replayed === false);

  console.log('\n=== session revocation and logout csrf ===');
  const token = auth.signJwt({ typ: 'employee_session', email: 'a@example.com' }, 600);
  const claims = auth.verifyJwt(token);
  ok('fresh session verifies', !!claims && claims.email === 'a@example.com');
  await sessionRevocation.revokeClaims(claims);
  ok('pre-logout token is denied', auth.verifyJwt(token) == null);
  const again = auth.signJwt({ typ: 'employee_session', email: 'a@example.com' }, 600);
  const fresh = auth.verifyJwt(again);
  ok('login after logout verifies', !!fresh && fresh.iat > claims.iat);

  const cross = logoutCsrf.evaluateLogoutRequest({
    method: 'GET',
    headers: { 'sec-fetch-site': 'cross-site', host: 'operations.example' },
  });
  ok('cross-site GET logout is rejected', cross.allow === false);
  const same = logoutCsrf.evaluateLogoutRequest({
    method: 'POST',
    headers: { 'sec-fetch-site': 'same-origin', origin: 'https://operations.example', host: 'operations.example' },
  });
  ok('same-origin POST logout is allowed', same.allow === true);

  console.log('\n=== upload body and redis pipeline ===');
  const buffered = await upload.readRawBody({ body: Buffer.from('photo') });
  ok('buffered upload body is reused', buffered.toString() === 'photo');
  const denied = upload.assertUploadAllowed('text/html', 12);
  ok('html upload is denied', denied.ok === false && denied.status === 415);
  const allowed = upload.assertUploadAllowed('image/jpeg', 12);
  ok('jpeg upload is allowed', allowed.ok === true);
  const huge = upload.assertUploadAllowed('image/png', upload.MAX_UPLOAD_BYTES + 1);
  ok('oversize upload is denied', huge.status === 413);

  const redis = createMemoryRedisStub();
  const pipe = redis.pipeline();
  pipe.zadd('archive:swp:live', { score: 1, member: 'swp-1' });
  pipe.zrem('archive:swp:live', 'swp-1');
  pipe.zadd('archive:swp:closed', { score: 2, member: 'swp-1' });
  await pipe.exec();
  const live = await redis.zrange('archive:swp:live', 0, -1);
  const closed = await redis.zrange('archive:swp:closed', 0, -1);
  ok('pipeline zrem moves the SWP index', live.length === 0 && closed[0] === 'swp-1');

  console.log('\n=== uuid guard ===');
  const pg = require('../../api/lib/hub/db/postgres');
  ok('malformed id is not a uuid', pg.isUuid('zz-not-a-uuid-xyz') === false);
  ok('nil-looking valid uuid shape passes the format gate', pg.isUuid('00000000-0000-4000-8000-000000000000') === true);

  console.log('\nAll October 2026 remediation checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
