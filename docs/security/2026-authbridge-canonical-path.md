# AuthBridge Canonical Validation Path (Current Repository)

**Date:** 2026-10-05  
**Canonical module:** `api/lib/authbridge.js`  
**Provider selection:** `AUTH_PROVIDER=authbridge` (default remains `entra` → `api/lib/entra.js`)

Production must not silently fall back to a weaker adapter. `handleAuth` in `api/maintainx.js` branches on `AUTH_PROVIDER` once.

---

## Modes

| Mode | Env | Identity source | Notes |
| --- | --- | --- | --- |
| `oidc` (default) | authorize/token/client/redirect URIs | Authorization-code callback → id_token / userinfo | Claim validation after confidential exchange |
| `header` | `AUTHBRIDGE_TRUST_PROXY_HEADERS=1` + `AUTHBRIDGE_SHARED_SECRET` (≥16) | Timing-safe secret + email header | Gateway must strip spoofed headers |
| `jwt` | HMAC secret (+ audience/app) | `Authorization: Bearer` via `identityFromBearerToken` | HS256 only; `alg=none` rejected |

---

## Claim checks (`validateAuthBridgeClaims`)

| Check | When enforced |
| --- | --- |
| `exp` | Always when present; reject expired |
| `nbf` | When present |
| `iss` | When `AUTHBRIDGE_ISSUER` set |
| `aud` | When `AUTHBRIDGE_AUDIENCE` set |
| Application enabled | `AUTHBRIDGE_APP_ENABLED` not `0/false/off` |
| Application entitlement | When `AUTHBRIDGE_APP_ID` set or `AUTHBRIDGE_REQUIRE_APP_ENTITLEMENT=1` |
| Email domain | `ALLOWED_EMAIL_DOMAINS` (existing) |

Entitlement claim sources: `apps`, `applications`, `app_ids`, `azp`, `appid`, `app_id`, `client_id`, `aud`.

---

## Request actor resolution (`api/lib/auth.js` `getActorEmail`)

1. Signed-out marker → anonymous  
2. Session JWT cookie (`sliops_session` / `sliops_remember`)  
3. AuthBridge trusted headers **or** verified Bearer JWT  
4. **No** `x-vercel-*` / `x-actor-email` identity

---

## Duplicate / parallel stacks (not fallbacks)

| Stack | Use |
| --- | --- |
| AuthBridge | When `AUTH_PROVIDER=authbridge` |
| Entra OIDC | When AuthBridge not selected |
| Org SAML `/sso/:org/*` | Multi-tenant org login (separate) |

---

## Tests

- `npm run security:gate2-authbridge-entitlement-test`
- `npm run security:gate2-identity-fallback-test`
- `npm run security:wos-logout-authbridge-me-test`
