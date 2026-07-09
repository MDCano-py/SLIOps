# Document / form registry

The Operations Workflow Hub loads request types from a **registry** instead of hardcoded buttons in the UI.

## Backend

| File | Role |
|------|------|
| `api/lib/hub/document-registry.js` | Seed data: `DOCUMENT_TYPES`, `FORM_DEFINITIONS`, `WORKFLOW_TEMPLATES` |
| `api/lib/hub/routes.js` | HTTP routes under `/hub/registry/*` |

### API routes

- `GET /hub/registry` — bundle metadata
- `GET /hub/registry/document-types` — enabled types (+ `?enabled=false` for admin)
- `GET /hub/registry/document-types/:key` — type + form + workflow template
- `GET /hub/registry/form-definitions/:key` — schema for dynamic forms
- `GET /hub/registry/workflow-templates?key=` — workflow template
- `GET /hub/form-definitions` — **deprecated**; returns registry-shaped list for older clients

## Frontend

| File | Role |
|------|------|
| `hub.js` | Dashboard, queue, detail, registry-driven New Request |
| `hub-form-renderer.js` | Renders `schema_json` fields |
| `hub.css` | Operational layout (rail, dense tables, inspector) |

## Add a new document type

1. Edit `api/lib/hub/document-registry.js` — add to `DOCUMENT_TYPES`:
   - `key`, `label`, `category`, `enabled: true`
   - `render_mode`: `'schema'` or `'custom'`
   - For **schema**: add `FORM_DEFINITIONS[key]` with `schema_json`
   - For **custom**: set `custom_component` and `portal_tab` (existing SWP/JSA/BOL pattern)

2. Redeploy or restart local dev server.

3. New Request page and type filter update automatically.

### Example: simple schema type

```javascript
// DOCUMENT_TYPES
{
  key: 'delivery_receipt',
  label: 'Delivery Receipt',
  category: 'logistics',
  enabled: true,
  render_mode: 'schema',
  default_workflow_template_id: 'wf_general',
  // ...
}

// FORM_DEFINITIONS
delivery_receipt: {
  document_type_key: 'delivery_receipt',
  version: 1,
  title: 'Delivery Receipt',
  schema_json: [
    { type: 'text', name: 'title', label: 'Shipment reference', required: true, fullWidth: true },
    { type: 'date', name: 'delivered_at', label: 'Delivery date' },
    { type: 'file_upload', name: 'pod_file', label: 'Proof of delivery' },
  ],
}
```

### Example: complex legacy form

```javascript
{
  key: 'safe_work_permit',
  render_mode: 'custom',
  custom_component: 'SafeWorkPermitForm',
  portal_tab: 'swp',
}
```

## Future admin UI

Registry data can move to Redis with the same route shapes; `document-registry.js` remains the fallback seed.
