/**
 * Sanitize vendor master records for external vendor workspace clients.
 * Same SoR row — never expose internal-only fields.
 */

const INTERNAL_ONLY_KEYS = new Set([
  'financialNotes',
  'creditNotes',
  'history',
  'assignedTo',
  'assignedOwner',
  'assignedOwnerLabel',
  'adminStatus',
  'apStatus',
  'contractStatus',
  'createdBy',
  'systemSetup',
  'notificationSummary',
  'documentWarningSummary',
  'taxId',
]);

function buildOutstandingActions(record) {
  const actions = [];
  if (!record) return actions;
  const push = (id, label, status) => {
    if (!status || status === 'not_required' || status === 'complete' || status === 'received' || status === 'approved') {
      return;
    }
    actions.push({ id, label, status });
  };
  push('w9', 'Upload W9', record.w9Status);
  push('banking', 'Provide banking information', record.bankingStatus);
  push('insurance', 'Upload insurance certificate', record.insuranceStatus);
  push('msa', 'Review / sign MSA', record.msaStatus);
  push('nda', 'Review / sign NDA', record.ndaStatus);
  return actions;
}

function buildCompletedActions(record) {
  const done = [];
  if (!record) return done;
  const check = (id, label, status) => {
    if (status === 'received' || status === 'approved' || status === 'complete' || status === 'signed') {
      done.push({ id, label, status });
    }
  };
  check('w9', 'W9', record.w9Status);
  check('banking', 'Banking information', record.bankingStatus);
  check('insurance', 'Insurance certificate', record.insuranceStatus);
  check('msa', 'MSA', record.msaStatus);
  check('nda', 'NDA', record.ndaStatus);
  return done;
}

/**
 * External-safe projection of a vendor master record.
 * Omits UUID vendor id from client payloads (use refNumber only in UI).
 */
function toExternalVendorView(record, { contact = null } = {}) {
  if (!record) return null;
  const outstanding = buildOutstandingActions(record);
  const completed = buildCompletedActions(record);
  return {
    refNumber: record.refNumber,
    companyName: record.companyName || '',
    entityType: record.entityType || '',
    contactName: record.contactName || '',
    contactEmail: record.contactEmail || '',
    contactPhone: record.contactPhone || '',
    physicalAddress: record.physicalAddress || {},
    billingAddress: record.billingAddress || {},
    serviceDescription: record.serviceDescription || '',
    overallStatus: record.overallStatus || '',
    w9Status: record.w9Status || '',
    bankingStatus: record.bankingStatus || '',
    insuranceStatus: record.insuranceStatus || '',
    msaStatus: record.msaStatus || '',
    ndaStatus: record.ndaStatus || '',
    msaRequired: !!record.msaRequired,
    ndaRequired: !!record.ndaRequired,
    documents: Array.isArray(record.documents)
      ? record.documents.map((d) => ({
          filename: d.filename || d.name || '',
          kind: d.kind || d.docKind || '',
          uploadedAt: d.uploadedAt || d.at || null,
        }))
      : [],
    outstandingActions: outstanding,
    completedActions: completed,
    onboardingProgress: {
      outstandingCount: outstanding.length,
      completedCount: completed.length,
      overallStatus: record.overallStatus || '',
    },
    sessionContact: contact
      ? { email: contact.email, name: contact.name || '' }
      : null,
  };
}

function assertNoInternalLeak(view) {
  if (!view || typeof view !== 'object') return;
  for (const key of INTERNAL_ONLY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(view, key)) {
      delete view[key];
    }
  }
  if (view.id) delete view.id;
  if (view.vendorId) delete view.vendorId;
}

module.exports = {
  toExternalVendorView,
  assertNoInternalLeak,
  buildOutstandingActions,
  buildCompletedActions,
};
