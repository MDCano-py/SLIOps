/**
 * WOS-37 — Hub worker: process queued integration_events and outbox_events (email).
 */
const crypto = require('crypto');
const store = require('./store/index.js');
const { processPendingIntegrationEvents } = require('./integrations');
const { processPendingEmailDeliveryEvents } = require('./email-delivery');

function envBool(name, defaultVal = true) {
  const v = process.env[name];
  if (v === undefined || v === '') return defaultVal;
  const s = String(v).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

function getWorkerConfig(overrides = {}) {
  const modeRaw = String(process.env.HUB_WORKER_MODE || 'continuous').toLowerCase();
  const config = {
    mode: modeRaw === 'once' ? 'once' : 'continuous',
    pollIntervalMs: Math.max(1000, Number(process.env.HUB_WORKER_POLL_INTERVAL_MS || 5000)),
    batchSize: Math.min(Math.max(1, Number(process.env.HUB_WORKER_BATCH_SIZE || 10)), 200),
    workerId:
      process.env.HUB_WORKER_ID ||
      `hub-worker-${crypto.randomBytes(4).toString('hex')}`,
    enableIntegrations: envBool('HUB_WORKER_ENABLE_INTEGRATIONS', true),
    enableEmail: envBool('HUB_WORKER_ENABLE_EMAIL', true),
    enableStaleLockRecovery: envBool('HUB_WORKER_ENABLE_STALE_LOCK_RECOVERY', true),
    staleLockMs: Math.max(60_000, Number(process.env.HUB_WORKER_STALE_LOCK_MS || 300_000)),
    hubStoreMode: (process.env.HUB_STORE_MODE || 'postgres').toLowerCase(),
    integrationDispatchMode: (process.env.INTEGRATION_DISPATCH_MODE || 'inline').toLowerCase(),
    emailDeliveryMode: (process.env.EMAIL_DELIVERY_MODE || 'inline').toLowerCase(),
  };
  return { ...config, ...overrides };
}

function logConfig(config) {
  console.log('[hub-worker] starting', {
    mode: config.mode,
    workerId: config.workerId,
    pollIntervalMs: config.pollIntervalMs,
    batchSize: config.batchSize,
    enableIntegrations: config.enableIntegrations,
    enableEmail: config.enableEmail,
    enableStaleLockRecovery: config.enableStaleLockRecovery,
    staleLockMs: config.staleLockMs,
    hubStoreMode: config.hubStoreMode,
    integrationDispatchMode: config.integrationDispatchMode,
    emailDeliveryMode: config.emailDeliveryMode,
  });
}

async function recoverStaleLocks(config) {
  if (!config.enableStaleLockRecovery) {
    return { integration: [], email: [] };
  }
  const out = { integration: [], email: [] };
  try {
    if (typeof store.releaseStaleIntegrationEventLocks === 'function') {
      out.integration = await store.releaseStaleIntegrationEventLocks(config.staleLockMs);
    }
  } catch (err) {
    console.warn('[hub-worker] stale integration lock recovery failed:', err.message);
  }
  try {
    if (typeof store.releaseStaleEmailDeliveryLocks === 'function') {
      out.email = await store.releaseStaleEmailDeliveryLocks(config.staleLockMs);
    }
  } catch (err) {
    console.warn('[hub-worker] stale email lock recovery failed:', err.message);
  }
  return out;
}

async function runWorkerTick(config) {
  const summary = {
    stale: { integration: [], email: [] },
    integration: [],
    email: [],
  };

  if (config.enableStaleLockRecovery) {
    summary.stale = await recoverStaleLocks(config);
    if (summary.stale.integration?.length || summary.stale.email?.length) {
      console.log('[hub-worker] released stale locks', summary.stale);
    }
  }

  if (config.enableIntegrations) {
    try {
      summary.integration = await processPendingIntegrationEvents({
        limit: config.batchSize,
        workerId: config.workerId,
        staleLockMs: config.staleLockMs,
        releaseStaleLocks: false,
      });
    } catch (err) {
      console.warn('[hub-worker] integration batch failed:', err.message);
      summary.integration = [{ ok: false, error: err.message }];
    }
  }

  if (config.enableEmail) {
    try {
      summary.email = await processPendingEmailDeliveryEvents({
        limit: config.batchSize,
        workerId: config.workerId,
        staleLockMs: config.staleLockMs,
        releaseStaleLocks: false,
      });
    } catch (err) {
      console.warn('[hub-worker] email batch failed:', err.message);
      summary.email = [{ ok: false, error: err.message }];
    }
  }

  const integProcessed = summary.integration.filter((r) => r.ok || r.skipped || r.deduped).length;
  const emailProcessed = summary.email.filter((r) => r.ok || r.skipped).length;
  const integFailed = summary.integration.filter((r) => r.ok === false && !r.skipped).length;
  const emailFailed = summary.email.filter((r) => r.ok === false && !r.skipped).length;

  if (summary.integration.length || summary.email.length) {
    console.log('[hub-worker] tick complete', {
      integration: { claimed: summary.integration.length, ok: integProcessed, failed: integFailed },
      email: { claimed: summary.email.length, ok: emailProcessed, failed: emailFailed },
    });
  }

  return summary;
}

function sleep(ms, shouldStop) {
  if (!shouldStop) return new Promise((resolve) => setTimeout(resolve, ms));
  const step = Math.min(500, ms);
  return new Promise((resolve) => {
    let elapsed = 0;
    const tick = () => {
      if (shouldStop() || elapsed >= ms) return resolve();
      elapsed += step;
      setTimeout(tick, step);
    };
    tick();
  });
}

/**
 * Run worker until shutdown signal (continuous) or one tick (once).
 * @returns {{ ticks: number, lastSummary: object|null }}
 */
async function runHubWorker(configOverrides = {}, { shouldStop } = {}) {
  const config = getWorkerConfig(configOverrides);
  logConfig(config);

  if (config.hubStoreMode !== 'postgres') {
    console.warn('[hub-worker] WARN: HUB_STORE_MODE is not postgres — worker requires Postgres outbox tables');
  }

  let ticks = 0;
  let lastSummary = null;
  let stopping = false;

  const stop = () => {
    if (!stopping) {
      stopping = true;
      console.log('[hub-worker] shutdown requested');
    }
  };

  const isStopping = () => stopping || (typeof shouldStop === 'function' && shouldStop());

  do {
    if (isStopping()) {
      stop();
      break;
    }

    lastSummary = await runWorkerTick(config);
    ticks += 1;

    if (config.mode === 'once') break;
    if (isStopping()) break;

    await sleep(config.pollIntervalMs, isStopping);
  } while (config.mode === 'continuous');

  console.log('[hub-worker] stopped', { ticks, mode: config.mode });
  return { ticks, lastSummary, config };
}

module.exports = {
  getWorkerConfig,
  logConfig,
  recoverStaleLocks,
  runWorkerTick,
  runHubWorker,
};
