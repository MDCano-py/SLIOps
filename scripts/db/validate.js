/**
 * WOS-76 — Staging-safe Postgres schema validation.
 * Usage: npm run db:validate
 *
 * Read-only schema checks + rolled-back smoke CRUD. Does NOT seed demo data.
 * For local demo seed compatibility use: npm run db:validate:demo
 */
const { Client } = require('pg');
const { loadDbEnv, getPgClientConfig, databaseHost, isLocalDatabaseUrl } = require('./env');
const { runStagingValidation, countFailures, printSections } = require('./validate-core');

loadDbEnv();
process.env.SKIP_ASSIGNMENT_NOTIFICATIONS = '1';
process.env.SKIP_REVIEW_NOTIFICATIONS = '1';
process.env.SKIP_SIGNATURE_NOTIFICATIONS = '1';

async function main() {
  const url = process.env.DATABASE_URL;
  const hubMode = (process.env.HUB_STORE_MODE || '').toLowerCase();

  console.log('=== WOS-76 Database Validation (staging-safe) ===');
  console.log(`Host: ${databaseHost(url) || '(unset)'}`);
  console.log(`HUB_STORE_MODE: ${hubMode || '(unset)'}`);
  console.log(`Local DB: ${isLocalDatabaseUrl(url) ? 'yes' : 'no'}`);
  console.log('Demo seed: skipped (use npm run db:validate:demo for local demo checks)');

  if (!url) {
    console.error('\nFAIL  DATABASE_URL is required');
    process.exit(1);
  }
  if (hubMode && hubMode !== 'postgres') {
    console.warn(`\nWARN  HUB_STORE_MODE=${hubMode} (expected postgres for hub validation)`);
  }

  const client = new Client(getPgClientConfig(url));
  await client.connect();

  let sections = [];
  try {
    sections = await runStagingValidation(client);
  } finally {
    await client.end();
  }

  printSections('WOS-76 Database Validation (staging-safe)', sections);

  const failures = countFailures(sections);
  console.log('\n=== Summary ===');
  if (failures === 0) {
    console.log('RESULT: PASS — schema validation succeeded (no demo data written).');
    process.exit(0);
  }
  console.log(`RESULT: FAIL — ${failures} check(s) failed.`);
  process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };
