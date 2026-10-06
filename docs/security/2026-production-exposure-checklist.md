# 2026 Production Exposure & Credential Rotation Checklist

**Date:** 2026-10-05  
**Rule:** Do not write real secret values into this document.  
**Rule:** Treat secrets as compromised until an authorized owner dispositions them if assessment evidence shows exposure.

---

## A. Sensitive web exposure (Gate 1)

| Check | Owner | Status | Notes |
| --- | --- | --- | --- |
| Node static denylist deployed | Eng | CODE_DONE / DEPLOY_PENDING | `scripts/server-core.js` |
| Nginx deny locations applied on staging | Infra | PENDING_HUMAN | Update include from `deploy/nginx/ops-hub-staging.conf` |
| Nginx deny locations applied on production | Infra | PENDING_HUMAN | Production conf not in repo |
| Local probe green | Eng | PASS | `npm run security:sensitive-path-probe` |
| Staging remote probe green | Eng/Cyber | PENDING_HUMAN | `PROBE_BASE_URL=https://automation.streamlinescada.com/ops-hub-staging npm run security:sensitive-path-probe` |
| Production remote probe green | Eng/Cyber | PENDING_HUMAN | Use production portal base |
| Deploy artifact excludes `.git`, `.env*`, backups | Infra | PENDING_HUMAN | Prefer runtime-only package |
| Confirm whether historical exposure occurred | Security | PENDING_HUMAN | Drives rotation mandatory vs precautionary |

---

## B. Secret categories (no values)

| Secret type | System | Current owner | Confirmed exposed? | Rotation required? | Revoke old? | Invalidate sessions/tokens? | Downstream consumers | Rotation order | Verify after |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Database credentials | RDS / Postgres | Infra/DBA | UNKNOWN | If `.env` ever public or shared in ticket | YES if rotated | App reconnect only | App, workers, migrate scripts | 1 after backup | `psql` / health store_ok |
| Session signing secret | `SESSION_SECRET` | Eng | UNKNOWN | If exposed | YES | **YES — all sessions** | All browsers | 2 immediately after web exposure closed | Logout all; login works |
| Entra client secret | Azure app reg | IdP admin | UNKNOWN | If exposed | YES | OIDC refresh as applicable | Login | After Entra update | Entra login E2E |
| AuthBridge secrets / JWKS trust | AuthBridge | Eng/IdP | UNKNOWN | If exposed | YES | YES tokens | AuthBridge clients | With AuthBridge runbook | Negative token tests |
| MaintainX API key | MaintainX | Ops/Eng | UNKNOWN | If exposed | YES | N/A (rotate key) | MaintainX proxy | After portal secure | MaintainX lookup |
| AWS / IAM / S3 | AWS | Infra | UNKNOWN | If exposed | YES | N/A | S3 SDK | AWS console | Upload/download |
| SMTP / Resend / SES | Email | Eng | UNKNOWN | If exposed | YES | N/A | Workers | After web secure | Test send or log-only |
| Staging test login secret | Staging only | Eng | UNKNOWN | If staging `.env` exposed | YES | Staging sessions | Cyber personas | Staging only | Staging login |
| `CLEANUP_SECRET` | App | Eng | UNKNOWN | Set strong secret always on deployed envs | YES if old weak/empty | N/A | Cleanup routes | With deploy | Unauthorized cleanup → 401/403 |
| Redis / Upstash tokens | Upstash | Eng | UNKNOWN | If used + exposed | YES | N/A | Legacy KV | If still in path | Health |

---

## C. Session / token invalidation procedure (manual production)

If `SESSION_SECRET` (or equivalent) was exposed:

1. Close web exposure paths (Nginx + app deploy).  
2. Rotate `SESSION_SECRET` to a new ≥32 char value.  
3. Restart PM2 app + worker so all nodes share the new secret.  
4. Confirm existing cookies fail verification (users must re-login).  
5. If AuthBridge/Entra secrets rotated, follow IdP session revocation as required.  
6. Record time, operator, and ticket ID here (no secret values).

| Environment | Exposure closed | Secret rotated | Sessions invalidated | Operator | Ticket | Date |
| --- | --- | --- | --- | --- | --- | --- |
| Staging | ☐ | ☐ | ☐ | | | |
| Production | ☐ | ☐ | ☐ | | | |

---

## D. Gate 1 exit criteria

| Criterion | Met? |
| --- | --- |
| Staging exposure probes fail closed | ☐ remote |
| Deploy artifact no longer web-exposes sensitive files | ☐ |
| Secret rotation plan approved by authorized human | ☐ |
| Required staging rotations complete | ☐ |
| Required staging session invalidation complete | ☐ |
| Current code + Nginx templates enforce exposure boundaries | ☑ code/template |
| No Critical artifact exposure path remaining on live | ☐ |

**Gate 1 status: NOT PASSED** — in-repo mitigations present; human deploy/rotation/validation outstanding.
