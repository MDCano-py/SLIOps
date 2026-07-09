#!/usr/bin/env node
/**
 * WOS-80 — Cross-platform dependency vulnerability audit (report-only).
 * Usage: npm run security:audit
 *
 * Runs `npm audit --omit=dev` and always exits 0 so it can be run everywhere
 * (Windows/macOS/Linux, CI) without failing the pipeline. Triage the printed
 * report manually; upgrades that require breaking major bumps are tracked in
 * the WOS-80 report rather than auto-applied.
 */
const { spawnSync } = require('child_process');

// shell:true so Windows resolves npm/npm.cmd correctly (avoids EINVAL).
const result = spawnSync('npm audit --omit=dev', { stdio: 'inherit', shell: true });

if (result.error) {
  console.error('[security:audit] Could not run npm audit:', result.error.message);
}
// Report-only: never fail the build on advisory findings.
process.exit(0);
