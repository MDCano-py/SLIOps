# Microsoft Entra ID SSO (OIDC) — Setup

The portal uses **OIDC authorization code flow** with `@azure/msal-node` on the server. Employees sign in at `/api/auth/login`; Microsoft redirects to `/api/auth/callback`; the server issues the existing **`sliops_session`** httpOnly cookie. Microsoft access/refresh tokens are **never** sent to the browser.

Legacy SAML (`/api/auth/acs`) remains available only if Entra OIDC env vars are **not** set and SAML env vars are.

## Azure App Registration

1. In [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** → **New registration**.
2. Name: e.g. `Streamline Operations Portal`.
3. Supported account types: **Single tenant** (recommended) or per your IT policy.
4. Redirect URI — **Web**:

   ```
   https://<your-production-host>/api/auth/callback
   ```

   Examples:

   - Production: `https://sliops.com/api/auth/callback`
   - Vercel preview: `https://parts-request-portal-xxx.vercel.app/api/auth/callback`

   Must match **`ENTRA_REDIRECT_URI`** exactly (scheme, host, path).

5. After creation, note:
   - **Application (client) ID** → `ENTRA_CLIENT_ID`
   - **Directory (tenant) ID** → `ENTRA_TENANT_ID`

6. **Certificates & secrets** → New client secret → copy value → `ENTRA_CLIENT_SECRET`.

7. **API permissions** (Microsoft Graph, delegated):

   - `openid`
   - `profile`
   - `email`
   - `User.Read`

   Grant **admin consent** if required by your tenant.

8. **Token configuration** (optional): ensure `email`, `preferred_username`, and `name` appear in ID token if sign-in fails with “no email”.

## Vercel environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ENTRA_TENANT_ID` | Yes | Entra tenant (directory) ID |
| `ENTRA_CLIENT_ID` | Yes | App registration client ID |
| `ENTRA_CLIENT_SECRET` | Yes | Client secret value |
| `ENTRA_REDIRECT_URI` | Yes | Full callback URL, e.g. `https://sliops.com/api/auth/callback` |
| `SESSION_SECRET` | Yes | ≥32 chars; signs portal session + OAuth state cookies |
| `ALLOWED_EMAIL_DOMAINS` | Yes | Comma-separated allowlist, e.g. `streamlinecorp.com,streamline.com` |
| `PORTAL_BASE_URL` | No | Post-login redirect base (default `/`) |
| `SSO_ENFORCEMENT` | No | `off` disables gates (emergency); default `on` |
| `BOOTSTRAP_ADMIN_EMAILS` | No | Comma-separated emails with full permissions |

## Routes (via `vercel.json` rewrite)

| URL | Purpose |
|-----|---------|
| `GET /api/auth/login` | Start Entra sign-in (`?next=/path` optional) |
| `GET /api/auth/callback` | OIDC redirect handler (do not call manually) |
| `GET /api/auth/logout` | Clear session + Microsoft logout |
| `GET /api/me` | Identity + permissions (unchanged) |

Rewrites map `/api/auth/*` → `/api/maintainx?path=/auth/*` internally.

## Portal roles (permissions)

New employees are auto-provisioned with the **Employee** role in Redis, which includes:

- `view_hub_dashboard`
- `view_hub_requests`
- `view_hub_reports`

**Hub admin** (`hub_admin`) is granted via the **Management** built-in role or `BOOTSTRAP_ADMIN_EMAILS`. Adjust roles in **Management → User Management** as before.

## Local development

When `NODE_ENV` is **not** `production`:

```text
GET /api/auth/dev-login?email=you@yourdomain.com
```

- Email must match `ALLOWED_EMAIL_DOMAINS`.
- Issues a normal session cookie (no Microsoft).
- **Never** available in production.

Alternatively set `SSO_ENFORCEMENT=off` for fully open API gates during local testing.

## Security notes

- Session cookie: `HttpOnly`, `Secure`, `SameSite=Lax`.
- OAuth CSRF: short-lived signed `sliops_oauth_state` cookie + `state` query param.
- Client action links `/hub/action/:token` remain public (token-protected), no SSO.
- Hub APIs require a valid session + permission checks server-side.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Redirect URI mismatch | `ENTRA_REDIRECT_URI` vs Azure “Web” redirect exactly |
| 403 Email not allowed | `ALLOWED_EMAIL_DOMAINS` includes user’s domain |
| 503 Entra not configured | All `ENTRA_*` + `SESSION_SECRET` set on Vercel |
| Login loop | `ALLOWED_ORIGIN` includes your portal origin; cookies not blocked |
| SAML still used | Entra vars missing — OIDC takes priority when all four `ENTRA_*` are set |
