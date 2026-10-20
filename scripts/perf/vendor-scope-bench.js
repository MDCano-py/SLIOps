#!/usr/bin/env node
/**
 * Compare full-registry filtering with a keyed lookup.
 * Prints timings. Does not require Postgres for the in-memory case.
 */
'use strict';

const fs = require('fs');
const path = require('path');

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

const ROOT = path.join(__dirname, '..', '..');
loadEnvFile(path.join(ROOT, '.env.local.postgres'));
loadEnvFile(path.join(ROOT, '.env.local'));

function benchMemory(n, iterations) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: `id-${i}`, companyName: `Vendor ${i}` }));
  const target = rows[n - 1].id;
  const scanStart = process.hrtime.bigint();
  for (let i = 0; i < iterations; i += 1) rows.find((row) => row.id === target);
  const scanMs = Number(process.hrtime.bigint() - scanStart) / 1e6;
  const map = new Map(rows.map((row) => [row.id, row]));
  const keyStart = process.hrtime.bigint();
  for (let i = 0; i < iterations; i += 1) map.get(target);
  const keyedMs = Number(process.hrtime.bigint() - keyStart) / 1e6;
  return { n, iterations, scanMs: Number(scanMs.toFixed(3)), keyedMs: Number(keyedMs.toFixed(3)) };
}

async function main() {
  const memory = [100, 1000, 5000].map((n) => benchMemory(n, 200));
  const result = { memory, postgres: null };
  if (process.env.DATABASE_URL) {
    process.env.VENDOR_STORE_MODE = 'postgres';
    process.env.HUB_STORE_MODE = process.env.HUB_STORE_MODE || 'postgres';
    const vendorStore = require('../../api/lib/vendor/store');
    const scanStart = process.hrtime.bigint();
    const all = await vendorStore.getAllVendorRecords();
    const scanMs = Number(process.hrtime.bigint() - scanStart) / 1e6;
    const sample = all[0];
    let keyedMs = null;
    if (sample && sample.id) {
      const keyStart = process.hrtime.bigint();
      await vendorStore.getVendorRecordById(sample.id);
      keyedMs = Number(process.hrtime.bigint() - keyStart) / 1e6;
    }
    result.postgres = {
      rows: all.length,
      getAllVendorRecordsMs: Number(scanMs.toFixed(3)),
      getVendorRecordByIdMs: keyedMs == null ? null : Number(keyedMs.toFixed(3)),
    };
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
