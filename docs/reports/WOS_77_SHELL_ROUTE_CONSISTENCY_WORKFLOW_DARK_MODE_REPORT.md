# WOS-77 — Shell Route Consistency + Forms Workflow Dark Mode Fix

## Executive summary

Two browser-visible issues were fixed ahead of the RDS staging migration:

1. **Dashboard / Reports / Analytics route mismatch.** The sidebar "Analytics"
   link was wired to `data-hub-tab="hub-dashboard"`, so it had no route, no page,
   and no content of its own. Clicking it mounted the Operations Dashboard while
   `setSidebarForTab` highlighted *both* the Dashboard and Analytics links (they
   shared the `hub-dashboard` tab id). Analytics is now a first-class hub tab with
   its own route (`#/analytics`), page panel, active-nav state, and render path.
   Dashboard, Reports, and Analytics now each keep route → active nav → mounted
   content aligned on hard refresh and browser back/forward.

2. **Forms builder Workflow tab dark-mode mismatch.** The workflow builder's
   `tmpl-*` surfaces relied on CSS tokens (`--surface`, `--surface-2`, `--border`)
   that are **never defined**, so they always fell back to their light hex defaults
   (e.g. `#f8fafc`) even in dark mode. Dark-mode overrides mapped onto the real hub
   tokens were added for step cards, step-type badges, dropdowns, checkboxes/labels,
   the Workflow Binding section, and warning/error panels.

No product features, DB schema, migrations, workflow business logic, or legacy
functionality were changed. This was a route-consistency and dark-mode polish card.

**Final recommendation: Ready for RDS staging migration.**

---

## Issue 1 — Dashboard / Reports / Analytics route mismatch

### Root cause

- `index.html` sidebar: the Analytics nav button used
  `data-hub-tab="hub-dashboard"`. There was no `hub-analytics` tab anywhere.
- `hub.js` `setSidebarForTab()` marks a nav link active when
  `el.dataset.hubTab === tabName`. Because two links (Dashboard and Analytics)
  both carried `hub-dashboard`, navigating to the dashboard highlighted **both**,
  and clicking Analytics simply re-ran the dashboard.
- `#/analytics` was never parsed to a distinct tab, so a hard refresh on
  `#/analytics` fell through `applyRoute`'s `knownTabs` fallback to `hub-dashboard`
  → naked Operations Dashboard content under an "Analytics" highlight.

### Route / content / nav fix

Analytics was promoted to a real hub tab, parallel to Dashboard and Reports:

- **`index.html`**
  - Analytics sidebar link now uses `data-hub-tab="hub-analytics"`.
  - New page panel `#hubPageAnalytics` (`data-hub-page="hub-analytics"`) with its
    own `<h1>Analytics</h1>` and `#hubAnalyticsRoot` content container.
  - `parseHash()` now maps `#/dashboard` → `hub-dashboard`, `#/analytics` →
    `hub-analytics`, alongside the existing `#/reports` → `hub-reports`.
  - `applyRoute()` `knownTabs` and the shell `HUB_NATIVE_TABS` list include
    `hub-analytics`.
  - `buildHash()` fallback maps `hub-dashboard` → `#/dashboard` and
    `hub-analytics` → `#/analytics`.
- **`hub.js`**
  - `HUB_NATIVE_TABS` and `HUB_PAGE_META` include `hub-analytics`.
  - New `initHubAnalytics()` render function calls
    `showHubPage('hub-analytics')` + `setSidebarForTab('hub-analytics')` and
    renders an Analytics-labelled view (KPIs + status/type breakdown + a trends
    placeholder that explicitly names the Analytics surface). It never mounts the
    dashboard page.
  - `onTabActivated()` wires `hub-analytics` → `initHubAnalytics()`.
  - `buildRouteHash()` maps `hub-dashboard` → `#/dashboard` and `hub-analytics`
    → `#/analytics` so each route keeps its own hash.

Because each of the three tabs now has a unique tab id, `setSidebarForTab` marks
exactly one nav link active, and `showHubPage` mounts exactly one page — route,
active nav, and content are always aligned.

### Hard refresh verification

Traced via the automated route test and code paths:

- `/?_noauth=1#/dashboard` → `parseHash` → `hub-dashboard` → `initDashboard()` →
  Dashboard page + Dashboard nav active. Analytics not active.
- `/?_noauth=1#/reports` → `hub-reports` → `initHubReports()` → Reports page +
  Reports nav active. Dashboard content not shown.
- `/?_noauth=1#/analytics` → `hub-analytics` → `initHubAnalytics()` → Analytics
  page + Analytics nav active. Operations Dashboard content not shown.
- `HubUI.init()` calls `resetRouteCache()` then `applyRoute({ force: true })`, so
  hard refresh hydrates from the URL rather than defaulting to the dashboard.

### Browser back/forward verification

- `switchTab` writes the canonical hash for each tab via
  `streamlineRouter.setHash(buildHash(...))`; `hub-dashboard`/`hub-analytics`/
  `hub-reports` now resolve to `#/dashboard`/`#/analytics`/`#/reports`.
- `setHash` uses `pushState` for real navigations, so back/forward emit
  `hashchange`/`popstate` → `applyRoute()` re-parses and re-mounts the matching
  tab. Since parse and build are symmetric per tab, back/forward keep
  route/content/nav aligned and the modern hub shell wraps all three.

---

## Issue 2 — Forms builder Workflow tab dark mode

### Root cause

The `tmpl-*` builder CSS (in `index.html`) uses `var(--surface, #fff)`,
`var(--surface-2, #f8fafc)`, and `var(--border, #e2e8f0)`. Those three tokens are
not defined anywhere in the project (only `--ink`/`--ink-soft` and the `--hub-*`
tokens are), so the light hex fallbacks always won — including in dark mode. That
is why the Workflow tab showed light step cards, light Fill/Review/Sign panels,
light dropdowns, and a light Workflow Binding section under the dark shell.

### Fixes

Added a scoped `html[data-theme="dark"] .hub-shell …` block at the end of
`hub.css` (the same place WOS-74's builder dark-mode rules live) that re-maps the
workflow-tab surfaces onto the real hub dark tokens:

- **Step / field cards** (`.tmpl-step-row`, `.tmpl-field-row`,
  `.tmpl-section-card`, `.tmpl-section-card-head`) → `--hub-surface`/
  `--hub-surface-2` + `--hub-border` + `--hub-text`.
- **Step-type badges** (Fill/Review/Approve/Sign/Upload) → translucent
  dark-friendly backgrounds with readable light text.
- **Dropdowns** in step rows, editor sections, and the binding section →
  `--hub-surface` + `--hub-border` + `--hub-text`.
- **Checkboxes / field-key labels** → `--hub-text`; checkbox `accent-color` uses
  `--hub-teal`.
- **Workflow Binding section** (`.tmpl-binding-section`, `.tmpl-binding-status`)
  → matches the builder cards.
- **Warning / error panels** (`.tmpl-api-error`, `.tmpl-validation-fail`,
  `.tmpl-val-group-count`, `.tmpl-import-warnings`) → dark-mode compatible
  danger/warning surfaces. (`.hub-settings-inline-warn` already had a dark rule.)
- **Move up/down and delete buttons** already use `.hub-btn.hub-btn-ghost`, which
  is token-driven (`--hub-muted`/`--hub-border`) and therefore correct in dark
  mode once the surrounding card is dark; verified by test.

No workflow step behavior, assignee-role behavior, publish behavior, validation
behavior, or form schema behavior was touched — CSS/markup class only.

---

## Files changed

| File | Change |
|------|--------|
| `hub.js` | Added `hub-analytics` to `HUB_NATIVE_TABS` + `HUB_PAGE_META`; new `initHubAnalytics()`; wired it in `onTabActivated`; `buildRouteHash` maps dashboard→`#/dashboard`, analytics→`#/analytics`; exported `initHubAnalytics`. |
| `index.html` | Analytics nav link → `hub-analytics`; new `#hubPageAnalytics` panel; `parseHash` maps `#/dashboard` & `#/analytics`; `applyRoute` `knownTabs` + `HUB_NATIVE_TABS` include `hub-analytics`; `buildHash` fallback for dashboard/analytics. |
| `hub.css` | New WOS-77 dark-mode block for the Workflow tab builder surfaces (step cards, badges, dropdowns, checkboxes, binding section, warning/error panels). |
| `package.json` | Added `templates:shell-route-consistency-test` and `templates:workflow-tab-dark-mode-test`. |
| `scripts/templates/template-shell-route-consistency-test.js` | New focused test (24 checks). |
| `scripts/templates/template-workflow-tab-dark-mode-test.js` | New focused test (20 checks). |

---

## Tests run

All commands from the card passed, plus the two new focused tests.

| Command | Result |
|---------|--------|
| `npm run db:validate` | PASS (staging-safe, no demo data) |
| `npm run settings:ui-test` | PASS (14) |
| `npm run templates:mvp-ia-test` | PASS (29) |
| `npm run templates:mvp-sidebar-consolidation-test` | PASS (38) |
| `npm run templates:new-request-registry-test` | PASS (59) |
| `npm run templates:legacy-runtime-parity-test` | PASS (46) |
| `npm run templates:forms-admin-rbac-readiness-test` | PASS (32) |
| `npm run templates:archive-route-hydration-test` | PASS (51) |
| `npm run templates:dark-mode-surface-consistency-test` | PASS (30) |
| `npm run vendor-dashboard:test` | PASS (13) |
| `npm run vendor-master:test` | PASS (20) |
| `npm run vendor-workflow:test` | PASS (36) |
| `npm run vendor-documents:test` | PASS (24) |
| `npm run vendor-document-notifications:test` | PASS (21) |
| `npm run vendor-rbac-ui:test` | PASS (31) |
| `npm run vendor-dashboard-queues:test` | PASS (30) |
| `npm run templates:shell-route-consistency-test` *(new)* | PASS (24) |
| `npm run templates:workflow-tab-dark-mode-test` *(new)* | PASS (20) |

---

## Browser verification

Route wiring, active-nav state, and content mounting were verified via the new
`templates:shell-route-consistency-test` (which asserts the route → tab → page →
init-function chain) and by tracing `wireShellNav` → `switchTab` → `navigateShell`
→ `onTabActivated`. Dark-mode surfaces were verified via
`templates:workflow-tab-dark-mode-test` and the existing
`dark-mode-surface-consistency-test`.

Recommended manual confirmation in a browser (unchanged from the card checklist):

- Hard refresh `/?_noauth=1#/dashboard`, `#/reports`, `#/analytics` and confirm
  the active nav + page title match each route and Analytics never shows
  Operations Dashboard content.
- Exercise back/forward across the three routes and confirm alignment.
- Open a draft form → Workflow tab → dark mode and confirm step cards, Fill/
  Review/Sign cards, dropdowns, move/delete buttons, checkboxes/labels, badges,
  and the Workflow Binding section are all dark-native with no light panels.

---

## Known limitations

- The Analytics view currently renders a KPI + status/type summary with an
  explicit "Trends" placeholder (clearly labelled as Analytics, distinct from
  Reports). Deeper trend analytics (cycle time over time, throughput by team) are
  intentionally deferred — this card is route/polish only and adds no new
  product features.
- Browser verification here was performed through automated route/DOM tests and
  code-path tracing; a final manual pass in a live browser is recommended per the
  checklist above.

---

## Recommendation

**Ready for RDS staging migration.** Both browser-visible issues are resolved,
all existing tests pass, and two focused regression tests were added and pass.
