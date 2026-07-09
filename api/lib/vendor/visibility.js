/**
 * WOS-47 Vendor action visibility — next action, owner labels, document warnings.
 */

const { getSendToApWarnings, getMissingRequiredDocuments } = require('./documents.js');

function workflowHelpers() {
  return require('./workflow.js');
}

const OWNER_LABELS = {
  rebekah: 'Rebekah (Administration)',
  ap: 'Accounts Payable',
  dylan: 'Dylan (Legal)',
  none: 'None',
  complete: 'None',
};

function getAssignedOwnerLabel(owner) {
  if (!owner) return 'Unknown';
  return OWNER_LABELS[owner] || String(owner).replace(/_/g, ' ');
}

function vendorDetailPath(refNumber) {
  const base = process.env.PORTAL_BASE_URL || 'https://partsrequestportal.vercel.app';
  return `${base}/#/management/vendors/${encodeURIComponent(refNumber || '')}`;
}

function buildDocumentWarningSummary(record) {
  const warnings = [];
  const missing = getMissingRequiredDocuments(record);
  for (const d of missing) {
    warnings.push(`${d.label} is ${String(d.status).replace(/_/g, ' ')}`);
  }
  const apWarnings = getSendToApWarnings(record);
  for (const w of apWarnings) {
    if (!warnings.includes(w)) warnings.push(w);
  }
  return warnings;
}

function getNextAction(record) {
  if (!record) return 'Unknown';
  const { getVendorActionRequired } = workflowHelpers();
  const base = getVendorActionRequired(record);
  const missing = record.missingRequiredDocuments || getMissingRequiredDocuments(record);
  if (!missing.length) return base;
  const docPart = missing.map((d) => `${d.label} (${d.status.replace(/_/g, ' ')})`).join(', ');
  if (base === 'None' || base.startsWith('None —')) return `Complete required documents: ${docPart}`;
  return `${base} — blocking docs: ${docPart}`;
}

function buildNotificationSummary(record) {
  const { getVendorAssignedOwner, getVendorActionRequired } = workflowHelpers();
  const owner = record.assignedOwner || getVendorAssignedOwner(record);
  return {
    assignedOwner: owner,
    assignedOwnerLabel: getAssignedOwnerLabel(owner),
    actionRequired: record.actionRequired || getVendorActionRequired(record),
    nextAction: record.nextAction || getNextAction(record),
    requiredDocumentsComplete: record.requiredDocumentsComplete !== false
      ? !!record.requiredDocumentsComplete
      : getMissingRequiredDocuments(record).length === 0,
    missingCount: (record.missingRequiredDocuments || getMissingRequiredDocuments(record)).length,
    documentWarnings: record.documentWarningSummary || buildDocumentWarningSummary(record),
    vendorDetailPath: vendorDetailPath(record.refNumber),
  };
}

function attachVisibilityFields(record) {
  if (!record) return record;
  const { getVendorAssignedOwner, getVendorActionRequired } = workflowHelpers();
  const owner = record.assignedOwner || getVendorAssignedOwner(record);
  record.assignedOwner = owner;
  record.assignedOwnerLabel = getAssignedOwnerLabel(owner);
  record.actionRequired = record.actionRequired || getVendorActionRequired(record);
  record.documentWarningSummary = record.documentWarningSummary || buildDocumentWarningSummary(record);
  record.nextAction = getNextAction(record);
  record.notificationSummary = buildNotificationSummary(record);
  return record;
}

module.exports = {
  OWNER_LABELS,
  getAssignedOwnerLabel,
  vendorDetailPath,
  getNextAction,
  buildDocumentWarningSummary,
  buildNotificationSummary,
  attachVisibilityFields,
};
