/**
 * Shared Postgres pool for vendor identity tables (same hub DB as vendor_master).
 */
const { Pool } = require('pg');
const { resolvePgSsl } = require('../../hub/db/pg-ssl');

let pool = null;

function getPool() {
  if (pool) return pool;
  const connectionString = String(process.env.DATABASE_URL || '').trim();
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for vendor identity');
  }
  pool = new Pool({
    connectionString,
    ssl: resolvePgSsl(connectionString),
    max: Number(process.env.PG_POOL_MAX || 8),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  return pool;
}

function isPostgresConfigured() {
  return Boolean(String(process.env.DATABASE_URL || '').trim());
}

module.exports = { getPool, isPostgresConfigured };
