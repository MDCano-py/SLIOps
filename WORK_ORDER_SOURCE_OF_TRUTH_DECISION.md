# WOS-25 Work Order Source of Truth — Architecture Decision

**Date:** 2026-05-26  
**Status:** Proposed (v1)  
**Scope:** Work orders across WOS Hub, MaintainX, and Ignition/MQTT  
**Code changes:** None (documentation only)

---

## Executive summary

The Work Order System is **not a single system of record today**. It is a **multi-surface intake and workflow platform** (WOS Hub + legacy portal panels) with **MaintainX as the downstream execution system** after handoff. MaintainX execution state is **mirrored and fetched on demand**, not continuously reconciled. **Ignition/MQTT is not implemented in this repository** and must be treated as an external trigger/input surface until a formal adapter exists.

**Recommended v1 model:**

- **WOS owns** intake, workflow routing, document/signature state, notifications, comments, audit, and inbound email context.
- **MaintainX owns** field execution state **after handoff**.
- **WOS stores MaintainX mirror fields** (`maintainx_*`) but must **not** be presented or operated as execution source-of-truth unless/until reliable sync-back is built.
- **Ignition is input/trigger only** — not a lifecycle owner in v1.
- **Reconciliation is explicitly deferred** to a future card.

This report is honest: the codebase supports handoff and **on-demand status reads**, not bidirectional lifecycle sync.

---

## 1. Current architecture summary

### 1.1 Systems in scope

| System | Role in repo today | Persistence |
|--------|-------------------|-------------|
| **WOS Hub** | Central request/workflow queue, Postgres-backed (WOS-19–20) | Postgres `requests`, `workflow_steps`, `web_documents`, `comments`, `audit_events`, `notifications`, `integration_events` |
| **Legacy portal panels** | Work Order tab, Parts Request tab, JSA/BOL/SWP archives | Upstash Redis archives + optional hub mirror via `bridge.js` |
| **MaintainX** | Work order / work request execution via API proxy + handoff | MaintainX SaaS (external) |
| **n8n (optional)** | Automation webhooks for side effects | External |
| **Ignition / MQTT** | **Not present in this codebase** | External (assumed organizational context) |

### 1.2 Documented intent (code comments)

`api/lib/hub/constants.js` states:

> *Central portal DB (Upstash Redis) is source of truth for intake + workflow; MaintainX remains execution for work orders; n8n handles automation side effects.*

Postgres is now the validated hub store for staging/dev (WOS-19/20), but the **ownership split** remains: WOS for intake/workflow, MaintainX for execution.

Legacy archive comments in `api/maintainx.js` state work order archive records are written after MaintainX confirms creation, and **status is fetched live from MaintainX when opened** — not stored as authoritative execution state in the portal DB.

### 1.3 Work order creation paths (multiple surfaces)

There are **at least three** ways a work order can enter the ecosystem:

#### Path A — Legacy Work Order / Parts Request tabs (MaintainX-first)

1. Browser posts directly to MaintainX via proxy: `POST /workorders`
2. On success, archive payload includes `maintainxId` and `workOrderNumber`
3. Archive saved to Redis (`saveRequestArchive`)
4. **Optional** mirror into WOS Hub via `mirrorArchiveToHub()` (`bridge.js`)

If mirror succeeds, hub request gets `archive_kind`, `archive_id`, `maintainx_id`, and often status `sent_to_maintainx`.

#### Path B — WOS Hub request (WOS-first)

1. `POST /hub/requests` creates hub request (Postgres)
2. Workflow may include `send_to_maintainx` step
3. Handoff via `POST /hub/integrations/maintainx/create-work-order` → `createWorkOrderInMaintainX()`
4. On success: patches `maintainx_id`, `maintainx_sequential_id`, `maintainx_status`, `maintainx_synced_at`; transitions to `sent_to_maintainx`

#### Path C — Hub shortcut create + handoff

`POST /hub/integrations/maintainx/create-work-order` can create a hub request if `request_id` is omitted, then hand off in one call.

#### Path D — Ignition / MQTT (external, not in repo)

No ingestion adapter, webhook, or MQTT subscriber exists in this repository. Any Ignition-created work orders **do not automatically appear in WOS** unless another system writes them (e.g., direct MaintainX API, manual portal submission, or future adapter).

### 1.4 MaintainX integration mechanics (current)

| Capability | Implementation | Sync direction |
|------------|----------------|----------------|
| Create WO in MaintainX | `createWorkOrderInMaintainX()` | WOS → MaintainX |
| Retry failed handoff | `retryMaintainXSync()` | WOS → MaintainX |
| Read MX status (API) | `fetchMaintainXStatus()` — **on demand** | MaintainX → WOS (mirror fields only) |
| Proxy passthrough | `maintainx.js` allows `/workorders`, `/workrequests` | Client ↔ MaintainX |
| Legacy archive live status | Client fetches `/workorders/:id` when archive opened; 5-min client cache | MaintainX → UI (not persisted to hub) |

**There is no scheduled sync-back job**, no webhook receiver for MaintainX status changes, and no conflict resolution engine.

### 1.5 What WOS-19–24 added (relevant context)

- Postgres persistence for hub entities
- Assignment, review, signature notifications (outbound)
- Inbound email → comments (not workflow actions)
- Integration event dedupe for inbound email

None of these establish MaintainX or Ignition as co-equal lifecycle owners.

---

## 2. Current lifecycle ownership by system

### 2.1 Before MaintainX handoff

| Concern | Owner |
|---------|-------|
| Request creation, numbering (`WO-*`) | **WOS** (hub) or **legacy archive** (pre-mirror) |
| Workflow steps (fill/review/sign/approve) | **WOS** |
| Assignee, notifications, aging | **WOS** |
| Web document content, signatures | **WOS** |
| Internal status (`submitted`, `in_review`, `waiting_on_signature`, etc.) | **WOS** |

### 2.2 After MaintainX handoff (`sent_to_maintainx`)

| Concern | Owner |
|---------|-------|
| Technician execution, WO status in field | **MaintainX** |
| WOS `request.status` | **WOS** (may lag; updated only on explicit hub actions or `fetchMaintainXStatus`) |
| `maintainx_status` mirror field | **MaintainX** (copied on fetch/handoff) |
| Archive list status badge (legacy) | **MaintainX** (live fetch in browser, cached ~5 min) |

### 2.3 Ignition

| Concern | Owner |
|---------|-------|
| Machine-triggered WO creation | **Unknown / external** — no adapter in repo |
| Lifecycle after creation | **MaintainX** if Ignition posts to MaintainX directly; **invisible to WOS** unless ingested |

---

## 3. Answers to the ten review questions

### Q1. Is WOS currently acting as system of record, intake layer, or workflow wrapper?

**All three, depending on path — but not full execution system of record.**

- **Intake + workflow SoR:** Yes, for hub-native requests (Postgres): routing, documents, signatures, notifications, audit, comments.
- **Workflow wrapper:** Yes, around pre-handoff approval/review/sign steps.
- **Execution SoR:** **No.** After handoff, execution truth lives in MaintainX; WOS holds mirror fields and workflow metadata.

Legacy MaintainX-first submissions may exist in Redis archive **before** hub mirror; hub is not guaranteed to have been the creation point.

### Q2. Is MaintainX currently acting as execution system, system of record, or downstream handoff target?

**Primarily downstream execution system and de facto execution SoR after handoff.**

- Work orders are **created and updated in MaintainX** for field work.
- Portal/archive UI treats MaintainX status as **current reality when displayed** (live fetch).
- WOS does **not** own the full lifecycle unless the request never left WOS pre-handoff states.

### Q3. Where does Ignition fit?

**Outside this codebase today.**

- No Ignition/MQTT modules, subscribers, or ingestion endpoints were found.
- Organizationally: Ignition is an **input/trigger surface** (e.g., equipment fault → work request).
- v1 position: **Ignition → (future adapter or MaintainX direct) → optional WOS mirror**. WOS must not assume Ignition events are visible until ingested.

### Q4. What happens if WOS says open but MaintainX says closed?

**Today: drift persists unless someone triggers a status fetch or manually updates WOS.**

- WOS `request.status` may remain `sent_to_maintainx` or `maintainx_in_progress` while MaintainX shows `DONE`/`CLOSED`.
- Legacy archive UI may show closed (live MX fetch) while hub queue still shows open.
- `fetchMaintainXStatus()` updates `maintainx_status` and `maintainx_synced_at` but **does not reliably close the WOS request** (see §5.2).
- **No automatic reconciliation.**

### Q5. What happens if MaintainX updates a work order but WOS does not know?

**WOS remains stale until:**

1. User opens legacy archive detail (client fetches MX), or
2. Admin calls `GET /hub/integrations/maintainx/status/:requestId`, or
3. n8n/automation reacts to a webhook **if configured externally** (not built-in MX webhook in this repo)

Mirror fields (`maintainx_status`, `maintainx_synced_at`) update only on those actions.

### Q6. What happens if Ignition creates a work order but WOS does not ingest it?

**WOS has no record.** MaintainX (or another system) may have the WO; hub queue, notifications, and audit will not reflect it. This is a **blind spot** until an ingestion adapter links `maintainx_id` or creates a hub request.

### Q7. What status fields support reconciliation?

**WOS request (Postgres / hub model):**

| Field | Purpose |
|-------|---------|
| `status` | WOS lifecycle enum (see below) |
| `maintainx_id` | Foreign key to MaintainX WO |
| `maintainx_sequential_id` | Human-readable MX WO# |
| `maintainx_status` | Last known MX status string (mirror) |
| `maintainx_synced_at` | Last mirror refresh timestamp |
| `archive_kind` / `archive_id` | Link to legacy Redis archive |
| `assigned_to` / `assigned_to_email` | WOS routing assignee |
| `closed_at` / `completed_at` | WOS terminal timestamps |
| `updated_at` | General change marker |

**WOS lifecycle statuses** (`REQUEST_STATUSES`):

`submitted`, `received`, `in_review`, `waiting_on_internal_review`, `waiting_on_client_review`, `waiting_on_signature`, `waiting_on_approval`, `approved`, `sent_to_maintainx`, `maintainx_in_progress`, `waiting_on_parts`, `in_progress`, `completed`, `closed`, `rejected`, `canceled`, `failed_sync`

**Workflow step statuses:** `not_started`, `pending`, `in_progress`, `completed`, `skipped`, `rejected`, `failed`

**Web document statuses:** `draft`, `submitted`, `in_workflow`, `waiting_on_review`, `waiting_on_signature`, `completed`, `locked`, `rejected`

**Legacy archive:** stores `maintainxId` at submission time; list status from **client-side MX cache**, not hub DB.

### Q8. What integration events support reconciliation?

**Queued via `queueIntegrationEvent` / n8n webhooks:**

| Event type | Reconciliation relevance |
|------------|-------------------------|
| `request.created` | Intake audit |
| `request.status_changed` | WOS lifecycle changes |
| `request.assigned` | Routing |
| `workflow_step.*` | Pre-handoff progress |
| `document.signed` / `approved` / `uploaded` | Document workflow |
| `work_order.sent_to_maintainx` | Handoff success |
| `work_order.maintainx_status_changed` | **Only when `fetchMaintainXStatus` detects change** |
| `request.closed` | WOS close |
| `notification.created` | Side effect |
| `inbound_email` (WOS-24) | Email replies as comments — not MX sync |

**Gap:** No `maintainx.webhook.received`, no scheduled `maintainx.sync_poll`, no `ignition.work_order.created`.

### Q9. What is the safest v1 ownership model?

See §4 (recommended model). In short: **split SoR by phase and domain**; do not claim unified WO lifecycle in WOS until sync-back exists.

### Q10. What should be explicitly deferred?

- Bidirectional MaintainX ↔ WOS reconciliation service
- MaintainX webhook ingestion
- Ignition/MQTT ingestion adapter
- Automatic WOS close when MaintainX closes
- Conflict resolution UI (“WOS says X, MaintainX says Y — resolve”)
- Treating `maintainx_status` as authoritative in hub queue without freshness indicator
- Using plain email or Ignition events to complete/sign/approve workflow steps

---

## 4. Recommended v1 source-of-truth model

### 4.1 Principles

1. **One writer per domain** — avoid two systems mutating the same concern without sync rules.
2. **Phase-based ownership** — pre-handoff vs post-handoff have different SoRs.
3. **Mirrors must be labeled** — show `maintainx_status` as “MaintainX (last synced …)” not as hub status.
4. **No silent drift correction** — until reconciliation exists, prefer explicit user/admin refresh over wrong auto-close.
5. **Creation path matters** — document which surface created the WO when debugging drift.

### 4.2 Explicit ownership table

| Domain | Owner (v1) | Notes |
|--------|------------|-------|
| Request intake (hub-native) | **WOS** | `POST /hub/requests`, Postgres `requests` |
| Request intake (legacy WO/Parts tabs) | **Legacy archive → optional WOS mirror** | MaintainX-first; hub mirror best-effort via `bridge.js` |
| Workflow routing (fill/review/sign/approve) | **WOS** | `workflow_steps`, `documents.js`, `workflow.js` |
| Notifications (assignment/review/signature) | **WOS** | WOS-21–23 |
| Inbound email context | **WOS** | Comments only; WOS-24 |
| Document / signature state | **WOS** | `web_documents`, signature files, action links |
| Comments & audit trail | **WOS** | `comments`, `audit_events`, `status_history` |
| Handoff to MaintainX | **WOS action → MaintainX API** | `createWorkOrderInMaintainX` |
| Field execution state | **MaintainX** | Status, assignments, completion in MX app |
| MaintainX ID linkage | **WOS stores mirror** | `maintainx_id`, `maintainx_sequential_id` |
| MaintainX status in UI | **MaintainX (live or cached fetch)** | Legacy archive: client fetch; Hub: mirror + optional refresh API |
| WOS queue status after handoff | **WOS** (may be stale) | Not auto-synced from MX |
| Machine-triggered WO creation | **Ignition (external)** | Input only; **no repo adapter** |
| Final execution close truth | **MaintainX** | WOS `closed`/`completed` requires explicit policy + future sync |
| Automation side effects | **n8n (optional)** | Webhooks; not lifecycle SoR |

### 4.3 Lifecycle diagram (conceptual)

```text
[Intake: WOS or Legacy or Ignition*]
        │
        ▼
[WOS pre-handoff workflow]  ←── SoR: WOS (status, steps, docs, notifications)
        │
        │ send_to_maintainx / legacy MX POST
        ▼
[MaintainX execution]       ←── SoR: MaintainX (field status)
        │
        │ on-demand fetch only (today)
        ▼
[WOS mirror fields]         ←── maintainx_status, maintainx_synced_at (not trusted as SoR)

* Ignition not connected in repo
```

---

## 5. State drift scenarios

### 5.1 Scenario matrix

| Scenario | Typical cause | Current behavior | User-visible symptom |
|----------|---------------|------------------|----------------------|
| WOS open, MX closed | No sync-back after MX completion | Drift until manual fetch | Hub queue shows in progress; MX app shows done |
| MX updated, WOS unaware | No webhook/poll | Stale `maintainx_status` | Hub pill shows old MX status |
| Legacy archive closed, hub open | Mirror at submit only; no ongoing sync | Archive badge fresh; hub stale | Different tabs disagree |
| MX WO exists, no WOS record | MaintainX-first without mirror success | Hub blind | WO only in archive/MX |
| WOS record, no MX link | Handoff failed (`failed_sync`) | `failed_sync` status | “MaintainX — not linked” pill |
| Two WOs for one intent | MX-first + hub create without link | Duplicate records | Two IDs, no merge |
| Ignition creates WO, WOS empty | No ingestion | No hub row | Operations hub queue missing item |
| Inbound email on request | WOS-24 | Comment added | Does not update MX status |

### 5.2 Known implementation gaps (honest)

1. **`fetchMaintainXStatus` does not map MX closed → WOS closed.** When MaintainX status matches `/complete|done|closed/i`, code transitions WOS to `maintainx_in_progress` — not `completed` or `closed`. This reinforces that **automated reconciliation is incomplete/immature**.

2. **Legacy archive status is UI-cache only** — not written back to Postgres hub on prefetch.

3. **Hub mirror from archive is non-blocking** — `mirrorArchiveToHub` failure leaves archive without `hubRequestId`.

4. **No Ignition path** — organizational risk if operators assume SCADA triggers appear in hub.

---

## 6. Recommended v1 behavior for drift

Until reconciliation (future card) ships:

| Situation | Recommended behavior |
|-----------|------------------------|
| Display hub request with `maintainx_id` | Show **both** WOS `status` and **MaintainX mirror** with `maintainx_synced_at` freshness |
| User needs current MX state | Offer **“Refresh MaintainX status”** (existing status API); do not auto-close WOS |
| WOS vs MX disagree | Show non-blocking **drift indicator**; do not silently overwrite WOS workflow state |
| `failed_sync` | Keep in queue; allow retry handoff |
| Ignition-only WO | Treat as out of scope for hub queue until ingested; document ops runbook |
| Plain email reply | Comment only (WOS-24); never complete MX or WOS steps |

**Do not** implement auto-close of WOS requests based on MaintainX status in v1 without explicit product sign-off and corrected status mapping.

---

## 7. What WOS should display to users

### Hub request detail (v1 UX guidance)

1. **WOS status** — primary badge for queue/workflow (“In review”, “Sent to MaintainX”, etc.)
2. **MaintainX section** (when `maintainx_id` present):
   - MX WO# (`maintainx_sequential_id`)
   - **Mirrored** MX status + “Last synced: …” from `maintainx_synced_at`
   - Link to MaintainX app
   - **Refresh** control calling status API
3. **Drift hint** when mirror age > threshold (e.g., 24h) or known mismatch pattern
4. **Creation source** when available: `archive_kind` / “Created via legacy work order tab” vs “Hub request”
5. **Do not** imply hub `status` equals MX execution state after handoff

### Queue/list views

- Filter/aging may use WOS `status` (current `aging.js` uses `sent_to_maintainx`, `maintainx_in_progress`, `failed_sync`)
- Optionally surface “MX link missing” for `work_order` types

---

## 8. Audit / integration events (existing + recommended future)

### Existing (use for forensics)

- `status_history` — WOS status transitions
- `audit_events` — workflow, notifications, inbound email
- `integration_events` — handoff and MX status change (on fetch)
- n8n webhook payloads (if env URLs configured)

### Recommended future (not implemented)

| Event | Purpose |
|-------|---------|
| `maintainx.sync_started` / `maintainx.sync_completed` | Reconciliation runs |
| `maintainx.drift_detected` | WOS vs MX mismatch logged |
| `maintainx.webhook_received` | Push updates from MX |
| `ignition.work_order.received` | Ingestion adapter |
| `work_order.reconciled` | Manual or auto resolution |

---

## 9. What is deferred

| Item | Rationale |
|------|-----------|
| Full WO lifecycle SoR in WOS | Requires sync-back + conflict rules |
| MaintainX webhook handler | Not in repo; provider-specific |
| Scheduled MX polling / reconciliation job | WOS-26 territory |
| Ignition/MQTT adapter | No code; separate integration project |
| Auto-close WOS from MX status | Current mapping immature; policy risk |
| Merge duplicate WO records across surfaces | Needs identity model (`maintainx_id` as join key) |
| README architecture doc | Root `README.md` is empty — should be updated separately |

---

## 10. Follow-up cards

| Card | Purpose |
|------|---------|
| **WOS-26 Formalize Outbox and Scheduler Architecture** | Scheduled MX poll, retry handoff, integration event outbox, idempotent workers |
| **WOS-27 Define Signature Legal Scope and UI Language** | Signature vs email-reply vs MX completion boundaries |
| **WOS-28 Add Rejection and Rework Loop v1 Behavior** | WOS-side rework without breaking MX execution ownership |
| **WOS-29 Internal Production Readiness Review** | Drift UX, runbooks, env checklist, leadership demo scope |
| **WOS-30 MaintainX Sync-Back & Reconciliation v1** *(suggested)* | Webhook or poll, map MX terminal states → WOS, drift dashboard |
| **WOS-31 Ignition Work Order Ingestion Adapter** *(suggested)* | MQTT/webhook → hub request or MX handoff with idempotency |

---

## 11. Internal production readiness scope (clarified)

**In scope for “hub Postgres ready” (WOS-19–24):**

- Hub intake/workflow persistence
- Outbound notifications
- Inbound email as comments
- MaintainX handoff API (one-shot create + manual status fetch)

**Not in scope until follow-up cards:**

- Single unified work order lifecycle across WOS + MaintainX + Ignition
- Trustworthy execution status in hub without refresh
- Ignition visibility in hub
- Automatic drift resolution

**Leadership/demo guidance:** Present WOS as the **operations workflow and intake hub**, and MaintainX as **field execution**. Do not demo hub queue status as equivalent to MaintainX completion state without clicking refresh or opening MX.

---

## 12. Decision record

| Decision | Choice | Status |
|----------|--------|--------|
| WOS is full WO system of record | **Rejected for v1** | Execution phase owned by MaintainX |
| WOS owns intake + workflow pre-handoff | **Accepted** | Matches code + constants |
| MaintainX owns post-handoff execution | **Accepted** | Matches archive + integration design |
| WOS mirror fields are informational | **Accepted** | Until sync-back |
| Ignition is input-only until adapter | **Accepted** | No repo implementation |
| Reconciliation is separate future work | **Accepted** | Required before unified lifecycle claims |

---

## 13. References (code inspected)

| Area | Location |
|------|----------|
| Hub/MaintainX ownership comment | `api/lib/hub/constants.js` |
| MaintainX handoff | `api/lib/hub/integrations.js` |
| Legacy → hub mirror | `api/lib/hub/bridge.js` |
| Archive + live MX status comment | `api/maintainx.js` (~916–923) |
| Legacy WO submit (MX-first) | `index.html` (work order / parts handlers) |
| Hub routes (MX integration) | `api/lib/hub/routes.js` |
| Request status enum | `api/lib/hub/constants.js` `REQUEST_STATUSES` |
| Postgres mirror columns | `api/lib/hub/db/postgres.js` |
| Aging / MX attention | `api/lib/hub/aging.js` |

---

## Recommendation

**Approve WOS-25** as the formal architecture decision for v1: **split source of truth by phase and domain**, with WOS as workflow/intake SoR and MaintainX as execution SoR after handoff. **Do not** mark the platform as having unified work order lifecycle ownership until **WOS-30 (reconciliation)** and optionally **WOS-31 (Ignition ingestion)** are complete.

**WOS-25 ready for Under review** as a documentation deliverable (no code behavior changed).
