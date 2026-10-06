/**
 * Shared Postgres schema validation helpers (WOS-76).
 * Used by db:validate (staging-safe) and db:fresh-migration-check.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./env');

const MIGRATIONS_DIR = path.join(ROOT, 'migrations');

const REQUIRED_TABLES = {
  users: ['id', 'email', 'permissions', 'created_at'],
  requests: [
    'id',
    'request_number',
    'request_type',
    'title',
    'status',
    'demo',
    'assigned_to_email',
    'form_payload',
    'archive_kind',
    'maintainx_status',
    'created_at',
    'updated_at',
  ],
  status_history: ['id', 'request_id', 'old_status', 'new_status', 'created_at'],
  comments: ['id', 'request_id', 'body', 'created_at'],
  workflow_steps: ['id', 'request_id', 'step_order', 'action_type', 'status', 'created_at'],
  web_documents: ['id', 'request_id', 'document_type_key', 'title', 'status', 'content_json'],
  audit_events: ['id', 'request_id', 'action', 'metadata', 'created_at'],
  request_files: ['id', 'request_id', 'file_name', 'file_url', 'created_at'],
  action_links: ['id', 'request_id', 'token_hash', 'action_type', 'expires_at'],
  notifications: ['id', 'recipient_email', 'type', 'title', 'message', 'request_id'],
  workflow_templates: ['id', 'key', 'label', 'steps_json', 'enabled'],
  document_types: ['id', 'key', 'label', 'render_mode', 'enabled'],
  form_definitions: ['id', 'document_type_key', 'version', 'schema_json'],
  integration_events: [
    'id',
    'event_type',
    'payload',
    'status',
    'created_at',
    'next_attempt_at',
    'locked_at',
    'locked_by',
    'processed_at',
    'last_attempt_at',
    'source_system',
    'destination_system',
  ],
  outbox_events: [
    'id',
    'event_type',
    'status',
    'payload',
    'dedupe_key',
    'attempts',
    'next_attempt_at',
    'locked_at',
    'locked_by',
    'processed_at',
    'last_attempt_at',
    'last_error',
    'created_at',
    'updated_at',
  ],
  hub_settings: ['key', 'value_json'],
  locations: ['id', 'name', 'enabled'],
  equipment: ['id', 'name', 'location_id'],
  request_sequences: ['request_type', 'seq'],
  signatures: ['id', 'request_id', 'signature_type', 'signed_at'],
  schema_migrations: ['id', 'applied_at'],
  vendor_master: [
    'id',
    'ref_number',
    'company_name',
    'entity_type',
    'contact_name',
    'contact_email',
    'contact_phone',
    'service_description',
    'requested_by',
    'requested_at',
    'overall_status',
    'admin_status',
    'ap_status',
    'contract_status',
    'assigned_to',
    'last_action_at',
    'w9_status',
    'banking_status',
    'insurance_status',
    'msa_status',
    'nda_status',
    'payload_json',
    'document_meta_json',
    'history_json',
    'created_at',
    'updated_at',
  ],
  form_templates: [
    'id',
    'key',
    'name',
    'description',
    'status',
    'current_published_version_id',
    'created_by',
    'created_at',
    'updated_at',
    'archived_at',
    'launch_config_json',
    'template_kind',
  ],
  form_template_versions: [
    'id',
    'template_id',
    'version_number',
    'status',
    'schema_json',
    'workflow_json',
    'validation_json',
    'compiled_workflow_json',
    'template_kind',
    'created_by',
    'created_at',
    'published_at',
    'published_by',
    'retired_at',
  ],
  form_submissions: [
    'id',
    'template_version_id',
    'data_json',
    'status',
    'current_step_index',
    'created_by',
    'created_at',
    'updated_at',
  ],
  workflow_step_instances: [
    'id',
    'submission_id',
    'step_index',
    'step_type',
    'assignee_role',
    'status',
    'acted_by',
    'acted_at',
    'payload_json',
    'created_at',
    'updated_at',
  ],
  form_submission_events: [
    'id',
    'submission_id',
    'event_type',
    'actor_email',
    'detail',
    'metadata_json',
    'created_at',
  ],
  app_spaces: [
    'id',
    'key',
    'label',
    'description',
    'icon',
    'status',
    'sort_order',
    'visible_to_roles_json',
    'created_by',
    'created_at',
    'updated_at',
  ],
  template_launch_entries: [
    'id',
    'template_id',
    'template_version_id',
    'space_key',
    'label',
    'description',
    'icon',
    'route_type',
    'route_target',
    'quick_action_enabled',
    'visible_to_roles_json',
    'status',
    'sort_order',
    'created_by',
    'created_at',
    'updated_at',
  ],
  template_bindings: [
    'id',
    'source_template_id',
    'source_template_version_id',
    'source_space_key',
    'workflow_template_id',
    'workflow_template_version_id',
    'binding_status',
    'binding_mode',
    'created_by',
    'created_at',
    'updated_at',
    'archived_at',
  ],
  roles: ['id', 'key', 'name', 'status', 'system_role', 'created_at', 'updated_at'],
  user_roles: ['user_email', 'role_key', 'created_at', 'created_by'],
};

const REQUIRED_INDEXES = [
  'idx_requests_status',
  'idx_requests_request_type',
  'idx_requests_assigned_to_email',
  'idx_workflow_steps_request_order',
  'idx_web_documents_request_id',
  'idx_notifications_recipient_read',
  'idx_integration_events_status_created',
  'idx_integration_events_pending_dispatch',
  'idx_outbox_events_pending_dispatch',
  'idx_vendor_master_overall_status',
  'idx_vendor_master_assigned_to',
  'idx_vendor_master_requested_at',
  'idx_vendor_master_last_action_at',
  'idx_form_templates_key',
  'idx_form_templates_status',
  'idx_form_template_versions_template_status',
  'idx_form_submissions_template_version_status',
  'idx_workflow_step_instances_submission_step_status',
  'idx_app_spaces_status_sort',
  'idx_template_launch_entries_space_status',
  'idx_template_launch_entries_template',
  'idx_template_bindings_source',
];

const REQUIRED_FKS = [
  { table: 'workflow_steps', column: 'request_id', ref_table: 'requests' },
  { table: 'web_documents', column: 'request_id', ref_table: 'requests' },
  { table: 'status_history', column: 'request_id', ref_table: 'requests' },
  { table: 'form_definitions', column: 'document_type_key', ref_table: 'document_types' },
  { table: 'form_template_versions', column: 'template_id', ref_table: 'form_templates' },
  { table: 'form_submissions', column: 'template_version_id', ref_table: 'form_template_versions' },
  { table: 'workflow_step_instances', column: 'submission_id', ref_table: 'form_submissions' },
  { table: 'form_templates', column: 'current_published_version_id', ref_table: 'form_template_versions' },
  { table: 'template_launch_entries', column: 'template_id', ref_table: 'form_templates' },
  { table: 'template_launch_entries', column: 'template_version_id', ref_table: 'form_template_versions' },
  { table: 'template_launch_entries', column: 'space_key', ref_table: 'app_spaces' },
  { table: 'template_bindings', column: 'source_template_id', ref_table: 'form_templates' },
  { table: 'template_bindings', column: 'workflow_template_id', ref_table: 'form_templates' },
  { table: 'equipment', column: 'location_id', ref_table: 'locations' },
];

const EXPECTED_MIGRATIONS = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

function pass(msg) {
  return { ok: true, msg };
}

function fail(msg) {
  return { ok: false, msg };
}

async function checkTablesAndColumns(client, schema = 'public') {
  const results = [];
  for (const [table, columns] of Object.entries(REQUIRED_TABLES)) {
    const reg = await client.query(`SELECT to_regclass($1) AS reg`, [`${schema}.${table}`]);
    if (!reg.rows[0]?.reg) {
      results.push(fail(`Missing table: ${table}`));
      continue;
    }
    results.push(pass(`Table exists: ${table}`));
    const colRes = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2`,
      [schema, table]
    );
    const have = new Set(colRes.rows.map((r) => r.column_name));
    for (const col of columns) {
      if (!have.has(col)) results.push(fail(`Missing column ${table}.${col}`));
      else results.push(pass(`Column ${table}.${col}`));
    }
  }
  return results;
}

async function checkIndexes(client, schema = 'public') {
  const results = [];
  const r = await client.query(`SELECT indexname FROM pg_indexes WHERE schemaname=$1`, [schema]);
  const names = new Set(r.rows.map((x) => x.indexname));
  for (const idx of REQUIRED_INDEXES) {
    if (names.has(idx)) results.push(pass(`Index ${idx}`));
    else results.push(fail(`Missing index ${idx}`));
  }
  return results;
}

async function checkForeignKeys(client, schema = 'public') {
  const results = [];
  for (const fk of REQUIRED_FKS) {
    const r = await client.query(
      `SELECT 1 FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema = $4
         AND tc.table_name = $1 AND kcu.column_name = $2 AND ccu.table_name = $3
       LIMIT 1`,
      [fk.table, fk.column, fk.ref_table, schema]
    );
    if (r.rowCount) results.push(pass(`FK ${fk.table}.${fk.column} → ${fk.ref_table}`));
    else results.push(fail(`Missing FK ${fk.table}.${fk.column} → ${fk.ref_table}`));
  }
  return results;
}

async function checkMigrationsApplied(client) {
  const results = [];
  const r = await client.query('SELECT id FROM schema_migrations ORDER BY id');
  const applied = new Set(r.rows.map((x) => x.id));
  for (const file of EXPECTED_MIGRATIONS) {
    if (applied.has(file)) results.push(pass(`Migration applied: ${file}`));
    else results.push(fail(`Migration not applied: ${file}`));
  }
  if (applied.size !== EXPECTED_MIGRATIONS.length) {
    results.push(
      fail(`Expected ${EXPECTED_MIGRATIONS.length} migrations, found ${applied.size} in schema_migrations`)
    );
  }
  return results;
}

async function checkWorkflowStepConstraint(client, schema = 'public') {
  const r = await client.query(
    `SELECT conname FROM pg_constraint c
     JOIN pg_class t ON c.conrelid = t.oid
     JOIN pg_namespace n ON t.relnamespace = n.oid
     WHERE n.nspname = $1 AND t.relname = 'workflow_steps' AND c.contype = 'c' AND c.conname = 'workflow_steps_action_type_check'`,
    [schema]
  );
  if (r.rowCount) {
    return [fail('workflow_steps still has restrictive action_type CHECK (run migration 003)')];
  }
  return [pass('workflow_steps action_type CHECK removed (extended step types allowed)')];
}

async function runSmokeTests(client) {
  const results = [];
  const requestId = crypto.randomUUID();
  const stepId = crypto.randomUUID();
  const docId = crypto.randomUUID();
  const notifId = crypto.randomUUID();
  const integId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const historyId = crypto.randomUUID();
  const commentId = crypto.randomUUID();
  const fileId = crypto.randomUUID();
  const requestNumber = `VALIDATION-REQ-${Date.now()}`;

  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO requests (id, request_number, request_type, title, status, demo, requester_email, created_at, updated_at)
       VALUES ($1,$2,'general_request',$3,'submitted',true,'validation@streamlinecorp.com',now(),now())`,
      [requestId, requestNumber, 'WOS-76 validation smoke test']
    );
    results.push(pass('INSERT requests (transactional smoke)'));

    await client.query(
      `INSERT INTO workflow_steps (id, request_id, step_order, action_type, status, required, signature_required, review_required, created_at, updated_at)
       VALUES ($1,$2,1,'send_to_maintainx','not_started',true,false,false,now(),now())`,
      [stepId, requestId]
    );
    results.push(pass('INSERT workflow_steps (send_to_maintainx action_type)'));

    await client.query(
      `INSERT INTO web_documents (id, request_id, document_type_key, title, status, content_json, version, created_at, updated_at)
       VALUES ($1,$2,'general_request',$3,'draft','{}'::jsonb,1,now(),now())`,
      [docId, requestId, 'Validation document']
    );
    results.push(pass('INSERT web_documents'));

    await client.query(
      `INSERT INTO status_history (id, request_id, old_status, new_status, changed_by, source, created_at)
       VALUES ($1,$2,null,'submitted','validation@streamlinecorp.com','db:validate',now())`,
      [historyId, requestId]
    );
    results.push(pass('INSERT status_history'));

    await client.query(
      `INSERT INTO comments (id, request_id, body, author_email, created_at)
       VALUES ($1,$2,'validation comment','validation@streamlinecorp.com',now())`,
      [commentId, requestId]
    );
    results.push(pass('INSERT comments'));

    await client.query(
      `INSERT INTO audit_events (id, request_id, action, metadata, created_at)
       VALUES ($1,$2,'validation.test','{"smoke":true}'::jsonb,now())`,
      [auditId, requestId]
    );
    results.push(pass('INSERT audit_events'));

    await client.query(
      `INSERT INTO request_files (id, request_id, file_name, file_url, document_type, uploaded_by, created_at)
       VALUES ($1,$2,'validation.txt','https://example.invalid/validation.txt','attachment','validation@streamlinecorp.com',now())`,
      [fileId, requestId]
    );
    results.push(pass('INSERT request_files'));

    await client.query(
      `INSERT INTO notifications (id, recipient_email, type, title, message, request_id, created_at)
       VALUES ($1,'validation@streamlinecorp.com','validation','Validation','Smoke test notification',$2,now())`,
      [notifId, requestId]
    );
    results.push(pass('INSERT notifications'));

    await client.query(
      `INSERT INTO integration_events (id, event_type, request_id, payload, status, attempts, created_at)
       VALUES ($1,'validation.test',$2,'{"smoke":true}'::jsonb,'pending',0,now())`,
      [integId, requestId]
    );
    results.push(pass('INSERT integration_events'));

    const dup = await client.query(`SELECT 1 FROM requests WHERE request_number=$1`, [requestNumber]);
    if (dup.rowCount === 1) results.push(pass('request_number uniqueness readable'));

    await client.query(`UPDATE requests SET status='in_review', updated_at=now() WHERE id=$1`, [requestId]);
    const upd = await client.query(`SELECT status FROM requests WHERE id=$1`, [requestId]);
    if (upd.rows[0]?.status === 'in_review') results.push(pass('UPDATE requests'));

    await client.query('ROLLBACK');
    results.push(pass('Smoke test rolled back (no persistent validation rows)'));
  } catch (err) {
    await client.query('ROLLBACK');
    results.push(fail(`Smoke test failed: ${err.message}`));
  }

  return results;
}

async function runStagingValidation(client, options = {}) {
  const schema = options.schema || 'public';
  if (schema !== 'public') {
    await client.query(`SET search_path TO "${schema}"`);
  }
  const sections = [];
  await client.query('SELECT 1');
  sections.push(['Connection', [pass(`Connected to Postgres (schema: ${schema})`)]]);
  sections.push(['Migrations applied', await checkMigrationsApplied(client)]);
  sections.push(['Required tables & columns', await checkTablesAndColumns(client, schema)]);
  sections.push(['Indexes', await checkIndexes(client, schema)]);
  sections.push(['Foreign keys', await checkForeignKeys(client, schema)]);
  sections.push(['Workflow step constraints', await checkWorkflowStepConstraint(client, schema)]);
  sections.push(['Smoke CRUD (rolled back)', await runSmokeTests(client)]);
  return sections;
}

function countFailures(sections) {
  return sections.reduce((n, [, results]) => n + results.filter((r) => !r.ok).length, 0);
}

function printSections(title, sections) {
  console.log(`\n=== ${title} ===`);
  for (const [sectionTitle, results] of sections) {
    console.log(`\n## ${sectionTitle}`);
    for (const r of results) {
      console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.msg}`);
    }
  }
}

module.exports = {
  MIGRATIONS_DIR,
  EXPECTED_MIGRATIONS,
  runStagingValidation,
  countFailures,
  printSections,
  pass,
  fail,
};
