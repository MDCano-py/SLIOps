# Document workflow system

Internal web-native documents with Fill → Review → Sign routing, notifications, and audit trail. This is operational e-signature workflow — not legal DocuSign equivalence.

## Part 1 — Audit summary

| Question | Answer |
|----------|--------|
| Web document records? | **Yes** — `hub:web_document:*` |
| Form data as document content? | **Yes** — `content_json` on create and PATCH |
| Action page review? | **Yes** — Approve / Reject + comments (`action.html`) |
| Action page signature? | **Yes** — Canvas + typed acknowledgement |
| Action page fill? | **Yes** — Schema form via `HubFormRenderer`, or clean fallback fields (not raw JSON) |
| Signature storage? | PNG data URL or acknowledgement in `hub:document:*` + audit |
| Locked after completion? | **Yes** — `locked: true`; PATCH returns 409 |
| Audit trail? | **Yes** — `hub:audit:*`; Audit tab in request detail |
| Notified when their turn? | **Yes** — in-app bell; optional email via automation webhooks |
| Multi reviewer/signer? | **Yes** — unlimited sequential steps |
| Templates on doc types? | **Yes** — registry + Redis overrides |

## Action page UX (client links)

| Mode | UI |
|------|-----|
| **Fill** | Green banner + schema form from registry (`form_definition` on action GET). Custom types (e.g. JSA) use a **fallback field set** (title, location, summary, hazards, controls, notes). |
| **Review** | Blue banner + document summary + comments + **Approve** / **Reject** |
| **Sign** | Amber banner + summary + signature pad + typed acknowledgement + **Sign & submit** |

API: `GET /hub/action/:token` returns `form_definition`, `web_document`, `step`, `request`.

Fill submit: `POST /hub/action/:token/fill` with `{ content_json: { ...fields } }`.

## Workflow builder (hub)

- **Location:** New Request (schema types) and Request detail (admin, before any step completes).
- **Controls:** Fill / Review / Sign / Approve toggle buttons per step; assignee email; instructions; reorder; unlimited steps.
- **Validation:** Routed workflows need **≥2 non-fill steps** with assignee emails. Fill-only can be one self-assigned step.
- **Templates:** **Save as type default** writes to `PUT /hub/registry/workflow-templates/:id`.

### JSA sample template (`wf_jsa`)

1. Field employee completes JSA (Fill — completed)
2. Supervisor review (Review)
3. Safety manager sign-off (Sign)

## My Tasks dashboard

Sections: **Forms to fill**, **Documents to review**, **Documents to sign**, **Waiting on me**, **Waiting on others**, **Waiting on client**, **Recently completed**.

Quick filters: All, Fill, Review, Sign, Waiting on me, Waiting on others, Waiting on client, Completed.

## Notifications

- In-app records in Redis; bell polls `GET /hub/notifications` every 60s.
- User-facing labels: **Notification**, **Automation**, **Delivery** — never “n8n”.
- Server uses webhooks internally (`N8N_WEBHOOK_*` env vars).

## Integrations & system health (admin only)

- **Removed** top-bar “Connected” pill for all users.
- **Management → Integrations** shows portal, MaintainX, storage, and notification delivery status via `GET /integrations-status` (vendor session).
- Hub admins also have `GET /hub/integrations/status`.
- Request detail integration pills visible only to `hub_admin` / `admin`.

## Key API routes

| Route | Purpose |
|-------|---------|
| `POST /hub/requests` | Create request + web document + workflow |
| `PATCH /hub/requests/:id/web-document` | Update content (blocked if locked) |
| `PUT /hub/requests/:id/workflow` | Replace steps (admin) |
| `GET /hub/my-tasks` | User task buckets |
| `GET /hub/notifications` | Notification bell |
| `GET /hub/action/:token` | Action page bootstrap |
| `POST /hub/action/:token/{fill\|approve\|reject\|sign\|complete}` | Client actions |
| `GET /integrations-status` | Management integrations health |

## Manual test checklist (pre-staging)

1. [ ] Sign in (`?_noauth=1` or SSO)
2. [ ] **New Request** → Equipment Request → workflow builder shows Fill/Review/Sign/Approve toggles → add 2 routed steps with emails → Submit
3. [ ] Request detail → **Web document** shows `content_json`; Audit tab has events
4. [ ] **My Tasks** → Fill / Review / Sign sections and filters work
5. [ ] Notification bell shows count; click opens request and marks read
6. [ ] **Management → Integrations** — status cards load (no “Connected” in top bar)
7. [ ] Create document signature/review request → open `action.html?t=...`
   - [ ] Fill link: schema or fallback form (not JSON textarea)
   - [ ] Review: approve/reject
   - [ ] Sign: pad or checkbox
8. [ ] JSA type (or mirror) loads **wf_jsa** 3-step template in workflow builder
9. [ ] Final workflow step → document **locked**; PATCH web-document returns 409
10. [ ] No user-facing “n8n” labels in portal or action page
11. [ ] MaintainX / Entra / legacy forms still work

## Files (workflow UX)

| Area | Path |
|------|------|
| Action page | `action.html`, `hub-form-renderer.js` |
| Workflow builder | `hub-workflow-builder.js`, `hub.css` |
| Registry + JSA template | `api/lib/hub/document-registry.js` |
| API | `api/lib/hub/routes.js`, `api/maintainx.js` |
| Hub UI | `hub.js`, `index.html` |
