/**
 * Portal general settings (hub_settings key portal:general).
 */
const DEFAULT_PORTAL_SETTINGS = {
  displayName: 'Streamline Operations Hub',
  defaultLandingPage: 'hub-dashboard',
  defaultRequesterRole: 'requester',
  // Explicit opt-in only — staging Cyber handoff keeps seed controls off by default.
  demoSeedEnabled: false,
};

const LANDING_PAGE_OPTIONS = [
  { value: 'hub-dashboard', label: 'Dashboard' },
  { value: 'hub-requests', label: 'Requests' },
  { value: 'hub-my-tasks', label: 'My tasks' },
  { value: 'hub-reports', label: 'Reports' },
  { value: 'hub-workflows', label: 'Workflow templates' },
];

const REQUESTER_ROLE_OPTIONS = [
  { value: 'requester', label: 'Requester' },
  { value: 'employee', label: 'Employee' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' },
];

function normalizePortalSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const landing = String(src.defaultLandingPage || DEFAULT_PORTAL_SETTINGS.defaultLandingPage);
  const role = String(src.defaultRequesterRole || DEFAULT_PORTAL_SETTINGS.defaultRequesterRole);
  return {
    displayName: String(src.displayName || DEFAULT_PORTAL_SETTINGS.displayName).slice(0, 120),
    defaultLandingPage: LANDING_PAGE_OPTIONS.some((o) => o.value === landing)
      ? landing
      : DEFAULT_PORTAL_SETTINGS.defaultLandingPage,
    defaultRequesterRole: REQUESTER_ROLE_OPTIONS.some((o) => o.value === role)
      ? role
      : DEFAULT_PORTAL_SETTINGS.defaultRequesterRole,
    demoSeedEnabled: src.demoSeedEnabled === true,
    updatedAt: src.updatedAt || null,
  };
}

function mergePortalSettings(current, patch) {
  const base = normalizePortalSettings(current);
  const next = { ...base };
  if (patch.displayName != null) next.displayName = String(patch.displayName).slice(0, 120);
  if (patch.defaultLandingPage != null) {
    const v = String(patch.defaultLandingPage);
    if (LANDING_PAGE_OPTIONS.some((o) => o.value === v)) next.defaultLandingPage = v;
  }
  if (patch.defaultRequesterRole != null) {
    const v = String(patch.defaultRequesterRole);
    if (REQUESTER_ROLE_OPTIONS.some((o) => o.value === v)) next.defaultRequesterRole = v;
  }
  if (patch.demoSeedEnabled != null) next.demoSeedEnabled = patch.demoSeedEnabled === true;
  return next;
}

module.exports = {
  DEFAULT_PORTAL_SETTINGS,
  LANDING_PAGE_OPTIONS,
  REQUESTER_ROLE_OPTIONS,
  normalizePortalSettings,
  mergePortalSettings,
};
