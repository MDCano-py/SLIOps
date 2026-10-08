#!/usr/bin/env node
/**
 * Admin utility: remove stale manage_sso from users who only received it via
 * the old Management portal role (permission-array copy), while preserving
 * bootstrap admins and explicitly approved SSO admins.
 *
 * Dry-run by default. Apply with --apply.
 *
 * Usage:
 *   node scripts/security/remediate-stale-manage-sso.js
 *   node scripts/security/remediate-stale-manage-sso.js --apply
 *   node scripts/security/remediate-stale-manage-sso.js --apply --approve=sso.admin@company.com
 *
 * Actor identity is always system:manage_sso_remediation (never from argv/body).
 */
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function loadEnvFile(filePath) {
  const fs = require('fs');
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(path.join(ROOT, '.env.local.postgres'));
loadEnvFile(path.join(ROOT, '.env.local'));
loadEnvFile(path.join(ROOT, '.env'));

const ACTOR = 'system:manage_sso_remediation';

function parseArgs(argv) {
  const out = { apply: false, approve: new Set(), help: false };
  for (const a of argv.slice(2)) {
    if (a === '--apply') out.apply = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('--approve=')) {
      a
        .slice('--approve='.length)
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .forEach((e) => out.approve.add(e));
    }
  }
  return out;
}

function permsEqual(a, b) {
  const sa = new Set(a || []);
  const sb = new Set(b || []);
  if (sa.size !== sb.size) return false;
  for (const p of sa) if (!sb.has(p)) return false;
  return true;
}

/**
 * Pure remediation planner — used by CLI and unit tests.
 * @param {{ users: Array<{email:string,permissions:string[],bootstrap?:boolean}>, managementPerms: string[], approvedEmails?: Set<string>|string[] }} input
 */
function planStaleManageSsoRemediation(input) {
  const approved = new Set(
    [...(input.approvedEmails || [])].map((e) => String(e).toLowerCase())
  );
  const managementBase = (input.managementPerms || []).filter((p) => p !== 'manage_sso');
  const managementWithSso = [...new Set([...managementBase, 'manage_sso'])];

  const holders = [];
  const remove = [];
  const keep = [];

  for (const u of input.users || []) {
    const email = String(u.email || '').toLowerCase();
    const perms = Array.isArray(u.permissions) ? u.permissions.slice() : [];
    if (!perms.includes('manage_sso')) continue;

    const row = { email, permissions: perms, bootstrap: !!u.bootstrap };
    holders.push(row);

    if (u.bootstrap || approved.has(email)) {
      keep.push({
        email,
        reason: u.bootstrap ? 'bootstrap_admin' : 'explicitly_approved',
      });
      continue;
    }

    // Stale Management-derived: current set equals old Management+manage_sso
    // OR equals Management without SSO but still somehow has manage_sso only as extra
    const withoutSso = perms.filter((p) => p !== 'manage_sso');
    const matchesOldManagementBundle = permsEqual(perms, managementWithSso);
    const matchesManagementPlusOnlySso =
      permsEqual(withoutSso, managementBase) && perms.includes('manage_sso');

    if (matchesOldManagementBundle || matchesManagementPlusOnlySso) {
      remove.push({
        email,
        reason: 'stale_management_derived',
        previousPermissions: perms.slice(),
        nextPermissions: withoutSso,
      });
    } else {
      keep.push({ email, reason: 'custom_or_explicit_grant' });
    }
  }

  return { holders, remove, keep };
}

async function loadRedisUsers() {
  const { createRedisClient } = require(path.join(ROOT, 'for-dev/redis-client'));
  const redis = createRedisClient();
  const emails = (await redis.smembers('users:index')) || [];
  const bootstrap = (process.env.BOOTSTRAP_ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const users = [];
  for (const e of bootstrap) {
    users.push({
      email: e,
      permissions: ['manage_sso'], // placeholder — bootstrap always protected
      bootstrap: true,
    });
  }
  for (const email of emails.map((e) => String(e).toLowerCase())) {
    if (bootstrap.includes(email)) continue;
    const raw = await redis.get(`user:${email}`);
    if (!raw) continue;
    const rec = typeof raw === 'string' ? JSON.parse(raw) : raw;
    users.push({
      email,
      permissions: Array.isArray(rec.permissions) ? rec.permissions : [],
      bootstrap: false,
    });
  }
  return { redis, users, bootstrap };
}

async function loadManagementPerms() {
  // Prefer live Redis role; fall back to BUILT_IN constant via maintainx require is heavy —
  // read Redis role:management if present.
  try {
    const { createRedisClient } = require(path.join(ROOT, 'for-dev/redis-client'));
    const redis = createRedisClient();
    const raw = await redis.get('role:management');
    if (raw) {
      const role = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(role.permissions)) return role.permissions;
    }
  } catch {
    /* fall through */
  }
  // Canonical management without manage_sso — reconstruct from known operator packs is hard;
  // use empty base so only exact Management+SSO bundles match via managementWithSso from
  // a snapshot that includes manage_sso historically. Safer fallback: treat any user whose
  // perms without manage_sso still contain admin+hub_admin+control_room_supervisor as
  // management-like when they also have manage_sso alone as the delta.
  return [
    'view_home',
    'view_hub_dashboard',
    'view_hub_requests',
    'view_hub_reports',
    'hub_admin',
    'view_management',
    'view_user_permissions',
    'admin',
    'control_room_view',
    'control_room_log',
    'control_room_acknowledge',
    'control_room_handover',
    'control_room_task_manage',
    'control_room_board_manage',
    'control_room_schedule_view',
    'control_room_schedule_manage',
    'control_room_supervisor',
  ];
}

async function applyRemovals(redis, removals) {
  const results = [];
  for (const r of removals) {
    const raw = await redis.get(`user:${r.email}`);
    if (!raw) continue;
    const rec = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const now = new Date().toISOString();
    const nextPerms = (rec.permissions || []).filter((p) => p !== 'manage_sso');
    const updated = {
      ...rec,
      permissions: nextPerms,
      updatedAt: now,
      updatedBy: ACTOR,
    };
    const p = redis.pipeline();
    p.set(`user:${r.email}`, JSON.stringify(updated));
    p.lpush(
      'users:audit',
      JSON.stringify({
        at: now,
        by: ACTOR,
        target: r.email,
        action: 'permissions_updated',
        reason: 'stale_manage_sso_remediation',
        permissions: nextPerms,
        previousPermissions: rec.permissions || [],
        removed: ['manage_sso'],
      })
    );
    p.ltrim('users:audit', 0, 499);
    await p.exec();
    results.push({ email: r.email, removed: ['manage_sso'] });
    console.log(`[apply] removed manage_sso from ${r.email}`);
  }
  return results;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Usage: node scripts/security/remediate-stale-manage-sso.js [--apply] [--approve=email,...]
Dry-run by default. Actor is always ${ACTOR}.`);
    process.exit(0);
  }

  const managementPerms = await loadManagementPerms();
  const { redis, users } = await loadRedisUsers();
  const plan = planStaleManageSsoRemediation({
    users,
    managementPerms,
    approvedEmails: args.approve,
  });

  console.log('=== manage_sso stale remediation ===');
  console.log(`Mode: ${args.apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Actor: ${ACTOR}`);
  console.log(`Holders of manage_sso: ${plan.holders.length}`);
  console.log(`Would remove: ${plan.remove.length}`);
  console.log(`Would keep: ${plan.keep.length}`);
  for (const r of plan.remove) {
    console.log(`  REMOVE  ${r.email} (${r.reason})`);
  }
  for (const k of plan.keep) {
    console.log(`  KEEP    ${k.email} (${k.reason})`);
  }

  if (!args.apply) {
    console.log('\nNo changes written (dry-run). Pass --apply to execute.');
    process.exit(0);
  }

  const applied = await applyRemovals(redis, plan.remove);
  console.log(`\nApplied ${applied.length} removal(s). Audit written to users:audit.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  planStaleManageSsoRemediation,
  parseArgs,
  ACTOR,
};
