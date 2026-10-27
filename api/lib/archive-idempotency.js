/**
 * Scoped idempotency for archive and form creates.
 * An explicit idempotency key is remembered for 24h.
 * A byte-identical payload from the same actor and kind is remembered for
 * 2 minutes so a double-click or concurrent retry does not fork records.
 * Distinct payloads are never collapsed by title alone.
 */

const crypto = require('crypto');

const BODY_TTL_MS = 2 * 60 * 1000;
const KEY_TTL_MS = 24 * 60 * 60 * 1000;

const memory = new Map();
const chains = new Map();

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (key === 'idempotency_key' || key === 'idempotencyKey' || key === 'submittedBy') continue;
      out[key] = stable(value[key]);
    }
    return out;
  }
  return value;
}

function idempotencyIdentity(kind, actorEmail, payload) {
  const actor = String(actorEmail || '').toLowerCase();
  const body = payload && typeof payload === 'object' ? payload : {};
  const explicit = body.idempotency_key || body.idempotencyKey || null;
  if (explicit) {
    return {
      key: `idem:${kind}:${actor}:key:${String(explicit).slice(0, 200)}`,
      ttlMs: KEY_TTL_MS,
      explicit: true,
    };
  }
  const hash = crypto.createHash('sha256').update(JSON.stringify(stable(body))).digest('hex');
  return {
    key: `idem:${kind}:${actor}:body:${hash}`,
    ttlMs: BODY_TTL_MS,
    explicit: false,
  };
}

function readMemory(key) {
  const hit = memory.get(key);
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return hit.record;
}

function writeMemory(key, record, ttlMs) {
  memory.set(key, { record, expires: Date.now() + ttlMs });
}

async function withArchiveIdempotency(kind, actorEmail, payload, create) {
  const ident = idempotencyIdentity(kind, actorEmail, payload);
  const previous = chains.get(ident.key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  chains.set(ident.key, tail);
  await previous;
  try {
    const existing = readMemory(ident.key);
    if (existing) return { record: existing, replayed: true };
    const record = await create();
    writeMemory(ident.key, record, ident.ttlMs);
    return { record, replayed: false };
  } finally {
    release();
    if (chains.get(ident.key) === tail) chains.delete(ident.key);
  }
}

function resetArchiveIdempotencyForTests() {
  memory.clear();
  chains.clear();
}

module.exports = {
  BODY_TTL_MS,
  KEY_TTL_MS,
  idempotencyIdentity,
  withArchiveIdempotency,
  resetArchiveIdempotencyForTests,
};
