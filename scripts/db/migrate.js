// SQL migration runner for Postgres (RDS).
// Usage: DATABASE_URL=... npm run db:migrate

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { loadDbEnv, getPgClientConfig } = require('./env');

loadDbEnv();

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

async function migrateDatabase(url, options = {}) {
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }

  const client = new Client(getPgClientConfig(url));
  await client.connect();

  const schema = options.schema || null;
  if (schema) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) {
      throw new Error(`Invalid schema name: ${schema}`);
    }
    await client.query(`SET search_path TO "${schema}"`);
  }

  try {
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
      const id = file;
      const already = await client.query('SELECT 1 FROM schema_migrations WHERE id=$1', [id]);
      if (already.rowCount) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`[db:migrate] applying ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [id]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[db:migrate] failed ${file}:`, err.message);
        throw err;
      }
    }

    console.log('[db:migrate] up to date');
  } finally {
    await client.end();
  }
}

async function main() {
  await migrateDatabase(process.env.DATABASE_URL);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { migrateDatabase, MIGRATIONS_DIR };
