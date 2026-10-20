/**
 * Vendor email verification codes.
 * Stored as salted SHA-256. Five-minute lifetime. Single-use via row lock.
 */
const { getPool } = require('./db');
const { hashToken, mintOpaqueToken, mintVerificationCode, hashesEqual } = require('./crypto');
const { writeAudit } = require('./audit');

const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function coded(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

async function issueLoginCode(contact) {
  if (!contact?.id || !contact.vendorId) throw new Error('contact_required');
  const code = mintVerificationCode();
  const salt = mintOpaqueToken(16);
  const codeHash = hashToken(`${salt}:${code}`);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE vendor_login_codes
       SET used_at = now()
       WHERE contact_id = $1 AND used_at IS NULL`,
      [contact.id]
    );
    await client.query(
      `INSERT INTO vendor_login_codes
         (vendor_id, contact_id, code_hash, code_salt, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [contact.vendorId, contact.id, codeHash, salt, expiresAt.toISOString()]
    );
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }

  await writeAudit({
    eventType: 'vendor_login_code_issued',
    vendorId: contact.vendorId,
    contactId: contact.id,
    actorKind: 'vendor_contact',
    actorId: contact.email || '',
    detail: 'Verification code issued',
    meta: { expiresAt: expiresAt.toISOString() },
  });

  return { code, expiresAt: expiresAt.toISOString() };
}

/**
 * Atomically accept one unused, unexpired code or record a failed attempt.
 * Throws invalid_code for every rejection reason.
 */
async function verifyAndConsume({ contactId, code }) {
  const submitted = String(code || '').trim();
  if (!/^\d{6}$/.test(submitted)) throw coded('invalid_code');

  const client = await getPool().connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM vendor_login_codes
       WHERE contact_id = $1 AND used_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [contactId]
    );
    const row = rows[0];
    if (!row) throw coded('invalid_code');
    if (new Date(row.expires_at).getTime() <= Date.now()) throw coded('invalid_code');
    if (Number(row.attempt_count) >= MAX_ATTEMPTS) throw coded('invalid_code');

    const expected = hashToken(`${row.code_salt}:${submitted}`);
    if (!hashesEqual(expected, row.code_hash)) {
      await client.query(
        `UPDATE vendor_login_codes
         SET attempt_count = attempt_count + 1
         WHERE id = $1`,
        [row.id]
      );
      await client.query('COMMIT');
      committed = true;
      throw coded('invalid_code');
    }

    const consumed = await client.query(
      `UPDATE vendor_login_codes
       SET used_at = now()
       WHERE id = $1 AND used_at IS NULL
       RETURNING id, vendor_id, contact_id`,
      [row.id]
    );
    if (!consumed.rowCount) throw coded('invalid_code');
    await client.query('COMMIT');
    committed = true;
    return {
      id: consumed.rows[0].id,
      vendorId: consumed.rows[0].vendor_id,
      contactId: consumed.rows[0].contact_id,
    };
  } catch (err) {
    if (!committed) {
      try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  issueLoginCode,
  verifyAndConsume,
};
