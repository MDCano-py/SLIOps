/**
 * Vendor contacts — people who can authenticate into a vendor workspace.
 */
const { getPool } = require('./db');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function mapContact(row) {
  if (!row) return null;
  return {
    id: row.id,
    vendorId: row.vendor_id,
    email: row.email,
    name: row.name || '',
    status: row.status,
    invitedAt: row.invited_at ? new Date(row.invited_at).toISOString() : null,
    lastAuthenticatedAt: row.last_authenticated_at
      ? new Date(row.last_authenticated_at).toISOString()
      : null,
    disabledAt: row.disabled_at ? new Date(row.disabled_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

async function listContacts(vendorId) {
  const { rows } = await getPool().query(
    `SELECT * FROM vendor_contacts
     WHERE vendor_id = $1
     ORDER BY lower(email) ASC`,
    [vendorId]
  );
  return rows.map(mapContact);
}

async function getContact(contactId) {
  const { rows } = await getPool().query(
    `SELECT * FROM vendor_contacts WHERE id = $1 LIMIT 1`,
    [contactId]
  );
  return mapContact(rows[0] || null);
}

async function findActiveContactByEmail(vendorId, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const { rows } = await getPool().query(
    `SELECT * FROM vendor_contacts
     WHERE vendor_id = $1 AND lower(email) = $2 AND status = 'active'
     LIMIT 1`,
    [vendorId, normalized]
  );
  return mapContact(rows[0] || null);
}

async function upsertContact({ vendorId, email, name = '', status = 'active' }) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error('email_required');
  if (!vendorId) throw new Error('vendor_id_required');

  const { rows } = await getPool().query(
    `INSERT INTO vendor_contacts (vendor_id, email, name, status, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (vendor_id, email) DO UPDATE SET
       name = CASE
         WHEN EXCLUDED.name <> '' THEN EXCLUDED.name
         ELSE vendor_contacts.name
       END,
       status = CASE
         WHEN vendor_contacts.status = 'revoked' THEN vendor_contacts.status
         ELSE EXCLUDED.status
       END,
       updated_at = now(),
       disabled_at = CASE
         WHEN EXCLUDED.status = 'active' THEN NULL
         WHEN EXCLUDED.status IN ('disabled', 'revoked') THEN COALESCE(vendor_contacts.disabled_at, now())
         ELSE vendor_contacts.disabled_at
       END
     RETURNING *`,
    [vendorId, normalized, String(name || '').trim(), status]
  );
  return mapContact(rows[0]);
}

async function setContactStatus(contactId, status) {
  const allowed = new Set(['active', 'disabled', 'revoked']);
  if (!allowed.has(status)) throw new Error('invalid_status');
  const { rows } = await getPool().query(
    `UPDATE vendor_contacts
     SET status = $2,
         disabled_at = CASE WHEN $2 = 'active' THEN NULL ELSE COALESCE(disabled_at, now()) END,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [contactId, status]
  );
  return mapContact(rows[0] || null);
}

async function markInvited(contactId) {
  await getPool().query(
    `UPDATE vendor_contacts
     SET invited_at = COALESCE(invited_at, now()), updated_at = now()
     WHERE id = $1`,
    [contactId]
  );
}

async function markAuthenticated(contactId) {
  await getPool().query(
    `UPDATE vendor_contacts
     SET last_authenticated_at = now(), updated_at = now()
     WHERE id = $1`,
    [contactId]
  );
}

module.exports = {
  normalizeEmail,
  listContacts,
  getContact,
  findActiveContactByEmail,
  upsertContact,
  setContactStatus,
  markInvited,
  markAuthenticated,
};
