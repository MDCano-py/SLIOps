# Architecture — 2026-10-21 release candidate

**Branch:** `release/sliops-2026-10-21-retest`  
**Implementation commit:** `5db548a230280c2c85da2faf75c15787d4963a34`  
**Base:** `feature/sliops-ui-refinement` at `fb9a743`  
**Status:** Partial. Existing engines remain the system of record.

This document describes the repository after the local release-candidate changes. It is not a claim that every workflow engine has been replaced.

## What stayed in place

SLIOps is still the Node 20 CommonJS application in this repository: static Hub UI (`index.html`, `hub.js`, and module scripts) plus `api/maintainx.js` and `scripts/production-server.js`. Persistence remains PostgreSQL via the existing migrations `001` through `017`, plus additive `018_vendor_login_codes.sql`. No historical tables were rewritten or truncated.

These implementations are still authoritative:

| Area | Persistence / entry | Change in this candidate |
| --- | --- | --- |
| Operational Work Orders and MaintainX | Hub requests `request_type=work_order`, `api/lib/hub/integrations.js`, MaintainX proxy allowlist | Launch catalog keeps the operational card |
| Parts and Equipment | Legacy document-registry types `parts_request`, `equipment_request` | Unchanged |
| Workspace Forms | Template runtime and spaces launch registry | Unchanged |
| Configuration runtime | `api/lib/configuration/*`, migration `013` | Repair NDA wiring hidden unless `diagnostics=1` |
| Document actions | Hub `action_links` and template external actions | Unchanged |
| Vendor onboarding records | `vendor_master` | Unchanged rows; workspace read path is now by primary key |
| Vendor identity | Migration `017` magic links and `sliops_vendor_session` | Email verification codes added beside magic links |
| Control Room | Migration `015` and `api/lib/control-room/*` | Unchanged |
| Employee auth | Entra / AuthBridge and `sliops_session` | Vendor JWTs are rejected as employee sessions |

## Shared interfaces

`api/lib/platform/services.js` exposes facades over the existing hub store and security-audit logger:

- `requestLifecycle` — get, list, create, patch, status history
- `workflow` — list, get, save steps
- `documents` — list, save, web document get
- `notifications` — list, create, mark read
- `audit.security` — structured security-audit log
- `authorization.vendorMayAccessCompany` — company scope check used by the vendor workspace route

Existing Hub, template, and Control Room routes were not switched onto these facades. The facades are the shared entry for new callers. They do not cache authorization decisions.

`api/lib/platform/principals.js` names three principals: `EMPLOYEE`, `VENDOR`, `EXTERNAL_ACTION_RECIPIENT`. Vendor session resolution still requires `typ=vendor_session`. Employee `getSession` rejects that type and any token carrying vendor session claims (`sid`, `sk`, `vid`, `cid`).

## Request catalog

`hub-new-request-registry.js` still merges legacy document-registry types with published configuration request types. When both a legacy `work_order` card and a configurable `work_order` card are present, the configurable card is omitted. The operational Work Order remains the launch target. The configurable definition is not deleted. Other request types are not collapsed. `groupNewRequestTypes` groups cards for the existing New Request registry test.

## Explicitly not done

- No wholesale replacement of hub requests, template submissions, MaintainX work orders, or Control Room tasks with one new request table.
- No removal of magic-link invitations.
- No production or staging deploy from this working session.
- Duplicate non-work-order launch cards, where a legacy type and a configured type share a key other than `work_order`, are still both eligible to appear.
