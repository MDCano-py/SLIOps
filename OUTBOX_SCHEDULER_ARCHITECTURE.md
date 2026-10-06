# WOS-31 Outbox and Scheduler Architecture

**Date:** 2026-05-26  
**Status:** Proposed (design only)  
**Scope:** Durable outbox + scheduler/job runner for WOS Hub side effects  
**Code changes:** None  
**Schema changes:** None (recommendations only)

---

## Executive summary

WOS Hub today performs most **notification, email, and n8n webhook** side effects **inline** during request/document/workflow HTTP handlers. That pattern is acceptable for local validation (WOS-19–24) but is a **production readiness gap** for WOS-29: transient provider failures are logged but not reliably retried, and request save latency includes external I/O.

**Recommendation:** Adopt a **Postgres-backed outbox** with a **lightweight polling worker** (no new dependency in v1). Use a **hybrid model**:

1. **Phase 1 (v1 internal production):** Extend `integration_events` as the **external integration outbox** (n8n webhooks, inbound email processing records, future Ignition ingest acknowledgements).
2. **Phase 2 (WOS-35+):** Add a dedicated **`outbox_events`** table for **internal delivery** (email send, notification email retry, scheduled hub jobs) so integration logs and delivery queue are not conflated.

**Scheduler:** Single Node worker process polling Postgres with `FOR UPDATE SKIP LOCKED` — not ad-hoc cron scripts calling business logic directly. Cron may **invoke** the worker heartbeat in deployment, but logic lives in one runner.

**Do not implement in WOS-31.** This document is the blueprint for WOS-35–WOS-40 and informs WOS-29 readiness.

**Related decisions:** [WORK_ORDER_SOURCE_OF_TRUTH_DECISION.md](./WORK_ORDER_SOURCE_OF_TRUTH_DECISION.md) — MaintainX execution SoR after handoff; sync-back deferred to **WOS-33**; Ignition ingestion deferred to **WOS-34**.

---

## 1. Current side-effect map

### 1.1 Inline during HTTP / workflow handlers

| Side effect | Trigger locations | Persistence today | External I/O |
|-------------|-------------------|-------------------|--------------|
| **In-app notification** | `assignment-notifications.js`, `review-notifications.js`, `signature-notifications.js`, `inbound-email/processor.js`, legacy `documents.notifyRecipient()` | `notifications` (Postgres upsert by deterministic id) | None |
| **Assignment/review/signature email** | Same notification modules → `send-email.js` | Audit: `*_notification_queued`, `*_email_sent`, `*_email_failed` | Resend HTTP (optional) / console log |
| **Inbound email comment + notify** | `POST /hub/inbound-email` → `processInboundEmail()` | `comments`, `notifications`, `audit_events`, `integration_events` | None (normalized JSON ingest) |
| **n8n webhooks** | `queueN8nEvent()` from `workflow.js`, `routes.js`, `documents.js`, `bridge.js` | `integration_events` + Redis dedupe key | n8n HTTP POST (inline after insert) |
| **MaintainX WO create** | `createWorkOrderInMaintainX()` via hub integration route | Request patch + status transition | MaintainX API (**synchronous; not outboxed**) |
| **MaintainX status fetch** | `fetchMaintainXStatus()` on admin/API call | Mirror fields on request | MaintainX API GET (on demand) |
| **Audit events** | All notification modules, workflow, documents, inbound | `audit_events` | None |
| **Status history** | `transitionRequestStatus()` | `status_history` | None |
| **Action link creation** | `maybeCreateActionLink()`, routes POST action-links | `action_links` | None |
| **Legacy notifyRecipient n8n** | `documents.notifyRecipient()` | `notifications` + `integration_events` (`notification.created`) | n8n inline |

### 1.2 Partial outbox already exists

`integration_events` (Postgres) is **inserted before** n8n dispatch in `queueN8nEvent()`, with manual admin retry via:

- `POST /hub/integrations/automation/retry`
- `POST /hub/integrations/n8n/retry`
- `retryPendingIntegrationEvents()` in `integrations.js`

Statuses used today: `pending`, `sent`, `failed`, `retrying`.

WOS-24 inbound email uses `integration_events` with terminal statuses: `processed`, `unmatched`, `ambiguous`, `invalid_token`, `duplicate`, `failed`, `received` — **overloading the same table** for non-webhook lifecycle.

### 1.3 What is NOT outboxed today

| Concern | Gap |
|---------|-----|
| Email send (WOS-21–23) | Inline `sendEmail()`; failure writes audit only — **no retry queue** |
| In-app notification | Inline but durable (Postgres); acceptable |
| n8n webhook | Row persisted, but **dispatch is inline** in same call stack as `queueN8nEvent` |
| MaintainX handoff | **Fully synchronous** in API handler |
| Due reminders (review/signature) | **Not implemented** (aging config exists; no scheduler) |
| Action link expiry cleanup | Checked at use time only; **no janitor job** |
| MaintainX sync-back poll | **Not implemented** (WOS-33) |
| Ignition ingest replay | **Not implemented** (WOS-34) |

---

## 2. Current inline risks (production)

| Risk | Impact | Severity |
|------|--------|----------|
| Email/provider latency in request path | Slow PATCH/POST; timeouts under load | Medium |
| Email failure after in-app notification created | User sees notification but no email; **no auto-retry** | High |
| n8n inline dispatch failure | Row marked `failed`; retry only if admin clicks retry or script runs | Medium |
| Redis n8n dedupe + Postgres events split-brain | Dedupe in Redis; events in Postgres — worker restart can confuse state | Medium |
| `integration_events` semantic overload | Same table for n8n webhooks, inbound email, future jobs | Medium (operational) |
| No `next_attempt_at` / backoff | Retries are manual or immediate batch | High |
| No worker locking | Concurrent API + retry could double-dispatch | Low–Medium |
| MaintainX handoff inline | User waits for MX API; failure blocks response (by design today) | Medium (unchanged in WOS-31) |

**Mitigation already in place (keep):**

- Notification modules **never throw** into save paths (WOS-21–23).
- Deterministic notification IDs + audit dedupe prevent duplicate in-app rows.
- In-app notification created **before** email attempt (correct ordering for UX).

---

## 3. Recommended outbox model

### 3.1 Decision: Hybrid Option A → B

| Phase | Table | Purpose |
|-------|-------|---------|
| **v1 (WOS-35–37)** | **`integration_events`** (extended) | External integrations: n8n webhooks, inbound email audit trail, WOS-34 ingest receipts |
| **v2 (WOS-35+)** | **`outbox_events`** (new) | Internal async delivery: email send jobs, scheduled reminders, MX poll tasks, Ignition replay |

**Why not Option A only?**

- `integration_events` already stores **terminal business outcomes** (`processed`, `unmatched`) for inbound email — not just “messages to deliver.”
- Email delivery needs **`next_attempt_at`**, **`processing` lock**, and **`dead_lettered`** without polluting integration audit semantics.
- WOS-33 MX sync-back jobs are **scheduled polls**, not integration webhooks.

**Why not Option B only immediately?**

- n8n path already writes `integration_events`; migrating all callers at once is high churn.
- v1 can **stop inline n8n dispatch** using existing table + minimal columns.

### 3.2 `integration_events` v1 extensions (WOS-35)

Add columns via migration (safe, nullable defaults):

| Column | Type | Purpose |
|--------|------|---------|
| `next_attempt_at` | TIMESTAMPTZ NULL | Backoff scheduling |
| `processed_at` | TIMESTAMPTZ NULL | Alias/generalize `sent_at` for non-webhook events |
| `updated_at` | TIMESTAMPTZ NULL | Worker bookkeeping |
| `locked_at` | TIMESTAMPTZ NULL | Claim timestamp |
| `locked_by` | TEXT NULL | Worker instance id |

Keep existing: `event_type`, `status`, `payload`, `attempts`, `dedupe_key`, `last_error`, `created_at`, `sent_at`.

**Do not** add these in WOS-31 — document only.

### 3.3 Proposed `outbox_events` (WOS-35, Phase 2)

| Column | Purpose |
|--------|---------|
| `id` UUID PK | |
| `event_type` TEXT | e.g. `email.send`, `notification.email_retry`, `job.review_due_reminder` |
| `aggregate_type` TEXT | `request`, `notification`, `workflow_step`, `system` |
| `aggregate_id` UUID NULL | |
| `payload` JSONB | Safe delivery payload (no secrets) |
| `status` TEXT | Lifecycle (§5) |
| `attempts` INT | |
| `max_attempts` INT DEFAULT 8 | |
| `next_attempt_at` TIMESTAMPTZ | |
| `dedupe_key` TEXT UNIQUE NULL | |
| `last_error` TEXT NULL | |
| `locked_at`, `locked_by` | Worker claim |
| `created_at`, `updated_at`, `processed_at` | |

---

## 4. Recommended scheduler / job runner model

### 4.1 Mechanism selection

| Option | Verdict |
|--------|---------|
| **Lightweight Postgres polling worker (recommended v1)** | ✅ Minimal deps; fits existing `pg` stack; works on EC2/PM2 |
| **pg-boss** | ✅ Good for v2 if job volume/complexity grows; adds dependency + ops learning |
| **Raw cron scripts with embedded logic** | ❌ Avoid — use cron only to **start** or **healthcheck** the worker |
| **Vercel cron hitting API routes** | ⚠️ OK for **single-shot** retry endpoint short-term; not primary architecture |

### 4.2 Worker process architecture

```text
┌─────────────────────────────────────────────────────────┐
│  Hub API (existing)                                      │
│  - Writes domain state (request, workflow, notification) │
│  - Enqueues outbox/integration_events (future: no inline send) │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│  Postgres                                                │
│  integration_events │ outbox_events (phase 2)            │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│  hub-worker (new process, WOS-37)                        │
│  - Poll loop: claim batch (SKIP LOCKED)                  │
│  - Handlers by event_type                                │
│  - Exponential backoff + dead letter                     │
│  - Metrics/logs; no user-facing secrets                  │
└─────────────────────────────────────────────────────────┘
```

**Deployment:** `node scripts/worker/hub-outbox-worker.js` under PM2 alongside `production-server.js`, or dedicated small EC2 service.

**Environment:**

- `HUB_WORKER_ENABLED=true`
- `HUB_WORKER_POLL_INTERVAL_MS=5000`
- `HUB_WORKER_BATCH_SIZE=20`
- `DATABASE_URL` (same Postgres as hub)

---

## 5. Event status lifecycle

### 5.1 Standard statuses (both tables)

| Status | Meaning |
|--------|---------|
| `pending` | Queued; eligible when `next_attempt_at <= now()` |
| `processing` | Claimed by worker (`locked_at` set) |
| `processed` | Successfully delivered / job completed |
| `retrying` | Attempt failed; will retry (maps to `pending` + future `next_attempt_at` in v1 cleanup) |
| `failed` | Retries exhausted or non-retryable error |
| `dead_lettered` | Admin review required; no auto retry |
| `cancelled` | Superseded or intentionally aborted |

### 5.2 Legacy mapping

| Current `integration_events.status` | Target |
|-----------------------------------|--------|
| `sent` | `processed` (keep `sent` as alias during migration) |
| `pending` | `pending` |
| `retrying` | `retrying` → worker sets `next_attempt_at` |
| `failed` | `failed` or `dead_lettered` after max attempts |
| Inbound: `processed`, `unmatched`, etc. | **Terminal audit states** — do not retry; not worker delivery queue |

### 5.3 State diagram (delivery events)

```text
pending → processing → processed
              ↓
           retrying → pending (after backoff)
              ↓
            failed → dead_lettered (max attempts)
```

---

## 6. Retry rules

### 6.1 Default policy

| Parameter | Value |
|-----------|-------|
| Max attempts | 8 |
| Backoff | Exponential: 30s, 2m, 5m, 15m, 1h, 4h, 12h, 24h |
| Jitter | ±10% on `next_attempt_at` |
| Retryable errors | Network timeout, HTTP 429, 5xx |
| Non-retryable | 4xx (except 429), invalid recipient, validation errors |
| Idempotency | `dedupe_key` UNIQUE + handler must be safe on replay |

### 6.2 By event category

| Category | Max attempts | Notes |
|----------|--------------|-------|
| n8n webhook | 8 | Preserve Redis dedupe until worker confirms `processed` |
| Email send | 6 | After failure, in-app notification already exists |
| Inbound email processing | 1 | Synchronous ingest; terminal status on outcome |
| MX sync-back poll (WOS-33) | 5 per run | Scheduled; per-request job rows |
| Ignition ingest (WOS-34) | 8 | Dedupe on external message id |
| Due reminders | 3 | Skip if step/request no longer actionable |

### 6.3 MaintainX handoff (unchanged)

**Do not** move `createWorkOrderInMaintainX` to outbox in v1 without product sign-off — current synchronous behavior stays per WOS-31 scope. WOS-33 addresses **post-handoff sync-back polling**, not create.

---

## 7. Idempotency and dedupe rules

### 7.1 Existing patterns (preserve)

| Domain | Dedupe mechanism |
|--------|------------------|
| WOS-21–23 notifications | Audit `*_notification_queued` + deterministic notification id from dedupe key hash |
| n8n | Redis `hub:n8n:dedupe:{key}` + `integration_events.dedupe_key` |
| WOS-24 inbound | `integration_events.dedupe_key` = `inbound:{provider}:{message_id}` |
| Notifications Postgres | `ON CONFLICT (id) DO UPDATE` on deterministic uuid |

### 7.2 Outbox rules (new)

1. **Enqueue:** `INSERT ... ON CONFLICT (dedupe_key) DO NOTHING` or return existing row.
2. **Worker:** Before side effect, re-check domain state (e.g. step still assigned to recipient).
3. **Email retry:** Dedupe key = `{type}:email:{notification_dedupe_key}` — do not resend if audit shows `*_email_sent`.
4. **n8n:** Do not dispatch if Redis dedupe flag set **unless** event status is `failed` and admin forces replay.

---

## 8. Worker locking strategy

Use Postgres row locks in worker poll query:

```sql
UPDATE integration_events
SET status = 'processing', locked_at = now(), locked_by = $worker_id, updated_at = now()
WHERE id IN (
  SELECT id FROM integration_events
  WHERE status IN ('pending', 'retrying')
    AND (next_attempt_at IS NULL OR next_attempt_at <= now())
  ORDER BY created_at
  LIMIT $batch
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

**Stale lock recovery:** If `locked_at < now() - interval '10 minutes'` and status = `processing`, reset to `retrying` (orphaned worker).

**Single writer per row:** `SKIP LOCKED` allows horizontal worker scale later; start with one worker instance on staging.

---

## 9. Minimum v1 job list (internal production)

Jobs required **before WOS-29 production readiness sign-off:**

| # | Job | Handler | Table (v1) | Priority |
|---|-----|---------|------------|----------|
| 1 | **Integration / n8n delivery worker** | Replace inline `dispatchN8nWebhook` in `queueN8nEvent` with enqueue-only; worker dispatches | `integration_events` | **P0** |
| 2 | **Email delivery retry worker** | Retry failed assignment/review/signature/inbound emails where audit shows `*_email_failed` and no `*_email_sent` | `outbox_events` (or audit-scan initially) | **P0** |
| 3 | **Stale lock / orphan recovery** | Reset stuck `processing` rows | Both | **P0** |
| 4 | **Integration retry sweep** | Generalize existing `retryPendingIntegrationEvents` into worker loop | `integration_events` | **P0** (partial exists) |

**Minimum v1 implementation cards:** WOS-35, WOS-36, WOS-37, WOS-40 (partial).

---

## 10. Deferred job list

| # | Job | Card | Depends on |
|---|-----|------|------------|
| 5 | Review due reminder | WOS-38 | Scheduler baseline, `due_at` on steps |
| 6 | Signature due reminder | WOS-38 | Same |
| 7 | Stale request / needs attention digest | New | Aging config (`aging.js`) |
| 8 | Action link expiry cleanup | WOS-39 | `action_links.expires_at` |
| 9 | MaintainX sync-back polling | **WOS-33** | Source-of-truth decision |
| 10 | Ignition ingestion retry/replay | **WOS-34** | External adapter |
| 11 | Audit/integration retention cleanup | New | Policy TBD |
| 12 | Notification.created n8n decouple | WOS-35 | Legacy `notifyRecipient` path |

---

## 11. Migration path from inline behavior

### Phase 0 — Today (WOS-19–24)

- Inline notifications + email + n8n dispatch
- Admin manual retry for n8n pending events

### Phase 1 — WOS-35 + WOS-37 (no user-visible change)

1. Add nullable columns to `integration_events`.
2. Change `queueN8nEvent` to **insert only** (status `pending`, `next_attempt_at = now()`).
3. Deploy `hub-worker` with n8n handler only.
4. Keep admin retry endpoint calling same handler.

### Phase 2 — WOS-36 + WOS-40

1. Create `outbox_events`.
2. Notification modules: after in-app + audit queued, enqueue `email.send` outbox row instead of inline `sendEmail`.
3. Email worker calls `send-email.js`; updates audit `*_email_sent` / `*_email_failed`.
4. Admin UI: pending/failed delivery counts on integrations status page.

### Phase 3 — WOS-38, WOS-39, WOS-33, WOS-34

- Scheduled jobs registered in worker with cron-like `next_attempt_at` scheduling stored in Postgres (not OS cron logic).

**Feature flag:** `HUB_OUTBOX_MODE=inline|enqueue` — default `inline` until worker proven on staging; flip to `enqueue` per environment.

---

## 12. Impact on WOS-21 through WOS-24

| Work item | Impact |
|-----------|--------|
| **WOS-21 Assignment notifications** | No test changes if `inline` mode preserved; enqueue mode moves email to worker — tests still pass with `EMAIL_NOTIFICATIONS_ENABLED=false` |
| **WOS-22 Review notifications** | Same |
| **WOS-23 Signature notifications** | Same; action link URL in email payload stored in outbox row |
| **WOS-24 Inbound email** | Already uses `integration_events`; worker should **exclude** terminal inbound statuses from delivery poll |
| **Dedupe/audit** | Unchanged; worker must respect existing audit keys |
| **Automated scripts** | Continue setting `SKIP_*_NOTIFICATIONS`; worker disabled in test via `HUB_WORKER_ENABLED=false` |

**Principle:** Request/document **writes stay synchronous**; only **delivery** becomes async.

---

## 13. Impact on WOS-33 (MaintainX sync-back)

Per [WORK_ORDER_SOURCE_OF_TRUTH_DECISION.md](./WORK_ORDER_SOURCE_OF_TRUTH_DECISION.md):

- MaintainX owns execution after handoff.
- WOS-33 will introduce **scheduled poll jobs** per linked request (`maintainx_id` present).

**Outbox design for WOS-33:**

| Job type | `event_type` | Schedule |
|----------|--------------|----------|
| `maintainx.sync_poll` | Single request refresh | Enqueued after handoff; then every N hours while not terminal |
| `maintainx.drift_detected` | Audit/integration log | Emitted when mirror ≠ policy (future) |

Worker handler calls existing `fetchMaintainXStatus()` logic — **read-only mirror update**, no auto-close until product rules defined.

**Not in v1 worker** — design hook only.

---

## 14. Impact on WOS-34 (Ignition ingestion)

Ignition/MQTT adapter (external) should:

1. Accept message → normalize payload (like WOS-24 inbound email pattern).
2. Enqueue `ignition.work_order.received` on `integration_events` or `outbox_events`.
3. Worker processes ingest with dedupe on `{source}:{message_id}`.
4. On failure → `retrying` with backoff; dead letter → admin replay UI.

**Replay job (WOS-34):** Admin selects dead-letter row → resets to `pending` — worker re-runs idempotent ingest.

Inbound email processor (`processInboundEmail`) is the **template** for idempotent ingest + integration event terminal states.

---

## 15. Admin observability requirements (WOS-40)

### 15.1 Metrics / dashboard (hub integrations status — extend existing)

Already exposed partially at `GET /hub/integrations/status`:

- `pending_automation_events` count

**Add for production:**

| Metric | Source |
|--------|--------|
| Pending delivery count | `integration_events` + `outbox_events` |
| Failed / dead letter count | Same |
| Oldest pending age | `min(created_at)` where pending |
| Email failures (24h) | Audit `*_email_failed` |
| Worker heartbeat | `hub_settings` key `worker:last_heartbeat` |
| Last successful poll | Per job type |

### 15.2 Admin actions

| Action | Endpoint (future) |
|--------|-------------------|
| Retry pending integrations | Exists: `POST /hub/integrations/automation/retry` |
| Retry failed emails | New: `POST /hub/integrations/email/retry` |
| Replay dead letter | New: `POST /hub/outbox/:id/replay` |
| Force MX sync for request | Exists: `GET /hub/integrations/maintainx/status/:id` |

### 15.3 User-facing surfacing

- **Do not** expose provider secrets or raw outbox payloads to clients.
- Request detail may show: “Email delivery pending” / “Notification delivered; email retry scheduled” for admins only.
- Drift indicators (WOS-33) separate from delivery failures.

---

## 16. Follow-up implementation cards

| Card | Title | Scope |
|------|-------|-------|
| **WOS-35** | Implement Outbox Event Standardization | Migration columns, `outbox_events` table, enqueue API, feature flag |
| **WOS-36** | Implement Notification Email Delivery Worker | Email handler, audit integration, retry |
| **WOS-37** | Implement Scheduler Baseline | `hub-outbox-worker.js`, PM2, locking, heartbeat |
| **WOS-38** | Add Review and Signature Due Reminder Jobs | Scheduled scans of `workflow_steps.due_at` |
| **WOS-39** | Add Action Link Expiry and Cleanup Job | Mark expired; optional audit |
| **WOS-40** | Add Admin Delivery Failure Visibility | Dashboard, retry endpoints, dead letter list |
| **WOS-33** | MaintainX Sync-Back Polling | Uses worker from WOS-37 |
| **WOS-34** | Ignition Ingestion Adapter | Uses ingest + replay pattern |
| **WOS-29** | Internal Production Readiness Review | Gate: WOS-35–37 + WOS-40 minimum |

---

## 17. Recommendation for WOS-29 internal production readiness

**WOS-29 should not pass** until at minimum:

1. ✅ Postgres persistence (WOS-19/20) — done  
2. ✅ Notification behavior defined (WOS-21–23) — done  
3. ✅ Inbound email idempotent ingest (WOS-24) — done  
4. ✅ Source-of-truth documented (WOS-25/30) — done  
5. ❌ **Outbox + worker for n8n and email retry (WOS-35–37, WOS-40)** — **required**  
6. ❌ Staging worker deployed with heartbeat monitoring  
7. ⚠️ MaintainX sync-back (WOS-33) — **recommended** before claiming execution visibility; may be parallel  
8. ⚠️ Ignition (WOS-34) — **not required** if Ignition not in staging scope  

**WOS-31 recommendation:** **Ready for Under review** as architecture/design deliverable.

**Production behavior:** Unchanged — no runtime files modified in WOS-31.

---

## Appendix A — Events that should become outbox events

| Current trigger | Proposed outbox `event_type` | Phase |
|-----------------|------------------------------|-------|
| `queueN8nEvent(*)` | Same string as today | Phase 1 — `integration_events` |
| Assignment/review/signature email | `email.send` with payload `{ channel, template, recipient, subject, dedupe_key, request_id }` | Phase 2 — `outbox_events` |
| `notification.created` webhook | `notification.created` | Phase 1 |
| Inbound email | `inbound_email` (terminal audit — not worker delivery) | Keep as today |
| Future review due | `job.review_due_reminder` | Phase 3 |
| Future signature due | `job.signature_due_reminder` | Phase 3 |
| Future MX poll | `maintainx.sync_poll` | WOS-33 |
| Future Ignition | `ignition.work_order.received` | WOS-34 |

## Appendix B — Answers to design questions

| # | Question | Answer |
|---|----------|--------|
| 1 | Inline side effects today? | See §1 |
| 2 | Which become outbox events? | Appendix A |
| 3 | Reuse `integration_events` or new table? | **Hybrid** — extend for external; add `outbox_events` for internal delivery |
| 4 | Statuses needed? | §5 |
| 5 | Retry behavior? | §6 |
| 6 | Scheduler mechanism? | **Postgres polling worker** (v1); pg-boss optional v2 |
| 7 | v1 internal production jobs? | §9 (4 jobs) |
| 8 | Deferred jobs? | §10 |
| 9 | Failure surfacing? | §15 |
| 10 | WOS-33 / WOS-34 interaction? | §13–14 |

---

## Validation record (WOS-31)

| Check | Result |
|-------|--------|
| Code changed | **No** |
| Schema changed | **No** |
| Production behavior changed | **No** |
| MaintainX / Entra touched | **No** |
| Tests run | **Not required** (documentation only) |

---

**Document owner:** WOS Platform  
**Next step:** WOS-35 (Outbox Event Standardization) after WOS-31 approval
