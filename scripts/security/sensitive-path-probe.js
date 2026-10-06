#!/usr/bin/env node
/**
 * Gate 1 — Sensitive path exposure probe (local + optional remote).
 *
 * Usage:
 *   npm run security:sensitive-path-probe
 *   PROBE_BASE_URL=https://automation.streamlinescada.com/ops-hub-staging npm run security:sensitive-path-probe
 *
 * Local mode spins a temporary server against the current tree and asserts
 * blocked paths return 404 without leaking file contents.
 * Remote mode (PROBE_BASE_URL set) probes a live URL the same way.
 */
const http = require('http');
const https = require('https');
const path = require('path');
const { URL } = require('url');

const ROOT = path.join(__dirname, '..', '..');

let passed = 0;
let failed = 0;

function assert(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const PROBE_PATHS = [
  '/.env',
  '/.env.staging',
  '/.env.local',
  '/.env.example',
  '/.git/HEAD',
  '/.git/config',
  '/package.json',
  '/package-lock.json',
  '/migrations/001_init.sql',
  '/scripts/server-core.js',
  '/api/maintainx.js',
  '/deploy/ecosystem.config.cjs',
  '/for-dev/local-redis.js',
  '/docs/cyber/CYBER_PENTEST_HANDOFF.md',
  '/.gitignore',
  '/backup.sql',
  '/app.bak',
  '/hub.js.map',
];

const ALLOWED_SMOKE = ['/', '/index.html', '/hub.js', '/hub.css', '/config.js'];

function fetchUrl(targetUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'GET',
        headers: { Accept: '*/*' },
        timeout: 15000,
        rejectUnauthorized: process.env.PROBE_TLS_INSECURE === '1' ? false : true,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            body: Buffer.concat(chunks).toString('utf8').slice(0, 4000),
          });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.end();
  });
}

function looksLikeSecretLeak(body, probePath) {
  const b = String(body || '');
  if (!b) return false;
  if (probePath.includes('.env') && /(?:DATABASE_URL|SESSION_SECRET|MAINTAINX_API_KEY)\s*=/.test(b)) {
    return true;
  }
  if (probePath.includes('.git') && (b.startsWith('ref:') || b.includes('[core]'))) return true;
  if (probePath.endsWith('package.json') && /"name"\s*:\s*"streamline-maintainx-proxy"/.test(b)) {
    return true;
  }
  if (probePath.includes('migrations/') && /CREATE TABLE/i.test(b)) return true;
  if (probePath.includes('server-core.js') && /function serveStatic/.test(b)) return true;
  return false;
}

async function probeBase(baseUrl) {
  const base = String(baseUrl).replace(/\/+$/, '');
  console.log(`\nProbing base: ${base}\n`);

  for (const p of PROBE_PATHS) {
    const res = await fetchUrl(`${base}${p}`);
    const leaked = looksLikeSecretLeak(res.body, p);
    assert(
      `blocked ${p} → no content leak (status ${res.status})`,
      !leaked && res.status !== 200,
      leaked ? 'CONTENT LEAKED' : `unexpected status ${res.status}`
    );
    // Prefer 404; accept 401/403 from edge auth only if body is empty of secrets
    if (res.status === 200) {
      assert(`blocked ${p} must not be 200`, false, 'HTTP 200');
    }
  }

  for (const p of ALLOWED_SMOKE) {
    const res = await fetchUrl(`${base}${p}`);
    assert(
      `allowed ${p} reachable (status ${res.status})`,
      res.status === 200,
      `got ${res.status}`
    );
  }
}

async function runLocal() {
  const saved = { ...process.env };
  process.env.NODE_ENV = 'development';
  process.env.PORT = '0';
  process.env.HOST = '127.0.0.1';
  process.env.APP_BASE_PATH = '';
  delete process.env.DEMO_BYPASS;
  delete process.env.ALLOW_DEV_LOGIN;

  const { createServer } = require(path.join(ROOT, 'scripts', 'server-core.js'));
  const { listen } = createServer({
    getHandler: async () => async (_req, res) => res.status(404).json({ error: 'none' }),
    envFiles: [],
    defaultNodeEnv: 'development',
    port: 0,
    host: '127.0.0.1',
    ensureArchiveDemoSeed: false,
    logLocalNoauth: false,
  });
  const started = await listen();
  const addr = started.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : started.port;
  const base = `http://127.0.0.1:${port}`;
  try {
    await probeBase(base);
  } finally {
    await new Promise((resolve) => started.server.close(resolve));
    Object.keys(process.env).forEach((k) => {
      if (!(k in saved)) delete process.env[k];
    });
    Object.assign(process.env, saved);
  }
}

async function main() {
  console.log('=== Gate 1 Sensitive Path Probe ===');

  // Static unit checks on denylist helper via serve behavior
  await runLocal();

  if (process.env.PROBE_BASE_URL) {
    await probeBase(process.env.PROBE_BASE_URL);
  } else {
    console.log('\n(skip remote) Set PROBE_BASE_URL to probe staging/production.');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
