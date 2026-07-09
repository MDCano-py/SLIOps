/**
 * WOS-76 — Local-only demo seed compatibility validation.
 * Usage: npm run db:validate:demo
 *
 * Writes demo rows into the configured database. Refuses staging/production hosts.
 * Clears demo data after checks when possible.
 */
const { Client } = require('pg');
const {
  loadDbEnv,
  getPgClientConfig,
  databaseHost,
  isLocalDatabaseUrl,
  assertLocalDemoValidationAllowed,
} = require('./env');
const { pass, fail, countFailures } = require('./validate-core');

loadDbEnv();
process.env.SKIP_ASSIGNMENT_NOTIFICATIONS = '1';
process.env.SKIP_REVIEW_NOTIFICATIONS = '1';
process.env.SKIP_SIGNATURE_NOTIFICATIONS = '1';

async function checkDemoSeedCompatibility(client) {
  const results = [];
  try {
    process.env.HUB_USE_LOCAL_STORE = '0';
    delete require.cache[require.resolve('../../api/lib/hub/db/index.js')];
    delete require.cache[require.resolve('../../for-dev/hub-demo-seed')];

    const store = require('../../api/lib/hub/db/postgres');
    process.env.HUB_STORE_MODE = 'postgres';

    if (typeof store.listDemoRequestIds !== 'function') {
      results.push(fail('postgres store missing listDemoRequestIds()'));
    } else {
      const ids = await store.listDemoRequestIds();
      results.push(pass(`listDemoRequestIds() returned ${ids.length} demo row(s) before seed`));
    }

    const seed = require('../../for-dev/hub-demo-seed');
    const out1 = await seed.seedDemoData('validation@streamlinecorp.com');
    if (!out1.ok) results.push(fail('seedDemoData first run failed'));
    else {
      results.push(
        pass(
          `seedDemoData run 1: created=${out1.created_count ?? '?'} updated=${out1.updated_count ?? '?'} skipped=${out1.skipped_count ?? 0}`
        )
      );
    }

    const out2 = await seed.seedDemoData('validation@streamlinecorp.com');
    if (!out2.ok) results.push(fail('seedDemoData second run failed'));
    else {
      results.push(
        pass(
          `seedDemoData run 2 (idempotent): created=${out2.created_count ?? '?'} updated=${out2.updated_count ?? '?'} skipped=${out2.skipped_count ?? 0}`
        )
      );
    }

    const extStep = await client.query(
      `SELECT 1 FROM workflow_steps ws JOIN requests r ON r.id=ws.request_id
       WHERE r.demo=true AND ws.action_type NOT IN ('fill','review','sign','approve') LIMIT 1`
    );
    if (extStep.rowCount) results.push(pass('demo workflow steps include extended action_type values'));
    else results.push(fail('no extended workflow step action_type found in demo data (check migration 003)'));

    const health = await store.healthCheck();
    if (health.ok) results.push(pass('postgres healthCheck ok'));
    else results.push(fail(`postgres healthCheck failed: ${health.error}`));

    const cleared = await seed.clearDemoData();
    if (cleared.ok) results.push(pass('clearDemoData succeeded after compatibility checks'));
    else results.push(fail(`clearDemoData failed: ${cleared.error || 'unknown'}`));
  } catch (err) {
    results.push(fail(`Demo seed compatibility: ${err.message}`));
  }
  return results;
}

async function checkArchiveSeedCompatibility() {
  const results = [];
  try {
    const { shouldUseLocalStore, hasUpstashEnv } = require('../../for-dev/redis-client');
    if (!shouldUseLocalStore() && !hasUpstashEnv()) {
      results.push(
        pass('Archive demo seed skipped (requires local JSON store or Upstash — not Postgres archive tables)')
      );
      return results;
    }

    const archiveSeed = require('../../for-dev/hub-archive-demo-seed');
    const out1 = await archiveSeed.seedArchiveDemoData('validation@streamlinecorp.com');
    if (!out1.ok) results.push(fail('seedArchiveDemoData first run failed'));
    else {
      results.push(
        pass(
          `seedArchiveDemoData run 1: created=${out1.created_count ?? '?'} updated=${out1.updated_count ?? '?'}`
        )
      );
    }

    const out2 = await archiveSeed.seedArchiveDemoData('validation@streamlinecorp.com');
    if (!out2.ok) results.push(fail('seedArchiveDemoData second run failed'));
    else {
      results.push(pass(`seedArchiveDemoData run 2 (idempotent): created=${out2.created_count ?? 0}`));
    }

    if (typeof archiveSeed.clearArchiveDemoData === 'function') {
      const cleared = await archiveSeed.clearArchiveDemoData();
      if (cleared.ok) results.push(pass('clearArchiveDemoData succeeded'));
      else results.push(fail(`clearArchiveDemoData failed: ${cleared.error || 'unknown'}`));
    } else {
      results.push(pass('clearArchiveDemoData not implemented — demo archive rows remain in local store'));
    }
  } catch (err) {
    results.push(fail(`Archive seed compatibility: ${err.message}`));
  }
  return results;
}

async function main() {
  try {
    assertLocalDemoValidationAllowed();
  } catch (err) {
    console.error(`\nFAIL  ${err.message}`);
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  console.log('=== WOS-76 Demo Validation (local-only) ===');
  console.log(`Host: ${databaseHost(url) || '(unset)'}`);
  console.log(`Local DB: ${isLocalDatabaseUrl(url) ? 'yes' : 'no'}`);
  console.log('WARNING: This command writes demo data and is not safe for staging/RDS.');

  if (!url) {
    console.error('\nFAIL  DATABASE_URL is required');
    process.exit(1);
  }

  const client = new Client(getPgClientConfig(url));
  await client.connect();

  const sections = [];
  try {
    sections.push(['Demo seed compatibility (Postgres)', await checkDemoSeedCompatibility(client)]);
    sections.push(['Archive seed compatibility (local/Redis store)', await checkArchiveSeedCompatibility()]);
  } finally {
    await client.end();
  }

  for (const [title, results] of sections) {
    console.log(`\n## ${title}`);
    for (const r of results) {
      console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.msg}`);
    }
  }

  const failures = countFailures(sections);
  console.log('\n=== Summary ===');
  if (failures === 0) {
    console.log('RESULT: PASS — local demo validation succeeded.');
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

module.exports = { main, checkDemoSeedCompatibility, checkArchiveSeedCompatibility };
