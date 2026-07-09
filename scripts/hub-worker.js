#!/usr/bin/env node
/**
 * WOS-37 — Hub worker entrypoint (integration + email outbox processor).
 *
 * Usage:
 *   npm run hub-worker          # continuous (default)
 *   npm run hub-worker:once     # single tick then exit
 */
const { loadDbEnv } = require('./db/env');

loadDbEnv();

if (process.argv.includes('--once')) {
  process.env.HUB_WORKER_MODE = 'once';
}

process.env.HUB_STORE_MODE = process.env.HUB_STORE_MODE || 'postgres';
process.env.HUB_USE_LOCAL_STORE = process.env.HUB_USE_LOCAL_STORE || '0';

if (!process.env.DATABASE_URL) {
  console.error('[hub-worker] DATABASE_URL is required');
  process.exit(1);
}

const { runHubWorker } = require('../api/lib/hub/worker');

let shuttingDown = false;

function requestShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[hub-worker] received ${signal}`);
}

process.on('SIGINT', () => requestShutdown('SIGINT'));
process.on('SIGTERM', () => requestShutdown('SIGTERM'));

runHubWorker({}, { shouldStop: () => shuttingDown })
  .then(({ ticks, config }) => {
    process.exit(config.mode === 'once' ? 0 : 0);
  })
  .catch((err) => {
    console.error('[hub-worker] fatal error:', err);
    process.exit(1);
  });
