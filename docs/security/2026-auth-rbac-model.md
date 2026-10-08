# SLIOps Auth & RBAC Model — Extracted Current Truth

**Date:** 2026-10-05 (updated Gate 2)  
**Sources:** `PERMISSION_CATALOG`, `BUILT_IN_ROLES`, Postgres `roles`/`user_roles`, staging personas, route gates, `rbac-client.js`.

Do not invent organizational roles. **PROPOSAL** marks are not current truth.

---

## Authorization layers (keep separate)

| Layer | Question | Enforcement |
| --- | --- | --- |
| Application entitlement | May this identity use this SLIOps app? | AuthBridge `AUTHBRIDGE_APP_ID` / domain allowlist / `AUTHBRIDGE_APP_ENABLED` |
| Capability authorization | May they perform this action type? | `requirePermissions` + catalog |
| Resource authorization | May they access this object? | Request/step/submission/vendor guards (not global `created_by`) |
| Administrative trust | May they change IdP/SAML trust? | **`manage_sso`** (writes); read may use `view_management` |
| Frontend visibility | What should they see? | `rbac-client.js` — not security |

UserA and UserB remain equivalent Standard identities (`employee` / field_technician style). Do not manufacture artificial role differences.

---

## Identity resolution

1. `sliops_signed_out` → anonymous  
2. Session JWT cookies  
3. AuthBridge verified headers or Bearer JWT  
4. ~~x-vercel-*~~ **removed**

---

## Portal permission catalog

| Permission | Source | Frontend capability | API capability | Resource scope | Admin/trust | Test coverage |
| --- | --- | --- | --- | --- | --- | --- |
| `view_hub_dashboard` | catalog | Dashboard | Hub dashboard | Shared ops | — | rbac / staging |
| `view_hub_requests` | catalog | Request hub | Requests | Shared + step rules | — | workflow-step |
| `view_hub_reports` | catalog | Reports | Hub reports | Shared | — | static |
| `hub_admin` | catalog | Hub admin surfaces | Broad hub admin; short-circuit | Broad hub | Elevated | rbac-authz |
| Tab `view_*` | catalog | Tabs | Tab-gated routes | Tab | — | legacy-route |
| `view_management` | catalog | Management section | Vendor/mgmt reads; **SSO read only** | Mgmt | **Not trust write** | gate2-sso |
| Vendor view/edit/doc perms | catalog | Vendor UI | Vendor APIs | Vendor records | — | vendor tests |
| `view_user_permissions` | catalog | Users tab visibility | — | Users | — | — |
| `delete_*_archive` | catalog | Archive delete | Archive DELETE override | Archives | — | legacy-route |
| `admin` | catalog | User/role admin | `/users*`, `/roles*` | Users/roles | Elevated | rbac-authz |
| **`manage_sso`** | catalog (Gate 2) | Organization SSO UI | SSO **write** + read | SAML trust | **Trust admin** | gate2-sso |
| `configuration.*` / `workflow.*` / `form.manage` / `document.manage` / `dashboard.manage` / `variable.manage` | catalog | Config center | `/hub/configuration*` | Config defs | — | configurable-platform |
| `control_room_*` | catalog + built-in roles | Control Room UI | `/hub/control-room/*` | **Shared by capability** (no station isolation; no `created_by` gate) | — | `security:control-room-test` |

---

## Built-in portal roles (`BUILT_IN_ROLES` / Redis seed)

| Role | Permissions (summary) | Frontend | API | Resource scope | Trust | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| `employee` | Core view tabs + **CR operator pack**; no management | Standard UI | Non-admin + CR ops | Shared ops + own submissions; CR shared by capability | none | IDOR / step / CR |
| `requester` | employee views + `view_management` + `submit_new_vendor` (**no CR**) | Mgmt tab limited | Vendor submit | Shared | **no manage_sso** | gate2-sso neg |
| `accounts_payable` | Vendor view/edit/docs (**no CR**) | Vendor full | Vendor mutations | Vendors | none | rbac-authz |
| `management` | Near-full incl. `admin`, `hub_admin`, **CR supervisor pack** — **not** `manage_sso` | Admin | Admin + CR supervisor | Broad | **no trust write by default** | gate2-sso / CR / design7 |

**SSO trust:** `manage_sso` is granted explicitly (Hub Admin / dedicated grant). Seed merge strips `manage_sso` from Redis `role:management` if present.

---

## Workflow roles (Postgres)

| Role key | Source | Typical use | Portal perms (staging seed) | Trust |
| --- | --- | --- | --- | --- |
| `admin` | migration 011 | Workflow admin | — | — |
| `requester` | 011 | Fill steps | — | — |
| `manager` | 011 | Approve | — | — |
| `operations` | 011 + seed | Ops | ops manager preset | no SSO write unless hub_admin |
| `ap` / `legal` | 011 | Steps | accounting / — | — |
| `hub_admin` | seed | Staging persona | full + **manage_sso** | yes |
| `hr`, `field_supervisor`, `field_technician`, `client`, `vendor` | seed | Personas | see ROLE_TEST_MATRIX | no |

---

## Sensitive route → capability → resource → audit

| Route | Method | Capability | Resource auth | Audit |
| --- | --- | --- | --- | --- |
| `/sso-admin/organizations` | GET | `manage_sso` \| `view_management` | org list | — |
| `/sso-admin/organizations/:slug` | GET | same | org | — |
| `/sso-admin/organizations/:slug` | PUT | **`manage_sso` only** | org SAML trust | `sso.trust_updated` (no cert) |
| `/sso-admin/.../test` | POST | **`manage_sso` only** | connection | `sso.trust_test` |
| `/users*`, `/roles*` | * | `admin` | users/roles | rbac audits |
| `/hub/requests*` | * | hub view/admin | owner/assignee/step | hub audit |
| `/hub/templates*`, configuration | * | configuration.* / form.manage | template | security-audit |
| MaintainX proxy | * | session SSO gate | path allowlist | remapped upstream errors |
| `/photo-cleanup`, `/archive-wipe-orphans` | POST | `CLEANUP_SECRET` | storage keys | storage.* |
| `/hub/dev/*demo*` | POST | admin + flags | demo data | blocked prod |
| `/hub/control-room/*` | * | matching `control_room_*` (elevated: `admin`/`hub_admin`) | Shared by capability; optional future station scope | `control_room.*` security-audit |

---

## Pentest Standard users

| Identity | Role equivalent | Notes |
| --- | --- | --- |
| UserA | Standard (`employee` / field_technician) | Equivalent to UserB |
| UserB | Standard | Equivalent to UserA |
| Hub Admin | `hub_admin` / `management` | Not Entra Global Admin |

Horizontal tests must use resources that product policy isolates — not shared station/ops records chosen only to force a deny.
