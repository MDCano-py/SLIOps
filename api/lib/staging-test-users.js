/**
 * WOS-85 — Explicit staging test-user catalog (PostgreSQL system of record).
 * Emails use the non-production domain staging-test.streamlinecorp.com.
 * Display names are role-based (no fake personal names).
 */

const { Pool } = require('pg');
const { resolvePgSsl } = require('./hub/db/pg-ssl');
const rbacPostgres = require('./rbac/postgres');

const TEST_DOMAIN = 'staging-test.streamlinecorp.com';

/** Portal permission presets (ids must match maintainx PERMISSION_CATALOG). */
const VIEW_CORE = [
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

const PERMS_HUB_ADMIN = [
  ...VIEW_CORE,
  'hub_admin',
  'view_management',
  'view_vendor_list',
  'view_vendor_dashboard',
  'view_vendor_documents',
  'view_user_permissions',
  'submit_new_vendor',
  'edit_vendor_info',
  'edit_vendor_workflow',
  'edit_vendor_compliance',
  'manage_vendor_documents',
  'delete_jsa_archive',
  'delete_bol_archive',
  'admin',
];

const PERMS_OPS_MANAGER = [
  ...VIEW_CORE,
  'hub_admin',
  'view_management',
  'view_vendor_list',
  'view_vendor_dashboard',
  'view_vendor_documents',
  'submit_new_vendor',
  'edit_vendor_compliance',
  'manage_vendor_documents',
];

const PERMS_HR = [...VIEW_CORE, 'view_forms', 'view_management'];

const PERMS_ACCOUNTING = [
  ...VIEW_CORE,
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

const PERMS_FIELD_SUPERVISOR = [...VIEW_CORE, 'view_management', 'submit_new_vendor'];

const PERMS_FIELD_TECH = [...VIEW_CORE];

const PERMS_CLIENT = [
  'view_home',
  'view_hub_dashboard',
  'view_hub_requests',
  'view_forms',
];

const PERMS_VENDOR = [
  'view_home',
  'view_management',
  'view_vendor_list',
  'view_vendor_dashboard',
  'view_vendor_documents',
];

/**
 * Fixed allowlist. Login accepts only these `key` values — never free-form email.
 * @type {ReadonlyArray<{key: string, email: string, displayName: string, roleKey: string, permissions: string[]}>}
 */
const STAGING_TEST_USERS = Object.freeze([
  {
    key: 'hub_admin',
    email: `hub-admin@${TEST_DOMAIN}`,
    displayName: 'Staging Hub Admin',
    roleKey: 'hub_admin',
    permissions: PERMS_HUB_ADMIN,
  },
  {
    key: 'operations_manager',
    email: `ops-manager@${TEST_DOMAIN}`,
    displayName: 'Staging Operations Manager',
    roleKey: 'operations',
    permissions: PERMS_OPS_MANAGER,
  },
  {
    key: 'hr_manager',
    email: `hr-manager@${TEST_DOMAIN}`,
    displayName: 'Staging HR Manager',
    roleKey: 'hr',
    permissions: PERMS_HR,
  },
  {
    key: 'accounting',
    email: `accounting@${TEST_DOMAIN}`,
    displayName: 'Staging Accounting',
    roleKey: 'ap',
    permissions: PERMS_ACCOUNTING,
  },
  {
    key: 'field_supervisor',
    email: `field-supervisor@${TEST_DOMAIN}`,
    displayName: 'Staging Field Supervisor',
    roleKey: 'field_supervisor',
    permissions: PERMS_FIELD_SUPERVISOR,
  },
  {
    key: 'field_technician',
    email: `field-technician@${TEST_DOMAIN}`,
    displayName: 'Staging Field Technician',
    roleKey: 'field_technician',
    permissions: PERMS_FIELD_TECH,
  },
  {
    key: 'client_representative',
    email: `client-rep@${TEST_DOMAIN}`,
    displayName: 'Staging Client Representative',
    roleKey: 'client',
    permissions: PERMS_CLIENT,
  },
  {
    key: 'external_vendor',
    email: `external-vendor@${TEST_DOMAIN}`,
    displayName: 'Staging External Vendor',
    roleKey: 'vendor',
    permissions: PERMS_VENDOR,
  },
]);

const ALLOWED_KEYS = new Set(STAGING_TEST_USERS.map((u) => u.key));
const ALLOWED_EMAILS = new Set(STAGING_TEST_USERS.map((u) => u.email.toLowerCase()));

let _pool = null;

function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: resolvePgSsl(process.env.DATABASE_URL),
    });
  }
  return _pool;
}

function getCatalogEntry(key) {
  return STAGING_TEST_USERS.find((u) => u.key === key) || null;
}

function isAllowlistedEmail(email) {
  return ALLOWED_EMAILS.has(String(email || '').toLowerCase());
}

function listSelectorOptions() {
  return STAGING_TEST_USERS.map((u) => ({
    key: u.key,
    label: u.displayName,
    role_key: u.roleKey,
  }));
}

/**
 * Load an active allowlisted staging test user from PostgreSQL.
 * Roles come from user_roles — never from the browser.
 */
async function loadActiveTestUserByKey(userKey) {
  const catalog = getCatalogEntry(userKey);
  if (!catalog) return null;
  return loadActiveTestUserByEmail(catalog.email);
}

async function loadActiveTestUserByEmail(email) {
  const p = getPool();
  if (!p || !email) return null;
  const normalized = String(email).trim().toLowerCase();
  if (!ALLOWED_EMAILS.has(normalized)) return null;

  const r = await p.query(
    `SELECT email, name, role, permissions, status, is_staging_test_user
     FROM users
     WHERE lower(email) = lower($1)
     LIMIT 1`,
    [normalized]
  );
  if (!r.rows.length) return null;
  const row = r.rows[0];
  if (!row.is_staging_test_user) return null;
  if (row.status !== 'active') return null;

  const roleKeys = await rbacPostgres.getUserRoleKeys(normalized);
  if (!roleKeys.length) return null;

  let permissions = row.permissions;
  if (typeof permissions === 'string') {
    try {
      permissions = JSON.parse(permissions);
    } catch {
      permissions = [];
    }
  }
  if (!Array.isArray(permissions)) permissions = [];

  return {
    email: String(row.email).toLowerCase(),
    displayName: row.name || normalized,
    roleKeys,
    primaryRole: row.role || roleKeys[0],
    permissions,
    status: row.status,
  };
}

/**
 * Idempotent seed of the eight staging test users + role assignments.
 * Does not modify non-staging-test users.
 */
async function seedStagingTestUsers({ actorEmail = 'system:staging-test-seed' } = {}) {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL is required to seed staging test users');

  await rbacPostgres.seedRolesIfEmpty();

  const results = [];
  for (const u of STAGING_TEST_USERS) {
    const existing = await p.query(
      `SELECT email, is_staging_test_user FROM users WHERE lower(email) = lower($1) LIMIT 1`,
      [u.email]
    );
    if (existing.rows.length && !existing.rows[0].is_staging_test_user) {
      results.push({
        key: u.key,
        email: u.email,
        skipped: true,
        reason: 'email_exists_as_non_test_user',
      });
      continue;
    }

    await p.query(
      `INSERT INTO users (email, name, role, permissions, status, is_staging_test_user, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, 'active', true, now(), now())
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name,
         role = EXCLUDED.role,
         permissions = EXCLUDED.permissions,
         status = 'active',
         is_staging_test_user = true,
         updated_at = now()
       WHERE users.is_staging_test_user = true`,
      [u.email.toLowerCase(), u.displayName, u.roleKey, JSON.stringify(u.permissions)]
    );

    await rbacPostgres.setUserRoleKeys(u.email, [u.roleKey], actorEmail);
    results.push({
      key: u.key,
      email: u.email,
      role_key: u.roleKey,
      upserted: true,
    });
  }

  return { ok: true, count: results.filter((r) => r.upserted).length, results };
}

module.exports = {
  TEST_DOMAIN,
  STAGING_TEST_USERS,
  ALLOWED_KEYS,
  ALLOWED_EMAILS,
  getCatalogEntry,
  isAllowlistedEmail,
  listSelectorOptions,
  loadActiveTestUserByKey,
  loadActiveTestUserByEmail,
  seedStagingTestUsers,
};
