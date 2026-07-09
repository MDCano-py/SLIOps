# WOS-70 — Legacy Request Runtime Visual Parity + Admin Edit Policy

## Executive summary

Legacy request forms now share visual language with the dynamic template runtime without changing their submission logic, API integrations, or field behavior. A clear **admin edit policy** separates system-managed legacy modules from editable dynamic forms. Work Order received targeted cleanup: field-level API warnings, cleaner progress copy, and runtime-aligned header/section styling.

All Part G automated tests pass, including the new `templates:legacy-runtime-parity-test` suite (46 checks).

**Recommendation: Ready** for local browser verification (`?_noauth=1`).

---

## Admin edit policy

### Dynamic forms

| Action | Who | Behavior |
|--------|-----|----------|
| Create / edit draft | Admin | Forms builder (copy-on-write on published templates) |
| Publish | Admin | Existing publish flow unchanged |
| Manage form (runtime) | Admin only | Subtle link on open dynamic form → `#/forms/:templateId` |
| Edit form (runtime) | Never shown | No schema editing from runtime |

### Legacy request types

| Action | Allowed |
|--------|---------|
| Direct “Edit form” | **No** — system-managed modules |
| Builder exposure | **No** — legacy fields not in dynamic builder |
| User label | Optional “System-managed request type” eyebrow + badge |
| Submit / API behavior | Unchanged |

Policy helpers live in `hub-request-form-shell.js`: `isLegacySystemManaged()`, `canShowManageForm()`, `shouldShowEditFormAction()` (always false).

---

## Legacy request type policy

All nine registry types remain system-managed:

- Work Order, Parts / Material, Equipment Request, Safe Work Permit, JSA, BOL, Document Review, Document Signature, General Request

**Custom portal modules** (Work Order, Parts, BOL, JSA, SWP) open via existing portal tabs with updated shell CSS.

**Schema legacy types** (Equipment, Document Review/Signature, General Request) render inline on New Request via `HubFormRenderer` wrapped in the shared runtime shell with system-managed badge — no edit action.

---

## Dynamic form manage/edit policy

- **New Request cards:** No admin clutter; “Fill out form” / “Start request” only.
- **Runtime view:** Admins opening a published dynamic form see **Manage form** (not “Edit schema”, “Launch config”, or App Spaces language).
- **Non-admins:** Never see Manage/Edit actions.

---

## Work Order visual updates

- Header uses runtime-style eyebrow: “System-managed request type · Work Order” + System-managed badge.
- Section card styling aligned with `hub-request-form-section` / `tmpl-preview-section-card`.
- Progress label: “0 of 6 required fields complete”.
- **Field-level API warnings** via `woSetFieldApiWarn()` and `.hub-field-api-warn` — locations, assets, and categories fail independently.
- Combo placeholders no longer show emoji “⚠️ Could not load” text; teams remain available (static allowlist).
- Loader fades out on partial failure instead of blocking the entire form with a page-level error.

All MaintainX fetch logic, validation, duplicate detection, seal-leak behavior, and submit path unchanged.

---

## Shared runtime shell approach

New module: **`hub-request-form-shell.js`**

| Consumer | Usage |
|----------|--------|
| `HubFormRenderer` | `wrapFormShell()` for schema legacy inline forms |
| `template-section-builder.js` | Dynamic runtime HTML classes (`hub-request-form-shell`, footer) |
| `template-runtime-ui.js` | Admin “Manage form” link injection |
| Legacy portal panels | CSS class `hub-legacy-request-panel` on WO, Parts, BOL, JSA, SWP |

Dynamic and legacy shells share visual tokens (header gradient, section cards, footer bar, dark mode) but **do not** share the dynamic schema renderer — legacy DOM and JS remain intact.

---

## Files changed

| File | Change |
|------|--------|
| `hub-request-form-shell.js` | **New** — edit policy + shell HTML helpers |
| `hub-form-renderer.js` | Runtime shell wrapper; system-managed schema forms |
| `hub.css` | Shell, legacy panel, field API warn, progress styles |
| `hub.js` | `systemManaged` + `showManageForm` for New Request flows |
| `template-runtime-ui.js` | Admin “Manage form” link on dynamic runtime |
| `template-section-builder.js` | Shared shell classes on dynamic runtime HTML |
| `index.html` | Legacy panel classes; Work Order header/sections; field warn JS; script tag |
| `scripts/templates/template-legacy-runtime-parity-test.js` | **New** test suite |
| `package.json` | `templates:legacy-runtime-parity-test` script |

---

## Tests run

All Part G commands — **PASS**:

- `npm run db:validate`
- `npm run settings:ui-test`
- `npm run templates:mvp-ia-test`
- `npm run templates:ia-test`
- `npm run templates:versioning-test`
- `npm run templates:validator-test`
- `npm run templates:builder-ui-test`
- `npm run templates:launch-registry-test`
- `npm run templates:section-binding-test`
- `npm run templates:section-builder-ui-test`
- `npm run templates:runtime-mvp-test`
- `npm run templates:runtime-reconciliation-test`
- `npm run templates:ui-cleanse-import-test`
- `npm run templates:new-request-registry-test` — 59/59
- `npm run templates:legacy-runtime-parity-test` — **46/46**
- All vendor tests — PASS

---

## Browser verification (manual)

1. Hard refresh with `?_noauth=1`.
2. New Request — all nine legacy cards + published dynamic forms.
3. Open Work Order — same fields/behavior; cleaner header and progress.
4. Simulate API failure — field-level warnings, form still usable where possible.
5. No “Edit form” on legacy modules.
6. Publish dynamic form → New Request → “Fill out form”.
7. As admin, open dynamic form → “Manage form” link appears.
8. As non-admin (or without hub_admin), no Manage link.
9. Submit dynamic form → submission record with human labels.
10. Dark mode quick pass.

---

## Known limitations

- Parts, BOL, JSA, SWP headers not individually restructured — they inherit `hub-legacy-request-panel` CSS mapping from existing `.page-head` / `.card` (Work Order got the deepest pass).
- Legacy custom forms still open portal tabs rather than inline New Request host (by design — avoids breaking modules).
- “Manage form” navigates to Forms admin; does not open builder inline.
- Restore-from-archive and legacy-to-dynamic migration not in scope.

---

## Future migration options (documented, not implemented)

1. **Clone legacy request as custom form** — duplicate fields into dynamic template for gradual migration.
2. **Migrate legacy module to dynamic template** — replace custom_component with published schema + workflow bindings.
3. **Admin-configurable labels/options** — expose safe subsets (labels, dropdown options) without full builder access to MaintainX-mapped fields.

---

## Recommendation

**Ready** — acceptance criteria met via implementation and automated tests. Complete the manual browser checklist above before production deploy.
