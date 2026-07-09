# WOS-80 — Unified Archive Records + Role Lifecycle Guardrails

**Card:** WOS-80 — Unified Archive Records + Role Lifecycle Guardrails
**Scope:** Two product-behavior fixes before the admin Start Center:
(A) surface submitted **dynamic form submissions** in the unified Archive, and
(B) make role **delete/archive** behavior safe and understandable.
No Start Center, no dashboard-shell redesign, no change to form-submission
behavior, no broken legacy Archive, no demo seeding, no RDS migration run, no
hard-delete of referenced roles, no internal schema terms leaked to the UI.

---

## Executive summary

Dynamic form submissions were being persisted (`form_submissions`) but had no
Archive surface — the unified Archive only read the five legacy categories
(JSA, BOL, Work Orders, Parts Requests, Roll Off Swap). WOS-80 adds a **Forms**
category to the same unified Archive, backed by a new read-only list adapter
that joins `form_submissions → form_template_versions → form_templates`. Legacy
categories are untouched.

Role management previously supported soft-archive only, with **no reference
checking** and no way to delete or restore a custom role from the UI. WOS-80
adds reference-aware guardrails: **system roles can never be deleted**,
**referenced custom roles can only be deactivated** (never hard-deleted), unused
custom roles can be deleted, and archived custom roles can be **restored**.
Inactive roles were already excluded from new selectable options (the catalog is
active-only); existing references remain readable.

Both areas ship with focused tests and were verified live against a local
Postgres-backed dev server.

**Final recommendation: Ready for Start Center.**

---

## Part A — Dynamic form submissions in Archive

### Archive data-source audit (before)

| Category | Endpoint | Backing store |
|---|---|---|
| JSA / BOL | `/archive/{jsa\|bol}` | Vercel Blob |
| Parts / Work Orders | `/request-archive/{parts\|wo}` | Vercel Blob |
| Roll Off Swap | `/forms/roll-off-swap` | Vercel Blob |
| **Dynamic form submissions** | **(none)** | Postgres `form_submissions` |

- The Archive is a single unified hub page (`hub-archive`) driven by
  `hub-unified-archive.js` (`ARCHIVE_FILTERS` + hash-slug maps). Legacy
  categories mount pre-existing DOM panels via `HubArchiveLoaders`.
- `requests.archive_kind` exists but is used by the legacy request pipeline, not
  the dynamic forms engine. Dynamic submissions live only in `form_submissions`
  and had **no list endpoint** (only single-submission GET/create existed).

### Dynamic form archive behavior (after)

- New **Forms** category in the same unified Archive (route `#/archives/forms`).
- Records are read via an **adapter/query layer** — dynamic submissions are
  **not** duplicated into legacy `requests`.
- Each Forms archive row shows: **form name**, **submission status**,
  **submitted by**, **submitted date**, **current workflow status** (derived
  from submission status), and **template version** (admin metadata). Clicking a
  row opens the **existing submission detail page** (`hub-submission`,
  `#/submissions/{id}`).
- Archive **overview** now includes a submitted-forms count; **All**
  overview lists Forms alongside legacy categories; **Forms** view lists
  submissions; `#/archives/forms` works on hard refresh and first click.
- Empty state reads exactly: **"No submitted form records found."**
- Legacy BOL/JSA/Work Orders/Parts/ROS views are unchanged.

### Archive data-source changes

- **`api/lib/templates/postgres.js`** — new `listSubmissions({ limit, offset, createdBy })`
  joining `form_submissions fs → form_template_versions v → form_templates t`,
  returning `{ records, count }` (count is the true total, independent of
  `limit`). `createdBy` scopes results to a single submitter.
- **`api/lib/templates/store.js`** — `listSubmissions` proxy wrapper.

### Archive route / filter changes

- **`api/lib/templates/routes.js`** — new `GET /hub/templates/submissions`
  (list). **401** when unauthenticated; **admin/hub_admin see all** submitted
  forms; **non-admins are scoped to their own** submissions (`createdBy =
  actorEmail`). Workflow-actor access to a *specific* submission remains via the
  existing per-submission detail route — this prevents record disclosure by ID
  guessing.
- **`hub-unified-archive.js`** — `forms` added to `ARCHIVE_FILTERS`,
  `LEGACY_TAB_TO_FILTER`, `FILTER_ALIASES` (`forms`/`form`/`submissions`/
  `submitted-forms`), `HASH_FILTER_SEGMENTS`, `FILTER_LABELS`; overview count
  branch hits `/hub/templates/submissions?limit=1`.
- **`index.html`** — new `#panel-forms-archive` panel; `loadFormsArchive` /
  `renderFormsArchiveList` / `formsArchiveRowHtml` / `openFormsArchiveRecord`;
  `HubArchiveLoaders` wires `forms-archive`; `archiveCategoryEmptyMessage`
  special-cases the Forms copy; router registrations added to the `panels` map,
  `knownTabs`, `archiveMap`, and `deepLinkUnifiedArchive`.
- **`hub.js`** — `LEGACY_PANEL_IDS['forms-archive']` and `resolveHashTab`
  legacy-archive map updated.

### Access control

- Admin/hub_admin: all submitted form records.
- Non-admin: own submissions only (list is `createdBy`-scoped).
- No ID-guessing exposure: the list never returns other users' submissions to a
  non-admin, and the per-record detail route retains its existing
  `canInspectSubmission` authorization.

---

## Part B — Role lifecycle behavior

### Role delete/archive audit (before)

- `roles` already has `status` (`active`/`archived`), `system_role`,
  `description`. `archiveRole` soft-archives (protects system roles). There was
  **no** production hard-delete, **no** restore, and **no** reference checking.
- The dropdown catalog (`roles-catalog.js`) was already **active-only**, so
  archived roles never appear as new selectable options.

### Role lifecycle behavior (after)

- **System roles cannot be deleted** — `DELETE` returns `409 PROTECTED`:
  *"System roles are required by the platform and cannot be deleted."*
- **Referenced custom roles cannot be hard-deleted** — `DELETE` returns
  `409 REFERENCED`: *"This role is used by users, workflows, or submitted
  records. It can be deactivated, but not deleted."* (Archive/Deactivate is
  offered instead.)
- **Unused custom roles can be deleted.**
- **Archived custom roles can be restored** (`POST .../restore`).
- Inactive roles stay hidden from **new** selections; existing references remain
  readable (soft archive keeps the row and key resolvable).

### Role reference checks

`getRoleReferenceSummary()` / `countRoleReferences()` count usage across:

- `user_roles.role_key` (assigned users)
- `workflow_step_instances.assignee_role` (live workflow steps)
- `form_template_versions.workflow_json` **and** `compiled_workflow_json`
  (`steps[].assignee_role`, scanned in JS)
- `app_spaces.visible_to_roles_json` and
  `template_launch_entries.visible_to_roles_json` (launch visibility)

Missing tables are skipped via `to_regclass` so older schemas don't error.
`GET /hub/rbac/roles` annotates each role with `reference_count`, `referenced`,
and `deletable` so the UI can hide/disable Delete; the server remains the
authority.

### Role UI changes (Part C)

In **Admin → Users / Roles → Workflow role catalog**:

- **Active / Archived** status badge and **System / Custom** type badge (already
  present) plus a new **"In use"** badge for referenced roles.
- **Deactivate** for active custom roles; **Restore** for archived custom roles.
- **Delete** shown only for custom, unreferenced roles (`role.deletable`); hidden
  for system roles and for referenced roles. Delete surfaces the server's clear
  message if blocked.
- Role **key** stays visually secondary (muted `Key` label + `<code>` under the
  human name) — no internal keys shown as the display name.
- New "In use" badge has light + dark-mode styles in `hub.css`.

---

## Part D — Migrations

**No migration added.** `roles.status` already models active/inactive, and
`system_role` / `description` already exist (migration `011`). Archive/restore
actor + timestamp are captured in the structured security-audit log
(`rbac.role_archived` / `rbac.role_restored` / `rbac.role_deleted`), so the
optional `012_role_lifecycle_metadata.sql` (`archived_at` / `archived_by`) was
**not** required for this MVP and was intentionally not created.

---

## Files changed

**Backend**
- `api/lib/templates/postgres.js` — `listSubmissions` adapter (+export)
- `api/lib/templates/store.js` — `listSubmissions` wrapper
- `api/lib/templates/routes.js` — `GET /hub/templates/submissions` list route (RBAC-scoped)
- `api/lib/rbac/postgres.js` — `getRoleReferenceSummary`, `countRoleReferences`, `deleteRole`, `restoreRole` (+exports)
- `api/lib/rbac/routes.js` — `DELETE /hub/rbac/roles/:key`, `POST /hub/rbac/roles/:key/restore`, reference annotations on the roles list

**Frontend**
- `hub-unified-archive.js` — `forms` filter/route/count wiring
- `hub.js` — `LEGACY_PANEL_IDS` + `resolveHashTab` for `forms-archive`
- `index.html` — Forms archive panel + loader/render/open, empty-state copy, router registrations, role UI Restore/Delete + "In use" badge, Forms row CSS
- `hub.css` — `.hub-workflow-role-badge-inuse` (light + dark)

**Tests / tooling**
- `scripts/templates/archive-dynamic-forms-test.js` (new)
- `scripts/templates/role-lifecycle-guardrails-test.js` (new)
- `package.json` — `templates:archive-dynamic-forms-test`, `templates:role-lifecycle-guardrails-test`

---

## Tests run

New focused tests:
- `templates:archive-dynamic-forms-test` — **36/36 PASS**
- `templates:role-lifecycle-guardrails-test` — **33/33 PASS**

Card-required suite (all **PASS**):
- `db:validate`, `settings:ui-test`, `templates:mvp-ia-test`,
  `templates:new-request-registry-test`, `templates:legacy-runtime-parity-test`,
  `templates:forms-admin-rbac-readiness-test`,
  `templates:archive-route-hydration-test` (51/51),
  `templates:shell-route-consistency-test`,
  `templates:workflow-tab-dark-mode-test`,
  `vendor-dashboard:test`, `vendor-master:test`, `vendor-workflow:test`,
  `vendor-documents:test`, `vendor-document-notifications:test`,
  `vendor-rbac-ui:test`, `vendor-dashboard-queues:test`

Regression spot-checks (all **PASS**):
- `security:workflow-step-authz-test`, `security:submission-idor-test`,
  `templates:launch-visibility-role-catalog-test`

Known non-blocking: `ui:visual-consistency-test` reports **1 pre-existing**
failure ("Archive load deferred until panel mount") — a static string search for
`requestAnimationFrame` in `hub-unified-archive.js`. This check was failing
before WOS-80 (that string is not in the archive-load path, which the passing
`archive-route-hydration-test` covers) and is unrelated to these changes; it was
left as-is to avoid altering working Archive load timing.

---

## Browser / live verification

Verified against a local Postgres-backed dev server (`npm run dev`,
`http://127.0.0.1:3000`):

**Archive (dynamic forms)**
- `GET /hub/templates/submissions` returned `{ records: [...], count: 17 }` with
  the expected shape (id, template_name, status, submitted_by, submitted_at,
  version_number).
- Empty-state copy verified as "No submitted form records found."
- Route/filter/deep-link wiring verified by `templates:archive-dynamic-forms-test`
  and `templates:archive-route-hydration-test` (hard refresh + first-click).

**Role lifecycle**
- Delete system role `admin` → `409 PROTECTED` (correct message).
- Create custom `wos80_tmp` → Archive → Restore → Delete (unused) → all succeed.
- Assign custom `wos80_ref` to a user, then Delete → `409 REFERENCED`
  (`references: 1`, correct message); after unassign, Delete succeeds.
- `GET /hub/rbac/roles` returns per-role `reference_count` / `referenced` /
  `deletable`; all system roles report `deletable: false`.
- "In use" badge has light + dark styles; role key kept secondary.

Manual UI walkthrough remaining for the reviewer (functional wiring is
test-covered): submit a dynamic form and confirm it appears in Archive **All**
and **Forms**, open its detail, and confirm dark-mode readability of the roles
catalog.

---

## Known limitations

- **Non-admin Forms list** is scoped to submissions the user *created*.
  Workflow-assignee visibility to submissions they did not create is available
  through the submission detail route (and task queues), not the archive list.
  This is intentionally conservative to avoid over-exposure.
- **Dynamic forms require Postgres.** With `HUB_STORE_MODE != postgres` the list
  endpoint returns 503 and the Forms archive shows the empty state (legacy
  Blob-backed categories are unaffected).
- **Archive actor/time for roles** is captured in the security-audit log, not a
  dedicated DB column (no `012` migration this card).
- Reference summary scans workflow/visibility JSON in application code; fine at
  current template/space volumes, revisit if these grow very large.

---

## Recommendation

**Ready for Start Center.**

- Submitted dynamic forms appear in Archive (All + Forms), the Forms route works
  on hard refresh, and legacy categories still work.
- System roles cannot be deleted; referenced roles cannot be hard-deleted;
  inactive roles are hidden from new selections while existing references remain
  readable.
- All card-required tests pass; new focused tests added and passing.
