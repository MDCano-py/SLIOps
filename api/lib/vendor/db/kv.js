/**
 * Legacy vendor persistence — Upstash Redis / local KV.
 */

const { createRedisClient } = require('../../../../for-dev/redis-client');

const redis = createRedisClient();

async function readVendorRecord(ref) {
  const record = await redis.get(`vendor:${ref}`);
  if (!record) return null;
  const parsed = typeof record === 'string' ? JSON.parse(record) : record;
  return { record: parsed };
}

async function writeVendorRecord(ref, record) {
  const score = new Date(record.createdAt || Date.now()).getTime();
  const p = redis.pipeline();
  p.set(`vendor:${ref}`, JSON.stringify(record));
  p.zadd('vendors:by-date', { score, member: ref });
  await p.exec();
}

async function listAllVendorRefs() {
  return await redis.zrange('vendors:by-date', 0, -1, { rev: true });
}

async function getAllVendorRecords() {
  const refs = await listAllVendorRefs();
  if (refs.length === 0) return [];
  const keys = refs.map((r) => `vendor:${r}`);
  const values = await redis.mget(...keys);
  return values
    .map((v) => {
      if (!v) return null;
      return typeof v === 'string' ? JSON.parse(v) : v;
    })
    .filter(Boolean);
}

module.exports = {
  readVendorRecord,
  writeVendorRecord,
  getAllVendorRecords,
};
