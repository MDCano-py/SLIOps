# Source inventory — October 2026 remediation

**Recorded:** 2026-10-26  
**Workspace:** multi-root Cursor workspace. This is not a Git monorepo. Each repository keeps its own commits.  
**Deployment claims below are from the October 22–23 Strix reports unless a local file proves them. Live host SHA was not queried.**

## Repositories

| Repository | Path | Git root | Branch | HEAD | Remote (token-free) | Role |
| --- | --- | --- | --- | --- | --- | --- |
| SLIOps | `C:\Users\MDCan\Desktop\sliops_master` | that directory | `security/2026-10-remediation` | `9b459e5b1cd480fcce99a4163b0968e9f31fac0b` | `git@github-streamline:Michael-Cano_strmln/SLIOps.git` | Operations SPA, hub API, archive/forms, employee session |
| SLI AuthBridge + SLI Auth | `C:\Users\MDCan\Desktop\SSO` | `C:\Users\MDCan\Desktop\SSO` | `security/2026-10-remediation` | `e05b2fcc4f3a061ce99d1856ef636054bd817a09` | `https://github.com/MDCano-py/slisso.git` | AuthBridge is the gateway. `sli-auth` is the downstream adapter package in the same repo |

Parent commits before this work: SLIOps `c8607fc131bd11516afd02372bf5a131e760fb91` (already required Node.js `>=24.22.1 <25`). SSO `0bd4d2f02e7d47619b5c0e2b15e11b1f11ad12a5`.

Uncommitted SSO files that were present before this work (`SecurityUpdate.md`, `forSumo.md`, `sabo-26.md`, `sli-auth` detector/cli/template edits, and untracked notes) were left unstaged. `SLI-AuthBridge-Production-20260827.zip` was not extracted and was not committed. It is not treated as the live source of truth.

## What is authoritative

The deployed authentication gateway described by the reports is **SLI AuthBridge**, the FastAPI app in `sli-authbridge/`. The reports name `https://automation.streamlinescada.com/authbridge` (FastAPI, “SLI AuthBridge” v1.0.0, nginx/1.24.0). Local module owner:

| Area | Owner | Local path |
| --- | --- | --- |
| OIDC login, callback, logout | AuthBridge | `sli-authbridge/gateway/routers/oidc.py` |
| SAML ACS / RelayState | AuthBridge | `sli-authbridge/gateway/routers/saml.py` |
| `/session/verify`, `/session/me` | AuthBridge | `sli-authbridge/gateway/routers/session.py` |
| Redirect allowlist | AuthBridge | `sli-authbridge/gateway/dependencies.py` `is_safe_redirect` |
| JWT issue / verify, jti | AuthBridge | `sli-authbridge/gateway/auth/jwt_handler.py` |
| Revocation store | AuthBridge Redis | `sli-authbridge/gateway/auth/session_store.py` |
| Admin key | AuthBridge | `sli-authbridge/gateway/routers/admin.py` |
| Ignition config | AuthBridge | `sli-authbridge/gateway/routers/ignition.py` |
| Public docs | AuthBridge app factory | `sli-authbridge/gateway/main.py` |
| Example nginx | AuthBridge | `sli-authbridge/adapters/nginx/authbridge.conf`, `sli-authbridge/docker/nginx-dev.conf` |

`sli-auth/` is the Python adapter (`require_auth`, nginx init templates). It does not serve `/authbridge/*`. It is a library for apps, not the gateway process. No second gateway implementation was found in that package.

SLIOps trusts AuthBridge when `AUTH_PROVIDER=authbridge` (`api/lib/authbridge.js`, `docs/security/2026-authbridge-canonical-path.md`). Employee cookies are HMAC sessions in `api/lib/auth.js` (`sliops_session` / `sliops_remember`). Vendor sessions are separate.

## SLIOps modules touched by the findings

| Area | Path | Notes |
| --- | --- | --- |
| SPA and archive viewer | `index.html` | JSA/BOL/SWP snapshots. No separate frontend build (`README.md`) |
| Hub routes | `api/lib/hub/routes.js` | `/hub/requests`, workflow steps, notifications, dashboard |
| Workflow engine | `api/lib/hub/workflow.js` | Completion stamps actor and server time |
| Authorization helpers | `api/lib/hub/authorization.js` | New. Create allowlist, step actor, queue DTO |
| Postgres store | `api/lib/hub/db/postgres.js` | Staging system of record when `HUB_STORE_MODE=postgres` |
| Archive + MaintainX proxy | `api/maintainx.js` | `/archive/{jsa,bol,swp}`, `/forms/roll-off-swap`, PUT passthrough |
| Redis pipeline used in postgres-only mode | `for-dev/redis-client.js` `createMemoryRedisStub` | This is the client whose pipeline lacked `zrem` |
| Edge headers | `scripts/server-core.js`, `deploy/nginx/ops-hub-staging.conf` | |
| Logout | `api/maintainx.js` `/auth/logout`, `api/lib/logout.js` | |

## Runtime evidence

| Item | Evidence | Trust |
| --- | --- | --- |
| Report target | `https://operations.streamlinescada.com`, build 1.2.0, `node_env=staging` (`_1` p.2, `_2` p.2) | Report only. Git SHA of that process is **UNKNOWN** |
| Gateway | FastAPI AuthBridge v1.0.0 behind nginx/1.24.0 (`_4` p.3) | Report only. Not matched to `e05b2fc` |
| Local Node that executed tests | `v24.18.0` | This workstation. Below the October 21 patched 24.22.1 line |
| SLIOps engine metadata | `package.json` `engines.node` `>=24.22.1 <25` since `c8607fc` | Manifest, not a running host |
| AuthBridge Python in the local venv | 3.12. Installed: python-jose 3.5.0, python-multipart 0.0.32, cryptography 43.0.3, ecdsa 0.19.2 | Venv, not a container image |
| PHP | No PHP runtime, Dockerfile, or vhost upstream in the inspected trees | **No PHP evidence in inspected code/config; host validation pending** |

## Build and test commands

SLIOps has no frontend compile step.

```text
npm run security:october-2026-remediation-test
npm run security:workflow-step-authz-test
npm run security:wos-logout-session-clear-test
npm run security:staging-hardening-test
```

AuthBridge, from `sli-authbridge` using its virtualenv:

```text
.\.venv\Scripts\python.exe -m pytest tests/test_october_2026_remediation.py tests/test_validation.py tests/test_sumo.py tests/test_revocation.py -q
```

Both trees install and test independently. Opening them in one Cursor workspace does not merge their Git history.
