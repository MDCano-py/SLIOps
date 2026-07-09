/**
 * WOS-57/60 — Safe starter schema/workflow for new admin templates (sectioned).
 */

function sectionedFields(fields, title = 'Details') {
  return {
    sections: [
      {
        id: 'sec_default',
        title,
        description: '',
        fields: fields.map((f) => ({
          id: `field_${f.key}`,
          key: f.key,
          label: f.label,
          type: f.type,
          required: f.required === true,
          ...(f.options ? { options: f.options } : {}),
        })),
      },
    ],
  };
}

function newTemplateStarter() {
  return {
    schema_json: sectionedFields([
      { key: 'title', type: 'text', label: 'Title', required: true },
      { key: 'description', type: 'textarea', label: 'Description', required: true },
      { key: 'requested_by', type: 'text', label: 'Requested By', required: true },
    ]),
    workflow_json: {
      steps: [
        {
          step_type: 'Fill',
          assignee_role: 'requester',
          field_keys: ['title', 'description', 'requested_by'],
        },
        { step_type: 'Review', assignee_role: 'manager' },
        { step_type: 'Sign', assignee_role: 'requester' },
      ],
    },
  };
}

function basicInternalApprovalFixture(overrides = {}) {
  return {
    key: overrides.key || 'basic-internal-approval',
    name: overrides.name || 'Basic Internal Approval',
    description: overrides.description || 'Simple internal approval template for template tests',
    template_kind: overrides.template_kind || 'workflow',
    schema_json: newTemplateStarter().schema_json,
    workflow_json: {
      steps: [
        {
          step_type: 'Fill',
          assignee_role: 'requester',
          field_keys: ['title', 'description', 'requested_by'],
        },
        { step_type: 'Review', assignee_role: 'manager' },
        { step_type: 'Sign', assignee_role: 'legal' },
      ],
    },
    validation_json: {},
    ...overrides,
  };
}

module.exports = { basicInternalApprovalFixture, newTemplateStarter, sectionedFields };
