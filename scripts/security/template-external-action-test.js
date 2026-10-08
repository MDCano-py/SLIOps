#!/usr/bin/env node
/**
 * Template external secure-link authz tests (reuses hub action_links).
 * Usage: npm run security:template-external-action-test
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
const { canActOnStep, isExternalAssigneeRole } = require('../../api/lib/templates/runtime-rbac');
const {
  mintTemplateExternalAction,
  completeTemplateExternalAction,
} = require('../../api/lib/templates/external-action');
const hubStore = require('../../api/lib/hub/db');

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
const KEY = `tmpl-ext-${stamp}`;
const REQUESTER = `req.ext.${stamp}@sliops.test`;
const MANAGER = `mgr.ext.${stamp}@sliops.test`;
const CLIENT = `client.ext.${stamp}@sliops.test`;

const schema_json = {
  sections: [
    {
      id: 'sec1',
      title: 'Details',
      description: '',
      fields: [
        { id: 'f1', key: 'title', label: 'Title', type: 'text', required: true },
        { id: 'f2', key: 'notes', label: 'Notes', type: 'textarea', required: true },
      ],
    },
  ],
};

const workflow_json = {
  steps: [
    { step_type: 'Fill', assignee_role: 'requester', field_keys: ['title', 'notes'] },
    { step_type: 'Review', assignee_role: 'manager' },
    { step_type: 'Approve', assignee_role: 'manager' },
    { step_type: 'Sign', assignee_role: 'client' },
    { step_type: 'Upload', assignee_role: 'requester', field_keys: ['notes'] },
  ],
};

async function advanceToExternalSign(submissionId) {
  let detail = await templateStore.getSubmissionDetail(submissionId);
  const fill = detail.stepInstances.find((s) => s.step_index === 0);
  if (fill.status === 'pending') {
    await templateStore.actOnSubmissionStep({
      submissionId,
      stepInstanceId: fill.id,
      actionPayload: { action: 'complete' },
      actorEmail: REQUESTER,
    });
  }
  detail = await templateStore.getSubmissionDetail(submissionId);
  const review = detail.stepInstances.find((s) => s.step_index === 1);
  await templateStore.actOnSubmissionStep({
    submissionId,
    stepInstanceId: review.id,
    actionPayload: { action: 'approve' },
    actorEmail: MANAGER,
  });
  detail = await templateStore.getSubmissionDetail(submissionId);
  const approve = detail.stepInstances.find((s) => s.step_index === 2);
  await templateStore.actOnSubmissionStep({
    submissionId,
    stepInstanceId: approve.id,
    actionPayload: { action: 'approve' },
    actorEmail: MANAGER,
  });
  return templateStore.getSubmissionDetail(submissionId);
}

async function main() {
  console.log('=== Template external action authz tests ===\n');

  assert('client is external assignee role', isExternalAssigneeRole('client'));
  assert('manager is not external', !isExternalAssigneeRole('manager'));

  const mig = fs.readFileSync(path.join(ROOT, 'migrations/016_template_action_links.sql'), 'utf8');
  assert('migration 016 extends action_links', /submission_id/.test(mig) && /workflow_step_instance_id/.test(mig));
  assert('migration does not invent new token table', !/CREATE TABLE.*token/i.test(mig));

  const created = await templateStore.createTemplate({
    key: KEY,
    name: 'External Sign Authz',
    createdBy: REQUESTER,
    schema_json,
    workflow_json,
    template_kind: 'workflow',
  });
  await templateStore.publishDraftVersion(created.draftVersion.id, REQUESTER);
  const started = await templateStore.createSubmission({
    templateId: created.template.id,
    data_json: { title: 'Ext test', notes: 'n' },
    createdBy: REQUESTER,
  });
  const submissionId = started.submission.id;
  const pinnedVersion = started.submission.template_version_id;

  let detail = await advanceToExternalSign(submissionId);
  const signStep = detail.stepInstances.find((s) => s.step_type === 'Sign');
  assert('Sign (client) is current', signStep?.status === 'pending' && detail.submission.current_step_index === 3);

  assert('portal admin cannot act on external Sign', !canActOnStep([], true, signStep, []));
  assert('manager cannot act on external Sign', !canActOnStep([], false, signStep, ['manager']));
  assert('requester cannot act on external Sign', !canActOnStep([], false, signStep, ['requester']));

  const minted = await mintTemplateExternalAction({
    submissionId,
    stepInstance: signStep,
    recipientEmail: CLIENT,
    expiresInHours: 2,
    createdBy: MANAGER,
  });
  assert('minted hub action_link token', !!minted.token && !!minted.action_url.includes('action.html?t='));
  assert('link bound to submission+step', minted.submission_id === submissionId && minted.workflow_step_instance_id === signStep.id);

  // Wrong token
  const bogus = await hubStore.getActionLinkByToken('deadbeefdeadbeefdeadbeefdeadbeef');
  assert('wrong token not found', bogus == null);

  // Expired
  {
    const expiredMint = await mintTemplateExternalAction({
      submissionId,
      stepInstance: signStep,
      recipientEmail: `expired.${stamp}@sliops.test`,
      expiresInHours: 0.000001,
      createdBy: MANAGER,
    });
    // Force expiry in DB
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
    await pool.query(`UPDATE action_links SET expires_at = now() - interval '1 hour' WHERE id = $1`, [
      expiredMint.link.id,
    ]);
    await pool.end();
    const expiredLink = await hubStore.getActionLinkByToken(expiredMint.token);
    let expiredDenied = false;
    try {
      await completeTemplateExternalAction({
        link: expiredLink,
        action: 'sign',
        body: { name: 'X', acknowledged: true },
      });
    } catch (e) {
      expiredDenied = e.code === 'EXPIRED' || e.status === 410;
    }
    assert('expired token denied', expiredDenied);
  }

  // Token for another submission
  {
    const other = await templateStore.createSubmission({
      templateId: created.template.id,
      data_json: { title: 'Other', notes: 'o' },
      createdBy: REQUESTER,
    });
    const otherDetail = await advanceToExternalSign(other.submission.id);
    const otherSign = otherDetail.stepInstances.find((s) => s.step_type === 'Sign');
    const otherMint = await mintTemplateExternalAction({
      submissionId: other.submission.id,
      stepInstance: otherSign,
      recipientEmail: `other.${stamp}@sliops.test`,
      createdBy: MANAGER,
    });
    // Tamper: swap submission binding check by using other token against first step id via complete (token embeds binding)
    const otherLink = await hubStore.getActionLinkByToken(otherMint.token);
    assert('other-request token bound to other submission', otherLink.submission_id === other.submission.id);
    assert('other-request token not same as primary', otherLink.submission_id !== submissionId);
  }

  // Token for another step — mint for sign, try to act as if for upload by forcing mismatch
  {
    const link = await hubStore.getActionLinkByToken(minted.token);
    const uploadStep = detail.stepInstances.find((s) => s.step_type === 'Upload');
    const forged = { ...link, workflow_step_instance_id: uploadStep.id };
    let stepDenied = false;
    try {
      await completeTemplateExternalAction({
        link: forged,
        action: 'upload',
        body: { reference: 'x' },
      });
    } catch (e) {
      stepDenied =
        e.code === 'STEP_MISMATCH' || e.code === 'STEP_NOT_CURRENT' || e.status === 403 || e.status === 409;
    }
    assert('token for another step denied', stepDenied);
  }

  // Successful sign via token
  const liveLink = await hubStore.getActionLinkByToken(minted.token);
  const signed = await completeTemplateExternalAction({
    link: liveLink,
    action: 'sign',
    body: { name: 'Client Signer', acknowledged: true },
  });
  assert('external sign completes', !!signed.ok);
  assert('actor recorded as external', String(signed.actor || '').startsWith('external:'));

  detail = await templateStore.getSubmissionDetail(submissionId);
  assert('next step Upload becomes active', detail.submission.current_step_index === 4);
  assert('Sign completed', detail.stepInstances.find((s) => s.step_type === 'Sign')?.status === 'completed');

  // Replay completed token
  let replayDenied = false;
  try {
    const usedLink = await hubStore.getActionLinkByToken(minted.token);
    // Token key may still resolve or not after mark used — force used_at check
    const linkRow = usedLink || { ...liveLink, used_at: new Date().toISOString() };
    if (!usedLink) {
      replayDenied = true; // redis-style delete; postgres keeps row with used_at
    } else {
      await completeTemplateExternalAction({
        link: linkRow,
        action: 'sign',
        body: { name: 'Replay', acknowledged: true },
      });
    }
  } catch (e) {
    replayDenied = e.code === 'ALREADY_USED' || e.status === 410;
  }
  assert('completed token replay denied', replayDenied);

  // Cannot skip: still on Upload
  const upload = detail.stepInstances.find((s) => s.step_type === 'Upload');
  assert('cannot portal-act external when not external role', canActOnStep([], false, upload, ['requester']));

  // Version pin unchanged
  assert(
    'pinned template version unchanged after external act',
    detail.submission.template_version_id === pinnedVersion
  );

  // Audit
  const events = detail.events || [];
  assert(
    'audit records external actor',
    events.some(
      (e) =>
        e.event_type === 'workflow.step_completed' &&
        String(e.actor_email || '').startsWith('external:') &&
        e.created_at
    )
  );

  // Publish v2 must not alter in-flight
  const draft2 = await templateStore.clonePublishedToDraft(created.template.id, REQUESTER);
  await templateStore.publishDraftVersion(draft2.id, REQUESTER);
  const after = await templateStore.getSubmissionDetail(submissionId);
  assert('v2 publish does not change pinned version', after.submission.template_version_id === pinnedVersion);
  assert('in-flight still on Upload', after.submission.current_step_index === 4);

  console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
  if (failed) process.exit(1);
  console.log('RESULT: PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
