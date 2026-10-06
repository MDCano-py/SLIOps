# Multi-tenant SAML 2.0 SSO

This portal acts as the **SAML Service Provider (SP)**. Each organization can configure **Microsoft Entra ID** (Azure AD) as the Identity Provider (IdP).

Legacy single-tenant SAML (`/api/auth/login`, env `SAML_*`) and Entra OIDC (`ENTRA_*`) remain unchanged.

## Data model (Redis)

There is no SQL database. Organization and SAML connection records are stored in Redis:

| Key | Value |
|-----|--------|
| `org:{uuid}` | Organization JSON |
| `org:slug:{slug}` | Organization id |
| `orgs:index` | Set of organization ids |
| `saml:org:{orgId}` | SAML connection JSON |

### Organization fields

- `id`, `name`, `slug`, `sso_enabled`, `created_at`, `updated_at`

### SAML connection fields

- `id`, `organization_id`, `provider_name`
- `idp_entity_id`, `idp_sso_url`, `idp_x509_cert`
- `sp_entity_id`, `sp_acs_url`, `sp_metadata_url`
- `default_role`, `active`, `created_at`, `updated_at`

### User record extensions (`user:{email}`)

- `organization_id`, `organization_slug`
- `auth_provider` (`saml`, `entra`, `sso`, etc.)
- `external_id` (SAML NameID)
- `role`, `sso_groups` (optional)

## Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/sso/:orgSlug/login` | SP-initiated login redirect to Entra |
| POST | `/sso/:orgSlug/acs` | Assertion Consumer Service (IdP POST-back) |
| GET | `/sso/:orgSlug/metadata` | SP metadata XML for Entra import |

Admin (Management panel, vendor session):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/sso-admin/organizations` | List organizations |
| GET | `/sso-admin/organizations/:slug` | Get org + SAML config (cert not returned) |
| PUT | `/sso-admin/organizations/:slug` | Create/update org + SAML |
| POST | `/sso-admin/organizations/:slug/test` | Validate cert and URLs |

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SESSION_SECRET` | Yes | ≥32 chars — signs session cookies |
| `PORTAL_BASE_URL` | Recommended | Public portal URL, e.g. `https://portal.example.com` (used for SP URLs) |
| `UPSTASH_REDIS_REST_URL` | Prod | Redis store |
| `UPSTASH_REDIS_REST_TOKEN` | Prod | Redis auth |

Optional legacy bootstrap (creates org slug `default` on first use):

| Variable | Description |
|----------|-------------|
| `SAML_ENTRY_POINT` | Legacy IdP login URL |
| `SAML_ISSUER` | Legacy IdP entity id |
| `SAML_CERT` | Legacy IdP X.509 cert |
| `SAML_ORG_SLUG` | Slug for migrated org (default: `default`) |
| `SAML_ORG_NAME` | Display name for migrated org |

## Configure Microsoft Entra ID

1. Open **Enterprise applications** → **New application** → **Create your own application** (non-gallery).
2. Under **Single sign-on**, choose **SAML**.
3. Import SP metadata from:
   ```
   https://{your-host}/sso/{org-slug}/metadata
   ```
   Or enter manually:
   - **Identifier (Entity ID):** `https://{host}/sso/{slug}/metadata`
   - **Reply URL (ACS):** `https://{host}/sso/{slug}/acs`
4. Download the **Certificate (Base64)** and copy **Login URL** and **Microsoft Entra Identifier**.
5. In the portal: **Management → Organization SSO** — enter slug, IdP fields, enable SSO, Save.
6. Under **Attributes & Claims**, ensure email is sent:
   - `email`, `mail`, or `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress`
7. Optional: add **groups** claim for future role mapping (`sso_groups` on user record).

## Test locally

```powershell
cd "c:\Users\MDCan\OneDrive\Desktop\Parts_request-main"
npm run dev
```

1. Set in `.env.local`:
   ```
   SESSION_SECRET=your-local-secret-at-least-32-characters-long
   PORTAL_BASE_URL=http://127.0.0.1:3000
   HUB_USE_LOCAL_STORE=1
   ```
2. Open Management → Organization SSO (vendor passcode), configure org slug `default`.
3. Metadata: `http://127.0.0.1:3000/sso/default/metadata`
4. Login: `http://127.0.0.1:3000/sso/default/login`

For Entra, use a public tunnel (ngrok, Cloudflare Tunnel) so ACS URL is HTTPS and reachable from Microsoft.

## Security notes

- Unsigned SAML responses are rejected (`@node-saml/node-saml`, assertions must be signed).
- Issuer, audience, destination, and expiry are validated by the library.
- IdP certificates are stored server-side only — never exposed in frontend bundles.
- Server logs validation errors but never full SAML assertions.

## Gaps and assumptions

- **No email/password or magic-link login** in this codebase — SSO-only (plus dev-login / demo bypass).
- **Group → role mapping** stores `sso_groups` but does not auto-map Entra groups to app roles yet.
- **One SAML connection per organization** (no multiple IdPs per org).
- **Redis, not Postgres** — use Upstash in production.
- **Test connection** validates config parsing only; full end-to-end requires a real IdP login.
