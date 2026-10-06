# SLIOps Frontend Redesign and Control Room Route Fix

## Starting point

Current secured release:

- Branch: `control-room-phase2-secure-base`
- SHA: `d678e535b7712308e54e413a8790e5b78585835a`

Create a new branch:

```bash
git checkout control-room-phase2-secure-base
git status --short
git checkout -b feature/sliops-ui-refinement
```

Do not proceed if the baseline SHA differs unexpectedly or the working tree contains unexplained changes.

**Do not modify the original release branch. Do not deploy.**

## Phase 1: Fix Control Room routing

The application currently displays:

`Control Room route not found`

at:

`http://127.0.0.1:3000/?_noauth=1#/control-room`

The Control Room implementation supposedly exists, including `hub-control-room.js`, `/hub/control-room/*` APIs and navigation registration.

Investigate:

1. `index.html` script loading and script order.
2. `hub.js` route registration and hash routing.
3. `hub-control-room.js` initialization and exported functions.
4. SPA route resolution and fallback behavior.
5. Missing imports, globals or runtime exceptions.
6. Asset serving and cache behavior.
7. The `?_noauth=1` development preview path.
8. Role gating and the distinction between authorization failures and missing routes.

Fix the underlying issue rather than hiding the error message.

### Acceptance tests

- `#/control-room` renders its actual UI.
- Refreshing that route works.
- Navigating away and back works.
- Authorized roles see the appropriate interface.
- Unauthorized roles receive an appropriate access-denied state.
- Missing station data produces the existing bootstrap state, not a routing error.
- Failed API calls display useful error states.
- All Control Room tabs render.
- Console has no uncaught errors.

Do not bypass RBAC to make the route work.

**Complete and test Phase 1 before redesigning anything.**

---

## Phase 2: Refine the existing SLIOps design

### Design objective

Create an Apple-inspired operations interface that feels carefully designed, restrained, functional and polished.

**Preserve Streamline's existing green identity.**

The existing dark green sidebar and teal-green accents are intentional. Do not replace them with generic monochrome SaaS styling.

Use the supplied screenshot as the existing visual baseline.

### Preserve

- Streamline logo and branding.
- Dark green navigation identity.
- Green selected navigation state.
- Green primary actions.
- Existing application routes.
- Current authentication and RBAC.
- Existing Operations Workflow Hub features.
- All Control Room functionality.
- Existing backend/API contracts.
- Request and document workflows.

### Improve

- Navigation hierarchy.
- Spacing and alignment.
- Visual consistency.
- Typography.
- Card and panel geometry.
- Responsive behavior.
- Empty and error states.
- Dense information layouts.
- Form organization.
- Table readability.
- Modal and drawer behavior.
- User feedback after actions.

Do not overuse blur, gradients, shadows or decorative illustrations.

Use glass effects selectively on the shell and elevated surfaces.

Operational tables, forms and shift timelines should favor readability over visual effects.

## Phase 3: Design infrastructure

Build a small reusable visual foundation using the application's current CSS and JavaScript architecture.

Do not introduce React, Vue, Tailwind or another framework unless the repository already uses it.

Create or centralize design tokens for:

- Surface colors.
- Sidebar colors.
- Primary and secondary green.
- Text colors.
- Border colors.
- Spacing.
- Border radii.
- Shadows.
- Typography.
- Focus states.
- Status colors.
- Light and dark themes.

### Reference color direction

```css
:root {
  --sli-sidebar: #102d2b;
  --sli-sidebar-deep: #0b211f;
  --sli-sidebar-active: #23554f;

  --sli-green: #087c70;
  --sli-green-hover: #096b62;
  --sli-green-soft: #e3f2ee;

  --sli-background: #f3f6f5;
  --sli-surface: #ffffff;
  --sli-surface-glass: rgba(255, 255, 255, 0.78);

  --sli-text: #142523;
  --sli-text-secondary: #71817d;
  --sli-border: #dfe7e4;

  --sli-radius-sm: 10px;
  --sli-radius-md: 16px;
  --sli-radius-lg: 22px;

  --sli-shadow:
    0 8px 28px rgba(13, 49, 43, 0.055);
}
```

These are starting values, not mandatory exact colors. Tune them against the current branding.

### HTML layout reference

Use the following as structural guidance, not as a replacement application:

```html
<div class="sli-app">

  <aside class="sli-sidebar">
    <div class="sli-brand">
      <img
        src="EXISTING_STREAMLINE_LOGO"
        alt="Streamline"
      />
      <div>
        <strong>Streamline</strong>
        <small>OPERATIONS HUB</small>
      </div>
    </div>

    <nav class="sli-navigation">
      <a class="sli-nav-item active">Dashboard</a>
      <a class="sli-nav-item">Requests</a>
      <a class="sli-nav-item">My Work</a>
      <a class="sli-nav-item">Control Room</a>
      <a class="sli-nav-item">Documents</a>

      <div class="sli-nav-section">More</div>

      <a class="sli-nav-item">Operations Tools</a>
      <a class="sli-nav-item">Insights</a>
      <a class="sli-nav-item">Admin</a>
    </nav>
  </aside>

  <div class="sli-main">

    <header class="sli-topbar">
      <div class="sli-search">
        Search requests, documents, equipment...
      </div>

      <div class="sli-actions">
        <button>Notifications</button>
        <button>Theme</button>
        <button class="sli-primary">New Request</button>
      </div>
    </header>

    <main class="sli-content">

      <div class="sli-page-header">
        <div>
          <h1>Control Room</h1>
          <p>Current operations and shift continuity.</p>
        </div>
      </div>

      <section class="sli-summary-grid">
        <article class="sli-panel">
          Current Shift
        </article>

        <article class="sli-panel">
          Needs Attention
        </article>

        <article class="sli-panel">
          Open Tasks
        </article>
      </section>

      <section class="sli-workspace">
        <div class="sli-panel">
          Shift Timeline
        </div>

        <div class="sli-panel">
          Quick Log
        </div>
      </section>

    </main>
  </div>
</div>
```

### Glass panel treatment

```css
.sli-panel {
  background: var(--sli-surface-glass);
  border: 1px solid rgba(255,255,255,0.85);
  border-radius: var(--sli-radius-lg);
  box-shadow: var(--sli-shadow);
}

@supports (backdrop-filter: blur(12px)) {
  .sli-panel--glass {
    backdrop-filter: blur(12px);
  }
}

.sli-sidebar {
  background: linear-gradient(
    180deg,
    var(--sli-sidebar),
    var(--sli-sidebar-deep)
  );
}

.sli-nav-item.active {
  background: var(--sli-sidebar-active);
  color: white;
}

.sli-primary {
  background: var(--sli-green);
  color: white;
  border-radius: var(--sli-radius-sm);
}
```

Do not apply glass blur to every element.

Use solid surfaces for large forms, operational tables and dense text.

---

## Phase 4: Simplify navigation carefully

Current navigation contains too many top-level entries.

Propose a cleaner grouping:

**Primary**

- Dashboard
- Requests
- My Work
- Control Room
- Documents

**Operations Tools**

- Parts Request
- Work Orders
- Generators
- JSA Generator
- Safe Work Permits
- Forms

**Insights**

- Reports
- Analytics

**Administration**

- Users
- Configuration
- SSO
- Vendor Management
- Settings
- Start Center

Prefer collapsible navigation groups.

Do not delete functional modules.

Do not automatically convert existing modules into generic workflows unless their implementation supports that change.

Preserve all existing deep links.

Preserve permission-based visibility.

The navigation redesign is primarily a presentation change.

---

## Phase 5: Dashboard redesign

The current dashboard has too many low-priority metrics competing for attention.

Prioritize:

1. Needs Attention.
2. My Assigned Work.
3. Current Operational Status.
4. Requests.
5. Recent Activity.

Retain useful existing metrics through secondary views.

Avoid charts with no meaningful data.

Do not manufacture records, percentages, performance numbers or sample users in production.

When there is no data, display a useful empty state.

Staging-only seed controls must not appear in production.

---

## Phase 6: Control Room design

Use the actual implementation from the current branch.

Preserve:

- Current Shift.
- Quick Log.
- Timeline.
- Acknowledgements.
- Handover.
- Operating Board.
- Tasks.
- Schedule.
- History.
- Supervisor Overview.

### Current Shift layout

Top section:

- Station.
- Shift.
- Current operator/assignment.
- Current status.
- Important counts.

Middle section:

- Timeline occupying the main column.
- Quick Log in the secondary column.

Lower section or tabs:

- Open board items.
- Tasks.
- Handover.

Do not force the operator to navigate across multiple screens to log a simple event.

### Important

When stations have not yet been configured, show the existing setup/empty state.

Do not create fake stations.

Do not bypass permissions.

Do not duplicate Control Room endpoints.

---

## Phase 7: Component consistency

Standardize the following existing UI patterns:

1. Buttons.
2. Text inputs.
3. Selects.
4. Search.
5. Tabs.
6. Cards.
7. Tables.
8. Badges.
9. Modals.
10. Drawers.
11. Toasts.
12. Loading indicators.
13. Empty states.
14. Error states.
15. Permission-denied states.

Every action must have meaningful behavior.

Avoid decorative controls that do nothing.

Maintain keyboard support and visible focus indicators.

---

## Phase 8: Regression testing

Run all existing security and WOS suites.

Specifically verify:

- Login and logout.
- No SSO redirect loops.
- Role-based navigation.
- Control Room route.
- Control Room API authorization.
- Request creation.
- Request workflow transitions.
- Document upload and retrieval.
- Client Fill/Review/Sign.
- MaintainX integration.
- Admin interfaces.
- Dashboard.
- Direct route refresh.
- Dark mode.
- Responsive layout.
- No JavaScript console errors.

Do not change server-side role mappings as part of a styling refactor.

Do not modify migration `015_control_room.sql` unless necessary to correct an independently verified defect.

---

## Final requirements

Keep the redesign on:

`feature/sliops-ui-refinement`

Do not merge or deploy.

Do not make unrelated security architecture changes.

Return only:

1. Route issue root cause and fix.
2. Changed files.
3. UI areas redesigned.
4. Navigation changes.
5. Functional regressions discovered/fixed.
6. Tests passed/failed.
7. Screenshots of Dashboard and Control Room in light and dark mode, if screenshot tooling is available.
8. Final commit SHA.
9. Whether the branch is ready for local visual approval.

**The goal is an elegant, consistent Streamline Operations Hub that is more intuitive to operate, not a completely different product.**