/**
 * Staging / production Node server for EC2 (GitHub deploy target).
 * Usage: NODE_ENV=staging node scripts/production-server.js
 * Env: .env.staging then .env (see .env.staging.example)
 */

const path = require('path');
const { createServer } = require('./server-core');

const ROOT = path.join(__dirname, '..');

if (!process.env.NODE_ENV || process.env.NODE_ENV === 'development') {
  process.env.NODE_ENV = 'staging';
}

const { listen } = createServer({
  envFiles: [path.join(ROOT, '.env.staging'), path.join(ROOT, '.env')],
  defaultNodeEnv: 'staging',
  defaultPort: 3010,
  defaultHost: '0.0.0.0',
  logLocalNoauth: false,
});

listen().catch((err) => {
  console.error('[production-server] failed to start:', err);
  process.exit(1);
});
