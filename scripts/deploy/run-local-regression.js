#!/usr/bin/env node
/**
 * Run the local release regression commands and print pass/fail.
 * Does not deploy and does not call a remote host.
 */
'use strict';

const { spawnSync } = require('child_process');
const pkg = require('../../package.json');

const names = Object.keys(pkg.scripts).filter((name) => {
  if (name === 'security:remediate-stale-manage-sso') return false;
  return (
    name === 'templates:new-request-registry-test' ||
    name.startsWith('security:') ||
    name.startsWith('vendor-') ||
    name === 'perf:vendor-scope-bench'
  );
});

let failed = 0;
for (const name of names) {
  const started = Date.now();
  const result = spawnSync('npm', ['run', name], {
    stdio: 'inherit',
    shell: true,
    env: process.env,
    timeout: 180000,
  });
  const code = result.status == null ? 1 : result.status;
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\nRESULT ${code === 0 ? 'PASS' : 'FAIL'} ${name} exit=${code} ${seconds}s\n`);
  if (code !== 0) failed += 1;
}

console.log(`REGRESSION_DONE scripts=${names.length} failed=${failed}`);
process.exit(failed ? 1 : 0);
