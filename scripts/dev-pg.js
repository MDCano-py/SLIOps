/**
 * Local dev server with Postgres hub store.
 * Loads .env.local.postgres then .env.local
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

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

loadEnvFile(path.join(ROOT, '.env.local.postgres'));
loadEnvFile(path.join(ROOT, '.env.local'));
loadEnvFile(path.join(ROOT, '.env'));

process.env.HUB_STORE_MODE = process.env.HUB_STORE_MODE || 'postgres';
process.env.HUB_USE_LOCAL_STORE = '0';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required. Copy .env.local.postgres.example to .env.local.postgres');
  process.exit(1);
}

console.log('[dev:pg] HUB_STORE_MODE=postgres');
console.log('[dev:pg] Run migrations first: npm run db:migrate');

require('./dev-server.js');
