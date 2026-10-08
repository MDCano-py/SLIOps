# SLIOps Workflow Engine — Actual Architecture

**Date:** 2026-10-08  
**Source of truth:** current codebase (not aspirational design)

There is **no single common workflow engine**. Three parallel runtimes implement overlapping Fill / Review / Approve / Sign / Upload vocabulary with different persistence models. The intended SLIOps chain maps as follows — every link exists in at least one runtime:

```
Request Type → Form/Template → Request Instance → Workflow Definition
  → Ordered Steps → Authorized Actor → Fill/Review/Approve/Sign/Upload/Complete
  → Documents + Audit
```

| Intended link | Hub request runtime | Template runtime (Forms) | Configurable platform (`cfg_*`) |
| --- | --- | --- | --- |
| Request type | `DOCUMENT_TYPES` / `REQUEST_TYPES` | launch space + `template_kind` | `cfg_definitions.kind='request_type'` |
| Form / template | `FORM_DEFINITIONS` / portal | `form_templates` + versions | `cfg_definitions.kind='form'\|'document'` |
| Request instance | `requests` | `form_submissions` | `requests` + `cfg_workflow_instances` |
| Workflow definition | `WORKFLOW_TEMPLATES` (+ PG overrides) | `form_template_versions.workflow_json` **or** bound workflow template | `cfg_definitions` workflow graph |
| Versioning | Template id/key; overrides replace | Draft → publish; `version_number`; submission pins `template_version_id` | `cfg_versions` publish |
| Ordered steps | `workflow_steps.step_index` | `workflow_step_instances.step_index` | graph edges + `cfg_workflow_tasks` |
| Current step | first pending step | `form_submissions.current_step_index` | `cfg_workflow_instances.current_node_key` |
| Authorized actor | email / role / assigned_type | `assignee_role` + portal RBAC / workflow roles | user / role queue / external participant |
| Actions | review, approve, sign, upload, … | Fill, Review, Approve, Sign, Upload | human.fill\|review\|approve\|reject\|sign\|… |
| Documents | `web_documents` (+ step `document_id`) | submission `data_json` / upload ref | `cfg_generated_documents` |
| Audit | `audit_events` | `form_submission_events` | `cfg_audit_events` |
| External secure link | `action.html?t=` (`action_links`) | **Reuses hub `action_links` / `action.html?t=`** (same crypto; binds `submission_id` + `workflow_step_instance_id`) | `cfg-action.html?token=` |

---

## Request type source

- Hub: `api/lib/hub/document-registry.js` (`DOCUMENT_TYPES`), `api/lib/hub/constants.js` (`REQUEST_TYPES`).
- Configurable: `cfg_definitions` where `kind='request_type'`.
- Forms launch cards: `template_launch_entries` (not the same table as hub request types).

## Form / template source

| Table | Role |
| --- | --- |
| `form_templates` | Logical template |
| `form_template_versions` | Draft/published schema + workflow JSON + compiled contract |
| `template_bindings` | Form → workflow template link (`none` / `optional` / `required`) |
| `template_launch_entries` | Start Center / New Request cards |

Requires `HUB_STORE_MODE=postgres` and valid `DATABASE_URL` (no memory fallback for Forms/Documents).

## Workflow definition + versioning

| Store | Shape | Versioning |
| --- | --- | --- |
| Code `WORKFLOW_TEMPLATES` + PG overrides | Linear `steps_json` | Override row replaces active template for new requests |
| `form_template_versions.workflow_json` | Linear steps | Immutable published versions; clone → new draft |
| Bound workflow template | Separate `template_kind='workflow'` | Publish independently; binding points at template id |
| `cfg_definitions` + `cfg_versions` | Graph nodes/connections | Publish creates version; runtime pins version |

**In-flight isolation:** template submissions store `template_version_id`. Publishing v2 does not mutate existing submission step rows. Configurable instances pin `cfg_versions` similarly.

## Request → workflow binding

1. `POST /hub/requests` → hub steps from registry workflow (+ optional document).  
2. Archive mirror (Parts / WO / roll-off) → hub request.  
3. `POST /hub/launch/:id/submit` → `form_submissions`; **step instances only when a bound published workflow exists**. Own `workflow_json` alone does not instantiate steps on launch.  
4. `createSubmission(templateId)` → steps from that version’s `compiled_workflow_json`.  
5. `POST /hub/workflow-runtime/start-request-type` → hub request shell + cfg instance.  
6. `POST /hub/workflow-runtime/start` → cfg against existing request/submission.

## Workflow instance persistence

- Hub: `requests` + `workflow_steps` (Postgres when hub store is postgres).  
- Template: `form_submissions`, `workflow_step_instances`, `form_submission_events`.  
- Configurable: `cfg_workflow_instances`, `cfg_workflow_tasks`, `cfg_node_executions`, `cfg_audit_events`.

State survives process restart when Postgres-backed (`npm run dev:pg` / production).

## Step ordering + current-step determination

- Template: ordered by `step_index`; actionable step is `status='pending'` at `current_step_index`. Acting on a non-current / completed step → `STEP_NOT_CURRENT` / `STEP_NOT_PENDING` (409).  
- Hub: ordered workflow_steps; advance closes current and opens next.  
- Configurable: graph walk via connection outcomes; tasks claim/complete.

## Supported action types

- **Template (validated):** Fill, Review, Approve, Sign, Upload.  
- **Hub:** review, approve, sign, upload, verify, send_to_*, close (+ intake/fulfill mapped).  
- **Configurable:** `human.fill|review|approve|reject|sign|acknowledge|provide_info|upload` + terminals/integrations.

Reject / request-changes: Approve reject requires reason; Review `request_changes` completes the review step (revision semantics depend on graph/linear definition — linear template does not auto-rewind to Fill).

## Role / assignee resolution

- Template: `assignee_role` ∈ workflow role catalog (`requester`, `manager`, `operations`, `ap`, `legal`, `admin`, …). `canActOnStep` matches portal permissions + assigned workflow role keys. Authenticated users always receive synthetic `requester`/`employee`. **Admins can act on any pending step** by design (`isAdmin` short-circuit) — this is explicit elevation, not silent impersonation of another email.  
- Hub: `assigned_to_email` / `assigned_role` / `assigned_type`.  
- Configurable: specific user, role shared queue, form field, request creator, external participant; fallbacks hub_admin / pause.

**Authorization rule:** frontend hiding is not sufficient. Routes call `canActOnStep` / assignment checks server-side; unauthorized → 403. Actor email comes from session (`getActorEmail`), never from a caller-supplied actor body field for portal acts.

## Transition audit

Template events (`form_submission_events`) record `event_type`, `actor_email`, `detail`, `metadata_json` (step id/index/type/action), `created_at`. Hub and cfg have parallel audit tables.

## Document linkage

- Hub: `web_documents` linked to request; optional step `document_id`.  
- Template: answers in `data_json`; Upload step stores a reference string in step payload.  
- Configurable: `cfg_generated_documents` tied to instance/node.

## External / client secure links

- Hub: mint `action_links` → `action.html?t=` (token scoped to request/step).  
- Configurable: `cfg_external_participants` → `cfg-action.html?token=`.  
- Template runtime: **reuses hub `action_links`** (migration `016_template_action_links.sql`). Assignee roles `client` / `vendor` / `external` are secure-link-only (portal `canActOnStep` returns false). Mint via `POST /hub/submissions/:id/external-actions`; complete via existing public `/hub/action/:token/*` → `actOnSubmissionStep` with actor `external:{email}`. No fourth token system.  
- Outbound email delivery of the action URL is EC2/live; local tests exercise the generated token/URL directly.

## Future consolidation (not in this release)

Three Fill/Review/Sign runtimes remain intentional. A future common engine could unify token minting, step vocabulary, and audit sinks behind one façade while keeping Control Room separate. **Do not merge runtimes in this release.**

## UI note (router)

Portal hash routing in `index.html` must assign route bags on `window` (not bare Node `global`). Bare `global._hub*` in `applyRoute` throws `ReferenceError: global is not defined` on workflow/configuration routes.

## Specialized module classification

| Module | Classification |
| --- | --- |
| Forms (admin / launch / submissions) | **COMMON_WORKFLOW_ENGINE** (template runtime) |
| Work Orders | **SHARED_PRIMITIVES** (hub mirror + MaintainX) |
| Parts Requests | **SHARED_PRIMITIVES** |
| Equipment Requests | **SHARED_PRIMITIVES** |
| Safe Work Permits | **INTENTIONALLY_SEPARATE** (custom portal/archive; registry stub) |
| JSA Generator | **INTENTIONALLY_SEPARATE** |
| Document Review / Signature | **SHARED_PRIMITIVES** (hub + `action.html`) |
| Configurable NDA-style flows | **SHARED_PRIMITIVES** (cfg graph; candidate future common engine) |
| Control Room | **INTENTIONALLY_SEPARATE** — shift ops, not Fill/Review/Sign |
| Duplicate Fill/Review/Sign across three runtimes | **LEGACY_DUPLICATION** (document only; do not auto-merge) |

**Consolidation opportunity:** three Fill/Review/Sign vocabularies. Do not auto-refactor; Control Room must stay separate.

## Local developer setup (Postgres)

```bash
cp .env.local.postgres.example .env.local.postgres
npm run db:migrate
npm run dev:pg
# http://127.0.0.1:3010/?_noauth=1
npm run security:local-swp-workflow-e2e
npm run security:workflow-route-globals-regression-test
```

Ordinary users never see these commands.
