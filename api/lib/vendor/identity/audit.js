const { getPool } = require('./db');

async function writeAudit({
  eventType,
  vendorId = null,
  contactId = null,
  actorKind = 'system',
  actorId = '',
  detail = null,
  meta = {},
}) {
  try {
    await getPool().query(
      `INSERT INTO vendor_identity_audit
         (event_type, vendor_id, contact_id, actor_kind, actor_id, detail, meta_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        String(eventType || 'unknown'),
        vendorId || null,
        contactId || null,
        String(actorKind || 'system'),
        String(actorId || ''),
        detail == null ? null : String(detail).slice(0, 2000),
        JSON.stringify(meta && typeof meta === 'object' ? meta : {}),
      ]
    );
  } catch (err) {
    console.warn('[vendor-identity] audit write failed:', err.message);
  }
}

module.exports = { writeAudit };
