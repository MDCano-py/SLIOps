# WOS-93 Compatibility Strategy

## Goal

Introduce a configuration-first platform (definitions, versions, instances, variables, execution history) **without** destabilizing the existing production-ready hub.

## Dual runtime

| Runtime | Marker | Used for |
|---------|--------|----------|
| Legacy | existing `requests` / `workflow_steps` / `form_templates` paths | All current work orders, templates, Fill/Review/Sign already in flight |
| Configurable | `cfg_workflow_instances.runtime_type = 'configurable'` | New published request types / workflows created in Configuration Center |

Selection is **explicit** (request type / start API chooses the configurable definition id). We do **not** infer runtime from request age.

## Preferred rollout order (implemented)

1. Additive tables (`migrations/013_configurable_platform.sql`)
2. Definition / version services + audit
3. Variable registry + safe condition engine
4. Form / document / workflow / dashboard definitions
5. Visual designer UI (vanilla JS + SVG)
6. Configurable runtime adapter (`api/lib/configuration/runtime/engine.js`)
7. Seed templates (NDA, purchase, vendor, work-order type) — definitions only
8. Feature flag `CONFIGURABLE_PLATFORM_ENABLED`
9. Regression of existing suites with flag off (default)

## What stays untouched

- Auth / Entra / sessions / `/me`
- Existing RBAC tables and permission bypass for `admin` / `hub_admin`
- Legacy `/hub/requests` workflow engine
- Existing `form_templates` admin + launch/submission runtime
- MaintainX / Automation / S3 adapters (invoked as optional integration nodes; missing config → controlled skip/status)
- Dark/light theme tokens

## Backfill

- Existing WOS behavior is represented as configurable **request type** seed `work_order` (compatibility type), not a destructive migration of live rows.
- Live legacy instances remain on the legacy runtime.

## Feature flag behavior

When `CONFIGURABLE_PLATFORM_ENABLED` is unset/false:

- Configuration APIs return `503 CONFIGURABLE_PLATFORM_DISABLED`
- Configuration nav stays inactive / page shows disabled state
- Legacy hub behavior unchanged

## Security invariants

- No `eval` / `new Function` / user SQL / user shell
- Conditions are structured JSON with allowlisted operators
- Published versions are immutable; edits create new drafts
- Optimistic concurrency via draft `revision`
- HTML templates sanitized before persist/render
- Sensitive custom variables blocked from client rendering
