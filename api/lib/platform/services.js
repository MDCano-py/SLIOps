/**
 * Shared service facades over existing persistence.
 * Routes keep their current implementations. New callers use these
 * adapters so lifecycle, audit, and notification entry points stay stable
 * without a database rewrite.
 */
const { PRINCIPALS } = require('./principals');
const { vendorMayAccessCompany, assertVendorCompanyScope } = require('./authorization');

function hubStore() {
  return require('../hub/store');
}

function securityAudit() {
  return require('../security-audit');
}

const requestLifecycle = {
  get(id) {
    return hubStore().getRequest(id);
  },
  list(opts) {
    return hubStore().listRequests(opts);
  },
  create(input, actorEmail) {
    return hubStore().createRequest(input, actorEmail);
  },
  patch(id, patch) {
    return hubStore().patchRequest(id, patch);
  },
  addStatusHistory(entry) {
    return hubStore().addStatusHistory(entry);
  },
};

const workflow = {
  listSteps(requestId) {
    return hubStore().listWorkflowSteps(requestId);
  },
  getStep(id) {
    return hubStore().getWorkflowStep(id);
  },
  saveStep(step) {
    return hubStore().saveWorkflowStep(step);
  },
};

const documents = {
  list(requestId) {
    return hubStore().listDocuments(requestId);
  },
  save(doc) {
    return hubStore().saveDocument(doc);
  },
  getWebDocument(id) {
    return hubStore().getWebDocument(id);
  },
};

const notifications = {
  list(recipientEmail, opts) {
    return hubStore().listNotifications(recipientEmail, opts);
  },
  create(input) {
    return hubStore().createNotification(input);
  },
  markRead(id, recipientEmail) {
    return hubStore().markNotificationRead(id, recipientEmail);
  },
};

const audit = {
  security(action, details) {
    return securityAudit().recordSecurityAudit(action, details);
  },
};

module.exports = {
  PRINCIPALS,
  requestLifecycle,
  workflow,
  documents,
  notifications,
  audit,
  authorization: { vendorMayAccessCompany, assertVendorCompanyScope },
};
