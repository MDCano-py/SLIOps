/**
 * WOS-44 Vendor Master — record builder and row mapping (API-compatible shape).
 */

const crypto = require('crypto');
const { buildDefaultDocumentMeta, ensureDocumentMeta } = require('./documents.js');

function generateVendorRefNumber(now = new Date()) {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `VEN-${yyyy}${mm}${dd}-${rand}`;
}

function defaultDocumentMeta(msaRequired, ndaRequired, insuranceRequired = false) {
  return buildDefaultDocumentMeta({ msaRequired, ndaRequired, insuranceRequired });
}

function buildVendorRecordFromBody(body, opts = {}) {
  const now = opts.now || new Date();
  const refNumber = opts.refNumber || generateVendorRefNumber(now);
  const actorEmail = opts.actorEmail || null;
  const msaRequired = !!body.msaRequired;
  const ndaRequired = !!body.ndaRequired;

  return {
    refNumber,
    createdAt: now.toISOString(),
    createdBy: {
      ssoEmail: actorEmail,
      ssoName: opts.actorName || null,
      formName: body.requestedBy || null,
    },
    companyName: body.companyName || '',
    entityType: body.entityType || '',
    contactName: body.contactName || '',
    contactEmail: body.contactEmail || '',
    contactPhone: body.contactPhone || '',
    physicalAddress: body.physicalAddress || { street: '', city: '', state: '', zip: '' },
    billingAddress: body.billingAddress || { sameAsPhysical: false, street: '', city: '', state: '', zip: '' },
    apContact: body.apContact || { name: '', phone: '', email: '' },
    taxId: body.taxId || '',
    poRequired: body.poRequired || null,
    stateTaxExempt: body.stateTaxExempt || null,
    veriforceAccount: body.veriforceAccount || null,
    ssqId: body.ssqId || '',
    requestedCreditLimit:
      typeof body.requestedCreditLimit === 'number' && !isNaN(body.requestedCreditLimit)
        ? body.requestedCreditLimit
        : null,
    creditNotes: body.creditNotes || '',
    serviceDescription: body.serviceDescription || '',
    physicalLocations: body.physicalLocations || '',
    servicingLocations: body.servicingLocations || '',
    msaRequired,
    ndaRequired,
    systemSetup: body.systemSetup || {},
    financialNotes: body.financialNotes || '',
    requestedBy: body.requestedBy || '',
    overallStatus: 'pending_rebekah_review',
    adminStatus: 'pending_review',
    apStatus: 'not_started',
    contractStatus: !msaRequired && !ndaRequired ? 'not_required' : 'not_started',
    assignedTo: 'rebekah',
    w9Status: 'missing',
    bankingStatus: 'missing',
    insuranceStatus: 'not_required',
    msaStatus: msaRequired ? 'missing' : 'not_required',
    ndaStatus: ndaRequired ? 'missing' : 'not_required',
    documentMeta: defaultDocumentMeta(msaRequired, ndaRequired),
    documents: [],
    history: [{
      at: now.toISOString(),
      event: 'created',
      by: body.requestedBy || actorEmail || 'unknown',
      note: 'Vendor request submitted',
    }],
    lastActionDate: now.toISOString(),
  };
}

function recordToRow(record) {
  const payload = {
    physicalAddress: record.physicalAddress,
    billingAddress: record.billingAddress,
    apContact: record.apContact,
    taxId: record.taxId,
    poRequired: record.poRequired,
    stateTaxExempt: record.stateTaxExempt,
    veriforceAccount: record.veriforceAccount,
    ssqId: record.ssqId,
    requestedCreditLimit: record.requestedCreditLimit,
    creditNotes: record.creditNotes,
    physicalLocations: record.physicalLocations,
    servicingLocations: record.servicingLocations,
    msaRequired: record.msaRequired,
    ndaRequired: record.ndaRequired,
    systemSetup: record.systemSetup,
    financialNotes: record.financialNotes,
    createdBy: record.createdBy,
  };

  return {
    ref_number: record.refNumber,
    company_name: record.companyName || '',
    entity_type: record.entityType || '',
    contact_name: record.contactName || '',
    contact_email: record.contactEmail || '',
    contact_phone: record.contactPhone || '',
    service_description: record.serviceDescription || '',
    requested_by: record.requestedBy || '',
    requested_at: record.createdAt || record.requestedAt || new Date().toISOString(),
    overall_status: record.overallStatus || 'pending_rebekah_review',
    admin_status: record.adminStatus || 'pending_review',
    ap_status: record.apStatus || 'not_started',
    contract_status: record.contractStatus || 'not_started',
    assigned_to: record.assignedTo || 'rebekah',
    last_action_at: record.lastActionDate || new Date().toISOString(),
    w9_status: record.w9Status || 'missing',
    banking_status: record.bankingStatus || 'missing',
    insurance_status: record.insuranceStatus || 'not_required',
    msa_status: record.msaStatus || 'not_required',
    nda_status: record.ndaStatus || 'not_required',
    payload_json: payload,
    document_meta_json: record.documentMeta || defaultDocumentMeta(record.msaRequired, record.ndaRequired),
    history_json: Array.isArray(record.history) ? record.history : [],
  };
}

function rowToRecord(row) {
  if (!row) return null;
  const payload = row.payload_json || {};
  const record = {
    refNumber: row.ref_number,
    createdAt: row.requested_at ? new Date(row.requested_at).toISOString() : row.created_at,
    createdBy: payload.createdBy || {},
    companyName: row.company_name,
    entityType: row.entity_type,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    serviceDescription: row.service_description,
    requestedBy: row.requested_by,
    physicalAddress: payload.physicalAddress || {},
    billingAddress: payload.billingAddress || {},
    apContact: payload.apContact || {},
    taxId: payload.taxId || '',
    poRequired: payload.poRequired ?? null,
    stateTaxExempt: payload.stateTaxExempt ?? null,
    veriforceAccount: payload.veriforceAccount ?? null,
    ssqId: payload.ssqId || '',
    requestedCreditLimit: payload.requestedCreditLimit ?? null,
    creditNotes: payload.creditNotes || '',
    physicalLocations: payload.physicalLocations || '',
    servicingLocations: payload.servicingLocations || '',
    msaRequired: !!payload.msaRequired,
    ndaRequired: !!payload.ndaRequired,
    systemSetup: payload.systemSetup || {},
    financialNotes: payload.financialNotes || '',
    overallStatus: row.overall_status,
    adminStatus: row.admin_status,
    apStatus: row.ap_status,
    contractStatus: row.contract_status,
    assignedTo: row.assigned_to,
    lastActionDate: row.last_action_at ? new Date(row.last_action_at).toISOString() : null,
    w9Status: row.w9_status,
    bankingStatus: row.banking_status,
    insuranceStatus: row.insurance_status,
    msaStatus: row.msa_status,
    ndaStatus: row.nda_status,
    documentMeta: row.document_meta_json || {},
    history: row.history_json || [],
    documents: [],
  };
  ensureDocumentMeta(record);
  return record;
}

module.exports = {
  generateVendorRefNumber,
  buildVendorRecordFromBody,
  recordToRow,
  rowToRecord,
  defaultDocumentMeta,
};
