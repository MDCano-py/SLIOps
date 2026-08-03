/**
 * Seed draft/published configuration templates (definitions only — no demo requests).
 * Respects existing keys (idempotent upsert-by-skip).
 */

const store = require('../store');

function ndaFormPayload() {
  return {
    layout: 'one_column',
    sections: [
      { key: 'counterparty', title: 'Counterparty', order: 0 },
      { key: 'terms', title: 'Terms', order: 1 },
    ],
    fields: [
      { key: 'legal_name', type: 'short_text', label: 'Counterparty legal name', required: true, section_key: 'counterparty', order: 0 },
      { key: 'contact_email', type: 'email', label: 'Contact email', required: true, section_key: 'counterparty', order: 1 },
      { key: 'contact_name', type: 'short_text', label: 'Contact name', required: true, section_key: 'counterparty', order: 2 },
      {
        key: 'nda_term_months',
        type: 'number',
        label: 'NDA term (months)',
        required: true,
        section_key: 'terms',
        order: 3,
        default_value: 24,
      },
      {
        key: 'requires_client_approval',
        type: 'yes_no',
        label: 'Requires client approval',
        section_key: 'terms',
        order: 4,
      },
    ],
  };
}

function purchaseFormPayload() {
  return {
    layout: 'one_column',
    sections: [{ key: 'purchase', title: 'Purchase details', order: 0 }],
    fields: [
      { key: 'item_description', type: 'long_text', label: 'Item description', required: true, section_key: 'purchase', order: 0 },
      { key: 'total_cost', type: 'currency', label: 'Total cost', required: true, section_key: 'purchase', order: 1 },
      { key: 'vendor_name', type: 'short_text', label: 'Vendor', required: true, section_key: 'purchase', order: 2 },
      {
        key: 'manager_explanation',
        type: 'long_text',
        label: 'Manager explanation',
        section_key: 'purchase',
        order: 3,
        required_condition: {
          all: [
            {
              left: { type: 'variable', key: 'form.total_cost' },
              operator: 'greater_than',
              right: { type: 'literal', value: 10000 },
            },
          ],
        },
      },
    ],
  };
}

function vendorFormPayload() {
  return {
    layout: 'one_column',
    sections: [
      { key: 'vendor', title: 'Vendor information', order: 0 },
      { key: 'docs', title: 'Documents', order: 1 },
    ],
    fields: [
      { key: 'legal_name', type: 'short_text', label: 'Legal name', required: true, section_key: 'vendor', order: 0 },
      { key: 'contact_email', type: 'email', label: 'Contact email', required: true, section_key: 'vendor', order: 1 },
      {
        key: 'vendor_type',
        type: 'select',
        label: 'Vendor type',
        required: true,
        section_key: 'vendor',
        order: 2,
        options: [
          { value: 'External Vendor', label: 'External Vendor' },
          { value: 'Internal', label: 'Internal' },
        ],
      },
      {
        key: 'insurance_certificate',
        type: 'file_upload',
        label: 'Insurance certificate',
        section_key: 'docs',
        order: 3,
        visibility_condition: {
          all: [
            {
              left: { type: 'variable', key: 'form.vendor_type' },
              operator: 'equals',
              right: { type: 'literal', value: 'External Vendor' },
            },
          ],
        },
        required_condition: {
          all: [
            {
              left: { type: 'variable', key: 'form.vendor_type' },
              operator: 'equals',
              right: { type: 'literal', value: 'External Vendor' },
            },
          ],
        },
      },
    ],
  };
}

function ndaDocumentPayload() {
  return {
    title: 'Mutual Non-Disclosure Agreement',
    document_type: 'nda',
    body_html: `<h1>Mutual Non-Disclosure Agreement</h1>
<p>This Mutual Non-Disclosure Agreement is entered into as of {{request.effective_date}} between {{organization.legal_name}} and {{form.legal_name}}.</p>
<p>Contact: {{form.contact_name}} &lt;{{form.contact_email}}&gt;</p>
<p>Term: {{form.nda_term_months}} months.</p>
<p>Organization: {{organization.name}}</p>`,
    footer_text: 'Confidential — Streamline Operations',
    signers: [
      { key: 'internal', role: 'legal', order: 1, allow_typed: true, require_review: true },
      { key: 'external', role: 'client', order: 2, allow_typed: true, require_drawn: false, require_review: true },
    ],
    signing_mode: 'sequential',
    pdf_status: 'unavailable',
    pdf_message: 'Final sealed PDF generation is not available in this release.',
  };
}

function ndaWorkflowPayload() {
  return {
    nodes: [
      { key: 'start', type: 'trigger.request_created', name: 'NDA request created', x: 80, y: 40 },
      { key: 'fill', type: 'human.fill', name: 'Counterparty form', x: 80, y: 140, config: { assignee_role: 'requester' } },
      { key: 'legal_review', type: 'human.review', name: 'Legal reviews NDA', x: 80, y: 240, config: { assignee_role: 'legal' } },
      {
        key: 'legal_decision',
        type: 'logic.condition',
        name: 'Does Legal approve?',
        x: 80,
        y: 340,
        config: {
          condition: {
            all: [
              {
                left: { type: 'variable', key: 'form.legal_approved' },
                operator: 'is_true',
                right: { type: 'literal', value: true },
              },
            ],
          },
        },
      },
      { key: 'corrections', type: 'human.provide_info', name: 'Return for corrections', x: 300, y: 340, config: { assignee_role: 'requester' } },
      { key: 'generate', type: 'document.generate', name: 'Generate NDA', x: 80, y: 440, config: {} },
      { key: 'sign_internal', type: 'human.sign', name: 'Internal signature', x: 80, y: 540, config: { assignee_role: 'legal' } },
      { key: 'sign_external', type: 'human.sign', name: 'External signature', x: 80, y: 640, config: { assignee_role: 'client' } },
      { key: 'archive_doc', type: 'document.archive', name: 'Archive document', x: 80, y: 740 },
      { key: 'complete', type: 'terminal.complete', name: 'Complete request', x: 80, y: 840 },
    ],
    connections: [
      { key: 'c1', source: 'start', target: 'fill', outcome_key: 'default', sort_order: 0 },
      { key: 'c2', source: 'fill', target: 'legal_review', outcome_key: 'default', sort_order: 0 },
      { key: 'c3', source: 'legal_review', target: 'legal_decision', outcome_key: 'approved', sort_order: 0 },
      { key: 'c4', source: 'legal_review', target: 'corrections', outcome_key: 'rejected', label: 'No', sort_order: 1 },
      { key: 'c5', source: 'legal_decision', target: 'generate', outcome_key: 'yes', label: 'Yes', sort_order: 0 },
      { key: 'c6', source: 'legal_decision', target: 'corrections', outcome_key: 'no', label: 'No', sort_order: 1 },
      { key: 'c7', source: 'corrections', target: 'fill', outcome_key: 'default', sort_order: 0 },
      { key: 'c8', source: 'generate', target: 'sign_internal', outcome_key: 'success', sort_order: 0 },
      { key: 'c9', source: 'sign_internal', target: 'sign_external', outcome_key: 'default', sort_order: 0 },
      { key: 'c10', source: 'sign_external', target: 'archive_doc', outcome_key: 'default', sort_order: 0 },
      { key: 'c11', source: 'archive_doc', target: 'complete', outcome_key: 'default', sort_order: 0 },
    ],
  };
}

function purchaseWorkflowPayload() {
  return {
    nodes: [
      { key: 'start', type: 'trigger.form_submitted', name: 'Purchase submitted', x: 80, y: 40 },
      { key: 'manager', type: 'human.review', name: 'Manager review', x: 80, y: 140, config: { assignee_role: 'manager' } },
      {
        key: 'cost_gate',
        type: 'logic.condition',
        name: 'Is total over $10,000?',
        x: 80,
        y: 240,
        config: {
          condition: {
            all: [
              {
                left: { type: 'variable', key: 'form.total_cost' },
                operator: 'greater_than',
                right: { type: 'literal', value: 10000 },
              },
            ],
          },
        },
      },
      { key: 'accounting', type: 'human.approve', name: 'Accounting review', x: 280, y: 340, config: { assignee_role: 'ap' } },
      { key: 'executive', type: 'human.approve', name: 'Executive approval', x: 280, y: 440, config: { assignee_role: 'manager' } },
      { key: 'approve_low', type: 'human.approve', name: 'Approve', x: 80, y: 340, config: { assignee_role: 'manager' } },
      { key: 'mx', type: 'integration.maintainx_create', name: 'Create work order', x: 180, y: 540 },
      { key: 'notify', type: 'notify.completion', name: 'Completion notification', x: 180, y: 640 },
      { key: 'complete', type: 'terminal.complete', name: 'Complete', x: 180, y: 740 },
    ],
    connections: [
      { key: 'c1', source: 'start', target: 'manager', outcome_key: 'default', sort_order: 0 },
      { key: 'c2', source: 'manager', target: 'cost_gate', outcome_key: 'default', sort_order: 0 },
      { key: 'c3', source: 'cost_gate', target: 'approve_low', outcome_key: 'no', label: 'No', sort_order: 0 },
      { key: 'c4', source: 'cost_gate', target: 'accounting', outcome_key: 'yes', label: 'Yes', sort_order: 1 },
      { key: 'c5', source: 'accounting', target: 'executive', outcome_key: 'default', sort_order: 0 },
      { key: 'c6', source: 'executive', target: 'mx', outcome_key: 'default', sort_order: 0 },
      { key: 'c7', source: 'approve_low', target: 'mx', outcome_key: 'default', sort_order: 0 },
      { key: 'c8', source: 'mx', target: 'notify', outcome_key: 'success', sort_order: 0 },
      { key: 'c9', source: 'notify', target: 'complete', outcome_key: 'default', sort_order: 0 },
    ],
  };
}

function vendorWorkflowPayload() {
  return {
    nodes: [
      { key: 'start', type: 'trigger.request_created', name: 'Vendor onboarding started', x: 80, y: 40 },
      { key: 'fill', type: 'human.fill', name: 'Vendor information', x: 80, y: 140, config: { assignee_role: 'requester' } },
      { key: 'upload', type: 'human.upload', name: 'Required document upload', x: 80, y: 240, config: { assignee_role: 'requester' } },
      { key: 'ops', type: 'human.review', name: 'Operations review', x: 80, y: 340, config: { assignee_role: 'manager' } },
      { key: 'acct', type: 'human.review', name: 'Accounting review', x: 80, y: 440, config: { assignee_role: 'ap' } },
      { key: 'decision', type: 'human.approve', name: 'Approve or reject', x: 80, y: 540, config: { assignee_role: 'manager' } },
      { key: 'activate', type: 'logic.update_request', name: 'Vendor activation', x: 80, y: 640 },
      { key: 'complete', type: 'terminal.complete', name: 'Completion', x: 80, y: 740 },
      { key: 'reject', type: 'terminal.reject', name: 'Rejected', x: 280, y: 640 },
    ],
    connections: [
      { key: 'c1', source: 'start', target: 'fill', outcome_key: 'default', sort_order: 0 },
      { key: 'c2', source: 'fill', target: 'upload', outcome_key: 'default', sort_order: 0 },
      { key: 'c3', source: 'upload', target: 'ops', outcome_key: 'default', sort_order: 0 },
      { key: 'c4', source: 'ops', target: 'acct', outcome_key: 'default', sort_order: 0 },
      { key: 'c5', source: 'acct', target: 'decision', outcome_key: 'default', sort_order: 0 },
      { key: 'c6', source: 'decision', target: 'activate', outcome_key: 'approved', label: 'Approved', sort_order: 0 },
      { key: 'c7', source: 'decision', target: 'reject', outcome_key: 'rejected', label: 'Rejected', sort_order: 1 },
      { key: 'c8', source: 'activate', target: 'complete', outcome_key: 'default', sort_order: 0 },
    ],
  };
}

function opsDashboardPayload() {
  return {
    name: 'Operations default',
    description: 'Role-flexible operational dashboard',
    audience_roles: ['hub_admin', 'manager', 'ap', 'legal'],
    layout: 'grid',
    widgets: [
      { key: 'kpi_open', type: 'request_count', title: 'Open requests', size: 'sm', order: 0 },
      { key: 'waiting', type: 'waiting_on_me', title: 'Waiting on me', size: 'md', order: 1 },
      { key: 'tasks', type: 'my_tasks', title: 'My Tasks', size: 'md', order: 2 },
      { key: 'aging', type: 'aging_requests', title: 'Aging', size: 'lg', order: 3 },
      { key: 'health', type: 'admin_system_health', title: 'System health', size: 'md', order: 4 },
    ],
  };
}

async function ensureDefinition({ kind, key, name, description, payload, actorEmail, publish }) {
  const existing = (await store.listDefinitions({ kind })).find((d) => d.key === key);
  if (existing) {
    return { key, status: 'exists', id: existing.id };
  }
  let def = await store.createDraftDefinition({
    kind,
    key,
    name,
    description,
    payload,
    actorEmail,
  });
  if (publish) {
    def = await store.publishDefinition({
      definitionId: def.id,
      actorEmail,
      acknowledgeWarnings: true,
    });
  }
  return { key, status: 'created', id: def.id, published: !!publish };
}

async function seedDefaultTemplates(actorEmail) {
  store.assertPostgres();
  const results = [];
  results.push(
    await ensureDefinition({
      kind: 'form',
      key: 'nda_counterparty_form',
      name: 'NDA counterparty form',
      description: 'Default NDA intake form',
      payload: ndaFormPayload(),
      actorEmail,
      publish: true,
    })
  );
  results.push(
    await ensureDefinition({
      kind: 'form',
      key: 'purchase_request_form',
      name: 'Purchase request form',
      description: 'Default purchase approval form',
      payload: purchaseFormPayload(),
      actorEmail,
      publish: true,
    })
  );
  results.push(
    await ensureDefinition({
      kind: 'form',
      key: 'vendor_onboarding_form',
      name: 'Vendor onboarding form',
      description: 'Default vendor onboarding form',
      payload: vendorFormPayload(),
      actorEmail,
      publish: true,
    })
  );
  results.push(
    await ensureDefinition({
      kind: 'document',
      key: 'mutual_nda_template',
      name: 'Mutual NDA template',
      description: 'Web NDA with variables and signature blocks',
      payload: ndaDocumentPayload(),
      actorEmail,
      publish: true,
    })
  );

  // Fix NDA workflow cycle: corrections -> fill creates a cycle which validator rejects.
  // Seed a publishable acyclic variant: corrections ends at fill only via controlled human path
  // by removing the return edge and using a terminal revision path instead for the seed.
  const ndaWf = ndaWorkflowPayload();
  ndaWf.connections = ndaWf.connections.filter((c) => !(c.source === 'corrections' && c.target === 'fill'));
  ndaWf.nodes.push({ key: 'revision_wait', type: 'terminal.cancel', name: 'Await revised request', x: 300, y: 440 });
  ndaWf.connections.push({
    key: 'c7b',
    source: 'corrections',
    target: 'revision_wait',
    outcome_key: 'default',
    sort_order: 0,
  });

  results.push(
    await ensureDefinition({
      kind: 'workflow',
      key: 'nda_request_workflow',
      name: 'NDA request workflow',
      description: 'NDA create → review → sign → archive (acyclic seed; revision modeled without unbounded loop)',
      payload: ndaWf,
      actorEmail,
      publish: true,
    })
  );
  results.push(
    await ensureDefinition({
      kind: 'workflow',
      key: 'purchase_approval_workflow',
      name: 'Purchase approval workflow',
      description: 'Manager + conditional accounting/executive path',
      payload: purchaseWorkflowPayload(),
      actorEmail,
      publish: true,
    })
  );
  results.push(
    await ensureDefinition({
      kind: 'workflow',
      key: 'vendor_onboarding_workflow',
      name: 'Vendor onboarding workflow',
      description: 'Vendor info → docs → ops/AP review → activation',
      payload: vendorWorkflowPayload(),
      actorEmail,
      publish: true,
    })
  );
  results.push(
    await ensureDefinition({
      kind: 'dashboard',
      key: 'operations_default_dashboard',
      name: 'Operations default dashboard',
      description: 'Configurable widget layout using existing operational concepts',
      payload: opsDashboardPayload(),
      actorEmail,
      publish: true,
    })
  );
  results.push(
    await ensureDefinition({
      kind: 'request_type',
      key: 'nda_request',
      name: 'NDA Request',
      description: 'Configurable NDA request type',
      payload: {
        key: 'nda_request',
        display_name: 'NDA Request',
        description: 'Non-disclosure agreement request',
        icon: 'document',
        number_prefix: 'NDA-',
        default_priority: 'normal',
        available_priorities: ['low', 'normal', 'high'],
        initiating_roles: ['requester', 'hub_admin'],
        participant_roles: ['legal', 'client', 'requester'],
      },
      actorEmail,
      publish: true,
    })
  );
  results.push(
    await ensureDefinition({
      kind: 'request_type',
      key: 'work_order',
      name: 'Work Order',
      description: 'Represents existing WOS work-order style requests as a configurable type',
      payload: {
        key: 'work_order',
        display_name: 'Work Order',
        description: 'Compatibility request type for existing operational work orders',
        icon: 'wrench',
        number_prefix: 'WO-',
        default_priority: 'normal',
        available_priorities: ['low', 'normal', 'high', 'urgent'],
        initiating_roles: ['requester', 'hub_admin'],
        participant_roles: ['manager', 'ap', 'legal', 'requester'],
      },
      actorEmail,
      publish: true,
    })
  );

  return { seeded: results };
}

module.exports = {
  seedDefaultTemplates,
  ndaFormPayload,
  purchaseFormPayload,
  vendorFormPayload,
  ndaDocumentPayload,
  ndaWorkflowPayload,
  purchaseWorkflowPayload,
  vendorWorkflowPayload,
};
