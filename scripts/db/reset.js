/**
 * Drop hub tables and re-apply migrations (local dev only).
 * Usage: DATABASE_URL=... npm run db:reset
 *
 * Safety: refuses production and non-local DATABASE_URL unless DATABASE_URL_CONFIRM_RESET=1
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { loadDbEnv, getPgClientConfig, assertResetAllowed, databaseHost } = require('./env');

loadDbEnv();

const ROOT = path.join(__dirname, '..', '..');
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');

const TABLES = [
  'schema_migrations',
  'request_files',
  'signatures',
  'action_links',
  'notifications',
  'comments',
  'audit_events',
  'integration_events',
  'outbox_events',
  'form_definitions',
  'document_types',
  'workflow_templates',
  'workflow_steps',
  'web_documents',
  'status_history',
  'requests',
  'request_sequences',
  'users',
  'hub_settings',
  'equipment',
  'locations',
];

async function main() {
  try {
    assertResetAllowed();
  } catch (err) {
    console.error(`[db:reset] ${err.message}`);
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  console.log(`[db:reset] target host: ${databaseHost(url)}`);

  const client = new Client(getPgClientConfig(url));
  await client.connect();

  console.log('[db:reset] dropping hub tables…');
  for (const table of TABLES) {
    await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`[db:reset] applying ${file}`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }

  console.log('[db:reset] complete');
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
