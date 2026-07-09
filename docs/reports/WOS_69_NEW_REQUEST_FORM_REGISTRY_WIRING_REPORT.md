# WOS-69 — New Request Form Registry Wiring + Legacy Request Parity

## Executive summary

Published dynamic forms are now wired into **New Request** as first-class request type cards alongside all nine legacy/static request types. **Forms** remains the admin surface for create/manage/build; users start published forms from New Request without seeing launch registry, App Spaces, or schema jargon.

Field keys are hidden from normal builder and runtime UI (available only in the field settings/details panel for admins). Safe delete rules enforce **Delete draft** for unpublished forms with no submissions and **Archive form** for published forms or anything with submissions.

All Part G automated tests pass, including the new `templates:new-request-registry-test` suite (59 checks).

**Recommendation: Ready** for browser smoke verification in local dev (`?_noauth=1`).

---

## New Request wiring behavior

1. Admin creates a form on **Forms → New Form**, adds fields, and publishes.
2. Publish auto-enables launch config in the internal `forms` space (unchanged from WOS-67).
3. `initNewRequestHub()` loads:
   - Legacy types from `GET /hub/registry/document-types`
   - Published forms from `GET /hub/spaces/registry` via `HubNewRequestRegistry.publishedFormsFromRegistry()`
4. Cards render in two sections when applicable:
   - **Published forms** — dynamic forms with “Fill out form” action
   - Legacy categories (Operations, Safety, Logistics, Documents, General) — “Start request”
5. Clicking a published form card opens `TemplateRuntimeUI.renderLaunchForm()` inline on the New Request page (no separate launch nav).
6. Submit uses existing `/hub/launch/:id/submit` → submission detail route.
7. Cancel / error returns to the New Request type list.

---

## Legacy request parity review

Source of truth: `api/lib/hub/document-registry.js` (all nine types `enabled: true`):

| Key | Label |
|-----|-------|
| `work_order` | Work Order |
| `parts_request` | Parts / Material |
| `equipment_request` | Equipment Request |
| `safe_work_permit` | Safe Work Permit |
| `jsa` | JSA |
| `bol` | BOL |
| `document_review` | Document Review |
| `document_signature` | Document Signature |
| `general_request` | General Request |

These load via `fetchRegistry()` and are merged with published dynamic forms — not replaced or hidden. Custom legacy types still open their portal tabs; schema types render inline via `HubFormRenderer`.

---

## Notes from reviewing `updated version/index.html`

The **updated version** folder contains the legacy single-page portal (tab-based SWP, JSA, Work Order, etc.) with a flat “+ New Request” button that resets the portal — it does **not** include the Hub New Request grid page.

Parity approach for WOS-69:

- Hub New Request cards mirror **document-registry** enabled types (same modules/tabs the legacy portal uses).
- No legacy modules were removed or overwritten; dynamic forms are **added alongside** them.
- High-level/gated cards in production still respect RBAC; in `_noauth=1` dev mode `RbacClient.isPortalNoAuthMode()` bypasses permission checks so all nav and request surfaces remain visible for local testing.

---

## Dynamic published form behavior

- **Published + active launch entry** → appears in New Request “Published forms” section.
- **Draft only** → manage on Forms; not in launch registry; not on New Request.
- **Archived** → launch entries hidden; removed from New Request; visible under Forms → Manage → Archived filter.
- Runtime uses human field labels; submission records show label/value pairs (not raw keys).

---

## `_noauth=1` / high-level form visibility

- Client: `RbacClient.enablePortalNoAuthMode()` + `revealAllNav()` when `?_noauth=1`.
- Client `hasPerm()` returns true in noauth mode for hub UI gating.
- Legacy document types and published forms both load for dev testing without hiding admin/high-level cards that RBAC would normally gate in production.

---

## Field key UI hiding

| Surface | Behavior |
|---------|----------|
| Builder summary row | Label, type pill, Required/Optional only — no key |
| Builder details (⚙) | Field key editable for admins |
| Runtime form | Labels only (`data-field-key` remains on inputs for binding, not shown as text) |
| Submission record | Human labels via `tmpl-runtime-readonly-label` |
| Runtime header | “Published form · Fill out and submit” (no “App space” copy) |

Schema/backend keys unchanged.

---

## Draft delete / archive policy

| Case | Action |
|------|--------|
| Draft, no published version, no submissions | **Delete draft** (`POST /hub/templates/:id/delete`) |
| Published form | **Archive form** only (`POST /hub/templates/:id/archive`) — delete returns 409 |
| Any form with submissions | Cannot hard-delete — archive instead |

UI: Manage forms table shows **Delete draft** for draft-only templates and **Archive form** for published active templates.

---

## Forms page relationship

| Surface | Purpose |
|---------|---------|
| **New Request** | Primary user launch — start/fill legacy types and published forms |
| **Forms → Available forms** | Optional fill path; copy directs team to New Request |
| **Forms → Manage forms** | Admin create/build/publish/archive/delete draft |

---

## Files changed

| File | Change |
|------|--------|
| `hub-new-request-registry.js` | **New** — merge legacy + published forms helpers |
| `hub.js` | New Request grid, launch registry fetch, inline runtime |
| `template-runtime-ui.js` | `onCancel` / `onSubmitSuccess` callbacks for New Request |
| `template-registry-ui.js` | Field key hidden in summary; delete draft UI/API; Forms copy |
| `template-section-builder.js` | Plain runtime/submission labels |
| `api/lib/templates/postgres.js` | `deleteDraftTemplate`, submission count guard |
| `api/lib/templates/store.js` | Export delete |
| `api/lib/templates/routes.js` | `POST /hub/templates/:id/delete` |
| `index.html` | New Request subtitle; script tag for registry module |
| `hub.css` | Dynamic card + category hint styles |
| `scripts/templates/template-new-request-registry-test.js` | **New** test suite |
| `package.json` | `templates:new-request-registry-test` script |

---

## Tests run

All Part G commands executed successfully:

- `npm run db:validate` — PASS
- `npm run settings:ui-test` — PASS
- `npm run templates:mvp-ia-test` — PASS
- `npm run templates:ia-test` — PASS
- `npm run templates:versioning-test` — PASS
- `npm run templates:validator-test` — PASS
- `npm run templates:builder-ui-test` — PASS
- `npm run templates:launch-registry-test` — PASS
- `npm run templates:section-binding-test` — PASS
- `npm run templates:section-builder-ui-test` — PASS
- `npm run templates:runtime-mvp-test` — PASS
- `npm run templates:runtime-reconciliation-test` — PASS
- `npm run templates:ui-cleanse-import-test` — PASS
- `npm run templates:new-request-registry-test` — **59/59 PASS**
- `npm run vendor-dashboard:test` — PASS
- `npm run vendor-master:test` — PASS
- `npm run vendor-workflow:test` — PASS
- `npm run vendor-documents:test` — PASS
- `npm run vendor-document-notifications:test` — PASS
- `npm run vendor-rbac-ui:test` — PASS
- `npm run vendor-dashboard-queues:test` — PASS

---

## Browser verification (manual checklist)

Recommended local pass with hard refresh and `?_noauth=1`:

1. New Request shows all nine legacy cards + any published forms.
2. Create form → add field → confirm key hidden in row (visible only in ⚙ settings).
3. Publish → return to New Request → card appears under Published forms.
4. Click card → runtime opens inline; fields inside form only.
5. Submit → record shows human labels.
6. Archive → card disappears from New Request; still in Forms Archived filter.
7. Create empty draft → Delete draft works.
8. Repeat in dark mode.

*Automated tests cover API/registry/runtime paths; full browser pass should be done once in local dev.*

---

## Known limitations

- Settings still contains a hidden **App Spaces** admin card (internal only; not in user nav).
- `data-field-key` attributes remain on runtime inputs for form binding (not visible text).
- Restore-from-archive UI not implemented (archive is one-way in MVP).
- Updated-version portal and Hub New Request are parallel surfaces; legacy tabs are not duplicated inside the hub grid.

---

## Recommendation

**Ready** — acceptance criteria met via implementation and automated tests. Complete the manual browser checklist above in local dev before production deploy.
