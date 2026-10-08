#!/usr/bin/env node
/**
 * Local workflow E2E (Postgres template runtime):
 * Fill → Review → Approve → External Sign (hub action_links) → Upload → Complete
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(path.join(ROOT, '.env.local.postgres'));
loadEnvFile(path.join(ROOT, '.env.local'));
process.env.HUB_STORE_MODE = 'postgres';
process.env.HUB_USE_LOCAL_STORE = '0';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

const templateStore = require('../../api/lib/templates/store');
const { canActOnStep } = require('../../api/lib/templates/runtime-rbac');
const {
  mintTemplateExternalAction,
  completeTemplateExternalAction,
} = require('../../api/lib/templates/external-action');
const hubStore = require('../../api/lib/hub/db');
const { Pool } = require('pg');

let passed = 0;
let failed = 0;
function assert(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const stamp = Date.now();
const FORM_KEY = `swp-form-e2e-${stamp}`;
const WF_KEY = `swp-wf-e2e-${stamp}`;
const REQUESTER = `requester.swp.${stamp}@sliops.test`;
const MANAGER = `manager.swp.${stamp}@sliops.test`;
const CLIENT = `client.swp.${stamp}@sliops.test`;

const schema_json = {
  sections: [
    {
      id: 'sec_permit',
      title: 'Permit details',
      description: '',
      fields: [
        { id: 'field_work_location', key: 'work_location', label: 'Work location', type: 'text', required: true },
        { id: 'field_hazard_summary', key: 'hazard_summary', label: 'Hazard summary', type: 'textarea', required: true },
        { id: 'field_requested_by', key: 'requested_by', label: 'Requested by', type: 'text', required: true },
        { id: 'field_evidence', key: 'evidence_note', label: 'Evidence note', type: 'text', required: false },
      ],
    },
  ],
};

const workflow_json = {
  steps: [
    {
      step_type: 'Fill',
      assignee_role: 'requester',
      field_keys: ['work_location', 'hazard_summary', 'requested_by'],
    },
    { step_type: 'Review', assignee_role: 'manager' },
    { step_type: 'Approve', assignee_role: 'manager' },
    { step_type: 'Sign', assignee_role: 'client' },
    { step_type: 'Upload', assignee_role: 'requester', field_keys: ['evidence_note'] },
  ],
};

async function main() {
  console.log('=== Local SWP E2E with External Sign ===\n');
  assert('template store is Postgres mode', templateStore.isTemplatePostgresMode() === true);

  const wfCreated = await templateStore.createTemplate({
    key: WF_KEY,
    name: 'SWP Workflow Definition (local E2E)',
    createdBy: REQUESTER,
    schema_json,
    workflow_json,
    template_kind: 'workflow',
  });
  const wfPub = await templateStore.publishDraftVersion(wfCreated.draftVersion.id, REQUESTER);
  assert('workflow published', wfPub?.status === 'published');

  const formCreated = await templateStore.createTemplate({
    key: FORM_KEY,
    name: 'Safe Work Permit Form (local E2E)',
    createdBy: REQUESTER,
    schema_json,
    workflow_json: {
      steps: [
        {
          step_type: 'Fill',
          assignee_role: 'requester',
          field_keys: ['work_location', 'hazard_summary', 'requested_by'],
        },
      ],
    },
    template_kind: 'form',
    launch_config_json: { space_key: 'forms', enabled: true, label: 'SWP E2E' },
  });
  await templateStore.upsertTemplateBinding(formCreated.template.id, {
    binding_mode: 'required',
    workflow_template_id: wfCreated.template.id,
    source_space_key: 'forms',
  });
  const formPub = await templateStore.publishDraftVersion(formCreated.draftVersion.id, REQUESTER);
  assert('form published + bound', formPub?.status === 'published');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
  const launchRow = await pool.query(
    `SELECT id FROM template_launch_entries WHERE template_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [formCreated.template.id]
  );
  const launchId = launchRow.rows[0]?.id;
  assert('launch entry linked', !!launchId);

  const fillData = {
    work_location: 'Unit 4 — Tank Farm',
    hazard_summary: 'Hot work near flammable storage',
    requested_by: REQUESTER,
  };

  const launched = await templateStore.submitLaunchEntry({
    launchEntryId: launchId,
    data_json: fillData,
    createdBy: REQUESTER,
  });
  const submissionId = launched.submission.id;
  const pinnedVersion = launched.submission.template_version_id;
  assert('submission created with 5 steps', (launched.stepInstances || []).length === 5);

  let detail = await templateStore.getSubmissionDetail(submissionId);
  assert('Fill auto-completed; Review active', detail.submission.current_step_index === 1);

  const review = detail.stepInstances.find((s) => s.step_index === 1);
  assert('internal cannot skip to Sign', !canActOnStep([], false, detail.stepInstances.find((s) => s.step_type === 'Sign'), ['manager']));
  await templateStore.actOnSubmissionStep({
    submissionId,
    stepInstanceId: review.id,
    actionPayload: { action: 'approve' },
    actorEmail: MANAGER,
  });

  detail = await templateStore.getSubmissionDetail(submissionId);
  const approve = detail.stepInstances.find((s) => s.step_type === 'Approve' && s.status === 'pending');
  await templateStore.actOnSubmissionStep({
    submissionId,
    stepInstanceId: approve.id,
    actionPayload: { action: 'approve' },
    actorEmail: MANAGER,
  });

  detail = await templateStore.getSubmissionDetail(submissionId);
  const signStep = detail.stepInstances.find((s) => s.step_type === 'Sign');
  assert('External Sign (client) pending', signStep?.status === 'pending' && signStep.assignee_role === 'client');
  assert('portal users blocked from external Sign', !canActOnStep([], true, signStep, []));

  const minted = await mintTemplateExternalAction({
    submissionId,
    stepInstance: signStep,
    recipientEmail: CLIENT,
    expiresInHours: 24,
    createdBy: MANAGER,
  });
  assert('secure action URL uses action.html?t=', /action\.html\?t=/.test(minted.action_url));
  assert('reuses hub action_links (no new crypto table)', !!minted.link?.id);

  // Direct token completion (email delivery left for EC2)
  const link = await hubStore.getActionLinkByToken(minted.token);
  const signed = await completeTemplateExternalAction({
    link,
    action: 'sign',
    body: { name: 'Client Rep', acknowledged: true },
  });
  assert('external Sign completed via action_link', signed.ok === true);
  assert('audit actor is external:*', String(signed.actor).startsWith('external:'));

  detail = await templateStore.getSubmissionDetail(submissionId);
  assert('Upload activates after external Sign', detail.submission.current_step_index === 4);
  const upload = detail.stepInstances.find((s) => s.step_type === 'Upload');
  await templateStore.actOnSubmissionStep({
    submissionId,
    stepInstanceId: upload.id,
    actionPayload: { action: 'upload', reference: 'permit-scan.pdf' },
    actorEmail: REQUESTER,
  });

  detail = await templateStore.getSubmissionDetail(submissionId);
  assert('workflow completed', detail.submission.status === 'completed');
  assert('pinned version survived', detail.submission.template_version_id === pinnedVersion);

  const events = await pool.query(
    `SELECT event_type, actor_email, metadata_json, created_at FROM form_submission_events WHERE submission_id = $1`,
    [submissionId]
  );
  assert(
    'audit has external sign event',
    events.rows.some(
      (r) =>
        r.event_type === 'workflow.step_completed' &&
        String(r.actor_email || '').startsWith('external:') &&
        r.created_at
    )
  );

  // Replay denied
  let replay = false;
  try {
    const used = await hubStore.getActionLinkByToken(minted.token);
    await completeTemplateExternalAction({ link: used, action: 'sign', body: { name: 'x', acknowledged: true } });
  } catch (e) {
    replay = e.code === 'ALREADY_USED' || e.status === 410;
  }
  assert('token replay denied', replay);

  const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
  if (baseUrl) {
    const headers = { 'Content-Type': 'application/json', 'x-portal-noauth': '1' };
    const list = await fetch(`${baseUrl}/api/maintainx?path=/hub/templates`, { headers });
    assert('HTTP Forms OK', list.status === 200);
    // Minted token GET via public action route
    const getRes = await fetch(
      `${baseUrl}/api/maintainx?path=${encodeURIComponent('/hub/action/' + minted.token)}`,
      { headers }
    );
    assert('used token GET fails closed', getRes.status === 410 || getRes.status === 404, `status=${getRes.status}`);
  }

  console.log('\n--- Outbound email ---');
  console.log('REMAINING_FOR_EC2: action URL/token proven locally; outbound email delivery not exercised.');

  await pool.end();
  console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
  if (failed) process.exit(1);
  console.log('RESULT: PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
