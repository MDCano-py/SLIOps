# EC2 Final Validation Checklist (one session)

**Branch to deploy:** `security-production-readiness`  
**Do not invent secrets.** Fill `<PORTAL>`, `<PREV_SHA>` from live output.  
**Staging defaults used below:** app root `/var/www/ops-hub-staging`, port `3010`, public `https://automation.streamlinescada.com/ops-hub-staging`.

---

## 0. Preflight (on EC2)

### COMMAND
```bash
cd /var/www/ops-hub-staging && pwd && node -v && npm -v && whoami
```
### EXPECTED RESULT
Directory exists; Node **20.x**; shell user can read deploy tree.
### IF IT FAILS
Fix path/ownership (`chown`) or install Node 20 before continuing.

---

## 1. Live branch and SHA (before deploy)

### COMMAND
```bash
cd /var/www/ops-hub-staging
git remote -v
git fetch --all --prune
git branch -vv
git rev-parse HEAD
git status -sb
```
### EXPECTED RESULT
Remote reachable; record **current HEAD** as `<PREV_SHA>`; working tree clean or known local-only env files.
### IF IT FAILS
Fix git remote/credentials; do not overwrite unknown local changes without backup.

---

## 2. Deploy code (pull only — human-operated)

### COMMAND
```bash
cd /var/www/ops-hub-staging
git checkout security-production-readiness
git pull --ff-only
git rev-parse HEAD
npm ci --omit=dev
```
### EXPECTED RESULT
HEAD moves to intended SHA; `npm ci` succeeds; no production secrets printed.
### IF IT FAILS
Abort deploy; restore `<PREV_SHA>` (see §18). Do not restart services on a broken tree.

---

## 3. PM2 process / runtime path

### COMMAND
```bash
pm2 describe ops-hub-staging | sed -n '1,40p'
pm2 describe ops-hub-staging-worker | sed -n '1,40p'
pm2 jlist | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{JSON.parse(d).forEach(p=>console.log(p.name,p.pm2_env.status,p.pm2_env.pm_cwd,p.pm2_env.script))})"
```
### EXPECTED RESULT
Both apps `online`; `pm_cwd` is `/var/www/ops-hub-staging`; scripts `scripts/production-server.js` and `scripts/hub-worker.js`.
### IF IT FAILS
`pm2 start deploy/ecosystem.config.cjs` from app root, or fix `cwd`/script paths; re-check.

---

## 4. Active Nginx configuration

### COMMAND
```bash
sudo cp /var/www/ops-hub-staging/deploy/nginx/ops-hub-staging.conf /etc/nginx/snippets/ops-hub-staging.conf
sudo nginx -t
sudo grep -n "ops-hub-staging\|deny\|X-Forwarded-For\|return 404" /etc/nginx/snippets/ops-hub-staging.conf
sudo grep -R "include.*ops-hub-staging" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null
sudo systemctl reload nginx
```
### EXPECTED RESULT
`nginx -t` ok; snippet includes sensitive-path `return 404` and `X-Forwarded-For $remote_addr`; site includes the snippet; reload succeeds.
### IF IT FAILS
Do not reload on failed `-t`. Fix include path; keep previous snippet until fixed.

---

## 5. Trusted proxy behavior

### COMMAND
```bash
# From EC2: confirm Nginx overwrites client XFF (app should see proxy peer, not attacker spoof)
curl -sI -H 'X-Forwarded-For: 203.0.113.9' https://automation.streamlinescada.com/ops-hub-staging/ | head -n 5
grep -E '^TRUST_FORWARDED_CLIENT_IP=' /var/www/ops-hub-staging/.env.staging || true
```
### EXPECTED RESULT
Site responds; `TRUST_FORWARDED_CLIENT_IP` is `0` unless you have verified overwrite — then may set `1` and restart later.
### IF IT FAILS
Leave flag `0`. Do not invent CIDR allowlists.

---

## 6. Production/staging cookie & environment configuration

### COMMAND
```bash
cd /var/www/ops-hub-staging
# Prints keys/booleans only — never paste secret values into tickets
node -e "
require('fs').readFileSync('.env.staging','utf8').split(/\r?\n/).forEach(l=>{
  if(!l||l.trim().startsWith('#')) return;
  const i=l.indexOf('='); if(i<0) return;
  const k=l.slice(0,i).trim(); const v=l.slice(i+1).trim();
  const redact=/SECRET|PASSWORD|TOKEN|KEY|DATABASE_URL|CERT/i.test(k);
  console.log(k+'='+(redact?(v?'[set len='+v.length+']':'[empty]'):v));
});
"
```
### EXPECTED RESULT
`NODE_ENV=staging` (or `production` on prod host); `HUB_STORE_MODE=postgres`; `SSO_ENFORCEMENT=on`; `DEMO_BYPASS=0`; `ALLOW_DEV_LOGIN` unset/0; `SESSION_SECRET` set len≥32; `CLEANUP_SECRET` set len≥16; `APP_BASE_PATH`/`PORTAL_BASE_URL` match public URL; no `HUB_USE_LOCAL_STORE=1`.
### IF IT FAILS
Edit `.env.staging` (or prod env file); do not restart until values are correct.

---

## 7. Database / service connectivity

### COMMAND
```bash
cd /var/www/ops-hub-staging
npm run db:migrate
curl -s http://127.0.0.1:3010/health | jq '{ok, hub_store_mode, store_ok, object_storage_configured, maintainx_configured, sso_enforcement, demo_bypass, staging_test_login_enabled}'
```
### EXPECTED RESULT
Migrations apply cleanly; health `ok=true`, `hub_store_mode=postgres`, `demo_bypass` falsey, `sso_enforcement` not off.
### IF IT FAILS
Check `DATABASE_URL`/RDS SG; do not proceed to public smoke if health not ok.

---

## 8–10. Restart services (after env + code + nginx)

### COMMAND
```bash
cd /var/www/ops-hub-staging
pm2 restart ops-hub-staging ops-hub-staging-worker
pm2 save
pm2 status
curl -s http://127.0.0.1:3010/health | jq '{ok, hub_store_mode}'
```
### EXPECTED RESULT
Both processes online; health ok after restart.
### IF IT FAILS
`pm2 logs ops-hub-staging --lines 100`; fix env/startup errors; rollback (§18) if auth kill-switch or crash loop.

---

## 11. Remote sensitive path probe

### COMMAND
```bash
# From laptop OR EC2 with Node/npm available against this tree:
cd /var/www/ops-hub-staging
PROBE_BASE_URL=https://automation.streamlinescada.com/ops-hub-staging npm run security:sensitive-path-probe
```
### EXPECTED RESULT
All blocked paths **not** HTTP 200 / no content leak; `/`, `/hub.js`, `/hub.css`, `/config.js` 200.
### IF IT FAILS
**Stop.** Re-check Nginx deny + Node denylist deploy; treat as Critical exposure until green.

---

## 12. Login / logout smoke

### COMMAND
```bash
# Browser (required for Entra):
# 1) Open https://automation.streamlinescada.com/ops-hub-staging/
# 2) Sign in (Entra or staging-test-login if intentionally enabled)
# 3) Hard refresh; open a deep link e.g. #/dashboard
# 4) Sign out via account menu
# 5) Confirm signed-out interstitial; no login loop
# 6) Sign in again via interstitial

# Cookie spot-check in DevTools Application → Cookies for host:
# sliops_session: HttpOnly, Secure, SameSite=Lax, Path=/ops-hub-staging (or /)
```
### EXPECTED RESULT
Login works; refresh keeps session; logout clears session cookie and shows signed-out; reauth works without loop.
### IF IT FAILS
Capture `/api/auth/logout` Set-Cookie + Location; check `SESSION_SECRET`/`APP_BASE_PATH`; do not clear RDS.

---

## 13. Standard / Admin authorization smoke

### COMMAND
```bash
# Browser as Standard (employee / field_technician persona):
# - Management → Organization SSO hidden or non-writable
# - Direct API (while logged in as Standard), from browser console or curl with session cookie:
curl -sk -b 'sliops_session=<STANDARD_COOKIE>' \
  -X PUT -H 'Content-Type: application/json' \
  -d '{"name":"x","sso_enabled":false}' \
  'https://automation.streamlinescada.com/ops-hub-staging/api/maintainx?path=/sso-admin/organizations/test' \
  | jq '{status:(input|type), .}' 2>/dev/null || true
# Expect HTTP 403

# Browser as Hub Admin (has admin/hub_admin/manage_sso):
# - Organization SSO visible
# - GET /api/maintainx?path=/sso-admin/organizations → 200
# - Confirm role management / users still load
```
### EXPECTED RESULT
Standard: SSO trust **PUT → 403**; Admin: SSO read/write allowed; no privilege escalation via spoof headers.
### IF IT FAILS
Check live role store includes `manage_sso` for management/hub_admin (built-in merge runs on role seed/read); do not leave Standard able to PUT SAML.

---

## 14. Request / document / S3 smoke

### COMMAND
```bash
curl -s http://127.0.0.1:3010/health | jq '{object_storage_configured, object_storage_driver}'
# Browser as authorized user:
# - Create or open a hub request
# - If S3 configured: upload a vendor/doc or photo; download via app proxy (key=), confirm 200
# - If S3 not configured: clear STORAGE_NOT_CONFIGURED error; other hub flows still work
```
### EXPECTED RESULT
Health matches reality; authorized upload/download works when S3 set; unauthorized download denied.
### IF IT FAILS
Check IAM role / `S3_BUCKET`; do not put long-lived keys in tickets.

---

## 15. MaintainX smoke

### COMMAND
```bash
curl -s http://127.0.0.1:3010/health | jq '{maintainx_configured}'
# Browser: Operations path that calls locations/assets — expect data OR clear "Not configured"
# Must NOT force WOS logout on MaintainX upstream 401
```
### EXPECTED RESULT
Configured → data; unset → not_configured UI; session remains valid.
### IF IT FAILS
Check `MAINTAINX_API_KEY` server-side only; never expose key in browser network tab.

---

## 16. Control Room smoke

### COMMAND
```bash
# Current branch: Control Room not implemented — confirm absence only
curl -sk -o /dev/null -w '%{http_code}\n' \
  'https://automation.streamlinescada.com/ops-hub-staging/api/maintainx?path=/hub/control-room/current-shift'
# Browser: #/control-room should not present a working CR MVP
```
### EXPECTED RESULT
API not a working CR surface (404/401/403/not handled — **not** a full shift UI). Skip functional CR smoke until Gate 4 ships.
### IF IT FAILS
If a CR API unexpectedly exists and errors 500, capture logs; do not invent schema on EC2.

---

## 17. Logs / error check

### COMMAND
```bash
pm2 logs ops-hub-staging --lines 80 --nostream
pm2 logs ops-hub-staging-worker --lines 40 --nostream
sudo tail -n 50 /var/log/nginx/error.log
# Confirm no secret dumps:
pm2 logs ops-hub-staging --lines 200 --nostream | grep -Ei 'SESSION_SECRET=|MAINTAINX_API_KEY=|BEGIN CERT|password=' || echo 'OK: no obvious secret lines'
```
### EXPECTED RESULT
No crash loops; no plaintext secrets; optional `[security-audit]` lines for SSO/cleanup without cert bodies.
### IF IT FAILS
Investigate 5xx; rotate if secrets leaked in logs.

---

## 18. Rollback

### COMMAND
```bash
cd /var/www/ops-hub-staging
git checkout -f <PREV_SHA>
npm ci --omit=dev
# Restore previous nginx snippet from backup if needed, then:
sudo nginx -t && sudo systemctl reload nginx
pm2 restart ops-hub-staging ops-hub-staging-worker
curl -s http://127.0.0.1:3010/health | jq '{ok, hub_store_mode}'
```
### EXPECTED RESULT
Prior SHA running; health ok; login works on previous build.
### IF IT FAILS
Restore `.env.staging` from secure backup; escalate — do not delete RDS.

---

## Session exit criteria (all must be true)

- [ ] Remote sensitive path probe PASS  
- [ ] Health postgres + safety flags correct  
- [ ] Login/logout/reauth OK  
- [ ] Standard cannot mutate SSO trust  
- [ ] Admin can use SSO admin as intended  
- [ ] Request + S3/MaintainX smoke match configuration  
- [ ] Control Room absence acknowledged (or CR smoke if later shipped)  
- [ ] Logs clean of secrets / crash loops  
