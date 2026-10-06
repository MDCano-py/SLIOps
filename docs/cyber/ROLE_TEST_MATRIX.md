# Role Test Matrix — Staging Personas (WOS-89)

Emails: `*@staging-test.streamlinecorp.com`  
Login: staging test login (when enabled) or Entra accounts mapped to the same roles.

**Status key for live rows:** PASS / FAIL / PENDING_LIVE / N/A

---

## Permission expectations (catalog)

| Capability | hub_admin | operations | hr | ap | field_supervisor | field_technician | client | vendor |
|------------|-----------|------------|----|----|------------------|------------------|--------|--------|
| View hub dashboard / requests / reports (core) | Y | Y | Y | Y | Y | Y | Partial | — |
| View forms / archives (core set) | Y | Y | Y | Y | Y | Y | Forms only | — |
| Management panel | Y | Y | Y | Y | Y | N | N | Y* |
| Vendor list / docs / dashboard | Y | Y | N | Y | N | N | N | Y |
| Manage vendor documents (upload) | Y | Y | N | Y | N | N | N | N** |
| User / role admin (`admin` / hub_admin) | Y | Limited | N | N | N | N | N | N |
| Demo seed APIs | Admin + flag only | N | N | N | N | N | N | N |

\* Vendor role includes `view_management` for vendor surfaces — confirm UI shows vendor areas only.  
\*\* Upload/delete require `manage_vendor_documents` **and** configured S3 — else **BLOCKED — WAITING FOR S3**.

---

## Live verification matrix (fill during EC2 walkthrough)

| Persona key | Can open hub | Can open Management | Can open vendor list | Can seed demo | Direct API 403 on admin routes | Sign out works |
|-------------|--------------|---------------------|----------------------|---------------|--------------------------------|----------------|
| hub_admin | PENDING_LIVE | PENDING_LIVE | PENDING_LIVE | N (flag off) | PENDING_LIVE | PENDING_LIVE |
| operations_manager | PENDING_LIVE | PENDING_LIVE | PENDING_LIVE | N | PENDING_LIVE | PENDING_LIVE |
| hr_manager | PENDING_LIVE | PENDING_LIVE | N expected | N | PENDING_LIVE | PENDING_LIVE |
| accounting | PENDING_LIVE | PENDING_LIVE | PENDING_LIVE | N | PENDING_LIVE | PENDING_LIVE |
| field_supervisor | PENDING_LIVE | PENDING_LIVE | N expected | N | PENDING_LIVE | PENDING_LIVE |
| field_technician | PENDING_LIVE | N expected | N | N | PENDING_LIVE | PENDING_LIVE |
| client_representative | PENDING_LIVE | N expected | N | N | PENDING_LIVE | PENDING_LIVE |
| external_vendor | PENDING_LIVE | Vendor areas | PENDING_LIVE | N | PENDING_LIVE | PENDING_LIVE |

---

## Negative tests (all personas / anonymous)

| Test | Expected | Status |
|------|----------|--------|
| Unauthenticated API data call | 401 | PASS (automated suites) / PENDING_LIVE |
| Technician opens `/api/maintainx?path=/users` (or user mgmt) | 403, no data leak | PENDING_LIVE |
| Client opens vendor document upload | 403 | PENDING_LIVE |
| Cross-vendor object key download | 403/404 when S3 live | **BLOCKED — WAITING FOR S3** |
| Staging test login with arbitrary email | Rejected | PASS (automated) |
| Production NODE_ENV staging-test-login | 404 | PASS (automated) |

---

## Notes for Cyber

- Roles come from PostgreSQL `user_roles` for staging test login — **never** from browser-supplied role claims.  
- Hiding a nav item is not sufficient; APIs must enforce permissions (already the design).  
- Do not enable `DEMO_BYPASS`, `ALLOW_DEV_LOGIN`, or `SSO_ENFORCEMENT=off` for the engagement.  
