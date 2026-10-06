# SLIOps Auth & RBAC Model — Current Truth (Phase 0)

**Date:** 2026-10-05  
**Sources:** `api/maintainx.js` (`PERMISSION_CATALOG`, `BUILT_IN_ROLES`), `api/lib/auth.js`, `api/lib/authbridge.js`, `api/lib/sso-routes.js`, `migrations/011_hub_rbac_roles.sql`, `api/lib/rbac/*`, `docs/cyber/ROLE_TEST_MATRIX.md`, staging seed personas.

Do not invent roles. Proposals are marked **PROPOSAL**.

---

## Identity resolution order (`getActorEmail`)

1. If `sliops_signed_out` marker → anonymous  
2. Session JWT cookies `sliops_session` / `sliops_remember`  
3. AuthBridge trusted headers (when AuthBridge enabled + configured)  
4. **Legacy:** `x-vercel-user-email` / `x-vercel-id-token-email` — **unsafe if edge does not strip**

Server must enforce all privileged actions. UI (`rbac-client.js`) is visibility only.

---

## Portal permission catalog (capability IDs)

Source of truth for IDs: `PERMISSION_CATALOG` in `api/maintainx.js`.

| Permission | Group | Typical UI | Typical API | Resource scope | Verified |
| --- | --- | --- | --- | --- | --- |
| `view_hub_dashboard` | Operations Hub | Dashboard | Hub dashboard reads | Shared operational | code |
| `view_hub_requests` | Operations Hub | Request hub | Request list/detail | Shared + step rules | code |
| `view_hub_reports` | Operations Hub | Reports | Hub reports | Shared | code |
| `hub_admin` | Operations Hub | Admin hub ops | Visibility, retries, admin hub | Broad hub | code |
| `view_home` … archive `view_*` | Tab Access | Tabs | Tab-gated routes | Tab | code |
| `view_management` | Tab Access | Management section | **Also gates SSO admin today** | Over-broad | code — **defect** |
| `view_vendor_*` / `edit_vendor_*` / `manage_vendor_documents` | Vendor | Vendor UI | Vendor APIs | Vendor records | code |
| `view_user_permissions` | Management | Users tab | User permission views | Users | code |
| `delete_*_archive` | Archive | Archive delete | Archive DELETE | Archive records | code |
| `admin` | Admin | User/role admin | `/users`, `/roles` mutations | Users/roles | code |
| `configuration.*` / `workflow.*` / `form.manage` / `document.manage` / `dashboard.manage` / `variable.manage` | Configuration | Config center | `/hub/configuration*` | Config defs | code |
| `manage_sso` | — | — | — | — | **PROPOSAL** (not in catalog) |
| `control_room_*` | — | — | — | — | **PROPOSAL** (not in catalog) |

---

## Built-in portal roles (Redis/KV seed — `BUILT_IN_ROLES`)

| Role | Permission highlights | UI capability | API capability | Resource scope | Source | Verified |
| --- | --- | --- | --- | --- | --- | --- |
| `employee` | Core view tabs; no management | Submit/view own areas | Non-admin APIs | Operational shared + own submissions | `BUILT_IN_ROLES` | code |
| `requester` | employee + `view_management` + `submit_new_vendor` | Management tab limited | Vendor submit | Shared | code | code |
| `accounts_payable` | Vendor view/edit/docs | Vendor full edit | Vendor mutations | Vendors | code | code |
| `management` | Nearly all including `hub_admin` + `admin` | Admin | User admin + hub admin | Broad | code | code |

Custom roles may exist in live Redis — `UNKNOWN_REQUIRES_HUMAN_CONFIRMATION`.

---

## Workflow assignee roles (Postgres `roles` / `user_roles`)

Migration `011` seeds: `admin`, `requester`, `manager`, `operations`, `ap`, `legal`.  
Code/seeds also reference: `hub_admin`, `hr`, `field_supervisor`, `field_technician`, `client`, `vendor`, `employee`.

These are **workflow step assignee** keys, distinct from portal permission bundles (though staging test login maps both).

| Role key | Permission (portal preset via staging seed) | UI | API | Scope | Source | Verified |
| --- | --- | --- | --- | --- | --- | --- |
| `hub_admin` | Full admin preset | All admin | Admin APIs | Broad | `staging-test-users.js` | code |
| `operations` | Ops + vendor | Ops/vendor | Ops APIs | Shared ops | seed | code |
| `hr` | Core + forms + management view | Forms/management | Limited | Shared | seed | code |
| `ap` | AP / vendor | Vendor | Vendor | Vendors | seed | code |
| `field_supervisor` | Core + management + submit vendor | Field + mgmt | Limited | Shared | seed | code |
| `field_technician` | Core limited | Field | Limited | Shared | seed | code |
| `client` | Limited forms | Client | Limited | Restricted | seed | code |
| `vendor` | Vendor list/docs view | Vendor areas | Vendor read | Vendor | seed | code |

**Standard user for Cyber UserA/UserB:** closest current equivalent is `employee` / `field_technician` — confirm with business before remapping.

---

## Sensitive route authorization inventory (priority)

| Route | Method | Authentication | Capability | Resource auth | Audit | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `/auth/login` `/callback` `/logout` `/resume` | GET/POST | Public / OIDC | — | — | partial | Session lifecycle |
| `/auth/dev-login` | * | Blocked staging/prod | — | — | — | Must stay 404 deployed |
| `/auth/staging-test-login` | * | Staging secret | — | persona allowlist | yes | Never production |
| `/me` | GET | Session preferred | — | self | — | |
| `/sso/:org/login\|acs\|metadata` | * | Public SAML | — | org | — | Protocol hardening Gate 2 |
| `/sso-admin/organizations` | GET | Session | hub_admin\|admin\|**view_management** | all orgs | weak | Read too broad? |
| `/sso-admin/organizations/:slug` | PUT | Session | same OR | org SAML trust | weak | **Critical: view_management can mutate trust** |
| `/users*` `/roles*` | * | Session | `admin` | users/roles | yes | |
| `/hub/requests*` | * | Session | hub view/admin | request/step rules | yes | Preserve step checks |
| `/hub/templates*` `/hub/configuration*` | * | Session | configuration.* / form.manage | templates | yes | |
| `/hub/dev/seed-demo-data` clear | POST | Session | admin + flags | destructive | yes | Prod blocked |
| MaintainX proxy paths | GET/POST | Session | SSO gate | allowlist paths | — | Secrets server-only |
| `/photo-cleanup` `/archive-wipe-orphans` | POST | SSO-public | optional `CLEANUP_SECRET` | destructive | weak | Require secret always |
| `/vendor-docs*` | * | Session | vendor doc perms | object key | — | S3 |
| `/hub/control-room/*` | — | — | — | — | — | **Does not exist** |

---

## Authorization layer separation (required reading)

| Layer | Question | Current state |
| --- | --- | --- |
| Capability | Can this identity perform this action type? | `requirePermissions` + catalog |
| Resource | May they access this object? | Implemented for some hub/vendor/submission paths; not universal `created_by` filter |
| Application entitlement | May AuthBridge issue app token? | Present when AuthBridge mode; verify fail-closed |
| Administrative trust | Who may change IdP certs/endpoints? | **Broken open** via `view_management` |
| UI visibility | What should they see? | `rbac-client.js` — not security |

---

## Proposed changes (not applied — need Gate 0/business sign-off)

1. Add capability **`manage_sso`**; require it for SSO PUT/test; keep read behind tighter admin perms.  
2. Remove or hard-disable `x-vercel-*` identity fallback outside verified gateway.  
3. Add `control_room_*` capabilities only after Control Room schema + role mapping review.  
4. Confirm whether portal roles live in Redis vs migrate fully to Postgres.
