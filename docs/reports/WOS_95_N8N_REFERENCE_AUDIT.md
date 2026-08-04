# WOS-95 — n8n Reference Audit

## Reference repository

| Item | Value |
|------|--------|
| Path | `reference/n8n` (also present as untracked `n8n-master/`; audit used `reference/n8n`) |
| Commit inspected | `73841560ad76a5ffc7b7a9d9d368713358667bc6` |
| License files read | `LICENSE.md`, `LICENSE_EE.md` |
| Classification | **Fair-code / source-available** under the **Sustainable Use License** for non-`.ee.` master-branch code; `.ee.` paths require Enterprise License |
| Git tracked in WOS? | **No** — ignored via `.gitignore` (`reference/`, `n8n-master/`, …) |

## Licensing conclusions

1. n8n is **not** conventional open-source (OSI). Sustainable Use License restricts commercial redistribution and requires notices for derivatives.
2. **No `.ee.` files or directories were opened for implementation or copied.**
3. **No n8n source code was copied into WOS.** Interaction quality was studied and **reimplemented** in vanilla JS against existing WOS architecture.
4. **No n8n logos, trademarks, branding, icons, or product copy were copied.**
5. Attribution for ideas: this audit documents studied paths; no NOTICE file for copied code is required because **zero source was copied**.

## Components / files studied (patterns only)

All under `reference/n8n/packages/frontend/editor-ui/` (non-`.ee.`):

- `src/features/workflows/canvas/components/Canvas.vue`
- `src/features/workflows/canvas/components/WorkflowCanvas.vue`
- `src/features/workflows/canvas/canvas.utils.ts`
- `src/features/workflows/canvas/composables/useCanvasMapping.ts`
- `src/features/workflows/canvas/composables/useCanvasNodeHandle.ts`
- `src/features/workflows/canvas/components/elements/edges/CanvasConnectionLine.vue`
- `src/features/workflows/canvas/components/elements/buttons/CanvasControlButtons.vue`
- `src/features/shared/nodeCreator/components/NodeCreator.vue`
- `src/features/ndv/shared/views/NodeDetailsView.vue`
- `src/app/views/NodeView.vue`

## Ideas reimplemented in WOS (no source copy)

| Pattern | WOS implementation |
|---------|-------------------|
| Single flow-space coordinates for nodes + handles + edges | `hub-workflow-designer.js` world transform + handle anchors |
| Connection preview while linking | Transient SVG path until commit |
| Fit / zoom / pan viewport | Canvas pan (space/middle), wheel zoom, Fit workflow |
| Minimap | Lightweight SVG overview of node bounds |
| Searchable node library by category | Curated WOS categories (Start/People/Decisions/…) |
| Mode-specific property panel | Assignment inspector shows only relevant fields |
| Read-only published presentation | Existing draft/published banners + non-editable canvas |

## Intentionally excluded

- Vue Flow / Vue application stack
- Credentials, community nodes, expression editor, AI agents
- Execution infrastructure and marketplace
- Entire NDV modal product surface
- Any `.ee.` enterprise source
- n8n branding and terminology

## Copied source

**None.**

## Attribution requirements

N/A for code (no copies). This audit satisfies documentation of reference use.

## Confirmation

- [x] No `.ee.` source copied  
- [x] No n8n repository files staged for WOS commits  
- [x] No n8n trademarks shipped  
- [x] Patterns reimplemented in WOS vanilla JS / existing CSS tokens  
