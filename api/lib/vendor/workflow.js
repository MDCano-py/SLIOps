/**
 * WOS-45 Vendor workflow routing — deterministic transitions on Vendor Master records.
 */

const {
  markRequiredDocumentsRequested,
  getSendToApWarnings,
  attachDocumentFields,
  ensureDocumentMeta,
  isRequiredDocumentsComplete,
} = require('./documents.js');
const { attachVisibilityFields } = require('./visibility.js');

const WORKFLOW_ACTIONS = [
  'start_rebekah_review',
  'request_documents',
  'send_to_ap',
  'mark_ap_complete',
  'mark_contract_required',
  'mark_contract_not_required',
  'send_to_dylan',
  'mark_contract_complete',
  'mark_vendor_complete',
  'reject_or_cancel',
];

const TERMINAL_OVERALL = new Set(['complete', 'rejected', 'cancelled']);

function snapshotWorkflowFields(record) {
  return {
    overallStatus: record.overallStatus,
    adminStatus: record.adminStatus,
    apStatus: record.apStatus,
    contractStatus: record.contractStatus,
    assignedTo: record.assignedTo,
    msaStatus: record.msaStatus,
    ndaStatus: record.ndaStatus,
  };
}

function isContractRequirementMet(record) {
  ensureDocumentMeta(record);
  const msaOk =
    !record.msaRequired ||
    record.msaStatus === 'complete' ||
    record.msaStatus === 'approved' ||
    record.msaStatus === 'not_required';
  const ndaOk =
    !record.ndaRequired ||
    record.ndaStatus === 'complete' ||
    record.ndaStatus === 'approved' ||
    record.ndaStatus === 'not_required';
  const contractOk =
    record.contractStatus === 'complete' || record.contractStatus === 'not_required';
  return msaOk && ndaOk && contractOk;
}

function isVendorComplete(record) {
  if (!record) return false;
  if (record.overallStatus === 'complete') return true;
  if (TERMINAL_OVERALL.has(record.overallStatus) && record.overallStatus !== 'complete') return false;
  return record.apStatus === 'complete' && isContractRequirementMet(record);
}

function getVendorAssignedOwner(record) {
  if (!record) return null;
  if (record.overallStatus === 'complete') return 'none';
  if (record.overallStatus === 'rejected' || record.overallStatus === 'cancelled') return 'none';
  return record.assignedTo || 'rebekah';
}

function getVendorActionRequired(record) {
  if (!record) return 'Unknown';
  if (record.overallStatus === 'complete') return 'None';
  if (record.overallStatus === 'rejected') return 'None — rejected';
  if (record.overallStatus === 'cancelled') return 'None — cancelled';

  const owner = getVendorAssignedOwner(record);
  const map = {
    rebekah: {
      pending_rebekah_review: 'Review vendor request and collect required documents',
      pending_contract_review: 'Determine MSA/NDA requirements and finalize contract',
      collecting_documents: 'Collect required vendor documents',
    },
    ap: {
      pending_ap_setup: 'Verify tax/banking info and complete AP vendor setup',
    },
    dylan: {
      pending_dylan_review: 'Legal review and contract edits',
    },
  };

  if (record.adminStatus === 'collecting_documents' && owner === 'rebekah') {
    return map.rebekah.collecting_documents;
  }

  const byOwner = map[owner];
  if (byOwner && byOwner[record.overallStatus]) return byOwner[record.overallStatus];

  if (record.overallStatus === 'pending_rebekah_review') return 'Pending Rebekah review';
  if (record.overallStatus === 'pending_ap_setup') return 'Pending AP setup';
  if (record.overallStatus === 'pending_contract_review') return 'Pending contract review';
  if (record.overallStatus === 'pending_dylan_review') return 'Pending Dylan legal review';
  return 'In progress';
}

function deriveVendorWorkflowState(record) {
  if (!record) return null;
  return {
    overallStatus: record.overallStatus,
    adminStatus: record.adminStatus,
    apStatus: record.apStatus,
    contractStatus: record.contractStatus,
    assignedTo: getVendorAssignedOwner(record),
    actionRequired: getVendorActionRequired(record),
    isComplete: isVendorComplete(record),
    contractRequirementMet: isContractRequirementMet(record),
  };
}

function appendHistory(record, entry) {
  record.history = record.history || [];
  record.history.push(entry);
}

function applyCompletionIfReady(record, now) {
  if (!isVendorComplete(record)) return false;
  record.overallStatus = 'complete';
  record.assignedTo = 'none';
  if (record.contractStatus !== 'not_required' && record.contractStatus !== 'complete') {
    record.contractStatus = 'complete';
  }
  record.lastActionDate = now;
  return true;
}

function applyVendorWorkflowTransition(record, action, actor, payload = {}) {
  if (!record || !action) {
    return { ok: false, error: 'missing_record_or_action' };
  }
  if (!WORKFLOW_ACTIONS.includes(action)) {
    return { ok: false, error: 'unknown_action' };
  }
  if (TERMINAL_OVERALL.has(record.overallStatus) && action !== 'reject_or_cancel') {
    return { ok: false, error: 'terminal_state' };
  }

  const now = payload.now || new Date().toISOString();
  const note = payload.note != null ? String(payload.note).trim() : '';
  const before = snapshotWorkflowFields(record);
  let notify = null;
  let warnings = [];

  switch (action) {
    case 'start_rebekah_review': {
      if (record.overallStatus !== 'pending_rebekah_review') {
        return { ok: false, error: 'invalid_transition', detail: 'overall must be pending_rebekah_review' };
      }
      record.adminStatus = 'pending_review';
      record.assignedTo = 'rebekah';
      record.overallStatus = 'pending_rebekah_review';
      break;
    }

    case 'request_documents': {
      if (record.overallStatus !== 'pending_rebekah_review') {
        return { ok: false, error: 'invalid_transition', detail: 'must be pending Rebekah review' };
      }
      record.adminStatus = 'collecting_documents';
      record.assignedTo = 'rebekah';
      record.overallStatus = 'pending_rebekah_review';
      markRequiredDocumentsRequested(record, actor, note || 'Documents requested');
      if (payload.w9Status) record.w9Status = payload.w9Status;
      if (payload.bankingStatus) record.bankingStatus = payload.bankingStatus;
      if (payload.insuranceStatus) record.insuranceStatus = payload.insuranceStatus;
      if (payload.documentMeta) record.documentMeta = { ...(record.documentMeta || {}), ...payload.documentMeta };
      ensureDocumentMeta(record);
      notify = 'documents_requested';
      break;
    }

    case 'send_to_ap': {
      if (record.overallStatus !== 'pending_rebekah_review') {
        return { ok: false, error: 'invalid_transition', detail: 'must be pending Rebekah review to send to AP' };
      }
      warnings = getSendToApWarnings(record);
      record.adminStatus = payload.adminComplete ? 'complete' : 'sent_to_ap';
      record.apStatus = 'in_progress';
      record.overallStatus = 'pending_ap_setup';
      record.assignedTo = 'ap';
      notify = 'sent_to_ap';
      break;
    }

    case 'mark_ap_complete': {
      if (record.apStatus !== 'in_progress' && record.overallStatus !== 'pending_ap_setup') {
        return { ok: false, error: 'invalid_transition', detail: 'AP must be in progress' };
      }
      record.apStatus = 'complete';
      if (isContractRequirementMet(record) && (!record.msaRequired && !record.ndaRequired)) {
        applyCompletionIfReady(record, now);
        notify = 'vendor_complete';
      } else if (record.msaRequired || record.ndaRequired || !isContractRequirementMet(record)) {
        record.overallStatus = 'pending_contract_review';
        record.assignedTo = 'rebekah';
        if (record.contractStatus === 'not_started') record.contractStatus = 'in_progress';
        if (record.msaRequired && record.msaStatus !== 'complete' && record.msaStatus !== 'not_required') {
          record.msaStatus = record.msaStatus === 'not_required' ? 'required' : (record.msaStatus || 'required');
        }
        if (record.ndaRequired && record.ndaStatus !== 'complete' && record.ndaStatus !== 'not_required') {
          record.ndaStatus = record.ndaStatus === 'not_required' ? 'required' : (record.ndaStatus || 'required');
        }
        notify = 'ap_complete_contract';
      } else {
        applyCompletionIfReady(record, now);
        notify = 'vendor_complete';
      }
      break;
    }

    case 'mark_contract_required': {
      if (record.overallStatus !== 'pending_contract_review' && record.overallStatus !== 'pending_ap_setup') {
        return { ok: false, error: 'invalid_transition', detail: 'contract routing not active' };
      }
      record.msaRequired = payload.msaRequired != null ? !!payload.msaRequired : record.msaRequired;
      record.ndaRequired = payload.ndaRequired != null ? !!payload.ndaRequired : record.ndaRequired;
      record.contractStatus = 'required';
      record.overallStatus = 'pending_contract_review';
      record.assignedTo = 'rebekah';
      if (record.msaRequired) record.msaStatus = 'required';
      else record.msaStatus = 'not_required';
      if (record.ndaRequired) record.ndaStatus = 'required';
      else record.ndaStatus = 'not_required';
      if (record.contractStatus === 'not_started') record.contractStatus = 'in_progress';
      break;
    }

    case 'mark_contract_not_required': {
      record.msaRequired = false;
      record.ndaRequired = false;
      record.contractStatus = 'not_required';
      record.msaStatus = 'not_required';
      record.ndaStatus = 'not_required';
      if (applyCompletionIfReady(record, now)) {
        notify = 'vendor_complete';
      }
      break;
    }

    case 'send_to_dylan': {
      if (
        record.overallStatus !== 'pending_contract_review' &&
        record.contractStatus !== 'in_progress' &&
        record.contractStatus !== 'required'
      ) {
        return { ok: false, error: 'invalid_transition', detail: 'contract must be in progress' };
      }
      record.overallStatus = 'pending_dylan_review';
      record.contractStatus = 'pending_dylan_review';
      record.assignedTo = 'dylan';
      notify = 'sent_to_dylan';
      break;
    }

    case 'mark_contract_complete': {
      record.contractStatus = 'complete';
      if (record.msaRequired) record.msaStatus = 'complete';
      if (record.ndaRequired) record.ndaStatus = 'complete';
      if (!record.msaRequired) record.msaStatus = 'not_required';
      if (!record.ndaRequired) record.ndaStatus = 'not_required';
      if (applyCompletionIfReady(record, now)) notify = 'vendor_complete';
      else {
        record.overallStatus = 'pending_contract_review';
        record.assignedTo = 'rebekah';
      }
      break;
    }

    case 'mark_vendor_complete': {
      if (!isVendorComplete(record)) {
        return { ok: false, error: 'invalid_transition', detail: 'AP and contract requirements not met' };
      }
      applyCompletionIfReady(record, now);
      notify = 'vendor_complete';
      break;
    }

    case 'reject_or_cancel': {
      const status = payload.status === 'cancelled' ? 'cancelled' : 'rejected';
      record.overallStatus = status;
      record.assignedTo = 'none';
      break;
    }

    default:
      return { ok: false, error: 'unknown_action' };
  }

  record.lastActionDate = now;
  ensureDocumentMeta(record);
  const after = snapshotWorkflowFields(record);
  appendHistory(record, {
    at: now,
    event: 'workflow',
    action,
    by: actor || 'unknown',
    note: note || undefined,
    previous: before,
    next: after,
  });

  return {
    ok: true,
    record,
    action,
    notify,
    warnings,
    previous: before,
    next: after,
    requiredDocumentsComplete: isRequiredDocumentsComplete(record),
  };
}

function attachWorkflowFields(v) {
  if (!v) return v;
  const state = deriveVendorWorkflowState(v);
  v.actionRequired = state.actionRequired;
  v.assignedOwner = state.assignedTo;
  v.isComplete = state.isComplete;
  attachDocumentFields(v);
  attachVisibilityFields(v);
  return v;
}

const WORKFLOW_ACTION_PERMISSIONS = {
  start_rebekah_review: ['edit_vendor_workflow', 'edit_vendor_compliance'],
  request_documents: ['edit_vendor_workflow', 'edit_vendor_compliance'],
  send_to_ap: ['edit_vendor_workflow'],
  mark_ap_complete: ['edit_vendor_workflow'],
  mark_contract_required: ['edit_vendor_workflow'],
  mark_contract_not_required: ['edit_vendor_workflow'],
  send_to_dylan: ['edit_vendor_workflow'],
  mark_contract_complete: ['edit_vendor_workflow'],
  mark_vendor_complete: ['edit_vendor_workflow'],
  reject_or_cancel: ['edit_vendor_workflow'],
};

function permissionsForWorkflowAction(action) {
  return WORKFLOW_ACTION_PERMISSIONS[action] || ['edit_vendor_workflow'];
}

module.exports = {
  WORKFLOW_ACTIONS,
  WORKFLOW_ACTION_PERMISSIONS,
  deriveVendorWorkflowState,
  applyVendorWorkflowTransition,
  isVendorComplete,
  isContractRequirementMet,
  getVendorAssignedOwner,
  getVendorActionRequired,
  attachWorkflowFields,
  permissionsForWorkflowAction,
};
