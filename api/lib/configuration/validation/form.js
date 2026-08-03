/**
 * Form definition validation + submission validation against published schema.
 */

const { LIMITS } = require('../limits');
const { isKnownFieldType, isLayoutField } = require('../fields/registry');
const { safeKey, stripControlChars } = require('../sanitize');
const { validateConditionShape, evaluateCondition } = require('../conditions');

function normalizeField(raw, index) {
  const key = safeKey(raw.key || `field_${index + 1}`);
  return {
    key,
    type: String(raw.type || 'short_text'),
    label: stripControlChars(raw.label || key).slice(0, LIMITS.MAX_LABEL_LENGTH),
    description: stripControlChars(raw.description || '').slice(0, 2000),
    placeholder: stripControlChars(raw.placeholder || '').slice(0, 500),
    help_text: stripControlChars(raw.help_text || '').slice(0, 2000),
    required: !!raw.required,
    read_only: !!raw.read_only,
    hidden: !!raw.hidden,
    default_value: raw.default_value == null ? null : raw.default_value,
    options: Array.isArray(raw.options) ? raw.options.slice(0, 200) : [],
    min_length: raw.min_length == null ? null : Number(raw.min_length),
    max_length: raw.max_length == null ? null : Number(raw.max_length),
    min_value: raw.min_value == null ? null : Number(raw.min_value),
    max_value: raw.max_value == null ? null : Number(raw.max_value),
    width: raw.width === 'half' ? 'half' : 'full',
    section_key: safeKey(raw.section_key || 'main') || 'main',
    visibility_condition: raw.visibility_condition || null,
    required_condition: raw.required_condition || null,
    order: Number.isFinite(raw.order) ? raw.order : index,
  };
}

function validateFormDefinition(payload) {
  const issues = [];
  const body = payload || {};
  const sections = Array.isArray(body.sections) ? body.sections : [{ key: 'main', title: 'Main', order: 0 }];
  const fieldsIn = Array.isArray(body.fields) ? body.fields : [];
  if (fieldsIn.length > LIMITS.MAX_FORM_FIELDS) {
    issues.push({
      severity: 'error',
      code: 'TOO_MANY_FIELDS',
      message: `Forms may have at most ${LIMITS.MAX_FORM_FIELDS} fields`,
      entity: 'form',
    });
  }
  const fields = fieldsIn.slice(0, LIMITS.MAX_FORM_FIELDS).map(normalizeField);
  const keys = new Set();
  for (const f of fields) {
    if (!f.key) {
      issues.push({ severity: 'error', code: 'FIELD_KEY_REQUIRED', message: 'Each field needs a stable key', entity: 'field' });
      continue;
    }
    if (keys.has(f.key)) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_FIELD_KEY',
        message: `Duplicate field key: ${f.key}`,
        entity: 'field',
        affected: f.key,
      });
    }
    keys.add(f.key);
    if (!isKnownFieldType(f.type)) {
      issues.push({
        severity: 'error',
        code: 'UNKNOWN_FIELD_TYPE',
        message: `Unknown field type: ${f.type}`,
        entity: 'field',
        affected: f.key,
      });
    }
    if (f.visibility_condition) issues.push(...validateConditionShape(f.visibility_condition));
    if (f.required_condition) issues.push(...validateConditionShape(f.required_condition));
  }
  return {
    ok: !issues.some((i) => i.severity === 'error'),
    issues,
    normalized: {
      layout: body.layout === 'two_column' ? 'two_column' : 'one_column',
      sections: sections.map((s, i) => ({
        key: safeKey(s.key || `section_${i + 1}`) || `section_${i + 1}`,
        title: stripControlChars(s.title || 'Section').slice(0, LIMITS.MAX_LABEL_LENGTH),
        description: stripControlChars(s.description || '').slice(0, 2000),
        collapsible: !!s.collapsible,
        order: Number.isFinite(s.order) ? s.order : i,
      })),
      fields,
    },
  };
}

function isFieldVisible(field, values) {
  if (!field.visibility_condition) return !field.hidden;
  const r = evaluateCondition(field.visibility_condition, {
    formSubmission: { values },
  });
  return r.ok ? !!r.value : true;
}

function isFieldRequired(field, values) {
  if (field.required_condition) {
    const r = evaluateCondition(field.required_condition, { formSubmission: { values } });
    if (r.ok) return !!r.value;
  }
  return !!field.required;
}

function validateSubmission(formDefinition, values) {
  const issues = [];
  const def = formDefinition || {};
  const fields = Array.isArray(def.fields) ? def.fields : [];
  const data = values && typeof values === 'object' ? values : {};
  for (const field of fields) {
    if (isLayoutField(field.type)) continue;
    if (!isFieldVisible(field, data)) continue;
    const val = data[field.key];
    const required = isFieldRequired(field, data);
    if (required && (val == null || val === '' || (Array.isArray(val) && !val.length))) {
      issues.push({
        severity: 'error',
        code: 'REQUIRED_FIELD',
        message: `${field.label || field.key} is required`,
        entity: 'field',
        affected: field.key,
      });
    }
    if (field.type === 'email' && val) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(val))) {
        issues.push({
          severity: 'error',
          code: 'INVALID_EMAIL',
          message: `${field.label || field.key} must be a valid email`,
          entity: 'field',
          affected: field.key,
        });
      }
    }
    if (field.type === 'number' || field.type === 'currency') {
      if (val != null && val !== '' && Number.isNaN(Number(val))) {
        issues.push({
          severity: 'error',
          code: 'INVALID_NUMBER',
          message: `${field.label || field.key} must be a number`,
          entity: 'field',
          affected: field.key,
        });
      }
    }
  }
  return { ok: !issues.some((i) => i.severity === 'error'), issues };
}

module.exports = {
  validateFormDefinition,
  validateSubmission,
  isFieldVisible,
  isFieldRequired,
  normalizeField,
};
