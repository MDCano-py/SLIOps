# Migration 001 — Organizations & SAML connections (Redis)

This app uses Upstash Redis, not SQL. Apply by using the admin API or Management UI — no SQL migration runner.

## Keys created on first save

```
org:{uuid}              → organization record
org:slug:{slug}         → uuid lookup
orgs:index              → SET of org uuids
saml:org:{orgId}        → SAML connection for org
```

## Bootstrap from legacy env vars

If `SAML_ENTRY_POINT`, `SAML_ISSUER`, and `SAML_CERT` are set, visiting `/sso/default/login` or saving SSO admin auto-creates:

- Organization slug: `SAML_ORG_SLUG` or `default`
- SAML connection populated from env vars

## User records

Existing `user:{email}` keys gain optional fields on next SSO login:

- `organization_id`, `organization_slug`, `auth_provider`, `external_id`, `role`, `sso_groups`

No bulk backfill required.
