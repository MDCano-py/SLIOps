/**
 * Shared PostgreSQL SSL resolution for local dev vs RDS.
 */
function parsePgHost(connectionString) {
  if (!connectionString) return '';
  try {
    const u = new URL(String(connectionString).replace(/^postgresql:/i, 'postgres:'));
    return (u.hostname || '').toLowerCase();
  } catch {
    return '';
  }
}

function isLocalPgHost(host) {
  return ['localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(host);
}

function resolvePgSsl(connectionString = process.env.DATABASE_URL) {
  const mode = (process.env.PGSSLMODE || '').toLowerCase();
  if (mode === 'disable') return false;
  if (mode === 'require' || mode === 'verify-full') {
    return { rejectUnauthorized: mode === 'verify-full' };
  }
  const host = parsePgHost(connectionString);
  if (host && !isLocalPgHost(host)) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

module.exports = {
  parsePgHost,
  isLocalPgHost,
  resolvePgSsl,
};
