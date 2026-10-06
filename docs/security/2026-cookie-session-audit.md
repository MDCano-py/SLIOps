# Cookie / Session Audit (Current Repository)

**Date:** 2026-10-05  
**Sources:** `api/lib/auth.js`, `api/lib/logout.js`, `api/lib/entra.js`, `api/lib/authbridge.js`, `api/lib/app-paths.js`

No speculative Domain changes were made. Session cookies remain **host-only** (no `Domain=` on issue).

---

## Cookies

| Name | Purpose | Domain | Path | Secure | HttpOnly | SameSite | Max-Age / TTL |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `sliops_session` | Sliding session JWT | host-only | `APP_BASE_PATH` or `/` | yes | yes | Lax | 8 hours |
| `sliops_remember` | Remember-me session JWT | host-only | same | yes | yes | Lax | 30 days |
| `sliops_oauth_state` | OAuth/OIDC state | host-only | same | yes | yes | Lax | 10 minutes |
| `sliops_oidc_id` | Entra id_token_hint for logout | host-only | same | yes | yes | Lax | session TTL |
| `sliops_signed_out` | Blocks AuthBridge header re-auth after logout | host-only | same | yes | yes | Lax | 24 hours |

AuthBridge browser cookies (names from env / `sli_authbri*` prefix) are **cleared** on logout; optional `AUTHBRIDGE_COOKIE_DOMAIN` used only for clear, not for issuing SLIOps session cookies.

---

## Lifecycle

| Step | Behavior |
| --- | --- |
| Login (Entra/AuthBridge) | `issueSession` → session or remember cookie; clears the other; clears signed_out |
| Refresh / sliding | Authenticated requests may re-issue session (existing behavior) |
| Deep link | `next` normalized via `app-paths`; post-auth redirect |
| Logout | `clearSession` under Path=mount **and** Path=/; issue signed_out; optional IdP logout redirect |
| Reauthentication | Explicit Sign In → `/api/auth/resume` (clears signed_out); does not auto-loop to login |

---

## Host-only vs Domain

- **Current issue path:** host-only (secure default).  
- **Production Domain value:** `UNKNOWN_REQUIRES_HUMAN_CONFIRMATION` if AuthBridge sets parent Domain cookies — clear path already supports `AUTHBRIDGE_COOKIE_DOMAIN`.  
- Do not set SLIOps session `Domain` from historical guesswork.

---

## Regression tests (passing)

- `security:wos-logout-session-clear-test`
- `security:wos-signed-out-boot-test`
- `security:wos-logout-authbridge-me-test`
- `security:staging-hardening-test` (cookie flags)
