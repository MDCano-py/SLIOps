# WOS-71 — MVP Sidebar Consolidation + Unified Archive

## Executive summary

The hub sidebar is condensed for MVP: one **Forms** entry, one **Archive** entry, and no standalone **Workflows** nav item. Legacy archive panels (JSA, BOL, Work Orders, Parts, Roll Off Swap) are embedded in a unified Archive page with category filters. Old archive and workflow routes redirect safely without removing backend handlers or legacy panel DOM.

All Part G automated tests pass, including the new `templates:mvp-sidebar-consolidation-test` suite (33 checks).

**Recommendation: Ready** for local browser verification with `?_noauth=1`.

---

## Sidebar changes

| Before | After |
|--------|-------|
| Operations → Forms (Roll Off Swap mislabeled) | Removed |
| Workspace → Forms | **Single Forms entry** |
| Workspace → Workflows | Removed from sidebar |
| Archives → JSA / BOL / WO / ROS (4 links) | **Single Archive entry** |

MVP sidebar shape:

- Dashboard, Request Queue, My Tasks, New Request
- **Operations:** Documents, Parts Request, Work Orders, Generators, JSA Generator, Safe Work Permits
- **Workspace:** Forms
- **Archives:** Archive
- **Insights:** Reports, Analytics
- **Admin:** Users, Settings

---

## Duplicate Forms decision

The Operations item labeled “Forms” was actually `roll-off-swap` — a duplicate/misleading label next to Workspace **Forms**. It was removed from the sidebar. Roll Off Swap archived records remain accessible via **Archive → Roll Off Swap** filter. The `roll-off-swap` portal route and panel are unchanged.

---

## Workflows visibility decision

**Workflows** is no longer a primary sidebar item. Approval route management remains available to admins via:

- **Forms → Manage forms → Approval routes** button
- Direct URL `#/forms/approval-routes`
- Legacy `#/workflows` redirects to `#/forms/approval-routes`

Non-admins still cannot access workflow authoring (`hub-workflows` RBAC unchanged). The Forms page stays active in the sidebar when viewing approval routes.

Plain language in UI: **Approval routes** (not workflow_json / WorkflowInstance).

---

## Unified Archive behavior

New hub page: **Archive** (`hub-archive`)

- Filter bar: **All | JSA | BOL | Work Orders | Parts Requests | Roll Off Swap**
- **All** shows category overview cards
- Selecting a filter mounts the existing legacy archive panel inline (search, date filters, list, detail — unchanged)
- Embedded panels hide duplicate page headers via `.hub-archive-embedded`

Module: `hub-unified-archive.js`  
Loaders: `window.HubArchiveLoaders` triggers existing `loadArchive` / `loadRequestArchive` / `loadRollOffSwapArchive` functions.

---

## Old route redirect / preservation behavior

| Legacy route | New behavior |
|--------------|--------------|
| `#/jsa-archive` | → `#/archives/jsa` (unified Archive) |
| `#/bol-archive` | → `#/archives/bol` |
| `#/work-order-archive` | → `#/archives/work-orders` |
| `#/parts-request-archive` / `#/documents` | → `#/archives/parts` |
| `#/roll-off-swap-archive` | → `#/archives/ros` |
| `#/archives/jsa/{id}` | Archive + JSA filter + deep link to record |
| `#/workflows` | → `#/forms/approval-routes` |

Legacy panel IDs, archive APIs, and route handlers are **not deleted**. `resolveHashTab()` in `hub.js` maps old archive tab names to `hub-archive` with filters.

---

## Files changed

| File | Change |
|------|--------|
| `hub-unified-archive.js` | **New** — unified Archive page + filters |
| `hub.js` | `hub-archive` tab, `initHubArchive`, route redirects, approval-routes hash |
| `index.html` | Sidebar consolidation, Archive page, parseHash, `HubArchiveLoaders`, deep links |
| `hub.css` | Unified archive styles |
| `template-registry-ui.js` | **Approval routes** button in Forms manage |
| `scripts/templates/template-mvp-sidebar-consolidation-test.js` | **New** test suite |
| `scripts/templates/template-mvp-ia-test.js` | Updated for sidebar/workflow changes |
| `scripts/templates/template-ia-separation-test.js` | Workflows → approval-routes hash |
| `package.json` | `templates:mvp-sidebar-consolidation-test` script |

---

## Tests run

All Part G commands — **PASS**, including:

- `templates:mvp-sidebar-consolidation-test` — **33/33**
- `templates:mvp-ia-test` — 29/29
- `templates:ia-test` — 32/32
- `templates:new-request-registry-test` — 59/59
- `templates:legacy-runtime-parity-test` — 46/46
- Full template + vendor suites — PASS

---

## Browser verification (manual)

1. Hard refresh with `?_noauth=1`
2. Confirm one **Forms** in Workspace (no Operations duplicate)
3. Confirm no **Workflows** in sidebar
4. Confirm one **Archive** under Archives
5. Open Archive → test each filter (JSA, BOL, Work Orders, Parts, ROS)
6. Open `#/jsa-archive` directly → should land on unified Archive with JSA filter
7. Open New Request → legacy + published forms still work
8. Open Forms as admin → **Approval routes** opens approval route management
9. Dark mode quick pass

---

## Known limitations

- **All** archive filter shows overview cards only (no combined cross-type search yet)
- Roll Off Swap **form** generator is not in the Operations sidebar (archives + direct `#/roll-off-swap` route still work)
- `#/hub-workflows` internal tab still exists for deep links but is not in sidebar
- Top legacy tab menu (if visible outside hub shell) may still list individual archives — hub sidebar is the MVP surface

---

## Recommendation

**Ready** — sidebar consolidation and unified Archive meet acceptance criteria. Complete the manual browser checklist before production deploy.
