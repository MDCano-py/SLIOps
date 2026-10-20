/**
 * Identity principals. A session of one type must not satisfy another.
 * EMPLOYEE  — Entra / AuthBridge + sliops_session
 * VENDOR    — vendor contact + sliops_vendor_session
 * EXTERNAL_ACTION_RECIPIENT — single-use document action link
 */
const PRINCIPALS = Object.freeze({
  EMPLOYEE: 'EMPLOYEE',
  VENDOR: 'VENDOR',
  EXTERNAL_ACTION_RECIPIENT: 'EXTERNAL_ACTION_RECIPIENT',
});

module.exports = { PRINCIPALS };
