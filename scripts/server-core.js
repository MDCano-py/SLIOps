/**
 * Shared HTTP server for local dev and EC2 staging/production.
 * Serves static portal + /api/maintainx (and auth route aliases).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = path.join(__dirname, '..');
const PKG = require(path.join(ROOT, 'package.json'));

function loadEnvFile(filePath, { override = false } = {}) {
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
    if (override || process.env[key] === undefined) process.env[key] = val;
  }
}

function normalizeBasePath(raw) {
  if (!raw || raw === '/') return '';
  let b = String(raw).trim();
  if (!b.startsWith('/')) b = `/${b}`;
  if (b.endsWith('/')) b = b.slice(0, -1);
  return b;
}

function stripBasePath(pathname, basePath) {
  if (!basePath) return pathname || '/';
  if (pathname === basePath) return '/';
  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length) || '/';
  }
  return pathname;
}

function withBasePath(basePath, route) {
  const r = route.startsWith('/') ? route : `/${route}`;
  return `${basePath || ''}${r}` || '/';
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// WOS-79 — baseline browser-protection headers applied to every response.
// These are intentionally conservative (no Content-Security-Policy, which is
// left to the Nginx/ALB layer to avoid breaking the app's inline scripts).
// HSTS is only emitted for deployed (staging/production) environments where
// TLS terminates at the reverse proxy; it is a no-op / undesirable over plain
// http local dev. See PENTEST_READINESS_PACKAGE.md for the full header list.
function applyBaseSecurityHeaders(nodeRes) {
  try {
    nodeRes.setHeader('X-Content-Type-Options', 'nosniff');
    nodeRes.setHeader('X-Frame-Options', 'SAMEORIGIN');
    nodeRes.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    nodeRes.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    // Legacy XSS auditor is deprecated; explicitly disable to avoid its bugs.
    nodeRes.setHeader('X-XSS-Protection', '0');
    const env = String(process.env.NODE_ENV || '').toLowerCase();
    if (env === 'staging' || env === 'production') {
      nodeRes.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
  } catch {
    /* headers already sent — ignore */
  }
}

// WOS-79 — cap request body size to mitigate memory-exhaustion DoS. Generous
// default (25 MB) to allow photo/document uploads; override with
// MAX_REQUEST_BODY_BYTES. 0 or negative disables the cap.
function getMaxRequestBodyBytes() {
  const raw = Number(process.env.MAX_REQUEST_BODY_BYTES);
  if (Number.isFinite(raw) && raw > 0) return raw;
  if (process.env.MAX_REQUEST_BODY_BYTES !== undefined && raw <= 0) return 0;
  return 25 * 1024 * 1024;
}

function createServer(options = {}) {
  const envFiles = options.envFiles || [path.join(ROOT, '.env.local'), path.join(ROOT, '.env')];
  for (const f of envFiles) loadEnvFile(f);
  // Optional Postgres overlay for local template/hub development.
  const pgEnv = path.join(ROOT, '.env.local.postgres');
  if (fs.existsSync(pgEnv)) loadEnvFile(pgEnv, { override: true });

  if (!process.env.NODE_ENV) process.env.NODE_ENV = options.defaultNodeEnv || 'development';

  const PORT = Number(process.env.PORT) || options.defaultPort || 3000;
  const HOST = process.env.HOST || options.defaultHost || '127.0.0.1';
  const basePath = normalizeBasePath(process.env.APP_BASE_PATH || options.basePath || '');

  let _handler = null;
  function getHandler() {
    if (!_handler) {
      _handler = require(path.join(ROOT, 'api', 'maintainx.js'));
    }
    return _handler;
  }

  async function buildHealthPayload() {
    // WOS-84 — do not call getStoreMode()/createRedisClient() when Postgres is SoR.
    const {
      getLegacyKvStatus,
      hasUpstashEnv,
      shouldUseLocalStore,
      isPostgresOnlyMode,
      getStoreMode,
    } = require(path.join(ROOT, 'for-dev', 'redis-client'));
    const { getHubStoreMode, checkHubStoreHealth } = require(path.join(
      ROOT,
      'api',
      'lib',
      'hub',
      'db',
      'index.js'
    ));

    const hubStoreMode = getHubStoreMode();
    const postgresOnly = isPostgresOnlyMode() || hubStoreMode === 'postgres';
    const legacyKv = getLegacyKvStatus();

    let hubHealth = {};
    try {
      hubHealth = await checkHubStoreHealth();
    } catch (err) {
      hubHealth = { store_ok: false, store_error: err.message, hub_store_mode: hubStoreMode };
    }

    const storeOk = !!hubHealth.store_ok;
    const storeError = hubHealth.store_error || null;

    const ssoOff = (process.env.SSO_ENFORCEMENT || 'on').toLowerCase() === 'off';
    const demoBypass = ['1', 'true', 'yes'].includes(
      String(process.env.DEMO_BYPASS || '').toLowerCase()
    );

    // Only resolve legacy Redis mode when Redis/local JSON is the selected store.
    const legacyStoreMode = postgresOnly ? null : getStoreMode();

    return {
      ok: storeOk,
      service: 'streamline-ops-hub',
      version: PKG.version,
      uptime_seconds: Math.floor(process.uptime()),
      node_env: process.env.NODE_ENV,
      port: PORT,
      host: HOST,
      app_base_path: basePath || '/',
      hub_store_mode: hubStoreMode,
      store_mode: hubStoreMode === 'postgres' ? 'postgres' : legacyStoreMode,
      redis_configured: hasUpstashEnv(),
      redis_backend: postgresOnly ? 'not_applicable' : legacyKv.redis_backend || legacyStoreMode,
      legacy_kv: postgresOnly ? 'disabled' : legacyKv.legacy_kv,
      local_store_enabled: postgresOnly
        ? false
        : shouldUseLocalStore() || hubStoreMode === 'local_json',
      postgres: hubHealth.postgres || null,
      store_ok: storeOk,
      store_error: storeError,
      sso_enforcement: ssoOff ? 'off' : 'on',
      demo_bypass: demoBypass,
      entra_configured: !!(process.env.ENTRA_TENANT_ID && process.env.ENTRA_CLIENT_ID),
      staging_test_login_enabled: (() => {
        try {
          return require(path.join(ROOT, 'api', 'lib', 'staging-test-login')).isStagingTestLoginEnabled();
        } catch {
          return false;
        }
      })(),
      staging_demo_data_enabled:
        process.env.NODE_ENV === 'staging' &&
        ['1', 'true', 'yes'].includes(String(process.env.STAGING_DEMO_DATA_ENABLED || '').toLowerCase()),
      maintainx_configured: !!process.env.MAINTAINX_API_KEY,
      warnings: [
        ...(process.env.NODE_ENV === 'staging' && !postgresOnly && shouldUseLocalStore()
          ? ['HUB_USE_LOCAL_STORE is enabled on staging — use Upstash for multi-tester approval']
          : []),
        ...(ssoOff && process.env.NODE_ENV === 'staging'
          ? ['SSO_ENFORCEMENT=off on staging — disable _noauth and enable SSO before approval']
          : []),
        ...(demoBypass && process.env.NODE_ENV === 'staging'
          ? ['DEMO_BYPASS is enabled on staging']
          : []),
      ].filter(Boolean),
    };
  }

  function serveRuntimeConfig(res) {
    const body = [
      `window.APP_BASE_PATH=${JSON.stringify(basePath)};`,
      `window.PORTAL_ENV=${JSON.stringify(process.env.NODE_ENV || 'development')};`,
    ].join('\n');
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  }

  function serveStatic(nodeRes, filePath) {
    const rel = filePath.replace(/^\/+/, '') || 'index.html';
    const safe = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
    const full = path.join(ROOT, safe === '.' ? 'index.html' : safe);
    if (!full.startsWith(ROOT)) {
      nodeRes.writeHead(403);
      nodeRes.end('Forbidden');
      return;
    }
    let target = full;
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      target = path.join(target, 'index.html');
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      nodeRes.writeHead(404);
      nodeRes.end('Not found');
      return;
    }
    const ext = path.extname(target).toLowerCase();
    nodeRes.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(target).pipe(nodeRes);
  }

  function parseQuery(searchParams) {
    const q = {};
    for (const [k, v] of searchParams.entries()) {
      if (q[k] === undefined) q[k] = v;
      else if (Array.isArray(q[k])) q[k].push(v);
      else q[k] = [q[k], v];
    }
    return q;
  }

  function createMockRes(nodeRes) {
    let statusCode = 200;
    let body;
    const headers = {};
    let ended = false;

    function flush() {
      if (ended) return;
      ended = true;
      nodeRes.writeHead(statusCode, headers);
      nodeRes.end(body);
    }

    const res = {
      statusCode: 200,
      status(code) {
        statusCode = code;
        res.statusCode = code;
        return res;
      },
      setHeader(k, v) {
        headers[k] = v;
      },
      getHeader(k) {
        return headers[k];
      },
      json(obj) {
        if (!headers['Content-Type']) headers['Content-Type'] = 'application/json; charset=utf-8';
        body = JSON.stringify(obj);
        flush();
        return res;
      },
      send(payload) {
        if (payload !== undefined && payload !== null) body = payload;
        flush();
        return res;
      },
      end(payload) {
        if (payload !== undefined && payload !== null) body = payload;
        flush();
        return res;
      },
      redirect(url) {
        headers.Location = url;
        statusCode = 302;
        flush();
        return res;
      },
    };
    return res;
  }

  function createMockReqRes(nodeReq, nodeRes, url) {
    const chunks = [];
    const maxBodyBytes = getMaxRequestBodyBytes();
    let received = 0;
    let aborted = false;
    nodeReq.on('data', (c) => {
      if (aborted) return;
      received += c.length;
      if (maxBodyBytes && received > maxBodyBytes) {
        aborted = true;
        if (!nodeRes.writableEnded) {
          nodeRes.writeHead(413, { 'Content-Type': 'application/json' });
          nodeRes.end(JSON.stringify({ error: 'Payload too large' }));
        }
        nodeReq.destroy();
        return;
      }
      chunks.push(c);
    });
    nodeReq.on('end', async () => {
      if (aborted) return;
      const bodyBuf = Buffer.concat(chunks);
      let body;
      if (bodyBuf.length) {
        const ct = String(nodeReq.headers['content-type'] || '').toLowerCase();
        const raw = bodyBuf.toString('utf8');
        const looksJson =
          ct.includes('application/json') ||
          raw.trim().startsWith('{') ||
          raw.trim().startsWith('[');
        if (looksJson) {
          try {
            body = JSON.parse(raw);
          } catch {
            body = raw;
          }
        } else {
          body = bodyBuf;
        }
      }
      const mockReq = {
        method: nodeReq.method,
        url: url.pathname + url.search,
        headers: { ...nodeReq.headers },
        query: parseQuery(url.searchParams),
        body,
      };
      const mockRes = createMockRes(nodeRes);
      try {
        await getHandler()(mockReq, mockRes);
        if (!nodeRes.writableEnded) {
          mockRes.end();
        }
      } catch (err) {
        console.error('[server] API error:', err);
        if (!nodeRes.writableEnded) {
          nodeRes.writeHead(500, { 'Content-Type': 'text/plain' });
          nodeRes.end('Internal Server Error');
        }
      }
    });
  }

  const server = http.createServer((nodeReq, nodeRes) => {
    nodeReq.setTimeout(120000);
    applyBaseSecurityHeaders(nodeRes);
    const url = new URL(nodeReq.url || '/', `http://${nodeReq.headers.host || 'localhost'}`);
    let pathname = stripBasePath(url.pathname, basePath);

    if (pathname === '/health' || pathname === '/health/') {
      buildHealthPayload()
        .then((payload) => {
          const code = payload.ok ? 200 : 503;
          nodeRes.writeHead(code, { 'Content-Type': 'application/json' });
          nodeRes.end(JSON.stringify(payload));
        })
        .catch((err) => {
          nodeRes.writeHead(503, { 'Content-Type': 'application/json' });
          nodeRes.end(JSON.stringify({ ok: false, error: err.message }));
        });
      return;
    }

    if (pathname === '/config.js') {
      serveRuntimeConfig(nodeRes);
      return;
    }

    if (pathname === '/api/maintainx' || pathname.startsWith('/api/maintainx/')) {
      const apiUrl = new URL(pathname + url.search, url.origin);
      createMockReqRes(nodeReq, nodeRes, apiUrl);
      return;
    }

    const authMatch = pathname.match(/^\/api\/auth\/(.+)$/);
    if (authMatch) {
      url.searchParams.set('path', `/auth/${authMatch[1]}`);
      const dest = new URL(`/api/maintainx${url.search}`, url.origin);
      createMockReqRes(nodeReq, nodeRes, dest);
      return;
    }

    const ssoMatch = pathname.match(/^\/sso\/([^/]+)\/(login|acs|metadata)$/);
    if (ssoMatch) {
      url.searchParams.set('path', `/sso/${ssoMatch[1]}/${ssoMatch[2]}`);
      const dest = new URL(`/api/maintainx${url.search}`, url.origin);
      createMockReqRes(nodeReq, nodeRes, dest);
      return;
    }

    if (pathname === '/api/me') {
      url.searchParams.set('path', '/me');
      const dest = new URL(`/api/maintainx${url.search}`, url.origin);
      createMockReqRes(nodeReq, nodeRes, dest);
      return;
    }

    serveStatic(nodeRes, pathname);
  });

  function listen() {
    return new Promise((resolve, reject) => {
      server.on('error', (err) => {
        if (err && err.code === 'EADDRINUSE') {
          const displayHost = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
          console.error(`\n  Port ${PORT} is already in use on ${displayHost}.`);
          console.error('  Another dev server may still be running.\n');
          console.error('  Windows — find the process:');
          console.error(`    netstat -ano | findstr :${PORT}`);
          console.error('  Windows — stop it (replace <pid> with the PID from netstat):');
          console.error('    taskkill /PID <pid> /F\n');
          reject(err);
          return;
        }
        reject(err);
      });
      server.listen(PORT, HOST, async () => {
        const displayHost = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
        const publicBase = basePath || '';
        const base = `http://${displayHost}:${PORT}${publicBase}`;
        const nodeEnv = process.env.NODE_ENV || 'development';

        if (nodeEnv === 'staging' || nodeEnv === 'production') {
          const {
            getHubStoreMode,
            assertPostgresConfigured,
          } = require(path.join(ROOT, 'api', 'lib', 'hub', 'db', 'config.js'));
          const hubMode = getHubStoreMode();
          if (hubMode === 'postgres') {
            try {
              assertPostgresConfigured();
            } catch (cfgErr) {
              console.error(`\n[server] ${cfgErr.message}`);
              process.exit(1);
            }
          }
          try {
            require(path.join(ROOT, 'api', 'lib', 'staging-test-login')).assertStagingTestLoginStartup();
          } catch (stlErr) {
            console.error(`\n[server] ${stlErr.message}`);
            process.exit(1);
          }
          // WOS-86 — production must not enable staging-only features; require session secret.
          if (nodeEnv === 'production') {
            const secret = process.env.SESSION_SECRET || '';
            if (secret.length < 32) {
              console.error('\n[server] SESSION_SECRET is required in production (≥32 characters)');
              process.exit(1);
            }
            if (['1', 'true', 'yes'].includes(String(process.env.STAGING_TEST_LOGIN_ENABLED || '').toLowerCase())) {
              console.error('\n[server] STAGING_TEST_LOGIN_ENABLED must not be set in production');
              process.exit(1);
            }
            if (['1', 'true', 'yes'].includes(String(process.env.STAGING_DEMO_DATA_ENABLED || '').toLowerCase())) {
              console.error('\n[server] STAGING_DEMO_DATA_ENABLED must not be set in production');
              process.exit(1);
            }
          }
        }

        console.log(`\n  Streamline portal (${nodeEnv})`);
        if (options.logLocalNoauth) {
          console.log(`  ${base}/?_noauth=1`);
        } else {
          console.log(`  ${base}/`);
        }
        console.log(`  Health: http://${displayHost}:${PORT}/health`);
        if (basePath) {
          console.log(`  Public path prefix: ${basePath}`);
        }
        console.log('');
        if (options.ensureArchiveDemoSeed !== false && process.env.NODE_ENV === 'development') {
          try {
            const { shouldUseLocalStore } = require(path.join(ROOT, 'for-dev', 'redis-client'));
            if (shouldUseLocalStore()) {
              const archiveSeed = require(path.join(ROOT, 'for-dev', 'hub-archive-demo-seed'));
              const out = await archiveSeed.seedArchiveDemoData('dev-server@streamlinecorp.com');
              if (out.created_count > 0) {
                console.log(`  Archive demo seed: ${out.created_count} record(s) created`);
              }
            }
          } catch (seedErr) {
            console.warn('  Archive demo seed skipped:', seedErr.message);
          }
        }
        resolve({ server, port: PORT, host: HOST, basePath });
      });
    });
  }

  return { listen, port: PORT, host: HOST, basePath, buildHealthPayload, withBasePath: (r) => withBasePath(basePath, r) };
}

module.exports = { createServer, loadEnvFile, normalizeBasePath, withBasePath, ROOT };
