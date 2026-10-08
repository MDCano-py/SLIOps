/**
 * Lightweight employee directory for authenticated hub features (Control Room, etc.).
 * Uses the same Redis user index as /users — never exposes tokens or full permission sets.
 * No Microsoft Graph. Test override via setEmployeeDirectoryForTests.
 */
const { createRedisClient } = require('../../for-dev/redis-client');

let _testOverride = null;

function setEmployeeDirectoryForTests(fnOrNull) {
  _testOverride = fnOrNull;
}

function sanitizeEmployee(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const email = String(raw.email || '')
    .trim()
    .toLowerCase();
  if (!email || !email.includes('@')) return null;
  const name =
    raw.displayName ||
    raw.name ||
    [raw.firstName, raw.lastName].filter(Boolean).join(' ').trim() ||
    email.split('@')[0];
  const externalId = raw.external_id || raw.oid || raw.externalId || null;
  return {
    id: externalId ? String(externalId) : email,
    email,
    name: String(name),
    external_id: externalId ? String(externalId) : null,
  };
}

async function listEmployeesFromRedis() {
  const redis = createRedisClient();
  const kvEmails = (await redis.smembers('users:index')) || [];
  const bootstrap = (process.env.BOOTSTRAP_ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const seen = new Set();
  const ordered = [];
  for (const e of bootstrap.concat(kvEmails.map((e) => String(e).toLowerCase()))) {
    if (!seen.has(e)) {
      ordered.push(e);
      seen.add(e);
    }
  }
  if (!ordered.length) return [];

  const kvKeys = ordered.filter((e) => !bootstrap.includes(e)).map((e) => `user:${e}`);
  const kvValues = kvKeys.length ? await redis.mget(...kvKeys) : [];
  const kvMap = new Map();
  kvKeys.forEach((k, i) => {
    let v = kvValues[i];
    if (!v) return;
    if (typeof v === 'string') {
      try {
        v = JSON.parse(v);
      } catch {
        return;
      }
    }
    kvMap.set(k, v);
  });

  return ordered
    .map((email) => {
      if (bootstrap.includes(email)) {
        return sanitizeEmployee({ email, displayName: email.split('@')[0], bootstrap: true });
      }
      const rec = kvMap.get(`user:${email}`) || { email };
      return sanitizeEmployee(rec);
    })
    .filter(Boolean);
}

async function listEmployees({ q } = {}) {
  if (typeof _testOverride === 'function') {
    return _testOverride({ q });
  }
  let employees = [];
  try {
    employees = await listEmployeesFromRedis();
  } catch (err) {
    console.warn('[user-directory] list failed:', err.message);
    employees = [];
  }
  const query = String(q || '')
    .trim()
    .toLowerCase();
  if (query) {
    employees = employees.filter(
      (e) =>
        e.email.includes(query) ||
        (e.name && e.name.toLowerCase().includes(query)) ||
        (e.external_id && e.external_id.toLowerCase().includes(query))
    );
  }
  return employees.slice(0, 200);
}

module.exports = {
  listEmployees,
  setEmployeeDirectoryForTests,
  sanitizeEmployee,
};
