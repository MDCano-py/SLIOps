# WOS-74 — Route Activation + Dark Mode Surface Consistency Fix

## Executive summary

WOS-74 resolves two launch-blocking polish issues: archive category navigation requiring two clicks, and Forms builder dark-mode surface mismatches. The archive fix addresses a race where stale overview count fetches overwrote mounted category lists. The dark-mode fix aligns builder tabs, read-only banners, preview chrome, and field/section surfaces with hub tokens.

**Recommendation: Ready** for browser verification with `?_noauth=1`.

---

## Archive first-click root cause

Three interacting bugs caused the “first click updates URL, second click shows list” behavior:

1. **Stale `fetchArchiveCounts` overwrite** — When the overview loaded, an async count fetch could complete after the user clicked a category. The callback checked `getActiveArchiveFilterFromHash()` but the hash had not yet been updated (hash sync ran *after* mount), so it still read `all` and replaced the mounted list with overview HTML.

2. **Duplicate click handlers** — Both event delegation on `#hubArchiveRoot` and per-button listeners from `wireFilterButtons` fired on the same click, causing concurrent `initUnifiedArchive` runs that could abort each other mid-mount.

3. **Hash-after-mount ordering** — `selectArchiveFilter` mounted the category view before updating `location.hash`, so any hash-based guard during async work saw the previous route.

---

## Route activation fix

| Change | File |
|--------|------|
| `syncArchiveHash()` — update URL before mount | `hub-unified-archive.js` |
| `selectArchiveFilter()` — hash first, in-flight coalescing | `hub-unified-archive.js` |
| `resolveArchiveFilter()` — explicit `opts.filter` wins over hash | `hub-unified-archive.js` |
| `applyArchiveRouteFromHash()` — single entry for hard refresh / back-forward | `hub-unified-archive.js` |
| Overview count guard — skip if `.hub-archive-embedded` present | `hub-unified-archive.js` |
| Single delegation handler with `stopPropagation` | `hub-unified-archive.js` |
| `wireFilterButtons()` — marks wired only (no duplicate listeners) | `hub-unified-archive.js` |
| `navigateShell('hub-archive')` — skip `clearLegacyMount` | `hub.js` |
| `initHubArchive()` — mount via `applyArchiveRouteFromHash` before permissions | `hub.js` |

### Archive route mapping (verified in tests)

| URL | View |
|-----|------|
| `#/archive` | Overview / All |
| `#/archives` | Overview / All |
| `#/archives/jsa` | JSA list |
| `#/archives/bol` | BOL list |
| `#/archives/work-orders` | Work Orders list |
| `#/archives/parts-requests` | Parts Requests list |
| `#/archives/roll-off-swap` | Roll Off Swap list |

---

## Hard refresh behavior

- `<body class="hub-mode">` and `#panel-hub-shell` visible by default (from prior hydration fix)
- `html.hub-boot-hub` applied unconditionally in `<head>`
- `hub.js` init calls `resetRouteCache()` + `applyRoute({ force: true })`
- Category deep links call `applyArchiveRouteFromHash()` with hash as source of truth

---

## Old shell visibility verification

| Control | Status |
|---------|--------|
| Legacy `.topbar` hidden by default (`hidden`, `aria-hidden`) | ✓ |
| `#panel-home` hidden by default | ✓ |
| `#panel-hub-shell` visible by default | ✓ |
| `body.hub-mode` + `hub-boot-hub` CSS hide legacy panels | ✓ |
| Legacy archive panels mount inside hub shell via `.hub-archive-embedded` | ✓ |

---

## Forms builder dark mode fixes

Dark-mode rules added for:

- **Tab strip** (`.tmpl-studio-tabs`, `.tmpl-studio-tab.is-active`) — hub surface tokens, no white bar
- **Read-only banner** (`.tmpl-readonly-banner`) — dark blue surface with readable text
- **Preview header / section head / footer** — dark gradients and borders
- **Preview badges** — dark-compatible pill colors
- **Section card heads** — dark gradient headers
- **Preview frame chrome and body** — framed dark preview canvas
- **Builder toolbar, editor sections, field stack** — hub surface tokens in `hub.css`

Preview form canvas remains intentionally readable; chrome around it uses hub tokens for cohesion.

---

## Files changed

| File | Change |
|------|--------|
| `hub-unified-archive.js` | Route activation fix: sync hash first, coalescing, guards |
| `hub.js` | `applyArchiveRouteFromHash` integration, archive navigateShell |
| `index.html` | WOS-74 builder dark-mode CSS block |
| `hub.css` | WOS-74 hub-shell builder dark-mode tokens |
| `package.json` | `templates:dark-mode-surface-consistency-test` alias |
| `scripts/templates/archive-route-hydration-test.js` | Extended archive activation tests (51 checks) |
| `scripts/templates/template-dark-mode-ui-consistency-test.js` | WOS-74 builder dark-mode checks (30 checks) |

---

## Tests run

| Suite | Result |
|-------|--------|
| `npm run db:validate` | PASS |
| `npm run settings:ui-test` | PASS |
| `npm run templates:mvp-ia-test` | PASS |
| `npm run templates:mvp-sidebar-consolidation-test` | PASS |
| `npm run templates:new-request-registry-test` | PASS |
| `npm run templates:legacy-runtime-parity-test` | PASS |
| `npm run templates:forms-admin-rbac-readiness-test` | PASS |
| `npm run templates:archive-route-hydration-test` | PASS (51 checks) |
| `npm run templates:dark-mode-surface-consistency-test` | PASS (30 checks) |
| `npm run vendor-dashboard:test` | PASS |
| `npm run vendor-master:test` | PASS |
| `npm run vendor-workflow:test` | PASS |
| `npm run vendor-documents:test` | PASS |
| `npm run vendor-document-notifications:test` | PASS |
| `npm run vendor-rbac-ui:test` | PASS |
| `npm run vendor-dashboard-queues:test` | PASS |

---

## Browser verification

### Archive

1. Hard refresh `/?_noauth=1#/archive` → overview cards
2. Click **BOL** once → BOL list mounts immediately
3. Click **All** → overview returns
4. Click **JSA** once → JSA list mounts
5. Repeat for Work Orders, Parts Requests, Roll Off Swap
6. Hard refresh `/?_noauth=1#/archives/bol` → BOL list direct
7. Browser back/forward between overview and categories
8. Confirm legacy topbar / Guiding Principles shell never appears

### Forms dark mode

1. Hard refresh `/?_noauth=1#/forms`
2. Open a form in builder
3. Toggle dark mode
4. Tab strip not white; read-only banner dark-compatible
5. Live preview framed with dark chrome; field rows readable

---

## Known limitations

- Preview form canvas inside the builder intentionally uses a lighter “paper” surface inside the dark frame for form readability; full dark preview body is not applied to field inputs inside the live preview mock.
- Archive overview count badges remain best-effort async; they no longer overwrite active category views.
- `applyPortalNavPermissions` in `index.html` may still call `applyRoute()` on `/me` resolve; route cache prevents duplicate work when the hash is unchanged.

---

## Acceptance criteria

| Criterion | Status |
|-----------|--------|
| Archive category opens on first click | ✓ Fixed |
| Archive hard refresh category routes work | ✓ |
| Archive does not bounce to overview unless route is overview | ✓ |
| Old shell does not remain visible for hub routes | ✓ |
| Forms builder dark mode surface consistency | ✓ |
| Existing tests pass | ✓ |
| Report created | ✓ |
