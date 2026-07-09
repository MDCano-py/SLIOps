# WOS-80 — Security Remediation: Legacy Route RBAC + Authz Gaps

**Card:** WOS-80
**Scope:** Remediate the pre-identified auth/authorization findings from WOS-79
before the formal cyber pentest. No new product features, no UI redesign, no DB
schema changes, no RDS migration, no demo seeding, no auth weakened, legacy
flows preserved.

---

## Executive summary

WOS-79 documented several authorization findings instead of hot-fixing them to
avoid destabilizing the staging migration. WOS-80 remediates them with
contained, defense-in-depth changes and adds four focused security test suites.

Remediated:

- **HIGH — Legacy `maintainx.js` routes lacked RBAC/IDOR.** JSA/BOL/SWP archive,
  `/request-archive/{parts,wo}`, and `/forms/roll-off-swap` now require an
  authenticated actor (401), gate reads behind the existing per-kind view
  permissions (403), tighten record deletion to privileged-or-creator, and take
  the stored submitter from the **session** rather than the spoofable
  `x-actor-email` header.
- **HIGH — No-`Origin` requests treated as trusted server-to-server.** The SSO
  gate now only treats a missing `Origin` as trusted **outside**
  staging/production. In deployed environments a no-`Origin` request must carry
  a valid session (or hit an already-exempt public webhook/cron path that has
  its own shared secret).
- **MED — `GET /hub/templates/submissions/:id` IDOR.** Now returns 401 when
  unauthenticated and authorizes via `canInspectSubmission` (admin / creator /
  relevant workflow role); guessing an ID returns 403.
- **MED — `POST /hub/requests/:id/workflow-steps` missing authz.** Now requires
  an authenticated admin/hub_admin and an existing target request (parity with
  the `/workflow` PUT replace route).
- **MED — CORS localhost + `ALLOW_DEV_LOGIN`.** Localhost/Vercel-preview origins
  are auto-allowed only outside staging/production; `ALLOW_DEV_LOGIN` can no
  longer enable dev-login on staging/production.
- **MED — CSRF posture.** Documented below; added a Referer-origin check for
  state-changing methods as defense-in-depth on top of SameSite=Lax cookies and
  the existing Origin allow-list.
- **MED — RBAC/publish audit gaps + finding R5.** Added structured
  security-audit logging for template publish/archive/delete and role
  create/archive/assign, and made role **writes** require true admin (the
  read-only `view_user_permissions` perm no longer authorizes role writes).

All existing tests pass; four new security suites pass; the server boots cleanly
and authorized legacy flows still return 200.

**Final recommendation: Ready for RDS staging migration and cyber pentest** —
subject to the staging env values listed in §"Required staging config".

---

## Findings remediated

| # | Sev (WOS-79) | Finding | Status |
|---|--------------|---------|--------|
| 1 | HIGH | Legacy routes lack RBAC/IDOR (JSA/BOL/SWP, `/request-archive/*`, `/forms/*`) | Remediated |
| 2 | HIGH | No-`Origin` requests trusted in staging/prod | Remediated |
| 3 | MED | `GET /hub/templates/submissions/:id` missing authz | Remediated |
| 4 | MED | `POST /hub/requests/:id/workflow-steps` missing authz | Remediated |
| 5 | MED | CORS localhost-in-prod + `ALLOW_DEV_LOGIN` | Remediated |
| 6 | MED | CSRF posture for cookie-auth state-changing routes | Documented + hardened |
| 7 | MED | RBAC/publish audit gaps (incl. R5 read-perm write) | Remediated where low-risk |

---

## Legacy route RBAC changes (Part A)

A shared `resolveActor(req)` helper (`api/maintainx.js`) resolves the
authenticated actor + permissions for legacy routes. It honors the local/dev
relaxed bypass (returns full admin so dev/tests keep working) but returns a
**null actor** when there is no session so handlers can reply `401`.

**Archive `/archive/{jsa|bol|swp}`:**
- `401` when unauthenticated.
- Reads (list + single GET) require the per-kind view permission
  (`view_jsa_archive` / `view_bol_archive`; SWP has no dedicated perm so any
  authenticated user may read — see limitations). Admin/hub_admin pass via
  `hasAnyPermission`. These view permissions are already part of the Employee
  preset, so **legitimate staff are unaffected**.
- `DELETE`: privileged deleters (admin, or `delete_jsa_archive`/
  `delete_bol_archive`) may delete any record and override the 24h window;
  everyone else must be the **recorded creator AND within 24h**. Records with no
  recorded creator can now only be deleted by a privileged actor (closes the
  prior gap where a missing `createdBy` let any user delete within 24h).
- Closed-SWP immutability, 24h rule, and creation behavior are unchanged for
  authorized users.

**`/request-archive/{parts|wo}`:**
- `401` when unauthenticated; reads gated by `view_parts_request_archive` /
  `view_work_order_archive`.
- The stored submitter now comes from the **session email** first, falling back
  to `x-actor-email`/payload only if no session (dev). The spoofable client
  header is no longer authoritative.

**`/forms/roll-off-swap`:**
- `401` when unauthenticated; reads gated by `view_roll_off_swap_archive`;
  submitter taken from the session.

Direct API calls (not just hidden UI buttons) are protected: the checks run in
the route handlers regardless of client.

---

## No-Origin auth gate changes (Part B)

`api/maintainx.js` SSO gate:

```
const gateDeployed = gateEnv === 'staging' || gateEnv === 'production';
const isServerToServer = !req.headers.origin && !gateDeployed;
```

- **Staging/production:** a missing `Origin` is no longer auto-trusted. Such a
  request must carry a valid session, otherwise it is rejected by the existing
  gate. Browser writes always send `Origin`, so normal same-origin usage is
  unaffected; authenticated same-origin GETs (which omit `Origin`) still pass
  because they carry the session cookie.
- **Local/development:** the convenient no-`Origin` server-to-server path is
  retained, explicitly gated by environment.
- **Legitimate server-to-server exceptions:** cron (`/photo-cleanup`,
  `/archive-wipe-orphans`), inbound-email webhook (`/hub/inbound-email`), and
  action links (`/hub/action/*`) are already on the public-path allow-list and
  carry their own shared-secret verification, so they continue to work in
  deployed environments without relying on the no-`Origin` bypass.

---

## Submission authorization fix (Part C)

`GET /hub/templates/submissions/:id` (`api/lib/templates/routes.js`):

- `401` when unauthenticated.
- Loads the submission, then authorizes with
  `canInspectSubmission(permissions, isAdmin, bundle.submission, actorEmail, actorWorkflowRoles)`
  — the same helper used by the runtime `/hub/submissions/:id` route.
- Non-owner, non-admin, non-workflow-role actors get `403`; guessing an ID does
  not expose data. Admin/hub_admin and the creator retain access.

---

## Workflow step authorization fix (Part D)

`POST /hub/requests/:id/workflow-steps` (`api/lib/hub/routes.js`):

- `401` when unauthenticated.
- `404` when the target request does not exist.
- Requires admin/hub_admin (`!isAdmin && !hasHubPerm(permissions,'hub_admin') → 403`),
  matching the existing `/workflow` PUT replace route. Arbitrary authenticated
  users can no longer inject workflow steps onto any request by direct API call.

(Managers who legitimately manage workflows can be granted `hub_admin`; the
existing per-step *action* routes continue to authorize by assigned role via
`canActOnStep`.)

---

## CORS / dev-login hardening (Part E)

- **CORS** (`isOriginAllowed`, `api/maintainx.js`): explicit `ALLOWED_ORIGIN`
  entries are always honored. Localhost and `parts-request-portal*.vercel.app`
  preview origins are auto-allowed **only outside** staging/production. In
  deployed environments only configured origins pass. Credentials are echoed to
  the specific allowed origin (no wildcard-with-credentials).
- **Dev-login** (`isDevLoginAllowed`, `api/lib/entra.js`): returns `false` for
  `NODE_ENV=staging|production` regardless of `ALLOW_DEV_LOGIN`. `handleDevLogin`
  therefore returns `404` in deployed environments even if the flag is set
  (verified functionally in the new test).

---

## CSRF posture (Part F)

**Current posture (all cookie-auth state-changing routes):**
- Session cookies are `HttpOnly; Secure; SameSite=Lax` — cross-site POST/PUT/
  DELETE from a third-party page do **not** carry the session cookie, which is
  the primary CSRF mitigation.
- The API rejects any request whose `Origin` is present but not on the
  allow-list (`403 Origin not allowed`). Browser-initiated writes always send
  `Origin`.
- **Added (WOS-80):** for `POST/PUT/PATCH/DELETE`, if a `Referer` is present its
  origin must be allow-listed as well (`403 Cross-site request blocked`).
  Requests with neither header (approved webhooks/cron on public paths, which
  carry their own shared secrets) are intentionally unaffected.

This combination (SameSite=Lax + Origin allow-list + Referer check +
no-`Origin`-requires-session in deployed) is sufficient for the MVP without a
full per-form CSRF-token framework. A synchronizer-token layer is noted as a
future enhancement.

---

## Audit event changes (Part G)

The primary DB audit table `audit_events` is **request-scoped**
(`request_id NOT NULL`), so template/role/security-admin events cannot be
persisted there without a schema change (out of scope). Instead a lightweight,
secret-free structured logger `api/lib/security-audit.js` emits one
`[security-audit] {json}` line per action to the app log (shipped to
PM2/CloudWatch in deployed environments). Wired for:

- `template.publish`, `template.archive`, `template.delete`
  (`api/lib/templates/routes.js`)
- `rbac.role_created`, `rbac.role_archived`, `rbac.user_roles_set`
  (`api/lib/rbac/routes.js`)

The logger redacts any key matching `secret|token|password|authorization|cookie|api_key`
and never serializes nested objects verbatim.

**Finding R5 (also closed here):** role **writes** (create/archive role, assign
user roles) now require true admin via a dedicated `requireAdminWrite` gate; the
read-only `view_user_permissions` permission still allows reads but no longer
authorizes writes.

Remaining audit gap: persistent (DB) audit for non-request-scoped security
events would require a new `security_audit` table — recommended as a follow-up
card since it needs a migration.

---

## Files changed

| File | Change |
|------|--------|
| `api/maintainx.js` | No-`Origin` gate deployed-gating; CORS localhost/preview deployed-gating; CSRF Referer check; `resolveActor` helper; legacy archive/request-archive/forms RBAC + IDOR + session-derived submitter; hardened archive DELETE |
| `api/lib/entra.js` | `ALLOW_DEV_LOGIN` cannot enable dev-login on staging/production |
| `api/lib/hub/routes.js` | `POST /workflow-steps` now 401/404/admin-gated |
| `api/lib/templates/routes.js` | Submission GET authorization (401/403 via `canInspectSubmission`); publish/archive/delete audit events |
| `api/lib/rbac/routes.js` | `requireAdminWrite` write gate (R5); role create/archive/assign audit events |
| `api/lib/security-audit.js` | **New** — structured, secret-free security-audit logger |
| `scripts/security/legacy-route-rbac-test.js` | **New** — legacy RBAC/IDOR test |
| `scripts/security/no-origin-auth-gate-test.js` | **New** — gate + CORS + dev-login test |
| `scripts/security/submission-idor-test.js` | **New** — submission IDOR test |
| `scripts/security/workflow-step-authz-test.js` | **New** — workflow-step authz + role-write test |
| `scripts/security/dep-audit.js` | **New** — cross-platform report-only dependency audit |
| `package.json` | Added 4 security test scripts + swapped `security:audit` to the cross-platform wrapper |

---

## Tests run

New (all PASS):
- `security:legacy-route-rbac-test` — 16 checks
- `security:no-origin-auth-gate-test` — 9 checks (incl. functional dev-login refusal)
- `security:submission-idor-test` — 8 checks
- `security:workflow-step-authz-test` — 12 checks

Required suite (all PASS):
- `db:validate` (staging-safe; no demo data written)
- `security:secret-scan` — 0 high-confidence secrets
- `security:audit` — report-only (see dependency notes)
- `security:staging-hardening-test` — 30
- `security:rbac-authz-test` — 23
- `settings:ui-test` — 14
- `templates:mvp-ia-test` — 29
- `templates:new-request-registry-test` — 59
- `templates:legacy-runtime-parity-test` — 46
- `templates:forms-admin-rbac-readiness-test` — 32
- `templates:archive-route-hydration-test` — 51
- `templates:shell-route-consistency-test` — 24
- `templates:workflow-tab-dark-mode-test` — 20
- `vendor-dashboard:test` — 13, `vendor-master:test` — 20,
  `vendor-workflow:test` — 36, `vendor-documents:test` — 24,
  `vendor-document-notifications:test` — 21, `vendor-rbac-ui:test` — 31,
  `vendor-dashboard-queues:test` — 30

---

## Browser verification

Local boot smoke (`node scripts/dev-server.js`): `/api/me` → 200 and legacy
`/api/maintainx?path=/archive/jsa` → 200 for the authorized (dev-relaxed) actor,
confirming no regression and that authorized legacy flows work. The functional
checklist below should be re-run against staging with real accounts:

1. Valid admin can open Users/Roles — expected PASS.
2. Non-admin cannot open Users/Roles — expected 403 on `/hub/rbac/*` writes.
3. Valid user can submit New Request — expected PASS.
4. Unauthorized user cannot publish/archive/delete forms — expected 403.
5. BOL works for authorized user — expected PASS.
6. JSA works for authorized user — expected PASS (smoke-confirmed locally).
7. Safe Work Permit works for authorized user — expected PASS.
8. Archive works for authorized user — expected PASS.
9. Direct unauthorized API calls return 401/403 — expected PASS.
10. No old shell/routing regression — unchanged in this card.
11. Dark mode still works — unchanged in this card.

---

## Required staging config

Confirm before the pentest (unchanged from WOS-79 + reinforced here):
`NODE_ENV=staging`, `SESSION_SECRET` (≥32 chars), `SSO_ENFORCEMENT=on`,
`DEMO_BYPASS=0`, `ALLOW_DEV_LOGIN` unset/`0` (now ignored regardless),
`ALLOWED_ORIGIN=<staging portal origin>` (must include the portal's own origin
for same-origin writes + Referer check to pass), `HUB_STORE_MODE=postgres`,
`DATABASE_URL` (RDS), `ALLOWED_EMAIL_DOMAINS`, `BOOTSTRAP_ADMIN_EMAILS`.

---

## Known limitations

- **SWP archive** has no dedicated view permission in the catalog, so any
  authenticated user may read SWP records (creation/edit already required a
  session). Adding `view_swp_archive` is a catalog/permission change deferred to
  avoid scope creep; documented for cyber.
- **Security-audit persistence** is log-based, not DB-backed (see Part G). A
  `security_audit` table is a recommended follow-up (needs a migration).
- **Dependency advisories:** `npm audit` reports `undici` (via `@vercel/blob`)
  and `uuid` (via `@azure/msal-node`). Fixes require breaking major upgrades
  (`@vercel/blob@2.6.1`, `@azure/msal-node@5.4.0`) and are **not** auto-applied
  in this card; they should be upgraded and regression-tested in a dedicated
  dependency card before/around launch.
- **CSRF** relies on SameSite=Lax + Origin/Referer validation rather than a
  synchronizer-token framework — sufficient for MVP, enhancement noted.

---

## Remaining pentest notes

- Cyber should confirm the no-`Origin` gate against staging (scripted no-Origin
  request without a session → expect 401/redirect, not data).
- Cyber should attempt IDOR on `/hub/templates/submissions/:id`,
  `/hub/submissions/:id`, `/archive/*/{id}`, `/request-archive/*/{id}`, and
  `/forms/*/{id}` with a low-privilege account.
- Cyber should attempt direct `POST /hub/requests/:id/workflow-steps` and RBAC
  role writes with a non-admin account (expect 403).
- Verify `ALLOW_DEV_LOGIN` truly inert on staging and that
  `/api/auth/dev-login` returns 404.

---

## Recommendation

**Ready for RDS staging migration and cyber pentest**, contingent on the staging
env values in §"Required staging config" being provided. The known limitations
(SWP view permission, DB-backed audit persistence, dependency major upgrades)
are non-blocking and tracked for follow-up.
