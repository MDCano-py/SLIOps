# Vendor authentication — 2026-10-21 release candidate

**Local Postgres verification:** passed inside `npm run security:release-2026-10-21-test` (78 passed, 0 failed).  
**Live email and live HTTPS:** not verified. Local `.env.local.postgres` does not set `RESEND_API_KEY` or `EMAIL_NOTIFICATIONS_ENABLED`. No `.env.staging` is in this workspace. The release test logged `[vendor-otp] email delivery skipped (provider not configured)`. Staging HTTPS timed out, so AuthBridge exemptions were not observed on the live edge.

## Principals

Vendors authenticate as vendor contacts (`vendor_contacts`), not as AuthBridge employees. Session JWTs use `typ=vendor_session` and the cookie `sliops_vendor_session` (HttpOnly, Secure on `NODE_ENV` production or staging, SameSite=Lax, path from `APP_BASE_PATH`). Employee authorization reads only `sliops_session` and `sliops_remember`, and it rejects vendor tokens.

Deactivation uses the existing contact status `disabled` or `revoked`. The verify route loads only `status=active` contacts. The release test disabled a contact and received 401. Sessions already revoke through `revokeAllForContact` on the employee invitation route. Logout remains `POST /vendor/auth/logout`, which revokes the server session row and clears the cookie.

## Email verification code

| Control | Implementation |
| --- | --- |
| Code | `crypto.randomInt(0, 1000000)` rendered as six digits |
| Lifetime | 5 minutes (`CODE_TTL_MS` in `api/lib/vendor/identity/login-codes.js`). Not configurable. |
| Storage | `vendor_login_codes.code_salt` + SHA-256 of `salt:code`. No plaintext column. |
| Single use | Transaction: `SELECT … FOR UPDATE`, then `UPDATE … WHERE used_at IS NULL`. Replay returned 401 in the release test. |
| Attempts | `attempt_count` increments on a hash mismatch. Cap is 5 (`MAX_ATTEMPTS`). Further guesses return the same `invalid_code` body. |
| Rate limit | Per source address and per SHA-256 of the submitted email. Code requests: 8 / 15 min per IP and 5 / 15 min per account. Verify failures: 5 / 15 min per account, and the existing 20-failure IP lock. `X-Forwarded-For` is ignored unless `TRUST_FORWARDED_CLIENT_IP` is enabled. |
| Enumeration | `POST /vendor/auth/code/request` returns the same `{ ok: true, message }` for unknown, known, and ambiguous emails. Ambiguous emails (two active contacts) do not receive a code. Verify failures all return `{ error: "Invalid or expired verification code", code: "invalid_code" }`. |
| Audit | `vendor_login_code_issued`, `vendor_login_code_delivery`, `vendor_login_code_verified`, `vendor_login_code_rejected`, `vendor_login_ambiguous_email`. The code is not written to the audit payload or to `console.log` in `deliver-code.js`. |
| Email | Sent only when `EMAIL_NOTIFICATIONS_ENABLED=true` and `RESEND_API_KEY` is set, via Resend `EMAIL_FROM` or `VENDOR_NOTIFY_FROM`. Otherwise delivery is skipped and the HTTP response stays generic. |

Routes (employee SSO public, still unauthenticated until a code or session exists):

- `POST /vendor/auth/code/request`
- `POST /vendor/auth/code/verify`
- `GET /vendor/auth/me`
- `POST /vendor/auth/logout`
- `GET /vendor/workspace`
- `POST /vendor/auth/consume` (magic link, unchanged)

`vendor-workspace.html` shows the email form when no session exists and still consumes `?token=` invitation links.

## Magic link compatibility

`017` invitations are unchanged. SCR-S05 passed after migration `018` applied: create, consume, replay, expiry, revoke, and vendor A/B workspace isolation.

## Routing

`isVendorIdentityPublicPath` includes the two code routes so the Node SSO gate does not demand an employee session. Employee routes (`/vendors`, `/hub/*` except existing public action paths) are not public.

`deploy/nginx/ops-hub-staging.conf` comments list the code paths as AuthBridge exemptions. That file is a template. This session did not change a live Nginx or AuthBridge policy. Until the edge allow-list includes:

- `/ops-hub-staging/vendor-workspace.html`
- `/ops-hub-staging/api/maintainx?path=/vendor/auth/code/request`
- `/ops-hub-staging/api/maintainx?path=/vendor/auth/code/verify`
- the existing consume, me, logout, and workspace paths

vendor sign-in will not be reachable through an AuthBridge front door. Node will still reject those calls without a valid code or vendor cookie.

## Vendor data scope

Workspace reads `vendor_master` by `id` for the session's `vendor_id` only. A `ref` query that does not match that row returns 403. The external view still omits `financialNotes` and history. The release test confirmed vendor B's payload did not contain vendor A's company name or the string `SECRET`.

Vendors do not receive employee Hub navigation from `vendor-workspace.html`.

## Migration

`migrations/018_vendor_login_codes.sql` creates `vendor_login_codes` only. `npm run db:migrate` applied it on the local database during the release test (`[db:migrate] applying 018_vendor_login_codes.sql`). Rollback is `DROP TABLE IF EXISTS vendor_login_codes;` after the application is rolled back to a build that does not call that table.
