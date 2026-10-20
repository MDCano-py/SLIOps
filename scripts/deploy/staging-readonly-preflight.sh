#!/usr/bin/env bash
# Read-only staging inspection. Does not migrate, reload, or restart.
# Run on the EC2 host: bash scripts/deploy/staging-readonly-preflight.sh
set -u
APP_ROOT="${APP_ROOT:-/var/www/ops-hub-staging}"
echo "preflight_mode=readonly"
echo "hostname=$(hostname)"
echo "date=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [ -d "$APP_ROOT/.git" ]; then
  git -C "$APP_ROOT" rev-parse HEAD
  git -C "$APP_ROOT" status -sb
  git -C "$APP_ROOT" log -1 --oneline
else
  echo "APP_ROOT_MISSING $APP_ROOT"
fi
if command -v pm2 >/dev/null 2>&1; then
  pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const apps=JSON.parse(s);for (const a of apps){const e=a.pm2_env||{};console.log([a.name,e.status,e.pm_cwd,e.version,a.pid].join('\t'));}})"
else
  echo "PM2_NOT_INSTALLED"
fi
if command -v nginx >/dev/null 2>&1; then
  sudo nginx -T 2>/dev/null | awk '
    /ops-hub-staging|vendor\/auth|auth_request|proxy_pass|X-Forwarded-For|return 404/ { print }
  '
else
  echo "NGINX_NOT_INSTALLED"
fi
if [ -f "$APP_ROOT/.env.staging" ]; then
  awk -F= '
    $1=="NODE_ENV" || $1=="EMAIL_NOTIFICATIONS_ENABLED" || $1=="APP_BASE_PATH" || $1=="SSO_ENFORCEMENT" || $1=="HUB_STORE_MODE" || $1=="VENDOR_STORE_MODE" || $1=="TRUST_FORWARDED_CLIENT_IP" {
      print $1"="$2
    }
    $1=="RESEND_API_KEY" { print "RESEND_API_KEY_SET="($2!=""?"yes":"no") }
    $1=="DATABASE_URL" { print "DATABASE_URL_SET="($2!=""?"yes":"no") }
  ' "$APP_ROOT/.env.staging"
else
  echo "ENV_STAGING_MISSING"
fi
echo "preflight_done"
