/**
 * WOS-43 hybrid vendor dashboard helpers.
 * Maps legacy department-owned vendor records to operational pipeline stages
 * without changing deriveOverallStatus() or stored workflow fields.
 */

function derivePipelineStage(v) {
  if (!v) return 'unknown';
  const os = v.overallStatus;
  if (os === 'complete') return 'complete';

  const ap = v.apStatus || 'not_started';
  const contract = v.contractStatus || 'not_started';
  const assigned = v.assignedTo || 'rebekah';
  const docCount = typeof v.documentCount === 'number' ? v.documentCount : 0;

  const noComplianceProgress =
    (v.w9Status === 'not_received' || v.w9Status === 'missing' || !v.w9Status) &&
    (v.bankingStatus === 'not_received' || v.bankingStatus === 'missing' || !v.bankingStatus) &&
    (v.insuranceStatus === 'not_received' || v.insuranceStatus === 'missing' || !v.insuranceStatus);

  const contractIdle = contract === 'not_started' || contract === 'not_required';
  const adminPending =
    v.adminStatus === 'pending_review' ||
    v.adminStatus === 'collecting_documents' ||
    v.adminStatus === 'in_progress' ||
    (!v.adminStatus && assigned === 'rebekah');

  // Not started: newly submitted, still with Administration, no departmental progress.
  if (adminPending && ap === 'not_started' && contractIdle && noComplianceProgress && docCount === 0) {
    return 'not_started';
  }

  return 'in_progress';
}

function deriveDeptStatuses(v) {
  if (!v) return { admin: 'unknown', ap: 'unknown', contract: 'unknown' };

  const os = v.overallStatus;
  if (os === 'complete') {
    return {
      admin: 'complete',
      ap: 'complete',
      contract: v.contractStatus === 'not_required' ? 'complete' : 'complete',
    };
  }

  let admin;
  if (v.adminStatus === 'complete' || v.adminStatus === 'approved' || v.adminStatus === 'sent_to_ap') {
    admin = 'complete';
  } else if (
    v.adminStatus === 'pending_review' ||
    v.adminStatus === 'in_progress' ||
    v.adminStatus === 'collecting_documents'
  ) {
    admin = 'in_progress';
  } else {
    admin = v.assignedTo === 'rebekah' ? 'in_progress' : 'complete';
  }

  const apStatus = v.apStatus || 'not_started';
  let ap;
  if (apStatus === 'complete') ap = 'complete';
  else if (
    apStatus === 'in_progress' ||
    v.assignedTo === 'ap' ||
    os === 'pending_ap' ||
    os === 'pending_ap_setup'
  ) {
    ap = 'in_progress';
  } else {
    ap = 'not_started';
  }

  const cs = v.contractStatus || 'not_started';
  let contract;
  if (cs === 'not_required') contract = 'complete';
  else if (cs === 'complete') contract = 'complete';
  else if (
    cs === 'in_progress' ||
    cs === 'legal_review' ||
    cs === 'required' ||
    cs === 'pending_dylan_review' ||
    v.assignedTo === 'dylan' ||
    os === 'pending_contract' ||
    os === 'pending_contract_review' ||
    os === 'pending_dylan_review'
  ) {
    contract = 'in_progress';
  } else {
    contract = 'not_started';
  }

  return { admin, ap, contract };
}

function enrichVendorSummary(v, overallStatus) {
  const base = { ...v, overallStatus: overallStatus || v.overallStatus };
  const dept = deriveDeptStatuses(base);
  return {
    ...v,
    overallStatus: base.overallStatus,
    pipelineStage: derivePipelineStage(base),
    deptAdmin: dept.admin,
    deptAp: dept.ap,
    deptContract: dept.contract,
  };
}

function attachHybridFields(v, overallStatus) {
  if (!v) return v;
  const os = overallStatus != null ? overallStatus : v.overallStatus;
  const base = { ...v, overallStatus: os };
  const dept = deriveDeptStatuses(base);
  v.overallStatus = os;
  v.pipelineStage = derivePipelineStage(base);
  v.deptAdmin = dept.admin;
  v.deptAp = dept.ap;
  v.deptContract = dept.contract;
  return v;
}

module.exports = {
  derivePipelineStage,
  deriveDeptStatuses,
  enrichVendorSummary,
  attachHybridFields,
};
