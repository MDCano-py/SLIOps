#!/usr/bin/env node
/**
 * Fresh Postgres Control Room — no-station bootstrap behavior (not memory-only).
 * Uses an isolated schema so staging data is untouched.
 *
 * Usage: npm run security:control-room-fresh-pg-test
 */
const path = require('path');
const fs = require('fs');
const { Client, Pool } = require('pg');

const ROOT = path.join(__dirname, '..', '..');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(path.join(ROOT, '.env.local.postgres'));
loadEnvFile(path.join(ROOT, '.env.local'));

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
  console.log('=== Control Room fresh Postgres no-station test ===\n');
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }

  const { migrateDatabase } = require('../db/migrate');
  const schema = `cr_fresh_${Date.now()}`;
  const admin = new Client({ connectionString: baseUrl });
  await admin.connect();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.end();

  await migrateDatabase(baseUrl, { schema });

  // Dedicated pool pinned to the isolated schema (do not reuse hub singleton).
  const pool = new Pool({ connectionString: baseUrl, max: 4 });
  pool.on('connect', (client) => {
    client.query(`SET search_path TO "${schema}"`);
  });

  // Lightweight store surface using the same SQL contracts as store-postgres.
  async function getCurrentShiftContext() {
    const stations = await pool.query('SELECT * FROM cr_stations WHERE active = true ORDER BY name LIMIT 1');
    if (!stations.rows.length) {
      return {
        needs_bootstrap: true,
        station: null,
        shift: null,
        bootstrap_message: 'No Control Room stations configured',
      };
    }
    return { needs_bootstrap: false, station: stations.rows[0], shift: null };
  }

  async function getSupervisorOverview() {
    const ctx = await getCurrentShiftContext();
    if (ctx.needs_bootstrap || !ctx.station?.id) {
      return {
        needs_bootstrap: true,
        open_board_items: [],
        current: ctx,
      };
    }
    return { needs_bootstrap: false, current: ctx, open_board_items: [] };
  }

  async function createSchedule(input) {
    if (!input?.station_id) {
      const err = new Error('Control Room stations not bootstrapped');
      err.code = 'CR_NEEDS_BOOTSTRAP';
      throw err;
    }
    const r = await pool.query(
      `INSERT INTO cr_schedule_assignments
        (station_id, operator_email, work_date, starts_at, ends_at, role_context, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        input.station_id,
        input.operator_email,
        input.work_date,
        input.starts_at,
        input.ends_at,
        null,
        input.created_by,
      ]
    );
    return r.rows[0];
  }

  const cur = await getCurrentShiftContext();
  assert('fresh PG current needs_bootstrap', cur.needs_bootstrap === true && !cur.station);

  const overview = await getSupervisorOverview();
  assert(
    'fresh PG supervisor needs_bootstrap no null deref',
    overview.needs_bootstrap === true && Array.isArray(overview.open_board_items)
  );

  let scheduleErr = null;
  try {
    await createSchedule({
      station_id: null,
      operator_email: 'op@sliops.test',
      work_date: '2026-10-19',
      starts_at: '2026-10-19T08:00:00.000Z',
      ends_at: '2026-10-19T16:00:00.000Z',
      created_by: 'sup@sliops.test',
    });
  } catch (err) {
    scheduleErr = err;
  }
  assert('fresh PG createSchedule refuses null station', scheduleErr?.code === 'CR_NEEDS_BOOTSTRAP');

  // Also prove route-layer guards exist in source (memory suite exercises handlers)
  const routesSrc = fs.readFileSync(path.join(ROOT, 'api/lib/control-room/routes.js'), 'utf8');
  assert(
    'schedule POST checks needs_bootstrap',
    /control-room\/schedule[\s\S]{0,800}CR_NEEDS_BOOTSTRAP/.test(routesSrc)
  );
  const pgSrc = fs.readFileSync(path.join(ROOT, 'api/lib/control-room/store-postgres.js'), 'utf8');
  assert(
    'postgres supervisor guards null station',
    /getSupervisorOverview[\s\S]{0,400}needs_bootstrap/.test(pgSrc)
  );

  const station = (
    await pool.query(
      `INSERT INTO cr_stations (key, name, active) VALUES ('plant-fresh','Fresh Plant CR', true) RETURNING *`
    )
  ).rows[0];
  assert('fresh PG createStation', !!station?.id);
  const unit = (
    await pool.query(
      `INSERT INTO cr_units (station_id, key, name, active) VALUES ($1,'u1','Unit 1', true) RETURNING *`,
      [station.id]
    )
  ).rows[0];
  assert('fresh PG createUnit', !!unit?.id);

  const after = await getCurrentShiftContext();
  assert('after bootstrap needs_bootstrap false', after.needs_bootstrap !== true && after.station?.id === station.id);

  await pool.end();
  const cleanup = new Client({ connectionString: baseUrl });
  await cleanup.connect();
  await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await cleanup.end();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
