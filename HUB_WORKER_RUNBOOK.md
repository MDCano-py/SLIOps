# Hub Worker Runbook (WOS-37)

Operations guide for the **streamline-hub-worker** process that delivers queued integration (n8n) and notification email events from Postgres outboxes.

---

## Overview

| Process | Role |
|---------|------|
| **Hub API** (`npm start` / PM2 `streamline-hub-api`) | HTTP handlers; enqueues events when `*_DISPATCH_MODE=queued` |
| **Hub worker** (`npm run hub-worker` / PM2 `streamline-hub-worker`) | Polls Postgres; claims and processes `integration_events` + `outbox_events` |

The API can run without the worker, but **queued events will not deliver** until the worker is running.

---

## Local development

### Prerequisites

- Postgres running with migrations applied (`npm run db:migrate`)
- `DATABASE_URL` set (see `.env.local.postgres`)

### Inline mode (default — no worker required)

```powershell
$env:DATABASE_URL="postgresql://streamline:streamline@127.0.0.1:5432/streamline_hub"
$env:HUB_STORE_MODE="postgres"
$env:INTEGRATION_DISPATCH_MODE="inline"
$env:EMAIL_DELIVERY_MODE="inline"
$env:EMAIL_NOTIFICATIONS_ENABLED="false"
```

### Queued mode + worker (matches staging)

**Terminal 1 — API**

```powershell
$env:INTEGRATION_DISPATCH_MODE="queued"
$env:EMAIL_DELIVERY_MODE="queued"
npm run dev
```

**Terminal 2 — Worker (continuous)**

```powershell
$env:DATABASE_URL="postgresql://streamline:streamline@127.0.0.1:5432/streamline_hub"
$env:HUB_STORE_MODE="postgres"
$env:INTEGRATION_DISPATCH_MODE="queued"
$env:EMAIL_DELIVERY_MODE="queued"
$env:EMAIL_NOTIFICATIONS_ENABLED="false"
npm run hub-worker
```

**Single tick (validation / debugging)**

```powershell
npm run hub-worker:once
# or
$env:HUB_WORKER_MODE="once"; npm run hub-worker
```

### Validation

```powershell
npm run hub-worker:test
```

---

## Staging environment variables

Set on **both API and worker** (worker does not need all API secrets):

| Variable | Staging value | Notes |
|----------|---------------|-------|
| `DATABASE_URL` | Postgres connection string | Same DB as API |
| `HUB_STORE_MODE` | `postgres` | Required |
| `INTEGRATION_DISPATCH_MODE` | `queued` | API enqueues n8n events only |
| `EMAIL_DELIVERY_MODE` | `queued` | API enqueues email only |
| `EMAIL_NOTIFICATIONS_ENABLED` | `true` | When using Resend |
| `RESEND_API_KEY` | (secret) | Worker + API |
| `EMAIL_FROM` | verified sender | |
| `N8N_WEBHOOK_*` | webhook URLs | Per event type or `N8N_WEBHOOK_DEFAULT` |

**Worker-only tuning:**

| Variable | Default | Purpose |
|----------|---------|---------|
| `HUB_WORKER_MODE` | `continuous` | `once` for single tick |
| `HUB_WORKER_POLL_INTERVAL_MS` | `5000` | Poll interval |
| `HUB_WORKER_BATCH_SIZE` | `10` | Events per queue per tick |
| `HUB_WORKER_ID` | auto-generated | Lock owner id in logs |
| `HUB_WORKER_ENABLE_INTEGRATIONS` | `true` | Process n8n queue |
| `HUB_WORKER_ENABLE_EMAIL` | `true` | Process email queue |
| `HUB_WORKER_ENABLE_STALE_LOCK_RECOVERY` | `true` | Recover stuck `processing` rows |
| `HUB_WORKER_STALE_LOCK_MS` | `300000` | 5 min stale threshold |
| `INTEGRATION_MAX_ATTEMPTS` | `8` | n8n dead-letter threshold |
| `EMAIL_DELIVERY_MAX_ATTEMPTS` | `8` | Email dead-letter threshold |

---

## PM2 deployment example

Keep **API and worker as separate processes** on the same host or worker-only on a small sidecar.

```javascript
// ecosystem.config.js (example — adjust paths)
module.exports = {
  apps: [
    {
      name: 'streamline-hub-api',
      script: 'scripts/production-server.js',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        HUB_STORE_MODE: 'postgres',
        INTEGRATION_DISPATCH_MODE: 'queued',
        EMAIL_DELIVERY_MODE: 'queued',
      },
    },
    {
      name: 'streamline-hub-worker',
      script: 'scripts/hub-worker.js',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        HUB_STORE_MODE: 'postgres',
        HUB_WORKER_MODE: 'continuous',
        HUB_WORKER_POLL_INTERVAL_MS: '5000',
        HUB_WORKER_BATCH_SIZE: '10',
        INTEGRATION_DISPATCH_MODE: 'queued',
        EMAIL_DELIVERY_MODE: 'queued',
      },
    },
  ],
};
```

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 logs streamline-hub-worker
```

**Restart worker safely:** `pm2 restart streamline-hub-worker` — in-flight claims may be recovered via stale lock release on next tick.

---

## Health / check commands

| Check | Command |
|-------|---------|
| API health | `npm run health` or `GET /health` |
| Pending integration events | SQL: `SELECT COUNT(*) FROM integration_events WHERE status IN ('pending','retrying') AND event_type <> 'inbound_email'` |
| Pending email deliveries | SQL: `SELECT COUNT(*) FROM outbox_events WHERE event_type='email.send' AND status IN ('pending','retrying')` |
| Dead letter review | SQL: `SELECT id, event_type, last_error FROM integration_events WHERE status='dead_lettered' UNION ALL SELECT id, event_type, last_error FROM outbox_events WHERE status='dead_lettered'` |
| Worker test | `npm run hub-worker:test` |
| Manual one-shot processing | `npm run hub-worker:once` |

Admin retry endpoints (existing): `POST /hub/integrations/n8n/retry` (hub admin) — supplements worker for integration backlog.

---

## Rollback to inline mode

If the worker misbehaves or staging is not ready:

1. **Stop worker:** `pm2 stop streamline-hub-worker`
2. **Set API env:**
   - `INTEGRATION_DISPATCH_MODE=inline`
   - `EMAIL_DELIVERY_MODE=inline`
3. **Restart API:** `pm2 restart streamline-hub-api`
4. **Drain or ignore pending rows** — inline API/admin retry can still process `integration_events`; email outbox rows need worker or manual re-queue (WOS-40 admin UI deferred)

Pending rows remain in Postgres and are **not lost**. Re-enable queued mode + worker when fixed.

---

## What the worker does NOT do (other cards)

| Feature | Card |
|---------|------|
| Admin failure dashboard | WOS-40 |
| Review/signature due reminders | WOS-38 |
| Action link expiry cleanup | WOS-39 |
| MaintainX sync-back | WOS-33 |
| Ignition ingestion | WOS-34 |

---

## Troubleshooting

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Emails never send on staging | Worker not running or `EMAIL_DELIVERY_MODE=inline` on API only | Start worker; align env on both processes |
| n8n events pile up | Missing webhook URLs or worker stopped | Check `N8N_WEBHOOK_*`; worker logs |
| Events stuck in `processing` | Worker crashed mid-tick | Wait for stale lock recovery or restart worker |
| `inbound_email` not delivering | By design | Terminal audit records — not worker queue |
