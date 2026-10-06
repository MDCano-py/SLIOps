/**
 * WOS-44 Vendor Master — Postgres persistence.
 */

const { Pool } = require('pg');
const { recordToRow, rowToRecord } = require('../record');
const { resolvePgSsl } = require('../../hub/db/pg-ssl');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: resolvePgSsl(process.env.DATABASE_URL),
});

function jsonbParam(val) {
  if (val === undefined || val === null) return null;
  // node-pg maps JS arrays to Postgres ARRAY types; JSONB columns need JSON text.
  return JSON.stringify(val);
}

async function readVendorRecord(ref) {
  const r = await pool.query('SELECT * FROM vendor_master WHERE ref_number = $1 LIMIT 1', [ref]);
  if (!r.rows.length) return null;
  return { record: rowToRecord(r.rows[0]) };
}

async function writeVendorRecord(ref, record) {
  const row = recordToRow({ ...record, refNumber: ref });
  const sql = `
    INSERT INTO vendor_master (
      ref_number, company_name, entity_type, contact_name, contact_email, contact_phone,
      service_description, requested_by, requested_at, overall_status, admin_status,
      ap_status, contract_status, assigned_to, last_action_at,
      w9_status, banking_status, insurance_status, msa_status, nda_status,
      payload_json, document_meta_json, history_json, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23, now()
    )
    ON CONFLICT (ref_number) DO UPDATE SET
      company_name = EXCLUDED.company_name,
      entity_type = EXCLUDED.entity_type,
      contact_name = EXCLUDED.contact_name,
      contact_email = EXCLUDED.contact_email,
      contact_phone = EXCLUDED.contact_phone,
      service_description = EXCLUDED.service_description,
      requested_by = EXCLUDED.requested_by,
      overall_status = EXCLUDED.overall_status,
      admin_status = EXCLUDED.admin_status,
      ap_status = EXCLUDED.ap_status,
      contract_status = EXCLUDED.contract_status,
      assigned_to = EXCLUDED.assigned_to,
      last_action_at = EXCLUDED.last_action_at,
      w9_status = EXCLUDED.w9_status,
      banking_status = EXCLUDED.banking_status,
      insurance_status = EXCLUDED.insurance_status,
      msa_status = EXCLUDED.msa_status,
      nda_status = EXCLUDED.nda_status,
      payload_json = EXCLUDED.payload_json,
      document_meta_json = EXCLUDED.document_meta_json,
      history_json = EXCLUDED.history_json,
      updated_at = now()
  `;
  await pool.query(sql, [
    row.ref_number,
    row.company_name,
    row.entity_type,
    row.contact_name,
    row.contact_email,
    row.contact_phone,
    row.service_description,
    row.requested_by,
    row.requested_at,
    row.overall_status,
    row.admin_status,
    row.ap_status,
    row.contract_status,
    row.assigned_to,
    row.last_action_at,
    row.w9_status,
    row.banking_status,
    row.insurance_status,
    row.msa_status,
    row.nda_status,
    jsonbParam(row.payload_json),
    jsonbParam(row.document_meta_json),
    jsonbParam(row.history_json),
  ]);
}

async function getAllVendorRecords() {
  const r = await pool.query('SELECT * FROM vendor_master ORDER BY requested_at DESC');
  return r.rows.map(rowToRecord);
}

async function deleteVendorRecordForTest(ref) {
  await pool.query('DELETE FROM vendor_master WHERE ref_number = $1', [ref]);
}

async function healthCheck() {
  try {
    await pool.query('SELECT 1');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  readVendorRecord,
  writeVendorRecord,
  getAllVendorRecords,
  deleteVendorRecordForTest,
  healthCheck,
};
