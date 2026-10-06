# Destructive / Cleanup Endpoint Inventory

**Date:** 2026-10-05

| Endpoint | AuthN | AuthZ | Environment restriction | Additional secret | Audit | Production behavior |
| --- | --- | --- | --- | --- | --- | --- |
| `POST /photo-cleanup` | Shared secret | Timing-safe `CLEANUP_SECRET` (≥16) | None (ops job) | **Required** — missing/empty → **503** `CLEANUP_NOT_CONFIGURED` | `storage.photo_cleanup` / `_disabled` | Fail closed without secret |
| `POST /archive-wipe-orphans` | Shared secret | Same | None | **Required** ≥16 | `storage.archive_wipe_orphans` / `_disabled` | Fail closed without secret |
| `POST /hub/dev/seed-demo-data` | Session | `hub_admin`/`admin` + demo flags | Blocked in production; staging needs `STAGING_DEMO_DATA_ENABLED` | — | demo seed paths | 403/disabled |
| `POST /hub/dev/clear-demo-data` | Session | admin + flags | Same | — | demo clear | 403/disabled |
| `scripts/db/reset.js` (CLI) | Operator shell | `assertResetAllowed` | Refuses production; staging non-local needs confirm | — | CLI | Not an HTTP route |
| Archive `DELETE` | Session | delete perms or creator+24h | — | — | archive | Existing RBAC |
| User/role DELETE | Session | `admin` | — | — | rbac audit | Existing RBAC |

**Rule:** Missing secret or missing configuration **disables** the endpoint; it never becomes easier to invoke.
