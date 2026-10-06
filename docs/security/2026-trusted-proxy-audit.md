# Trusted Proxy / Client IP Audit

**Date:** 2026-10-05

## Separation of concerns

| Layer | Status |
| --- | --- |
| Current code | App does **not** trust `X-Forwarded-For` / `X-Real-IP` unless `TRUST_FORWARDED_CLIENT_IP=1` |
| Nginx template | `deploy/nginx/ops-hub-staging.conf` overwrites `X-Forwarded-For` with `$remote_addr` |
| Live infrastructure | `UNKNOWN_REQUIRES_HUMAN_CONFIRMATION` — confirm edge chain and that updated template is loaded |

**No placeholder CIDR ranges** (`10.0.0.0/8`, etc.) were added to application config.

---

## Code uses of client IP

| Location | Use | Auth impact | After Gate 2 |
| --- | --- | --- | --- |
| `api/lib/staging-test-login.js` `clientIp` | Rate limit / audit | Not identity | Trust XFF only if `TRUST_FORWARDED_CLIENT_IP=1` |
| `api/lib/hub/routes.js` action links | `signer_ip` metadata | Not identity | Same flag |
| Nginx staging template | Sets/overwrites forwarded headers | Edge | Template updated; deploy = `INFRASTRUCTURE_CHANGE_REQUIRED` |

---

## Manual values required from operators

| Value | Why | Do not invent |
| --- | --- | --- |
| Public edge / TLS terminator address | Confirm who sets XFF | — |
| Whether Node is only reachable via localhost Nginx | Confirms overwrite trust | — |
| Whether to set `TRUST_FORWARDED_CLIENT_IP=1` on app | Only after edge overwrite verified | Do not enable blindly |

---

## Disposition

| Item | Disposition |
| --- | --- |
| Code arbitrary XFF trust for IP metadata | `MITIGATED` (default off) |
| Live Nginx overwrite deployed | `INFRASTRUCTURE_CHANGE_REQUIRED` |
| Auth via XFF | `VALIDATED_NOT_EXPLOITABLE` for identity (identity never from XFF) |
