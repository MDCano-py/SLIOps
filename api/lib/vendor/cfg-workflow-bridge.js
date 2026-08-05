/**
 * Bridge Vendor Management create → configurable platform workflow.
 * Passes MSA/NDA checkbox values as typed vendor.* / form.* context variables.
 */

const { isConfigurablePlatformEnabled } = require('../configuration/feature-flag');

function buildVendorWorkflowContext(record, actorEmail) {
  const vendor = {
    vendor_ref: record.refNumber,
    company_name: record.companyName || '',
    contact_name: record.contactName || '',
    contact_email: record.contactEmail || '',
    msa_required: !!record.msaRequired,
    nda_required: !!record.ndaRequired,
    request_id: record.refNumber,
    entity_type: record.entityType || '',
    po_required: record.poRequired || null,
    state_tax_exempt: record.stateTaxExempt || null,
    requested_credit_limit: record.requestedCreditLimit != null ? record.requestedCreditLimit : null,
  };
  const formValues = {
    vendor_ref: vendor.vendor_ref,
    company_name: vendor.company_name,
    legal_name: vendor.company_name,
    contact_name: vendor.contact_name,
    contact_email: vendor.contact_email,
    msa_required: vendor.msa_required,
    nda_required: vendor.nda_required,
    entity_type: vendor.entity_type,
    po_required: vendor.po_required,
    state_tax_exempt: vendor.state_tax_exempt,
    requested_credit_limit: vendor.requested_credit_limit,
  };
  return {
    event: 'vendor.request.submitted',
    vendor,
    formSubmission: { values: formValues },
    request: {
      id: record.refNumber,
      request_number: record.refNumber,
      title: `Vendor onboarding — ${vendor.company_name || record.refNumber}`,
      type: 'vendor_onboarding',
      requester_email: actorEmail || record.requestedBy || null,
    },
    requester_email: actorEmail || record.requestedBy || null,
    currentUser: { email: actorEmail || record.requestedBy || null },
    customVariables: {},
    runtimeValues: {
      'vendor.nda_required': vendor.nda_required,
      'vendor.msa_required': vendor.msa_required,
      'vendor.vendor_ref': vendor.vendor_ref,
    },
  };
}

function documentsRequiredFromRecord(record) {
  const docs = [];
  if (record.ndaRequired) docs.push('Mutual NDA');
  if (record.msaRequired) docs.push('Master Service Agreement');
  return docs;
}

/**
 * Start published vendor_onboarding_workflow when the configurable platform is on.
 * Returns null when skipped; never throws to the HTTP caller (errors are returned).
 */
async function startVendorOnboardingWorkflow(record, actorEmail) {
  if (!isConfigurablePlatformEnabled()) {
    return { started: false, reason: 'CONFIGURABLE_PLATFORM_DISABLED' };
  }
  try {
    const store = require('../configuration/store');
    store.assertPostgres();
    const workflows = await store.listDefinitions({ kind: 'workflow' });
    const wf = workflows.find((d) => d.key === 'vendor_onboarding_workflow' && d.status === 'published');
    if (!wf) {
      return { started: false, reason: 'VENDOR_WORKFLOW_NOT_PUBLISHED' };
    }
    const engine = require('../configuration/runtime/engine');
    const context = buildVendorWorkflowContext(record, actorEmail);
    const instance = await engine.startWorkflowInstance({
      workflowDefinitionId: wf.id,
      actorEmail: actorEmail || null,
      context,
    });
    return {
      started: true,
      workflow_definition_id: wf.id,
      workflow_instance_id: instance && instance.id,
      current_node_key: instance && instance.current_node_key,
      state: instance && instance.state,
      documents_required: documentsRequiredFromRecord(record),
      event: 'vendor.request.submitted',
    };
  } catch (err) {
    console.error('[vendor-cfg-bridge] start failed:', err.message || err);
    return {
      started: false,
      reason: 'START_FAILED',
      error: String(err.message || err).slice(0, 500),
    };
  }
}

module.exports = {
  buildVendorWorkflowContext,
  documentsRequiredFromRecord,
  startVendorOnboardingWorkflow,
};
