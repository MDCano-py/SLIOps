/**
 * WOS-56/60 — Publish-time template version validator (sectioned schemas).
 */
const { normalizeSchemaJson, flattenSchemaFields } = require('./schema-normalize');
const { inferTemplateKind, isWorkflowKind } = require('./template-kind');

const FIELD_TYPES = new Set([
  'text',
  'long_text',
  'textarea',
  'email',
  'number',
  'date',
  'checkbox',
  'dropdown',
  'select',
  'file_ref',
  'file',
  'signature_ack',
]);

const STEP_TYPES = new Set(['Fill', 'Review', 'Approve', 'Sign', 'Upload']);

const STEP_TYPES_REQUIRING_ASSIGNEE = new Set(['Fill', 'Review', 'Approve', 'Sign', 'Upload']);

const { getAllowedAssigneeRoleSetSync, DEFAULT_WORKFLOW_ROLE_KEYS } = require('../rbac/roles-catalog');

const ALLOWED_ASSIGNEE_ROLES = new Set(DEFAULT_WORKFLOW_ROLE_KEYS);

function allowedAssigneeRoles() {
  const dynamic = getAllowedAssigneeRoleSetSync();
  return dynamic.size ? dynamic : ALLOWED_ASSIGNEE_ROLES;
}

const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

const PRE_FILL_STEP_TYPES = new Set(['Review', 'Approve', 'Sign']);

const CONTENT_KINDS = new Set(['form', 'document', 'checklist', 'inspection']);

function err(code, path, message) {
  return { code, path, message };
}

function normalizeStepType(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  const map = {
    fill: 'Fill',
    review: 'Review',
    approve: 'Approve',
    sign: 'Sign',
    upload: 'Upload',
  };
  const lower = s.toLowerCase();
  if (map[lower]) return map[lower];
  if (STEP_TYPES.has(s)) return s;
  return s;
}

function normalizeAssigneeRole(raw) {
  if (raw == null || raw === '') return null;
  return String(raw).trim().toLowerCase();
}

function validateTemplateVersion({ schema_json, workflow_json, template_kind = null, template = null, schema_only = false }) {
  const errors = [];
  const warnings = [];
  const kind = template_kind || (template ? inferTemplateKind(template) : 'form');

  const normalized = normalizeSchemaJson(schema_json, { assignIds: true });
  if (!normalized.ok) {
    normalized.errors.forEach((e) => errors.push(e));
  }
  const schema = normalized.schema_json;
  const sections = Array.isArray(schema.sections) ? schema.sections : [];

  if (CONTENT_KINDS.has(kind) || !isWorkflowKind(kind)) {
    if (!sections.length) {
      errors.push(err('EMPTY_SECTIONS', 'schema_json.sections', 'schema_json.sections must be a non-empty array.'));
    }
    let totalFields = 0;
    sections.forEach((section, sectionIndex) => {
      const base = `schema_json.sections[${sectionIndex}]`;
      if (!section.id) {
        errors.push(err('MISSING_SECTION_ID', `${base}.id`, 'Section id is required.'));
      }
      if (!section.title) {
        errors.push(err('MISSING_SECTION_TITLE', `${base}.title`, 'Section title is required.'));
      }
      if (!Array.isArray(section.fields)) {
        errors.push(err('MISSING_SECTION_FIELDS', `${base}.fields`, 'Section fields must be an array.'));
      } else {
        totalFields += section.fields.length;
      }
    });
    if (CONTENT_KINDS.has(kind) && totalFields === 0 && sections.length > 0) {
      errors.push(err('EMPTY_FIELDS', 'schema_json.sections', 'Content templates must include at least one field.'));
    }
  } else if (isWorkflowKind(kind)) {
    if (!sections.length) {
      errors.push(err('EMPTY_SECTIONS', 'schema_json.sections', 'Workflow templates require a schema section array.'));
    }
  }

  const fieldKeys = new Set();
  const fieldIds = new Set();
  const knownFieldKeys = [];

  sections.forEach((section, sectionIndex) => {
    if (!Array.isArray(section.fields)) return;
    section.fields.forEach((field, index) => {
      const base = `schema_json.sections[${sectionIndex}].fields[${index}]`;
      if (!field || typeof field !== 'object') {
        errors.push(err('INVALID_FIELD', base, 'Each field must be an object.'));
        return;
      }
      if (!field.id) {
        errors.push(err('MISSING_FIELD_ID', `${base}.id`, 'Field id is required.'));
      } else if (fieldIds.has(field.id)) {
        errors.push(err('DUPLICATE_FIELD_ID', `${base}.id`, 'Field id must be unique across all sections.'));
      } else {
        fieldIds.add(field.id);
      }
      if (!field.key) {
        errors.push(err('MISSING_FIELD_KEY', `${base}.key`, 'Field key is required.'));
      } else if (!FIELD_KEY_PATTERN.test(field.key)) {
        errors.push(
          err(
            'INVALID_FIELD_KEY',
            `${base}.key`,
            'Field key must start with a letter and contain only lowercase letters, numbers, and underscores.'
          )
        );
      } else if (fieldKeys.has(field.key)) {
        errors.push(err('DUPLICATE_FIELD_KEY', `${base}.key`, 'Field key must be unique across all sections.'));
      } else {
        fieldKeys.add(field.key);
        knownFieldKeys.push(field.key);
      }

      if (!field.label) {
        errors.push(err('MISSING_FIELD_LABEL', `${base}.label`, 'Field label is required.'));
      }
      if (!field.type) {
        errors.push(err('MISSING_FIELD_TYPE', `${base}.type`, 'Field type is required.'));
      } else if (!FIELD_TYPES.has(String(field.type))) {
        errors.push(err('UNKNOWN_FIELD_TYPE', `${base}.type`, `Unknown field type: ${field.type}`));
      }
      if (typeof field.required !== 'boolean') {
        errors.push(err('INVALID_FIELD_REQUIRED', `${base}.required`, 'Field required must be a boolean.'));
      }
      if (field.type === 'select' || field.type === 'dropdown') {
        if (!Array.isArray(field.options) || field.options.length === 0) {
          errors.push(
            err('MISSING_SELECT_OPTIONS', `${base}.options`, 'Dropdown fields must have a non-empty options array.')
          );
        }
      }
    });
  });

  if (schema_only) {
    return {
      ok: errors.length === 0,
      errors,
      warnings,
      schema_json: normalized.schema_json,
      template_kind: kind,
    };
  }

  const workflow = workflow_json && typeof workflow_json === 'object' ? workflow_json : null;

  if (!workflow || !Array.isArray(workflow.steps)) {
    errors.push(err('MISSING_STEPS', 'workflow_json.steps', 'workflow_json.steps must exist and be an array.'));
  } else if (workflow.steps.length === 0) {
    errors.push(err('EMPTY_STEPS', 'workflow_json.steps', 'workflow_json.steps must be a non-empty array.'));
  }

  let sawFill = false;
  const steps = Array.isArray(workflow?.steps) ? workflow.steps : [];

  steps.forEach((step, index) => {
    const base = `workflow_json.steps[${index}]`;
    if (!step || typeof step !== 'object') {
      errors.push(err('INVALID_STEP', base, 'Each step must be an object.'));
      return;
    }

    const stepType = normalizeStepType(step.step_type || step.type);
    if (!stepType) {
      errors.push(err('MISSING_STEP_TYPE', `${base}.step_type`, 'Step type is required.'));
      return;
    }
    if (!STEP_TYPES.has(stepType)) {
      errors.push(err('UNKNOWN_STEP_TYPE', `${base}.step_type`, `Unknown step type: ${step.step_type || step.type}`));
      return;
    }

    const assigneeRole = normalizeAssigneeRole(step.assignee_role || step.role);
    if (STEP_TYPES_REQUIRING_ASSIGNEE.has(stepType)) {
      if (!assigneeRole) {
        errors.push(
          err('MISSING_ASSIGNEE_ROLE', `${base}.assignee_role`, `${stepType} steps require assignee_role.`)
        );
      } else if (!allowedAssigneeRoles().has(assigneeRole)) {
        errors.push(
          err('UNKNOWN_ASSIGNEE_ROLE', `${base}.assignee_role`, `Unknown assignee role: ${assigneeRole}`)
        );
      }
    }

    if (stepType === 'Fill') {
      sawFill = true;
    } else if (PRE_FILL_STEP_TYPES.has(stepType) && !sawFill) {
      errors.push(
        err(
          'STEP_BEFORE_FILL',
          `${base}.step_type`,
          `${stepType} cannot occur before a Fill step.`
        )
      );
    }

    const fieldKeysRef = step.field_keys || step.fields;
    if (fieldKeysRef != null) {
      if (!Array.isArray(fieldKeysRef)) {
        errors.push(err('INVALID_FIELD_KEYS', `${base}.field_keys`, 'field_keys must be an array when provided.'));
      } else {
        fieldKeysRef.forEach((fk, fkIndex) => {
          if (!knownFieldKeys.includes(fk)) {
            errors.push(
              err(
                'UNKNOWN_FIELD_REFERENCE',
                `${base}.field_keys[${fkIndex}]`,
                `Step references unknown field key: ${fk}`
              )
            );
          }
        });
      }
    }
  });

  const fillCount = steps.filter((s) => normalizeStepType(s?.step_type || s?.type) === 'Fill').length;
  if (steps.length > 0 && fillCount === 0) {
    errors.push(err('MISSING_FILL_STEP', 'workflow_json.steps', 'At least one Fill step is required.'));
  }

  if (steps.length > 0) {
    const firstType = normalizeStepType(steps[0]?.step_type || steps[0]?.type);
    if (firstType && firstType !== 'Fill') {
      errors.push(
        err('FIRST_STEP_NOT_FILL', 'workflow_json.steps[0].step_type', 'The first actionable step must be Fill.')
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    schema_json: normalized.schema_json,
    template_kind: kind,
  };
}

module.exports = {
  validateTemplateVersion,
  FIELD_TYPES,
  STEP_TYPES,
  ALLOWED_ASSIGNEE_ROLES,
  normalizeStepType,
  normalizeAssigneeRole,
  flattenSchemaFields,
};
