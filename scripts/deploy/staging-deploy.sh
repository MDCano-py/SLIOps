#!/usr/bin/env bash
# Staging deploy. Refuses to run unless STAGING_DEPLOY_AUTHORIZED=yes.
# Does not touch production. Does not reload Nginx unless NGINX_RELOAD_AUTHORIZED=yes.
set -euo pipefail

if [ "${STAGING_DEPLOY_AUTHORIZED:-}" != "yes" ]; then
  echo "Refusing deploy. Re-run with STAGING_DEPLOY_AUTHORIZED=yes after explicit approval."
  exit 2
fi

APP_ROOT="${APP_ROOT:-/var/www/ops-hub-staging}"
TARGET_SHA="${TARGET_SHA:-}"
if [ -z "$TARGET_SHA" ]; then
  echo "TARGET_SHA is required (the release commit to check out)."
  exit 2
fi
case "$APP_ROOT" in
  *production*|*ops-hub-prod*)
    echo "Refusing path that looks like production: $APP_ROOT"
    exit 2
    ;;
esac
if [ ! -d "$APP_ROOT/.git" ]; then
  echo "APP_ROOT is not a git checkout: $APP_ROOT"
  exit 2
fi

cd "$APP_ROOT"
PREVIOUS_SHA="$(git rev-parse HEAD)"
echo "previous_sha=$PREVIOUS_SHA"
echo "target_sha=$TARGET_SHA"
mkdir -p /var/log/ops-hub-staging
echo "$PREVIOUS_SHA" > "/var/log/ops-hub-staging/rollback-sha-$(date -u +%Y%m%dT%H%M%SZ).txt"

git fetch origin
git checkout "$TARGET_SHA"
npm ci --omit=dev
npm run db:migrate

pm2 restart ops-hub-staging ops-hub-staging-worker
pm2 status

if [ "${NGINX_RELOAD_AUTHORIZED:-}" = "yes" ]; then
  sudo nginx -t
  sudo systemctl reload nginx
else
  echo "Nginx was not reloaded. Set NGINX_RELOAD_AUTHORIZED=yes only after diffing the live config."
fi

echo "deployed_sha=$(git rev-parse HEAD)"
echo "Rollback: cd $APP_ROOT && git checkout $PREVIOUS_SHA && npm ci --omit=dev && pm2 restart ops-hub-staging ops-hub-staging-worker"
echo "Do not drop vendor_login_codes unless this build is no longer running."
