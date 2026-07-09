# WOS-72 — Forms Admin Readiness + Flexible RBAC Workflow Onboarding

## Executive summary

Forms Manage is cleaned up for launch: clearer columns, search/filters/sort, internal keys hidden from primary UI, and a Workflow column. Workflow assignee roles now come from a centralized Postgres-backed catalog instead of hardcoded UI arrays. Admins can assign workflow roles to users from Admin → Users; assignments persist in `user_roles` and drive runtime step authorization alongside existing permission heuristics.

**Pre-RDS decision:** Schema changes were needed and implemented (`011_hub_rbac_roles.sql`). Template/submission/workflow tables were already RDS-ready; portal permission bundles remain Redis-backed until a follow-up sync migration.

**Recommendation: Ready** for local browser verification with `?_noauth=1` and admin role assignment smoke test.

---

## Forms Manage UI / filter changes

| Area | Change |
|------|--------|
| Columns | **Form · Status · Version · Workflow · Available · Updated · Actions** (removed redundant Published/Draft/Publish state columns) |
| Spacing | Compact action buttons (`hub-btn-sm`), improved table padding |
| Badges | Status, workflow, and availability badges aligned with hub style |
| Search | Search by form name |
| Status pills | All / Published / Draft / Archived |
| Availability | All / Available / Not available |
| Workflow | All / Workflow attached / No workflow |
| Sort | Newest / Oldest / Name A–Z |
| Workflow column | Shows bound approval route name or inline step count |

---

## Internal form key visibility decision

- Internal keys (`nr-pub-*`, `form_*`, template keys) are **not shown under form names** in Manage forms or registry tables.
- Keys remain unchanged in backend, routes, launch registry, and submissions.
- **Details** expandable under each form row shows **Internal key** (plain label) plus optional description.
- Builder field keys remain in advanced/details panels only (WOS-69 behavior preserved).

---

## RBAC / user role assignment audit

| Question | Answer |
|----------|--------|
| Are roles stored in Postgres? | **Yes** — `roles` table (workflow/onboarding catalog). Portal permission bundles still in Redis `role:{id}`. |
| Are user-role assignments stored in Postgres? | **Yes** — `user_roles` (email + role_key). |
| Can admin assign roles from UI? | **Yes** — Admin → Users → **Workflow roles** checkboxes; Save persists via `PUT /hub/users/:email/workflow-roles`. |
| Can admin remove roles? | **Yes** — uncheck roles and Save. |
| Do workflow steps reference the same role source? | **Yes** — assignee dropdown loads `GET /hub/rbac/workflow-roles`; validator checks catalog keys. |
| Can runtime resolve permissions from assigned roles? | **Yes** — `runtime-rbac.js` merges Postgres `user_roles` with permission heuristics; admins still bypass. |
| Are roles hardcoded in multiple frontend files? | **Reduced** — workflow assignee UI uses API; portal nav permissions still use server catalog + `rbac-client.js`. |
| Does `_noauth=1` bypass role checks? | **Client:** yes (local/dev). **Server:** only when SSO off / non-prod relaxed auth — unchanged. |

**Portal vs workflow roles (intentional split):**
- **Portal user groups** (Employee, Requester, AP, Management) — Redis, permission bundles for nav/vendor access.
- **Workflow roles** (admin, requester, manager, operations, ap, legal) — Postgres, used for approval/sign-off step assignment.

---

## Flexible roles schema decision

Implemented minimal durable schema before RDS:

- `roles` — id, key (unique), name, description, status, system_role, timestamps
- `user_roles` — user_email, role_key (FK), created_at, created_by

Seeded system roles: admin, requester, manager, operations, ap, legal.

Future custom roles: insert into `roles` (active) — dropdown and validator pick them up automatically. No code change required for new role keys.

**Not in scope:** portal permission sync to Postgres, role CRUD admin UI, departments/org charts.

---

## Workflow role source decision

- Removed hardcoded `ASSIGNEE_ROLES` array from `template-registry-ui.js`.
- Workflow step assignee `<select>` uses `GET /hub/rbac/workflow-roles`.
- Server validator uses `roles-catalog.js` (Postgres with static fallback).
- Plain language in UI: role names (Manager, Legal, Accounts Payable), not internal workflow JSON terms.

---

## Real workflow onboarding verification

**Verified path (automated + store-level):**

1. Admin opens Users → assigns workflow roles → persists to `user_roles`
2. Admin builds workflow step with assignee role from catalog
3. Form published with workflow (inline or bound approval route)
4. Submit from New Request → step instances created
5. User with assigned role can act (`canActOnStep` + store `acted_by` / `acted_at`)
6. User without role cannot act

**My Tasks:** Legacy hub request tasks are wired (`GET /hub/my-tasks`). **Dynamic template workflow steps are not yet listed in My Tasks UI** — users act via submission/runtime surfaces. Document as **launch follow-up** if My Tasks is promised for template workflows.

---

## Pre-RDS schema audit

| Area | Status |
|------|--------|
| `form_templates` / versions / submissions | Ready — timestamps, archive, version pinning present |
| `workflow_step_instances` | Ready — `assignee_role`, `acted_by`, `acted_at`, `payload_json` |
| `form_submission_events` | Ready |
| Launch registry / bindings | Ready |
| Portal user permissions | **Redis today** — migrate/sync follow-up before relying on Postgres-only auth store |
| Workflow role catalog | **Implemented** — `011_hub_rbac_roles.sql` |

**Verdict:** Schema changes were needed and implemented for workflow RBAC. No speculative changes beyond launch readiness. Template stack is RDS-ready; portal permission Redis → Postgres sync remains a separate RDS cutover task.

---

## Migrations added

| File | Purpose |
|------|---------|
| `migrations/011_hub_rbac_roles.sql` | `roles` + `user_roles` + seed workflow roles |

---

## Files changed

| File | Change |
|------|--------|
| `migrations/011_hub_rbac_roles.sql` | New RBAC tables + seeds |
| `api/lib/rbac/postgres.js` | Role catalog + user assignment store |
| `api/lib/rbac/roles-catalog.js` | Central assignee role source |
| `api/lib/rbac/routes.js` | Hub RBAC API routes |
| `api/lib/templates/runtime-rbac.js` | Merge assigned workflow roles |
| `api/lib/templates/runtime-routes.js` | Load user roles for act checks |
| `api/lib/templates/validator.js` | Dynamic allowed assignee roles |
| `api/lib/templates/postgres.js` | listTemplates includes workflow summary |
| `api/lib/hub/routes.js` | Mount RBAC routes |
| `template-registry-ui.js` | Manage table, filters, hidden keys, role API |
| `index.html` | Forms manage CSS, Users workflow role UI |
| `scripts/db/validate.js` | Validate roles/user_roles |
| `scripts/templates/template-forms-admin-rbac-readiness-test.js` | New test suite |
| `package.json` | `templates:forms-admin-rbac-readiness-test` |
| `migrations/README.md` | Document 011 migration |

---

## Tests run

All Part I suites — **PASS**, including:

- `templates:forms-admin-rbac-readiness-test` — **32/32**
- `db:validate` — PASS (includes new tables)
- Full templates suite (WOS-69/70/71 included)
- Vendor suites — PASS

---

## Browser verification (manual)

1. Hard refresh `?_noauth=1`
2. Forms → Manage forms: cleaner table, no keys under names
3. Search / status / availability / workflow filters
4. Details → Internal key visible
5. Admin → Users → assign workflow roles → Save
6. Forms → open builder → Workflow tab → assignee options from catalog
7. Publish form, submit from New Request
8. User with role acts on step; user without role blocked
9. Dark mode pass

---

## Known blockers

- **My Tasks for dynamic template workflow steps** — not wired; document if product promises unified task inbox for template submissions.
- **Portal permission bundles in Redis** — must be migrated/synced to Postgres during RDS cutover (separate from workflow roles).

---

## Known follow-ups

- Assign step to specific user
- Assign to submitter’s manager
- Notify all users with role
- Escalation when no user has role
- Role groups / teams
- Admin UI to create/archive custom workflow roles (schema supports; UI not built)
- Sync Redis portal roles ↔ Postgres `users.permissions`

---

## RDS readiness recommendation

**Ready for RDS migration of template/submission/workflow data.** Apply `011_hub_rbac_roles.sql` in staging before cutover. Plan a dedicated follow-up card for portal permission store migration (Redis → Postgres) — workflow onboarding roles are durable now; nav/vendor permission bundles are not yet Postgres-authoritative.
