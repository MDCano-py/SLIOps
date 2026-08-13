# WOS-100 — Simplified Production Workflow Builder

## Branch / commit

- Branch: `wos-100-simplified-workflow-builder`
- Commit: `e056b5d` (tip; feature `3bb2ddb`)

## Summary

Replaced the primary workflow authoring UX with a **guided vertical builder**. Administrators add steps with click / `+`, configure in the right panel, and use Yes/No branches for conditions. The runtime still consumes the same `{ nodes, connections }` graph.

Advanced canvas (`HubWorkflowDesigner`) remains available as an optional escape hatch (“Open advanced canvas” / “Back to simple builder”).

## Files changed

| File | Role |
|------|------|
| `hub-workflow-simple-builder.js` | **New** simplified builder + graph↔model serialization |
| `hub-configuration-center.js` | Mount simple builder as primary for workflows |
| `hub.css` | `.swb-*` vertical layout styles |
| `index.html` | Load `hub-workflow-simple-builder.js` |
| `package.json` | `security:wos100-simplified-workflow-builder-test` |
| `scripts/security/wos100-simplified-workflow-builder-test.js` | Acceptance tests |
| `docs/reports/WOS_100_SIMPLIFIED_WORKFLOW_BUILDER_REPORT.md` | This report |
| `docs/reports/WOS-100.md` | Card prompt (source) |

## Old UI removed/replaced

- **Primary authoring** no longer requires handle-to-handle edges, freeform drag layout, pan/zoom, or reconnect dialogs.
- Graph canvas is **not deleted**; it is demoted behind an explicit advanced toggle.

## New UI components

- Left: Add Step library (Start, Form/Document, Review, Approval, Sign, Condition, Notification, Integration, Update Vendor, End)
- Center: Vertical cards, connectors, circular `+`, condition YES/NO columns
- Right: Step inspector (name, document, assignment from real users/roles, condition variable/operator)
- Overflow: Edit, Duplicate, Move up/down, Insert before/after, Delete

## Graph serialization

- `graphToModel(graph)` — walks from start; expands `logic.condition` into `{ branches: { yes, no } }`; detects join points when both branches reconverge.
- `modelToGraph(model)` — emits nodes with auto `x`/`y`, sequential edges, condition `yes`/`no` handles matching runtime (`outcome_key`).
- Save draft / publish unchanged: `PUT` payload is still `state.designer` graph JSON.

## Condition behavior

- Defaults to `vendor.nda_required` / `is_true` with selectable variables including MSA/NDA fields.
- Yes/No paths edited via `+` under each branch — no line drawing.

## Legacy compatibility

- Existing graphs (including seeded vendor onboarding) load through `graphToModel`.
- Round-trip covered by automated test.

## Real-user assignment / notifications / NDA

- Assignment modes: initiator, role, specific user (from `/users`), external participant.
- No mock participant catalogs.
- WOS-98/99 vendor NDA/MSA context and notification runtime unchanged.
- AuthBridge / production refusals unchanged.

## Validation

- Client-side `validateModel` flags empty workflow, missing start, empty condition variable, missing branch steps (warnings), missing document/assignee (warnings).
- Server publish validation remains authoritative.

## Tests

```bash
npm run security:wos100-simplified-workflow-builder-test   # 9 pass
npm run security:wos99-production-completion-test          # 10 pass
npm run security:wos98-vendor-contract-automation-test     # 9 pass
npm run security:wos97-functional-workflow-connection-authoring-test  # 37 pass
```

## Remaining blockers / deferred

- Live browser screenshot proof of the acceptance scenario (ops).
- Nested conditions inside branches are supported in the model but deep multi-join graphs may simplify on re-open.
- True parallel NDA+MSA engine paths still sequential in runtime (unchanged).
- Do not merge to `main` until staging smoke of Create → Save → Refresh → Publish → vendor trigger.
