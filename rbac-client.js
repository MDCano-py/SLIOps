/**
 * Client-side RBAC helpers — mirrors server permission IDs from PERMISSION_CATALOG.
 * UI hiding only; APIs enforce access via requirePermissions.
 */
(function (global) {
  'use strict';

  /** @type {string[]} */
  let cachedPermissions = [];

  function isLocalOrDevPortal() {
    try {
      if (/^(localhost|127\.0\.0\.1)$/i.test(global.location?.hostname || '')) return true;
      if (global.PORTAL_ENV === 'development') return true;
    } catch { /* ignore */ }
    return false;
  }

  function isPortalNoAuthMode() {
    const g = global;
    if (g._portalNoAuth === true) return true;
    try {
      if (/(\?|&)_noauth=1(&|$)/.test(g.location?.search || '')) return isLocalOrDevPortal();
      if (/^(localhost|127\.0\.0\.1)$/i.test(g.location?.hostname || '')) return true;
    } catch { /* ignore */ }
    return false;
  }

  function enablePortalNoAuthMode() {
    global._portalNoAuth = true;
  }

  function revealAllNav(root) {
    root.querySelectorAll('[data-rbac-key], [data-mgmt-section], [data-rbac-any]').forEach((el) => {
      setElementVisible(el, true);
    });
    const mgmtGroup = root.querySelector('[data-group="management"]');
    if (mgmtGroup) setElementVisible(mgmtGroup, true);
    root.querySelectorAll('#hubSidebarNav .hub-nav-group-label').forEach((label) => {
      if ((label.textContent || '').trim() === 'Admin') setElementVisible(label, true);
    });
  }

  const MGMT_SECTION_PERMS = {
    vendor: [
      'view_management',
      'view_vendor_list',
      'view_vendor_dashboard',
      'submit_new_vendor',
      'view_vendor_documents',
      'edit_vendor_info',
      'edit_vendor_workflow',
      'edit_vendor_compliance',
      'manage_vendor_documents',
    ],
    user: ['admin'],
    role: ['admin'],
    pssr: ['view_management'],
    sso: ['hub_admin', 'admin', 'view_management'],
    integrations: ['hub_admin', 'admin', 'view_management'],
  };

  const NAV_ITEM_RULES = {
    'mgmt:vendor': { section: 'vendor' },
    'mgmt:user': { section: 'user' },
    'mgmt:role': { section: 'role' },
    'mgmt:pssr': { section: 'pssr' },
    'mgmt:sso': { section: 'sso' },
    'mgmt:integrations': { section: 'integrations' },
    'hub:reports': { any: ['view_hub_reports', 'view_hub_dashboard'] },
    'hub:workflows-admin': { any: ['hub_admin', 'admin'] },
    'hub:users-admin': { any: ['admin', 'hub_admin'] },
    'hub:settings-admin': { any: ['hub_admin', 'admin'] },
    'hub:start-center-admin': { any: ['hub_admin', 'admin'] },
    'hub:workflows-nav': { any: ['hub_admin', 'admin'] },
    'hub:configuration-admin': {
      any: ['configuration.view', 'configuration.edit', 'configuration.publish', 'hub_admin', 'admin'],
    },
  };

  const HUB_TAB_RULES = {
    'hub-dashboard': { any: ['view_hub_dashboard'] },
    'hub-reports': { any: ['view_hub_reports', 'view_hub_dashboard'] },
    'hub-settings': { any: ['hub_admin', 'admin'] },
    'hub-start-center': { any: ['hub_admin', 'admin'] },
    'hub-configuration': {
      any: ['configuration.view', 'configuration.edit', 'configuration.publish', 'hub_admin', 'admin'],
    },
    'hub-workflows': { any: ['hub_admin', 'admin'] },
    'hub-documents': { any: ['hub_admin', 'admin'] },
    'hub-users': { any: ['admin', 'hub_admin'] },
  };

  function normalizePerms(perms) {
    return Array.isArray(perms) ? perms : [];
  }

  function hasPerm(perms, id) {
    if (isPortalNoAuthMode()) return true;
    const p = normalizePerms(perms);
    if (!id) return false;
    if (p.includes('admin') || p.includes('hub_admin')) return true;
    return p.includes(id);
  }

  function hasAnyPerm(perms, needed) {
    if (isPortalNoAuthMode()) return true;
    const list = Array.isArray(needed) ? needed : [needed];
    if (!list.length) return false;
    return list.some((id) => hasPerm(perms, id));
  }

  function canAccessMgmtSection(perms, section) {
    if (isPortalNoAuthMode()) return true;
    const needed = MGMT_SECTION_PERMS[section];
    if (!needed) return canAccessManagement(perms);
    return hasAnyPerm(perms, needed);
  }

  function canAccessManagement(perms) {
    if (isPortalNoAuthMode()) return true;
    const p = normalizePerms(perms);
    return Object.keys(MGMT_SECTION_PERMS).some((section) => canAccessMgmtSection(p, section));
  }

  function canAccessHubTab(perms, tabName) {
    if (isPortalNoAuthMode()) return true;
    const p = normalizePerms(perms);
    const rule = HUB_TAB_RULES[tabName];
    if (!rule) return true;
    return ruleAllows(p, rule);
  }

  function canAccessTab(perms, tabName, opts) {
    if (isPortalNoAuthMode()) return true;
    const p = normalizePerms(perms);
    if (tabName === 'management') {
      const section = (opts && opts.mgmtSection) || 'vendor';
      return canAccessMgmtSection(p, section);
    }
    if (tabName === 'home') {
      return hasAnyPerm(p, ['view_home', 'view_hub_reports', 'view_hub_dashboard']);
    }
    if (HUB_TAB_RULES[tabName]) {
      return canAccessHubTab(p, tabName);
    }
    return true;
  }

  /** WOS-50 — vendor detail/dashboard UI permission helpers */
  function vendorUiChecks() {
    return buildInlineVendorUiChecks();
  }

  function buildInlineVendorUiChecks() {
    const noAuth = isPortalNoAuthMode();
    const hp = (p, id) => (noAuth ? true : hasPerm(p, id));
    const ha = (p, ids) => (noAuth ? true : hasAnyPerm(p, ids));
    return {
      canEditVendorWorkflow: (p) => hp(p, 'edit_vendor_workflow'),
      canEditVendorCompliance: (p) => hp(p, 'edit_vendor_compliance'),
      canEditVendorInfo: (p) => hp(p, 'edit_vendor_info'),
      canManageVendorDocuments: (p) => hp(p, 'manage_vendor_documents'),
      canViewVendorDocuments: (p) => ha(p, ['view_vendor_documents', 'manage_vendor_documents']),
      canEditVendorDocStatus: (p) => ha(p, ['edit_vendor_compliance', 'edit_vendor_workflow', 'manage_vendor_documents']),
      canVendorWorkflowActions: (p) => hp(p, 'edit_vendor_workflow'),
      canVendorSaveBar: (p) => hp(p, 'edit_vendor_workflow'),
      canDashVendorNote: (p) => ha(p, ['edit_vendor_info', 'edit_vendor_workflow', 'edit_vendor_compliance']),
      canDashVendorUpload: (p) => hp(p, 'manage_vendor_documents'),
      canSubmitNewVendor: (p) => hp(p, 'submit_new_vendor'),
      canViewVendorDashboard: (p) => ha(p, ['view_vendor_dashboard', 'view_vendor_list']),
      canDeleteVendorDocuments: (p) => hp(p, 'manage_vendor_documents'),
    };
  }

  function evaluateVendorDetailUi(perms) {
    const p = normalizePerms(perms.length ? perms : getPermissions());
    const c = vendorUiChecks();
    return {
      showSaveBar: c.canVendorSaveBar(p),
      showWorkflowDropdowns: c.canEditVendorWorkflow(p),
      showWorkflowActionButtons: c.canVendorWorkflowActions(p),
      showDocStatusDropdowns: c.canEditVendorDocStatus(p),
      showDocumentUploads: c.canManageVendorDocuments(p),
      showDocumentDelete: c.canDeleteVendorDocuments(p),
      showDownloadAll: c.canViewVendorDocuments(p),
    };
  }

  const ROLE_PREVIEW_PRESETS = {
    admin: { label: 'Admin', permissions: ['admin', 'hub_admin', 'view_management', 'view_vendor_list', 'view_vendor_dashboard', 'view_vendor_documents', 'submit_new_vendor', 'edit_vendor_info', 'edit_vendor_workflow', 'edit_vendor_compliance', 'manage_vendor_documents'] },
    rebekah: { label: 'Rebekah / Admin vendor owner', permissions: ['view_management', 'view_vendor_list', 'view_vendor_dashboard', 'view_vendor_documents', 'submit_new_vendor', 'edit_vendor_info', 'edit_vendor_workflow', 'edit_vendor_compliance', 'manage_vendor_documents'] },
    ap: { label: 'Accounts Payable', permissions: ['view_management', 'view_vendor_list', 'view_vendor_dashboard', 'view_vendor_documents', 'submit_new_vendor', 'edit_vendor_info', 'edit_vendor_workflow', 'edit_vendor_compliance', 'manage_vendor_documents'] },
    dylan: { label: 'Dylan / Legal', permissions: ['view_management', 'view_vendor_list', 'view_vendor_dashboard', 'view_vendor_documents', 'edit_vendor_compliance', 'manage_vendor_documents'] },
    vendor_viewer: { label: 'Vendor viewer (read-only)', permissions: ['view_management', 'view_vendor_list', 'view_vendor_dashboard', 'view_vendor_documents'] },
    standard: { label: 'Standard user (no vendor access)', permissions: ['view_home', 'view_hub_dashboard', 'view_hub_requests', 'view_parts_request', 'view_work_order'] },
  };

  let activeRolePreview = null;

  function applyRolePreview(presetId) {
    const preset = ROLE_PREVIEW_PRESETS[presetId];
    if (!preset) return null;
    activeRolePreview = presetId;
    syncPermissions(preset.permissions);
    if (global) global._rolePreviewActive = presetId;
    return preset;
  }

  function clearRolePreview() {
    activeRolePreview = null;
    if (global) global._rolePreviewActive = null;
  }

  function getActiveRolePreview() {
    return activeRolePreview;
  }

  function initRolePreviewFromUrl() {
    if (!isPortalNoAuthMode()) return null;
    try {
      const q = new URLSearchParams(global.location?.search || '');
      const id = q.get('rolePreview');
      if (!id) return null;
      return applyRolePreview(id);
    } catch {
      return null;
    }
  }

  function syncPermissions(perms) {
    cachedPermissions = normalizePerms(perms);
    if (global) global._portalPermissions = cachedPermissions.slice();
    return cachedPermissions;
  }

  function getPermissions() {
    if (cachedPermissions.length) return cachedPermissions.slice();
    if (Array.isArray(global._portalPermissions)) return global._portalPermissions.slice();
    if (typeof global.currentUserPermissions !== 'undefined' && Array.isArray(global.currentUserPermissions)) {
      return global.currentUserPermissions.slice();
    }
    return [];
  }

  function setElementVisible(el, visible) {
    if (!el) return;
    el.classList.toggle('rbac-hidden', !visible);
    if (!visible) {
      el.setAttribute('aria-hidden', 'true');
      el.setAttribute('tabindex', '-1');
    } else {
      el.removeAttribute('aria-hidden');
      el.removeAttribute('tabindex');
    }
  }

  function ruleAllows(perms, rule) {
    if (!rule) return true;
    if (rule.section) return canAccessMgmtSection(perms, rule.section);
    if (rule.any) return hasAnyPerm(perms, rule.any);
    if (rule.all) return rule.all.every((id) => hasPerm(perms, id));
    if (rule.perm) return hasPerm(perms, rule.perm);
    return true;
  }

  function applyNav(root, perms) {
    if (isPortalNoAuthMode()) {
      enablePortalNoAuthMode();
      revealAllNav(root);
      return cachedPermissions.slice();
    }
    const p = normalizePerms(perms.length ? perms : getPermissions());
    syncPermissions(p);

    root.querySelectorAll('[data-rbac-key]').forEach((el) => {
      const key = el.getAttribute('data-rbac-key');
      setElementVisible(el, ruleAllows(p, NAV_ITEM_RULES[key]));
    });

    root.querySelectorAll('[data-mgmt-section]').forEach((el) => {
      if (el.getAttribute('data-rbac-key')) return;
      const section = el.getAttribute('data-mgmt-section');
      if (!section) return;
      const tab = el.getAttribute('data-tab') || el.getAttribute('data-portal-tab');
      if (tab && tab !== 'management') return;
      setElementVisible(el, canAccessMgmtSection(p, section));
    });

    root.querySelectorAll('[data-rbac-any]').forEach((el) => {
      const raw = el.getAttribute('data-rbac-any') || '';
      const any = raw.split(',').map((s) => s.trim()).filter(Boolean);
      setElementVisible(el, hasAnyPerm(p, any));
    });

    const mgmtGroup = root.querySelector('[data-group="management"]');
    if (mgmtGroup) {
      const anyMgmtItem = mgmtGroup.querySelector('.tab-menu-item:not(.rbac-hidden)');
      setElementVisible(mgmtGroup, !!anyMgmtItem && canAccessManagement(p));
    }

    const hubAdminButtons = root.querySelectorAll(
      '#hubSidebarNav [data-rbac-key], #hubSidebarNav [data-mgmt-section], #hubSidebarNav [data-rbac-any]'
    );
    let hubAdminVisible = false;
    hubAdminButtons.forEach((btn) => {
      if (!btn.classList.contains('rbac-hidden')) hubAdminVisible = true;
    });
    root.querySelectorAll('#hubSidebarNav .hub-nav-group-label').forEach((label) => {
      if ((label.textContent || '').trim() === 'Admin') {
        setElementVisible(label, hubAdminVisible);
      }
    });

    return p;
  }

  function mgmtSectionFromRoute(parsed) {
    if (!parsed || parsed.tab !== 'management') return null;
    if (parsed.mgmtSection) return parsed.mgmtSection;
    const first = parsed.segments && parsed.segments[0];
    if (first === 'users' || first === 'permissions') return 'user';
    if (first === 'roles') return 'role';
    if (first === 'pssr') return 'pssr';
    if (first === 'sso') return 'sso';
    if (first === 'integrations') return 'integrations';
    return 'vendor';
  }

  const RbacClient = {
    MGMT_SECTION_PERMS,
    NAV_ITEM_RULES,
    HUB_TAB_RULES,
    ROLE_PREVIEW_PRESETS,
    isPortalNoAuthMode,
    enablePortalNoAuthMode,
    revealAllNav,
    syncPermissions,
    getPermissions,
    hasPerm,
    hasAnyPerm,
    canAccessMgmtSection,
    canAccessManagement,
    canAccessHubTab,
    canAccessTab,
    applyNav,
    mgmtSectionFromRoute,
    vendorUiChecks,
    evaluateVendorDetailUi,
    applyRolePreview,
    clearRolePreview,
    getActiveRolePreview,
    initRolePreviewFromUrl,
  };

  global.RbacClient = RbacClient;
})(typeof window !== 'undefined' ? window : global);
