# WOS-97 — Functional Workflow Connection Authoring Report

## Summary

Administrators can now author workflow process graphs by dragging visible output handles to input handles. The same persisted connection records drive validation and runtime continuation (by `source` + `outcome_key` / `source_handle`), not canvas position.

## Root cause of missing connection UI

The curated designer (WOS-95) rendered handles and edges, but connection drag used canvas `setPointerCapture` while canvas `pointerup` cleared `linking` without calling a finish handler. Handle-level completion never ran reliably, so drag-to-connect felt broken. Secondary “Connect…” flows were not an adequate substitute for handle-based authoring.

## Canvas technology

- Vanilla JS SPA (`hub-workflow-designer.js`)
- Absolute-positioned node DOM layer inside a pan/zoom world transform
- SVG overlay for Bézier edges, labels, preview line, and wide hit strokes
- No third-party canvas library; no n8n source or assets

## Coordinate-system design

- **World coordinates:** node `x`/`y` and handle points (`handlePoint`)
- **View transform:** `translate(panX, panY) scale(zoom)` on `.wfd-world`
- Pointer → world: `(client - canvasOrigin - pan) / zoom`
- Edges are always recomputed from source/target handle points after move, pan, zoom, and layout

## Node-handle model

| Node kind | Input | Outputs |
|-----------|-------|---------|
| Start (`trigger.*`) | none | `Continue` (`out` → outcome `default`) |
| Sequential | `in` | `Continue` (`out`) |
| Approve / Review | `in` | `Approved`, `Rejected` |
| Sign | `in` | `Signed`, `Declined` |
| Condition | `in` | configured outcomes (default Yes/No) |
| Terminal | `in` | none |

## Connection persistence model

Connections are first-class graph records (draft + published payload), not SVG geometry:

- `id` / `key`
- `source` / `target` node keys
- `source_handle` / `target_handle`
- `outcome_key` (stable runtime key; `out` normalizes to `default`)
- `label` (display)
- `sort_order`
- `is_revision` (controlled return loops)
- `condition` (optional)

`normalizeWorkflowGraph` preserves handles and coerces `out` → `default` for runtime matching.

## Connection interaction flow

1. Hover/select node → labeled handles visible  
2. Pointer-down on output handle → linking mode + preview curve  
3. Compatible targets highlighted; incompatible dimmed  
4. Pointer-up on input / compatible node → connection in draft  
5. Empty canvas release → optional **Add next step** (auto-connect)  
6. Escape cancels  
7. Edge click → connection inspector (change destination / remove)  
8. Delete/Backspace removes selected edge  
9. Dirty flag + undo/redo via history snapshots  

Primary: handle drag. Secondary: **Connect nodes** dialog (select From / Outcome / To by display name) and Outputs tab actions.

## Branch outcome model

Decision nodes expose distinct handles with stable keys. Edge labels show the display outcome and stay attached to the Bézier midpoint. Replacing a connection for the same source handle updates destination (one edge per source handle).

## Accessibility alternative

- **Connect workflow steps** modal with `<select>` fields (human-readable names)
- Outputs tab: Connect step / Change destination / Remove / Add next step
- Handle `aria-label`s (“Connect from … using … outcome”)
- Keyboard delete for selected edges; Undo/Redo shortcuts

## Runtime integration

`api/lib/configuration/runtime/engine.js` resolves the next node via:

`outgoing(connections, current.key, result.outcome_key)`

matching `outcome_key` (and label fallback). Screen position is never used for ordering.

## Validation

Publishing is blocked for missing start outbound, missing decision outcomes, missing sequential outputs, self-links, invalid refs, duplicate source-handle edges, unsupported cycles (revision edges excluded when `is_revision`), and reachability issues. Messages identify the missing outcome and affected node for focus.

## Tests

```bash
npm run security:wos97-functional-workflow-connection-authoring-test
npm run security:wos95-curated-workflow-designer-ui-test
npm run security:wos96-production-workflow-runtime-test
```

Coverage includes interaction wiring, geometry, persistence fields, validation (missing branch / sequential / self / revision cycle), and runtime outcome matching.

## Screenshots

Capture during browser acceptance (local Configuration Center → Workflows → draft canvas):

1. Dragging Continue from Request Created to Fill Form  
2. Condition Yes/No handles with labeled edges  
3. Selected edge inspector  
4. Outputs tab showing connected / not connected  
5. Light and dark theme after zoom/pan  

## Known limitations

- Orthogonal routing not implemented (cubic Bézier only)
- Auto-avoidance of unrelated nodes is best-effort via layout, not a full router
- Quick-add suggestions are a fixed curated list (not fully type-filtered catalog)
- Connect dialog outcome options refresh when From changes; exotic custom outcome sets should be edited on the condition node first
- Full browser acceptance (publish + live request) requires a running Hub with `CONFIGURABLE_PLATFORM_ENABLED` and Postgres

## Deployment steps

1. Deploy branch `wos-97-functional-workflow-connection-authoring` (do not merge to `main` until product sign-off)
2. Ensure static assets include updated `hub-workflow-designer.js`, `hub.css`, `index.html`
3. No new migration required for connection authoring (graph JSON already stores connections)
4. Run WOS-97 (+95/96) security tests in CI or pre-deploy
5. Smoke: create draft → drag connections → save → reload → validate → publish

## Rollback steps

1. Redeploy previous artifact / revert the WOS-97 commit on the feature branch
2. Draft graphs remain compatible; revision flag `is_revision` is ignored by older UI
3. No database rollback required for authoring-only changes

## Commit guidance

Suggested message:

```text
WOS-97 add functional workflow node connection authoring
```

Do not merge into `main`. Do not add Cursor as a commit co-author. Do not stage `reference/n8n` or other n8n reference trees.
