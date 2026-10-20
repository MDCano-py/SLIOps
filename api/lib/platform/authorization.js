/**
 * Server-side authorization helpers.
 * Callers must enforce these on the API. UI checks are not sufficient.
 */
const { PRINCIPALS } = require('./principals');

function vendorMayAccessCompany(sessionVendorId, recordVendorId) {
  if (!sessionVendorId || !recordVendorId) return false;
  return String(sessionVendorId) === String(recordVendorId);
}

function assertVendorCompanyScope(sessionVendorId, recordVendorId) {
  if (!vendorMayAccessCompany(sessionVendorId, recordVendorId)) {
    const err = new Error('VENDOR_SCOPE_DENIED');
    err.code = 'VENDOR_SCOPE_DENIED';
    err.status = 403;
    throw err;
  }
}

module.exports = {
  PRINCIPALS,
  vendorMayAccessCompany,
  assertVendorCompanyScope,
};
