#!/usr/bin/env node
/**
 * Print applied schema_migrations ids. Read-only.
 * Refuses a non-local host unless ALLOW_REMOTE_MIGRATION_LIST=1.
 */
'use strict';

const { Client } = require('pg');
const { loadDbEnv, getPgClientConfig, parseDatabaseUrl } = require('../db/env');

loadDbEnv();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const parsed = parseDatabaseUrl(url);
  const host = parsed ? parsed.hostname : '';
  const local = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (!local && process.env.ALLOW_REMOTE_MIGRATION_LIST !== '1') {
    console.error(`Refusing remote database host ${host}. Set ALLOW_REMOTE_MIGRATION_LIST=1 to list only.`);
    process.exit(2);
  }
  const client = new Client(getPgClientConfig(url));
  await client.connect();
  try {
    const { rows } = await client.query(
      'SELECT id, applied_at FROM schema_migrations ORDER BY id'
    );
    console.log(`host=${host} count=${rows.length}`);
    for (const row of rows) {
      console.log(`${row.id}\t${new Date(row.applied_at).toISOString()}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
