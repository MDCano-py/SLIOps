/**
 * WOS-76 — Fresh empty Postgres migration dry-run (no psql required).
 * Usage: npm run db:fresh-migration-check
 *
 * Preferred: create temp database, migrate, validate, drop temp database.
 * Local fallback (no CREATEDB): isolated schema in current database.
 */
const { Client } = require('pg');
const {
  loadDbEnv,
  getPgClientConfig,
  getAdminPgConfig,
  buildDatabaseUrl,
  resolvePgConnectionParts,
  databaseHost,
  isLocalDatabaseUrl,
} = require('./env');
const { migrateDatabase } = require('./migrate');
const { runStagingValidation, countFailures, printSections } = require('./validate-core');

loadDbEnv();

const TEMP_DB = process.env.TEMP_DATABASE_NAME || 'streamline_migration_check';
const TEMP_SCHEMA = process.env.TEMP_DATABASE_SCHEMA || 'wos76_migration_check';

function quoteIdent(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid identifier: ${name}`);
  }
  return `"${name}"`;
}

async function terminateConnections(adminClient, dbName) {
  await adminClient.query(
    `SELECT pg_terminate_backend(pid)
     FROM pg_stat_activity
     WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [dbName]
  );
}

async function dropDatabaseIfExists(adminClient, dbName) {
  await terminateConnections(adminClient, dbName);
  await adminClient.query(`DROP DATABASE IF EXISTS ${quoteIdent(dbName)}`);
}

async function createDatabase(adminClient, dbName) {
  await adminClient.query(`CREATE DATABASE ${quoteIdent(dbName)}`);
}

async function prepareIsolatedSchema(client, schemaName) {
  await client.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schemaName)} CASCADE`);
  await client.query(`CREATE SCHEMA ${quoteIdent(schemaName)}`);
  await client.query(`SET search_path TO ${quoteIdent(schemaName)}`);
}

async function dropIsolatedSchema(client, schemaName) {
  await client.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schemaName)} CASCADE`);
  await client.query('SET search_path TO public');
}

async function runFreshCheckOnTarget({ label, url, schema = null, cleanup }) {
  console.log(`\n--- Fresh check target: ${label} ---`);
  if (schema) {
    const client = new Client(getPgClientConfig(url));
    await client.connect();
    try {
      await prepareIsolatedSchema(client, schema);
      await client.end();
    } catch (err) {
      await client.end().catch(() => {});
      throw err;
    }
  }

  await migrateDatabase(url, schema ? { schema } : undefined);

  const validateClient = new Client(getPgClientConfig(url));
  await validateClient.connect();
  if (schema) {
    await validateClient.query(`SET search_path TO ${quoteIdent(schema)}`);
  }
  const sections = await runStagingValidation(validateClient, schema ? { schema } : {});
  await validateClient.end();

  printSections(`Fresh DB validation (${label})`, sections);
  const failures = countFailures(sections);
  if (failures > 0) {
    throw new Error(`${failures} validation check(s) failed on ${label}`);
  }

  await cleanup();
}

async function tryDatabaseIsolation(baseUrl) {
  const adminConfig = getAdminPgConfig();
  const parts = resolvePgConnectionParts(baseUrl);
  const tempUrl = buildDatabaseUrl(parts, TEMP_DB);

  const adminClient = new Client(adminConfig);
  await adminClient.connect();

  try {
    console.log(`\n[mode] Temporary database: ${TEMP_DB}`);
    console.log(`[1/4] Dropping temp database if present: ${TEMP_DB}`);
    await dropDatabaseIfExists(adminClient, TEMP_DB);
    console.log('PASS  Temp database cleared');

    console.log(`[2/4] Creating temp database: ${TEMP_DB}`);
    await createDatabase(adminClient, TEMP_DB);
    console.log('PASS  Temp database created');

    await runFreshCheckOnTarget({
      label: TEMP_DB,
      url: tempUrl,
      cleanup: async () => {
        if (process.env.KEEP_DB === '1') {
          console.log(`\nKEEP_DB=1 — temp database preserved: ${TEMP_DB}`);
          return;
        }
        await dropDatabaseIfExists(adminClient, TEMP_DB);
        console.log(`\nTemp database dropped: ${TEMP_DB}`);
      },
    });
    return true;
  } finally {
    await adminClient.end().catch(() => {});
  }
}

async function runSchemaFallback(baseUrl) {
  if (!isLocalDatabaseUrl(baseUrl)) {
    throw new Error(
      'Cannot create temp database (permission denied) and schema fallback is only allowed for local DATABASE_URL'
    );
  }

  console.log(`\n[mode] Local schema fallback: ${TEMP_SCHEMA} (user lacks CREATEDB)`);
  console.log('PASS  Using isolated schema in current database — no CREATEDB required');

  await runFreshCheckOnTarget({
    label: `${databaseHost(baseUrl)}/${TEMP_SCHEMA}`,
    url: baseUrl,
    schema: TEMP_SCHEMA,
    cleanup: async () => {
      if (process.env.KEEP_DB === '1') {
        console.log(`\nKEEP_DB=1 — schema preserved: ${TEMP_SCHEMA}`);
        return;
      }
      const client = new Client(getPgClientConfig(baseUrl));
      await client.connect();
      try {
        await dropIsolatedSchema(client, TEMP_SCHEMA);
        console.log(`\nTemp schema dropped: ${TEMP_SCHEMA}`);
      } finally {
        await client.end().catch(() => {});
      }
    },
  });
}

async function main() {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    console.error('FAIL  DATABASE_URL is required');
    process.exit(1);
  }

  console.log('=== WOS-76 Fresh Migration Check ===');
  console.log(`Host: ${databaseHost(baseUrl) || '(unset)'}`);
  console.log(`Temp database: ${TEMP_DB}`);
  console.log(`Temp schema fallback: ${TEMP_SCHEMA}`);
  console.log('Demo seed: never run');

  try {
    try {
      await tryDatabaseIsolation(baseUrl);
    } catch (err) {
      const msg = String(err.message || err);
      const canFallback =
        /permission denied to create database/i.test(msg) || /must be owner of database/i.test(msg);
      if (!canFallback) throw err;
      console.warn(`\nWARN  Temp database creation failed: ${msg}`);
      await runSchemaFallback(baseUrl);
    }

    console.log('\nRESULT: PASS — fresh empty migration check succeeded.');
  } catch (err) {
    console.error(`\nRESULT: FAIL — ${err.message}`);
    console.error(
      '\nTip: grant CREATEDB to your local role, or set DATABASE_URL_ADMIN to a superuser connection string.'
    );
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };
