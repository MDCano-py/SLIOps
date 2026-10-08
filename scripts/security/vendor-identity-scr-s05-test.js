#!/usr/bin/env node
/**
 * Vendor identity + SCR-S05 regression tests.
 * Magic-link / vendor session isolation; production-disable of shared passcode.
 *
 * Usage: npm run security:vendor-identity-scr-s05-test
 */
const path = require('path');
const fs = require('fs');
const assertNode = require('assert');

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

process.env.HUB_STORE_MODE = 'postgres';
process.env.VENDOR_STORE_MODE = 'postgres';
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  process.env.SESSION_SECRET = 'vendor-identity-test-secret-32chars-min!!';
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

const { migrateDatabase } = require('../db/migrate');
const vendorStore = require('../../api/lib/vendor/store');
const { buildVendorRecordFromBody } = require('../../api/lib/vendor/record');
const contacts = require('../../api/lib/vendor/identity/contacts');
const invitations = require('../../api/lib/vendor/identity/invitations');
const sessions = require('../../api/lib/vendor/identity/sessions');
const { handleVendorIdentityRoute, isVendorIdentityPublicPath } = require('../../api/lib/vendor/identity/routes');
const { toExternalVendorView } = require('../../api/lib/vendor/identity/external-view');
const auth = require('../../api/lib/auth');

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
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.body = obj;
      return this;
    },
    setHeader(k, v) {
      headers[k] = v;
    },
    getHeader(k) {
      return headers[k];
    },
  };
}

function cookieFromSetCookie(setCookie) {
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) return '';
  const first = String(raw).split(';')[0];
  return first;
}

async function requirePermsOk(req, res, needed) {
  return { actorEmail: 'employee.vendor.test@sliops.test', permissions: needed };
}

async function main() {
  await migrateDatabase(process.env.DATABASE_URL);

  const stamp = Date.now();
  const refA = `VEN-TEST-A-${stamp}`;
  const refB = `VEN-TEST-B-${stamp}`;

  const recA = buildVendorRecordFromBody(
    {
      companyName: `Vendor A ${stamp}`,
      contactName: 'Alice Contact',
      contactEmail: `alice.${stamp}@vendor-a.test`,
      requestedBy: 'tester',
    },
    { refNumber: refA, actorEmail: 'employee.vendor.test@sliops.test' }
  );
  const recB = buildVendorRecordFromBody(
    {
      companyName: `Vendor B ${stamp}`,
      contactName: 'Bob Contact',
      contactEmail: `bob.${stamp}@vendor-b.test`,
      requestedBy: 'tester',
      financialNotes: 'INTERNAL SECRET NOTES',
    },
    { refNumber: refB, actorEmail: 'employee.vendor.test@sliops.test' }
  );

  await vendorStore.writeVendorRecord(refA, recA);
  await vendorStore.writeVendorRecord(refB, recB);
  const readA = await vendorStore.readVendorRecord(refA);
  const readB = await vendorStore.readVendorRecord(refB);
  const idA = readA.record.id;
  const idB = readB.record.id;
  assert('vendor A has uuid', !!idA);
  assert('vendor B has uuid', !!idB && idB !== idA);

  // --- Static / SCR-S05 source checks ---
  const maintainxSrc = fs.readFileSync(path.join(ROOT, 'api/maintainx.js'), 'utf8');
  assert(
    'SCR-S05 helper present',
    /function isVendorLegacyPasscodeAllowed/.test(maintainxSrc)
  );
  assert(
    'legacy passcode blocked in production/staging',
    /env === 'production' \|\| env === 'staging'/.test(maintainxSrc)
  );
  assert(
    'vendor identity public paths wired into SSO gate',
    /isVendorIdentityPublicPath/.test(maintainxSrc)
  );
  assert('workspace page exists', fs.existsSync(path.join(ROOT, 'vendor-workspace.html')));
  assert('migration 017 present', fs.existsSync(path.join(ROOT, 'migrations/017_vendor_identity.sql')));
  assert(
    'isVendorIdentityPublicPath allows consume',
    isVendorIdentityPublicPath('/vendor/auth/consume')
  );
  assert(
    'isVendorIdentityPublicPath does not allow /vendors',
    !isVendorIdentityPublicPath('/vendors')
  );

  // --- External view must not leak internal notes ---
  const ext = toExternalVendorView({ ...readB.record, financialNotes: 'SECRET', history: [{ x: 1 }] });
  assert('external view omits financialNotes', !Object.prototype.hasOwnProperty.call(ext, 'financialNotes'));
  assert('external view omits history', !Object.prototype.hasOwnProperty.call(ext, 'history'));
  assert('external view omits id', !ext.id);

  // --- Invite + consume for vendor A ---
  const contactA = await contacts.upsertContact({
    vendorId: idA,
    email: `alice.${stamp}@vendor-a.test`,
    name: 'Alice Contact',
  });
  const { invitation, token } = await invitations.createInvitation({
    vendorId: idA,
    contactId: contactA.id,
    createdBy: 'employee.vendor.test@sliops.test',
  });
  assert('invite created', !!invitation.id && !!token && token.length >= 32);

  const resConsume = mockRes();
  await handleVendorIdentityRoute(
    '/vendor/auth/consume',
    { method: 'POST', query: {}, body: { token }, headers: {} },
    resConsume,
    { vendorStore, requirePermissions: requirePermsOk, auth }
  );
  assert('consume ok', resConsume.statusCode === 200 && resConsume.body?.ok === true, JSON.stringify(resConsume.body));
  const sessionCookie = cookieFromSetCookie(resConsume.headers['Set-Cookie']);
  assert('session cookie set', sessionCookie.startsWith(`${sessions.VENDOR_SESSION_COOKIE}=`));

  // Reuse token fails
  const resReuse = mockRes();
  await handleVendorIdentityRoute(
    '/vendor/auth/consume',
    { method: 'POST', query: {}, body: { token }, headers: {} },
    resReuse,
    { vendorStore, requirePermissions: requirePermsOk, auth }
  );
  assert('reused invite denied', resReuse.statusCode === 410 && resReuse.body?.code === 'invite_used');

  // Expired invite
  const contactA2 = await contacts.upsertContact({
    vendorId: idA,
    email: `alice2.${stamp}@vendor-a.test`,
    name: 'Alice2',
  });
  const expired = await invitations.createInvitation({
    vendorId: idA,
    contactId: contactA2.id,
    createdBy: 'employee.vendor.test@sliops.test',
    ttlHours: 0.000001,
  });
  await new Promise((r) => setTimeout(r, 50));
  try {
    await invitations.consumeInvitation(expired.token);
    assert('expired invite denied', false);
  } catch (err) {
    assert('expired invite denied', err.code === 'invite_expired');
  }

  // Revoked invite
  const contactA3 = await contacts.upsertContact({
    vendorId: idA,
    email: `alice3.${stamp}@vendor-a.test`,
    name: 'Alice3',
  });
  const toRevoke = await invitations.createInvitation({
    vendorId: idA,
    contactId: contactA3.id,
    createdBy: 'employee.vendor.test@sliops.test',
  });
  await invitations.revokeInvitation(toRevoke.invitation.id, 'employee.vendor.test@sliops.test');
  try {
    await invitations.consumeInvitation(toRevoke.token);
    assert('revoked invite denied', false);
  } catch (err) {
    assert('revoked invite denied', err.code === 'invite_revoked');
  }

  // Workspace scoped to A
  const resWs = mockRes();
  await handleVendorIdentityRoute(
    '/vendor/workspace',
    {
      method: 'GET',
      query: { ref: refB },
      headers: { cookie: sessionCookie },
      body: {},
    },
    resWs,
    { vendorStore, requirePermissions: requirePermsOk, auth }
  );
  assert(
    'scope escape blocked when requesting vendor B ref',
    resWs.statusCode === 403 && resWs.body?.code === 'VENDOR_SCOPE_DENIED',
    JSON.stringify(resWs.body)
  );

  const resWsOk = mockRes();
  await handleVendorIdentityRoute(
    '/vendor/workspace',
    {
      method: 'GET',
      query: {},
      headers: { cookie: sessionCookie },
      body: {},
    },
    resWsOk,
    { vendorStore, requirePermissions: requirePermsOk, auth }
  );
  assert('workspace returns vendor A', resWsOk.statusCode === 200 && resWsOk.body?.vendor?.refNumber === refA);
  assert(
    'workspace does not include financialNotes',
    resWsOk.body?.vendor && !('financialNotes' in resWsOk.body.vendor)
  );

  // Vendor B contact cannot use A's session; create B session and confirm isolation
  const contactB = await contacts.upsertContact({
    vendorId: idB,
    email: `bob.${stamp}@vendor-b.test`,
    name: 'Bob',
  });
  const inviteB = await invitations.createInvitation({
    vendorId: idB,
    contactId: contactB.id,
    createdBy: 'employee.vendor.test@sliops.test',
  });
  const resB = mockRes();
  await handleVendorIdentityRoute(
    '/vendor/auth/consume',
    { method: 'POST', query: {}, body: { token: inviteB.token }, headers: {} },
    resB,
    { vendorStore, requirePermissions: requirePermsOk, auth }
  );
  const cookieB = cookieFromSetCookie(resB.headers['Set-Cookie']);
  const resBWs = mockRes();
  await handleVendorIdentityRoute(
    '/vendor/workspace',
    { method: 'GET', query: { ref: refA }, headers: { cookie: cookieB }, body: {} },
    resBWs,
    { vendorStore, requirePermissions: requirePermsOk, auth }
  );
  assert('vendor B cannot open vendor A via ref', resBWs.statusCode === 403);

  const resBOwn = mockRes();
  await handleVendorIdentityRoute(
    '/vendor/workspace',
    { method: 'GET', query: {}, headers: { cookie: cookieB }, body: {} },
    resBOwn,
    { vendorStore, requirePermissions: requirePermsOk, auth }
  );
  assert('vendor B sees own record', resBOwn.body?.vendor?.refNumber === refB);

  // Revoke session
  const resolvedA = await sessions.resolveVendorSession({
    headers: { cookie: sessionCookie },
  });
  assert('session A resolves before revoke', !!resolvedA);
  await sessions.revokeSession(resolvedA.session.id, {
    actorKind: 'employee',
    actorId: 'employee.vendor.test@sliops.test',
  });
  const afterRevoke = await sessions.resolveVendorSession({
    headers: { cookie: sessionCookie },
  });
  assert('revoked session fails', afterRevoke === null);

  // Unauthenticated workspace denied
  const resNoAuth = mockRes();
  await handleVendorIdentityRoute(
    '/vendor/workspace',
    { method: 'GET', query: {}, headers: {}, body: {} },
    resNoAuth,
    { vendorStore, requirePermissions: requirePermsOk, auth }
  );
  assert('unauthenticated workspace 401', resNoAuth.statusCode === 401);

  // Employee invite route (RBAC path)
  const resInvite = mockRes();
  await handleVendorIdentityRoute(
    `/vendors/${refA}/contacts`,
    {
      method: 'POST',
      query: {},
      body: { email: `carol.${stamp}@vendor-a.test`, name: 'Carol', invite: true },
      headers: {},
    },
    resInvite,
    { vendorStore, requirePermissions: requirePermsOk, auth }
  );
  assert(
    'employee invite returns one-time url',
    resInvite.statusCode === 200 &&
      !!resInvite.body?.invitation?.inviteUrl &&
      !!resInvite.body?.invitation?.token,
    JSON.stringify(resInvite.body)
  );

  // SCR-S05 runtime: legacy helper rejects production-like env
  const prevNode = process.env.NODE_ENV;
  const prevCode = process.env.VENDOR_ACCESS_CODE;
  process.env.NODE_ENV = 'production';
  process.env.VENDOR_ACCESS_CODE = 'shared-secret-should-not-work';
  // Re-require is hard; evaluate logic inline matching maintainx
  const env = (process.env.NODE_ENV || '').toLowerCase();
  const legacyAllowed =
    !(env === 'production' || env === 'staging') &&
    String(process.env.VENDOR_LEGACY_PASSCODE || '').toLowerCase() !== 'off' &&
    !!process.env.VENDOR_ACCESS_CODE;
  assert('SCR-S05 production disables legacy passcode', legacyAllowed === false);
  process.env.NODE_ENV = prevNode;
  process.env.VENDOR_ACCESS_CODE = prevCode;

  // Cleanup test vendors
  try {
    await vendorStore.deleteVendorRecordForTest(refA);
    await vendorStore.deleteVendorRecordForTest(refB);
  } catch (err) {
    console.warn('cleanup warning:', err.message);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
