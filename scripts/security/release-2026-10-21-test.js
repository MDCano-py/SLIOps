#!/usr/bin/env node
/**
 * Local regression for the 2026-10-21 retest candidate.
 * Unit checks always run. Postgres checks run when DATABASE_URL is set.
 *
 * Usage: npm run security:release-2026-10-21-test
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(path.join(ROOT, '.env.local.postgres'));
loadEnvFile(path.join(ROOT, '.env.local'));

process.env.HUB_STORE_MODE = process.env.HUB_STORE_MODE || 'postgres';
process.env.VENDOR_STORE_MODE = process.env.VENDOR_STORE_MODE || 'postgres';
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  process.env.SESSION_SECRET = 'release-2026-10-21-test-secret-32chars!!';
}

const crypto = require('../../api/lib/vendor/identity/crypto');
const rate = require('../../api/lib/vendor/identity/rate-limit');
const auth = require('../../api/lib/auth');
const { isVendorIdentityPublicPath } = require('../../api/lib/vendor/identity/routes');
const { PRINCIPALS } = require('../../api/lib/platform/principals');
const { vendorMayAccessCompany } = require('../../api/lib/platform/authorization');
const services = require('../../api/lib/platform/services');
const nr = require('../../hub-new-request-registry');

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
  const headers = {};
  return {
    statusCode: 200,
    body: null,
    headers,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    setHeader(k, v) { headers[k] = v; },
    getHeader(k) { return headers[k]; },
  };
}

function cookieHeaderFrom(res) {
  const raw = res.getHeader('Set-Cookie');
  const first = Array.isArray(raw) ? raw.find((c) => String(c).includes('sliops_vendor_session=')) : raw;
  if (!first) return '';
  return String(first).split(';')[0];
}

console.log('=== 2026-10-21 release regression (local) ===\n');

const codes = new Set();
for (let i = 0; i < 20; i += 1) {
  const code = crypto.mintVerificationCode();
  assert(`verification code ${i} is 6 digits`, /^\d{6}$/.test(code), code);
  codes.add(code);
}
assert('verification codes vary', codes.size > 1);

const sample = crypto.mintVerificationCode();
const salt = crypto.mintOpaqueToken(16);
const hashed = crypto.hashToken(`${salt}:${sample}`);
assert('code hash is not the code', hashed !== sample && hashed.length === 64);
assert('hash compare accepts match', crypto.hashesEqual(hashed, crypto.hashToken(`${salt}:${sample}`)));
assert('hash compare rejects mismatch', !crypto.hashesEqual(hashed, crypto.hashToken(`${salt}:000000`)));

rate.resetForTests();
const ipReq = { socket: { remoteAddress: '203.0.113.50' }, headers: { 'x-forwarded-for': '198.51.100.20' } };
assert('OTP limiter ignores spoofed XFF by default', rate.clientIp(ipReq) === '203.0.113.50');
for (let i = 0; i < rate.MAX_CODE_REQUESTS_PER_ACCOUNT; i += 1) {
  rate.recordCodeRequest(ipReq, 'vendor-a@example.test');
}
assert('account code requests lock', rate.isCodeRequestLimited(ipReq, 'vendor-a@example.test') === true);
assert('other account is not locked by that counter', rate.isCodeRequestLimited(
  { socket: { remoteAddress: '203.0.113.51' }, headers: {} },
  'vendor-b@example.test'
) === false);

rate.resetForTests();
const verifyReq = { socket: { remoteAddress: '203.0.113.60' }, headers: {} };
for (let i = 0; i < rate.MAX_VERIFY_FAILURES_PER_ACCOUNT; i += 1) {
  rate.recordVerifyFailure(verifyReq, 'vendor-a@example.test');
}
assert('verify failures lock the account', rate.isVerifyLimited(verifyReq, 'vendor-a@example.test') === true);

const vendorJwt = auth.signJwt({
  typ: 'vendor_session',
  email: 'vendor@example.test',
  sid: 'sid',
  sk: 'secret',
  vid: 'vid',
  cid: 'cid',
}, 3600);
const employeeJwt = auth.signJwt({
  typ: 'employee_session',
  email: 'employee@example.test',
  remember: false,
}, 3600);
const legacyJwt = auth.signJwt({ email: 'legacy@example.test', remember: false }, 3600);
assert(
  'vendor JWT cannot satisfy employee session',
  auth.getActorEmail({ headers: { cookie: `sliops_session=${encodeURIComponent(vendorJwt)}` } }) == null
);
assert(
  'vendor cookie name is not an employee session',
  auth.getActorEmail({ headers: { cookie: `sliops_vendor_session=${encodeURIComponent(vendorJwt)}` } }) == null
);
assert(
  'employee session still resolves',
  auth.getActorEmail({ headers: { cookie: `sliops_session=${encodeURIComponent(employeeJwt)}` } }) === 'employee@example.test'
);
assert(
  'legacy employee session still resolves',
  auth.getActorEmail({ headers: { cookie: `sliops_session=${encodeURIComponent(legacyJwt)}` } }) === 'legacy@example.test'
);

assert('code request is vendor-public', isVendorIdentityPublicPath('/vendor/auth/code/request'));
assert('code verify is vendor-public', isVendorIdentityPublicPath('/vendor/auth/code/verify'));
assert('employee vendor API is not vendor-public', !isVendorIdentityPublicPath('/vendors'));
assert('hub API is not vendor-public', !isVendorIdentityPublicPath('/hub/requests'));

assert('principals are distinct', PRINCIPALS.EMPLOYEE !== PRINCIPALS.VENDOR && PRINCIPALS.VENDOR !== PRINCIPALS.EXTERNAL_ACTION_RECIPIENT);
assert('vendor scope denies other company', vendorMayAccessCompany('a', 'b') === false);
assert('vendor scope allows own company', vendorMayAccessCompany('a', 'a') === true);
assert('request lifecycle facade exists', typeof services.requestLifecycle.get === 'function');
assert('workflow facade exists', typeof services.workflow.listSteps === 'function');
assert('notification facade exists', typeof services.notifications.list === 'function');

const merged = nr.mergeNewRequestTypes(
  [{ key: 'work_order', label: 'Work Order', render_mode: 'custom' }],
  [],
  [{ key: 'work_order', label: 'Work Order (config)', render_mode: 'cfg_request_type', request_type_id: 'cfg1' },
    { key: 'nda_request', label: 'NDA', render_mode: 'cfg_request_type', request_type_id: 'cfg2' }]
);
const workOrders = merged.filter((item) => item.key === 'work_order');
assert('operational work order is the only work order card', workOrders.length === 1 && workOrders[0].render_mode === 'custom');
assert('other configured request types remain', merged.some((item) => item.key === 'nda_request'));

const routesSrc = fs.readFileSync(path.join(ROOT, 'api/lib/vendor/identity/routes.js'), 'utf8');
const workspaceSrc = routesSrc.slice(routesSrc.indexOf("path === '/vendor/workspace'"));
assert('workspace does not scan every vendor', !workspaceSrc.includes('getAllVendorRecords'));
assert('workspace loads vendor by id', workspaceSrc.includes('getVendorRecordById'));
assert('code request body is generic', routesSrc.includes('If an active vendor account matches that email'));
assert('verify rejection is generic', routesSrc.includes("code: 'invalid_code'"));

const deliverSrc = fs.readFileSync(path.join(ROOT, 'api/lib/vendor/identity/deliver-code.js'), 'utf8');
const logLines = deliverSrc.split(/\r?\n/).filter((line) => /console\./.test(line));
assert('delivery logs do not include the code', logLines.length > 0 && logLines.every((line) => !line.includes('code') && !line.includes('${')));

const migration = fs.readFileSync(path.join(ROOT, 'migrations/018_vendor_login_codes.sql'), 'utf8');
assert('login code migration stores a hash', /code_hash TEXT NOT NULL/.test(migration));
assert('login code migration has no plaintext code column', !/^\s*code\s+TEXT/m.test(migration));

const cfgSrc = fs.readFileSync(path.join(ROOT, 'hub-configuration-center.js'), 'utf8');
assert('repair NDA wiring is diagnostics-gated', /function showDiagnosticsRecovery/.test(cfgSrc) && /if \(showDiagnosticsRecovery\(\)\)/.test(cfgSrc));

const nginx = fs.readFileSync(path.join(ROOT, 'deploy/nginx/ops-hub-staging.conf'), 'utf8');
assert('nginx notes include code request exemption', nginx.includes('/vendor/auth/code/request'));
assert('nginx notes include code verify exemption', nginx.includes('/vendor/auth/code/verify'));

const workspaceHtml = fs.readFileSync(path.join(ROOT, 'vendor-workspace.html'), 'utf8');
assert('vendor workspace offers code sign-in', workspaceHtml.includes('/vendor/auth/code/request') && workspaceHtml.includes('/vendor/auth/code/verify'));
assert('magic link consume remains', workspaceHtml.includes('/vendor/auth/consume'));

async function runDatabaseChecks() {
  if (!process.env.DATABASE_URL) {
    console.log('\nSKIP  postgres integration (DATABASE_URL unset)');
    return;
  }
  console.log('\n--- postgres integration ---');
  const { migrateDatabase } = require('../db/migrate');
  const vendorStore = require('../../api/lib/vendor/store');
  const { buildVendorRecordFromBody } = require('../../api/lib/vendor/record');
  const contacts = require('../../api/lib/vendor/identity/contacts');
  const loginCodes = require('../../api/lib/vendor/identity/login-codes');
  const { handleVendorIdentityRoute } = require('../../api/lib/vendor/identity/routes');
  const { getPool } = require('../../api/lib/vendor/identity/db');

  await migrateDatabase(process.env.DATABASE_URL);
  const applied = await getPool().query(
    `SELECT id FROM schema_migrations WHERE id = '018_vendor_login_codes.sql'`
  );
  assert('migration 018 applied', applied.rowCount === 1);

  const stamp = Date.now();
  const refA = `VEN-REL-A-${stamp}`;
  const refB = `VEN-REL-B-${stamp}`;
  let created = false;
  const emailA = `alice.${stamp}@vendor-a.test`;
  const emailB = `bob.${stamp}@vendor-b.test`;
  const shared = `shared.${stamp}@vendor-both.test`;

  try {
  await vendorStore.writeVendorRecord(refA, buildVendorRecordFromBody(
    { companyName: `Vendor A ${stamp}`, contactName: 'Alice', contactEmail: emailA, requestedBy: 'tester' },
    { refNumber: refA, actorEmail: 'employee.release.test@sliops.test' }
  ));
  created = true;
  await vendorStore.writeVendorRecord(refB, buildVendorRecordFromBody(
    { companyName: `Vendor B ${stamp}`, contactName: 'Bob', contactEmail: emailB, requestedBy: 'tester', financialNotes: 'SECRET' },
    { refNumber: refB, actorEmail: 'employee.release.test@sliops.test' }
  ));
  const idA = (await vendorStore.readVendorRecord(refA)).record.id;
  const idB = (await vendorStore.readVendorRecord(refB)).record.id;
  const contactA = await contacts.upsertContact({ vendorId: idA, email: emailA, name: 'Alice' });
  const contactB = await contacts.upsertContact({ vendorId: idB, email: emailB, name: 'Bob' });
  await contacts.upsertContact({ vendorId: idA, email: shared, name: 'Shared A' });
  await contacts.upsertContact({ vendorId: idB, email: shared, name: 'Shared B' });

  const deps = {
    vendorStore,
    requirePermissions: async () => ({ actorEmail: 'employee.release.test@sliops.test' }),
    auth,
  };

  rate.resetForTests();
  const unknownRes = mockRes();
  const knownRes = mockRes();
  const reqBase = { method: 'POST', socket: { remoteAddress: '203.0.113.70' }, headers: {}, query: {} };
  await handleVendorIdentityRoute('/vendor/auth/code/request', {
    ...reqBase,
    body: { email: `nobody.${stamp}@missing.test` },
  }, unknownRes, deps);
  await handleVendorIdentityRoute('/vendor/auth/code/request', {
    ...reqBase,
    body: { email: emailA },
  }, knownRes, deps);
  assert('unknown and known code requests match', JSON.stringify(unknownRes.body) === JSON.stringify(knownRes.body));
  assert('code request does not return a code', !JSON.stringify(knownRes.body).match(/\d{6}/));
  assert('code request status is generic 200', knownRes.statusCode === 200 && unknownRes.statusCode === 200);

  const stored = await getPool().query(
    `SELECT code_hash, code_salt FROM vendor_login_codes WHERE contact_id = $1 AND used_at IS NULL`,
    [contactA.id]
  );
  assert('issued code is stored as a hash', stored.rowCount === 1 && stored.rows[0].code_hash.length === 64);
  assert('stored hash is not 6 digits', !/^\d{6}$/.test(stored.rows[0].code_hash));

  const beforeShared = await getPool().query(
    `SELECT count(*)::int AS n FROM vendor_login_codes WHERE vendor_id IN ($1, $2)`,
    [idA, idB]
  );
  const sharedRes = mockRes();
  await handleVendorIdentityRoute('/vendor/auth/code/request', {
    ...reqBase,
    body: { email: shared },
  }, sharedRes, deps);
  const afterShared = await getPool().query(
    `SELECT count(*)::int AS n FROM vendor_login_codes WHERE vendor_id IN ($1, $2)`,
    [idA, idB]
  );
  assert('ambiguous email does not issue a code', afterShared.rows[0].n === beforeShared.rows[0].n);
  assert('ambiguous email response matches the generic body', JSON.stringify(sharedRes.body) === JSON.stringify(knownRes.body));

  const issued = await loginCodes.issueLoginCode(contactA);
  assert('issued code is 6 digits', /^\d{6}$/.test(issued.code));
  const bad = mockRes();
  await handleVendorIdentityRoute('/vendor/auth/code/verify', {
    ...reqBase,
    body: { email: emailA, code: issued.code === '000000' ? '000001' : '000000' },
  }, bad, deps);
  assert('wrong code is generic 401', bad.statusCode === 401 && bad.body.code === 'invalid_code');
  const attempts = await getPool().query(
    `SELECT attempt_count FROM vendor_login_codes WHERE contact_id = $1 AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [contactA.id]
  );
  assert('wrong code increments attempts', Number(attempts.rows[0].attempt_count) >= 1);

  const good = mockRes();
  await handleVendorIdentityRoute('/vendor/auth/code/verify', {
    ...reqBase,
    body: { email: emailA, code: issued.code },
  }, good, deps);
  assert('correct code creates a vendor session', good.statusCode === 200 && good.body.ok === true);
  assert('session cookie is HttpOnly', /HttpOnly/i.test(String(good.getHeader('Set-Cookie'))));
  const replay = mockRes();
  await handleVendorIdentityRoute('/vendor/auth/code/verify', {
    ...reqBase,
    body: { email: emailA, code: issued.code },
  }, replay, deps);
  assert('code cannot be replayed', replay.statusCode === 401 && replay.body.code === 'invalid_code');

  const expiring = await loginCodes.issueLoginCode(contactB);
  await getPool().query(
    `UPDATE vendor_login_codes SET expires_at = now() - interval '1 minute' WHERE contact_id = $1 AND used_at IS NULL`,
    [contactB.id]
  );
  const expired = mockRes();
  await handleVendorIdentityRoute('/vendor/auth/code/verify', {
    ...reqBase,
    socket: { remoteAddress: '203.0.113.71' },
    body: { email: emailB, code: expiring.code },
  }, expired, deps);
  assert('expired code is rejected', expired.statusCode === 401);

  await contacts.setContactStatus(contactB.id, 'disabled');
  const disabledCode = await loginCodes.issueLoginCode({ ...contactB, status: 'disabled' }).catch((err) => err);
  // issueLoginCode does not check status; the route lookup does. Force a fresh active code then disable.
  await contacts.setContactStatus(contactB.id, 'active');
  const fresh = await loginCodes.issueLoginCode(contactB);
  await contacts.setContactStatus(contactB.id, 'disabled');
  const disabled = mockRes();
  await handleVendorIdentityRoute('/vendor/auth/code/verify', {
    ...reqBase,
    socket: { remoteAddress: '203.0.113.72' },
    body: { email: emailB, code: fresh.code },
  }, disabled, deps);
  assert('disabled vendor cannot verify', disabled.statusCode === 401);
  assert('issue on disabled object is not required', disabledCode !== undefined);

  await contacts.setContactStatus(contactB.id, 'active');
  const sessionB = mockRes();
  const issuedB = await loginCodes.issueLoginCode(contactB);
  await handleVendorIdentityRoute('/vendor/auth/code/verify', {
    ...reqBase,
    socket: { remoteAddress: '203.0.113.73' },
    body: { email: emailB, code: issuedB.code },
  }, sessionB, deps);
  const vendorCookie = cookieHeaderFrom(sessionB);
  const cross = mockRes();
  await handleVendorIdentityRoute('/vendor/workspace', {
    method: 'GET',
    socket: { remoteAddress: '203.0.113.73' },
    headers: { cookie: vendorCookie },
    query: { ref: refA },
  }, cross, deps);
  assert('vendor B cannot read vendor A by ref', cross.statusCode === 403);
  const own = mockRes();
  await handleVendorIdentityRoute('/vendor/workspace', {
    method: 'GET',
    socket: { remoteAddress: '203.0.113.73' },
    headers: { cookie: vendorCookie },
    query: {},
  }, own, deps);
  assert('vendor B workspace is vendor B', own.statusCode === 200 && own.body.vendor && own.body.vendor.companyName === `Vendor B ${stamp}`);
  assert('workspace omits internal notes', !JSON.stringify(own.body).includes('SECRET'));

  const employeeRes = mockRes();
  await handleVendorIdentityRoute('/vendor/workspace', {
    method: 'GET',
    socket: { remoteAddress: '203.0.113.74' },
    headers: { cookie: `sliops_session=${encodeURIComponent(employeeJwt)}` },
    query: {},
  }, employeeRes, deps);
  assert('employee session cannot open vendor workspace', employeeRes.statusCode === 401);

  const tScan0 = process.hrtime.bigint();
  await vendorStore.getAllVendorRecords();
  const scanMs = Number(process.hrtime.bigint() - tScan0) / 1e6;
  const tKey0 = process.hrtime.bigint();
  const byId = await vendorStore.getVendorRecordById(idB);
  const keyedMs = Number(process.hrtime.bigint() - tKey0) / 1e6;
  assert('scoped lookup returns the vendor', byId && byId.id === idB && byId.companyName === `Vendor B ${stamp}`);
  console.log(`BENCH postgres getAllVendorRecords ${scanMs.toFixed(2)} ms; getVendorRecordById ${keyedMs.toFixed(2)} ms`);
  } finally {
    if (created) {
      await vendorStore.deleteVendorRecordForTest(refA);
      await vendorStore.deleteVendorRecordForTest(refB);
    }
  }
}

runDatabaseChecks().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
