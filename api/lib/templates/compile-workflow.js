/**
 * WOS-56/60 — Compile validated template version into runtime-safe contract.
 */
const { normalizeStepType, normalizeAssigneeRole } = require('./validator');
const { normalizeSchemaJson } = require('./schema-normalize');
const { inferTemplateKind } = require('./template-kind');

const ACTION_BY_STEP_TYPE = {
  Fill: 'fill',
  Review: 'review',
  Approve: 'approve',
  Sign: 'sign',
  Upload: 'upload',
};

const RUNTIME_FIELD_KEYS = new Set(['id', 'key', 'type', 'label', 'required', 'options', 'placeholder', 'help_text']);

function compileField(field) {
  const out = {
    id: field.id,
    key: field.key,
    type: field.type,
    label: field.label,
    required: field.required === true,
  };
  if ((field.type === 'select' || field.type === 'dropdown') && Array.isArray(field.options)) {
    out.options = field.options.map((o) => String(o));
  }
  if (field.placeholder) out.placeholder = String(field.placeholder);
  if (field.help_text) out.help_text = String(field.help_text);
  return out;
}

function compileSection(section) {
  return {
    id: section.id,
    title: section.title,
    description: section.description != null ? String(section.description) : '',
    fields: (Array.isArray(section.fields) ? section.fields : []).map(compileField),
  };
}

function compileTemplateVersion({ schema_json, workflow_json, template_kind = null, template = null }) {
  const kind = template_kind || (template ? inferTemplateKind(template) : 'form');
  const normalized = normalizeSchemaJson(schema_json, { assignIds: true });
  const schema = normalized.schema_json;
  const sections = (Array.isArray(schema.sections) ? schema.sections : []).map(compileSection);
  const fields = sections.flatMap((s) => s.fields);
  const fieldKeyOrder = fields.map((f) => f.key);

  const workflow = workflow_json && typeof workflow_json === 'object' ? workflow_json : {};

  const steps = (Array.isArray(workflow.steps) ? workflow.steps : []).map((step, index) => {
    const stepType = normalizeStepType(step.step_type || step.type);
    const assigneeRole = normalizeAssigneeRole(step.assignee_role || step.role);
    const compiled = {
      index,
      step_type: stepType,
      assignee_role: assigneeRole,
      action: ACTION_BY_STEP_TYPE[stepType] || String(stepType || '').toLowerCase(),
    };

    let fieldKeys = step.field_keys || step.fields;
    if (stepType === 'Fill') {
      if (!Array.isArray(fieldKeys) || fieldKeys.length === 0) {
        fieldKeys = [...fieldKeyOrder];
      }
      compiled.field_keys = fieldKeys.filter((k) => fieldKeyOrder.includes(k));
    } else if (Array.isArray(fieldKeys) && fieldKeys.length > 0) {
      compiled.field_keys = fieldKeys.filter((k) => fieldKeyOrder.includes(k));
    }

    return compiled;
  });

  return {
    version: 1,
    template_kind: kind,
    sections,
    fields,
    steps,
  };
}

/** @deprecated Use compileTemplateVersion */
function compileWorkflow(workflowJson) {
  return compileTemplateVersion({ schema_json: { sections: [{ id: 'sec_default', title: 'Details', description: '', fields: [] }] }, workflow_json: workflowJson });
}

module.exports = {
  compileTemplateVersion,
  compileWorkflow,
  RUNTIME_FIELD_KEYS,
};
