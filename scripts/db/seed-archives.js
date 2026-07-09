#!/usr/bin/env node
/**
 * Seed demo archive records (JSA, BOL, Work Orders, Parts, Roll Off Swap).
 * Usage: npm run db:seed-archives
 */
const { loadDbEnv, assertLocalSeedAllowed } = require('../db/env');

loadDbEnv();

async function main() {
  assertLocalSeedAllowed();
  const archiveSeed = require('../../for-dev/hub-archive-demo-seed');
  const out = await archiveSeed.seedArchiveDemoData('demo-seed@streamlinecorp.com');
  console.log('[db:seed-archives]', out.message || out);
  if (!out.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
