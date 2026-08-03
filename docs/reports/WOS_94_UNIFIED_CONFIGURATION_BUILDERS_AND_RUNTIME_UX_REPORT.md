# WOS-94 — Unified Configuration Builders and Runtime UX

**Branch:** `wos-94-unify-configuration-builders`  
**Commit:** _(filled after commit)_  
**Base:** WOS-93 configurable platform (`wos-93-configurable-platform-builder`)

---

## Executive summary

WOS-94 makes Configuration Center a **registry/orchestration shell**, not a second form editor. Forms open the existing **Workspace Forms builder** (`TemplateRegistryUI`). Critical browser defect `global is not defined` is fixed. Workflow builder gains handle-aware edges, assignment inspector, auto-layout, and read-only published behavior. New Request prefers **published request types** over duplicate form cards. Configurable workflow tasks surface in My Tasks.

---

## Root cause: `global is not defined`

### Cause

Several browser scripts used an IIFE footer:

```js
})(typeof window !== 'undefined' ? window : global);
```

In environments where `window` is absent (or when tooling evaluates the false branch), the bare identifier `global` throws `ReferenceError: global is not defined`. The Configuration Center module (`hub-configuration-center.js`) used this pattern and is loaded on hub pages, so form/admin flows could fail during script evaluation or subsequent module interaction.

This was **not** fixed with an unexplained `window.global = window` polyfill.

### Exact fix

All affected footers now use a browser-safe chain:

```js
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : typeof global !== 'undefined' ? global : this);
```

Files updated: `hub-configuration-center.js`, `hub.js`, `hub-form-renderer.js`, `hub-workflow-builder.js`, `rbac-client.js`, `app-spaces-ui.js`.

Regression: `scripts/security/unified-builders-runtime-ux-test.js` loads Configuration Center in a VM sandbox **without** Node `global` and asserts no ReferenceError.

---

## Canonical form-builder decision

| Surface | Role |
|---------|------|
| Configuration Center → Forms | **Registry only** (name, status, updated, actions) |
| Workspace Forms (`#/forms`, `TemplateRegistryUI`) | **Canonical authoring** (Build / Workflow / Full preview / Settings / JSON, live preview, clone-to-draft) |

`Open builder` / `Continue draft` / `View published` / `New form` navigate to `#/forms/templates/{id}/versions/{versionId}` (or Forms hub + New).

The unfinished Configuration Center field list with Up / Down / Remove is **removed** as the primary form editor.

---

## Configuration Center routing

- Shell: `#/configuration` (secondary nav: Overview, Request Types, Forms, Documents, Workflows, Dashboards, Variables, Saved Views, Validation, History)
- Forms registry → canonical Forms builder
- Workflows / Documents / Dashboards / Request Types → dedicated editors (registry → editor, not combined endless page)

---

## Request-type orchestration

Request type editor selects:

- Display name / description / prefix
- Starting form (Workspace Forms template id)
- Published workflow (cfg definition id)

New Request:

- When published request types exist → **one card per request type**
- Supporting published forms are **not** duplicated as start cards
- Legacy tools remain under Legacy Operations
- Accidental test labels (`dd`, `test`, …) filtered from default view

---

## Workflow graph

- Left node library, center canvas, right inspector
- Edges use source/target **handles** (`out` / `yes` / `no` / `in`) with cubic paths updated while dragging
- Auto-layout by BFS depth
- Published versions show read-only banner + Clone to draft
- Human nodes require Assignment (user / role / creator / form field / external) with fallback; missing assignment **blocks publish**

---

## Runtime visibility

- My Tasks loads `/hub/workflow-runtime/tasks` and lists configurable human tasks
- Completing a task posts to `/hub/workflow-runtime/tasks/:id/complete`

---

## Document / dashboard UX

- Documents: split Build + Live preview + searchable variable picker (not raw button row as primary)
- Dashboards: widget list + live layout preview

---

## Tests

| Suite | Result |
|-------|--------|
| `npm run security:unified-builders-runtime-ux-test` | (run) |
| `npm run security:configurable-platform-test` | (run) |
| Existing rbac / hardening / start-center / secret-scan | (run) |

---

## Known limitations

- Shared-role atomic claim is modeled (`strategy: shared_queue`) but full claim API polish continues
- Request Detail workflow map for configurable instances is partial (My Tasks + runtime APIs exist)
- Full admin E2E of all 46 prompt steps still requires manual browser pass on local/staging
- PDF sealing remains deferred

---

## Deployment

1. Deploy `wos-94-unify-configuration-builders`
2. Ensure migration `013` applied
3. `CONFIGURABLE_PLATFORM_ENABLED=1`
4. Restart PM2 / local `npm run dev:pg`
5. Open `#/configuration` → Forms → Open builder (Workspace Forms)

## Rollback

1. Disable flag or redeploy prior commit
2. Forms builder and legacy hub remain intact without Configuration Center
