#!/usr/bin/env bash
# WOS-53 — Live EC2/RDS staging cutover validation (run ON the EC2 host).
# Outputs redacted evidence for WOS_53_EC2_RDS_LIVE_STAGING_CUTOVER_REPORT.md
#
# Usage:
#   cd /var/www/ops-hub-staging
#   bash scripts/ec2-live-cutover-validate.sh | tee /tmp/wos53-cutover-evidence.txt
#
# Does NOT print passwords, API keys, tokens, or full DATABASE_URL.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC}  $1"; }
fail() { echo -e "${RED}FAIL${NC}  $1"; FAILED=1; }

FAILED=0
ENV_FILE="${ENV_FILE:-.env.staging}"

echo "=== WOS-53 EC2/RDS Live Staging Cutover Validation ==="
echo "Host: $(hostname -f 2>/dev/null || hostname)"
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "CWD: $ROOT"
echo ""

# --- .env.staging presence ---
echo "--- .env.staging verification (redacted) ---"
if [[ -f "$ENV_FILE" ]]; then
  pass ".env.staging exists"
else
  fail ".env.staging missing at $ROOT/$ENV_FILE"
  echo "Cannot continue without .env.staging"
  exit 1
fi

REQUIRED_KEYS=(
  NODE_ENV
  HUB_STORE_MODE
  VENDOR_STORE_MODE
  HUB_USE_LOCAL_STORE
  DATABASE_URL
  PGSSLMODE
  INTEGRATION_DISPATCH_MODE
  EMAIL_DELIVERY_MODE
  EMAIL_NOTIFICATIONS_ENABLED
  PORTAL_BASE_URL
  SESSION_SECRET
  SSO_ENFORCEMENT
  HUB_WORKER_MODE
  HUB_WORKER_POLL_INTERVAL_MS
  HUB_WORKER_BATCH_SIZE
)

OPTIONAL_NOTIFY=(
  VENDOR_NOTIFY_EMAIL_ADMIN
  VENDOR_NOTIFY_EMAIL_REBEKAH
  VENDOR_NOTIFY_EMAIL_AP
  VENDOR_NOTIFY_EMAIL_LEGAL
  VENDOR_NOTIFY_EMAIL_DYLAN
)

for key in "${REQUIRED_KEYS[@]}"; do
  val="$(grep -E "^${key}=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
  if [[ -z "$val" ]]; then
    fail "env key missing or empty: $key"
  else
  case "$key" in
    DATABASE_URL)
      host="$(node -e "try{const u=new URL(process.argv[1]);console.log(u.hostname+'/'+u.pathname.replace(/^\//,''))}catch(e){console.log('invalid')}" "$val")"
      echo "  $key=postgresql://***@${host}"
      ;;
    SESSION_SECRET|RESEND_API_KEY|BLOB_READ_WRITE_TOKEN|ENTRA_CLIENT_SECRET)
      echo "  $key=(set, redacted)"
      ;;
    *)
      echo "  $key=$val"
      ;;
  esac
  fi
done

notify_ok=0
for key in "${OPTIONAL_NOTIFY[@]}"; do
  val="$(grep -E "^${key}=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
  [[ -n "$val" ]] && notify_ok=1 && echo "  $key=(set, redacted)"
done
[[ "$notify_ok" -eq 1 ]] && pass "vendor notify email configured" || fail "no VENDOR_NOTIFY_EMAIL_* configured"

grep -qE '^HUB_STORE_MODE=postgres' "$ENV_FILE" && pass 'HUB_STORE_MODE=postgres' || fail 'HUB_STORE_MODE must be postgres'
grep -qE '^PGSSLMODE=require' "$ENV_FILE" && pass 'PGSSLMODE=require' || fail 'PGSSLMODE must be require for RDS'
grep -qE '^HUB_USE_LOCAL_STORE=0' "$ENV_FILE" && pass 'HUB_USE_LOCAL_STORE=0' || fail 'HUB_USE_LOCAL_STORE must be 0'

echo ""

# --- RDS connectivity (no password in output) ---
echo "--- RDS connectivity ---"
node -e "
const { loadDbEnv, getPgClientConfig, databaseHost, isLocalDatabaseUrl } = require('./scripts/db/env');
loadDbEnv();
const host = databaseHost();
const local = isLocalDatabaseUrl();
console.log('  endpoint:', host || 'unknown');
console.log('  is_local:', local);
if (local) { console.error('WARN: DATABASE_URL points to localhost — expected RDS endpoint'); process.exit(2); }
const { Client } = require('pg');
const c = new Client(getPgClientConfig());
c.connect()
  .then(() => c.query('SELECT current_database() AS db, current_user AS usr'))
  .then(r => { console.log('  database:', r.rows[0].db); console.log('  user:', r.rows[0].usr); })
  .then(() => c.end())
  .catch(e => { console.error('  connection error:', e.message); process.exit(1); });
" && pass "RDS TCP+SSL connect" || fail "RDS connect"

echo ""

# --- Migrations ---
echo "--- Migrations ---"
npm run db:migrate && pass "db:migrate" || fail "db:migrate"
npm run db:validate && pass "db:validate" || fail "db:validate"
npm run rds-staging-smoke:test && pass "rds-staging-smoke:test" || fail "rds-staging-smoke:test"

echo ""

# --- PM2 ---
echo "--- PM2 ---"
if command -v pm2 >/dev/null 2>&1; then
  pm2 start deploy/ecosystem.config.cjs 2>/dev/null || true
  pm2 save 2>/dev/null || true
  pm2 status || true
  pm2 jlist 2>/dev/null | node -e "
    const apps = JSON.parse(require('fs').readFileSync(0,'utf8'));
    const names = ['ops-hub-staging','ops-hub-staging-worker'];
    for (const n of names) {
      const a = apps.find(x => x.name === n);
      if (!a) { console.log('MISSING', n); process.exit(1); }
      console.log(n + ':', a.pm2_env.status, 'pid', a.pid);
    }
  " && pass "PM2 both processes present" || fail "PM2 ops-hub-staging or worker missing/offline"
else
  fail "pm2 not installed"
fi

echo ""

# --- Health ---
echo "--- Health (localhost:3010) ---"
HEALTH_JSON="$(curl -sf http://127.0.0.1:3010/health || echo '{}')"
echo "$HEALTH_JSON" | node -e "
const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
const ok = d.ok === true;
const pg = String(d.store_mode || d.hub_store_mode || '').includes('postgres');
console.log('  ok:', d.ok);
console.log('  store_mode:', d.store_mode || d.hub_store_mode);
console.log('  store_ok:', d.store_ok);
console.log('  local_store_enabled:', d.local_store_enabled);
if (!ok) process.exit(1);
if (!pg) process.exit(2);
" && pass "/health ok + postgres" || fail "/health"

echo ""

# --- Worker / delivery ---
echo "--- Worker / outbox ---"
npm run hub-worker:once && pass "hub-worker:once" || fail "hub-worker:once"
npm run delivery-status:test && pass "delivery-status:test" || fail "delivery-status:test"

echo ""
echo "=== Summary ==="
if [[ "$FAILED" -eq 0 ]]; then
  echo "RESULT: PASS — paste this output into WOS_53 report EC2 evidence section"
  exit 0
else
  echo "RESULT: FAIL — fix blockers before WOS-29 Complete"
  exit 1
fi
