#!/usr/bin/env node
/**
 * WOS-85 — Idempotent seed of eight staging test users into PostgreSQL.
 * Usage: npm run db:seed-staging-test-users
 *
 * Allowed in local development and staging (not production).
 * Documents emails under api/lib/staging-test-users.js.
 */
const { loadDbEnv, isDeployedNodeEnv } = require('./env');
const { seedStagingTestUsers, STAGING_TEST_USERS } = require('../../api/lib/staging-test-users');

loadDbEnv();

async function main() {
  const env = String(process.env.NODE_ENV || '').toLowerCase();
  if (env === 'production') {
    console.error('Refusing to seed staging test users when NODE_ENV=production');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  if (isDeployedNodeEnv() && env !== 'staging') {
    console.error(`Refusing seed when NODE_ENV=${process.env.NODE_ENV}`);
    process.exit(1);
  }

  console.log('=== WOS-85 Staging Test User Seed ===\n');
  console.log('Catalog emails:');
  for (const u of STAGING_TEST_USERS) {
    console.log(`  ${u.key.padEnd(22)} ${u.email} → role ${u.roleKey}`);
  }
  console.log('');

  const out = await seedStagingTestUsers();
  console.log(`Upserted: ${out.count}`);
  for (const r of out.results) {
    if (r.skipped) console.log(`  SKIP ${r.email} (${r.reason})`);
    else console.log(`  OK   ${r.email} (${r.role_key})`);
  }
  console.log('\nRESULT: PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
