# WOS-81 — Admin Help Center + Start Center

**Card:** WOS-81 — Admin Help Center + Start Center
**Scope:** Add a polished, static, admin-only **Start Center** inside the modern hub
shell so new admins understand how the MVP works. Frontend/static content only —
no DB migration, no onboarding tables, no CMS, no product-feature changes.

---

## Executive summary

WOS-81 delivers an **admin-only Start Center** at `#/start-center` with static
help content covering system overview, daily user flow, admin setup, Forms,
Workflows, New Request, My Tasks, Request Queue, Archive (including **Archive →
Forms** for submitted dynamic forms), Users and roles (including deactivate vs
delete guardrails), Reports, Analytics, legacy tools, a launch-day checklist, and
troubleshooting cards.

Access follows existing hub RBAC patterns: only **admin / hub_admin** see the
nav item; direct URL access for non-admins shows the standard in-page **Access
restricted** gate (same as Settings and Users). Content lives entirely in
`hub-start-center.js` — nothing is stored in the database.

**Final recommendation: Ready for staging review.**

---

## Route and nav added

| Item | Value |
|---|---|
| Nav label | **Start Center** |
| Route | `#/start-center` |
| Hub tab id | `hub-start-center` |
| Sidebar placement | Admin section, above **Users** and **Settings** |
| RBAC nav key | `hub:start-center-admin` |

Wiring added in:
- `index.html` — sidebar button, `hubPageStartCenter` panel, `parseHash`,
  `buildHash` fallback, `knownTabs`, `HUB_NATIVE_TABS`
- `hub.js` — `HUB_NATIVE_TABS`, `HUB_PAGE_META`, `buildRouteHash`,
  `initHubStartCenter`, `onTabActivated`
- `rbac-client.js` — `NAV_ITEM_RULES` + `HUB_TAB_RULES`

Hard refresh `/?_noauth=1#/start-center` resolves to the Start Center page inside
the hub shell (verified by route tests; manual UI walkthrough recommended on
staging).

---

## Admin-only access behavior

Three layers match existing admin pages (Settings, Users):

1. **Nav visibility** — `data-rbac-key="hub:start-center-admin"` gated by
   `RbacClient.applyNav`; requires `admin` or `hub_admin`.
2. **Router** — `applyRoute` includes `hub-start-center` in the RBAC-gated tab
   list; non-admins still land on the page but skip deep-link side effects.
3. **Page init** — `initHubStartCenter()` calls `canAccessHubTab('hub-start-center')`;
   on failure renders `renderAccessRestricted(root, 'Start Center')`.

Local/dev `?_noauth=1` bypass remains unchanged (portal no-auth mode).

---

## Content sections added

Static content module: `hub-start-center.js` (`HubStartCenter.renderStartCenter`).

**Top cards** (scroll to section):
1. Start here
2. Daily workflow
3. Admin setup
4. Launch checklist

**Accordion sections** (14):
1. System overview
2. Daily user flow
3. Admin setup flow
4. Forms
5. Workflows / approval routes
6. New Request
7. My Tasks
8. Request Queue
9. Archive
10. Users and roles
11. Reports and Analytics
12. Legacy tools
13. Launch-day checklist
14. Troubleshooting

All required Part D language is included verbatim where specified. MVP terms only
(New Request, Forms, Workflows, Approval routes, Users and roles, My Tasks,
Request Queue, Archive, Submitted records, Reports, Analytics, Settings).

**Banned terms not used** in Start Center content: App Spaces, Launch Registry,
Template Studio, schema_json, compiled workflow, WorkflowInstance.

---

## Launch checklist

Static checklist with session-only checkboxes (not persisted to DB or
localStorage). Includes all card-required items:

- Create or verify admin users
- Assign roles
- Create a test form → publish → confirm in New Request
- Submit test request → confirm record opens
- Confirm **Archive → Forms**
- Confirm workflow step for correct role → complete action
- Confirm legacy Archive categories still work
- Confirm dark mode readable
- Confirm non-admin users cannot access admin pages

---

## Troubleshooting section

Six troubleshooting cards:

1. Published form not in New Request (availability, role visibility, published vs draft)
2. Submitted form not in Archive (Archive → Forms, submission, permissions)
3. User cannot approve a step (assigned role, user role, signed-in user)
4. Form is read-only (published lock, clone to draft)
5. Role cannot be deleted (system roles, referenced roles, deactivate instead)
6. Archive looks empty (category, overview, filters)

---

## Archive → Forms explanation

The **Archive** accordion states:

> Archive stores completed and submitted records. Legacy records such as BOL, JSA,
> Work Orders, Parts Requests, and Roll Off Swap remain available. Submitted
> dynamic forms appear under **Archive → Forms**.

Launch checklist and troubleshooting sections reinforce checking **Archive → Forms**
for submitted dynamic form records.

---

## Role lifecycle explanation

The **Users and roles** accordion and troubleshooting card **"A role cannot be
deleted"** explain WOS-80 guardrails:

- System roles cannot be deleted
- Roles used by users, workflows, or submitted records cannot be hard-deleted
- Deactivate instead so old records remain readable

---

## Dark mode verification

Start Center styles in `hub.css` use hub design tokens (`--hub-surface`,
`--hub-border`, `--hub-ink`, `--hub-muted`, `--hub-teal`) with explicit
`html[data-theme="dark"]` overrides for top cards, accordions, chips, and
troubleshooting cards. No hard-coded white panels.

Manual verification: switch theme via topbar toggle on `#/start-center` and
confirm cards, accordion summaries, body text, checklist labels, and trouble
cards remain readable (recommended on staging).

---

## Files changed

| File | Change |
|---|---|
| `hub-start-center.js` | **New** — static content + accordion/top-card render |
| `hub.css` | Start Center layout, cards, accordions, checklist, dark mode |
| `hub.js` | Tab registration, route hash, `initHubStartCenter` |
| `rbac-client.js` | `hub:start-center-admin` nav + tab rules |
| `index.html` | Nav, page panel, router maps, script include |
| `scripts/templates/start-center-admin-help-test.js` | **New** — focused test (42 checks) |
| `package.json` | `templates:start-center-admin-help-test` script |

**No migration. No DB seeding. No backend API changes.**

---

## Tests run

New:
- `templates:start-center-admin-help-test` — **42/42 PASS**

Card-required suite (all **PASS**):
- `db:validate`, `settings:ui-test`, `templates:mvp-ia-test`,
  `templates:new-request-registry-test`, `templates:legacy-runtime-parity-test`,
  `templates:forms-admin-rbac-readiness-test`,
  `templates:archive-route-hydration-test`,
  `templates:archive-dynamic-forms-test`,
  `templates:role-lifecycle-guardrails-test`,
  `templates:shell-route-consistency-test`,
  `templates:workflow-tab-dark-mode-test`,
  `templates:dark-mode-surface-consistency-test`,
  `vendor-dashboard:test`, `vendor-master:test`, `vendor-workflow:test`,
  `vendor-documents:test`, `vendor-document-notifications:test`,
  `vendor-rbac-ui:test`, `vendor-dashboard-queues:test`

---

## Browser verification

Recommended manual steps (staging or local `?_noauth=1`):

1. Hard refresh `/?_noauth=1#/start-center` — page opens in hub shell
2. Light mode — top cards, accordions, checklist readable
3. Dark mode — all surfaces use hub tokens, no unreadable panels
4. Admin nav shows **Start Center** above Users/Settings
5. Content covers New Request, Forms, Workflows, Archive, Users/Roles, Reports,
   Analytics, legacy tools
6. **Archive → Forms** and role deactivate/delete guidance present
7. No banned internal terms in visible copy
8. Non-admin test account: nav hidden; direct `#/start-center` shows Access restricted

---

## Known limitations

- **Static content only** — updates require a code deploy (no CMS/editor).
- **Checklist state** is not saved (by design); checkboxes reset on refresh.
- **Non-admin list scoping** for Archive Forms is not repeated in depth (Archive
  section links to Forms category; troubleshooting covers permissions).
- **Local `?_noauth=1`** shows Start Center to all users in dev — staging SSO
  enforces real RBAC.

---

## Recommendation

**Ready for staging review** — admin-only Start Center is implemented with
correct RBAC, MVP-accurate copy (including Archive → Forms and role lifecycle),
dark-mode-safe styling, and all required tests passing. No database changes.
