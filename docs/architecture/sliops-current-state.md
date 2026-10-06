# SLIOps / WOS — Current State (Phase 0)

**Generated:** 2026-10-05  
**Authority:** Current repository only (`sliops_master`)  
**Scaffold:** `SLIOps_Production_Readiness_and_Control_Room_Cursor_Scaffold.md`

Nothing below is labeled production-deployed unless marked `VERIFIED_CURRENT` with human confirmation. Historical Cyber handoff notes recovered from git are `HISTORICAL_REFERENCE`.

---

## 5.1 Repository truth

| Item | Value | Status |
| --- | --- | --- |
| Working tree path | `C:\Users\MDCan\Desktop\sliops_master` | `VERIFIED_CURRENT` |
| Current branch | `master` (only local branch) | `VERIFIED_CURRENT` |
| HEAD SHA | `59da042aecf451c8982392fc31fc5026b84fca1d` | `VERIFIED_CURRENT` |
| Working tree | Clean except scaffold untracked; docs restored from history during Phase 0 | `VERIFIED_CURRENT` |
| Remotes | None configured in this clone | `VERIFIED_CURRENT` |
| Related GitHub (historical handoff) | `https://github.com/MDCano-py/SLIOps.git` branch `main` | `HISTORICAL_REFERENCE` / `UNKNOWN_REQUIRES_HUMAN_CONFIRMATION` whether this clone tracks it |
| Production branch | Unknown — do not assume `master`, `main`, or `production-ec2` | `UNKNOWN_REQUIRES_HUMAN_CONFIRMATION` |
| Historical Control Room branch | `control-room-workspace` / SHA `1e86af775ca4aa941ece8b4cd54e255fd9d0081a` | **Not present in this repo** — `UNKNOWN_REQUIRES_HUMAN_CONFIRMATION` (need external ref) |
| Package manager | npm (`package.json` + `package-lock.json`) | `VERIFIED_CURRENT` |
| Runtime | Node 20.x, CommonJS | `VERIFIED_CURRENT` |
| Migrations | `migrations/001` … `014` via `npm run db:migrate` | `VERIFIED_CURRENT` |
| Build | No separate frontend build; static root SPA + Node server | `VERIFIED_CURRENT` |
| Start | `npm run dev` → `scripts/dev-server.js`; `npm start` / `start:staging` → `scripts/production-server.js` | `VERIFIED_CURRENT` |
| Deploy files | `deploy/ecosystem.config.cjs`, `deploy/ops-hub-staging.service`, `deploy/nginx/ops-hub-staging.conf` | `VERIFIED_CURRENT` (templates) |
| Missing deploy script | `npm run ec2-live-cutover:validate` references missing `scripts/ec2-live-cutover-validate.sh` | `VERIFIED_CURRENT` gap |
| Recent commits | `ab69d60` init clean codebase → `8e798d2` remove legacy docs → `59da042` remove historical report fixtures | `VERIFIED_CURRENT` |

### Test commands (selected)

| Command | Purpose |
| --- | --- |
| `npm run security:staging-hardening-test` | Staging/prod kill-switches |
| `npm run security:rbac-authz-test` | RBAC |
| `npm run security:workflow-step-authz-test` | Workflow step authz |
| `npm run security:submission-idor-test` | Submission IDOR |
| `npm run security:sensitive-path-probe` | Gate 1 sensitive file probe (**added**) |
| `npm run security:wos-logout-*` / `wos-sso-*` | Logout / SSO suites |
| Many `templates:*`, `vendor*:*` | Product regression scripts |

No Jest/Vitest `npm test` runner — tests are Node scripts.

---

## 5.2 Runtime topology

| Component | Finding | Status |
| --- | --- | --- |
| Staging public URL | `https://automation.streamlinescada.com/ops-hub-staging/` | `HISTORICAL_REFERENCE` (Cyber handoff) |
| App listen | `127.0.0.1:3010` with `APP_BASE_PATH=/ops-hub-staging` | `HISTORICAL_REFERENCE` / template |
| Nginx | `deploy/nginx/ops-hub-staging.conf` proxies prefix; health `=/ops-hub-staging-health` localhost-only | `VERIFIED_CURRENT` (repo template) |
| TLS termination | Assumed at Nginx / host for `automation.streamlinescada.com` | `UNKNOWN_REQUIRES_HUMAN_CONFIRMATION` |
| PM2 | `ops-hub-staging`, `ops-hub-staging-worker` | `VERIFIED_CURRENT` (template) |
| systemd | `EnvironmentFile=…/.env.staging` | `VERIFIED_CURRENT` (template) |
| Postgres | `DATABASE_URL`, `HUB_STORE_MODE=postgres` required staging/prod | `VERIFIED_CURRENT` (code) |
| Redis / Upstash | Optional legacy KV; postgres-only mode preferred | `VERIFIED_CURRENT` (code) |
| S3 | `STORAGE_DRIVER=s3` + bucket/IAM | Often deferred historically | `UNKNOWN_REQUIRES_HUMAN_CONFIRMATION` live config |
| Entra | `AUTH_PROVIDER=entra` + `ENTRA_*` | `VERIFIED_CURRENT` (code) |
| AuthBridge | `AUTH_PROVIDER=authbridge` modes oidc/header/jwt | `VERIFIED_CURRENT` (code) |
| MaintainX | Server-side `MAINTAINX_API_KEY` / org id | `VERIFIED_CURRENT` (code) |
| Cookie domain | Examples use `.streamlinescada.com` / path from `APP_BASE_PATH` | `UNKNOWN_REQUIRES_HUMAN_CONFIRMATION` production scope |
| Trusted proxy | Nginx now overwrites `X-Forwarded-For` with `$remote_addr` in template; app still reads headers for metadata | Partial — live edge chain `UNKNOWN_REQUIRES_HUMAN_CONFIRMATION` |
| n8n | Referenced in integrations / WOS-95 audit; public exposure via shared domain | `UNKNOWN_REQUIRES_HUMAN_CONFIRMATION` |
| Production EC2 SHA | Unknown | `UNKNOWN_REQUIRES_HUMAN_CONFIRMATION` |
| Docker | Not in repo | N/A |

---

## 5.3 Existing product inventory

Hash SPA (`index.html` + `hub.js` + related UI modules). Router: `window.streamlineRouter` / `#/…`.

| Area | Route (hash) | Frontend | API dependency | Auth | Notes |
| --- | --- | --- | --- | --- | --- |
| Dashboard | `#/dashboard` | `index.html` / hub | `/hub/dashboard*` | Session + perms | Present |
| Request Queue / Hub | hub request views | hub | `/hub/requests*` | Session + hub perms | Present |
| New Request / Start | `#/start-center`, `#/launch/:id` | start-center / templates | launch + templates | Session | Present |
| My Tasks | `#/hub-my-tasks` | hub | `/hub/my-tasks*` | Session | Present |
| Operations / Documents | Documents, Parts, WO, Generators, JSA, SWP | hub + archives | hub + archive APIs | Session + tab perms | Present |
| Forms / Workspace | `#/forms`, templates | template UI | `/hub/templates*` | Session + form perms | Present |
| Archives | `#/archives` | unified archive | `/archive/*` | Session | Present |
| Insights | `#/reports`, `#/analytics` | hub | reports surfaces | Session | Partial / placeholder historically |
| Admin / Users | `#/management/users`, roles | rbac-client | `/users*`, `/roles*`, `/hub/rbac*` | `admin` / hub_admin | Present |
| SSO Admin | `#/management/sso` | management UI | `/sso-admin/*` | `hub_admin`\|`admin`\|**`view_management`** | **Write allowed with view_management — launch blocker candidate** |
| Settings / Config | `#/settings`, `#/configuration` | config center | `/hub/configuration*` | configuration.* | Present |
| Vendor management | management + vendor UI | vendor modules | `/vendors*`, `/vendor-docs*` | vendor perms | Present; S3 often required for binaries |
| Control Room | — | **Absent** | **No `/hub/control-room/*`** | — | `MISSING_REQUIRED` for Gate 4 |
| Logs | app + `[security-audit]` | — | security-audit helper | — | No dedicated operator Logs product page verified |

---

## 5.4 Request and workflow model

- Hub requests stored in Postgres (`migrations/001_init.sql` + extras): requests, workflow steps, web documents, audit, comments, notifications.
- Workflow step action types in `003`; outbox integrations in `004`/`005`.
- Authorization: actor from session; step assignee / role checks in hub routes + `security:workflow-step-authz-test`.
- Fill / Review / Sign: template + workflow runtime paths; client action links via hub action tokens.
- **Do not weaken** existing step/owner checks while redesigning RBAC.

---

## 5.5 Document model

| Concern | Current |
| --- | --- |
| Drivers | `api/lib/storage` — `s3` or `local` (local blocked staging/prod) |
| Vendor / photo binaries | S3 keys via `keys.js`; download proxied authenticated |
| Hub web documents | Postgres metadata + workflow docs |
| Client links | Action-link tokens; expiry behavior in hub routes |
| Authz | Permission + ownership/resource checks; IDOR tests exist for submissions |

---

## 5.6 MaintainX

- Proxy allowlist in `api/maintainx.js`: locations, assets, teams, categories, workrequests, workorders.
- Credentials injected server-side only; upstream 401 remapped so browser does not treat as WOS logout.
- Hub integrations: create/retry/status under `/hub/integrations/maintainx/*`.
- Health exposes `maintainx_configured` boolean only.

---

## 5.7 Production safety inventory

| Control | Behavior | Status |
| --- | --- | --- |
| `DEMO_BYPASS` | Not honored staging/prod; refused at production startup | `VERIFIED_CURRENT` (code) |
| `ALLOW_DEV_LOGIN` | False on staging/prod | `VERIFIED_CURRENT` |
| `SSO_ENFORCEMENT=off` | Refused in production startup | `VERIFIED_CURRENT` |
| `HUB_USE_LOCAL_STORE` / `local_json` | Refused in production | `VERIFIED_CURRENT` |
| Staging test login | Staging-only shared secret personas | `VERIFIED_CURRENT` |
| Dev seed/clear demo | Blocked in production; staging flag + admin | `VERIFIED_CURRENT` |
| `x-vercel-user-email` fallback | Still trusted in `getActorEmail` | **Risk — Gate 2** |
| `CLEANUP_SECRET` optional | `/photo-cleanup`, `/archive-wipe-orphans` SSO-public if unset | **Risk — Gate 1/2** |
| Static root serve | Previously served any file under repo root | **Mitigated in code this Phase** — deploy verification pending |

---

## 5.8 Static serving and exposure boundary

| Layer | Behavior |
| --- | --- |
| Node `serveStatic` | Serves from repository `ROOT`; **now denylists** `.env*`, `.git`, lockfiles, `api/`, `migrations/`, `scripts/`, `deploy/`, `for-dev/`, `docs/`, `node_modules/`, common secret/backup extensions → **404** |
| Nginx template | Matching deny locations → **404**; `X-Forwarded-For` overwritten with `$remote_addr` |
| Deploy layout | systemd/PM2 expect `.env.staging` beside app — **must not be web-reachable**; human must confirm live Nginx includes updated template |
| Probe | `npm run security:sensitive-path-probe` (local); set `PROBE_BASE_URL` for staging |

Live exposure of secrets on EC2: `UNKNOWN_REQUIRES_HUMAN_CONFIRMATION`.

---

## 5.9–5.11 Authorization layers (summary)

See `docs/security/2026-auth-rbac-model.md`.

Layers present in code:

1. **Application entitlement** — AuthBridge entitlement checks when AuthBridge selected (verify completeness in Gate 2).
2. **Capability authorization** — `PERMISSION_CATALOG` + `requirePermissions`.
3. **Resource authorization** — request/step/submission/vendor object checks (uneven; must inventory per route).
4. **SSO trust administration** — currently capability OR of `hub_admin`\|`admin`\|`view_management` (too broad for writes).
5. **UI visibility** — `rbac-client.js` only.

---

## 5.12 Pentest user model

| Intended | Notes |
| --- | --- |
| UserA / UserB | Equivalent Standard — map to `employee` / field_technician style, not invented differences |
| Hub Admin | `hub_admin` / management role — not Entra Global Admin |
| Staging personas | See restored `docs/cyber/ROLE_TEST_MATRIX.md` |

---

## 5.13 Control Room current state

| Item | Classification |
| --- | --- |
| Operations → Control Room nav | `MISSING_REQUIRED` |
| Current Shift / Quick Log / Ack / Handover / Board / Tasks / Schedule / History / Supervisor | `MISSING_REQUIRED` |
| `/hub/control-room/*` APIs | `MISSING_REQUIRED` |
| Control Room Postgres tables | `MISSING_REQUIRED` (none in migrations 001–014) |
| Historical branch content | `UNKNOWN_REQUIRES_HUMAN_CONFIRMATION` — SHA/branch not in this git object store |
| Test string `#/control-room` in signed-out boot test | `HISTORICAL_REFERENCE` only |

**Delta vs historical:** Cannot diff `1e86af7…` here. Treat entire Control Room MVP as `MISSING_REQUIRED` pending external historical source.

---

## 5.14 Frontend defect inventory (initial)

| ID | Severity | Finding |
| --- | --- | --- |
| FE-001 | `P1_FIX_BEFORE_LAUNCH` | Control Room deep link / nav absent while scaffold and one test URL reference `#/control-room` |
| FE-002 | `P1_FIX_BEFORE_LAUNCH` | SSO Admin visible/writable under `view_management` — UI may over-expose trust mutation |
| FE-003 | `P2_HARDEN_THIS_WEEK` | Insights/Analytics historically placeholder — confirm empty/error states |
| FE-004 | `P2_HARDEN_THIS_WEEK` | MaintainX / S3 “not configured” UX must remain graceful (regression) |
| FE-005 | `P0_PRODUCTION_BLOCKER` | If live static exposure still serves `.env` on deployed host — validate with probe after Nginx update |
| FE-006 | `P3_DEFER` | Full a11y pass beyond baseline labels/focus |

Systematic UI walkthrough against live staging remains `UNKNOWN_REQUIRES_HUMAN_CONFIRMATION`.

---

## Gate 0 stop condition

Material unknowns remaining (scaffold §6):

1. **Live deployment branch / SHA** — unknown  
2. **Role source of truth in production** — Redis portal roles vs Postgres `user_roles` both exist; live SoR unknown  
3. **Permission source of truth** — catalog in code; assignments in Redis/KV historically  
4. **Production cookie Domain / Path** — unknown  
5. **Trusted proxy chain** — staging template updated; production edge unknown  
6. **SSO configuration store** — org/SAML store backend in live env unknown  
7. **Control Room schema** — none current; historical unavailable  
8. **Whether exposed credentials still active** — unknown (rotation checklist created)  
9. **Whether deployed system still exposes artifacts** — needs remote probe after deploy  

**Phase 0 documentation complete. Architectural Control Room expansion and Gate 2 redesign must wait on human confirmation of the above, except Gate 1 code containment already started in-repo.**
