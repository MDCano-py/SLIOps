# EC2 Final Validation Checklist (one session)

**Branch to deploy:** `control-room-phase2-secure-base`  
**Release SHA:** see `docs/control-room/control-room-release-summary.md`  
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
git checkout control-room-phase2-secure-base
git pull --ff-only
git rev-parse HEAD
# Confirm SHA matches docs/control-room/control-room-release-summary.md
npm ci --omit=dev
```
### EXPECTED RESULT
HEAD moves to intended release SHA; `npm ci` succeeds; no production secrets printed.
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
# Confirm 015 applied (Control Room schema — no fake station seed)
psql "$DATABASE_URL" -c "SELECT id, applied_at FROM schema_migrations WHERE id LIKE '%015%' OR id LIKE '%control_room%';"
psql "$DATABASE_URL" -c "\dt cr_*"
psql "$DATABASE_URL" -c "SELECT COUNT(*) AS stations FROM cr_stations;"
curl -s http://127.0.0.1:3010/health | jq '{ok, hub_store_mode, store_ok, object_storage_configured, maintainx_configured, sso_enforcement, demo_bypass, staging_test_login_enabled}'
```
### EXPECTED RESULT
`015_control_room.sql` listed in `schema_migrations`; `cr_*` tables exist; **station count may be 0** until bootstrap (§16a); health `ok=true`, `hub_store_mode=postgres`, `demo_bypass` falsey, `sso_enforcement` not off. Existing WOS tables unchanged.
### IF IT FAILS
Check `DATABASE_URL`/RDS SG; do not proceed to public smoke if health not ok. Do not invent station seed data.

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

## 16. Control Room permission verification

### COMMAND
```bash
# After deploy + role merge, as Hub Admin in Role Management UI (or Redis/Postgres role store):
# - employee includes operator pack (view/log/ack/handover/task/board/schedule_view)
# - management includes supervisor pack (+ schedule_manage + supervisor)
# - Hub Admin users have hub_admin and/or admin (elevated short-circuit)

# Standard employee session — schedule manage must 403:
curl -sk -b 'sliops_session=<EMPLOYEE_COOKIE>' -X POST \
  -H 'Content-Type: application/json' \
  -d '{"operator_email":"x@example.com","work_date":"2026-10-05","starts_at":"2026-10-05T08:00:00Z","ends_at":"2026-10-05T16:00:00Z"}' \
  'https://automation.streamlinescada.com/ops-hub-staging/api/maintainx?path=/hub/control-room/schedule' \
  -w '\nHTTP %{http_code}\n' -o /tmp/cr-sched.json
# Expect HTTP 403

# Unauthorized (no CR) → 403 on GET current
curl -sk -b 'sliops_session=<NO_CR_COOKIE>' \
  'https://automation.streamlinescada.com/ops-hub-staging/api/maintainx?path=/hub/control-room/current' \
  -w '\nHTTP %{http_code}\n'
```
### EXPECTED RESULT
Employee can open `#/control-room` after station bootstrap; cannot schedule-manage; users without CR get 403. Mapping: `docs/control-room/control-room-permissions.md`.
### IF IT FAILS
Trigger built-in role merge (open Role Management / call roles list) or manually add missing `control_room_*` to employee/management. Do not invent new roles.

---

## 16a. Production station/unit bootstrap

### COMMAND
```bash
# Use REAL production keys/names only — see docs/control-room/control-room-production-bootstrap.md
psql "$DATABASE_URL" <<'SQL'
INSERT INTO cr_stations (key, name, active)
VALUES ('<STATION_KEY>', '<STATION_NAME>', true)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, active = true, updated_at = now();

INSERT INTO cr_units (station_id, key, name, active)
SELECT s.id, '<UNIT_KEY>', '<UNIT_NAME>', true
FROM cr_stations s WHERE s.key = '<STATION_KEY>'
ON CONFLICT (station_id, key) DO UPDATE SET name = EXCLUDED.name, active = true, updated_at = now();

SELECT s.key, u.key, u.name FROM cr_stations s
LEFT JOIN cr_units u ON u.station_id = s.id WHERE s.active;
SQL
```
### EXPECTED RESULT
At least one active station (and units as needed). No `Main Station` / `Unit 1` placeholders unless those are real names.
### IF IT FAILS
Fix SQL keys; keep `active=true`. App stays in `needs_bootstrap` until this succeeds.

---

## 16b. Postgres Control Room smoke test

### COMMAND
```bash
# Browser as employee/ops after bootstrap:
# 1) Open #/control-room — no bootstrap banner
# 2) Create Normal log; edit summary; confirm timeline
# 3) Create Attention/Urgent; acknowledge (append-only)
# 4) Create board item; leave open
# 5) Create task with past due → overdue; complete with note
# 6) Submit handover; incoming ack as second user
# 7) Confirm board still open across shifts
# 8) Supervisor (management/hub_admin): #/control-room → Supervisor tab loads

curl -sk -b 'sliops_session=<EMPLOYEE_COOKIE>' \
  'https://automation.streamlinescada.com/ops-hub-staging/api/maintainx?path=/hub/control-room/current' \
  | jq '{needs_bootstrap, station:(.station.key), shift:(.shift.id), unacked:.unacknowledged_count}'
```
### EXPECTED RESULT
`needs_bootstrap` false; station present; log/ack/board/task/handover work; MaintainX optional fields may be empty without breaking core flows.
### IF IT FAILS
Check `HUB_STORE_MODE=postgres`, migration 015, station rows, and role grants. Capture API status/body — do not invent schema on EC2.

---

## 16c. Remote security probe (post-CR deploy)

### COMMAND
```bash
cd /var/www/ops-hub-staging
PROBE_BASE_URL=https://automation.streamlinescada.com/ops-hub-staging npm run security:sensitive-path-probe
```
### EXPECTED RESULT
Same Gate 1 expectations as §11 — blocked paths not content-leaking; app assets 200. Control Room must not expose migrations/env.
### IF IT FAILS
**Stop.** Treat as Critical exposure until green.

---

## 16d. Final WOS regression smoke (on EC2 tree)

### COMMAND
```bash
cd /var/www/ops-hub-staging
npm run security:rbac-authz-test
npm run security:legacy-route-rbac-test
npm run security:wos-signed-out-boot-test
npm run security:control-room-test
# Optional if Docker available on host:
# npm run security:control-room-migration-015-test
```
### EXPECTED RESULT
All listed suites PASS. Existing WOS auth/logout/signed-out behavior unchanged.
### IF IT FAILS
Do not continue acceptance; consider rollback (§18). CR memory suite does not require RDS; migration-015 test needs Docker.

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

- [ ] Remote sensitive path probe PASS (§11 + §16c)  
- [ ] Health postgres + safety flags correct  
- [ ] Migration `015_control_room.sql` applied; `cr_*` present; no fake station seed  
- [ ] Login/logout/reauth OK  
- [ ] Standard cannot mutate SSO trust  
- [ ] Admin can use SSO admin as intended  
- [ ] Control Room role grants verified (employee operator / management supervisor / Hub Admin all)  
- [ ] Production stations/units bootstrapped with real names  
- [ ] Postgres Control Room smoke PASS (§16b)  
- [ ] Final WOS + Control Room regression smoke PASS (§16d)  
- [ ] Request + S3/MaintainX smoke match configuration  
- [ ] Logs clean of secrets / crash loops  

