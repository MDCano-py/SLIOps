# S3 Deferred Checklist — Complete Before Final Cyber Handoff

**Status default:** **BLOCKED — WAITING FOR S3**  
Do **not** mark these PASS using local disk, mock storage, memory, or Vercel Blob.

When AWS provides bucket + IAM (prefer EC2 instance role):

## 1. Configure

```bash
# On EC2 .env.staging (placeholders only in git):
STORAGE_DRIVER=s3
S3_BUCKET=<private-bucket>
S3_REGION=<region>
# Prefer IAM role — avoid long-lived keys on the instance
pm2 restart ops-hub-staging ops-hub-staging-worker
curl -s http://127.0.0.1:3010/health | jq '{ok, object_storage_configured, object_storage_driver}'
```

Confirm Integrations UI shows object storage **configured** without exposing secrets.

## 2. Verify (mark PASS/FAIL live)

| # | Test | Status |
|---|------|--------|
| S1 | Parts-photo upload and retrieval | BLOCKED — WAITING FOR S3 |
| S2 | Vendor-document upload | BLOCKED — WAITING FOR S3 |
| S3 | Vendor-document preview / download (auth proxy or presign) | BLOCKED — WAITING FOR S3 |
| S4 | Vendor-document replacement / deletion | BLOCKED — WAITING FOR S3 |
| S5 | ZIP download of vendor docs | BLOCKED — WAITING FOR S3 |
| S6 | Cross-user isolation | BLOCKED — WAITING FOR S3 |
| S7 | Cross-role isolation | BLOCKED — WAITING FOR S3 |
| S8 | Cross-request / cross-vendor object key denial | BLOCKED — WAITING FOR S3 |
| S9 | Modified object key denial | BLOCKED — WAITING FOR S3 |
| S10 | Modified record ID denial | BLOCKED — WAITING FOR S3 |
| S11 | Invalid file type rejected | PASS (unit) / live BLOCKED until S3 |
| S12 | Oversized file rejected | PASS (unit) / live BLOCKED until S3 |
| S13 | Missing IAM permission fails safely (clear error, no crash) | BLOCKED — WAITING FOR S3 |
| S14 | Storage outage / misconfig fails safely | PASS (503 when unset) / live with bad bucket BLOCKED |
| S15 | Storage audit events in logs | BLOCKED — WAITING FOR S3 |

## 3. Historical Vercel Blob

Do **not** auto-migrate. If old Blob objects still exist, follow  
`docs/reports/WOS_88_REPLACE_VERCEL_BLOB_WITH_AMAZON_S3_REPORT.md` §8 before deleting anything.

## 4. Cyber decision

Until S1–S10 and S13–S15 are PASS on staging HTTPS:

- Environment description: **“Operational except for documented object-storage features.”**  
- Obtain **explicit written acceptance** from Cyber/Streamline before starting the penetration test under that limitation.  
