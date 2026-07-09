# WOS-73 — Flexible Launch Visibility + Role Catalog Cleanup

## Executive summary

Form builder Settings no longer exposes App Spaces architecture. Forms use plain **Availability** controls for New Request (enable/disable + role visibility from the Postgres role catalog). Hardcoded visibility role arrays and the App Space dropdown are removed. Live preview decorative traffic-light dots are replaced with Streamline-native header copy. Minimal workflow role management (list/create/archive) is available under Admin → Users.

**RDS impact:** No new migrations. Existing `011_hub_rbac_roles.sql` supports custom roles, archival, and references from visibility/workflow/user assignment.

**Recommendation: Ready** for browser verification with `?_noauth=1`.

---

## App Spaces UI removal

Removed from form builder Settings:

- “App space” dropdown (forms/documents/workflows/operations/admin)
- “WOS-58 app spaces” / launch registry copy
- Hardcoded `LAUNCH_ROLE_OPTIONS` and `LAUNCH_SPACE_OPTIONS` arrays

Approval route and document templates show contextual copy only (no App Space picker).

Internal launch registry still uses `space_key: 'forms'` behind the scenes via `ensureDefaultLaunchConfig()`.

---

## New Request availability behavior

Settings tab for forms:

| Control | Behavior |
|---------|----------|
| **Make this form available in New Request** | Maps to `launch_config.enabled` |
| **Everyone with access** | `visibility_mode: everyone`, empty `visible_to_roles` |
| **Specific roles** | Checkboxes from Postgres role catalog |

Publish saves availability before publishing. Published forms still appear in New Request when enabled. Hidden forms (`enabled: false`) remain out of the registry.

---

## Role visibility source

- UI loads roles from `GET /hub/rbac/workflow-roles` (same catalog as workflow assignee dropdown)
- Role **names** shown in UI; **keys** stored in `visible_to_roles` / `visible_to_roles_json`
- Archived roles hidden from new selection; saved inactive keys preserved on existing forms
- `rolesCanSee()` updated: empty role list = everyone; checks portal permissions **and** Postgres `user_roles`

---

## Role catalog flexibility audit

| Capability | Status |
|------------|--------|
| Create roles in database | **Yes** — `POST /hub/rbac/roles` |
| Archive/deactivate roles | **Yes** — `POST /hub/rbac/roles/:key/archive` |
| System roles protected | **Yes** — `system_role` flag blocks archive |
| `user_roles` reference custom roles | **Yes** — FK to `roles.key` |
| Workflow `assignee_role` uses custom roles | **Yes** — validator uses live catalog |
| Form visibility uses custom roles | **Yes** — after creation, appears in Settings checkboxes |
| Seed roles upserted on access | **Yes** — includes employee, hub_admin for legacy parity |

**No new migration required.**

---

## Role management UI changes

Added to **Admin → Users** (User Permissions view):

- **Workflow role catalog** panel
- List active/archived roles with system badges
- **+ New role** (name, key, description)
- **Archive** for non-system roles

Portal permission bundles (Redis Role Management) remain separate and unchanged.

---

## Preview chrome removal

- Removed red/yellow/green dots from `wrapPreviewFrame()` in `template-section-builder.js`
- Preview header: title + “Updates as you edit”
- Build tab sidebar preview unchanged (already Streamline-native)

---

## Migrations added

**None.** Reuses `011_hub_rbac_roles.sql`.

---

## Files changed

| File | Change |
|------|--------|
| `template-registry-ui.js` | Availability Settings UI, catalog-driven visibility, removed App Space UI |
| `template-section-builder.js` | Preview frame chrome cleanup |
| `api/lib/spaces/normalize.js` | `visibility_mode`, empty=everyone, role checks with user_roles |
| `api/lib/spaces/postgres.js` | Registry filtering with assigned workflow roles |
| `api/lib/spaces/routes.js` | Pass actor email to registry |
| `api/lib/rbac/postgres.js` | create/archive roles, seed employee/hub_admin |
| `api/lib/rbac/routes.js` | Role catalog CRUD endpoints |
| `api/lib/templates/runtime-routes.js` | Launch auth uses user_roles |
| `index.html` | Preview CSS, workflow role catalog UI, availability styles |
| `scripts/templates/template-launch-visibility-role-catalog-test.js` | New test suite |
| `package.json` | New test script |

---

## Tests run

All Part F suites — **PASS**, including:

- `templates:launch-visibility-role-catalog-test` — **30/30**
- `templates:launch-registry-test` — 29/29
- `templates:new-request-registry-test` — 59/59
- `templates:forms-admin-rbac-readiness-test` — 32/32
- `db:validate`, `settings:ui-test`, `templates:mvp-ia-test`, WOS-69/70/71 tests

---

## Browser verification (manual)

1. Hard refresh `?_noauth=1`
2. Forms → open form → Settings tab
3. Confirm no App Space language/dropdown
4. Confirm Availability / New Request controls
5. Confirm role checkboxes use catalog names
6. Admin → Users → create custom role → confirm in Settings visibility
7. Publish form → confirm in New Request
8. Test specific-role visibility with assigned user
9. Confirm live preview has no traffic-light dots
10. Dark mode pass

---

## RDS readiness impact

**No schema changes needed.** Role catalog, user assignments, and launch visibility fields are Postgres-durable. Portal permission bundles remain Redis-backed (separate RDS cutover follow-up).

---

## Known limitations

- Role create/archive uses simple prompts (no full modal CRUD)
- Launch visibility still checks permission strings OR workflow role keys — not full portal role bundle inheritance
- Document/workflow template Settings show informational copy only (no New Request availability)

---

## Recommendation

**Ready** — acceptance criteria met. Complete manual browser checklist before deploy.
