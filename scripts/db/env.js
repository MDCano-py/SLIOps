/**
 * Shared env loading and DATABASE_URL safety helpers for db:* scripts.
 */
const fs = require('fs');
const path = require('path');
const { resolvePgSsl, isLocalPgHost, parsePgHost } = require('../../api/lib/hub/db/pg-ssl');

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

function loadDbEnv() {
  loadEnvFile(path.join(ROOT, '.env.local.postgres'));
  loadEnvFile(path.join(ROOT, '.env.local'));
  loadEnvFile(path.join(ROOT, '.env.staging'));
  loadEnvFile(path.join(ROOT, '.env'));
}

function parseDatabaseUrl(url) {
  if (!url) return null;
  try {
    return new URL(String(url).replace(/^postgresql:/i, 'postgres:'));
  } catch {
    return null;
  }
}

function databaseHost(url = process.env.DATABASE_URL) {
  return parsePgHost(url);
}

function isLocalDatabaseUrl(url = process.env.DATABASE_URL) {
  return isLocalPgHost(parsePgHost(url));
}

function getPgClientConfig(url = process.env.DATABASE_URL) {
  return { connectionString: url, ssl: resolvePgSsl(url) };
}

function assertResetAllowed() {
  const env = (process.env.NODE_ENV || '').toLowerCase();
  if (env === 'production') {
    throw new Error('Refusing db:reset when NODE_ENV=production');
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }
  if (!isLocalDatabaseUrl() && process.env.DATABASE_URL_CONFIRM_RESET !== '1') {
    throw new Error(
      `Refusing db:reset against non-local host "${databaseHost()}". ` +
        'Set DATABASE_URL_CONFIRM_RESET=1 only if you intentionally target staging/RDS (DANGEROUS).'
    );
  }
}

function assertPersistenceTestAllowed() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }
  const env = (process.env.NODE_ENV || '').toLowerCase();
  if (env === 'production') {
    throw new Error('Refusing db:persistence-test when NODE_ENV=production');
  }
  if (!isLocalDatabaseUrl() && process.env.DATABASE_URL_CONFIRM_PERSISTENCE_TEST !== '1') {
    throw new Error(
      `Refusing db:persistence-test against non-local host "${databaseHost()}". ` +
        'Set DATABASE_URL_CONFIRM_PERSISTENCE_TEST=1 only if you intentionally target staging/RDS (writes PERSISTENCE_TEST_* rows, then cleans up).'
    );
  }
}

function isDeployedNodeEnv() {
  const env = (process.env.NODE_ENV || '').toLowerCase();
  return env === 'staging' || env === 'production';
}

function assertLocalDemoValidationAllowed() {
  if (isDeployedNodeEnv()) {
    throw new Error(
      `Refusing db:validate:demo when NODE_ENV=${process.env.NODE_ENV}. Demo validation is local development only.`
    );
  }
  if (!isLocalDatabaseUrl() && process.env.DATABASE_URL_CONFIRM_DEMO_VALIDATE !== '1') {
    throw new Error(
      `Refusing db:validate:demo against non-local host "${databaseHost()}". ` +
        'Demo validation writes demo rows. Use a local DATABASE_URL or set DATABASE_URL_CONFIRM_DEMO_VALIDATE=1 only if intentional.'
    );
  }
}

function assertLocalSeedAllowed() {
  if (isDeployedNodeEnv()) {
    throw new Error(
      `Refusing demo seed when NODE_ENV=${process.env.NODE_ENV}. Use db:seed only in local development.`
    );
  }
}

function resolvePgConnectionParts(url = process.env.DATABASE_URL) {
  const parsed = parseDatabaseUrl(url);
  if (!parsed) {
    return {
      host: process.env.PGHOST || '127.0.0.1',
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || '',
      database: process.env.PGDATABASE || process.env.PGDATABASE_ADMIN || 'postgres',
    };
  }
  return {
    host: parsed.hostname || process.env.PGHOST || '127.0.0.1',
    port: Number(parsed.port || process.env.PGPORT || 5432),
    user: decodeURIComponent(parsed.username || process.env.PGUSER || 'postgres'),
    password: decodeURIComponent(parsed.password || process.env.PGPASSWORD || ''),
    database: (parsed.pathname || '/postgres').replace(/^\//, '') || 'postgres',
  };
}

function buildDatabaseUrl(parts, databaseName) {
  const host = parts.host || '127.0.0.1';
  const port = parts.port || 5432;
  const user = encodeURIComponent(parts.user || 'postgres');
  const password = encodeURIComponent(parts.password || '');
  const db = databaseName || parts.database || 'postgres';
  const auth = password ? `${user}:${password}` : user;
  return `postgresql://${auth}@${host}:${port}/${db}`;
}

function getAdminPgConfig(url = process.env.DATABASE_URL) {
  if (process.env.DATABASE_URL_ADMIN) {
    const adminUrl = process.env.DATABASE_URL_ADMIN;
    const parts = resolvePgConnectionParts(adminUrl);
    return {
      ...getPgClientConfig(adminUrl),
      database: parts.database,
      host: parts.host,
      port: parts.port,
      user: parts.user,
      password: parts.password,
    };
  }
  const parts = resolvePgConnectionParts(url);
  const adminDb = process.env.PGDATABASE_ADMIN || 'postgres';
  const adminUser = process.env.PGADMIN_USER || process.env.PGUSER || parts.user;
  const adminPassword = process.env.PGADMIN_PASSWORD ?? process.env.PGPASSWORD ?? parts.password;
  const connectionString = buildDatabaseUrl(
    { host: parts.host, port: parts.port, user: adminUser, password: adminPassword },
    adminDb
  );
  return {
    ...getPgClientConfig(connectionString),
    database: adminDb,
    host: parts.host,
    port: parts.port,
    user: adminUser,
    password: adminPassword,
  };
}

module.exports = {
  ROOT,
  loadDbEnv,
  parseDatabaseUrl,
  databaseHost,
  isLocalDatabaseUrl,
  isDeployedNodeEnv,
  getPgClientConfig,
  assertResetAllowed,
  assertPersistenceTestAllowed,
  assertLocalDemoValidationAllowed,
  assertLocalSeedAllowed,
  resolvePgConnectionParts,
  buildDatabaseUrl,
  getAdminPgConfig,
};
