# Admin access control

## Source of truth

Admin access is based on the authenticated user’s **permissions**, returned by `GET /me`.

- UI hiding is for cleanliness only.
- **Server-side permission checks** are the real enforcement (`requirePermissions` in `api/maintainx.js`).

## No production passcodes

Passcode-gated admin tools are not used as a production security control.

- Legacy passcode endpoints (`/vendor-auth`, `/vendor-session`) return **404** in production.
- Management UI does not prompt for passcodes; restricted users see **Access restricted** with **Back to Dashboard**.

## Enforcement rules

For admin APIs:

- Unauthenticated callers receive **401 Not authenticated**
- Authenticated callers without the required permission receive **403 Forbidden**

Admin/protected areas include (non-exhaustive):

- Vendor management (`/vendors`, `/vendor-docs`, vendor ZIP/record export) — production RBAC
- User/role/permission management (`/users`, `/roles`, `/permissions-catalog`) — `admin`
- Integrations/system health (`/integrations-status`, automation retry) — `hub_admin` / `admin` / `view_management`
- Organization SSO configuration (`/sso-admin/*`) — `hub_admin` / `admin` / `view_management`
- Hub admin endpoints (workflow templates, registry overrides, automation retry, demo seed/clear) — `hub_admin`

## Client behavior

- The portal loads `rbac-client.js` and fetches `/me` on load.
- `applyPortalNavPermissions()` / `RbacClient.applyNav()` hide nav items the user cannot use.
- Direct hash navigation to a forbidden Management section shows the restricted gate (no passcode form).
- `mgmtFetch` uses session cookies only; **401/403** from APIs are surfaced as errors.

## Navigation → permission mapping

| UI surface | Route / hash | Permission rule |
|------------|--------------|-----------------|
| Top nav → Management (group) | `#/management/...` | Any Management section below |
| Vendor Management | `#/management/vendors` | `view_management` or any vendor Management permission (see catalog) |
| User Management | `#/management/users` | `admin` (API-enforced; `hub_admin` bypasses client checks) |
| Role Management | `#/management/roles` | `admin` |
| PSSR Management | `#/management/pssr` | `view_management` (or `hub_admin` / `admin`) |
| Organization SSO | `#/management/sso` | `hub_admin`, `admin`, or `view_management` |
| Integrations | `#/management/integrations` | `hub_admin`, `admin`, or `view_management` |
| Hub sidebar → Reports | `#/reports` | `view_hub_reports` (or `hub_admin` / `admin`) |
| Hub sidebar → Users | `#/management/users` | Same as User Management |
| Hub sidebar → Workflows (admin) | `#/hub-requests` | `hub_admin` only (template/admin tooling in queue) |
| Hub sidebar → Settings | `#/management/integrations` | Same as Integrations |
| Demo seed / clear | Dashboard dev panel | `hub_admin` only |
| MaintainX / automation retry | Request detail | `hub_admin` |
| Workflow template save | Request detail / builder | `hub_admin` |

Aliases: `#/admin` → vendor management; `#/settings` / `#/integrations` → integrations; `#/workflows` → request queue.

`hub_admin` and `admin` imply all catalog permissions in the client helper (`RbacClient.hasPerm`).

## Manual test checklist

1. **Non-admin user** — Management dropdown and Admin sidebar hidden; `#/management/users` shows Access restricted + Back to Dashboard.
2. **Vendor-only user** (`view_management` + vendor perms) — Vendor Management works; Users/Roles/SSO hashes restricted.
3. **Admin user** — All Management sections and APIs return 200.
4. **Unauthenticated** — Management shows sign-in message; APIs return 401.
5. **API** — `GET /roles` without `admin` returns 403.
