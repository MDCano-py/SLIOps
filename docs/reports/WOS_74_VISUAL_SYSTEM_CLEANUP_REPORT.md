# WOS-74 — Visual System Cleanup: Roles, Legacy Form Typography, Archive, and Dark Mode Consistency

## Executive summary

WOS-74 improves visual consistency across the Operations Workflow Hub without changing workflow engine behavior, form submission logic, role assignment logic, or legacy generator functionality. The workflow role catalog no longer shows repetitive “name key” inline titles. Archive, BOL, and admin surfaces share hub design tokens for backgrounds, borders, typography, and dark-mode contrast. A focused static UI test (`npm run ui:visual-consistency-test`) guards the new patterns.

**Recommendation:** Ready for manual browser sign-off with `?_noauth=1` on Roles, Archive, and BOL generator routes.

---

## Files changed

| File | Change |
|------|--------|
| `index.html` | Workflow role catalog markup + render/filter/search JS; removed inline role-row CSS |
| `hub.css` | WOS-74 section: roles cards/filters, archive pagination/toolbar tokens, BOL form typography in shell, dark-mode overrides |
| `scripts/ui/visual-consistency-test.js` | **New** — static checks for roles metadata, archive, BOL, dark mode |
| `scripts/templates/template-dark-mode-ui-consistency-test.js` | Added WOS-74 dark-mode assertions for roles cards and archive pagination |
| `package.json` | Added `ui:visual-consistency-test` script |

---

## Before / after design intent

| Area | Before | After |
|------|--------|-------|
| Roles list | `<strong>Name</strong> <code>key</code>` inline — keys competed with display names | Display name is primary `<h3>`; description below; key in muted metadata row |
| Roles discovery | Full list only | Filter pills (All / Active / System / Custom) + search by name/key/description |
| Archive (hub page) | Mixed legacy `--paper` / `--line` pagination and toolbars | Hub token surfaces for toolbar, filters, pagination, empty states |
| BOL generator | Arial-only form chrome; section headers/labels felt disconnected from hub | Hub font, label weight, section headers, input focus ring — document canvas stays paper-white |
| Dark mode | Partial token use; roles/archive edges inconsistent | Shared `--hub-*` surfaces on roles cards, archive pagination, filter active states |

---

## Part A — Roles page cleanup

**Location:** Admin → Users → Workflow role catalog (`#hubWorkflowRolesCard`)

Changes:

- **Primary title:** role display name only (`hub-workflow-role-name`)
- **Description:** supporting paragraph below title when present
- **Internal key:** shown in `hub-workflow-role-key-meta` with small uppercase “Key” label — not in the title row
- **Badges:** Active / Archived + System / Custom on the right
- **Layout:** card rows with left content and right-side badges + Archive action
- **Filters:** All, Active, System, Custom pill buttons
- **Search:** lightweight text filter across name, key, and description
- **User counts:** not shown — API does not expose assignment counts; none fabricated

Business logic unchanged: create/archive still use existing RBAC routes and prompts.

---

## Part B — Legacy form typography cleanup (BOL)

**Location:** `#panel-bol` inside hub legacy content shell

Changes (CSS only in `hub.css`):

- Section headers: uppercase hub typography, teal accent, consistent spacing
- Labels: hub font, 600 weight, readable gray on white form surface
- Inputs/selects: hub font, 6px radius, teal focus ring
- Item cards and action buttons: aligned border radius and font family
- **Preserved:** all form IDs, handlers, generate/print behavior; `.bol-doc` and print output remain paper-white in dark mode

Document-style centered canvas and BOL PDF appearance unchanged.

---

## Part C — Archive visual parity

**Location:** `#hubPageArchive` unified archive hub + embedded archive panels

Changes:

- Hub panel, filter row, and content padding aligned with Forms/Requests pages
- Archive toolbar, search inputs, and date/creator filters use `--hub-surface`, `--hub-border`, `--hub-text`
- Pagination bar: hub surface-2 background, token borders, teal active page-size pills
- Prev/next buttons: hub border/text with teal hover
- Embedded archive lists inherit the same pagination/toolbar treatment via `.hub-archive-embedded` selectors

Archive data source, category filters, and record open behavior unchanged.

---

## Part D — Dark mode consistency

Normalized surfaces using shared `--hub-*` tokens:

| Surface | Dark-mode treatment |
|---------|---------------------|
| Workflow role cards | `--hub-surface` / `--hub-border`; badge colors adjusted for contrast |
| Role filter pills | Teal active state with `#062629` label text (matches archive/forms filters) |
| Archive pagination | Surface-2 bar; active page-size pill contrast fix |
| BOL form shell | Outer hub text uses hub tokens; inner `.bol-scope` forced paper-light (unchanged intent) |
| Users mount | Role catalog card uses hub panel styling when embedded in hub shell |

Reduced reliance on one-off `#2a4248` inline rules for roles (moved to token-based `hub.css`).

---

## Part E — Metadata visibility

Confirmed:

- Role **keys** remain visible for admin use in the metadata row beneath description
- Keys are monospace, muted, and visually secondary — not part of the human-facing title
- Forms Manage table continues to hide keys in the primary column (details in `forms-manage-meta-body`) — unchanged

---

## Part F — Tests run

All requested suites executed successfully:

| Command | Result |
|---------|--------|
| `npm run db:validate` | PASS |
| `npm run settings:ui-test` | PASS |
| `npm run templates:mvp-ia-test` | PASS |
| `npm run templates:ia-test` | PASS |
| `npm run templates:new-request-registry-test` | PASS |
| `npm run templates:legacy-runtime-parity-test` | PASS |
| `npm run templates:forms-admin-rbac-readiness-test` | PASS |
| `npm run ui:visual-consistency-test` | PASS (18 checks) |
| `npm run templates:dark-mode-ui-consistency-test` | PASS (22 checks, includes WOS-74 additions) |
| `npm run vendor-dashboard:test` | PASS |
| `npm run vendor-master:test` | PASS |
| `npm run vendor-workflow:test` | PASS |
| `npm run vendor-documents:test` | PASS |
| `npm run vendor-document-notifications:test` | PASS |
| `npm run vendor-rbac-ui:test` | PASS |
| `npm run vendor-dashboard-queues:test` | PASS |

---

## Part G — Browser verification checklist

Manual verification recommended at `http://127.0.0.1:3000/?_noauth=1`:

| # | Check | Expected |
|---|-------|----------|
| 1 | Admin → Users → Workflow role catalog | Names like “Accounts Payable” stand alone; keys appear only in muted “Key” row |
| 2 | Role filters + search | All/Active/System/Custom pills work; search narrows list without errors |
| 3 | Dark mode on Roles | Cards, filters, and badges readable; no low-contrast title/key bleed |
| 4 | Archive hub page | Filter pills, overview cards, embedded lists, and pagination match Forms styling |
| 5 | BOL generator (`#/generators/bol`) | Cleaner section headers/labels; form still generates and prints |
| 6 | Legacy behavior | No regressions in archive open, role create/archive, or BOL generate flow |

Static tests confirm markup/CSS patterns; visual polish should be confirmed in-browser with theme toggle.

---

## Known limitations

- **Role user counts** not displayed — would require a new API aggregation; intentionally omitted.
- **Portal permission bundles** (Redis Role Management under User Groups) retain their existing layout; this card focused on the Postgres workflow role catalog.
- **BOL document preview** (`#bol-doc`) keeps hardcoded print colors by design — only the input form chrome was modernized.
- **Other legacy generators** (JSA, Work Order, Parts, SWP) inherit general `hub-legacy-content` token mapping but did not receive the same section-level typography pass as BOL in this card.

---

## Recommendation

Ship WOS-74 after a quick browser pass on Roles (light + dark), Archive category drill-down, and BOL generate/print. No migration, API, or workflow changes required. Follow-up (optional): apply the BOL form chrome pattern to JSA/WO/Parts generator panels for full legacy parity.
