# Vendor identity AuthBridge / Nginx boundary

## Goal

External vendor contacts authenticate via magic link + `sliops_vendor_session`.
Employees continue via Entra / AuthBridge + `sliops_session`.

Do **not** globally disable AuthBridge.

## Minimal exemptions (edge)

When AuthBridge (or equivalent SSO gate) sits in front of SLIOps, allow
unauthenticated browser reachability only for:

| Path | Why |
|------|-----|
| `/vendor-workspace.html` | External Vendor Workspace UI |
| `/api/maintainx?path=/vendor/auth/consume` | Magic-link consumption |
| `/api/maintainx?path=/vendor/auth/me` | Vendor session probe |
| `/api/maintainx?path=/vendor/auth/logout` | Vendor logout |
| `/api/maintainx?path=/vendor/workspace` | Vendor-scoped workspace API |

Static assets required by the workspace page (`hub.css`, `hub-themes.css`, fonts)
must remain reachable the same way other public static pages are.

## Must remain SSO-protected

- `/` Hub / Management UI
- `/api/maintainx?path=/vendors*` (employee vendor APIs, including invite)
- `/api/maintainx?path=/hub/*` (except existing public action/inbound paths)
- RBAC / Control Room / User Management

## Application enforcement

Node SSO gate treats only `isVendorIdentityPublicPath()` routes as public.
Those handlers still require:

- a valid one-time invite token during consume, or
- a valid `sliops_vendor_session` afterward

Vendor sessions never satisfy employee RBAC.

## Legacy shared passcode (SCR-S05)

`/vendor-auth`, `/vendor-session`, and `X-Vendor-Session` passcode auth are
hard-disabled when `NODE_ENV` is `production` or `staging` (404).
Optional local kill switch: `VENDOR_LEGACY_PASSCODE=off`.

## Staging nginx note

See comments in `deploy/nginx/ops-hub-staging.conf`. AuthBridge path exceptions
are an infrastructure change on the live edge; this repo documents the required
surface only.
