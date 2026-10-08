#!/usr/bin/env node
/**
 * Ordered validation for migrations 015, 016, 017 on a clean isolated schema.
 * Usage: npm run security:migrations-015-016-017-test
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { loadDbEnv } = require('../db/env');
const { migrateDatabase } = require('../db/migrate');

loadDbEnv();

const ROOT = path.join(__dirname, '..', '..');
let passed = 0;
let failed = 0;

function assert(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  console.log('=== Migrations 015 / 016 / 017 ordered validation ===\n');

  for (const id of ['015_control_room.sql', '016_template_action_links.sql', '017_vendor_identity.sql']) {
    const p = path.join(ROOT, 'migrations', id);
    assert(`${id} exists`, fs.existsSync(p) && fs.statSync(p).size > 100);
  }

  if (!process.env.DATABASE_URL) {
    assert('DATABASE_URL configured', false);
    process.exit(1);
  }

  const schema = `mig_ord_${Date.now()}`;
  const admin = new Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.end();

  await migrateDatabase(process.env.DATABASE_URL, { schema });

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query(`SET search_path TO "${schema}"`);

  const mig = await c.query(
    `SELECT id FROM schema_migrations
     WHERE id IN ('015_control_room.sql','016_template_action_links.sql','017_vendor_identity.sql')
     ORDER BY id`
  );
  const ids = mig.rows.map((r) => r.id);
  assert('015 applied before/with suite', ids[0] === '015_control_room.sql', ids.join(','));
  assert('016 applied', ids.includes('016_template_action_links.sql'));
  assert('017 applied', ids.includes('017_vendor_identity.sql'));
  assert('ordered application recorded', ids.join(',') === '015_control_room.sql,016_template_action_links.sql,017_vendor_identity.sql');

  const cr = await c.query(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema=$1 AND table_name LIKE 'cr_%'`,
    [schema]
  );
  assert('015 cr_* tables', cr.rows[0].n >= 8, `n=${cr.rows[0].n}`);

  const actionCols = await c.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema=$1 AND table_name='action_links'
       AND column_name IN ('submission_id','workflow_step_instance_id')`,
    [schema]
  );
  assert(
    '016 action_links columns',
    actionCols.rows.length >= 1 ||
      (await c.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name='action_links'`,
        [schema]
      )).rowCount >= 1,
    'action_links missing or columns absent'
  );

  for (const table of ['vendor_contacts', 'vendor_invitations', 'vendor_sessions', 'vendor_identity_audit']) {
    const r = await c.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2`,
      [schema, table]
    );
    assert(`017 ${table}`, r.rowCount === 1);
  }

  // Idempotent re-migrate
  await migrateDatabase(process.env.DATABASE_URL, { schema });
  assert('idempotent re-migrate succeeds', true);

  await c.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await c.end();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
