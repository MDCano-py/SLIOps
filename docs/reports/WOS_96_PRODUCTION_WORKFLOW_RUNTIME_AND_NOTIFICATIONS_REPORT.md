# WOS-96 — Production Workflow Runtime and In-App Task Notifications

## Executive summary

Configurable workflows now create real hub requests, pin published workflow versions on instances, resolve assignments against WOS users/RBAC roles, persist tasks, emit deduplicated in-app notifications, support atomic shared-role claims, and surface progress in My Tasks and Request Detail. Forms registry status badges are compact lifecycle labels (Published / Draft / Archived) aligned under the Status column.

## Branch

`wos-96-production-workflow-runtime-notifications`

## Commit

`6a3c6a9a2ba134ce12e929297e480b1b6e484498`

## Registry alignment fix

- Configuration Center Forms registry uses fixed columns: Form | Status | Updated | Actions
- Status badges use `width: fit-content` / `justify-self: start` (`.cfg-status-badge`)
- Labels use lifecycle state (`Published` / `Draft` / `Archived`) instead of raw `Active`
- Workspace Forms manage labels map `active` → published via `formManageStatusLabel`
- Global `.tmpl-badge` now keeps intrinsic width and nowrap

## User source

PostgreSQL `users` table (stable `id` UUID). Profile fields email/name retained as snapshots on tasks/notifications.

## Role source

`roles` + `user_roles` via `api/lib/rbac/postgres.js` (`getUserRoleKeys`). Assignment selectors continue to load `/hub/rbac/roles` and `/users`.

## Identity synchronization

Hub route context now includes `roleKeys` and `actorUserId` resolved from the signed-in session email. Entra/local login still upserts users through existing `/me` provisioning; no separate workflow-user directory.

## Runtime architecture

```text
New Request (published request type)
  → POST /hub/workflow-runtime/start-request-type
  → create hub request (version IDs in form_payload)
  → startWorkflowInstance (pins version_id)
  → advanceInstance
  → resolveAssignment → createHumanTask → notifyTaskAssigned
My Tasks / notification bell
  → listTasksForUser (user id + role keys)
  → claim (atomic) → complete → advance → next notify
Request Detail
  → GET /hub/workflow-runtime/instances/by-request/:id
```

Modules:

- `api/lib/configuration/runtime/resolve-assignment.js`
- `api/lib/configuration/runtime/task-notifications.js`
- `api/lib/configuration/runtime/engine.js` (extended)

## Workflow instance model

Existing `cfg_workflow_instances` plus migration 014 columns:

- `request_type_definition_id`, `request_type_version_id`, `form_template_id`, `form_version_id`, `started_by_user_id`
- Always stores `version_id` of the published workflow at start (not re-resolved to latest)

## Task model

`cfg_workflow_tasks` extended with title, instructions, assignment_mode, assigned_user_id, claimed_by_*, related_request_id, assignment_summary, fallback_applied; statuses include `claimed` / `in_progress`.

## Assignment resolver

Modes: specific_user, role_shared_queue, request_creator, request_creator_manager, user_from_form_field, previous_participant, client_representative, external_participant.

Fallbacks: pause_with_assignment_error, route_to_hub_admin, route_to_fallback_role, assign_to_request_creator.

`Requester` is not treated as an RBAC role; request creator is a separate mode.

## Shared-role claim behavior

```sql
UPDATE cfg_workflow_tasks
SET claimed_by_user_id = $user_id, status = 'claimed', ...
WHERE id = $task_id AND status = 'open' AND claimed_by_user_id IS NULL;
```

Stale `task_available_for_role` notifications are dismissed for other users.

## Notification model

Extends existing `notifications` table with recipient_user_id, cfg_workflow_task_id, cfg_workflow_instance_id, action_url, priority, dedupe_key, dismissed_at.

Dedupe examples:

- `task_assigned:{task_id}:{user_id}`
- `role_task_available:{task_id}:{user_id}`

## Real-time / polling strategy

Existing 60s notification polling retained (tab-friendly, no WebSocket platform). Unread badge caps at `9+`.

## Bell / My Tasks / Request Detail

- Bell shows unread count from server notifications; open marks read and routes to request
- My Tasks lists assigned + role-available cfg tasks; claim then complete via WOS modal
- Request Detail shows configurable execution timeline when an instance is linked

## Database migrations

`migrations/014_workflow_runtime_notifications.sql`

## APIs

| Method | Path |
|--------|------|
| POST | `/hub/workflow-runtime/start-request-type` |
| POST | `/hub/workflow-runtime/start` |
| GET | `/hub/workflow-runtime/instances/:id` |
| GET | `/hub/workflow-runtime/instances/by-request/:requestId` |
| GET | `/hub/workflow-runtime/tasks` |
| POST | `/hub/workflow-runtime/tasks/:id/claim` |
| POST | `/hub/workflow-runtime/tasks/:id/complete` |

## Authorization controls

- Task list scoped to assignee, claimer, or open role queue for caller’s role keys
- Complete/claim reject unauthorized actors (403)
- Claim race returns 409

## Idempotency controls

- Node execution idempotency keys unchanged
- Notification dedupe_key unique index
- Claim conditional update

## Tests

`npm run security:wos96-production-workflow-runtime-test`

Also regression: configurable-platform, unified-builders, wos95 designer tests.

## Production-like test results

Automated resolver/claim/route/UI wiring checks pass. Full multi-persona browser matrix against local Postgres should be run after applying migration 014 with seeded role users (operations, ap, hub_admin).

## Known limitations

- Email delivery still depends on Automation outbox; in-app path is primary
- SSE not added (polling retained)
- External participant secure-link UI is schema-ready (`cfg_external_participants`) but link delivery UI is minimal
- Timing/Visibility inspector tabs remain designer-side only
- Legacy BOL/JSA native dialogs outside this card remain

## Deployment instructions

1. Apply `014_workflow_runtime_notifications.sql` to RDS/Postgres
2. Deploy API + static assets with `CONFIGURABLE_PLATFORM_ENABLED=1`
3. Ensure production does not enable staging-only test-user injection
4. Publish request type + workflow with real role assignments
5. Verify New Request → My Tasks → bell for two different users

## Rollback instructions

Revert this branch. Migration 014 is additive (columns/tables); leaving columns in place is safe. Disable flag to hide Configuration Center / runtime routes if needed.
