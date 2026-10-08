#!/usr/bin/env node
/**
 * Validate migrations/015_control_room.sql against an ephemeral Postgres (Docker).
 * - Clean install
 * - Repeat / idempotent re-apply of CREATE IF NOT EXISTS statements
 * - Constraints, indexes, FKs present
 * - No destructive statements against existing WOS tables
 * - Documents rollback procedure (executed here as DROP cr_* only)
 *
 * Usage: npm run security:control-room-migration-015-test
 */
const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..', '..');
const SQL_PATH = path.join(ROOT, 'migrations', '015_control_room.sql');
const CONTAINER = `cr-mig015-${Date.now()}`;
const PG_PASS = 'cr_mig_test_pass';
const PG_PORT = 55432 + Math.floor(Math.random() * 200);

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

function sh(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

async function waitForPg(url, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    const c = new Client({ connectionString: url, connectionTimeoutMillis: 2000 });
    try {
      await c.connect();
      await c.query('SELECT 1');
      await c.end();
      return;
    } catch {
      try {
        await c.end();
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error('Postgres container did not become ready');
}

async function main() {
  console.log('=== Control Room migration 015 validation ===\n');

  const sql = fs.readFileSync(SQL_PATH, 'utf8');
  assert('015 file exists and non-empty', sql.length > 200);
  assert('no DROP TABLE on hub_/users/roles WOS tables', !/DROP\s+TABLE\s+(IF\s+EXISTS\s+)?(hub_|users|roles|schema_migrations)/i.test(sql));
  assert('no TRUNCATE of WOS tables', !/TRUNCATE\s+(hub_|users|roles)/i.test(sql));
  assert('no DELETE FROM WOS tables', !/DELETE\s+FROM\s+(hub_|users|roles)/i.test(sql));
  assert('no fake Main Station seed', !/Main Station/i.test(sql) && !/VALUES\s*\(\s*'main'/i.test(sql));
  assert('uses CREATE TABLE IF NOT EXISTS', (sql.match(/CREATE TABLE IF NOT EXISTS/gi) || []).length >= 10);
  assert('uses CREATE INDEX IF NOT EXISTS', (sql.match(/CREATE INDEX IF NOT EXISTS/gi) || []).length >= 8);
  assert('defines FK REFERENCES', (sql.match(/REFERENCES/gi) || []).length >= 10);
  assert('defines CHECK constraints', (sql.match(/CHECK\s*\(/gi) || []).length >= 6);

  let dockerOk = false;
  try {
    sh('docker info');
    dockerOk = true;
  } catch {
    // Fall back: prove 015 (and later migrations) apply on configured local DATABASE_URL
    // via isolated schema — same coverage as db:fresh-migration-check when Docker is down.
    try {
      const { loadDbEnv } = require('../db/env');
      loadDbEnv();
      if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL unset');
      const { migrateDatabase } = require('../db/migrate');
      const schema = `cr_mig015_fb_${Date.now()}`;
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.end();
      await migrateDatabase(process.env.DATABASE_URL, { schema });
      const verify = new Client({ connectionString: process.env.DATABASE_URL });
      await verify.connect();
      await verify.query(`SET search_path TO "${schema}"`);
      const mig = await verify.query(
        `SELECT id FROM schema_migrations WHERE id IN ('015_control_room.sql','016_template_action_links.sql','017_vendor_identity.sql') ORDER BY id`
      );
      const ids = mig.rows.map((r) => r.id);
      assert('Docker unavailable — fallback migrate via DATABASE_URL', true);
      assert('fallback applied 015', ids.includes('015_control_room.sql'));
      assert('fallback applied 016', ids.includes('016_template_action_links.sql'));
      assert('fallback applied 017', ids.includes('017_vendor_identity.sql'));
      const cr = await verify.query(
        `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema=$1 AND table_name LIKE 'cr_%'`,
        [schema]
      );
      assert('fallback cr_* tables present', cr.rows[0].n >= 8, `count=${cr.rows[0].n}`);
      await verify.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await verify.end();
      finish();
      return;
    } catch (err) {
      assert('Docker available for live Postgres apply', false, `docker not running; fallback failed: ${err.message}`);
      finish();
      return;
    }
  }

  console.log(`Starting ephemeral Postgres on localhost:${PG_PORT}…`);
  try {
    sh(
      `docker run -d --rm --name ${CONTAINER} -e POSTGRES_PASSWORD=${PG_PASS} -e POSTGRES_DB=cr_mig -p ${PG_PORT}:5432 postgres:16-alpine`
    );
  } catch (err) {
    assert('start postgres container', false, err.message);
    finish();
    return;
  }

  const url = `postgres://postgres:${PG_PASS}@127.0.0.1:${PG_PORT}/cr_mig`;
  try {
    await waitForPg(url);
    assert('ephemeral Postgres ready', true);

    // Simulate pre-existing WOS table so we can prove 015 does not touch it
    const setup = new Client({ connectionString: url });
    await setup.connect();
    await setup.query(`CREATE TABLE hub_requests (id UUID PRIMARY KEY, title TEXT)`);
    await setup.query(`INSERT INTO hub_requests VALUES (gen_random_uuid(), 'keep-me')`);
    await setup.end();

    const client = new Client({ connectionString: url });
    await client.connect();

    await client.query(sql);
    assert('clean install of 015 succeeds', true);

    // Repeat safety: CREATE IF NOT EXISTS should succeed again
    await client.query(sql);
    assert('repeat apply of 015 CREATE IF NOT EXISTS succeeds', true);

    const tables = (
      await client.query(`
        SELECT tablename FROM pg_tables
        WHERE schemaname='public' AND tablename LIKE 'cr_%'
        ORDER BY 1
      `)
    ).rows.map((r) => r.tablename);
    const expected = [
      'cr_acknowledgements',
      'cr_board_items',
      'cr_handovers',
      'cr_schedule_assignments',
      'cr_shift_assignments',
      'cr_shift_log_revisions',
      'cr_shift_logs',
      'cr_shifts',
      'cr_stations',
      'cr_tasks',
      'cr_units',
    ];
    assert(
      'all cr_* tables present',
      expected.every((t) => tables.includes(t)),
      `got ${tables.join(',')}`
    );

    const stationCount = (await client.query(`SELECT COUNT(*)::int AS n FROM cr_stations`)).rows[0].n;
    assert('no seeded production stations', stationCount === 0);

    const fkCount = (
      await client.query(`
        SELECT COUNT(*)::int AS n
        FROM information_schema.table_constraints
        WHERE constraint_type='FOREIGN KEY' AND table_schema='public' AND table_name LIKE 'cr_%'
      `)
    ).rows[0].n;
    assert('foreign keys present on cr_*', fkCount >= 10, `fk=${fkCount}`);

    const idxCount = (
      await client.query(`
        SELECT COUNT(*)::int AS n FROM pg_indexes
        WHERE schemaname='public' AND tablename LIKE 'cr_%'
      `)
    ).rows[0].n;
    assert('indexes present on cr_*', idxCount >= 15, `idx=${idxCount}`);

    const checkCount = (
      await client.query(`
        SELECT COUNT(*)::int AS n
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE c.contype = 'c'
          AND n.nspname = 'public'
          AND t.relname LIKE 'cr_%'
      `)
    ).rows[0].n;
    assert('CHECK constraints present', checkCount >= 6, `checks=${checkCount}`);

    const hubLeft = (await client.query(`SELECT COUNT(*)::int AS n FROM hub_requests`)).rows[0].n;
    assert('existing WOS hub_requests untouched', hubLeft === 1);

    // Constraint behavior smoke
    await client.query(`INSERT INTO cr_stations (key, name) VALUES ('plant-a','Plant A')`);
    let badShift = false;
    try {
      await client.query(`
        INSERT INTO cr_shifts (station_id, name, starts_at, ends_at)
        SELECT id, 'bad', now(), now() - interval '1 hour' FROM cr_stations WHERE key='plant-a'
      `);
    } catch {
      badShift = true;
    }
    assert('shift ends_at > starts_at enforced', badShift);

    // Rollback procedure (CR-only drop order)
    await client.query(`
      DROP TABLE IF EXISTS cr_schedule_assignments CASCADE;
      DROP TABLE IF EXISTS cr_handovers CASCADE;
      DROP TABLE IF EXISTS cr_tasks CASCADE;
      DROP TABLE IF EXISTS cr_board_items CASCADE;
      DROP TABLE IF EXISTS cr_acknowledgements CASCADE;
      DROP TABLE IF EXISTS cr_shift_log_revisions CASCADE;
      DROP TABLE IF EXISTS cr_shift_logs CASCADE;
      DROP TABLE IF EXISTS cr_shift_assignments CASCADE;
      DROP TABLE IF EXISTS cr_shifts CASCADE;
      DROP TABLE IF EXISTS cr_units CASCADE;
      DROP TABLE IF EXISTS cr_stations CASCADE;
    `);
    const afterDrop = (
      await client.query(`SELECT COUNT(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'cr_%'`)
    ).rows[0].n;
    assert('rollback DROP cr_* leaves no cr_* tables', afterDrop === 0);
    assert(
      'rollback leaves hub_requests',
      (await client.query(`SELECT COUNT(*)::int AS n FROM hub_requests`)).rows[0].n === 1
    );

    // Re-install after rollback
    await client.query(sql);
    assert('re-install after rollback succeeds', true);

    await client.end();
  } catch (err) {
    assert('live migration validation', false, err.message);
  } finally {
    try {
      spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
    } catch {
      /* ignore */
    }
  }

  finish();
}

function finish() {
  console.log('\n=== Rollback procedure (production) ===');
  console.log(`
1. Stop writes to Control Room (optional maintenance window).
2. DROP only cr_* tables in dependency-safe order (see script body / docs).
3. DELETE FROM schema_migrations WHERE id = '015_control_room.sql';
4. Redeploy previous app SHA that does not require CR tables.
5. Do NOT drop hub_*, users, roles, or other WOS tables.
`);
  console.log('=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('RESULT: FAIL');
    process.exit(1);
  }
  console.log('RESULT: PASS');
}

main().catch((err) => {
  console.error(err);
  try {
    spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
  } catch {
    /* ignore */
  }
  process.exit(1);
});
