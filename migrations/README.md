# Hub SQL migrations

Applied by `npm run db:migrate` in filename order. Tracked in `schema_migrations`.

**Canonical directory:** `migrations/` at repo root. The former copy under `db/migrations/` was removed (WOS-75); it was never used by scripts.

| File | Contents |
|------|----------|
| `001_init.sql` | Core hub schema (requests, workflows, documents, notifications, registry) |
| `002_hub_extras.sql` | Archive columns, settings, locations, equipment, request files |
| `003_workflow_step_action_types.sql` | Remove restrictive workflow step action_type CHECK |
| `004_integration_events_outbox.sql` | Durable integration outbox fields on `integration_events` |
| `005_outbox_events_email_delivery.sql` | Email delivery outbox (`outbox_events`) |
| `006_vendor_master.sql` | Vendor master system of record |
| `007_form_template_versions.sql` | Form templates, versions, submissions, workflow step instances |
| `008_app_spaces_launch_registry.sql` | App spaces + template launch registry |
| `009_template_kind_sectioned_schema_bindings.sql` | Template kind + workflow bindings |
| `010_form_submission_events.sql` | Submission runtime audit trail |
| `011_hub_rbac_roles.sql` | Workflow role catalog + user role assignments |

## Validation (WOS-76)

| Command | Purpose |
|---------|---------|
| `npm run db:validate` | Staging-safe schema validation (no demo seed) |
| `npm run db:validate:demo` | Local-only demo seed compatibility |
| `npm run db:fresh-migration-check` | Empty temp DB migrate + validate (no psql required) |

For local setup see `LOCAL_POSTGRES_SETUP.md`. For staging/RDS see `RDS_POSTGRES_SETUP.md` and `.env.staging.example`.
