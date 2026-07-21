/**
 * WOS-44 Vendor Master store facade — Postgres when enabled, else legacy KV.
 */

const pg = require('./db/postgres');

function isVendorPostgresMode() {
  const mode = (process.env.VENDOR_STORE_MODE || process.env.HUB_STORE_MODE || '').toLowerCase();
  return mode === 'postgres' && !!process.env.DATABASE_URL;
}

function backend() {
  // WOS-84 — do not require Redis-backed kv.js when vendor SoR is Postgres.
  if (isVendorPostgresMode()) return pg;
  return require('./db/kv');
}

async function readVendorRecord(ref) {
  return backend().readVendorRecord(ref);
}

async function writeVendorRecord(ref, record) {
  return backend().writeVendorRecord(ref, record);
}

async function getAllVendorRecords() {
  return backend().getAllVendorRecords();
}

module.exports = {
  isVendorPostgresMode,
  readVendorRecord,
  writeVendorRecord,
  getAllVendorRecords,
  deleteVendorRecordForTest: pg.deleteVendorRecordForTest,
  vendorPostgresHealthCheck: pg.healthCheck,
};
