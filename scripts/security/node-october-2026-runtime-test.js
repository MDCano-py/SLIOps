#!/usr/bin/env node
/**
 * Guards the October 21, 2026 Node.js runtime requirement.
 * Does not start the server, connect to a database, or call a remote host.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { isSupportedNodeVersion } = require('../assert-node-runtime');

const ROOT = path.join(__dirname, '..', '..');
let passed = 0;
let failed = 0;

function assert(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
    return;
  }
  failed += 1;
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(js|cjs|mjs)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

function main() {
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert('package.json engines require patched 24.x', pkg.engines && pkg.engines.node === '>=24.22.1 <25');
  assert(
    'package-lock root engines match',
    lock.packages && lock.packages[''] && lock.packages[''].engines && lock.packages[''].engines.node === '>=24.22.1 <25'
  );
  assert('.nvmrc pins 24.22.1', read('.nvmrc').trim() === '24.22.1');
  assert('.npmrc enables engine-strict', /engine-strict=true/.test(read('.npmrc')));
  assert(
    'this process is Node.js 24.22.1 or later 24.x',
    isSupportedNodeVersion(process.versions.node),
    process.versions.node
  );

  for (const rel of ['scripts/production-server.js', 'scripts/dev-server.js', 'scripts/hub-worker.js']) {
    assert(`${rel} checks the runtime`, /assert-node-runtime/.test(read(rel)));
  }

  const eco = read('deploy/ecosystem.config.cjs');
  const unit = read('deploy/ops-hub-staging.service');
  assert('PM2 file has no snapshot flag', !eco.includes('--build-snapshot'));
  assert('PM2 file has no permission-model flag', !eco.includes('--permission'));
  assert('systemd unit has no snapshot flag', !unit.includes('--build-snapshot'));
  assert('systemd unit has no permission-model flag', !unit.includes('--permission'));
  assert('systemd unit records the 24.22.1 requirement', /24\.22\.1/.test(unit));

  const forbidden = [
    { re: /require\(\s*['"](?:node:)?zlib['"]\s*\)/, label: 'zlib import' },
    { re: /createBrotliDecompress|brotliDecompress(?:Sync)?\s*\(/, label: 'brotli decompress' },
    { re: /\bdns\.(?:resolve|reverse)\b/, label: 'dns.resolve or dns.reverse' },
    { re: /--build-snapshot/, label: 'startup snapshot flag' },
    { re: /--permission\b/, label: 'permission-model flag' },
    { re: /\bZipFile\b/, label: 'node zlib ZipFile' },
  ];
  const roots = [path.join(ROOT, 'api'), path.join(ROOT, 'scripts'), path.join(ROOT, 'deploy')];
  const hits = [];
  for (const root of roots) {
    for (const file of walk(root)) {
      if (file.endsWith(`${path.sep}node-october-2026-runtime-test.js`)) continue;
      const text = fs.readFileSync(file, 'utf8');
      for (const rule of forbidden) {
        if (rule.re.test(text)) hits.push(`${path.relative(ROOT, file)}: ${rule.label}`);
      }
    }
  }
  assert('application source has no advisory-specific call sites', hits.length === 0, hits.join('; '));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
