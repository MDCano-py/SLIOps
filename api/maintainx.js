// Primary API handler: proxies MaintainX, hub/vendor routes, auth, and
// object storage (Amazon S3) for photos and vendor documents.
//
// Endpoints:
//   GET  /api/maintainx?path=/locations
//   POST /api/maintainx?path=/workrequests   (JSON body — creates a work request)
//   POST /api/maintainx?path=/photo-upload   (binary body — uploads a photo to S3)
//   POST /api/maintainx?path=/photo-cleanup  (deletes photos older than 90 days; auth required)
//
// Required env vars (set in the Node process env on EC2 / local — never commit secrets):
//   MAINTAINX_API_KEY      — MaintainX bearer token (leave unset until ready; fails safely)
//   S3_BUCKET / S3_REGION  — private Amazon S3 bucket for uploads (prefer EC2 IAM role)
//
// Optional env vars:
//   MAINTAINX_ORG_ID       — required if using a multi-organization token
//   ALLOWED_ORIGIN         — restrict which origin can call this proxy
//   CLEANUP_SECRET         — shared secret to authorize the cleanup endpoint
//   SSO_ENFORCEMENT        — set to 'off' to disable the auth gate and
//                            proxy 401 enforcement without removing SAML
//                            config. Emergency lever if SSO breaks.
//                            Default (any other value or unset) = on.

const objectStorage = require('./lib/storage');
const { recordSecurityAudit } = require('./lib/security-audit');
const { createRedisClient } = require('../for-dev/redis-client');
const crypto = require('crypto');
const auth = require('./lib/auth.js');
const { handleHubRoute } = require('./lib/hub/routes.js');
const { mirrorArchiveToHub } = require('./lib/hub/bridge.js');
const { enrichVendorSummary, derivePipelineStage, deriveDeptStatuses, attachHybridFields } = require('./lib/vendor-hybrid-status.js');
const vendorStore = require('./lib/vendor/store.js');
const { buildVendorRecordFromBody } = require('./lib/vendor/record.js');
const {
  applyVendorWorkflowTransition,
  attachWorkflowFields,
  permissionsForWorkflowAction,
  getVendorActionRequired,
} = require('./lib/vendor/workflow.js');
const { notifyVendorWorkflowEvent, notifyAfterDocumentChange, queueVendorWorkflowNotification, buildVendorAssignedEmail } = require('./lib/vendor/notifications.js');
const {
  enrichVendorRecord,
  attachUploadedFile,
  updateDocumentStatus,
  permissionsForDocType,
  ensureDocumentMeta,
  isRequiredDocumentsComplete,
} = require('./lib/vendor/documents.js');
// SAML module is loaded lazily when /auth/* routes are hit, so a failure
// in the @node-saml/node-saml dependency (e.g. install issue, version
// mismatch) doesn't take down the whole proxy. The rest of the proxy
// only needs `auth` for cookie/session helpers, which have zero external
// deps. This is what kept the proxy working pre-SAML.
let _samlSp = null;
function loadSamlModule() {
  if (!_samlSp) _samlSp = require('./lib/saml.js');
  return _samlSp;
}

// Entra OIDC (MSAL) — lazy-loaded like SAML so missing @azure/msal-node
// does not break the proxy until auth routes are hit.
let _entraMod = null;
function loadEntraModule() {
  if (!_entraMod) _entraMod = require('./lib/entra.js');
  return _entraMod;
}

let _ssoHandlers = null;
function loadSsoHandlers() {
  if (!_ssoHandlers) {
    const { createSsoHandlers } = require('./lib/sso-routes.js');
    _ssoHandlers = createSsoHandlers(redis);
  }
  return _ssoHandlers;
}

const MAINTAINX_BASE = 'https://api.getmaintainx.com/v1';
const PHOTO_RETENTION_DAYS = 90;

// ---- Vendor / legacy KV storage ----
// WOS-44: Postgres vendor_master when HUB_STORE_MODE/VENDOR_STORE_MODE=postgres.
// Legacy: Upstash Redis keys vendor:{ref} + vendors:by-date (see api/lib/vendor/db/kv.js).
// WOS-84: lazy Proxy — module load must not initialize Redis (health/startup paths).
const redis = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = createRedisClient();
      const value = client[prop];
      return typeof value === 'function' ? value.bind(client) : value;
    },
  }
);

const vendorMutex = new Map();
async function withVendorLock(ref, fn) {
  const prev = vendorMutex.get(ref) || Promise.resolve();
  const next = prev.catch(() => {}).then(() => fn());
  vendorMutex.set(ref, next);
  try {
    return await next;
  } finally {
    if (vendorMutex.get(ref) === next) vendorMutex.delete(ref);
  }
}

async function readVendorRecord(ref) {
  return vendorStore.readVendorRecord(ref);
}

async function writeVendorRecord(ref, record) {
  return vendorStore.writeVendorRecord(ref, record);
}

async function getAllVendorRecords() {
  return vendorStore.getAllVendorRecords();
}

async function hydrateVendorForApi(v, ref, opts = {}) {
  if (!v) return v;
  enrichVendorRecord(v);
  if (opts.loadDocuments !== false && ref) {
    v.documents = await listVendorDocuments(ref);
  }
  v.overallStatus = deriveOverallStatus(v);
  attachHybridFields(v, v.overallStatus);
  attachWorkflowFields(v);
  return v;
}

// List vendor documents from private object storage (S3). Metadata stays in KV/Postgres.
async function listVendorDocuments(ref) {
  if (!objectStorage.isConfigured()) {
    if (objectStorage.getStorageConfig().deployed) {
      const err = new Error('Object storage not configured');
      err.code = 'STORAGE_NOT_CONFIGURED';
      err.statusCode = 503;
      throw err;
    }
    // Local/dev without storage: empty list (no silent S3/Vercel fallback).
    return [];
  }
  const objects = await objectStorage.listObjects({ prefix: `vendor-docs/${ref}/` });
  return objects
    .map((obj) => {
      const parsed = objectStorage.parseVendorObjectKey(obj.key, {
        size: obj.size,
        lastModified: obj.lastModified,
      });
      if (!parsed) return null;
      return {
        filename: parsed.filename,
        kind: parsed.kind,
        key: parsed.key,
        url: null,
        downloadKey: parsed.key,
        uploadedAt: parsed.uploadedAt,
        size: parsed.size || 0,
        storage_provider: objectStorage.getStorageConfig().driver === 'local' ? 'local' : 's3',
      };
    })
    .filter(Boolean);
}

function respondStorageError(res, err, fallbackMessage) {
  const status = err.statusCode || (err.code === 'STORAGE_NOT_CONFIGURED' ? 503 : 500);
  const code = err.code || (err.name === 'StorageValidationError' ? err.code : undefined);
  if (err.name === 'StorageValidationError' || err.code === 'INVALID_UPLOAD' || err.code === 'TOO_LARGE' || err.code === 'INVALID_KEY' || err.code === 'KEY_ISOLATION') {
    return res.status(err.statusCode || 400).json({ error: err.message, code: err.code || 'INVALID_UPLOAD' });
  }
  console.error('[storage]', fallbackMessage || err.message, err.code || err.name);
  return res.status(status).json({
    error: status === 503 ? 'Object storage not configured' : fallbackMessage || 'Storage operation failed',
    code: code || (status === 503 ? 'STORAGE_NOT_CONFIGURED' : 'STORAGE_ERROR'),
  });
}

// Map a Content-Type to a sensible file extension. Used as a fallback when a
// document object's filename in storage somehow lost its extension — without
// this the OS can't tell what kind of file it is and may try to open with the
// wrong app (often defaulting to a browser, making the file look like HTML).
function extensionFromContentType(ct) {
  if (!ct) return '';
  const t = ct.split(';')[0].trim().toLowerCase();
  const map = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/heic': '.heic',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/zip': '.zip',
    'text/plain': '.txt',
    'text/csv': '.csv',
    'application/json': '.json',
  };
  return map[t] || '';
}

// ---- Vendor auth helpers ----
// Session tokens are HMAC-signed strings of the form: "{exp_ms}.{hmac}"
// where exp_ms is the unix-ms expiry. Server verifies signature on every
// protected request, no DB lookup needed.
const VENDOR_SESSION_HOURS = 12; // upper bound; client can pick session-only

function sessionSecret() {
  // Derived from the passcode itself — guarantees a fresh secret if the
  // passcode changes, with no extra env vars to manage.
  const base = process.env.VENDOR_ACCESS_CODE || '';
  return crypto.createHash('sha256').update('vendor-session::' + base).digest();
}

function issueVendorToken(durationMs) {
  const exp = Date.now() + durationMs;
  const sig = crypto.createHmac('sha256', sessionSecret()).update(String(exp)).digest('hex').slice(0, 32);
  return `${exp}.${sig}`;
}

function verifyVendorToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const exp = parseInt(parts[0], 10);
  if (!exp || exp < Date.now()) return false;
  const expectSig = crypto.createHmac('sha256', sessionSecret()).update(String(exp)).digest('hex').slice(0, 32);
  // Constant-time comparison to avoid timing leaks
  try {
    return crypto.timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expectSig));
  } catch {
    return false;
  }
}

function requireVendorAuth(req, res) {
  if (!process.env.VENDOR_ACCESS_CODE) {
    res.status(500).json({ error: 'Server misconfigured: VENDOR_ACCESS_CODE not set' });
    return false;
  }
  const token = req.headers['x-vendor-session'] || '';
  if (!verifyVendorToken(token)) {
    res.status(401).json({ error: 'Vendor session required or expired' });
    return false;
  }
  return true;
}

function hasAnyPermission(userPerms, needed) {
  if (!Array.isArray(userPerms)) return false;
  if (userPerms.includes('admin') || userPerms.includes('hub_admin')) return true;
  return (needed || []).some((p) => userPerms.includes(p));
}

async function requirePermissions(req, res, neededPerms) {
  if (isPortalAuthRelaxed(req)) {
    const actorEmail = auth.getActorEmail(req) || getDemoActorEmail();
    return { actorEmail, permissions: ALL_PERMISSION_IDS.slice() };
  }
  const actorEmail = auth.getActorEmail(req);
  if (!actorEmail) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }
  const rec = await getUserPermissions(actorEmail);
  const perms = rec?.permissions || [];
  if (!hasAnyPermission(perms, neededPerms)) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return { actorEmail, permissions: perms };
}

// WOS-80 — resolve the authenticated actor + permissions for legacy routes
// (JSA/BOL/SWP archive, /request-archive/*, /forms/*). Honors the local/dev
// relaxed bypass (returns full admin), but returns a null actor when there is
// no session so callers can reply 401. Staging/production also enforce a
// session upstream at the SSO gate; this is defense-in-depth + correct
// authorization even under the dev relaxed path.
async function resolveActor(req) {
  if (isPortalAuthRelaxed(req)) {
    const email = auth.getActorEmail(req) || getDemoActorEmail();
    return { actorEmail: email, permissions: ALL_PERMISSION_IDS.slice(), isAdmin: true, relaxed: true };
  }
  const actorEmail = auth.getActorEmail(req);
  if (!actorEmail) return { actorEmail: null, permissions: [], isAdmin: false, relaxed: false };
  let permissions = [];
  try {
    const rec = await getUserPermissions(actorEmail);
    permissions = Array.isArray(rec) ? rec : rec?.permissions || [];
  } catch {
    permissions = EMPLOYEE_PRESET_PERMISSIONS.slice();
  }
  const isAdmin = permissions.includes('admin') || permissions.includes('hub_admin');
  return { actorEmail, permissions, isAdmin, relaxed: false };
}

// MaintainX paths the proxy is allowed to forward to
const MAINTAINX_ALLOWED_PATHS = [
  /^\/locations(\?.*)?$/,
  /^\/assets(\?.*)?$/,
  /^\/teams(\?.*)?$/,
  /^\/categories(\?.*)?$/,
  /^\/workrequests(\?.*)?$/,
  /^\/workorders(\?.*)?$/,
  /^\/workorders\/\d+(\?.*)?$/,
  /^\/workorders\/\d+\/attachments\/[^/]+(\?.*)?$/,
];

function isMaintainxPath(path) {
  return MAINTAINX_ALLOWED_PATHS.some((re) => re.test(path));
}

// ---- Transactional email via Resend ----
// Sends an email if RESEND_API_KEY is set. Failures are logged but never thrown
// — email is fire-and-forget; vendor records are still created if email fails.
async function sendEmail({ to, subject, html, text }) {
  if (!process.env.RESEND_API_KEY) {
    console.log('[email] Skipped (RESEND_API_KEY not set):', subject, '→', to);
    return { skipped: true };
  }
  if (!to) {
    console.log('[email] Skipped (no recipient):', subject);
    return { skipped: true };
  }
  const from = process.env.VENDOR_NOTIFY_FROM || 'Streamline Portal <onboarding@resend.dev>';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        html: html || undefined,
        text: text || undefined,
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.error('[email] Resend error:', res.status, err);
      return { ok: false, status: res.status };
    }
    const data = await res.json();
    console.log('[email] Sent:', subject, '→', to, '(id:', data.id + ')');
    return { ok: true, id: data.id };
  } catch (err) {
    console.error('[email] Send failed:', err.message);
    return { ok: false, error: err.message };
  }
}

// Email templates — kept simple. Real HTML rendering with logos/styling
// can come later; for now plain readable HTML works.
function emailVendorCreated(record) {
  const portalUrl = process.env.PORTAL_BASE_URL || '';
  const physical = record.physicalAddress || {};
  const billing  = record.billingAddress || {};
  const ap       = record.apContact || {};
  const fmtAddr = a => a && a.street ? `${a.street}, ${a.city || ''}, ${a.state || ''} ${a.zip || ''}` : '—';
  const billingLine = billing.sameAsPhysical
    ? '<em>Same as physical</em>'
    : (billing.street ? fmtAddr(billing) : '—');
  const html = `
    <h2>New Vendor Request</h2>
    <p>A new vendor request has been submitted and is awaiting your review.</p>
    <table cellpadding="6" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;">
      <tr><td><strong>Reference:</strong></td><td>${record.refNumber}</td></tr>
      <tr><td><strong>Company:</strong></td><td>${record.companyName || '—'}</td></tr>
      <tr><td><strong>Contact / Title:</strong></td><td>${record.contactName || '—'}</td></tr>
      <tr><td><strong>Contact Email:</strong></td><td>${record.contactEmail || '—'}</td></tr>
      <tr><td><strong>Contact Phone:</strong></td><td>${record.contactPhone || '—'}</td></tr>
      <tr><td><strong>Physical Address:</strong></td><td>${fmtAddr(physical)}</td></tr>
      <tr><td><strong>Billing Address:</strong></td><td>${billingLine}</td></tr>
      <tr><td><strong>A/P Contact:</strong></td><td>${ap.name || '—'} ${ap.email ? '(' + ap.email + ')' : ''} ${ap.phone || ''}</td></tr>
      <tr><td><strong>Tax ID:</strong></td><td>${record.taxId || '—'}</td></tr>
      <tr><td><strong>PO Required:</strong></td><td>${record.poRequired || '—'}</td></tr>
      <tr><td><strong>Tax Exempt:</strong></td><td>${record.stateTaxExempt || '—'}</td></tr>
      <tr><td><strong>Veriforce:</strong></td><td>${record.veriforceAccount || '—'}${record.ssqId ? ' (SSQ ' + record.ssqId + ')' : ''}</td></tr>
      <tr><td><strong>Requested Credit Limit:</strong></td><td>${
        typeof record.requestedCreditLimit === 'number'
          ? '$' + record.requestedCreditLimit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : '—'
      }${record.creditNotes ? ' — ' + record.creditNotes : ''}</td></tr>
      <tr><td><strong>Scope:</strong></td><td>${record.serviceDescription || '—'}</td></tr>
      <tr><td><strong>MSA / NDA:</strong></td><td>${record.msaRequired ? 'MSA' : ''}${record.msaRequired && record.ndaRequired ? ', ' : ''}${record.ndaRequired ? 'NDA' : ''}${!record.msaRequired && !record.ndaRequired ? 'Neither' : ''}</td></tr>
      <tr><td><strong>Requested by:</strong></td><td>${record.requestedBy || '—'}</td></tr>
    </table>
    <p style="margin-top:20px;">
      <a href="${portalUrl}" style="background:#2a9499;color:white;padding:10px 18px;text-decoration:none;border-radius:6px;display:inline-block;">Open Portal</a>
    </p>
    <p style="color:#888;font-size:12px;">Streamline Operations Portal · Vendor Management</p>
  `;
  const text = `New Vendor Request\n\nRef: ${record.refNumber}\nCompany: ${record.companyName}\nContact: ${record.contactName} (${record.contactEmail})\nA/P: ${ap.name} (${ap.email})\nTax ID: ${record.taxId}\nRequested by: ${record.requestedBy}\n\nOpen the portal: ${portalUrl}`;
  return { html, text };
}

// Email when a vendor is reassigned (e.g., Administration → AP, AP → Legal).
// `who` is the role being notified ('ap', 'dylan', 'rebekah').
function emailVendorAssigned(record, who, byActor, note) {
  const portalUrl = process.env.PORTAL_BASE_URL || '';
  const roleLabel = { ap: 'Accounts Payable', dylan: 'Legal / Executive', rebekah: 'Administration' }[who] || who;
  const html = `
    <h2>Vendor Request Assigned to You</h2>
    <p><strong>${record.companyName || record.refNumber}</strong> needs your attention as <strong>${roleLabel}</strong>.</p>
    <table cellpadding="6" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;">
      <tr><td><strong>Reference:</strong></td><td>${record.refNumber}</td></tr>
      <tr><td><strong>Company:</strong></td><td>${record.companyName || '—'}</td></tr>
      <tr><td><strong>Contact:</strong></td><td>${record.contactName || '—'} ${record.contactEmail ? '(' + record.contactEmail + ')' : ''}</td></tr>
      <tr><td><strong>Reassigned by:</strong></td><td>${byActor || 'unknown'}</td></tr>
      ${note ? `<tr><td><strong>Note:</strong></td><td>${note}</td></tr>` : ''}
    </table>
    <p style="margin-top:20px;">
      <a href="${portalUrl}" style="background:#2a9499;color:white;padding:10px 18px;text-decoration:none;border-radius:6px;display:inline-block;">Open Portal</a>
    </p>
    <p style="color:#888;font-size:12px;">Streamline Operations Portal · Vendor Management</p>
  `;
  const text = `Vendor Request Assigned: ${record.refNumber}\n\nCompany: ${record.companyName}\nReassigned by: ${byActor}\n${note ? '\nNote: ' + note : ''}\n\nOpen the portal: ${portalUrl}`;
  return { html, text };
}

// Recipient lookup by role. New env var names take priority; old names kept
// as fallback so existing Vercel configs keep working without an update.
function vendorNotifyEmail(role) {
  const map = {
    rebekah: process.env.VENDOR_NOTIFY_EMAIL_ADMIN || process.env.VENDOR_NOTIFY_EMAIL_REBEKAH,
    ap:      process.env.VENDOR_NOTIFY_EMAIL_AP,
    dylan:   process.env.VENDOR_NOTIFY_EMAIL_LEGAL || process.env.VENDOR_NOTIFY_EMAIL_DYLAN,
  };
  return map[role] || null;
}

function deriveOverallStatus(v) {
  if (!v) return 'unknown';
  const explicit = v.overallStatus;
  if (explicit === 'pending_rebekah_review') return 'pending_rebekah';
  if (explicit === 'pending_ap_setup') return 'pending_ap';
  if (explicit === 'pending_contract_review' || explicit === 'pending_dylan_review') return 'pending_contract';
  if (explicit === 'complete') return 'complete';
  if (explicit === 'rejected' || explicit === 'cancelled') return 'rejected';
  const apDone = v.apStatus === 'complete';
  const contractDone = v.contractStatus === 'complete' || v.contractStatus === 'not_required';
  if (apDone && contractDone) return 'complete';
  if (v.assignedTo === 'rebekah' && v.apStatus === 'not_started') return 'pending_rebekah';
  if (v.assignedTo === 'ap' || v.apStatus === 'in_progress') return 'pending_ap';
  if (v.assignedTo === 'dylan' || v.contractStatus === 'in_progress' || v.contractStatus === 'legal_review') return 'pending_contract';
  return 'in_progress';
}

// ---- Display name helpers ----
// Title-case a name fragment. Handles common forms:
//   "james.alexander"   → "James Alexander"
//   "james_alexander"   → "James Alexander"
//   "james-alexander"   → "James Alexander"
//   "james alexander"   → "James Alexander"
//   "JAMES"             → "James"
//   "James"             → "James"  (no-op for already-cased)
function titleCaseName(s) {
  if (!s || typeof s !== 'string') return '';
  return s
    .replace(/[._-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map(w => w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : '')
    .join(' ');
}

// Build a display name from whatever identity bits we have. Prefers
// real first/last name claims; falls back to title-cased email
// local-part so the user menu / forms never show "james.alexander".
function buildDisplayName({ firstName, lastName, email }) {
  if (firstName && lastName) return `${titleCaseName(firstName)} ${titleCaseName(lastName)}`;
  if (firstName)             return titleCaseName(firstName);
  if (lastName)              return titleCaseName(lastName);
  if (email) {
    const local = String(email).split('@')[0];
    return titleCaseName(local);
  }
  return '';
}

// ---- Permission catalog (single source of truth) ----
// Used by the User Permissions tab to render checkboxes, and (later, when SSO
// is wired) by middleware to enforce access. Adding a new permission is a
// matter of adding an entry here.
const PERMISSION_CATALOG = [
  { group: 'Operations Hub',   id: 'view_hub_dashboard',       label: 'View Operations Dashboard' },
  { group: 'Operations Hub',   id: 'view_hub_requests',        label: 'View Request Hub' },
  { group: 'Operations Hub',   id: 'view_hub_reports',         label: 'View Hub Reports' },
  { group: 'Operations Hub',   id: 'hub_admin',                label: 'Hub Admin (all requests, visibility, retries)' },
  { group: 'Tab Access',         id: 'view_home',                label: 'View Home' },
  { group: 'Tab Access',         id: 'view_parts_request',       label: 'View Parts Request' },
  { group: 'Tab Access',         id: 'view_work_order',          label: 'View Work Order Request' },
  { group: 'Tab Access',         id: 'view_bol_generator',       label: 'View BOL Generator' },
  { group: 'Tab Access',         id: 'view_jsa_generator',       label: 'View JSA Generator' },
  { group: 'Tab Access',         id: 'view_forms',               label: 'View Forms Section' },
  { group: 'Tab Access',         id: 'view_jsa_archive',         label: 'View JSA Archive' },
  { group: 'Tab Access',         id: 'view_bol_archive',         label: 'View BOL Archive' },
  { group: 'Tab Access',         id: 'view_parts_request_archive', label: 'View Parts Request Archive' },
  { group: 'Tab Access',         id: 'view_work_order_archive',  label: 'View Work Order Request Archive' },
  { group: 'Tab Access',         id: 'view_roll_off_swap_archive', label: 'View Roll Off Swap Archive' },
  { group: 'Tab Access',         id: 'view_management',          label: 'View Management Section' },

  { group: 'Management',         id: 'view_vendor_list',         label: 'View Vendor List' },
  { group: 'Management',         id: 'view_vendor_dashboard',    label: 'View Vendor Dashboard' },
  { group: 'Management',         id: 'submit_new_vendor',        label: 'Submit New Vendor Requests' },
  { group: 'Management',         id: 'view_vendor_documents',    label: 'View / Download Vendor Documents' },
  { group: 'Management',         id: 'view_user_permissions',    label: 'View User Permissions Tab' },

  { group: 'Vendor Editing',     id: 'edit_vendor_info',         label: 'Edit Vendor Information (company, contacts, A/P, scope)' },
  { group: 'Vendor Editing',     id: 'edit_vendor_workflow',     label: 'Edit Workflow (AP Status, Contract Status, Assigned To)' },
  { group: 'Vendor Editing',     id: 'edit_vendor_compliance',   label: 'Edit Compliance (W-9, Banking, Insurance Status)' },
  { group: 'Vendor Editing',     id: 'manage_vendor_documents',  label: 'Upload / Delete Vendor Documents' },

  { group: 'Archive Deletion',   id: 'delete_jsa_archive',       label: 'Delete Any JSA Archive Record (override 24h rule)' },
  { group: 'Archive Deletion',   id: 'delete_bol_archive',       label: 'Delete Any BOL Archive Record (override 24h rule)' },

  { group: 'Admin',              id: 'admin',                    label: 'Manage User Permissions' },

  { group: 'Configuration',      id: 'configuration.view',       label: 'View Configuration Center' },
  { group: 'Configuration',      id: 'configuration.edit',       label: 'Edit configuration drafts' },
  { group: 'Configuration',      id: 'configuration.publish',    label: 'Publish configuration versions' },
  { group: 'Configuration',      id: 'configuration.archive',    label: 'Archive configuration definitions' },
  { group: 'Configuration',      id: 'workflow.execute',         label: 'Execute configurable workflows' },
  { group: 'Configuration',      id: 'workflow.manage',          label: 'Manage workflow definitions' },
  { group: 'Configuration',      id: 'form.manage',              label: 'Manage form definitions' },
  { group: 'Configuration',      id: 'document.manage',          label: 'Manage document templates' },
  { group: 'Configuration',      id: 'dashboard.manage',         label: 'Manage dashboard definitions' },
  { group: 'Configuration',      id: 'variable.manage',          label: 'Manage custom variables' },
];

const ALL_PERMISSION_IDS = PERMISSION_CATALOG.map(p => p.id);

// "Employee" preset — used as a fallback when KV is unreachable for SSO
// auto-provisioning. The live Employee role lives in KV under role:employee
// and is what's actually applied; this constant is just a safety net so a
// brief KV outage doesn't prevent new users from being onboarded.
//
// The full set of built-in roles is defined in BUILT_IN_ROLES below — that's
// the source of truth for first-time seeding.
const EMPLOYEE_PRESET_PERMISSIONS = [
  'view_home',
  'view_hub_dashboard',
  'view_hub_requests',
  'view_hub_reports',
  'view_parts_request',
  'view_work_order',
  'view_bol_generator',
  'view_jsa_generator',
  'view_forms',
  'view_jsa_archive',
  'view_bol_archive',
  'view_parts_request_archive',
  'view_work_order_archive',
  'view_roll_off_swap_archive',
];

// ============================================================
// Role definitions (User Groups)
// ============================================================
// Roles live in KV (role:{id}) so admins can edit them via Role Management.
// On first access (when roles:index is empty), we seed these four built-ins.
//
// `isProtected: true` means the role can't be deleted — only edited. This
// applies to the Employee role (referenced by SSO auto-provisioning) and
// the three other system roles by default. Admins can flip protection off
// on the non-Employee ones if they want to delete them later.
const BUILT_IN_ROLES = [
  {
    id: 'employee',
    name: 'Employee',
    description: 'Front-line submitter. Can use the request/generator/forms tabs and view their submitted records. No Management access.',
    permissions: [
      'view_home',
      'view_hub_dashboard',
      'view_hub_requests',
      'view_hub_reports',
      'view_parts_request',
      'view_work_order',
      'view_bol_generator',
      'view_jsa_generator',
      'view_forms',
      'view_jsa_archive',
      'view_bol_archive',
      'view_parts_request_archive',
      'view_work_order_archive',
      'view_roll_off_swap_archive',
    ],
    isProtected: true,
    isUndeletable: true,    // strongest protection — never deletable
  },
  {
    id: 'requester',
    name: 'Requester',
    description: 'Employee + can submit new vendor requests. Can see Management tab but cannot view vendor documents or edit vendor info.',
    permissions: [
      'view_home',
      'view_hub_dashboard',
      'view_hub_requests',
      'view_hub_reports',
      'view_parts_request',
      'view_work_order',
      'view_bol_generator',
      'view_jsa_generator',
      'view_forms',
      'view_jsa_archive',
      'view_bol_archive',
      'view_parts_request_archive',
      'view_work_order_archive',
      'view_roll_off_swap_archive',
      'view_management',
      'submit_new_vendor',
    ],
    isProtected: true,
    isUndeletable: false,
  },
  {
    id: 'accounts_payable',
    name: 'Accounts Payable',
    description: 'All viewing permissions + all vendor edit/document permissions. Can manage vendor records (workflow, compliance, banking, contacts, documents). No archive deletion or user admin.',
    permissions: [
      'view_home',
      'view_parts_request',
      'view_work_order',
      'view_bol_generator',
      'view_jsa_generator',
      'view_forms',
      'view_jsa_archive',
      'view_bol_archive',
      'view_parts_request_archive',
      'view_work_order_archive',
      'view_roll_off_swap_archive',
      'view_management',
      'view_vendor_list',
      'view_vendor_dashboard',
      'view_vendor_documents',
      'submit_new_vendor',
      'edit_vendor_info',
      'edit_vendor_workflow',
      'edit_vendor_compliance',
      'manage_vendor_documents',
    ],
    isProtected: true,
    isUndeletable: false,
  },
  {
    id: 'management',
    name: 'Management',
    description: 'Everything EXCEPT edit_vendor_info and edit_vendor_workflow. Can view and submit vendor work, manage compliance/documents, delete archive records, and manage user permissions.',
    permissions: [
      'view_home',
      'view_hub_dashboard',
      'view_hub_requests',
      'view_hub_reports',
      'hub_admin',
      'view_parts_request',
      'view_work_order',
      'view_bol_generator',
      'view_jsa_generator',
      'view_forms',
      'view_jsa_archive',
      'view_bol_archive',
      'view_parts_request_archive',
      'view_work_order_archive',
      'view_roll_off_swap_archive',
      'view_management',
      'view_vendor_list',
      'view_vendor_dashboard',
      'view_vendor_documents',
      'view_user_permissions',
      'submit_new_vendor',
      'edit_vendor_compliance',
      'manage_vendor_documents',
      'delete_jsa_archive',
      'delete_bol_archive',
      'admin',
    ],
    isProtected: true,
    isUndeletable: false,
  },
];

// Get all roles. On first call (when roles:index is empty), seed built-ins.
async function getAllRoles() {
  let ids = await redis.smembers('roles:index');
  if (!ids || ids.length === 0) {
    // First-time seed — write all built-ins
    await seedBuiltInRoles();
    ids = await redis.smembers('roles:index');
  }
  if (!ids || ids.length === 0) return [];
  const keys = ids.map(id => `role:${id}`);
  const values = await redis.mget(...keys);
  const roles = values
    .map(v => v ? (typeof v === 'string' ? JSON.parse(v) : v) : null)
    .filter(Boolean);
  // Stable sort: built-ins first (in their canonical order), custom roles after by created date
  const builtInOrder = BUILT_IN_ROLES.map(r => r.id);
  roles.sort((a, b) => {
    const aIdx = builtInOrder.indexOf(a.id);
    const bIdx = builtInOrder.indexOf(b.id);
    if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
    if (aIdx >= 0) return -1;
    if (bIdx >= 0) return 1;
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });
  return roles;
}

async function getRole(id) {
  if (!id) return null;
  const raw = await redis.get(`role:${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

// Seed built-in roles on first run. Idempotent — only writes roles that
// don't already exist (so editing a built-in role doesn't get reverted).
async function seedBuiltInRoles() {
  const now = new Date().toISOString();
  const p = redis.pipeline();
  for (const r of BUILT_IN_ROLES) {
    const existing = await redis.get(`role:${r.id}`);
    if (existing) continue;
    const record = {
      ...r,
      createdAt: now,
      updatedAt: now,
      createdBy: 'system:built-in',
      updatedBy: 'system:built-in',
    };
    p.set(`role:${r.id}`, JSON.stringify(record));
    p.sadd('roles:index', r.id);
  }
  await p.exec();
}

// Build a stable, slug-style ID from a display name. Used when creating new
// custom roles. Falls back to a random suffix if collision.
async function generateRoleId(name) {
  const base = String(name || 'role')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40)
    || 'role';
  // Check for collision; append a random suffix if needed
  const existing = await redis.get(`role:${base}`);
  if (!existing) return base;
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base}_${suffix}`;
}

// Save a role record. Used for both create (isNew=true) and update.
async function saveRole(role, actor) {
  const now = new Date().toISOString();
  const id = role.id;
  const existing = await getRole(id);

  // Only allow known permission IDs
  const cleanPerms = (role.permissions || []).filter(p => ALL_PERMISSION_IDS.includes(p));

  const record = {
    id,
    name: role.name || existing?.name || id,
    description: role.description || existing?.description || '',
    permissions: cleanPerms,
    // Protection flags can be edited but isUndeletable stays put for the Employee role
    isProtected: typeof role.isProtected === 'boolean' ? role.isProtected : (existing?.isProtected || false),
    isUndeletable: existing?.isUndeletable || false,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    createdBy: existing?.createdBy || actor || 'unknown',
    updatedBy: actor || 'unknown',
  };

  const p = redis.pipeline();
  p.set(`role:${id}`, JSON.stringify(record));
  p.sadd('roles:index', id);
  await p.exec();
  return record;
}

async function deleteRole(id, actorEmail) {
  const role = await getRole(id);
  if (!role) return { deleted: false, reason: 'not_found' };
  // Bootstrap admins can override the isUndeletable flag — they're the only
  // ones with enough authority to remove a role that the system depends on.
  // (If they delete the Employee role, the next /me call will re-seed it
  // automatically since seedBuiltInRoles is idempotent on the index.)
  if (role.isUndeletable && !isBootstrapAdmin(actorEmail)) {
    return { deleted: false, reason: 'undeletable' };
  }
  const p = redis.pipeline();
  p.del(`role:${id}`);
  p.srem('roles:index', id);
  await p.exec();
  return { deleted: true };
}

// Look up the Employee role's permissions for SSO auto-provisioning.
// Falls back to the hardcoded constant if KV is unreachable.
async function getEmployeeRolePermissions() {
  try {
    const role = await getRole('employee');
    if (role && Array.isArray(role.permissions) && role.permissions.length > 0) {
      return role.permissions;
    }
  } catch (err) {
    console.warn('Could not read employee role from KV:', err.message);
  }
  return EMPLOYEE_PRESET_PERMISSIONS;
}

// Bootstrap admins are always treated as having every permission, even if KV
// is empty. Prevents lockout if the user record gets corrupted or deleted.
function getBootstrapAdmins() {
  const raw = process.env.BOOTSTRAP_ADMIN_EMAILS || '';
  return raw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

function isBootstrapAdmin(email) {
  if (!email) return false;
  return getBootstrapAdmins().includes(email.toLowerCase());
}

// Read a user's permissions. Bootstrap admins always get all permissions
// regardless of what's in KV. Staging test users fall back to PostgreSQL.
async function getUserPermissions(email) {
  if (!email) return null;
  const normalized = email.toLowerCase();
  if (isBootstrapAdmin(normalized)) {
    return {
      email: normalized,
      permissions: ALL_PERMISSION_IDS.slice(),
      bootstrap: true,
      firstSeen: null,
      lastSeen: null,
      addedBy: 'bootstrap',
    };
  }
  const raw = await redis.get(`user:${normalized}`);
  if (raw) {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }
  // WOS-85 — PostgreSQL SoR for seeded staging test users when KV is empty.
  try {
    const stagingUsers = require('./lib/staging-test-users');
    if (stagingUsers.isAllowlistedEmail(normalized)) {
      const pgUser = await stagingUsers.loadActiveTestUserByEmail(normalized);
      if (pgUser) {
        return {
          email: pgUser.email,
          permissions: pgUser.permissions,
          displayName: pgUser.displayName,
          role: pgUser.primaryRole,
          staging_test_user: true,
          firstSeen: null,
          lastSeen: null,
          addedBy: 'staging-test-pg',
        };
      }
    }
  } catch {
    /* PG optional for non-staging */
  }
  return null;
}

// Write a user's permissions. `actor` is the email of who's making the change
// (for audit). Returns the updated record.
async function setUserPermissions(email, permissions, actor, isNewUser) {
  const normalized = (email || '').toLowerCase();
  if (!normalized) throw new Error('Email required');
  // Filter to known permissions only — drops anything stale or invalid
  const validPerms = (permissions || []).filter(p => ALL_PERMISSION_IDS.includes(p));
  // Read existing to preserve firstSeen and other metadata
  const existing = await redis.get(`user:${normalized}`);
  const parsed = existing ? (typeof existing === 'string' ? JSON.parse(existing) : existing) : null;
  const now = new Date().toISOString();
  const record = {
    email: normalized,
    permissions: validPerms,
    firstSeen: parsed?.firstSeen || now,
    lastSeen: parsed?.lastSeen || null,
    addedBy: parsed?.addedBy || actor || 'unknown',
    updatedAt: now,
    updatedBy: actor || 'unknown',
  };
  // Pipeline: write user, add to index, append audit
  const p = redis.pipeline();
  p.set(`user:${normalized}`, JSON.stringify(record));
  p.sadd('users:index', normalized);
  p.lpush('users:audit', JSON.stringify({
    at: now,
    by: actor || 'unknown',
    target: normalized,
    action: isNewUser ? 'user_created' : 'permissions_updated',
    permissions: validPerms,
    previousPermissions: parsed?.permissions || [],
  }));
  // Cap audit log at 500 entries
  p.ltrim('users:audit', 0, 499);
  await p.exec();
  return record;
}

// Delete a user record entirely. Bootstrap admins cannot be removed this way.
async function deleteUserRecord(email, actor) {
  const normalized = (email || '').toLowerCase();
  if (!normalized) throw new Error('Email required');
  if (isBootstrapAdmin(normalized)) {
    throw new Error('Cannot remove a bootstrap admin');
  }
  const now = new Date().toISOString();
  const p = redis.pipeline();
  p.del(`user:${normalized}`);
  p.srem('users:index', normalized);
  p.lpush('users:audit', JSON.stringify({
    at: now,
    by: actor || 'unknown',
    target: normalized,
    action: 'user_removed',
  }));
  p.ltrim('users:audit', 0, 499);
  await p.exec();
}

// List all users (bootstrap admins + KV users), each with full permissions
// metadata. Bootstrap admins always appear at the top, marked.
async function listAllUsers() {
  const bootstrapEmails = getBootstrapAdmins();
  const kvEmails = await redis.smembers('users:index') || [];

  // Build a unique set, bootstrap first
  const seen = new Set();
  const ordered = [];
  for (const e of bootstrapEmails) {
    if (!seen.has(e)) { ordered.push(e); seen.add(e); }
  }
  for (const e of kvEmails) {
    const lower = e.toLowerCase();
    if (!seen.has(lower)) { ordered.push(lower); seen.add(lower); }
  }

  if (ordered.length === 0) return [];

  // Fetch all in one mget (skips bootstrap admins which aren't in KV)
  const kvKeys = ordered.filter(e => !isBootstrapAdmin(e)).map(e => `user:${e}`);
  const kvValues = kvKeys.length ? await redis.mget(...kvKeys) : [];
  const kvMap = new Map();
  kvKeys.forEach((k, i) => {
    const v = kvValues[i];
    if (v) {
      const parsed = typeof v === 'string' ? JSON.parse(v) : v;
      kvMap.set(k, parsed);
    }
  });

  return ordered.map(email => {
    if (isBootstrapAdmin(email)) {
      return {
        email,
        permissions: ALL_PERMISSION_IDS.slice(),
        bootstrap: true,
        firstSeen: null,
        lastSeen: null,
      };
    }
    return kvMap.get(`user:${email}`) || { email, permissions: [], firstSeen: null, lastSeen: null };
  });
}

async function getPermissionsAuditLog(limit = 100) {
  const entries = await redis.lrange('users:audit', 0, Math.max(0, limit - 1));
  return entries.map(e => typeof e === 'string' ? JSON.parse(e) : e);
}

// ============================================================
// ===== Request Archive (Parts Request + Work Order) =========
// ============================================================
// Tracks every Parts Request and Work Order Request submitted through the
// portal. Records are written at the moment of submission (after MaintainX
// confirms work-order creation) and never deleted from the portal — they are
// an audit trail of what was requested. Status is fetched live from MaintainX
// when a record is opened, so it reflects current reality even if the record
// is months old.
//
// KV schema:
//   parts_request:{ts}-{nonce}  → JSON record
//   parts_requests:by-date      → sorted set, score = createdAt unix-ms
//   work_order:{ts}-{nonce}     → JSON record
//   work_orders:by-date         → sorted set, score = createdAt unix-ms

// Resolve a kind code to its KV key prefixes.
//   'parts'         → Parts Request archive
//   'wo'            → Work Order Request archive
//   'roll-off-swap' → Roll Off Swap form archive (under /forms)
function archiveKindKeys(kind) {
  if (kind === 'parts') {
    return { recordPrefix: 'parts_request', indexKey: 'parts_requests:by-date' };
  }
  if (kind === 'wo') {
    return { recordPrefix: 'work_order', indexKey: 'work_orders:by-date' };
  }
  if (kind === 'roll-off-swap') {
    return { recordPrefix: 'roll_off_swap', indexKey: 'roll_off_swap:by-date' };
  }
  throw new Error(`Unknown archive kind: ${kind}`);
}

// ---------------------------------------------------------------------
// Redis-backed storage for jsa / bol / swp archives.
// ---------------------------------------------------------------------
// All record JSON lives in Upstash Redis / Postgres. Per-record storage:
// (Historical name "Blob" in helpers refers to archive JSON records, not Vercel Blob.)
//
//   archive:{kind}:rec:{id}      — string, JSON-serialized record
//   archive:{kind}:idx           — zset, score=createdAt-ms, member=id
//   archive:swp:live             — zset, score=updatedAt-ms (live SWPs only)
//   archive:swp:closed           — zset, score=closedAt-ms (closed SWPs only)
//
// Archive JSON is Redis/Postgres — not object storage. Binary vendor docs and
// parts photos use Amazon S3 (api/lib/storage). List ops are O(log N) sorted-set
// reads + a single mget; single-record reads are O(1).

function archiveBlobKindKeys(kind) {
  // Validate kind for redis-backed archive operations
  if (kind !== 'jsa' && kind !== 'bol' && kind !== 'swp') {
    throw new Error(`Unknown blob-archive kind: ${kind}`);
  }
  return {
    recKeyFor: (id) => `archive:${kind}:rec:${id}`,
    indexKey:  `archive:${kind}:idx`,
    liveKey:   `archive:${kind}:live`,    // SWP only
    closedKey: `archive:${kind}:closed`,  // SWP only
  };
}

// Generate a record id matching the previous Blob format (uuid-like).
// The shape isn't load-bearing — only used for new record routing —
// but keeping it familiar helps when comparing to migrated records.
function generateBlobArchiveId() {
  // 16 hex chars + dash + 8 hex = 25 char id, comfortably unique for
  // human-scale archive volumes.
  const ts = Date.now().toString(16);
  const rand = Math.random().toString(16).slice(2, 10);
  return `${ts}-${rand}`;
}

// Read a single record by id from Redis. Returns null if not found.
async function readBlobArchiveRecord(kind, id) {
  const keys = archiveBlobKindKeys(kind);
  const raw = await redis.get(keys.recKeyFor(id));
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

// Write a record to Redis. Updates whichever sorted-set indexes apply
// (main idx always; live/closed for SWP). Pipelined so the write +
// index updates happen in one round trip.
async function writeBlobArchiveRecord(kind, record) {
  const keys = archiveBlobKindKeys(kind);
  const id = record.id;
  const createdMs = new Date(record.createdAt).getTime();
  if (!Number.isFinite(createdMs)) {
    throw new Error(`Record has invalid createdAt: ${record.createdAt}`);
  }
  const pipe = redis.pipeline();
  pipe.set(keys.recKeyFor(id), JSON.stringify(record));
  pipe.zadd(keys.indexKey, { score: createdMs, member: id });
  // SWP lifecycle indexes — track live vs closed in their own sets.
  // Score is updatedAt for live (newest-edited first) and closedAt
  // for closed (newest-closed first). On status flip, the old set
  // entry is removed and the new set entry added; we do that here too
  // so create + status-flip both flow through the same write fn.
  if (kind === 'swp') {
    if (record.status === 'closed') {
      const closedMs = new Date(record.closedAt || record.updatedAt || record.createdAt).getTime();
      pipe.zrem(keys.liveKey, id);
      pipe.zadd(keys.closedKey, { score: closedMs, member: id });
    } else {
      const updatedMs = new Date(record.updatedAt || record.createdAt).getTime();
      pipe.zrem(keys.closedKey, id);
      pipe.zadd(keys.liveKey, { score: updatedMs, member: id });
    }
  }
  await pipe.exec();
}

// Remove a record. Drops the record key and all index entries.
async function deleteBlobArchiveRecord(kind, id) {
  const keys = archiveBlobKindKeys(kind);
  const pipe = redis.pipeline();
  pipe.del(keys.recKeyFor(id));
  pipe.zrem(keys.indexKey, id);
  if (kind === 'swp') {
    pipe.zrem(keys.liveKey, id);
    pipe.zrem(keys.closedKey, id);
  }
  await pipe.exec();
}

// Read a paginated, optionally-filtered list of records for a kind.
//
// opts:
//   page       — 1-based page number (default 1)
//   pageSize   — records per page (default 20, max 100)
//   search     — case-insensitive substring matched against record summary
//   from / to  — YYYY-MM-DD bounds on createdAt (ISO date)
//   creator    — exact match on creator display name (createdBy.ssoName/ssoEmail/formName)
//   status     — 'live' | 'closed' (SWP only — uses the dedicated sorted set)
//
// Returns: { records, total, page, pageSize, pageCount }
//
// Implementation notes:
// - We pull all member ids from the appropriate sorted set, then mget
//   the records in one batched call. For 19k records that's ~5MB of
//   data over Redis — sub-second.
// - Filters are applied in Node after the mget. This is fine at our
//   volumes; if the archives ever exceed ~50k records we'd build a
//   secondary keyword index.
async function listBlobArchive(kind, opts = {}) {
  const keys = archiveBlobKindKeys(kind);
  const page = Math.max(1, parseInt(opts.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(opts.pageSize, 10) || 20));

  // Pick which sorted set to read from. SWP status filter goes through
  // the dedicated set so we don't load closed records to filter live ones.
  let zsetKey = keys.indexKey;
  if (kind === 'swp') {
    if (opts.status === 'live') zsetKey = keys.liveKey;
    else if (opts.status === 'closed') zsetKey = keys.closedKey;
  }
  // Newest-first. Upstash zrange with rev:true.
  const ids = await redis.zrange(zsetKey, 0, -1, { rev: true });
  if (!ids || ids.length === 0) {
    return { records: [], total: 0, page, pageSize, pageCount: 1 };
  }

  // Batch-fetch records. mget is cheap relative to N round trips.
  const recKeys = ids.map(id => keys.recKeyFor(id));
  const raw = await redis.mget(...recKeys);
  let records = raw
    .map(v => v ? (typeof v === 'string' ? JSON.parse(v) : v) : null)
    .filter(Boolean);

  // ---- Filters ----
  if (opts.from) {
    const fromMs = new Date(opts.from + 'T00:00:00').getTime();
    records = records.filter(r => new Date(r.createdAt).getTime() >= fromMs);
  }
  if (opts.to) {
    const toMs = new Date(opts.to + 'T23:59:59').getTime();
    records = records.filter(r => new Date(r.createdAt).getTime() <= toMs);
  }
  if (opts.creator) {
    const want = String(opts.creator).toLowerCase();
    records = records.filter(r => {
      const cb = r.createdBy || {};
      const candidates = [cb.ssoName, cb.ssoEmail, cb.formName].filter(Boolean).map(s => s.toLowerCase());
      return candidates.some(c => c === want);
    });
  }
  if (opts.search) {
    const want = String(opts.search).toLowerCase();
    records = records.filter(r => {
      const summary = summaryForList(kind, r);
      const cb = r.createdBy || {};
      const blob = [
        cb.ssoName, cb.ssoEmail, cb.formName,
        summary.permitNumber, summary.pic, summary.customer,
        summary.location, summary.jobDesc,
        summary.bolNumber, summary.driver, summary.consignee,
        summary.employee, summary.customers, summary.briefWork,
        r.id,
      ].filter(Boolean).join(' ').toLowerCase();
      return blob.includes(want);
    });
  }

  const total = records.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const startIdx = (page - 1) * pageSize;
  const slice = records.slice(startIdx, startIdx + pageSize);

  // Shape each record like the old list endpoint: id, createdAt,
  // createdBy, status (swp), summary, blobUrl (omitted — Redis-backed).
  // Existing portal renderers expect this shape; preserve it.
  const shaped = slice.map(rec => ({
    id: rec.id,
    createdAt: rec.createdAt,
    createdBy: rec.createdBy,
    ...(kind === 'swp' ? { status: rec.status || 'live' } : {}),
    summary: summaryForList(kind, rec),
  }));

  return { records: shaped, total, page, pageSize, pageCount };
}

function generateRequestArchiveId() {
  const ts = Date.now();
  const nonce = Math.random().toString(36).slice(2, 8);
  return `${ts}-${nonce}`;
}

// Save a request archive record. `payload` is the structured submission data
// (location, parts list, etc). Returns the saved record.
async function saveRequestArchive(kind, payload, actorEmail) {
  const { recordPrefix, indexKey } = archiveKindKeys(kind);
  const id = generateRequestArchiveId();
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const record = {
    id,
    kind,
    createdAt: now,
    submittedBy: actorEmail || payload.submittedBy || payload.contactEmail || 'unknown',
    ...payload,
  };
  const p = redis.pipeline();
  p.set(`${recordPrefix}:${id}`, JSON.stringify(record));
  p.zadd(indexKey, { score: nowMs, member: id });
  await p.exec();
  // Mirror into central Operations Workflow Hub (non-blocking for legacy callers).
  try {
    const hubRec = await mirrorArchiveToHub(kind, record, actorEmail);
    if (hubRec?.id) {
      record.hubRequestId = hubRec.id;
      record.hubRequestNumber = hubRec.request_number;
      await redis.set(`${recordPrefix}:${id}`, JSON.stringify(record));
    }
  } catch (hubErr) {
    console.warn('Hub mirror failed (archive still saved):', hubErr.message);
  }
  return record;
}

// List request archive records, newest first. Filters applied client-side
// (search, status) since we want the freshest MaintainX status reflected.
// Date range is applied here for efficiency.
async function listRequestArchive(kind, opts = {}) {
  const { recordPrefix, indexKey } = archiveKindKeys(kind);
  const { dateFrom, dateTo, limit = 500 } = opts;
  // ZRANGE BYSCORE with reverse order. Score is unix-ms; convert dates to ms.
  const minScore = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : 0;
  const maxScore = dateTo ? new Date(dateTo + 'T23:59:59').getTime() : Number.MAX_SAFE_INTEGER;
  // Upstash zrange: get all in score range, then reverse for newest-first
  const ids = await redis.zrange(indexKey, minScore, maxScore, { byScore: true });
  if (!ids || ids.length === 0) return [];
  // Reverse so newest is first; cap at limit
  const ordered = ids.slice().reverse().slice(0, limit);
  // Fetch records in batch
  const keys = ordered.map(id => `${recordPrefix}:${id}`);
  const values = keys.length ? await redis.mget(...keys) : [];
  return values
    .map(v => v ? (typeof v === 'string' ? JSON.parse(v) : v) : null)
    .filter(Boolean);
}

async function getRequestArchiveRecord(kind, id) {
  const { recordPrefix } = archiveKindKeys(kind);
  const raw = await redis.get(`${recordPrefix}:${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

// ---- Printable vendor record (HTML) ----
// One source of truth used both by the standalone /vendors/{ref}/record endpoint
// (so the portal can open it in a new window and print) and by the ZIP builder
// (which embeds it as Vendor-Record.html in the download). Recipients can View
// or print-to-PDF in one click.

function escapeHtmlServer(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function vendorStatusLabelServer(status) {
  const map = {
    pending_rebekah:  'Pending Rebekah Review',
    pending_rebekah_review: 'Pending Rebekah Review',
    pending_ap:       'Pending AP Setup',
    pending_ap_setup: 'Pending AP Setup',
    pending_contract: 'Pending Contract Review',
    pending_contract_review: 'Pending Contract Review',
    pending_dylan_review: 'Pending Dylan Review',
    rejected:         'Rejected',
    cancelled:        'Cancelled',
    in_progress:      'In Progress',
    complete:         'Complete',
  };
  return map[status] || (status || 'Unknown').replace(/_/g, ' ');
}

function formatYNServer(v) {
  if (v === 'yes') return 'Yes';
  if (v === 'no')  return 'No';
  return '—';
}

function formatAddressServer(a) {
  if (!a || (!a.street && !a.city && !a.state && !a.zip)) return '—';
  const line2 = [a.city, a.state].filter(Boolean).join(', ');
  return [a.street, [line2, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
}

function formatBytesServer(n) {
  if (!n) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function generateVendorRecordHtml(v, docs) {
  const e = escapeHtmlServer;
  const overallStatus = v.overallStatus || deriveOverallStatus(v);
  const statusLabel = vendorStatusLabelServer(overallStatus);
  const generatedAt = new Date().toLocaleString('en-US');
  const createdAt = v.createdAt ? new Date(v.createdAt).toLocaleString('en-US') : '—';

  const credit = (typeof v.requestedCreditLimit === 'number')
    ? '$' + v.requestedCreditLimit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '— Not requested';

  const physical = formatAddressServer(v.physicalAddress);
  const billing = (v.billingAddress && v.billingAddress.sameAsPhysical)
    ? '<em>Same as physical</em>'
    : formatAddressServer(v.billingAddress);

  const ap = v.apContact || {};

  const msaNda = (
    (v.msaRequired ? 'MSA' : '') +
    (v.msaRequired && v.ndaRequired ? ', ' : '') +
    (v.ndaRequired ? 'NDA' : '') ||
    'Neither required'
  );

  const docsRows = (docs && docs.length)
    ? docs.map(d => `
        <tr>
          <td><span class="kind kind-${e(d.kind || 'other')}">${e((d.kind || 'other').toUpperCase())}</span></td>
          <td>${e(d.filename)}</td>
          <td>${e(formatBytesServer(d.size || 0))}</td>
          <td>${d.uploadedAt ? e(new Date(d.uploadedAt).toLocaleDateString('en-US')) : '—'}</td>
        </tr>`).join('')
    : '<tr><td colspan="4" class="empty">No documents on file</td></tr>';

  const historyRows = (v.history && v.history.length)
    ? v.history.slice().reverse().map(h => {
        const eventLabel = {
          'created':       'Created',
          'updated':       'Updated',
          'note_added':    'Note Added',
          'doc_uploaded':  'Document Uploaded',
          'doc_deleted':   'Document Deleted',
        }[h.event] || h.event;
        let detail = '';
        if (h.changes && h.changes.length) {
          detail = h.changes.map(c => `<div class="change">${e(c.field)}: <s>${e(typeof c.from === 'object' ? JSON.stringify(c.from) : String(c.from == null ? '∅' : c.from))}</s> → <strong>${e(typeof c.to === 'object' ? JSON.stringify(c.to) : String(c.to == null ? '∅' : c.to))}</strong></div>`).join('');
        }
        if (h.note) detail += `<div class="note">"${e(h.note)}"</div>`;
        return `
          <tr>
            <td class="when">${h.at ? e(new Date(h.at).toLocaleString('en-US')) : '—'}</td>
            <td><span class="event">${e(eventLabel)}</span></td>
            <td>${e(h.by || 'unknown')}</td>
            <td>${detail || '—'}</td>
          </tr>`;
      }).join('')
    : '<tr><td colspan="4" class="empty">No activity recorded</td></tr>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Vendor Record — ${e(v.companyName || v.refNumber)}</title>
<style>
  /* ---- Screen + print shared styles ---- */
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    color: #1a2929;
    background: #f8f9fa;
    margin: 0;
    padding: 24px;
    line-height: 1.45;
  }
  .page {
    max-width: 880px;
    margin: 0 auto;
    background: white;
    padding: 40px 48px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.06);
    border-radius: 8px;
  }
  /* Header */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #2a9499;
    padding-bottom: 16px;
    margin-bottom: 24px;
  }
  .header h1 {
    font-size: 24px;
    margin: 0 0 6px 0;
    letter-spacing: -0.01em;
    color: #0f1e20;
  }
  .header .ref {
    font-family: 'Courier New', monospace;
    font-size: 13px;
    color: #1a2929;
    background: #f0f4f4;
    padding: 3px 10px;
    border-radius: 3px;
    display: inline-block;
    margin-right: 10px;
  }
  .header .meta {
    font-size: 12px;
    color: #6c7a7c;
    margin-top: 4px;
  }
  .status-pill {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .status-pill.pending_rebekah  { background:#fef3c7; color:#92400e; border:1px solid #fcd34d; }
  .status-pill.pending_ap       { background:#dbeafe; color:#1e40af; border:1px solid #93c5fd; }
  .status-pill.pending_contract { background:#ede9fe; color:#5b21b6; border:1px solid #c4b5fd; }
  .status-pill.in_progress      { background:#f0f4f4; color:#6c7a7c; border:1px solid #d8dde0; }
  .status-pill.complete         { background:#d1fae5; color:#065f46; border:1px solid #6ee7b7; }
  .status-pill.unknown          { background:#f0f4f4; color:#6c7a7c; border:1px solid #d8dde0; }
  /* Sections */
  section {
    margin-bottom: 24px;
    page-break-inside: avoid;
  }
  section h2 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #2a9499;
    margin: 0 0 10px 0;
    padding-bottom: 5px;
    border-bottom: 1px solid #e3e8ea;
    font-weight: 700;
  }
  /* Definition lists */
  dl.kv {
    display: grid;
    grid-template-columns: 160px 1fr;
    gap: 6px 16px;
    margin: 0;
    font-size: 13px;
  }
  dl.kv dt {
    color: #6c7a7c;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    align-self: center;
  }
  dl.kv dd {
    margin: 0;
    color: #1a2929;
  }
  dl.kv dd strong {
    color: #2a9499;
  }
  /* Tables */
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    margin-top: 4px;
  }
  th, td {
    text-align: left;
    padding: 7px 10px;
    border-bottom: 1px solid #e3e8ea;
    vertical-align: top;
  }
  th {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #6c7a7c;
    font-weight: 600;
    background: #f8f9fa;
  }
  td.when { font-family: 'Courier New', monospace; font-size: 11px; color: #6c7a7c; white-space: nowrap; }
  td.empty { text-align: center; color: #9ca5a8; padding: 14px; font-style: italic; }
  .kind {
    display: inline-block;
    font-family: 'Courier New', monospace;
    font-size: 9px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 3px;
    background: #f0f4f4;
    color: #1a2929;
    border: 1px solid #d8dde0;
    letter-spacing: 0.06em;
  }
  .kind.kind-w9       { background: #fef3c7; color: #92400e; border-color: #fcd34d; }
  .kind.kind-banking  { background: #dbeafe; color: #1e40af; border-color: #93c5fd; }
  .kind.kind-msa      { background: #ede9fe; color: #5b21b6; border-color: #c4b5fd; }
  .kind.kind-nda      { background: #ede9fe; color: #5b21b6; border-color: #c4b5fd; }
  .kind.kind-insurance{ background: #d1fae5; color: #065f46; border-color: #6ee7b7; }
  /* History row details */
  .event {
    display: inline-block;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    background: #f0f4f4;
    padding: 2px 6px;
    border-radius: 3px;
    border: 1px solid #d8dde0;
    color: #1a2929;
    font-weight: 600;
  }
  .change { font-size: 11px; padding: 1px 0; }
  .change s { color: #9ca5a8; }
  .note { font-style: italic; color: #1a2929; padding-top: 2px; font-size: 11px; }
  /* Footer */
  .footer {
    margin-top: 32px;
    padding-top: 12px;
    border-top: 1px solid #e3e8ea;
    font-size: 10px;
    color: #9ca5a8;
    display: flex;
    justify-content: space-between;
  }
  /* Print toolbar (hidden on print) */
  .print-toolbar {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 100;
    display: flex;
    gap: 8px;
  }
  .print-toolbar button {
    background: #2a9499;
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    font-family: inherit;
  }
  .print-toolbar button:hover {
    background: #237378;
  }
  .print-toolbar .btn-secondary {
    background: white;
    color: #1a2929;
    border: 1px solid #d8dde0;
  }
  /* ---- Print-specific ---- */
  @media print {
    body { background: white; padding: 0; }
    .page { box-shadow: none; padding: 0; max-width: none; border-radius: 0; }
    .print-toolbar { display: none; }
    section { page-break-inside: avoid; }
    @page { margin: 0.5in; }
  }
</style>
</head>
<body>
  <div class="print-toolbar">
    <button onclick="window.print()">Print / Save as PDF</button>
    <button class="btn-secondary" onclick="window.close()">Close</button>
  </div>
  <div class="page">
    <header class="header">
      <div>
        <h1>${e(v.companyName || 'Unnamed Vendor')}</h1>
        <div>
          <span class="ref">${e(v.refNumber)}</span>
          <span class="status-pill ${e(overallStatus)}">${e(statusLabel)}</span>
        </div>
        <div class="meta">Submitted ${e(createdAt)} by ${e(v.requestedBy || (v.createdBy && v.createdBy.formName) || '—')}</div>
      </div>
      <div style="text-align:right;font-size:10px;color:#9ca5a8;">
        Generated<br>${e(generatedAt)}
      </div>
    </header>

    <section>
      <h2>Company Information</h2>
      <dl class="kv">
        <dt>Entity Type</dt><dd>${e(v.entityType || '—')}</dd>
        <dt>Contact / Title</dt><dd>${e(v.contactName || '—')}</dd>
        <dt>Email</dt><dd>${e(v.contactEmail || '—')}</dd>
        <dt>Phone</dt><dd>${e(v.contactPhone || '—')}</dd>
        <dt>Physical Address</dt><dd>${e(physical)}</dd>
        <dt>Billing Address</dt><dd>${billing}</dd>
        <dt>Scope of Work</dt><dd>${e(v.serviceDescription || '—')}</dd>
        ${v.physicalLocations ? `<dt>Physical Locations</dt><dd>${e(v.physicalLocations)}</dd>` : ''}
        ${v.servicingLocations ? `<dt>Servicing Areas</dt><dd>${e(v.servicingLocations)}</dd>` : ''}
        <dt>MSA / NDA</dt><dd>${e(msaNda)}</dd>
      </dl>
    </section>

    <section>
      <h2>A/P &amp; Tax</h2>
      <dl class="kv">
        <dt>A/P Contact</dt><dd>${e(ap.name || '—')}</dd>
        <dt>A/P Email</dt><dd>${e(ap.email || '—')}</dd>
        <dt>A/P Phone</dt><dd>${e(ap.phone || '—')}</dd>
        <dt>Tax ID</dt><dd>${e(v.taxId || '—')}</dd>
        <dt>PO Required</dt><dd>${e(formatYNServer(v.poRequired))}</dd>
        <dt>State Tax Exempt</dt><dd>${e(formatYNServer(v.stateTaxExempt))}</dd>
        <dt>Veriforce</dt><dd>${e(formatYNServer(v.veriforceAccount))}${v.ssqId ? ' (SSQ ' + e(v.ssqId) + ')' : ''}</dd>
        <dt>Credit Limit</dt><dd><strong>${e(credit)}</strong>${v.creditNotes ? ' — ' + e(v.creditNotes) : ''}</dd>
      </dl>
    </section>

    <section>
      <h2>Workflow Status</h2>
      <dl class="kv">
        <dt>Currently Assigned To</dt><dd>${e({rebekah:'Administration',ap:'Accounts Payable',dylan:'Legal / Executive',complete:'Complete'}[v.assignedTo] || v.assignedTo || '—')}</dd>
        <dt>AP Status</dt><dd>${e((v.apStatus || '—').replace(/_/g, ' '))}</dd>
        <dt>Contract Status</dt><dd>${e((v.contractStatus || '—').replace(/_/g, ' '))}</dd>
      </dl>
    </section>

    <section>
      <h2>Compliance</h2>
      <dl class="kv">
        <dt>W-9 Status</dt><dd>${e((v.w9Status || '—').replace(/_/g, ' '))}</dd>
        <dt>Banking Status</dt><dd>${e((v.bankingStatus || '—').replace(/_/g, ' '))}</dd>
        <dt>Insurance Status</dt><dd>${e((v.insuranceStatus || '—').replace(/_/g, ' '))}</dd>
      </dl>
    </section>

    <section>
      <h2>Documents on File</h2>
      <table>
        <thead><tr><th style="width:90px;">Type</th><th>Filename</th><th style="width:80px;">Size</th><th style="width:100px;">Uploaded</th></tr></thead>
        <tbody>${docsRows}</tbody>
      </table>
    </section>

    <section>
      <h2>Activity Log</h2>
      <table>
        <thead><tr><th style="width:140px;">When</th><th style="width:130px;">Event</th><th style="width:140px;">By</th><th>Detail</th></tr></thead>
        <tbody>${historyRows}</tbody>
      </table>
    </section>

    <div class="footer">
      <span>Streamline Operations Portal · Vendor Management</span>
      <span>${e(v.refNumber)}</span>
    </div>
  </div>
</body>
</html>`;
}

// Summarize an archive record for the list-view (only fields needed for a row)
function summaryForList(kind, rec) {
  const d = rec.data || {};
  if (kind === 'jsa') {
    return {
      employeeName: d.employee || null,
      date: d.date || null,
      customers: d.customers || null,
      activityCount: Array.isArray(d.rows) ? d.rows.length : 0,
      // Lite vs Full mode — the archive list renders a small badge
      // based on this. Default to 'lite' for backward compatibility
      // with records written before Full was introduced.
      mode: d.mode || 'lite',
      // Permit number for Full JSAs (SLI-SWP-NN). Null for Lite.
      permitNumber: d.permitNumber || null,
      // If this JSA was exported to a MaintainX work order at creation
      // time, surface the WO# in the list row so users can see at a glance
      // that the JSA was attached to a WO. Both fields are null for JSAs
      // that weren't exported.
      workOrderNumber: d.exportedToWorkOrder?.workOrderNumber || null,
      workOrderId:     d.exportedToWorkOrder?.workOrderId || null,
    };
  }
  if (kind === 'bol') {
    return {
      bolNumber: d.bolNumber || null,
      driver: d.employee || d.driver || null,
      date: d.date || null,
      consignee: d.consigneeName || d.consignee || null,
      itemCount: Array.isArray(d.items) ? d.items.length : 0,
    };
  }
  if (kind === 'swp') {
    // Safe Work Permit summary — surfaces key fields for the live/closed
    // list views. Status comes from the top-level record (not data),
    // because data is purely the form snapshot.
    return {
      status: rec.status || 'live',
      permitNumber: d.permitNumber || null,
      pic:        d.pic?.name || d.snapshot?.pic?.name || null,
      customer:   d.customer || d.snapshot?.customer || null,
      location:   d.location?.name || d.snapshot?.location?.name || null,
      jobDesc:    d.jobDesc || d.snapshot?.jobDesc || null,
      date:       d.date || d.snapshot?.date || null,
      // Update + close audit so the list can show "Last edited 5 min ago"
      // for live permits without fetching the full record.
      updatedAt:  rec.updatedAt || null,
      closedAt:   rec.closedAt || null,
    };
  }
  return {};
}

// Read the raw request body as a Buffer (for binary uploads)
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---------- Auth handler (Entra OIDC primary, SAML legacy fallback) ----------
//
// When ENTRA_* env vars are set, employees sign in via OIDC authorization code
// flow (MSAL Node). Microsoft tokens never leave the server — we issue the
// existing sliops_session cookie used by /me and the hub gates.
//
// Sub-paths:
//   /auth/login      → Entra authorize URL (or SAML if Entra not configured)
//   /auth/callback   → Entra OIDC callback (authorization code)
//   /auth/logout     → clear session + Microsoft logout
//   /auth/dev-login  → non-production only — local session without Entra
//   /auth/acs        → legacy SAML POST-back (if SAML env still configured)
//   /auth/metadata   → legacy SAML SP metadata

function isDemoBypassActive() {
  const demo = (process.env.DEMO_BYPASS || '').toLowerCase();
  const env = (process.env.NODE_ENV || '').toLowerCase();
  // WOS-79 — the DEMO_BYPASS auth relaxation is a local/dev break-glass only.
  // It is never honored on staging or production so a stray env value cannot
  // silently disable permission checks in a deployed environment. The single
  // documented master switch for deployed auth remains SSO_ENFORCEMENT.
  if (env === 'staging' || env === 'production') {
    return false;
  }
  if (demo === '1' || demo === 'true' || demo === 'yes') return true;
  return (process.env.SSO_ENFORCEMENT || 'on').toLowerCase() === 'off';
}

/** Pre-SSO / local demo / break-glass: skip permission denials when no session. */
function isPortalAuthRelaxed(req) {
  if (isDemoBypassActive()) return true;
  if (req && req.headers && req.headers['x-portal-noauth'] === '1') {
    const env = (process.env.NODE_ENV || '').toLowerCase();
    if (env !== 'production' && env !== 'staging') return true;
    if ((process.env.SSO_ENFORCEMENT || 'on').toLowerCase() === 'off') return true;
  }
  return false;
}

function getDemoActorEmail() {
  return String(process.env.DEMO_USER_EMAIL || 'demo@streamlinecorp.com')
    .trim()
    .toLowerCase();
}

async function handleAuth(path, req, res) {
  const PORTAL_BASE = process.env.PORTAL_BASE_URL || '/';
  const entra = loadEntraModule();
  const useEntra = entra.isEntraConfigured();

  // Friendly error renderer — small HTML page so users don't see raw JSON
  // when something goes wrong during the auth dance.
  function renderError(status, title, message) {
    res.status(status);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const esc = (s) => escapeHtmlServer(String(s || ''));
    const escAttr = (s) => esc(s).replace(/"/g, '&quot;');
    res.send(`<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:80px auto;padding:0 24px;color:#1a1a2e;line-height:1.5}h1{font-size:20px;margin:0 0 12px}.msg{color:#5a6b6d;margin-bottom:24px}a{color:#1f7a7f}</style>
</head><body>
<h1>${esc(title)}</h1>
<p class="msg">${esc(message)}</p>
<p><a href="${escAttr(PORTAL_BASE)}">← Return to portal</a></p>
</body></html>`);
  }

  try {
    // ---- /auth/metadata ----
    if (path === '/auth/metadata') {
      if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
      }
      const xml = loadSamlModule().getServiceProviderMetadata();
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      return res.status(200).send(xml);
    }

    // ---- /auth/login ----
    if (path === '/auth/login') {
      if (useEntra) {
        return entra.handleLogin(req, res, { renderError, portalBase: PORTAL_BASE });
      }
      if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
      }
      const next = typeof req.query.next === 'string' ? req.query.next : '';
      // Demo / local: skip SAML when not configured — auto dev-login instead of error page.
      const entraMod = loadEntraModule();
      if (
        (isDemoBypassActive() || process.env.NODE_ENV === 'development') &&
        entraMod.isDevLoginAllowed &&
        entraMod.isDevLoginAllowed()
      ) {
        const email = encodeURIComponent(getDemoActorEmail());
        const nextQ = next ? `&next=${encodeURIComponent(next)}` : '';
        res.setHeader('Location', `/api/auth/dev-login?email=${email}${nextQ}`);
        return res.status(302).end();
      }
      const remember = req.query.remember === '1' || req.query.remember === 'true';
      const relay = JSON.stringify({ r: remember ? 1 : 0, n: next.slice(0, 256) });
      const url = await loadSamlModule().getLoginUrl(relay);
      res.setHeader('Location', url);
      return res.status(302).end();
    }

    // ---- /auth/callback ---- (Entra OIDC)
    if (path === '/auth/callback') {
      if (!useEntra) {
        return renderError(503, 'Entra SSO not configured', 'Set ENTRA_* environment variables.');
      }
      return entra.handleCallback(req, res, {
        renderError,
        portalBase: PORTAL_BASE,
        ensureUserProvisioned,
      });
    }

    // ---- /auth/dev-login ---- (local dev only, NODE_ENV !== production)
    if (path === '/auth/dev-login') {
      return entra.handleDevLogin(req, res, {
        renderError,
        portalBase: PORTAL_BASE,
        ensureUserProvisioned,
      });
    }

    // ---- /auth/staging-test-login ---- (WOS-85: staging + shared secret only)
    if (path === '/auth/staging-test-login') {
      const stagingTestLogin = require('./lib/staging-test-login');
      return stagingTestLogin.handleStagingTestLogin(req, res, {
        portalBase: PORTAL_BASE,
        syncUserRecord: async (user) => {
          // Keep portal permission gates in sync with PostgreSQL SoR.
          await setUserPermissions(user.email, user.permissions, 'system:staging-test-login', false);
          const key = `user:${user.email.toLowerCase()}`;
          const raw = await redis.get(key);
          const rec = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
          rec.email = user.email;
          rec.displayName = user.displayName;
          rec.firstName = null;
          rec.lastName = null;
          rec.permissions = user.permissions;
          rec.role = user.primaryRole;
          rec.staging_test_user = true;
          await redis.set(key, JSON.stringify(rec));
        },
      });
    }

    // ---- /auth/acs ----
    // IdP POSTs the SAML response here. We validate the signature, extract
    // the email + name claims, issue our session cookie, then redirect
    // back to the portal (or to the deep link the user originally wanted).
    if (path === '/auth/acs') {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed for /auth/acs' });
      }
      // SAMLResponse arrives as a form-urlencoded body field. Vercel's
      // serverless runtime parses application/x-www-form-urlencoded into
      // req.body when the Content-Type header is set; otherwise we have
      // to do it ourselves.
      let body = req.body || {};
      if (typeof body === 'string') {
        body = Object.fromEntries(new URLSearchParams(body));
      }
      const samlResponse = body.SAMLResponse;
      const relayState   = body.RelayState || '';
      if (!samlResponse) {
        return renderError(400, 'Missing SAML response',
          'The identity provider did not include a SAMLResponse field. Please try logging in again.');
      }

      let identity;
      try {
        identity = await loadSamlModule().validateResponse(samlResponse);
      } catch (err) {
        console.error('SAML validation failed:', err);
        return renderError(401, 'Sign-in failed',
          'We could not verify your identity provider response. This may be a configuration issue — please contact your administrator.');
      }

      // Decode RelayState for "remember me" + "next URL"
      let remember = false;
      let next = '';
      try {
        const parsed = JSON.parse(relayState || '{}');
        remember = parsed.r === 1;
        next = typeof parsed.n === 'string' ? parsed.n : '';
      } catch { /* ignore — defaults stand */ }

      // Issue the session cookie and redirect home (or to the next URL).
      auth.issueSession(res, identity.email, { remember });

      // Trigger first-login auto-provisioning by hitting our own user
      // creation logic. We do this inline rather than waiting for the
      // first /me call so the user record exists before the portal loads.
      // Errors here are non-fatal — the user can still log in, and /me
      // will provision on next request.
      try {
        await ensureUserProvisioned(identity);
      } catch (err) {
        console.error('First-login provisioning failed (non-fatal):', err);
      }

      // Build the redirect target. If `next` is a relative path on the
      // same site, honour it; otherwise fall back to PORTAL_BASE.
      let target = PORTAL_BASE;
      if (next && next.startsWith('/') && !next.startsWith('//')) {
        // Strip the leading slash and prepend PORTAL_BASE if it ends with /
        const base = PORTAL_BASE.endsWith('/') ? PORTAL_BASE.slice(0, -1) : PORTAL_BASE;
        target = base + next;
      }
      res.setHeader('Location', target);
      return res.status(302).end();
    }

    // ---- /auth/logout ----
    // WOS-86 — always clear the signed session cookie server-side, then redirect.
    if (path === '/auth/logout') {
      if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
      }
      const { performLogout, setNoStore: noStore } = require('./lib/logout');
      noStore(res);

      let entraLogoutUrl = null;
      if (useEntra) {
        const tenantId = process.env.ENTRA_TENANT_ID;
        const landing = require('./lib/logout').resolvePostLogoutUrl(PORTAL_BASE);
        const postLogout = encodeURIComponent(landing);
        if (tenantId) {
          entraLogoutUrl =
            `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/logout` +
            `?post_logout_redirect_uri=${postLogout}`;
        }
      }

      const sess = auth.getSession(req);
      if (!useEntra && sess?.email && process.env.SAML_LOGOUT_URL) {
        const idpLogoutUrl = await loadSamlModule().getLogoutUrl(sess.email);
        if (idpLogoutUrl) {
          auth.clearSession(res);
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
          res.setHeader('Location', idpLogoutUrl);
          return res.status(302).end();
        }
      }

      return performLogout(req, res, {
        portalBase: PORTAL_BASE,
        useEntra: !!entraLogoutUrl,
        entraLogoutUrl,
      });
    }

    return res.status(404).json({ error: `Unknown auth route: ${path}` });

  } catch (err) {
    if (err.message && err.message.includes('Entra SSO not configured')) {
      return renderError(503, 'Entra SSO not configured', err.message);
    }
    if (err.message && err.message.includes('SAML config incomplete')) {
      return renderError(503, 'SAML not configured',
        'The single sign-on integration is not yet configured. Please contact your administrator.');
    }
    // Module load failures (npm install issues) deserve their own message
    // so we can spot them quickly during initial setup.
    if (err.code === 'MODULE_NOT_FOUND' || (err.message || '').includes('Cannot find module')) {
      console.error('SAML module not installed:', err);
      return renderError(503, 'SAML library not installed',
        `The SAML library (@node-saml/node-saml) was not installed during deployment. Trigger a fresh deploy to install dependencies. Detail: ${err.message}`);
    }
    console.error('Auth handler error:', err);
    // Include the error message in the response so we can debug from the
    // browser. This is intentional during initial SAML setup; we can
    // tighten this later once the integration is stable.
    return renderError(500, 'Internal error',
      `Something went wrong handling your sign-in. Detail: ${err.message || String(err)}`);
  }
}

// Auto-provision a user record on first SSO login. Mirrors the logic in
// the /me handler so a user can be created either way. Idempotent —
// if the user already exists in KV, we no-op.
async function ensureUserProvisioned(identity) {
  const email = (identity?.email || '').toLowerCase();
  if (!email) return;

  const authProvider = identity?.auth_provider || 'sso';
  const organizationId = identity?.organization_id || null;
  const organizationSlug = identity?.organization_slug || null;
  const externalId = identity?.external_id || identity?.nameID || null;
  const roleId = identity?.role || 'employee';
  const ssoGroups = Array.isArray(identity?.groups) ? identity.groups : null;

  // Title-case name bits from the SAML claims so storage is clean.
  const firstName   = identity?.firstName ? titleCaseName(identity.firstName) : null;
  const lastName    = identity?.lastName  ? titleCaseName(identity.lastName)  : null;
  const displayName = identity?.displayName
    ? titleCaseName(identity.displayName)
    : buildDisplayName({
      firstName: identity?.firstName,
      lastName:  identity?.lastName,
      email,
    });

  const bootstrapList = (process.env.BOOTSTRAP_ADMIN_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (bootstrapList.includes(email)) return; // bootstrap admins are env-sourced, no KV record

  async function resolveDefaultPermissions() {
    if (roleId && roleId !== 'employee') {
      try {
        const role = await getRole(roleId);
        if (role && Array.isArray(role.permissions) && role.permissions.length > 0) {
          return role.permissions;
        }
      } catch (err) {
        console.warn(`Could not resolve role "${roleId}" for SSO provisioning:`, err.message);
      }
    }
    return getEmployeeRolePermissions();
  }

  const existing = await redis.get(`user:${email}`);
  if (existing) {
    // User exists — backfill name/org fields if the record predates them.
    const parsed = typeof existing === 'string' ? JSON.parse(existing) : existing;
    const needsUpdate = !parsed.displayName
                     || (!parsed.firstName && firstName)
                     || (!parsed.lastName && lastName)
                     || (!parsed.organization_id && organizationId)
                     || (!parsed.auth_provider && authProvider)
                     || (!parsed.external_id && externalId)
                     || (!parsed.role && roleId)
                     || (ssoGroups && !parsed.sso_groups);
    if (needsUpdate) {
      parsed.firstName   = parsed.firstName   || firstName;
      parsed.lastName    = parsed.lastName    || lastName;
      parsed.displayName = parsed.displayName || displayName;
      parsed.organization_id = parsed.organization_id || organizationId;
      parsed.organization_slug = parsed.organization_slug || organizationSlug;
      parsed.auth_provider = parsed.auth_provider || authProvider;
      parsed.external_id = parsed.external_id || externalId;
      parsed.role = parsed.role || roleId;
      if (ssoGroups) parsed.sso_groups = ssoGroups;
      parsed.updatedAt   = new Date().toISOString();
      await redis.set(`user:${email}`, JSON.stringify(parsed));
    }
    return;
  }

  // Mint a new user with role-based permissions + org metadata.
  const defaultPerms = await resolveDefaultPermissions();
  const newUser = {
    email,
    firstName,
    lastName,
    displayName,
    organization_id: organizationId,
    organization_slug: organizationSlug,
    auth_provider: authProvider,
    external_id: externalId,
    role: roleId,
    sso_groups: ssoGroups || undefined,
    permissions: defaultPerms,
    createdAt: Date.now(),
    createdBy: `system:${authProvider}-auto-provision`,
  };
  const p = redis.pipeline();
  p.set(`user:${email}`, JSON.stringify(newUser));
  p.sadd('users:index', email);
  p.lpush('users:audit', JSON.stringify({
    at: Date.now(),
    by: 'system:sso-auto-provision',
    target: email,
    action: 'user_created',
    permissions: defaultPerms,
    previousPermissions: [],
  }));
p.ltrim('users:audit', 0, 499);
  await p.exec();
}
module.exports = async function handler(req, res) {
  const rawPath = typeof req.query.path === 'string' ? req.query.path : '';
  const pathOnly = rawPath.split('?')[0];

  // ---- Multi-tenant SAML SSO (/sso/:orgSlug/*) ----
  if (pathOnly.startsWith('/sso/')) {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();
    return loadSsoHandlers().handleSsoRoute(pathOnly, req, res, {
      ensureUserProvisioned,
      getRole,
    });
  }

  // ---- Auth routes bypass CORS ----
  // SAML POST-backs come from login.microsoftonline.com — a legitimate
  // cross-origin POST that must succeed. SAML's security model is signed
  // assertions, not browser CORS. Handle auth routes before the CORS guard.
  if (req.query.path && typeof req.query.path === 'string' && req.query.path.startsWith('/auth/')) {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();
    return handleAuth(req.query.path, req, res);
  }

  // ---- SSO ENFORCEMENT GATE ----
  // Reject sessionless requests to data endpoints with 401. The portal's
  // proxyFetch helper detects 401 and redirects to login. Anyone hitting
  // the API directly without a session gets a clear error.
  //
  // KILL SWITCH: set env var SSO_ENFORCEMENT=off and redeploy to disable
  // both this gate and the portal's /me-driven auth gate (which also
  // checks the same flag). Use as emergency lever if SSO breaks in prod.
  //
  // PUBLIC PATHS (always exempt — these run pre-auth or are auth itself):
  //   /me                          identity endpoint
  //   /vendor-auth, /vendor-session  separate vendor auth flow
  //   /photo-cleanup, /archive-wipe-orphans  cron-triggered
  //   /swp-number                  atomic counter, no PII
  //
  // Server-to-server callers (no Origin header — Vercel cron, healthchecks)
  // bypass enforcement. They have no browser session anyway and are
  // typically gated by their own shared secrets (e.g., CLEANUP_SECRET).
  //
  // OPTIONS (CORS preflight) always passes — the real request that follows
  // still hits this gate.
  const ssoEnforced = (process.env.SSO_ENFORCEMENT || 'on').toLowerCase() !== 'off';
  if (ssoEnforced && req.method !== 'OPTIONS') {
    const isPublicPath =
      pathOnly === '/me' ||
      pathOnly === '/vendor-auth' ||
      pathOnly === '/vendor-session' ||
      pathOnly === '/photo-cleanup' ||
      pathOnly === '/swp-number' ||
      pathOnly.startsWith('/archive-wipe-orphans') ||
      pathOnly.startsWith('/hub/action/') ||
      pathOnly === '/hub/inbound-email' ||
      pathOnly.startsWith('/sso/');
    // WOS-80 — a missing Origin header is only treated as trusted
    // server-to-server in local/development. In staging/production a
    // no-Origin request must still carry a valid session (or hit a public
    // path, which have their own shared-secret checks), so a scripted
    // no-Origin caller (curl/tooling) cannot bypass authentication.
    const gateEnv = (process.env.NODE_ENV || '').toLowerCase();
    const gateDeployed = gateEnv === 'staging' || gateEnv === 'production';
    const isServerToServer = !req.headers.origin && !gateDeployed;
    if (!isPublicPath && !isServerToServer) {
      const sessionEmail = auth.getActorEmail(req);
      if (!sessionEmail) {
        // CORS headers so the browser surfaces this response to fetch().
        const reqOrigin = req.headers.origin || '';
        if (reqOrigin) {
          res.setHeader('Access-Control-Allow-Origin', reqOrigin);
          res.setHeader('Access-Control-Allow-Credentials', 'true');
          res.setHeader('Vary', 'Origin');
        }
        return res.status(401).json({ error: 'Not authenticated' });
      }
    }
  }

  // ---- CORS ----
  // Allowlist: ALLOWED_ORIGIN (comma-separated exact origins) plus the origin
  // derived from PORTAL_BASE_URL. Never use wildcard origins with credentials.
  // Staging example: ALLOWED_ORIGIN=https://automation.streamlinescada.com
  // (scheme+host only — no path). Localhost/preview auto-allow is local/dev only.
  const { isOriginAllowed } = require('./lib/cors-origins');
  const requestOrigin = req.headers.origin || '';
  const originAllowed = isOriginAllowed(requestOrigin);

  // Echo the actual requesting origin back when allowed (instead of '*'), so
  // we're compatible with credential mode and so the browser only
  // accepts the response for the exact origin it came from. Vary tells caches
  // the response depends on the Origin header. We allow credentials because
  // the portal sends session cookies on every authenticated request — without
  // this header, browsers strip cookies on cross-origin requests.
  if (originAllowed && requestOrigin) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  // For server-to-server (no Origin header), don't set the CORS headers at all
  // — they're meaningless without an origin, and omitting them is the correct
  // behaviour per the CORS spec.

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Filename, X-Cleanup-Secret, X-Vendor-Session, X-Doc-Kind, X-Actor-Email, Cookie');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Preflight: respond 204 if origin is allowed, 403 if not. Browsers only
  // make preflight requests when there's a cross-origin request to make, so
  // a disallowed origin will fail at the preflight step before ever sending
  // the real request.
  if (req.method === 'OPTIONS') {
    return res.status(originAllowed ? 204 : 403).end();
  }

  // For non-preflight requests from a disallowed cross-origin caller, refuse
  // to do work. Server-to-server (no Origin) is allowed through so that cron
  // jobs, healthchecks, and admin tools still function.
  if (requestOrigin && !originAllowed) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  // WOS-80 — CSRF defense-in-depth. For state-changing methods, if a Referer
  // header is present its origin must be allowed (the Origin header is already
  // validated above). Browser-initiated writes always carry Origin/Referer, so
  // a cross-site forged request is rejected here in addition to being blocked
  // by SameSite=Lax session cookies. Requests with neither header (approved
  // webhooks / cron on public paths, which carry their own shared secrets) are
  // intentionally unaffected.
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const referer = req.headers.referer || req.headers.referrer || '';
    if (referer) {
      let refOrigin = '';
      try { refOrigin = new URL(referer).origin; } catch { refOrigin = ''; }
      if (refOrigin && !isOriginAllowed(refOrigin)) {
        return res.status(403).json({ error: 'Cross-site request blocked' });
      }
    }
  }

  const path = req.query.path;
  if (!path || typeof path !== 'string') {
    return res.status(400).json({ error: 'Missing required query param: path' });
  }

  // ---- Auth endpoints (SAML 2.0 with Microsoft Entra ID) ----
  // These run BEFORE the identity endpoint because /api/auth/me would
  // otherwise need a valid session, but the bootstrap of that session is
  // /api/auth/login → IdP → /api/auth/acs.
  //
  // Routes:
  //   GET  /auth/login     → kicks off SAML SP-initiated SSO
  //   POST /auth/acs       → IdP POSTs the SAML response here after login
  //   GET  /auth/logout    → clears the local session, redirects to IdP SLO
  //   GET  /auth/metadata  → SP metadata XML (give to IT for Entra setup)
  //
  // Auth is configured via env vars (see lib/saml.js for the list).
  // Until those env vars are populated, every endpoint here returns
  // a 503 explaining what's missing — so the rest of the proxy still
  // works during the period after this code ships but before IT delivers
  // the credentials.


  // ---- Permit number generator (Streamline Safe Work Permit) ----
  // Atomic counter living in Redis. `INCR` is single-roundtrip and
  // race-safe — multiple concurrent requests get distinct numbers.
  // Format: SLI-SWP-NN (zero-padded to 2 digits up to 99, then grows).
  // POST is required so callers can't accidentally burn numbers via
  // browser pre-fetch. Returns { number: 'SLI-SWP-01', counter: 1 }.
  if (path === '/swp-number') {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed for /swp-number' });
    }
    try {
      const next = await redis.incr('swp:counter');
      const number = `SLI-SWP-${String(next).padStart(2, '0')}`;
      return res.status(200).json({ number, counter: next });
    } catch (err) {
      console.error('SWP counter error:', err);
      return res.status(500).json({ error: 'Could not generate permit number' });
    }
  }

// ---- Identity endpoint (returns signed-in user) ----
  // Response shape:
  //   { email, name, firstName, lastName, permissions, bootstrap,
  //     authenticated, autoProvisioned, ssoEnforced }
  //
  // - email comes from the session cookie issued at /auth/callback (Entra OIDC)
  //   or /auth/acs (legacy SAML)
  // - name (and firstName / lastName) come from the Redis user record,
  //   populated from SAML claims at first login. For bootstrap admins
  //   or pre-existing records without name fields, name is derived
  //   from the email local-part with title-casing applied (so display
  //   is "James Alexander", not "james.alexander").
  // - permissions are read from the Redis user record. Bootstrap admins
  //   are synthesized with all permissions.
  // - ssoEnforced reflects the SSO_ENFORCEMENT env var. When 'off',
  //   authenticated is forced true so the auth gate doesn't fire.
  if (path === '/me') {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed for /me' });
    }
    const ssoEnforcedNow = (process.env.SSO_ENFORCEMENT || 'on').toLowerCase() !== 'off';
    const cookieEmail = auth.getActorEmail(req) || null;

    // Kill-switch path: enforcement OFF. Return synthetic authenticated
    // payload so the portal's auth gate doesn't redirect anyone.
    if (!ssoEnforcedNow) {
      return res.status(200).json({
        email: cookieEmail,
        name: cookieEmail ? buildDisplayName({ email: cookieEmail }) : null,
        firstName: null,
        lastName: null,
        permissions: ALL_PERMISSION_IDS.slice(),
        bootstrap: false,
        authenticated: true,
        autoProvisioned: false,
        ssoEnforced: false,
      });
    }

    // Enforced path: no session → anonymous response.
    if (!cookieEmail) {
      return res.status(200).json({
        email: null,
        name: null,
        firstName: null,
        lastName: null,
        permissions: [],
        bootstrap: false,
        authenticated: false,
        autoProvisioned: false,
        ssoEnforced: true,
      });
    }

    // Slide session forward on each authenticated /me (keeps active users signed in).
    try {
      const sess = auth.getSession(req);
      if (sess?.email) {
        auth.issueSession(res, cookieEmail, { remember: !!sess.remember });
      }
    } catch (slideErr) {
      console.warn('Session slide failed (non-fatal):', slideErr.message);
    }

    // Authenticated — resolve user record.
    let userRecord = null;
    let autoProvisioned = false;
    const isBootstrap = isBootstrapAdmin(cookieEmail);

    if (isBootstrap) {
      // Bootstrap admins live in env, not Redis. Synthesize the record.
      userRecord = {
        email: cookieEmail,
        firstName: null,
        lastName: null,
        displayName: buildDisplayName({ email: cookieEmail }),
        permissions: ALL_PERMISSION_IDS.slice(),
        bootstrap: true,
      };
    } else {
      try {
        const raw = await redis.get(`user:${cookieEmail.toLowerCase()}`);
        if (raw) {
          userRecord = typeof raw === 'string' ? JSON.parse(raw) : raw;
          // Backfill displayName for records provisioned before name
          // capture. Idempotent — only writes if the field was missing.
          if (!userRecord.displayName) {
            userRecord.displayName = buildDisplayName({
              firstName: userRecord.firstName,
              lastName: userRecord.lastName,
              email: cookieEmail,
            });
            try {
              await redis.set(`user:${cookieEmail.toLowerCase()}`, JSON.stringify(userRecord));
            } catch (e) {
              console.warn('Could not backfill displayName:', e.message);
            }
          }
        } else {
          // Valid session but no Redis record (transient KV error at /acs
          // most likely). Provision now.
          const employeePerms = await getEmployeeRolePermissions();
          await setUserPermissions(
            cookieEmail,
            employeePerms,
            'system:sso-auto-provision',
            true /* isNewUser */
          );
          const rawAfter = await redis.get(`user:${cookieEmail.toLowerCase()}`);
          userRecord = rawAfter
            ? (typeof rawAfter === 'string' ? JSON.parse(rawAfter) : rawAfter)
            : { email: cookieEmail, permissions: employeePerms };
          userRecord.displayName = buildDisplayName({ email: cookieEmail });
          try {
            await redis.set(`user:${cookieEmail.toLowerCase()}`, JSON.stringify(userRecord));
          } catch (e) {
            console.warn('Could not set displayName on new record:', e.message);
          }
          autoProvisioned = true;
        }
      } catch (err) {
        console.warn('User record lookup failed (will retry next /me):', err.message);
        userRecord = {
          email: cookieEmail,
          displayName: buildDisplayName({ email: cookieEmail }),
          permissions: [],
        };
      }
    }

    let roleKeys = [];
    try {
      const rbacPg = require('./lib/rbac/postgres');
      if (rbacPg.isAvailable && rbacPg.isAvailable()) {
        roleKeys = await rbacPg.getUserRoleKeys(cookieEmail);
      }
    } catch {
      roleKeys = [];
    }
    const primaryRole =
      userRecord.role ||
      (roleKeys.includes('hub_admin') ? 'hub_admin' : roleKeys[0]) ||
      (Array.isArray(userRecord.permissions) && userRecord.permissions.includes('hub_admin')
        ? 'hub_admin'
        : null) ||
      (Array.isArray(userRecord.permissions) && userRecord.permissions.includes('admin')
        ? 'admin'
        : null);

    return res.status(200).json({
      email: cookieEmail,
      name: userRecord.displayName || null,
      displayName: userRecord.displayName || null,
      firstName: userRecord.firstName || null,
      lastName: userRecord.lastName || null,
      role: primaryRole,
      role_keys: roleKeys,
      permissions: userRecord.permissions || [],
      bootstrap: !!userRecord.bootstrap,
      authenticated: true,
      autoProvisioned,
      ssoEnforced: true,
    });
  }

  // ---- Photo upload to private object storage (S3) ----
  if (path === '/photo-upload') {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed for /photo-upload' });
    }
    if (!objectStorage.isConfigured()) {
      return res.status(503).json({
        error: 'Object storage not configured',
        code: 'STORAGE_NOT_CONFIGURED',
      });
    }
    try {
      const filename = req.headers['x-filename'] || `photo-${Date.now()}.jpg`;
      const buf = await readRawBody(req);
      const validated = objectStorage.validateUploadBuffer({
        kind: 'photo',
        filename,
        contentType: req.headers['content-type'] || 'image/jpeg',
        byteLength: buf.length,
      });
      const key = objectStorage.buildPhotoObjectKey(validated.safeFilename);
      await objectStorage.putObject({
        key,
        body: buf,
        contentType: validated.contentType,
      });
      recordSecurityAudit('storage.photo_upload', {
        actor: auth.getActorEmail(req) || null,
        key,
        bytes: buf.length,
      });
      // Clients download via authenticated proxy — never a public bucket URL.
      return res.status(200).json({
        key,
        pathname: key,
        url: null,
        storage_provider: objectStorage.getStorageConfig().driver,
      });
    } catch (err) {
      return respondStorageError(res, err, 'Upload failed');
    }
  }

  // ---- Photo cleanup (delete photos older than 90 days) ----
  if (path === '/photo-cleanup') {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed for /photo-cleanup' });
    }
    // Optional shared-secret auth so random callers can't trigger cleanup
    if (process.env.CLEANUP_SECRET) {
      const provided = req.headers['x-cleanup-secret'] || req.query.secret;
      if (provided !== process.env.CLEANUP_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    if (!objectStorage.isConfigured()) {
      return res.status(503).json({
        error: 'Object storage not configured',
        code: 'STORAGE_NOT_CONFIGURED',
      });
    }
    try {
      const cutoff = new Date(Date.now() - PHOTO_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      const objects = await objectStorage.listObjects({ prefix: 'parts-photos/' });
      const toDelete = [];
      for (const obj of objects) {
        // Path looks like: parts-photos/2026-01-15/uuid_foo.jpg
        const datePart = String(obj.key || '').split('/')[1];
        if (datePart && datePart < cutoffStr) {
          toDelete.push(obj.key);
        }
      }
      if (toDelete.length > 0) {
        await objectStorage.deleteObjects({ keys: toDelete });
      }
      recordSecurityAudit('storage.photo_cleanup', {
        deleted: toDelete.length,
        cutoff: cutoffStr,
      });
      return res.status(200).json({
        deleted: toDelete.length,
        cutoff: cutoffStr,
        retainedDays: PHOTO_RETENTION_DAYS,
      });
    } catch (err) {
      return respondStorageError(res, err, 'Cleanup failed');
    }
  }

  // ---- One-shot orphaned-archive object cleanup ----
  // POST /api/maintainx?path=/archive-wipe-orphans&kind=jsa
  // Archives migrated to Redis/Postgres. Objects left under archive/{kind}/ are orphans.
  if (path && path.startsWith('/archive-wipe-orphans')) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed for /archive-wipe-orphans' });
    }
    if (process.env.CLEANUP_SECRET) {
      const provided = req.headers['x-cleanup-secret'] || req.query.secret;
      if (provided !== process.env.CLEANUP_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    const kind = req.query.kind;
    if (!['jsa', 'bol', 'swp'].includes(kind)) {
      return res.status(400).json({ error: 'kind must be one of: jsa, bol, swp' });
    }
    if (!objectStorage.isConfigured()) {
      return res.status(503).json({
        error: 'Object storage not configured',
        code: 'STORAGE_NOT_CONFIGURED',
      });
    }
    try {
      const objects = await objectStorage.listObjects({ prefix: `archive/${kind}/` });
      const keys = objects.map((o) => o.key);
      if (keys.length > 0) await objectStorage.deleteObjects({ keys });
      recordSecurityAudit('storage.archive_wipe_orphans', { kind, deleted: keys.length });
      return res.status(200).json({ kind, deleted: keys.length });
    } catch (err) {
      return respondStorageError(res, err, 'Wipe failed');
    }
  }

  // ---- Archive endpoints (JSA / BOL / SWP records) ----
  // POST   /api/maintainx?path=/archive/jsa            — save a JSA record
  // POST   /api/maintainx?path=/archive/bol            — save a BOL record
  // POST   /api/maintainx?path=/archive/swp            — save a Safe Work Permit (live)
  // GET    /api/maintainx?path=/archive/jsa            — list JSA metadata (paginated)
  // GET    /api/maintainx?path=/archive/bol            — list BOL metadata (paginated)
  // GET    /api/maintainx?path=/archive/swp            — list SWP metadata (paginated, ?status=live|closed)
  // GET    /api/maintainx?path=/archive/jsa/{id}       — fetch one full JSA
  // GET    /api/maintainx?path=/archive/bol/{id}       — fetch one full BOL
  // GET    /api/maintainx?path=/archive/swp/{id}       — fetch one full SWP
  // PATCH  /api/maintainx?path=/archive/swp/{id}       — update a live SWP (rejected if closed)
  // POST   /api/maintainx?path=/archive/swp/{id}/close — terminate a live SWP, mark closed
  // DELETE /api/maintainx?path=/archive/jsa/{id}       — delete (within 24h, by creator)
  // DELETE /api/maintainx?path=/archive/bol/{id}       — delete (within 24h, by creator)
  // DELETE /api/maintainx?path=/archive/swp/{id}       — delete (within 24h, by creator; live only)
  //
  // List query params (inline ?... in the path because of proxyUrl encoding):
  //   page, pageSize, search, from, to, creator, status (swp)
  //
  // Storage:  Redis/Postgres (string + sorted-set indexes). See readBlobArchiveRecord
  //          / writeBlobArchiveRecord / listBlobArchive helpers above.
  //          (Function names retain historical "Blob" wording; objects are not in S3.)
  //
  // SWP records have a status lifecycle: 'live' | 'closed'.
  // Live permits can be PATCH-edited any number of times. Closing flips the
  // status, records the termination signature + reason, and locks the record
  // from further edits. Closed records are read-only forever.
  const archivePathRaw = path;
  const archiveQueryIdx = archivePathRaw.indexOf('?');
  const archivePathOnly = archiveQueryIdx >= 0 ? archivePathRaw.slice(0, archiveQueryIdx) : archivePathRaw;
  const archiveInlineQuery = archiveQueryIdx >= 0
    ? new URLSearchParams(archivePathRaw.slice(archiveQueryIdx + 1))
    : null;
  const archiveMatch = archivePathOnly.match(/^\/archive\/(jsa|bol|swp)(?:\/([a-zA-Z0-9_-]+))?(\/close)?$/);
  if (archiveMatch) {
    const kind = archiveMatch[1];     // 'jsa' | 'bol' | 'swp'
    const id = archiveMatch[2];        // optional record id
    const subAction = archiveMatch[3]; // optional '/close' for SWP termination
    // /close sub-action only applies to swp
    if (subAction && kind !== 'swp') {
      return res.status(404).json({ error: '/close is only valid for /archive/swp/{id}' });
    }

    // WOS-80 — legacy archive RBAC/IDOR. Require an authenticated actor;
    // reads require the per-kind view permission (employees hold these), and
    // deletes require creator+24h or a privileged deleter (see DELETE branch).
    const authActor = await resolveActor(req);
    if (!authActor.actorEmail) return res.status(401).json({ error: 'Not authenticated' });
    const ARCHIVE_VIEW_PERM = { jsa: 'view_jsa_archive', bol: 'view_bol_archive', swp: null };
    const ARCHIVE_DELETE_PERM = { jsa: 'delete_jsa_archive', bol: 'delete_bol_archive', swp: null };
    if (req.method === 'GET') {
      const viewPerm = ARCHIVE_VIEW_PERM[kind];
      if (viewPerm && !hasAnyPermission(authActor.permissions, [viewPerm])) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    // Helper to read query-param flexibly (inline-?... or req.query)
    const qparam = (name) => (
      (archiveInlineQuery && archiveInlineQuery.get(name)) ||
      req.query?.[name] ||
      null
    );

    try {
      // ----- POST: create new record -----
      if (req.method === 'POST' && !id) {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        if (!body || typeof body !== 'object') {
          return res.status(400).json({ error: 'Invalid body — JSON object required' });
        }
        const now = new Date();
        // Generate a sortable id with a timestamp prefix — same shape as
        // before so URLs / external references continue to make sense.
        const yyyy = now.getUTCFullYear();
        const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(now.getUTCDate()).padStart(2, '0');
        const hh = String(now.getUTCHours()).padStart(2, '0');
        const mi = String(now.getUTCMinutes()).padStart(2, '0');
        const ss = String(now.getUTCSeconds()).padStart(2, '0');
        const uuid = Math.random().toString(36).slice(2, 10);
        const recordId = `${yyyy}-${mm}-${dd}-${hh}${mi}${ss}-${uuid}`;

        // Pull SSO identity from headers (same pattern as /me).
        const ssoEmail = auth.getActorEmail(req)
                      || req.headers['x-vercel-id-token-email']
                      || null;
        const ssoName = req.headers['x-vercel-user-name'] || null;

        const record = {
          id: recordId,
          kind,
          createdAt: now.toISOString(),
          ...(kind === 'swp' ? {
            status: 'live',
            updatedAt: now.toISOString(),
            updatedBy: { ssoEmail },
            closedAt: null,
            closedBy: null,
            terminationReasons: null,
            terminationSig: null,
          } : {}),
          createdBy: {
            ssoEmail,
            ssoName,
            formName: body.creatorName
                   || body.employeeName
                   || body.driverName
                   || body.employee
                   || body.driver
                   || null,
          },
          data: body,
        };

        await writeBlobArchiveRecord(kind, record);
        return res.status(200).json({ id: recordId });
      }

      // ----- GET (list): paginated, filtered list of records -----
      if (req.method === 'GET' && !id) {
        const opts = {
          page:     qparam('page'),
          pageSize: qparam('pageSize'),
          search:   qparam('search'),
          from:     qparam('from'),
          to:       qparam('to'),
          creator:  qparam('creator'),
        };
        if (kind === 'swp') {
          const s = (qparam('status') || '').toLowerCase();
          if (s === 'live' || s === 'closed') opts.status = s;
        }
        const result = await listBlobArchive(kind, opts);
        return res.status(200).json(result);
      }

      // ----- GET (single): return the full record -----
      if (req.method === 'GET' && id) {
        const rec = await readBlobArchiveRecord(kind, id);
        if (!rec) return res.status(404).json({ error: 'Record not found' });
        return res.status(200).json(rec);
      }

      // ----- PATCH (SWP only): update a live permit -----
      if (req.method === 'PATCH' && id && kind === 'swp' && !subAction) {
        const rec = await readBlobArchiveRecord(kind, id);
        if (!rec) return res.status(404).json({ error: 'Record not found' });
        if (rec.status === 'closed') {
          return res.status(409).json({ error: 'Cannot edit a closed permit' });
        }
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        if (!body || typeof body !== 'object') {
          return res.status(400).json({ error: 'Invalid body — JSON object required' });
        }
        const now = new Date();
        const ssoEmail = auth.getActorEmail(req)
                      || req.headers['x-vercel-id-token-email']
                      || null;
        rec.data = body;
        rec.updatedAt = now.toISOString();
        rec.updatedBy = { ssoEmail, ssoName: req.headers['x-vercel-user-name'] || null };

        await writeBlobArchiveRecord(kind, rec);
        return res.status(200).json({
          id: rec.id,
          updatedAt: rec.updatedAt,
          updatedBy: rec.updatedBy,
        });
      }

      // ----- POST /close (SWP only): terminate a live permit -----
      if (req.method === 'POST' && id && kind === 'swp' && subAction === '/close') {
        const rec = await readBlobArchiveRecord(kind, id);
        if (!rec) return res.status(404).json({ error: 'Record not found' });
        if (rec.status === 'closed') {
          return res.status(409).json({ error: 'Permit already closed' });
        }
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        if (!body || typeof body !== 'object') {
          return res.status(400).json({ error: 'Invalid body — JSON object required' });
        }
        const reasons = Array.isArray(body.terminationReasons) ? body.terminationReasons : [];
        if (reasons.length === 0) {
          return res.status(400).json({ error: 'At least one termination reason is required' });
        }
        if (!body.terminationSig) {
          return res.status(400).json({ error: 'Termination signature is required' });
        }

        const now = new Date();
        const ssoEmail = auth.getActorEmail(req)
                      || req.headers['x-vercel-id-token-email']
                      || null;
        rec.status = 'closed';
        rec.closedAt = now.toISOString();
        rec.closedBy = { ssoEmail, ssoName: req.headers['x-vercel-user-name'] || null };
        rec.terminationReasons = reasons;
        rec.terminationSig    = body.terminationSig;
        rec.terminationName   = body.terminationName || null;
        rec.terminationDate   = body.terminationDate || now.toISOString();
        if (body.data && typeof body.data === 'object') {
          rec.data = body.data;
          rec.updatedAt = now.toISOString();
          rec.updatedBy = rec.closedBy;
        }

        // writeBlobArchiveRecord handles the live→closed sorted-set
        // shuffle automatically based on rec.status.
        await writeBlobArchiveRecord(kind, rec);
        return res.status(200).json({
          id: rec.id,
          status: rec.status,
          closedAt: rec.closedAt,
          closedBy: rec.closedBy,
        });
      }

      // ----- DELETE: only within 24h, only by creator -----
      if (req.method === 'DELETE' && id) {
        const rec = await readBlobArchiveRecord(kind, id);
        if (!rec) return res.status(404).json({ error: 'Record not found' });
        if (kind === 'swp' && rec.status === 'closed') {
          return res.status(403).json({ error: 'Closed permits cannot be deleted' });
        }
        // WOS-80 — privileged deleters (admin or delete_*_archive) may remove
        // any record and override the 24h window. Everyone else must be the
        // original recorded creator AND within 24h. Records with no recorded
        // creator can only be deleted by a privileged actor (closes the prior
        // gap where a missing createdBy let any authed user delete).
        const deletePerm = ARCHIVE_DELETE_PERM[kind];
        const privileged = authActor.isAdmin
          || (deletePerm && hasAnyPermission(authActor.permissions, [deletePerm]));
        if (!privileged) {
          const created = new Date(rec.createdAt).getTime();
          const ageHours = (Date.now() - created) / (1000 * 60 * 60);
          if (ageHours > 24) {
            return res.status(403).json({
              error: 'Records older than 24 hours cannot be deleted',
              ageHours: Math.round(ageHours),
            });
          }
          const creatorEmail = (rec.createdBy?.ssoEmail || '').toLowerCase();
          if (!creatorEmail || creatorEmail !== authActor.actorEmail.toLowerCase()) {
            return res.status(403).json({ error: 'Only the creator or an admin can delete this record' });
          }
        }
        await deleteBlobArchiveRecord(kind, id);
        return res.status(200).json({ deleted: true, id });
      }

      return res.status(405).json({ error: 'Method not allowed for archive path' });
    } catch (err) {
      console.error('Archive error:', err);
      return res.status(500).json({ error: 'Archive operation failed', detail: err.message });
    }
  }

  // ---- Vendor management endpoints ----
  // POST   /vendor-auth                    — verify passcode, return session token
  // GET    /vendor-session                 — verify current session token (for resume)
  // GET    /vendors                        — list all vendors (metadata + summary)
  // POST   /vendors                        — create a new vendor record
  // GET    /vendors/{ref}                  — fetch full record by reference number
  // PUT    /vendors/{ref}                  — update record (status, notes, etc.)
  // GET    /vendors/{ref}/zip              — download all docs for a vendor as a ZIP
  // GET    /vendors/{ref}/record           — printable HTML vendor record
  // POST   /vendor-docs/{ref}/{filename}   — upload a document to a vendor record
  // GET    /vendor-doc?url=...             — proxy-fetch a doc (so blob URL stays private)
  // DELETE /vendor-docs/{ref}/{filename}   — delete an uploaded doc

  // ---- Auth: verify passcode, issue session token ----
  if (path === '/vendor-auth') {
    if ((process.env.NODE_ENV || '').toLowerCase() === 'production') {
      return res.status(404).json({ error: 'Not found' });
    }
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    if (!process.env.VENDOR_ACCESS_CODE) {
      return res.status(500).json({ error: 'Server misconfigured: VENDOR_ACCESS_CODE not set' });
    }
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const submitted = (body.passcode || '').toString();
    const expected = process.env.VENDOR_ACCESS_CODE;
    // Constant-time comparison
    let ok = false;
    if (submitted.length === expected.length) {
      try {
        ok = crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(expected));
      } catch { ok = false; }
    }
    if (!ok) {
      // Brief delay to slow down brute-force a bit (best-effort; serverless cold starts vary)
      await new Promise(r => setTimeout(r, 400));
      return res.status(401).json({ error: 'Invalid passcode' });
    }
    const stayHours = body.staySignedIn ? VENDOR_SESSION_HOURS : 1; // session-only ≈ 1h
    const token = issueVendorToken(stayHours * 60 * 60 * 1000);
    return res.status(200).json({
      token,
      expiresInMs: stayHours * 60 * 60 * 1000,
    });
  }

  if (path === '/vendor-session') {
    if ((process.env.NODE_ENV || '').toLowerCase() === 'production') {
      return res.status(404).json({ error: 'Not found' });
    }
    // Lightweight check used by the portal on page load to see if an existing
    // token is still valid (avoids prompting the user again unnecessarily).
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const token = req.headers['x-vendor-session'] || '';
    return res.status(200).json({ valid: verifyVendorToken(token) });
  }

  // All paths below require a valid session token.
  const vendorMatch = path.match(/^\/vendors(?:\/([A-Za-z0-9_-]+))?$/);
  const vendorWorkflowMatch = path.match(/^\/vendors\/([A-Za-z0-9_-]+)\/workflow$/);
  const vendorDocStatusMatch = path.match(/^\/vendors\/([A-Za-z0-9_-]+)\/documents\/status$/);
  const vendorZipMatch = path.match(/^\/vendors\/([A-Za-z0-9_-]+)\/zip$/);
  const vendorRecordMatch = path.match(/^\/vendors\/([A-Za-z0-9_-]+)\/record$/);
  const vendorDocMatch = path.match(/^\/vendor-docs\/([A-Za-z0-9_-]+)\/(.+)$/);
  const vendorDocFetchMatch = path.match(/^\/vendor-doc(?:\?.*)?$/);

  if (vendorMatch || vendorWorkflowMatch || vendorDocStatusMatch || vendorZipMatch || vendorRecordMatch || vendorDocMatch || vendorDocFetchMatch) {
    // RBAC (production): enforce authenticated user permissions server-side.
    // Vendor passcode sessions are dev-only and no longer the production security model.
    let ctx = null;
    const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';
    const isWorkflowPost = vendorWorkflowMatch && req.method === 'POST';
    const isDocStatusPost = vendorDocStatusMatch && req.method === 'POST';
    if (isProd && !isWorkflowPost && !isDocStatusPost) {
      const isRead =
        (vendorMatch && req.method === 'GET') ||
        (vendorZipMatch && req.method === 'GET') ||
        (vendorRecordMatch && req.method === 'GET') ||
        (vendorDocFetchMatch && req.method === 'GET');
      const needed = ['view_management'];
      if (isRead) {
        needed.push('view_vendor_list', 'view_vendor_documents');
      }
      if (vendorMatch && req.method === 'POST' && !vendorMatch[1]) needed.push('submit_new_vendor');
      if (vendorMatch && req.method === 'PUT' && vendorMatch[1]) {
        needed.push('edit_vendor_info', 'edit_vendor_workflow', 'edit_vendor_compliance');
      }
      if (vendorDocMatch && (req.method === 'POST' || req.method === 'DELETE')) needed.push('manage_vendor_documents');
      ctx = await requirePermissions(req, res, needed);
      if (!ctx) return;
    } else {
      if (!requireVendorAuth(req, res)) return;
    }

    const needsObjectStorage =
      (vendorDocMatch && (req.method === 'POST' || req.method === 'DELETE')) ||
      (vendorDocFetchMatch && req.method === 'GET') ||
      (vendorZipMatch && req.method === 'GET') ||
      (vendorMatch && req.method === 'GET') ||
      (vendorRecordMatch && req.method === 'GET');
    if (needsObjectStorage && !objectStorage.isConfigured() && objectStorage.getStorageConfig().deployed) {
      return res.status(503).json({
        error: 'Object storage not configured',
        code: 'STORAGE_NOT_CONFIGURED',
      });
    }

    try {
      // ----- POST /vendors : create record -----
      if (vendorMatch && req.method === 'POST' && !vendorMatch[1]) {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        if (!body || typeof body !== 'object') {
          return res.status(400).json({ error: 'Invalid body' });
        }

        const record = buildVendorRecordFromBody(body, {
          actorEmail: auth.getActorEmail(req) || null,
          actorName: req.headers['x-vercel-user-name'] || null,
        });
        enrichVendorRecord(record);

        await writeVendorRecord(record.refNumber, record);

        notifyVendorWorkflowEvent({
          notifyKey: 'new_vendor_rebekah',
          record,
          actor: auth.getActorEmail(req) || record.requestedBy,
        }).catch(err => console.error('[vendor-notify] create notify failed:', err));

        return res.status(200).json({
          refNumber: record.refNumber,
          overallStatus: record.overallStatus,
          adminStatus: record.adminStatus,
          assignedTo: record.assignedTo,
          actionRequired: getVendorActionRequired(record),
          documentSummary: record.documentSummary,
          requiredDocumentsComplete: record.requiredDocumentsComplete,
        });
      }

      // ----- POST /vendors/{ref}/documents/status : update document status -----
      if (vendorDocStatusMatch && req.method === 'POST') {
        const ref = vendorDocStatusMatch[1];
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        const updates = Array.isArray(body.updates) ? body.updates : [body];
        if (!updates.length || !updates[0].docType) {
          return res.status(400).json({ error: 'Missing docType' });
        }

        const docType = updates[0].docType;
        if (isProd) {
          ctx = await requirePermissions(req, res, permissionsForDocType(docType));
          if (!ctx) return;
        }

        const actor = auth.getActorEmail(req) || body.actorName || 'unknown';
        const result = await withVendorLock(ref, async () => {
          const found = await readVendorRecord(ref);
          if (!found) return { error: 404, message: 'Vendor not found' };
          const wasComplete = isRequiredDocumentsComplete(found.record);
          const changes = [];
          for (const u of updates) {
            if (!u.docType) continue;
            const r = updateDocumentStatus(found.record, u.docType, u.status, actor, { note: u.note });
            if (r.ok && !r.unchanged) changes.push(r);
          }
          if (!changes.length) return { unchanged: true, record: found.record };
          await writeVendorRecord(ref, found.record);
          enrichVendorRecord(found.record);
          return { changes, record: found.record, wasDocsComplete: wasComplete };
        });

        if (result.error === 404) return res.status(404).json({ error: result.message });
        if (result.unchanged) return res.status(200).json({ unchanged: true });

        const v = await hydrateVendorForApi(result.record, ref);
        for (const ch of result.changes || []) {
          notifyAfterDocumentChange(v, {
            docType: ch.docType,
            newStatus: ch.newStatus,
            actor,
            wasDocsComplete: result.wasDocsComplete,
          }).catch(err => console.error('[vendor-notify] doc status notify failed:', err));
        }
        return res.status(200).json({ ok: true, changes: result.changes, record: v });
      }

      // ----- POST /vendors/{ref}/workflow : explicit workflow transition -----
      if (vendorWorkflowMatch && req.method === 'POST') {
        const ref = vendorWorkflowMatch[1];
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        const action = body.action;
        if (!action || typeof action !== 'string') {
          return res.status(400).json({ error: 'Missing workflow action' });
        }

        if (isProd) {
          ctx = await requirePermissions(req, res, permissionsForWorkflowAction(action));
          if (!ctx) return;
        }

        const actor = auth.getActorEmail(req) || body.actorName || 'unknown';
        const result = await withVendorLock(ref, async () => {
          const found = await readVendorRecord(ref);
          if (!found) return { error: 404, message: 'Vendor not found' };

          const transition = applyVendorWorkflowTransition(found.record, action, actor, {
            note: body.note,
            status: body.status,
            msaRequired: body.msaRequired,
            ndaRequired: body.ndaRequired,
            adminComplete: body.adminComplete,
            w9Status: body.w9Status,
            bankingStatus: body.bankingStatus,
            insuranceStatus: body.insuranceStatus,
            documentMeta: body.documentMeta,
          });

          if (!transition.ok) {
            return { error: 400, message: transition.error, detail: transition.detail };
          }

          await writeVendorRecord(ref, transition.record);
          return transition;
        });

        if (result.error === 404) return res.status(404).json({ error: result.message });
        if (result.error === 400) {
          return res.status(400).json({ error: result.message, detail: result.detail });
        }

        const v = result.record;
        await hydrateVendorForApi(v, ref);

        if (result.notify) {
          notifyVendorWorkflowEvent({
            notifyKey: result.notify,
            record: v,
            actor,
            note: body.note,
            warnings: result.warnings,
          }).catch(err => console.error('[vendor-notify] workflow notify failed:', err));
        }

        return res.status(200).json({
          ok: true,
          action: result.action,
          refNumber: ref,
          previous: result.previous,
          next: result.next,
          warnings: result.warnings || [],
          requiredDocumentsComplete: v.requiredDocumentsComplete,
          missingRequiredDocuments: v.missingRequiredDocuments,
          documentSummary: v.documentSummary,
          nextAction: v.nextAction,
          notificationSummary: v.notificationSummary,
          record: v,
        });
      }

      // ----- GET /vendors : list all -----
      if (vendorMatch && req.method === 'GET' && !vendorMatch[1]) {
        const records = await getAllVendorRecords();
        const summaries = records.map(v => {
          enrichVendorRecord(v);
          const overallStatus = deriveOverallStatus(v);
          const item = enrichVendorSummary({
            refNumber:      v.refNumber,
            createdAt:      v.createdAt,
            companyName:    v.companyName,
            entityType:     v.entityType,
            contactName:    v.contactName,
            requestedBy:    v.requestedBy,
            apStatus:       v.apStatus,
            contractStatus: v.contractStatus,
            assignedTo:     v.assignedTo,
            adminStatus:    v.adminStatus,
            overallStatus:  v.overallStatus,
            w9Status:       v.w9Status,
            bankingStatus:  v.bankingStatus,
            insuranceStatus:v.insuranceStatus,
            msaStatus:      v.msaStatus,
            ndaStatus:      v.ndaStatus,
            documentCount:  Array.isArray(v.documents) ? v.documents.length : 0,
            lastActionDate: v.lastActionDate,
            documentSummary: v.documentSummary,
            missingRequiredDocuments: v.missingRequiredDocuments,
            requiredDocumentsComplete: v.requiredDocumentsComplete,
            nextAction: v.nextAction,
            assignedOwnerLabel: v.assignedOwnerLabel,
            notificationSummary: v.notificationSummary,
          }, overallStatus);
          return attachWorkflowFields(item);
        });
        // Sort newest first (mget preserves order from zrange which is already
        // sorted by createdAt desc, but be defensive)
        summaries.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        return res.status(200).json({ records: summaries });
      }

      // ----- GET /vendors/{ref} : fetch one -----
      if (vendorMatch && req.method === 'GET' && vendorMatch[1]) {
        const ref = vendorMatch[1];
        const found = await readVendorRecord(ref);
        if (!found) return res.status(404).json({ error: 'Vendor not found' });
        const v = found.record;
        await hydrateVendorForApi(v, ref);
        return res.status(200).json(v);
      }

      // ----- PUT /vendors/{ref} : update -----
      if (vendorMatch && req.method === 'PUT' && vendorMatch[1]) {
        const ref = vendorMatch[1];
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

        const result = await withVendorLock(ref, async () => {
          const found = await readVendorRecord(ref);
          if (!found) return { error: 404, message: 'Vendor not found' };
          const v = found.record;

          // Whitelist fields the client is allowed to change. createdAt/createdBy/refNumber
          // are immutable. Status/notes/etc. are mutable.
          const mutable = [
            'companyName', 'entityType', 'contactName', 'contactEmail', 'contactPhone',
            'physicalAddress', 'billingAddress', 'apContact', 'taxId',
            'poRequired', 'stateTaxExempt', 'veriforceAccount', 'ssqId',
            'requestedCreditLimit', 'creditNotes',
            'serviceDescription', 'physicalLocations', 'servicingLocations',
            'msaRequired', 'ndaRequired', 'systemSetup', 'financialNotes',
            'overallStatus', 'adminStatus',
            'apStatus', 'contractStatus', 'assignedTo',
            'w9Status', 'bankingStatus', 'insuranceStatus',
            'msaStatus', 'ndaStatus', 'documentMeta',
          ];
          const changes = [];
          mutable.forEach(f => {
            if (f in body && JSON.stringify(body[f]) !== JSON.stringify(v[f])) {
              changes.push({ field: f, from: v[f], to: body[f] });
              v[f] = body[f];
            }
          });

          // Read the optional note. Trim defensively in case the client didn't.
          const noteRaw = body.historyNote != null ? String(body.historyNote) : '';
          const note = noteRaw.trim();

          // No changes AND no note → nothing to do
          if (changes.length === 0 && !note) {
            return { unchanged: true };
          }

          const now = new Date();
          v.lastActionDate = now.toISOString();
          v.history = v.history || [];

          // Use a more descriptive event when the user's only action was a note
          const eventType = (changes.length === 0 && note) ? 'note_added' : 'updated';
          v.history.push({
            at: now.toISOString(),
            event: eventType,
            by: auth.getActorEmail(req) || body.actorName || 'unknown',
            changes,
            note,
          });

          console.log(`[vendor] PUT ${ref}: ${changes.length} field changes, note: ${note ? '"' + note.slice(0, 60) + '"' : '(none)'}`);

          await writeVendorRecord(ref, v);
          ensureDocumentMeta(v);
          await hydrateVendorForApi(v, ref);
          return { changes, record: v };
        });

        if (result.error) return res.status(result.error).json({ error: result.message });
        if (result.unchanged) return res.status(200).json({ unchanged: true });

        // If assignment changed, notify the new assignee via outbox (fire-and-forget)
        const assignmentChange = result.changes.find(c => c.field === 'assignedTo');
        if (assignmentChange && assignmentChange.to && assignmentChange.to !== 'complete') {
          const actor = auth.getActorEmail(req) || body.actorName || 'unknown';
          queueVendorWorkflowNotification({
            channel: 'assigned',
            record: result.record,
            assigneeRole: assignmentChange.to,
            actorEmail: actor,
            note: body.historyNote || '',
            email: buildVendorAssignedEmail(result.record, assignmentChange.to, actor, body.historyNote || ''),
          }).catch(err => console.error('[vendor-notify] assignment notify failed:', err));
        }

        // Return the full updated record so the client can patch its UI without
        // needing a follow-up GET (which can hit Vercel Blob's eventual-consistency
        // window and return stale data).
        return res.status(200).json({
          ok: true,
          refNumber: ref,
          changes: result.changes,
          record: result.record,
        });
      }

      // ----- GET /vendors/{ref}/record : printable HTML record -----
      // Returns a self-contained HTML document with print-optimized CSS.
      // Recipients can open it in any browser, then File → Print → Save as PDF.
      if (vendorRecordMatch && req.method === 'GET') {
        const ref = vendorRecordMatch[1];
        const found = await readVendorRecord(ref);
        if (!found) return res.status(404).json({ error: 'Vendor not found' });
        const v = found.record;
        v.overallStatus = deriveOverallStatus(v);
        const docs = await listVendorDocuments(ref);
        const html = generateVendorRecordHtml(v, docs);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).send(html);
      }

      // ----- GET /vendors/{ref}/zip : download all docs as ZIP -----
      // Always includes a Vendor-Record.html with the full vendor info, even
      // for vendors with zero docs (so the ZIP is never empty).
      if (vendorZipMatch && req.method === 'GET') {
        const ref = vendorZipMatch[1];
        const found = await readVendorRecord(ref);
        if (!found) return res.status(404).json({ error: 'Vendor not found' });
        const v = found.record;
        v.overallStatus = deriveOverallStatus(v);

        const docs = await listVendorDocuments(ref);

        const JSZip = require('jszip');
        const zip = new JSZip();

        // Folder name = company name (sanitized) or fall back to ref number
        const folderRaw = (v.companyName || ref).trim();
        const folderName = folderRaw.replace(/[^a-zA-Z0-9._\- ]/g, '').slice(0, 60) || ref;
        const folder = zip.folder(folderName);

        // Always include the printable record at the root of the company folder.
        const recordHtml = generateVendorRecordHtml(v, docs);
        folder.file('Vendor-Record.html', recordHtml);

        // Map of how many times we've used a kind+filename combo, to disambiguate
        const usedNames = new Map();
        for (const d of docs) {
          try {
            if (!d.key) {
              console.warn(`[zip] Skipping ${d.filename}: missing object key`);
              continue;
            }
            console.log(`[zip] Fetching: ${d.filename} (kind=${d.kind}, key=${d.key})`);
            const obj = await objectStorage.getObject({ key: d.key });
            const responseContentType = obj.contentType || '';
            const buf = obj.body;
            console.log(`[zip]   → ${buf.length} bytes, content-type: ${responseContentType}`);

            if (responseContentType.includes('text/html')) {
              console.warn(`[zip] SKIPPING ${d.filename} — object content-type is HTML (${responseContentType})`);
              continue;
            }

            // Filename inside zip: kind in CAPS + original filename
            // Example: W9_form.pdf, BANKING_voided-check.pdf
            const kindPrefix = (d.kind || 'other').toUpperCase().replace(/[^A-Z0-9]/g, '');
            let baseFilename = d.filename;
            if (!/\.[A-Za-z0-9]{1,8}$/.test(baseFilename)) {
              const ext = extensionFromContentType(responseContentType);
              if (ext) baseFilename = baseFilename + ext;
              console.log(`[zip]   filename had no extension, padded to: ${baseFilename}`);
            }
            let filename = `${kindPrefix}_${baseFilename}`;
            // Disambiguate duplicates (e.g., two W9s)
            const used = usedNames.get(filename) || 0;
            if (used > 0) {
              const dotIdx = filename.lastIndexOf('.');
              if (dotIdx > 0) {
                filename = filename.slice(0, dotIdx) + `(${used + 1})` + filename.slice(dotIdx);
              } else {
                filename = filename + `(${used + 1})`;
              }
            }
            usedNames.set(filename, used + 1);
            folder.file(filename, buf, { binary: true });
            console.log(`[zip]   → added as ${filename}`);
          } catch (e) {
            console.warn(`[zip] Skipping doc ${d.filename}:`, e.message);
          }
        }

        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

        // Set headers and stream the ZIP
        const downloadName = folderName + '.zip';
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${downloadName.replace(/"/g, '')}"`);
        res.setHeader('Content-Length', zipBuffer.length);
        return res.status(200).send(zipBuffer);
      }

      // ----- POST /vendor-docs/{ref}/{filename} : upload doc -----
      if (vendorDocMatch && req.method === 'POST') {
        const ref = vendorDocMatch[1];
        const filename = vendorDocMatch[2];
        if (!objectStorage.isConfigured()) {
          return res.status(503).json({
            error: 'Object storage not configured',
            code: 'STORAGE_NOT_CONFIGURED',
          });
        }
        const buf = await readRawBody(req);
        let validated;
        try {
          validated = objectStorage.validateUploadBuffer({
            kind: 'vendor_doc',
            filename,
            contentType: req.headers['content-type'] || 'application/octet-stream',
            byteLength: buf.length,
          });
        } catch (err) {
          return respondStorageError(res, err, 'Invalid upload');
        }

        const kind = (
          req.query.docType ||
          req.query.kind ||
          req.headers['x-doc-kind'] ||
          'other'
        ).replace(/[^a-z0-9_-]/gi, '');
        const docKey = objectStorage.buildVendorDocObjectKey(ref, kind, validated.safeFilename);
        try {
          await objectStorage.putObject({
            key: docKey,
            body: buf,
            contentType: validated.contentType,
          });
        } catch (err) {
          return respondStorageError(res, err, 'Upload failed');
        }

        recordSecurityAudit('storage.vendor_doc_upload', {
          actor: auth.getActorEmail(req) || null,
          ref,
          key: docKey,
          kind,
          bytes: buf.length,
        });

        // Append a history entry under the vendor lock. If this fails, the doc
        // is still uploaded and discoverable via object listing — we just lose the
        // history note. That's a much smaller failure than losing the doc itself.
        const updatedRecord = await withVendorLock(ref, async () => {
          const found = await readVendorRecord(ref);
          if (!found) return null;
          const v = found.record;
          const actor = auth.getActorEmail(req) || 'unknown';
          const wasComplete = isRequiredDocumentsComplete(v);
          const uploadResult = attachUploadedFile(v, kind, {
            filename: validated.safeFilename,
            size: buf.length,
            uploadedAt: new Date().toISOString(),
          }, actor);
          await writeVendorRecord(ref, v);
          await hydrateVendorForApi(v, ref);
          return { v, uploadResult, wasDocsComplete: wasComplete };
        });

        if (updatedRecord?.v) {
          notifyAfterDocumentChange(updatedRecord.v, {
            docType: updatedRecord.uploadResult?.docType || kind,
            newStatus: updatedRecord.uploadResult?.newStatus || 'received',
            actor: auth.getActorEmail(req) || 'unknown',
            wasDocsComplete: updatedRecord.wasDocsComplete,
          }).catch(err => console.error('[vendor-notify] upload notify failed:', err));
        }

        return res.status(200).json({
          filename: validated.safeFilename,
          key: docKey,
          url: null,
          storage_provider: objectStorage.getStorageConfig().driver,
          record: updatedRecord?.v || updatedRecord,
        });
      }

      // ----- DELETE /vendor-docs/{ref}/{filename} : remove a doc -----
      if (vendorDocMatch && req.method === 'DELETE') {
        const ref = vendorDocMatch[1];
        const filename = decodeURIComponent(vendorDocMatch[2]);

        if (!objectStorage.isConfigured()) {
          return res.status(503).json({
            error: 'Object storage not configured',
            code: 'STORAGE_NOT_CONFIGURED',
          });
        }

        const allDocs = await listVendorDocuments(ref);
        const doc = allDocs.find(
          (d) => d.filename === filename || (d.key && d.key.endsWith(filename))
        );
        if (!doc || !doc.key) {
          return res.status(404).json({ error: 'Document not found' });
        }

        try {
          objectStorage.assertVendorDocKey(doc.key, ref);
          await objectStorage.deleteObject({ key: doc.key });
        } catch (e) {
          console.warn('Object delete failed:', e.message);
          return respondStorageError(res, e, 'Delete failed');
        }

        recordSecurityAudit('storage.vendor_doc_delete', {
          actor: auth.getActorEmail(req) || null,
          ref,
          key: doc.key,
          filename: doc.filename,
        });

        const updatedRecord = await withVendorLock(ref, async () => {
          const found = await readVendorRecord(ref);
          if (!found) return null;
          const v = found.record;
          v.lastActionDate = new Date().toISOString();
          v.history = v.history || [];
          v.history.push({
            at: new Date().toISOString(),
            event: 'doc_deleted',
            by: auth.getActorEmail(req) || 'unknown',
            note: `Deleted ${doc.filename}`,
          });
          await writeVendorRecord(ref, v);
          await hydrateVendorForApi(v, ref);
          return v;
        });

        return res.status(200).json({ deleted: true, record: updatedRecord });
      }

      // ----- GET /vendor-doc?key=... : authorized download from private storage -----
      // Optional: ?presign=1 returns a short-lived presigned GET URL (S3 only).
      if (vendorDocFetchMatch && req.method === 'GET') {
        const objectKey = req.query.key;
        if (!objectKey || typeof objectKey !== 'string') {
          return res.status(400).json({ error: 'Missing key param' });
        }
        if (!objectStorage.isConfigured()) {
          return res.status(503).json({
            error: 'Object storage not configured',
            code: 'STORAGE_NOT_CONFIGURED',
          });
        }

        let key;
        try {
          key = objectStorage.assertAllowedObjectKey(objectKey, {
            allowedPrefixes: ['vendor-docs/'],
          });
        } catch (err) {
          return respondStorageError(res, err, 'Invalid key');
        }

        const ref = key.split('/')[1];
        if (!ref) {
          return res.status(400).json({ error: 'Invalid object key' });
        }

        // Isolation: object must exist under this vendor and be listed for the ref.
        const docs = await listVendorDocuments(ref);
        const owned = docs.find((d) => d.key === key);
        if (!owned) {
          return res.status(404).json({ error: 'Document not found' });
        }

        recordSecurityAudit('storage.vendor_doc_download', {
          actor: auth.getActorEmail(req) || null,
          ref,
          key,
          presign: req.query.presign === '1',
        });

        if (req.query.presign === '1') {
          try {
            const signed = await objectStorage.getPresignedGetUrl({ key });
            return res.status(200).json({
              url: signed.url,
              expiresIn: signed.expiresIn,
              key,
            });
          } catch (err) {
            return respondStorageError(res, err, 'Presign failed');
          }
        }

        try {
          const obj = await objectStorage.getObject({ key });
          res.setHeader('Content-Type', obj.contentType || 'application/octet-stream');
          res.setHeader('Cache-Control', 'private, no-store');
          if (owned.filename) {
            res.setHeader(
              'Content-Disposition',
              `inline; filename="${String(owned.filename).replace(/"/g, '')}"`
            );
          }
          return res.status(200).send(obj.body);
        } catch (err) {
          return respondStorageError(res, err, 'Download failed');
        }
      }

      return res.status(405).json({ error: 'Method not allowed for vendor path' });
    } catch (err) {
      console.error('Vendor endpoint error:', err);
      if (err.code === 'STORAGE_NOT_CONFIGURED') {
        return res.status(503).json({
          error: 'Object storage not configured',
          code: 'STORAGE_NOT_CONFIGURED',
        });
      }
      return res.status(500).json({ error: 'Vendor operation failed', detail: err.message });
    }
  }

  // ---- Integrations health (Management > Integrations; vendor session) ----
  if (path === '/integrations-status' && req.method === 'GET') {
    const ctx = await requirePermissions(req, res, ['hub_admin', 'admin', 'view_management']);
    if (!ctx) return;
    const notificationAutomation =
      process.env.N8N_WEBHOOK_NOTIFICATION_CREATED || process.env.N8N_WEBHOOK_DEFAULT
        ? 'configured'
        : 'not_configured';
    let pendingAutomation = 0;
    let dataStoreStatus = 'not_configured';
    let dataStoreLabel = 'Request & document storage';
    let hubStoreMode = 'local_json';
    try {
      const hubStore = require('./lib/hub/db/index.js');
      hubStoreMode = hubStore.getHubStoreMode();
      const hubMode = hubStoreMode;
      if (hubMode === 'postgres') {
        const pg = await hubStore.checkHubStoreHealth();
        dataStoreStatus = pg.store_ok ? 'postgres_connected' : 'postgres_error';
        dataStoreLabel = `PostgreSQL (${pg.postgres?.connected ? 'connected' : 'disconnected'})`;
        if (typeof hubStore.countPendingIntegrationEvents === 'function') {
          pendingAutomation = await hubStore.countPendingIntegrationEvents();
        }
      } else {
        if (typeof hubStore.countPendingIntegrationEvents === 'function') {
          pendingAutomation = await hubStore.countPendingIntegrationEvents();
        } else {
          pendingAutomation = (await redis.zcard('hub:integration_events:pending')) || 0;
        }
        dataStoreStatus =
          process.env.UPSTASH_REDIS_REST_URL ||
          process.env.KV_REST_API_URL ||
          process.env.HUB_USE_LOCAL_STORE
            ? 'configured'
            : 'not_configured';
        dataStoreLabel =
          hubMode === 'local_json' ? 'Local JSON store' : 'Redis / Upstash';
      }
    } catch {
      pendingAutomation = 0;
    }
    return res.status(200).json({
      portal: { status: 'online', label: 'Operations portal' },
      maintainx: {
        status: process.env.MAINTAINX_API_KEY ? 'configured' : 'not_configured',
        label: 'MaintainX API',
        message: process.env.MAINTAINX_API_KEY
          ? 'MaintainX API key is configured on the server.'
          : 'Set MAINTAINX_API_KEY in the server environment and restart to enable MaintainX sync.',
      },
      object_storage: (() => {
        const st = objectStorage.getStatus();
        return {
          status: st.configured ? 'configured' : 'not_configured',
          label: 'Amazon S3 object storage',
          driver: st.driver,
          message: st.message,
        };
      })(),
      data_store: {
        status: dataStoreStatus,
        label: dataStoreLabel,
        hub_store_mode: hubStoreMode,
      },
      notification_delivery: {
        status: notificationAutomation,
        label: 'Notification delivery (automation)',
      },
      pending_automation_events: pendingAutomation,
    });
  }

  // ---- Organization SSO admin (Management panel) ----
  if (path.startsWith('/sso-admin/')) {
    const ctx = await requirePermissions(req, res, ['hub_admin', 'admin', 'view_management']);
    if (!ctx) return;
    const handled = await loadSsoHandlers().handleSsoAdminRoute(path, req, res, {
      requireVendorAuth: () => true,
    });
    if (handled !== false) return;
  }

  // ---- User permissions endpoints ----
  // GET    /users                          — list all users + their permissions
  // GET    /users/me                       — current signed-in user (placeholder pre-SSO)
  // GET    /permissions-catalog            — list of permission ids/labels/groups
  // GET    /users/:email/permissions       — single user's permissions
  // PUT    /users/:email/permissions       — replace a user's permissions (requires admin)
  // DELETE /users/:email                   — remove a user (requires admin)
  // GET    /users/audit                    — recent permissions changes
  //
  // These are gated by the same vendor session token as the management section.
  // Once SSO is wired up, the `actor` will come from the verified Microsoft
  // identity instead of a header.
  const usersMatch = path.match(/^\/users(?:\/([^?]+))?(?:\?.*)?$/);
  const permsCatalogMatch = path === '/permissions-catalog' || path.startsWith('/permissions-catalog?');

  if (usersMatch || permsCatalogMatch) {
    const ctx = await requirePermissions(req, res, ['admin']);
    if (!ctx) return;

    try {
      // GET /permissions-catalog
      if (permsCatalogMatch && req.method === 'GET') {
        // Group by section for the UI
        const grouped = {};
        for (const p of PERMISSION_CATALOG) {
          grouped[p.group] = grouped[p.group] || [];
          grouped[p.group].push({ id: p.id, label: p.label });
        }
        return res.status(200).json({
          catalog: PERMISSION_CATALOG,
          grouped,
          bootstrapAdmins: getBootstrapAdmins(),
        });
      }

      const sub = usersMatch ? usersMatch[1] : null; // null, "me", "audit", "{email}", or "{email}/permissions"

      // GET /users — list all users
      if (usersMatch && !sub && req.method === 'GET') {
        const users = await listAllUsers();
        return res.status(200).json({ users, bootstrapAdmins: getBootstrapAdmins() });
      }

      // GET /users/me — current user's permissions
      // Placeholder: until SSO is wired, returns the actor email (or 'unknown')
      // and resolves their permissions. Bootstrap admins get full access.
      if (sub === 'me' && req.method === 'GET') {
        const actorEmail = (auth.getActorEmail(req) || '').toLowerCase();
        if (actorEmail) {
          const perms = await getUserPermissions(actorEmail);
          if (perms) return res.status(200).json({ ...perms, signedIn: true });
          return res.status(200).json({
            email: actorEmail,
            permissions: [],
            signedIn: true,
            unknown: true,
          });
        }
        // No identity available pre-SSO: return a special "no-auth-yet" payload.
        // The portal treats this as "all features visible, no enforcement" so
        // the existing experience continues to work until SSO lands.
        return res.status(200).json({
          email: null,
          permissions: ALL_PERMISSION_IDS.slice(),
          signedIn: false,
          ssoEnabled: false,
        });
      }

      // GET /users/audit
      if (sub === 'audit' && req.method === 'GET') {
        const limit = Math.min(parseInt(req.query?.limit || '100', 10) || 100, 500);
        const entries = await getPermissionsAuditLog(limit);
        return res.status(200).json({ entries });
      }

      // /users/{email}/permissions or /users/{email}
      if (sub && sub !== 'me' && sub !== 'audit') {
        // Strip trailing /permissions if present
        let email = sub;
        const isPermsPath = email.endsWith('/permissions');
        if (isPermsPath) email = email.slice(0, -'/permissions'.length);
        // Decode URL-encoded chars (emails contain @)
        email = decodeURIComponent(email).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return res.status(400).json({ error: 'Invalid email' });
        }

        // GET /users/{email}/permissions or GET /users/{email}
        if (req.method === 'GET') {
          const u = await getUserPermissions(email);
          if (!u) return res.status(404).json({ error: 'User not found' });
          return res.status(200).json(u);
        }

        // PUT /users/{email}/permissions — replace permissions
        if (req.method === 'PUT' && isPermsPath) {
          const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
          const perms = Array.isArray(body.permissions) ? body.permissions : [];
          const actor = (req.headers['x-actor-email'] || body.actorEmail || 'unknown').toLowerCase();
          // Bootstrap admins can't have their permissions changed (always full)
          if (isBootstrapAdmin(email)) {
            return res.status(400).json({ error: 'Cannot modify a bootstrap admin (always has full permissions)' });
          }
          const existing = await redis.get(`user:${email}`);
          const isNew = !existing;
          const record = await setUserPermissions(email, perms, actor, isNew);
          return res.status(200).json(record);
        }

        // DELETE /users/{email}
        if (req.method === 'DELETE' && !isPermsPath) {
          if (isBootstrapAdmin(email)) {
            return res.status(400).json({ error: 'Cannot remove a bootstrap admin' });
          }
          const actor = (req.headers['x-actor-email'] || 'unknown').toLowerCase();
          await deleteUserRecord(email, actor);
          return res.status(200).json({ deleted: true });
        }
      }

      return res.status(405).json({ error: 'Method not allowed for users path' });
    } catch (err) {
      console.error('Users endpoint error:', err);
      return res.status(500).json({ error: 'User operation failed', detail: err.message });
    }
  }

  // ---- Roles (User Groups) ----
  // GET    /roles            → list all roles (seeds built-ins on first call)
  // GET    /roles/{id}       → single role
  // POST   /roles            → create new role { name, description, permissions[] }
  // PUT    /roles/{id}       → update role { name, description, permissions[] }
  // DELETE /roles/{id}       → delete role (409 if isUndeletable)
  //
  // Role records are stored in KV under role:{id} and indexed in roles:index.
  // Used by the Role Management UI; the four built-in roles are seeded
  // automatically on first read.
  const rolesMatch = path.match(/^\/roles(?:\/([^?]+))?(?:\?.*)?$/);
  if (rolesMatch) {
    const ctx = await requirePermissions(req, res, ['admin']);
    if (!ctx) return;
    const roleId = rolesMatch[1] || null;
    try {
      // Actor email — prefer SSO header (when SSO is enabled), then x-actor-email
      // override (currently unused but reserved), then 'unknown'. Bootstrap
      // admin status is checked against this email later for the
      // delete-undeletable-role override.
      const ssoEmail = auth.getActorEmail(req)
                    || req.headers['x-vercel-id-token-email']
                    || null;
      const actor = (req.headers['x-actor-email'] || ssoEmail || 'unknown').toLowerCase();

      if (req.method === 'GET' && !roleId) {
        const roles = await getAllRoles();
        return res.status(200).json({ roles });
      }

      if (req.method === 'GET' && roleId) {
        const role = await getRole(roleId);
        if (!role) return res.status(404).json({ error: 'Role not found' });
        return res.status(200).json(role);
      }

      // POST /roles — create new
      if (req.method === 'POST' && !roleId) {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        if (!body.name || typeof body.name !== 'string') {
          return res.status(400).json({ error: 'Role name required' });
        }
        // Generate a stable slug-style ID from the name
        const id = await generateRoleId(body.name);
        const record = await saveRole({
          id,
          name: body.name,
          description: body.description || '',
          permissions: Array.isArray(body.permissions) ? body.permissions : [],
          isProtected: false,        // user-created roles are deletable by default
        }, actor);
        return res.status(201).json(record);
      }

      // PUT /roles/{id} — update
      if (req.method === 'PUT' && roleId) {
        const existing = await getRole(roleId);
        if (!existing) return res.status(404).json({ error: 'Role not found' });
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        const record = await saveRole({
          id: roleId,
          name: body.name !== undefined ? body.name : existing.name,
          description: body.description !== undefined ? body.description : existing.description,
          permissions: Array.isArray(body.permissions) ? body.permissions : existing.permissions,
          // isProtected is editable EXCEPT for the Employee role which stays
          // permanently undeletable
          isProtected: typeof body.isProtected === 'boolean' ? body.isProtected : existing.isProtected,
        }, actor);
        return res.status(200).json(record);
      }

      // DELETE /roles/{id}
      if (req.method === 'DELETE' && roleId) {
        const result = await deleteRole(roleId, actor);
        if (!result.deleted) {
          if (result.reason === 'undeletable') {
            return res.status(409).json({ error: 'This role cannot be deleted (it is required by the system).' });
          }
          if (result.reason === 'not_found') {
            return res.status(404).json({ error: 'Role not found' });
          }
          return res.status(500).json({ error: 'Could not delete role' });
        }
        return res.status(200).json({ deleted: true, id: roleId });
      }

      return res.status(405).json({ error: 'Method not allowed for roles' });
    } catch (err) {
      console.error('Roles endpoint error:', err);
      return res.status(500).json({ error: 'Role operation failed', detail: err.message });
    }
  }

  // ---- Request Archive (Parts Request + Work Order) ----
  // POST /request-archive/parts          → create record (called from parts form on success)
  // POST /request-archive/wo             → create record (called from WO form on success)
  // GET  /request-archive/parts          → list (?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD&limit=N)
  // GET  /request-archive/wo             → list
  // GET  /request-archive/parts/{id}     → single record
  // GET  /request-archive/wo/{id}        → single record
  //
  // No vendor session auth — anyone in the portal can submit (writes happen
  // on submit) and view (read access is gated client-side by permissions UI
  // until SSO is wired up, then proper enforcement).

  const reqArchiveMatch = path.match(/^\/request-archive\/(parts|wo)(?:\/([^?]+))?(?:\?.*)?$/);
  if (reqArchiveMatch) {
    const kind = reqArchiveMatch[1];
    const recordId = reqArchiveMatch[2] || null;
    // WOS-80 — require an authenticated actor; reads require the per-kind view
    // permission (employees hold these). The stored submitter is taken from the
    // session, not the client-supplied x-actor-email header (which is spoofable).
    const authActor = await resolveActor(req);
    if (!authActor.actorEmail) return res.status(401).json({ error: 'Not authenticated' });
    const REQ_ARCHIVE_VIEW_PERM = { parts: 'view_parts_request_archive', wo: 'view_work_order_archive' };
    if (req.method === 'GET') {
      const vp = REQ_ARCHIVE_VIEW_PERM[kind];
      if (vp && !hasAnyPermission(authActor.permissions, [vp])) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }
    try {
      // POST /request-archive/{kind} — create a record
      if (req.method === 'POST' && !recordId) {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        // Prefer the authenticated session email as the submitter of record.
        const submitter = (authActor.actorEmail || req.headers['x-actor-email'] || body.submittedBy || body.contactEmail || 'unknown').toLowerCase();
        const record = await saveRequestArchive(kind, body, submitter);
        return res.status(201).json({ id: record.id, record });
      }

      // GET /request-archive/{kind}/{id} — single record
      if (req.method === 'GET' && recordId) {
        const r = await getRequestArchiveRecord(kind, recordId);
        if (!r) return res.status(404).json({ error: 'Record not found' });
        return res.status(200).json(r);
      }

      // GET /request-archive/{kind} — list with optional filters
      if (req.method === 'GET' && !recordId) {
        const dateFrom = req.query?.dateFrom || null;
        const dateTo = req.query?.dateTo || null;
        const limit = Math.min(parseInt(req.query?.limit || '500', 10) || 500, 1000);
        const records = await listRequestArchive(kind, { dateFrom, dateTo, limit });
        return res.status(200).json({ records, count: records.length });
      }

      return res.status(405).json({ error: 'Method not allowed for request-archive' });
    } catch (err) {
      console.error('Request archive error:', err);
      return res.status(500).json({ error: 'Request archive operation failed', detail: err.message });
    }
  }

  // ---- Forms (Roll Off Swap and future safety/inspection forms) ----
  // POST /forms/roll-off-swap          → create record
  // GET  /forms/roll-off-swap          → list (?dateFrom=&dateTo=&limit=)
  // GET  /forms/roll-off-swap/{id}     → single record
  //
  // Forms are pure record-keeping artifacts — they don't create MaintainX
  // work orders or trigger any external action. Just stored for the audit
  // trail (similar to BOL archive).
  const formMatch = path.match(/^\/forms\/(roll-off-swap)(?:\/([^?]+))?(?:\?.*)?$/);
  if (formMatch) {
    const kind = formMatch[1];
    const recordId = formMatch[2] || null;
    // Inner query string lives in `path` itself (since proxyUrl encodes the
    // full path, Vercel sees it as one opaque string — req.query has only
    // the outer `path` key). Parse the inner query manually.
    const innerQs = path.includes('?') ? path.slice(path.indexOf('?') + 1) : '';
    const innerParams = new URLSearchParams(innerQs);
    // WOS-80 — require an authenticated actor; reads require the roll-off-swap
    // view permission (employees hold it). Submitter taken from the session.
    const authActor = await resolveActor(req);
    if (!authActor.actorEmail) return res.status(401).json({ error: 'Not authenticated' });
    if (req.method === 'GET' && !hasAnyPermission(authActor.permissions, ['view_roll_off_swap_archive'])) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    try {
      // POST /forms/{kind}
      if (req.method === 'POST' && !recordId) {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        const submitter = (authActor.actorEmail || req.headers['x-actor-email'] || body.submittedBy || 'unknown').toLowerCase();
        const record = await saveRequestArchive(kind, body, submitter);
        return res.status(201).json({ id: record.id, record });
      }

      // GET /forms/{kind}/{id}
      if (req.method === 'GET' && recordId) {
        const r = await getRequestArchiveRecord(kind, recordId);
        if (!r) return res.status(404).json({ error: 'Record not found' });
        return res.status(200).json(r);
      }

      // GET /forms/{kind}
      if (req.method === 'GET' && !recordId) {
        const dateFrom = innerParams.get('dateFrom') || null;
        const dateTo = innerParams.get('dateTo') || null;
        const limit = Math.min(parseInt(innerParams.get('limit') || '500', 10) || 500, 1000);
        const records = await listRequestArchive(kind, { dateFrom, dateTo, limit });
        return res.status(200).json({ records, count: records.length });
      }

      return res.status(405).json({ error: 'Method not allowed for forms' });
    } catch (err) {
      console.error('Forms endpoint error:', err);
      return res.status(500).json({ error: 'Form operation failed', detail: err.message });
    }
  }

  // ---- Operations Workflow Hub API ----
  // Central request/workflow/dashboard routes. Uses same proxy URL pattern:
  //   /api/maintainx?path=/hub/requests
  if (path.startsWith('/hub/')) {
    try {
      let cookieEmail = auth.getActorEmail(req);
      let permissions = [];
      if (cookieEmail) {
        try {
          const userPerms = await getUserPermissions(cookieEmail);
          permissions = Array.isArray(userPerms)
            ? userPerms
            : userPerms?.permissions || [];
        } catch {
          permissions = EMPLOYEE_PRESET_PERMISSIONS.slice();
        }
      } else if (isPortalAuthRelaxed(req)) {
        cookieEmail = auth.getActorEmail(req) || getDemoActorEmail();
        permissions = ALL_PERMISSION_IDS.slice();
      }
      let roleKeys = [];
      let actorUserId = null;
      try {
        const rbacPg = require('./lib/rbac/postgres');
        if (cookieEmail && rbacPg.isAvailable && rbacPg.isAvailable()) {
          roleKeys = await rbacPg.getUserRoleKeys(cookieEmail);
        }
      } catch {
        roleKeys = [];
      }
      if (cookieEmail && process.env.DATABASE_URL) {
        try {
          const { Pool } = require('pg');
          const { resolvePgSsl } = require('./lib/hub/db/pg-ssl');
          if (!global.__wosUserIdPool) {
            global.__wosUserIdPool = new Pool({
              connectionString: process.env.DATABASE_URL,
              ssl: resolvePgSsl(process.env.DATABASE_URL),
            });
          }
          const ur = await global.__wosUserIdPool.query(
            `SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1`,
            [cookieEmail]
          );
          actorUserId = ur.rows[0] ? ur.rows[0].id : null;
        } catch {
          actorUserId = null;
        }
      }
      const handled = await handleHubRoute(path, req, res, {
        actorEmail: cookieEmail,
        permissions,
        roleKeys,
        actorUserId,
      });
      if (handled !== false) return;
      return res.status(404).json({ error: 'Hub route not found', path });
    } catch (err) {
      console.error('Hub route error:', err);
      return res.status(500).json({ error: 'Hub operation failed', detail: err.message });
    }
  }

  // ---- MaintainX proxy ----
  if (!isMaintainxPath(path)) {
    return res.status(403).json({ error: 'Path not allowed by proxy', path });
  }

  const apiKey = process.env.MAINTAINX_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server misconfigured: MAINTAINX_API_KEY env var is not set' });
  }

  if (!['GET', 'POST', 'PUT'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const targetUrl = `${MAINTAINX_BASE}${path}`;
  const fetchOpts = {
    method: req.method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  };

  if (process.env.MAINTAINX_ORG_ID) {
    fetchOpts.headers['x-organization-id'] = process.env.MAINTAINX_ORG_ID;
  }

  if (req.method === 'POST') {
    fetchOpts.headers['Content-Type'] = 'application/json';
    fetchOpts.body =
      typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  } else if (req.method === 'PUT') {
    // PUT is used for binary file uploads (work order attachments)
    fetchOpts.headers['Content-Type'] = req.headers['content-type'] || 'application/octet-stream';
    const buf = await readRawBody(req);
    fetchOpts.body = buf;
  }

  try {
    const upstream = await fetch(targetUrl, fetchOpts);
    const text = await upstream.text();
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    return res.send(text);
  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(502).json({ error: 'Failed to reach MaintainX', detail: err.message });
  }
};
