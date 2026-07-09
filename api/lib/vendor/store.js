/**
 * WOS-44 Vendor Master store facade — Postgres when enabled, else legacy KV.
 */

const kv = require('./db/kv');
const pg = require('./db/postgres');

function isVendorPostgresMode() {
  const mode = (process.env.VENDOR_STORE_MODE || process.env.HUB_STORE_MODE || '').toLowerCase();
  return mode === 'postgres' && !!process.env.DATABASE_URL;
}

function backend() {
  return isVendorPostgresMode() ? pg : kv;
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
