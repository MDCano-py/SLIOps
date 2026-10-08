/**
 * Vendor magic-link invitations (opaque token; SHA-256 at rest).
 */
const { getPool } = require('./db');
const { hashToken, mintOpaqueToken } = require('./crypto');
const contacts = require('./contacts');
const { writeAudit } = require('./audit');

const DEFAULT_TTL_HOURS = Math.max(
  1,
  Number(process.env.VENDOR_INVITE_TTL_HOURS || 72) || 72
);

function mapInvite(row) {
  if (!row) return null;
  return {
    id: row.id,
    vendorId: row.vendor_id,
    contactId: row.contact_id,
    purpose: row.purpose,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    usedAt: row.used_at ? new Date(row.used_at).toISOString() : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    createdBy: row.created_by || '',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    meta: row.meta_json || {},
  };
}

/**
 * Create a single-use magic-link invitation for a contact.
 * Returns { invitation, token } — token is plaintext only once.
 */
async function createInvitation({
  vendorId,
  contactId,
  createdBy = '',
  purpose = 'vendor_workspace_access',
  ttlHours = DEFAULT_TTL_HOURS,
  meta = {},
}) {
  if (!vendorId || !contactId) throw new Error('vendor_and_contact_required');
  const contact = await contacts.getContact(contactId);
  if (!contact || contact.vendorId !== vendorId) throw new Error('contact_not_found');
  if (contact.status !== 'active') throw new Error('contact_not_active');

  const token = mintOpaqueToken(32);
  const tokenHash = hashToken(token);
  const hours = Number(ttlHours);
  const ttlMs =
    Number.isFinite(hours) && hours > 0
      ? hours * 3600 * 1000
      : DEFAULT_TTL_HOURS * 3600 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);

  const { rows } = await getPool().query(
    `INSERT INTO vendor_invitations
       (vendor_id, contact_id, token_hash, purpose, expires_at, created_by, meta_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING *`,
    [
      vendorId,
      contactId,
      tokenHash,
      purpose,
      expiresAt.toISOString(),
      String(createdBy || ''),
      JSON.stringify(meta && typeof meta === 'object' ? meta : {}),
    ]
  );

  await contacts.markInvited(contactId);
  await writeAudit({
    eventType: 'vendor_invite_created',
    vendorId,
    contactId,
    actorKind: 'employee',
    actorId: String(createdBy || ''),
    detail: 'Magic-link invitation created',
    meta: { purpose, expiresAt: expiresAt.toISOString() },
  });

  return { invitation: mapInvite(rows[0]), token };
}

/**
 * Consume a magic-link token. Marks invitation used.
 * Returns { invitation, contact } or throws coded Error.
 */
async function consumeInvitation(rawToken) {
  const token = String(rawToken || '').trim();
  if (!token || token.length < 32) {
    const err = new Error('invalid_token');
    err.code = 'invalid_token';
    throw err;
  }
  const tokenHash = hashToken(token);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM vendor_invitations
       WHERE token_hash = $1
       FOR UPDATE`,
      [tokenHash]
    );
    const row = rows[0];
    if (!row) {
      const err = new Error('invalid_token');
      err.code = 'invalid_token';
      throw err;
    }
    if (row.revoked_at) {
      const err = new Error('invite_revoked');
      err.code = 'invite_revoked';
      throw err;
    }
    if (row.used_at) {
      const err = new Error('invite_used');
      err.code = 'invite_used';
      throw err;
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      const err = new Error('invite_expired');
      err.code = 'invite_expired';
      throw err;
    }

    await client.query(
      `UPDATE vendor_invitations SET used_at = now() WHERE id = $1`,
      [row.id]
    );
    await client.query('COMMIT');

    const contact = await contacts.getContact(row.contact_id);
    if (!contact || contact.status !== 'active') {
      const err = new Error('contact_not_active');
      err.code = 'contact_not_active';
      throw err;
    }

    await writeAudit({
      eventType: 'vendor_invite_consumed',
      vendorId: row.vendor_id,
      contactId: row.contact_id,
      actorKind: 'vendor_contact',
      actorId: contact.email,
      detail: 'Magic-link invitation consumed',
    });

    return { invitation: mapInvite({ ...row, used_at: new Date() }), contact };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

async function revokeInvitation(invitationId, actorId = '') {
  const { rows } = await getPool().query(
    `UPDATE vendor_invitations
     SET revoked_at = now()
     WHERE id = $1 AND revoked_at IS NULL AND used_at IS NULL
     RETURNING *`,
    [invitationId]
  );
  const invite = mapInvite(rows[0] || null);
  if (invite) {
    await writeAudit({
      eventType: 'vendor_invite_revoked',
      vendorId: invite.vendorId,
      contactId: invite.contactId,
      actorKind: 'employee',
      actorId: String(actorId || ''),
      detail: 'Magic-link invitation revoked',
    });
  }
  return invite;
}

async function listInvitations(vendorId, { includeUsed = false } = {}) {
  const { rows } = await getPool().query(
    `SELECT * FROM vendor_invitations
     WHERE vendor_id = $1
       AND ($2::boolean OR (used_at IS NULL AND revoked_at IS NULL))
     ORDER BY created_at DESC
     LIMIT 100`,
    [vendorId, includeUsed]
  );
  return rows.map(mapInvite);
}

module.exports = {
  createInvitation,
  consumeInvitation,
  revokeInvitation,
  listInvitations,
  DEFAULT_TTL_HOURS,
};
