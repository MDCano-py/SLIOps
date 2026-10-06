/**
 * WOS-50 Vendor UI permission checks — shared logic for tests and RbacClient.
 * UI convenience only; APIs enforce access server-side.
 */

const REBEKAH_VENDOR_PRESET = [
  'view_management',
  'view_vendor_list',
  'view_vendor_dashboard',
  'view_vendor_documents',
  'submit_new_vendor',
  'edit_vendor_info',
  'edit_vendor_workflow',
  'edit_vendor_compliance',
  'manage_vendor_documents',
];

const AP_VENDOR_PRESET = [
  'view_management',
  'view_vendor_list',
  'view_vendor_dashboard',
  'view_vendor_documents',
  'submit_new_vendor',
  'edit_vendor_info',
  'edit_vendor_workflow',
  'edit_vendor_compliance',
  'manage_vendor_documents',
];

const DYLAN_LEGAL_PRESET = [
  'view_management',
  'view_vendor_list',
  'view_vendor_dashboard',
  'view_vendor_documents',
  'edit_vendor_compliance',
  'manage_vendor_documents',
];

const VENDOR_VIEWER_PRESET = [
  'view_management',
  'view_vendor_list',
  'view_vendor_dashboard',
  'view_vendor_documents',
];

const STANDARD_USER_PRESET = [
  'view_home',
  'view_hub_dashboard',
  'view_hub_requests',
  'view_parts_request',
  'view_work_order',
];

const ADMIN_PRESET = ['admin', 'hub_admin', ...REBEKAH_VENDOR_PRESET];

const ROLE_PREVIEW_PRESETS = {
  admin: { label: 'Admin', permissions: ADMIN_PRESET },
  rebekah: { label: 'Rebekah / Admin vendor owner', permissions: REBEKAH_VENDOR_PRESET },
  ap: { label: 'Accounts Payable', permissions: AP_VENDOR_PRESET },
  dylan: { label: 'Dylan / Legal', permissions: DYLAN_LEGAL_PRESET },
  vendor_viewer: { label: 'Vendor viewer (read-only)', permissions: VENDOR_VIEWER_PRESET },
  standard: { label: 'Standard user (no vendor access)', permissions: STANDARD_USER_PRESET },
};

function createPermHelpers(isNoAuth = false) {
  function hasPerm(perms, id) {
    if (isNoAuth) return true;
    const p = Array.isArray(perms) ? perms : [];
    if (!id) return false;
    if (p.includes('admin') || p.includes('hub_admin')) return true;
    return p.includes(id);
  }

  function hasAnyPerm(perms, needed) {
    if (isNoAuth) return true;
    const list = Array.isArray(needed) ? needed : [needed];
    return list.some((id) => hasPerm(perms, id));
  }

  return { hasPerm, hasAnyPerm };
}

function createVendorUiChecks(isNoAuth = false) {
  const { hasPerm, hasAnyPerm } = createPermHelpers(isNoAuth);

  return {
    canEditVendorWorkflow(perms) {
      return hasPerm(perms, 'edit_vendor_workflow');
    },
    canEditVendorCompliance(perms) {
      return hasPerm(perms, 'edit_vendor_compliance');
    },
    canEditVendorInfo(perms) {
      return hasPerm(perms, 'edit_vendor_info');
    },
    canManageVendorDocuments(perms) {
      return hasPerm(perms, 'manage_vendor_documents');
    },
    canViewVendorDocuments(perms) {
      return hasAnyPerm(perms, ['view_vendor_documents', 'manage_vendor_documents']);
    },
    canEditVendorDocStatus(perms) {
      return hasAnyPerm(perms, [
        'edit_vendor_compliance',
        'edit_vendor_workflow',
        'manage_vendor_documents',
      ]);
    },
    canVendorWorkflowActions(perms) {
      return hasPerm(perms, 'edit_vendor_workflow');
    },
    canVendorSaveBar(perms) {
      return hasPerm(perms, 'edit_vendor_workflow');
    },
    canDashVendorNote(perms) {
      return hasAnyPerm(perms, [
        'edit_vendor_info',
        'edit_vendor_workflow',
        'edit_vendor_compliance',
      ]);
    },
    canDashVendorUpload(perms) {
      return hasPerm(perms, 'manage_vendor_documents');
    },
    canSubmitNewVendor(perms) {
      return hasPerm(perms, 'submit_new_vendor');
    },
    canViewVendorDashboard(perms) {
      return hasAnyPerm(perms, ['view_vendor_dashboard', 'view_vendor_list']);
    },
    canDeleteVendorDocuments(perms) {
      return hasPerm(perms, 'manage_vendor_documents');
    },
  };
}

function evaluateVendorDetailUi(perms, isNoAuth = false) {
  const c = createVendorUiChecks(isNoAuth);
  return {
    showSaveBar: c.canVendorSaveBar(perms),
    showWorkflowDropdowns: c.canEditVendorWorkflow(perms),
    showWorkflowActionButtons: c.canVendorWorkflowActions(perms),
    showDocStatusDropdowns: c.canEditVendorDocStatus(perms),
    showDocumentUploads: c.canManageVendorDocuments(perms),
    showDocumentDelete: c.canDeleteVendorDocuments(perms),
    showDownloadAll: c.canViewVendorDocuments(perms),
  };
}

module.exports = {
  ROLE_PREVIEW_PRESETS,
  REBEKAH_VENDOR_PRESET,
  AP_VENDOR_PRESET,
  DYLAN_LEGAL_PRESET,
  VENDOR_VIEWER_PRESET,
  STANDARD_USER_PRESET,
  ADMIN_PRESET,
  createVendorUiChecks,
  evaluateVendorDetailUi,
};
