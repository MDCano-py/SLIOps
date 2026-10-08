/**
 * Vendor workspace sessions — HttpOnly cookie `sliops_vendor_session`.
 * Cookie value is a signed JWT; DB row holds session_hash for revoke/idle.
 */
const crypto = require('crypto');
const { getPool } = require('./db');
const { hashToken, mintOpaqueToken } = require('./crypto');
const contacts = require('./contacts');
const { writeAudit } = require('./audit');
const auth = require('../../auth');

const VENDOR_SESSION_COOKIE = 'sliops_vendor_session';
const ABSOLUTE_TTL_SECONDS = Math.max(
  3600,
  Number(process.env.VENDOR_SESSION_TTL_SECONDS || 8 * 60 * 60) || 8 * 60 * 60
);
const IDLE_TTL_SECONDS = Math.max(
  600,
  Number(process.env.VENDOR_SESSION_IDLE_SECONDS || 2 * 60 * 60) || 2 * 60 * 60
);

function mapSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    vendorId: row.vendor_id,
    contactId: row.contact_id,
    verifiedEmail: row.verified_email,
    scopes: Array.isArray(row.scopes_json) ? row.scopes_json : ['vendor_workspace'],
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    idleExpiresAt: row.idle_expires_at ? new Date(row.idle_expires_at).toISOString() : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
  };
}

function buildCookieOpts() {
  // Match employee session path scoping (APP_BASE_PATH aware via auth helpers).
  return {};
}

function issueVendorSessionCookie(res, jwt, ttlSeconds) {
  const header = auth.buildSetCookie(VENDOR_SESSION_COOKIE, jwt, ttlSeconds, buildCookieOpts());
  // Local http://127.0.0.1: Secure cookies are often dropped; strip Secure in non-prod.
  const isProdLike = /^(production|staging)$/i.test(String(process.env.NODE_ENV || ''));
  const value = isProdLike ? header : header.replace(/; Secure/gi, '');
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', value);
  } else if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, value]);
  } else {
    res.setHeader('Set-Cookie', [existing, value]);
  }
}

function clearVendorSessionCookie(res) {
  const header = auth.buildSetCookie(VENDOR_SESSION_COOKIE, '', 0, buildCookieOpts());
  const isProdLike = /^(production|staging)$/i.test(String(process.env.NODE_ENV || ''));
  const value = isProdLike ? header : header.replace(/; Secure/gi, '');
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', value);
  } else if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, value]);
  } else {
    res.setHeader('Set-Cookie', [existing, value]);
  }
}

/**
 * Create DB session + set cookie. Returns session record.
 */
async function createSession({ vendorId, contact, scopes = ['vendor_workspace'], res = null }) {
  if (!vendorId || !contact?.id || !contact?.email) {
    throw new Error('session_identity_required');
  }

  const sessionSecret = mintOpaqueToken(32);
  const sessionHash = hashToken(sessionSecret);
  const now = Date.now();
  const expiresAt = new Date(now + ABSOLUTE_TTL_SECONDS * 1000);
  const idleExpiresAt = new Date(now + IDLE_TTL_SECONDS * 1000);

  const { rows } = await getPool().query(
    `INSERT INTO vendor_sessions
       (vendor_id, contact_id, session_hash, verified_email, scopes_json, expires_at, idle_expires_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     RETURNING *`,
    [
      vendorId,
      contact.id,
      sessionHash,
      contacts.normalizeEmail(contact.email),
      JSON.stringify(scopes),
      expiresAt.toISOString(),
      idleExpiresAt.toISOString(),
    ]
  );

  const session = mapSession(rows[0]);
  await contacts.markAuthenticated(contact.id);

  // JWT carries session id + opaque secret (hashed in DB) for binding.
  const jwt = auth.signJwt(
    {
      typ: 'vendor_session',
      sid: session.id,
      vid: vendorId,
      cid: contact.id,
      email: contacts.normalizeEmail(contact.email),
      sk: sessionSecret,
    },
    ABSOLUTE_TTL_SECONDS
  );

  if (res) {
    issueVendorSessionCookie(res, jwt, ABSOLUTE_TTL_SECONDS);
  }

  await writeAudit({
    eventType: 'vendor_session_created',
    vendorId,
    contactId: contact.id,
    actorKind: 'vendor_contact',
    actorId: contact.email,
    detail: 'Vendor session created',
  });

  return { session, token: jwt };
}

async function loadSessionRow(sessionId) {
  const { rows } = await getPool().query(
    `SELECT * FROM vendor_sessions WHERE id = $1 LIMIT 1`,
    [sessionId]
  );
  return rows[0] || null;
}

/**
 * Resolve vendor identity from request cookie (or Authorization Bearer for tests).
 * Returns { session, contact, vendorId } or null.
 */
async function resolveVendorSession(req, { touch = true } = {}) {
  const cookies = auth.parseCookies(req);
  let raw = cookies[VENDOR_SESSION_COOKIE] || '';
  if (!raw) {
    const authz = String(req.headers?.authorization || '');
    const m = /^Bearer\s+(.+)$/i.exec(authz);
    if (m) raw = m[1].trim();
  }
  if (!raw) return null;

  const payload = auth.verifyJwt(raw);
  if (!payload || payload.typ !== 'vendor_session' || !payload.sid || !payload.sk) {
    return null;
  }

  const row = await loadSessionRow(payload.sid);
  if (!row || row.revoked_at) return null;
  if (hashToken(payload.sk) !== row.session_hash) return null;

  const now = Date.now();
  if (new Date(row.expires_at).getTime() < now) return null;
  if (new Date(row.idle_expires_at).getTime() < now) return null;

  // Bind JWT claims to DB row
  if (
    String(payload.vid) !== String(row.vendor_id) ||
    String(payload.cid) !== String(row.contact_id)
  ) {
    return null;
  }

  const contact = await contacts.getContact(row.contact_id);
  if (!contact || contact.status !== 'active') return null;

  if (touch) {
    const nextIdle = new Date(now + IDLE_TTL_SECONDS * 1000);
    const absEnd = new Date(row.expires_at);
    const idleExpiresAt = nextIdle.getTime() > absEnd.getTime() ? absEnd : nextIdle;
    await getPool().query(
      `UPDATE vendor_sessions
       SET last_seen_at = now(), idle_expires_at = $2
       WHERE id = $1`,
      [row.id, idleExpiresAt.toISOString()]
    );
    row.last_seen_at = new Date();
    row.idle_expires_at = idleExpiresAt;
  }

  return {
    session: mapSession(row),
    contact,
    vendorId: row.vendor_id,
  };
}

async function revokeSession(sessionId, { actorKind = 'system', actorId = '' } = {}) {
  const { rows } = await getPool().query(
    `UPDATE vendor_sessions
     SET revoked_at = now()
     WHERE id = $1 AND revoked_at IS NULL
     RETURNING *`,
    [sessionId]
  );
  const session = mapSession(rows[0] || null);
  if (session) {
    await writeAudit({
      eventType: 'vendor_session_revoked',
      vendorId: session.vendorId,
      contactId: session.contactId,
      actorKind,
      actorId,
      detail: 'Vendor session revoked',
    });
  }
  return session;
}

async function revokeAllForContact(contactId, opts = {}) {
  const { rows } = await getPool().query(
    `UPDATE vendor_sessions
     SET revoked_at = now()
     WHERE contact_id = $1 AND revoked_at IS NULL
     RETURNING *`,
    [contactId]
  );
  for (const row of rows) {
    await writeAudit({
      eventType: 'vendor_session_revoked',
      vendorId: row.vendor_id,
      contactId: row.contact_id,
      actorKind: opts.actorKind || 'system',
      actorId: opts.actorId || '',
      detail: 'Vendor session revoked (contact-wide)',
    });
  }
  return rows.length;
}

async function logoutRequest(req, res) {
  const resolved = await resolveVendorSession(req, { touch: false });
  if (resolved?.session?.id) {
    await revokeSession(resolved.session.id, {
      actorKind: 'vendor_contact',
      actorId: resolved.contact?.email || '',
    });
  }
  clearVendorSessionCookie(res);
  return { ok: true };
}

/** Timing-safe compare helper for tests / future use */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

module.exports = {
  VENDOR_SESSION_COOKIE,
  ABSOLUTE_TTL_SECONDS,
  IDLE_TTL_SECONDS,
  createSession,
  resolveVendorSession,
  revokeSession,
  revokeAllForContact,
  logoutRequest,
  clearVendorSessionCookie,
  issueVendorSessionCookie,
  safeEqual,
};
