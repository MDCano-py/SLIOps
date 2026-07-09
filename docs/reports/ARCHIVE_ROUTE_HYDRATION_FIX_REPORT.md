# Archive Deep-Link + Hard Refresh Shell Hydration Fix

## Executive summary

Hard refresh on archive deep links (e.g. `#/archives/bol`) could render the Archive overview instead of the category list, and the legacy portal shell could flash before the modern hub appeared. Root cause was **premature route application before `HubUI` was ready**, which cached a broken route state and blocked correct hydration on the real boot pass.

This fix makes **location hash the source of truth** for archive category selection, gates `applyRoute` until the hub shell is ready, and adds **early CSS boot** to prevent legacy shell flash on hard refresh.

---

## Root cause

| Issue | Cause |
|-------|--------|
| `#/archives/bol` → overview on hard refresh | `applyRoute()` could run from `/me` / nav permission handlers **before `hub.js` loaded `HubUI`**. That pass set `_lastAppliedRouteKey` without mounting archive panels. When `hub.js` init ran `applyRoute()` again, the dedupe guard skipped re-application. |
| Stale category after navigation | Prior fix moved `_hubArchiveRoute` before `switchTab`, but archive init still trusted stale opts instead of re-reading the hash. |
| Legacy shell flash | Default HTML shows legacy topbar + tab panels until JS runs; no early signal for hub hash routes. |
| `#/archive` / `#/archives/parts-requests` | Missing parse aliases — some URLs did not resolve to the intended filter. |

---

## Startup route order

### Before

1. Inline router script defines `applyRoute`
2. `/me` resolves → `applyPortalNavPermissions()` → **`applyRoute()` without HubUI**
3. `_lastAppliedRouteKey` cached (partial/wrong UI state)
4. `hub.js` init → `applyRoute()` **skipped** (same route key)
5. User sees overview or legacy shell

### After

1. **Head script** adds `html.hub-boot-hub` on every load → legacy panels hidden immediately
2. **HTML defaults** — `<body class="hub-mode">`, `#panel-hub-shell` visible, `#panel-home` + `.topbar` hidden
3. Inline router defines `applyRoute` with **HubUI gate** + `resetRouteCache()` + `{ force: true }`
3. `/me` → `applyPortalNavPermissions()` → `applyRoute()` **only if HubUI exists**
4. `hub.js` init → `resetRouteCache()` → **`applyRoute({ force: true })`**
5. `switchTab` → `onTabActivated(tab, opts)` → `initHubArchive` → **`parseArchiveRouteFromHash(location.hash)`** → mount category list

---

## Archive route parsing behavior

| URL | Filter | View |
|-----|--------|------|
| `#/archive` | `all` | Overview cards |
| `#/archives` | `all` | Overview cards |
| `#/archives/jsa` | `jsa` | JSA list |
| `#/archives/bol` | `bol` | BOL list |
| `#/archives/work-orders` | `work-orders` | Work Orders list |
| `#/archives/parts-requests` | `parts` | Parts Requests list |
| `#/archives/roll-off-swap` | `ros` | Roll Off Swap list |

**Source of truth:** `HubUnifiedArchive.parseArchiveRouteFromHash(window.location.hash)` — used by `initUnifiedArchive` and `initHubArchive`. Stale `_hubArchiveRoute` is not used to override an explicit hash category.

**Init guard:** `archiveInitSeq` prevents late overview count fetches from overwriting an active category mount.

---

## Shell hydration fix

- **`html.hub-boot-hub`** (set unconditionally in `<head>`) hides legacy topbar and non-hub tab panels until hydration completes
- **`body.hub-mode`** (default on `<body>`) keeps legacy chrome hidden after boot class removal
- **`hub.js` init** removes boot class after forced route apply
- **`applyRoute`** returns early when `HubUI.navigateShell` is unavailable; sets `__pendingRouteApply` flag (reserved for future use)

---

## Old shell visibility fix

Hub-first HTML + CSS in `index.html` / `hub.css`:

- `<body class="hub-mode">` — app loads in hub shell, not legacy portal
- `#panel-home` — `display:none`, `hidden`, `aria-hidden="true"` (Guiding Principles page never shown)
- `#panel-hub-shell` — visible by default (no inline `display:none`)
- `.topbar` — `hidden` + `aria-hidden="true"`

```css
body.hub-mode .topbar,
html.hub-boot-hub .topbar { display: none !important; }
body.hub-mode #panel-home,
html.hub-boot-hub #panel-home { display: none !important; }
body.hub-mode #panel-hub-shell,
html.hub-boot-hub #panel-hub-shell { display: block !important; }
body.hub-mode main.page > .tab-panel:not(#panel-hub-shell),
html.hub-boot-hub main.page > .tab-panel:not(#panel-hub-shell) { display: none !important; }
```

Legacy generator/archive panels still render **inside** the hub shell when mounted — never as the standalone portal chrome.

---

## Archive list mounting

When category route is active:

1. Mount filter bar with correct active pill
2. `clearArchiveMount` → `mountArchivePanel` → `hub-legacy-active` + `hub-archive-embedded`
3. `triggerArchiveLoad` (deferred via `requestAnimationFrame`)
4. List controls validated before fetch (`renderArchiveList` null guards)
5. Category-specific empty/error messages — **no bounce to overview**

Empty examples:
- `No BOL archive records found.`
- `No JSA archive records match your filters.`

---

## Files changed

| File | Change |
|------|--------|
| `index.html` | Early hub boot script; `parseHash` archive aliases; `applyRoute` HubUI gate + `resetRouteCache`; portal nav gate; `onTabActivated` opts; category empty messages |
| `hub.js` | Hash-first `initHubArchive`; `onTabActivated` route opts; forced hydration on init |
| `hub-unified-archive.js` | `parseArchiveRouteFromHash`, `getActiveArchiveFilterFromHash`, hash slug map, init seq guard |
| `hub.css` | `html.hub-boot-hub` boot styles |
| `scripts/templates/archive-route-hydration-test.js` | **New** — 30 static hydration checks |
| `scripts/templates/template-mvp-sidebar-consolidation-test.js` | Updated hash slug expectations |
| `package.json` | Added `templates:archive-route-hydration-test` |

---

## Tests run

| Command | Result |
|---------|--------|
| `npm run db:validate` | PASS |
| `npm run settings:ui-test` | PASS |
| `npm run templates:mvp-ia-test` | PASS |
| `npm run templates:mvp-sidebar-consolidation-test` | PASS |
| `npm run templates:new-request-registry-test` | PASS |
| `npm run templates:legacy-runtime-parity-test` | PASS |
| `npm run templates:forms-admin-rbac-readiness-test` | PASS |
| `npm run templates:archive-route-hydration-test` | PASS (30 checks) |
| `npm run vendor-dashboard:test` | PASS |
| `npm run vendor-master:test` | PASS |
| `npm run vendor-workflow:test` | PASS |
| `npm run vendor-documents:test` | PASS |
| `npm run vendor-document-notifications:test` | PASS |
| `npm run vendor-rbac-ui:test` | PASS |
| `npm run vendor-dashboard-queues:test` | PASS |

---

## Browser verification checklist

Manual verification at `http://127.0.0.1:3000/?_noauth=1`:

| # | Step | Expected |
|---|------|----------|
| 1 | Hard refresh `#/archives/bol` | Modern hub shell; BOL filter active; BOL list visible |
| 2 | Hard refresh `#/archives/jsa` | JSA list (not overview) |
| 3 | Hard refresh `#/archives/work-orders` | Work Orders list |
| 4 | Hard refresh `#/archives/parts-requests` | Parts Requests list |
| 5 | Hard refresh `#/archives/roll-off-swap` | Roll Off Swap list |
| 6 | Hard refresh `#/archives` or `#/archive` | Overview cards |
| 7 | No legacy topbar flash on any of the above | Hub shell only |
| 8 | Click overview → category → overview | Filters/cards still navigate correctly |
| 9 | Empty category | Category-specific empty message; stays on list view |
| 10 | Repeat in dark mode | Same behavior |

Use `npm run db:seed-archives` if lists are empty but should have demo data.

---

## Known limitations

- Early boot CSS uses hash prefix heuristics — non-hub deep links to legacy-only tabs (e.g. `#/bol` generator) still briefly use legacy chrome until JS hydrates (by design for generator routes).
- `__pendingRouteApply` flag is set but not replayed separately — hub init always force-reapplies route.
- Record deep links (`#/archives/bol/{id}`) rely on existing `deepLinkUnifiedArchive` retry loop — unchanged in this fix.

---

## Recommendation

**Ready for browser sign-off** on hard refresh archive deep links. After confirming locally, this unblocks reliable archive bookmarking and shared links without overview bounce or legacy shell flash.
