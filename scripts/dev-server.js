/**
 * Local dev server (no Vercel login). Serves static files + api/maintainx handler.
 * Usage: npm run dev
 */
const path = require('path');
const { createServer } = require('./server-core');

const ROOT = path.join(__dirname, '..');

const { listen } = createServer({
  envFiles: [path.join(ROOT, '.env.local'), path.join(ROOT, '.env')],
  defaultNodeEnv: 'development',
  defaultPort: 3000,
  defaultHost: process.env.DEV_HOST || '127.0.0.1',
  logLocalNoauth: true,
});

listen().catch((err) => {
  if (err && err.code !== 'EADDRINUSE') {
    console.error(err);
  }
  process.exit(1);
});
