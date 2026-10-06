# 2026 SLIOps Production Readiness Report

**Date:** 2026-10-05  
**Branch:** `master`  
**Base / HEAD (start of Phase 0):** `59da042aecf451c8982392fc31fc5026b84fca1d`  
**Final commit:** *not committed yet — working tree changes pending human commit*  
**Verdict:** **NOT PRODUCTION READY** — Gate 0 unknowns remain; Gate 1 code mitigations present but deploy/rotation unverified; Gates 2–5 incomplete; Control Room absent.

No unsupported claim is labeled verified.

---

## Executive status by gate

| Gate | Intent | Status |
| --- | --- | --- |
| 0 Phase 0 truth | Current state docs | **COMPLETE** (with documented unknowns) |
| 1 Containment | Sensitive exposure + rotation plan | **PARTIAL** — code/template/probe local PASS; remote + rotation PENDING |
| 2 AuthN/AuthZ/SAML/deps | Harden trust | **NOT STARTED** (blocked design decisions + report extract) |
| 3 WOS regression | Prove product still works | **NOT STARTED** on secured tree end-state |
| 4 Control Room MVP | Operator continuity | **BLOCKED** — missing feature + historical source unavailable |
| 5 Pentest readiness | Suites + retest pack | **PARTIAL** docs; suites incomplete |

---

## Changed files this execution (uncommitted)

| Path | Change |
| --- | --- |
| `scripts/server-core.js` | Static path denylist; port `0` support |
| `deploy/nginx/ops-hub-staging.conf` | Sensitive path 404s; overwrite `X-Forwarded-For` |
| `scripts/security/sensitive-path-probe.js` | Gate 1 probe |
| `package.json` | `security:sensitive-path-probe` script |
| `docs/architecture/sliops-current-state.md` | Phase 0 |
| `docs/security/2026-*.md` | Matrix, RBAC, exposure, retest, this report |
| `docs/control-room/*` | CR plan / perms / tests |
| `docs/cyber/*`, `docs/architecture/*`, `docs/reports/*` | Restored from git history (`8e798d2^`) |

---

## Repository / topology evidence

See `docs/architecture/sliops-current-state.md`.

- Remotes: none in this clone  
- Production branch/SHA: **unknown**  
- Staging URL (historical): `https://automation.streamlinescada.com/ops-hub-staging/`  
- Control Room historical SHA: **not in object store**

---

## Critical / High disposition summary

| ID | Disposition | Launch blocker |
| --- | --- | --- |
| SCR-W06 | `NEEDS_MANUAL_VALIDATION` (local mitigate) | YES |
| SCR-A01 | `NEEDS_MANUAL_VALIDATION` — need report text | YES |
| SCR-A02 | same | YES |
| SCR-A03 | same | YES |
| SCR-D01 | `NEEDS_MANUAL_VALIDATION` — dep audit pending | YES |
| SCR-S20 | `NEEDS_MANUAL_VALIDATION` | YES |
| SCR-W01 | `NEEDS_MANUAL_VALIDATION` | YES |
| SCR-W05 | `NEEDS_MANUAL_VALIDATION` | YES |
| All STR-* | **Missing reports** | YES until extracted |
| Moderate/Low/Info BW | Not extracted (46+4 register incomplete) | Per item |

---

## Authorization / trust findings (current code)

| Topic | Evidence | Status |
| --- | --- | --- |
| SSO trust write | `view_management` OR in `/sso-admin/` | Open High |
| Identity fallback | `x-vercel-user-email` in `getActorEmail` | Open |
| Cleanup routes | Optional `CLEANUP_SECRET` | Open |
| Static exposure | Denylist + probe local 23/23 PASS | Deploy pending |
| Proxy headers | Nginx template overwrites XFF | Infra apply pending |
| Cookie Domain | Path from `APP_BASE_PATH`; production Domain unknown | Unknown |

---

## Credential rotation

See `docs/security/2026-production-exposure-checklist.md`.  
**Verified rotations:** none (Cursor must not rotate).  
**Required if exposure ever succeeded:** DB, session secret (+ invalidate sessions), Entra, AuthBridge, MaintainX, AWS/S3, email, staging test secret.

---

## Migrations

No new Control Room migration applied (correct — schema discovery incomplete).  
Existing: `001`–`014` only.

---

## Dependency changes

None in this execution. Gate 2 must run `npm run security:audit` and SAML regression after upgrades.

---

## Frontend bugs

Initial inventory in current-state §5.14. No UI feature fixes in this pass (containment + docs first).

---

## WOS regression results

Not re-run end-to-end in this pass. Existing script suite remains available under `npm run security:*` / `templates:*`.

**Sensitive path probe (local):** 23 passed, 0 failed.

---

## Control Room

| Completed | Deferred |
| --- | --- |
| Phase docs + permissions questions + test plan | Entire operator MVP, schema, APIs, UI |

---

## Infrastructure changes

| Change | Documented | Verified live |
| --- | --- | --- |
| Nginx deny + XFF overwrite | YES (staging template) | NO |
| Node denylist deploy | YES | NO |
| Production Nginx | Not in repo | NO |

---

## Deployment instructions (human only)

Cursor does not deploy.

1. Commit/review branch.  
2. Staging: pull, `npm ci --omit=dev`, ensure `.env.staging` not web-reachable.  
3. Install updated Nginx include; `nginx -t`; reload.  
4. `pm2 restart ops-hub-staging ops-hub-staging-worker`.  
5. `PROBE_BASE_URL=https://automation.streamlinescada.com/ops-hub-staging npm run security:sensitive-path-probe`.  
6. Execute rotation checklist if exposure confirmed/suspected.  
7. Smoke: login, logout, hub request, permissions deny, MaintainX/S3 status.

Rollback: revert app commit + previous Nginx include; restore DB backup if migrations applied (none CR yet); restart PM2.

---

## Cyber retest

`docs/security/2026-pentest-retest-guide.md`  
Do not claim SCR-W06 fixed until remote probe passes post-deploy.

---

## Residual risk / manual actions still required

1. Provide full BW + internal STR report packages for matrix completion.  
2. Confirm live deploy branch/SHA and cookie/proxy topology.  
3. Apply Nginx + app to staging/production; run remote probe.  
4. Disposition and rotate secrets; invalidate sessions if needed.  
5. Fix SSO `manage_sso`, remove unsafe identity fallbacks, require cleanup auth.  
6. Supply historical Control Room source or approve greenfield schema.  
7. Answer Control Room resource-scope questions.  
8. Complete Gates 2–5 before any production-ready declaration.

---

## Scaffold STOP condition (§25)

The following STOP items remain true:

1–2 unresolved Critical/High paths (exposure deploy + authz defects)  
3 exposed credential activity unknown  
4 sensitive files live reachability unknown  
5–11 multiple authz/trust gaps open  
12–15 WOS/Control Room not fully revalidated on final secured tree  
16–20 Control Room schema / rollback / production config / deployed SHA / retest evidence incomplete  

**Do not recommend production deployment.**
