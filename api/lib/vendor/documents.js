/**
 * WOS-46 Vendor document storage + required docs tracking.
 */

const DOC_TYPES = ['w9', 'banking', 'insurance', 'msa', 'nda'];
const DOC_STATUSES = ['missing', 'requested', 'received', 'approved', 'not_required'];
const ACCEPTED_COMPLETE = new Set(['received', 'approved']);

const DOC_LABELS = {
  w9: 'W-9',
  banking: 'Banking',
  insurance: 'Insurance',
  msa: 'MSA',
  nda: 'NDA',
  other: 'Other',
};

function normalizeDocStatus(status) {
  if (!status) return 'missing';
  const s = String(status).toLowerCase();
  if (DOC_STATUSES.includes(s)) return s;
  if (s === 'not_received') return 'missing';
  if (s === 'verified') return 'approved';
  if (s === 'complete') return 'approved';
  if (s === 'required') return 'missing';
  return 'missing';
}

function emptyDocEntry(required = true) {
  return {
    required: !!required,
    status: required ? 'missing' : 'not_required',
    files: [],
    lastUpdatedAt: null,
    updatedBy: null,
    note: '',
  };
}

function isInsuranceRequired(record) {
  if (record.insuranceRequired != null) return !!record.insuranceRequired;
  if (record.documentMeta?.insurance?.required != null) return !!record.documentMeta.insurance.required;
  return false;
}

function buildDefaultDocumentMeta(record = {}) {
  const msaRequired = !!record.msaRequired;
  const ndaRequired = !!record.ndaRequired;
  const insuranceRequired = isInsuranceRequired(record);
  return {
    w9: emptyDocEntry(true),
    banking: emptyDocEntry(true),
    insurance: emptyDocEntry(insuranceRequired),
    msa: emptyDocEntry(msaRequired),
    nda: emptyDocEntry(ndaRequired),
    other: [],
  };
}

function normalizeDocEntry(entry, requiredDefault) {
  const base = entry && typeof entry === 'object' ? { ...entry } : {};
  const required = base.required != null ? !!base.required : !!requiredDefault;
  let status = normalizeDocStatus(base.status);
  if (!required && (status === 'missing' || !base.status)) status = 'not_required';
  return {
    required,
    status,
    files: Array.isArray(base.files) ? base.files.map(sanitizeFileMeta) : [],
    lastUpdatedAt: base.lastUpdatedAt || null,
    updatedBy: base.updatedBy || null,
    note: base.note || '',
  };
}

function sanitizeFileMeta(file) {
  if (!file || typeof file !== 'object') return null;
  return {
    filename: file.filename || '',
    uploadedAt: file.uploadedAt || null,
    size: typeof file.size === 'number' ? file.size : null,
    uploadedBy: file.uploadedBy || null,
  };
}

function ensureDocumentMeta(record) {
  if (!record) return buildDefaultDocumentMeta();
  const defaults = buildDefaultDocumentMeta(record);
  const raw = record.documentMeta || {};
  const meta = {
    w9: normalizeDocEntry(raw.w9, true),
    banking: normalizeDocEntry(raw.banking, true),
    insurance: normalizeDocEntry(raw.insurance, isInsuranceRequired(record)),
    msa: normalizeDocEntry(raw.msa, !!record.msaRequired),
    nda: normalizeDocEntry(raw.nda, !!record.ndaRequired),
    other: Array.isArray(raw.other)
      ? raw.other.map((o) => ({
          label: o?.label || 'Other',
          status: normalizeDocStatus(o?.status || 'received'),
          files: Array.isArray(o?.files) ? o.files.map(sanitizeFileMeta).filter(Boolean) : [],
          lastUpdatedAt: o?.lastUpdatedAt || null,
          updatedBy: o?.updatedBy || null,
          note: o?.note || '',
        }))
      : [],
  };

  // Legacy flat columns override when documentMeta empty/missing
  if (record.w9Status) meta.w9.status = normalizeDocStatus(record.w9Status);
  if (record.bankingStatus) meta.banking.status = normalizeDocStatus(record.bankingStatus);
  if (record.insuranceStatus) meta.insurance.status = normalizeDocStatus(record.insuranceStatus);
  if (record.msaStatus) meta.msa.status = normalizeDocStatus(record.msaStatus);
  if (record.ndaStatus) meta.nda.status = normalizeDocStatus(record.ndaStatus);

  meta.w9.required = true;
  meta.banking.required = true;
  meta.insurance.required = isInsuranceRequired(record);
  meta.msa.required = !!record.msaRequired;
  meta.nda.required = !!record.ndaRequired;

  if (!meta.insurance.required) meta.insurance.status = 'not_required';
  if (!meta.msa.required) meta.msa.status = 'not_required';
  if (!meta.nda.required) meta.nda.status = 'not_required';

  record.documentMeta = meta;
  syncFlatStatuses(record);
  return meta;
}

function statusToFlat(status, docType) {
  const s = normalizeDocStatus(status);
  if (docType === 'msa' || docType === 'nda') {
    if (s === 'approved') return 'complete';
    if (s === 'missing') return 'required';
    return s;
  }
  return s;
}

function syncFlatStatuses(record) {
  const meta = record.documentMeta || ensureDocumentMeta(record);
  record.w9Status = statusToFlat(meta.w9.status, 'w9');
  record.bankingStatus = statusToFlat(meta.banking.status, 'banking');
  record.insuranceStatus = statusToFlat(meta.insurance.status, 'insurance');
  record.msaStatus = statusToFlat(meta.msa.status, 'msa');
  record.ndaStatus = statusToFlat(meta.nda.status, 'nda');
}

function isDocTypeRequired(record, docType) {
  const meta = ensureDocumentMeta(record);
  if (docType === 'w9' || docType === 'banking') return true;
  if (docType === 'insurance') return meta.insurance.required;
  if (docType === 'msa') return !!record.msaRequired;
  if (docType === 'nda') return !!record.ndaRequired;
  return false;
}

function isDocSatisfied(entry) {
  if (!entry) return true;
  if (!entry.required) return true;
  return ACCEPTED_COMPLETE.has(normalizeDocStatus(entry.status));
}

function getMissingRequiredDocuments(record) {
  ensureDocumentMeta(record);
  const missing = [];
  for (const docType of DOC_TYPES) {
    const entry = record.documentMeta[docType];
    if (!entry?.required) continue;
    const status = normalizeDocStatus(entry.status);
    if (!ACCEPTED_COMPLETE.has(status)) {
      missing.push({
        docType,
        label: DOC_LABELS[docType],
        status,
        required: true,
      });
    }
  }
  return missing;
}

function isRequiredDocumentsComplete(record) {
  return getMissingRequiredDocuments(record).length === 0;
}

function computeDocumentSummary(record) {
  ensureDocumentMeta(record);
  const summary = {};
  for (const docType of DOC_TYPES) {
    const entry = record.documentMeta[docType];
    summary[docType] = {
      label: DOC_LABELS[docType],
      required: !!entry.required,
      status: normalizeDocStatus(entry.status),
      fileCount: Array.isArray(entry.files) ? entry.files.length : 0,
      lastUpdatedAt: entry.lastUpdatedAt,
    };
  }
  summary.other = {
    label: 'Other',
    count: Array.isArray(record.documentMeta.other) ? record.documentMeta.other.length : 0,
  };
  return summary;
}

function appendDocumentHistory(record, entry) {
  record.history = record.history || [];
  record.history.push({
    at: entry.at || new Date().toISOString(),
    event: entry.event || 'document_updated',
    by: entry.by || 'unknown',
    docType: entry.docType,
    previousStatus: entry.previousStatus,
    newStatus: entry.newStatus,
    filename: entry.filename,
    note: entry.note,
  });
}

function updateDocumentStatus(record, docType, status, actor, opts = {}) {
  if (!DOC_TYPES.includes(docType)) {
    return { ok: false, error: 'invalid_doc_type' };
  }
  const normalized = normalizeDocStatus(status);
  if (!DOC_STATUSES.includes(normalized)) {
    return { ok: false, error: 'invalid_status' };
  }

  ensureDocumentMeta(record);
  const entry = record.documentMeta[docType];
  const previousStatus = entry.status;
  if (previousStatus === normalized && !opts.note) {
    return { ok: true, unchanged: true, record };
  }

  entry.status = normalized;
  entry.lastUpdatedAt = opts.now || new Date().toISOString();
  entry.updatedBy = actor || null;
  if (opts.note) entry.note = String(opts.note);

  syncFlatStatuses(record);
  record.lastActionDate = entry.lastUpdatedAt;

  appendDocumentHistory(record, {
    at: entry.lastUpdatedAt,
    event: 'document_status',
    by: actor,
    docType,
    previousStatus,
    newStatus: normalized,
    note: opts.note,
  });

  return { ok: true, record, docType, previousStatus, newStatus: normalized };
}

function attachUploadedFile(record, docType, fileMeta, actor) {
  const kind = DOC_TYPES.includes(docType) ? docType : 'other';
  ensureDocumentMeta(record);
  const now = new Date().toISOString();
  const safe = sanitizeFileMeta({ ...fileMeta, uploadedBy: actor, uploadedAt: fileMeta.uploadedAt || now });

  if (kind === 'other') {
    record.documentMeta.other.push({
      label: fileMeta.label || 'Other',
      status: 'received',
      files: [safe],
      lastUpdatedAt: now,
      updatedBy: actor,
      note: '',
    });
    appendDocumentHistory(record, {
      at: now,
      event: 'document_upload',
      by: actor,
      docType: 'other',
      filename: safe.filename,
      newStatus: 'received',
      note: `Uploaded ${safe.filename}`,
    });
    record.lastActionDate = now;
    return { ok: true, record, docType: 'other', newStatus: 'received' };
  }

  const entry = record.documentMeta[kind];
  const previousStatus = entry.status;
  entry.files = entry.files || [];
  entry.files.push(safe);
  entry.lastUpdatedAt = now;
  entry.updatedBy = actor;

  if (normalizeDocStatus(entry.status) !== 'approved') {
    entry.status = 'received';
  }

  syncFlatStatuses(record);
  record.lastActionDate = now;

  appendDocumentHistory(record, {
    at: now,
    event: 'document_upload',
    by: actor,
    docType: kind,
    previousStatus,
    newStatus: entry.status,
    filename: safe.filename,
    note: `Uploaded ${safe.filename} (${kind})`,
  });

  return { ok: true, record, docType: kind, previousStatus, newStatus: entry.status };
}

function markRequiredDocumentsRequested(record, actor, note) {
  ensureDocumentMeta(record);
  const updated = [];
  for (const docType of DOC_TYPES) {
    const entry = record.documentMeta[docType];
    if (!entry.required) continue;
    if (normalizeDocStatus(entry.status) === 'missing') {
      const r = updateDocumentStatus(record, docType, 'requested', actor, { note });
      if (r.ok && !r.unchanged) updated.push(docType);
    }
  }
  return updated;
}

function getSendToApWarnings(record) {
  const missing = getMissingRequiredDocuments(record).filter(
    (d) => d.docType === 'w9' || d.docType === 'banking'
  );
  if (!missing.length) return [];
  return missing.map((d) => `${d.label} is still ${d.status.replace(/_/g, ' ')}`);
}

function attachDocumentFields(record) {
  if (!record) return record;
  ensureDocumentMeta(record);
  record.documentSummary = computeDocumentSummary(record);
  record.missingRequiredDocuments = getMissingRequiredDocuments(record);
  record.requiredDocumentsComplete = isRequiredDocumentsComplete(record);
  return record;
}

function enrichVendorRecord(record) {
  if (!record) return record;
  ensureDocumentMeta(record);
  attachDocumentFields(record);
  return record;
}

const DOC_STATUS_PERMISSIONS = {
  w9: ['edit_vendor_compliance', 'edit_vendor_workflow'],
  banking: ['edit_vendor_compliance', 'edit_vendor_workflow'],
  insurance: ['edit_vendor_compliance', 'edit_vendor_workflow'],
  msa: ['edit_vendor_workflow'],
  nda: ['edit_vendor_workflow'],
  other: ['manage_vendor_documents', 'edit_vendor_compliance'],
};

function permissionsForDocType(docType) {
  return DOC_STATUS_PERMISSIONS[docType] || ['edit_vendor_compliance'];
}

module.exports = {
  DOC_TYPES,
  DOC_STATUSES,
  DOC_LABELS,
  normalizeDocStatus,
  buildDefaultDocumentMeta,
  ensureDocumentMeta,
  syncFlatStatuses,
  updateDocumentStatus,
  attachUploadedFile,
  markRequiredDocumentsRequested,
  getMissingRequiredDocuments,
  isRequiredDocumentsComplete,
  computeDocumentSummary,
  getSendToApWarnings,
  attachDocumentFields,
  enrichVendorRecord,
  permissionsForDocType,
  isDocSatisfied,
};
