/**
 * WOS-62 — Server-side submission payload validation against pinned compiled schema.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeFieldType(type) {
  const t = String(type || 'text').toLowerCase();
  if (t === 'long_text') return 'textarea';
  if (t === 'dropdown') return 'select';
  if (t === 'file_ref') return 'file';
  return t;
}

function flattenCompiledFields(compiled) {
  const sections = compiled?.sections || [];
  const fields = [];
  sections.forEach((sec, si) => {
    (sec.fields || []).forEach((f, fi) => {
      fields.push({
        ...f,
        type: normalizeFieldType(f.type),
        sectionIndex: si,
        sectionId: sec.id,
        sectionTitle: sec.title,
        fieldIndex: fi,
      });
    });
  });
  if (!fields.length && Array.isArray(compiled?.fields)) {
    compiled.fields.forEach((f, fi) => {
      fields.push({
        ...f,
        type: normalizeFieldType(f.type),
        sectionIndex: 0,
        sectionId: 'sec_default',
        sectionTitle: 'Details',
        fieldIndex: fi,
      });
    });
  }
  return fields;
}

function isEmptyValue(field, value) {
  const type = normalizeFieldType(field.type);
  if (type === 'checkbox') return value !== true;
  if (type === 'signature_ack') return value?.acknowledged !== true;
  if (value == null) return true;
  if (typeof value === 'string') return !value.trim();
  return false;
}

function validateFieldValue(field, value) {
  const errors = [];
  const type = normalizeFieldType(field.type);
  const path = `sections[${field.sectionIndex}].fields[${field.fieldIndex}]`;

  if (field.required && isEmptyValue(field, value)) {
    errors.push({
      code: 'REQUIRED_FIELD',
      path,
      sectionTitle: field.sectionTitle,
      sectionId: field.sectionId,
      fieldKey: field.key,
      fieldLabel: field.label,
      message: `${field.label || field.key} is required`,
    });
    return errors;
  }

  if (isEmptyValue(field, value)) return errors;

  switch (type) {
    case 'email':
      if (!EMAIL_RE.test(String(value).trim())) {
        errors.push({
          code: 'INVALID_EMAIL',
          path,
          sectionTitle: field.sectionTitle,
          fieldKey: field.key,
          fieldLabel: field.label,
          message: `${field.label || field.key} must be a valid email`,
        });
      }
      break;
    case 'number': {
      const n = Number(value);
      if (Number.isNaN(n)) {
        errors.push({
          code: 'INVALID_NUMBER',
          path,
          sectionTitle: field.sectionTitle,
          fieldKey: field.key,
          fieldLabel: field.label,
          message: `${field.label || field.key} must be a number`,
        });
      }
      break;
    }
    case 'select':
      if (field.required && (value == null || value === '')) {
        errors.push({
          code: 'REQUIRED_SELECT',
          path,
          sectionTitle: field.sectionTitle,
          fieldKey: field.key,
          fieldLabel: field.label,
          message: `${field.label || field.key} requires a selection`,
        });
      } else if (value != null && field.options?.length && !field.options.includes(String(value))) {
        errors.push({
          code: 'INVALID_OPTION',
          path,
          sectionTitle: field.sectionTitle,
          fieldKey: field.key,
          fieldLabel: field.label,
          message: `${field.label || field.key} has an invalid option`,
        });
      }
      break;
    case 'signature_ack':
      if (field.required && value?.acknowledged !== true) {
        errors.push({
          code: 'SIGNATURE_REQUIRED',
          path,
          sectionTitle: field.sectionTitle,
          fieldKey: field.key,
          fieldLabel: field.label,
          message: `${field.label || field.key} requires acknowledgment`,
        });
      }
      break;
    default:
      break;
  }
  return errors;
}

function validateSubmissionData(compiled, data_json = {}) {
  const data = data_json && typeof data_json === 'object' ? data_json : {};
  const fields = flattenCompiledFields(compiled);
  const errors = [];
  const unknownKeys = Object.keys(data).filter((k) => !fields.some((f) => f.key === k));
  unknownKeys.forEach((key) => {
    errors.push({
      code: 'UNKNOWN_FIELD',
      fieldKey: key,
      message: `Unknown field key: ${key}`,
    });
  });
  fields.forEach((field) => {
    errors.push(...validateFieldValue(field, data[field.key]));
  });
  return { ok: errors.length === 0, errors, fields };
}

module.exports = {
  normalizeFieldType,
  flattenCompiledFields,
  validateSubmissionData,
};
