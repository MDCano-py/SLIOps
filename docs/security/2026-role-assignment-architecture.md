# SLIOps Role Assignment Architecture

**Date:** 2026-10-07  
**Branch context:** `feature/sliops-ui-refinement` (design7)  
**Status:** Current code truth — no Entra group→role mapping exists.

---

## Identity source

1. `sliops_signed_out` cookie → anonymous  
2. Session JWT (`sliops_session` / `sliops_remember`)  
3. AuthBridge verified headers / Bearer JWT when `AUTH_PROVIDER=authbridge`  
4. Entra OIDC callback when Entra is the provider  

Microsoft Entra / AuthBridge authenticate the person. They do **not** assign SLIOps application roles via directory groups.

---

## Canonical user identifier

**Email (lowercased)** is the primary key for Redis user records, Postgres `user_roles.user_email`, session claims, and bootstrap admin lists.

`external_id` / Entra `oid` are optional metadata on the user record and `/me` payload. They are not used for RBAC lookups.

---

## Where roles / permissions are stored

| Store | Key / table | Contents |
| --- | --- | --- |
| Redis | `user:{email}` | Portal `permissions[]` plus display metadata |
| Redis | `users:index` | Set of known emails |
| Redis | `role:{id}` | Built-in / custom portal role templates |
| Redis | `users:audit` | Permission change audit (capped) |
| Postgres | `roles`, `user_roles` | Workflow assignee roles (separate from portal perms) |

---

## Who can assign roles

| Action | Required permission |
| --- | --- |
| List/update portal users & permission sets | **`admin`** (`hub_admin` short-circuits `hasAnyPermission`) |
| Create/edit portal role templates | **`admin`** |
| Assign workflow roles (`PUT /hub/users/:email/workflow-roles`) | **`admin`** or **`hub_admin`** |
| View workflow role catalog (read) | `admin`, `hub_admin`, or `view_user_permissions` |
| SSO trust writes | **`manage_sso` only** |
| View management pages / vendor list | `view_management` — **not** sufficient for role writes or SSO writes |

There is no separate `manage_users` id; **`admin`** is the explicit user-permission write capability.

---

## Assignment model

| Mechanism | Kind |
| --- | --- |
| User Management UI — apply a portal role (copies permission array) | Manual |
| First SSO login / missing Redis user on `/me` | Auto-provision **Employee** pack |
| Org SAML `connection.default_role` | Config default at first provision |
| Staging test-user seed | Seeded (non-production) |
| Entra / AuthBridge groups | **Not used** (may be stored as `sso_groups` metadata only) |

Portal role assignment copies permissions; it does not keep a live link to `role:{id}`.

---

## Session freshness

- **API enforcement:** immediate (re-reads Redis / Postgres per request).  
- **Browser UI:** after an authorized admin saves portal permissions, User Management soft-refreshes `/me` and re-applies hub nav permissions (session cookie unchanged).  
- Session JWT does not embed permissions.

---

## Audit

| Change | Audit sink |
| --- | --- |
| Portal permissions create/update/delete | Redis `users:audit` |
| Workflow role assignment | `recordSecurityAudit('rbac.user_roles_set', …)` |
| SSO trust changes | `sso.trust_*` security audit |

---

## Safety controls (design7)

| Control | Behavior |
| --- | --- |
| Self-elevation | `PUT /users/:email/permissions` and workflow-role PUT reject `actor === target` (`SELF_ELEVATION_FORBIDDEN`) |
| Privilege ceiling | Non-bootstrap actors may only grant permissions they themselves hold |
| Bootstrap admins | Env `BOOTSTRAP_ADMIN_EMAILS` — full catalog; cannot be demoted/deleted via API |
| Caller identity | Taken from verified session / AuthBridge context only — body `actor` / `actorEmail` ignored |
| Fail closed | Authenticated user with empty permissions → 403 on gated APIs; UI hides admin surfaces |

---

## Control Room capability mapping

| Portal role | Control Room |
| --- | --- |
| `employee` | Operator pack |
| `management` | Supervisor pack (+ `admin` / `hub_admin` for hub admin surfaces) |
| `hub_admin` / `admin` permission | Elevated — all CR capabilities |
| `requester` / `accounts_payable` | No CR access |

`manage_sso` is **not** part of the Management built-in role; SSO trust must be granted explicitly.

---

## No-role behavior

Valid SSO session with no Redis user → auto-provision Employee.  
Authenticated with empty permissions → fail closed on privileged routes.  
Manually added user starts with `permissions: []` until an admin assigns a role.
