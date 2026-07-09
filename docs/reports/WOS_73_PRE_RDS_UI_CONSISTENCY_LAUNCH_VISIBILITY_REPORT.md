# WOS-73 — Pre-RDS UI Consistency + Flexible Launch Visibility Cleanup

## Executive summary

WOS-73 removes remaining pre-RDS UI leaks: App Spaces language in form builder Settings, hardcoded visibility role arrays, decorative preview chrome, and dark-mode inconsistencies on Archive and the New Form modal. Launch visibility now uses plain **Availability** controls (New Request + role catalog). Visibility roles load from the Postgres-backed role catalog (same source as workflow assignee dropdown). Live preview uses Streamline-native header copy. Archive filters/cards and the New Form modal match dashboard styling in light and dark mode.

**RDS impact:** No new migrations. Existing `011_hub_rbac_roles.sql` supports custom roles, archival, and references from visibility, workflow assignee, and user assignment.

**Recommendation: Ready** for RDS migration prep after manual browser verification with `?_noauth=1`.

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

Available under **Admin → Users** (User Permissions view):

- **Workflow role catalog** panel
- List active/archived roles with system badges
- **+ New role** (name, key, description)
- **Archive** for non-system roles

Portal permission bundles (Redis Role Management) remain separate and unchanged.

---

## Preview chrome removal

- Removed red/yellow/green dots from `wrapPreviewFrame()` in `template-section-builder.js`
- Preview header: **Live preview** + “Updates as you edit”
- Runtime rendering and preview form behavior unchanged

---

## Archive dark mode fixes

| Issue | Fix |
|-------|-----|
| Raw/default filter buttons | `.hub-archive-filter` pill styling mirroring `.hub-qf` (teal active state, hub tokens) |
| Cards not matching dashboard | Overview cards use `--hub-surface`, `--hub-border`, hover teal + shadow |
| Poor dark contrast | Dark overrides for filters, cards, empty states |
| Typography/spacing | Card title/subtitle use `--hub-text` / `--hub-muted` |

Archive filters unchanged: All, JSA, BOL, Work Orders, Parts Requests, Roll Off Swap. Behavior unchanged; styling only.

---

## New Form modal dark mode fixes

Added dark-mode rules for `.tmpl-modal` stack:

- Backdrop: darker overlay (`rgba(0,0,0,0.62)`)
- Modal surface: `--paper` dark token
- Head/foot: `#121a1c` with `#2a4248` borders
- Labels: `--ink` readable text
- Inputs/selects/textareas: `#121a1c` background, `#2a4248` borders, `#e2e8f0` text
- Focus ring uses teal accent
- Hub-sub helper text uses `--ink-soft`

Schema creation logic and modal behavior unchanged.

---

## Shared UI token cleanup

Token pass on affected surfaces using existing `--hub-*` and dark `--ink` / `--paper` variables:

| Surface | Changes |
|---------|---------|
| Archive page | Filter pills, overview cards, empty states |
| Forms page filters | Active filter dark contrast (`.forms-hub-filter.is-active`) |
| Manage forms table | Existing meta-body dark rule retained |
| New Form modal | Full modal stack dark tokens |
| Builder Settings | Visibility role label contrast (`.tmpl-launch-roles-wrap`) |
| Live preview header | Existing dark frame chrome rules retained |
| Admin role catalog | Row border dark token |

No new design system introduced. Dashboard shell unchanged.

---

## Migrations added

**None.** Reuses `011_hub_rbac_roles.sql` and `008_app_spaces_launch_registry.sql` (internal only).

---

## Files changed (WOS-73)

| File | Change |
|------|--------|
| `template-registry-ui.js` | Availability Settings UI, catalog-driven visibility (prior) |
| `template-section-builder.js` | Preview frame chrome cleanup (prior) |
| `api/lib/spaces/normalize.js` | `visibility_mode`, empty=everyone, role checks (prior) |
| `api/lib/rbac/*` | Role catalog CRUD, seed roles (prior) |
| `index.html` | Modal dark mode, forms filter active dark, visibility labels |
| `hub.css` | Archive filter pills, overview card tokens, dark overrides |
| `scripts/templates/template-launch-visibility-role-catalog-test.js` | Launch visibility + role catalog tests (prior) |
| `scripts/templates/template-dark-mode-ui-consistency-test.js` | **New** dark mode UI consistency tests |
| `package.json` | `templates:dark-mode-ui-consistency-test` script |

---

## Tests run

| Suite | Result |
|-------|--------|
| `db:validate` | PASS |
| `settings:ui-test` | 14/14 PASS |
| `templates:mvp-ia-test` | 29/29 PASS |
| `templates:ia-test` | 32/32 PASS |
| `templates:versioning-test` | 30/30 PASS |
| `templates:validator-test` | 30/30 PASS |
| `templates:builder-ui-test` | 15/15 PASS |
| `templates:launch-registry-test` | 29/29 PASS |
| `templates:section-binding-test` | 28/28 PASS |
| `templates:section-builder-ui-test` | 21/21 PASS |
| `templates:runtime-mvp-test` | 31/31 PASS |
| `templates:runtime-reconciliation-test` | PASS |
| `templates:ui-cleanse-import-test` | 26/26 PASS |
| `templates:new-request-registry-test` | 59/59 PASS |
| `templates:legacy-runtime-parity-test` | 46/46 PASS |
| `templates:mvp-sidebar-consolidation-test` | 33/33 PASS |
| `templates:forms-admin-rbac-readiness-test` | 32/32 PASS |
| `templates:launch-visibility-role-catalog-test` | 30/30 PASS |
| `templates:dark-mode-ui-consistency-test` | 20/20 PASS |
| `vendor-dashboard:test` | 13/13 PASS |
| `vendor-master:test` | 20/20 PASS |
| `vendor-workflow:test` | 36/36 PASS |
| `vendor-documents:test` | 24/24 PASS |
| `vendor-document-notifications:test` | 21/21 PASS |
| `vendor-rbac-ui:test` | 31/31 PASS |
| `vendor-dashboard-queues:test` | 30/30 PASS |

All WOS-69/WOS-70/WOS-71/WOS-72 regression suites pass.

---

## Browser verification (manual checklist)

1. Hard refresh with `?_noauth=1`
2. Open Forms → create or open a form → Settings tab
3. Confirm no App Space language or dropdown
4. Confirm **Availability** / New Request controls
5. Confirm role checkboxes come from role catalog (not hardcoded list)
6. Admin → Users → create custom role → confirm in Settings visibility
7. Confirm live preview has no red/yellow/green dots
8. Open Archive (light mode) — filters and cards match Streamline dashboard
9. Switch dark mode — Archive filters/cards readable and styled
10. Forms → New Form (dark mode) — modal, labels, inputs, dropdown, buttons readable
11. Publish form → confirm in New Request; visibility rules respected
12. Quick pass on Manage Forms table in dark mode

---

## RDS readiness impact

- **UI/model leaks cleaned:** App Spaces no longer exposed in builder Settings; roles are catalog-driven
- **Schema ready:** Custom roles, archival, FK references already in Postgres
- **Launch registry:** Internal `forms` space path unchanged; no admin App Space picker needed for MVP
- **No blocking migrations** identified for RDS cutover from this card

---

## Known limitations

- App Spaces admin UI and launch sidebar nav remain disabled/hidden (by design for MVP)
- Embedded legacy archive panels (JSA, BOL, etc.) retain their own document styling for print/archive fidelity
- Portal permission bundles (Redis) and workflow roles (Postgres) are intentionally separate concepts
- Dark mode for version/validation modals inherits shared `.tmpl-modal` rules but was not individually re-tested in browser

---

## Recommendation

**Ready** for RDS migration prep. Complete the manual browser checklist above in both light and dark mode before cutover. No follow-up card required for WOS-73 scope unless browser QA surfaces edge cases in embedded legacy archive panels.
