# WOS-95 — Curated Workflow Designer and Configuration UI Refinement Report

## Summary

Focused refinement of the Configuration Center workflow designer and related editors on the existing WOS-93/94 configurable platform. Interaction quality was studied from a local n8n reference tree (fair-code / Sustainable Use License) and **reimplemented** in vanilla JS. No n8n source, branding, or `.ee.` code was copied. Native browser dialogs for sign-out and definition creation were replaced with WOS modals.

## Branch

`wos-95-curated-workflow-designer-ui`

## Commit

`ae83411f1600549dd6357ad04c465274539f5f08` � `WOS-95 refine workflow designer and configuration editor UX`

## n8n reference

| Item | Value |
|------|--------|
| Path | `reference/n8n` (gitignored) |
| Commit inspected | `73841560ad76a5ffc7b7a9d9d368713358667bc6` |
| Licensing audit | [WOS_95_N8N_REFERENCE_AUDIT.md](./WOS_95_N8N_REFERENCE_AUDIT.md) |

## Patterns studied

Canvas coordinates, handle-based edges, connection preview, fit/zoom/pan, minimap, searchable node library, selected-node inspector, read-only presentation.

## Patterns reimplemented

- Single world transform for nodes + SVG edges
- Curated WOS node library (Start / People / Decisions / Documents / Notifications / Automation / Request updates / End)
- Named branch handles (Yes/No, Rejected)
- Auto-layout, fit workflow, center selection, reset zoom
- Minimap + outline
- Mode-specific assignment inspector with live role/user preview
- Single-start enforcement (replace prompt)
- Structured document blocks + live preview
- Dashboard widget structure + live preview
- Sticky editor headers, breadcrumbs, unsaved state, Archive in More menu
- `streamlineModal.form` for create-draft; branded sign-out confirm

## Source copied

**None.**

## Source attribution

N/A (no copies). See licensing audit.

## Dialog replacements

| Flow | Before | After |
|------|--------|-------|
| Sign out | `window.confirm` | `streamlineModal.confirm` (focus Cancel) |
| Create definition | stacked `prompt` | `streamlineModal.form` with slugify + uniqueness |
| Archive | `confirm` | WOS confirm in More menu |
| Remove node / connection | inline / prompt | WOS confirm |
| Connect nodes | `prompt` keys | drag from output handle |

Note: legacy BOL / JSA / vendor forms elsewhere in `index.html` may still use native dialogs; Configuration Center + hub shell sign-out are covered by this card.

## Canvas architecture

`hub-workflow-designer.js` mounts a three-pane workspace (library / canvas / inspector) into Configuration Center. Graph payload remains `{ nodes, connections }` on the draft version.

## Edge routing

Cubic Bezier paths from live handle geometry (`handlePoint`). Arrow markers. Labels follow midpoints. Preview line while linking.

## Auto-layout behavior

BFS from the start node; success path left-to-right; reject/no branches offset downward; then fit-to-view.

## Assignment inspector

Tabs: General / Assignment / Advanced. Assignment fields are conditional on mode. Static role mode lists active eligible users when role membership is available. Changes mark the draft unsaved; global Save draft persists.

## Document editor changes

Default authoring is structured blocks; raw HTML under Advanced source. Variable picker by category. Preview toggles sample values vs keys.

## Dashboard editor changes

Widget structure editor with titles/sizes and live grid preview (not a bare name list).

## Routes changed

None (existing `/hub/configuration/*` APIs).

## Components created

- `hub-workflow-designer.js`
- `streamlineModal.form` in `index.html`
- CSS: `.wfd-*`, `.cfg-editor-header`, `.cfg-breadcrumb`, …

## Tests

- `npm run security:wos95-curated-workflow-designer-ui-test`
- `npm run security:unified-builders-runtime-ux-test`
- `npm run security:configurable-platform-test`

## Screenshots

Not attached in-repo; verify locally:

1. Configuration Center → Workflows → open draft → curated library + canvas
2. Sign out modal copy
3. Create dashboard modal with auto stable key
4. Document blocks + sample preview
5. Light and dark themes

## Known limitations

- Full-app native dialog purge outside Configuration Center / sign-out is incomplete
- Undo/redo stack not yet implemented (layout/manual moves persist only via Save draft)
- Multi-select and keyboard connection alternative are minimal
- Template picker uses a key field rather than a rich gallery UI
- Timing / Visibility inspector tabs deferred
- Runtime execution highlighting on the request map reuses styles but is not a separate viewer page in this pass

## Deployment notes

1. Deploy updated static assets (`hub-workflow-designer.js`, `hub-configuration-center.js`, `hub.css`, `index.html`, `hub.js`).
2. Ensure `CONFIGURABLE_PLATFORM_ENABLED=1` where Configuration Center is used.
3. Do **not** deploy `reference/n8n` or `n8n-master/`.

## Rollback notes

Revert this branch commit(s). Prior WOS-94 Configuration Center workflow canvas returns. No migration changes in this card.
