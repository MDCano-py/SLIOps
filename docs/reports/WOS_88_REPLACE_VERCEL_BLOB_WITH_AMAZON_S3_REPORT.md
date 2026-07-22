# WOS-88 — Replace Vercel Blob with Amazon S3

**Card:** WOS-88 — Replace Vercel Blob with Amazon S3  
**Commit:** (see `git log -1` on `main`)  
**Status:** Complete for active runtime paths. **No automatic migration** of existing Vercel Blob objects.

---

## 1. Pre-change inventory (what was stored via Vercel Blob)

| Kind | Object key / prefix | Endpoints | Auth | Notes |
|------|---------------------|-----------|------|-------|
| Parts request photos | `parts-photos/{YYYY-MM-DD}/{filename}` (+ random suffix) | `POST /photo-upload`, `POST /photo-cleanup` | Session (upload); `CLEANUP_SECRET` optional (cleanup) | Uploaded with **public** ACL historically |
| Vendor documents | `vendor-docs/{ref}/{ts}__{kind}__{filename}` (+ random suffix) | `POST/DELETE /vendor-docs/…`, list via hydrate, ZIP, `GET /vendor-doc` | Vendor RBAC / session | Listing was SoR for files; Postgres kept status metadata only (no URL) |
| Orphan archive JSON | `archive/{jsa\|bol\|swp}/…` | `POST /archive-wipe-orphans` | `CLEANUP_SECRET` | No longer written; wipe-only leftover |

**Not Blob (already Redis/Postgres):** JSA / BOL / SWP archive **records**, hub request archives, roll-off forms.

**Single runtime import:** `api/maintainx.js` → `require('@vercel/blob')` (`put` / `list` / `del`).  
**Env:** `BLOB_READ_WRITE_TOKEN`.  
**Client:** Vendor UI opened public Blob URLs directly; `/vendor-doc?url=` proxy existed but was unused.

**Existing production data:** This card **does not** delete or copy any Vercel Blob objects. Operators must confirm whether the former Blob store still holds live files before any cutover of historical downloads. See §8 migration plan.

---

## 2. Summary of changes

- Added `api/lib/storage/` facade with **Amazon S3** adapter (private objects) and optional **local** adapter (`STORAGE_DRIVER=local`) for development only.
- Replaced all `@vercel/blob` call sites in `api/maintainx.js`.
- Removed `@vercel/blob` dependency; added `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`.
- Downloads use authenticated same-origin proxy (`GET /vendor-doc?key=…`) with **key isolation** (`vendor-docs/{ref}/…` must match). Optional `?presign=1` returns a short-lived presigned GET.
- Uploads validate type/extension/size; object keys are **server-generated**.
- Staging/production: missing S3 config → **503** `STORAGE_NOT_CONFIGURED` (no silent Vercel/local/memory fallback).
- Audit lines: `storage.photo_upload`, `storage.photo_cleanup`, `storage.vendor_doc_upload|delete|download`, `storage.archive_wipe_orphans`.
- Env examples + `DEPLOYMENT_STAGING.md` / `DEPLOYMENT_NOTES.md` updated for S3 + IAM.
- UI vendor doc links use authenticated `key=` URLs.

---

## 3. Files and workflows migrated

| Area | Before | After |
|------|--------|-------|
| Photo upload / cleanup | Vercel Blob public `put`/`list`/`del` | S3 (or local-dev) private put/list/delete |
| Vendor doc upload / delete / list / ZIP | Vercel Blob | S3 private; ZIP uses `getObject` |
| Vendor download | Public URL or Blob-host proxy | Authz + key isolation + stream or presign |
| Package | `@vercel/blob` | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` |

**New modules:** `api/lib/storage/{index,config,keys,s3,local}.js`  
**Tests:** `scripts/security/object-storage-test.js` → `npm run security:object-storage-test`

---

## 4. Environment variables (placeholders only)

```bash
STORAGE_DRIVER=s3
S3_BUCKET=<your-private-bucket>
S3_REGION=us-east-1
PRESIGNED_URL_EXPIRES_SECONDS=300
# Prefer EC2 IAM role — optional local keys only:
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
# AWS_SESSION_TOKEN=

# Local development only (refused on staging/production):
# STORAGE_DRIVER=local
# STORAGE_LOCAL_ROOT=./for-dev/local-object-storage
```

**Removed from examples / runtime:** `BLOB_READ_WRITE_TOKEN`.

---

## 5. S3 bucket and IAM setup

1. Create a **private** bucket; enable **Block Public Access**.
2. Attach an IAM role to the EC2 instance (preferred) with ListBucket (prefix-conditioned) + Get/Put/DeleteObject on `vendor-docs/*`, `parts-photos/*`, `archive/*` — see `DEPLOYMENT_STAGING.md`.
3. Set `S3_BUCKET` / `S3_REGION` / `STORAGE_DRIVER=s3` on the server env.
4. Restart PM2 processes; verify `GET /health` → `object_storage_configured: true`.
5. **CORS:** not required for the current design (browser → Node → S3). Only needed if a future feature uploads directly from the browser to S3 via presigned PUT.

---

## 6. Tests and results

| Suite | Result |
|-------|--------|
| `npm run security:object-storage-test` | **35/35 PASS** |
| `npm run security:staging-readiness-test` | **49/49 PASS** |
| `npm run security:staging-hardening-test` | **34/34 PASS** |
| `npm run security:staging-test-login-test` | **45/45 PASS** |
| `npm run security:postgres-only-staging-health-test` | **26/26 PASS** |
| `npm run security:legacy-route-rbac-test` | **16/16 PASS** |
| `npm run security:rbac-authz-test` | **23/23 PASS** |
| `npm run security:no-origin-auth-gate-test` | **10/10 PASS** |
| `npm run security:secret-scan` | **PASS** |
| `vendor-documents:test` / `vendor-document-notifications:test` / `vendor-rbac-ui:test` | Skipped locally (require `DATABASE_URL`) |

Coverage includes: missing config, local forbidden on staging, invalid upload type/size, key isolation, put/get/list/delete, presign `expiresIn`, storage miss failure, package/env inventory.

---

## 7. Remaining “Vercel” references (intentional / historical)

| Reference | Action |
|-----------|--------|
| `vercel.json` | Historical cron/rewrite reference; **not used on EC2** (Nginx + system/PM2 cron). Kept; not Blob runtime. |
| Older WOS reports (79/80/82/87) | Historical text mentioning Blob — left as audit trail |
| `scripts/security/secret-scan.js` still lists `BLOB_READ_WRITE_TOKEN` | Intentional: detect accidental reintroduction of secrets |
| CORS allowlist for `*.vercel.app` preview hosts (non-deployed only) | Legacy local/preview helper — not Blob storage |
| Comment/docs in older architecture notes | Historical |

**Runtime:** no `@vercel/blob` import remains.

---

## 8. Migration plan for existing Vercel Blob files (no automatic action)

**Stop condition:** Do not delete or overwrite historical Blob objects from this card.

1. **Discover:** With the old `BLOB_READ_WRITE_TOKEN` (ops secret store / password manager — not git), use Vercel Blob list API or dashboard for prefixes `vendor-docs/`, `parts-photos/`, `archive/`. Record counts and sample keys.
2. **Classify:** Confirm whether staging/production still need those binaries (vendor docs likely; photos maybe orphaned).
3. **If migration needed:**
   - Create empty private S3 bucket; deploy WOS-88 code with S3 configured.
   - Copy objects to the **same key paths** (`vendor-docs/…`, `parts-photos/…`) via AWS CLI / one-off script (server-side only).
   - Postgres vendor `document_meta_json` does **not** store Blob URLs — listing by prefix remains SoR — so DB URL rewrites are usually unnecessary.
   - Spot-check: open vendor detail download (auth proxy), ZIP download, photo cleanup dry-run.
4. **Only after verification:** revoke `BLOB_READ_WRITE_TOKEN` and decommission the Blob store.
5. **If no live files:** skip copy; leave Blob store idle until IT confirms deletion.

---

## 9. Remaining blockers

1. **S3 must be configured on EC2** (`S3_BUCKET` + IAM role) before vendor doc uploads work on staging/production.
2. **Historical Vercel Blob objects** are not migrated by this commit — follow §8 if real files exist.
3. MaintainX / Entra / management paper form (WOS-87) remain separate blockers.

---

## 10. Deploy verification (staging)

```bash
cd /var/www/ops-hub-staging
git pull origin main
npm ci --omit=dev
# Edit .env.staging: STORAGE_DRIVER=s3, S3_BUCKET=..., S3_REGION=...
pm2 restart ops-hub-staging ops-hub-staging-worker
curl -s http://127.0.0.1:3010/health | jq '{ok, object_storage_configured, object_storage_driver}'
```
