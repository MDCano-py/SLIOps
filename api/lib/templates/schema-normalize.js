/**
 * WOS-60 — Sectioned schema_json normalization (Google Forms-style sections).
 */

const SAFE_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

const DEFAULT_SECTION = {
  id: 'sec_default',
  title: 'Details',
  description: '',
  fields: [],
};

function err(code, path, message) {
  return { code, path, message };
}

function slugId(prefix, seed) {
  const base = String(seed || 'item')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .slice(0, 48);
  return `${prefix}${base || 'item'}`;
}

function normalizeField(field, index, sectionIndex, errors, assignIds) {
  const base = `schema_json.sections[${sectionIndex}].fields[${index}]`;
  if (!field || typeof field !== 'object') {
    errors.push(err('INVALID_FIELD', base, 'Each field must be an object.'));
    return null;
  }
  const key = String(field.key || '').trim();
  if (!key) {
    errors.push(err('MISSING_FIELD_KEY', `${base}.key`, 'Field key is required.'));
    return null;
  }
  let id = String(field.id || '').trim();
  if (!id) {
    if (assignIds) id = slugId('field_', key);
    else errors.push(err('MISSING_FIELD_ID', `${base}.id`, 'Field id is required.'));
  } else if (!SAFE_ID_PATTERN.test(id)) {
    errors.push(err('INVALID_FIELD_ID', `${base}.id`, 'Field id must be lowercase letters, numbers, and underscores.'));
  }
  const label = String(field.label || key).trim();
  const type = field.type ? String(field.type) : 'text';
  const required = field.required === true;
  const out = { id, key, label, type, required };
  if ((type === 'select' || type === 'dropdown') && Array.isArray(field.options)) {
    out.options = field.options.map((o) => String(o));
  }
  return out;
}

function normalizeSection(section, sectionIndex, errors, assignIds) {
  const base = `schema_json.sections[${sectionIndex}]`;
  if (!section || typeof section !== 'object') {
    errors.push(err('INVALID_SECTION', base, 'Each section must be an object.'));
    return null;
  }
  let id = String(section.id || '').trim();
  if (!id) {
    if (assignIds) id = sectionIndex === 0 ? DEFAULT_SECTION.id : slugId('sec_', section.title || `section_${sectionIndex}`);
    else errors.push(err('MISSING_SECTION_ID', `${base}.id`, 'Section id is required.'));
  } else if (!SAFE_ID_PATTERN.test(id)) {
    errors.push(err('INVALID_SECTION_ID', `${base}.id`, 'Section id must be lowercase letters, numbers, and underscores.'));
  }
  const title = String(section.title || '').trim();
  if (!title) {
    errors.push(err('MISSING_SECTION_TITLE', `${base}.title`, 'Section title is required.'));
  }
  const description = section.description != null ? String(section.description) : '';
  const rawFields = Array.isArray(section.fields) ? section.fields : [];
  const fields = rawFields
    .map((f, fi) => normalizeField(f, fi, sectionIndex, errors, assignIds))
    .filter(Boolean);
  return { id, title: title || 'Details', description, fields };
}

/**
 * @param {object} schema_json
 * @param {{ assignIds?: boolean }} options
 */
function normalizeSchemaJson(schema_json, options = {}) {
  const assignIds = options.assignIds !== false;
  const errors = [];

  if (!schema_json || typeof schema_json !== 'object') {
    return {
      ok: false,
      errors: [err('INVALID_SCHEMA', 'schema_json', 'schema_json must be an object.')],
      schema_json: { sections: [{ ...DEFAULT_SECTION, fields: [] }] },
    };
  }

  let sectionsInput = null;
  if (Array.isArray(schema_json.sections)) {
    sectionsInput = schema_json.sections;
  } else if (Array.isArray(schema_json.fields)) {
    sectionsInput = [{ ...DEFAULT_SECTION, fields: schema_json.fields }];
  } else if (Object.keys(schema_json).length === 0) {
    sectionsInput = [{ ...DEFAULT_SECTION, fields: [] }];
  } else {
    errors.push(
      err('MISSING_SECTIONS', 'schema_json.sections', 'schema_json.sections must exist or legacy fields[] must be provided.')
    );
    sectionsInput = [{ ...DEFAULT_SECTION, fields: [] }];
  }

  const sections = sectionsInput
    .map((s, i) => normalizeSection(s, i, errors, assignIds))
    .filter(Boolean);

  if (!sections.length) {
    errors.push(err('EMPTY_SECTIONS', 'schema_json.sections', 'schema_json.sections must be a non-empty array.'));
  }

  return {
    ok: errors.length === 0,
    errors,
    schema_json: { sections: sections.length ? sections : [{ ...DEFAULT_SECTION, fields: [] }] },
  };
}

/** Flatten sectioned schema to ordered fields (compatibility). */
function flattenSchemaFields(schema_json) {
  const norm = normalizeSchemaJson(schema_json, { assignIds: true });
  const fields = [];
  for (const section of norm.schema_json.sections || []) {
    for (const field of section.fields || []) {
      fields.push(field);
    }
  }
  return fields;
}

module.exports = {
  DEFAULT_SECTION,
  SAFE_ID_PATTERN,
  normalizeSchemaJson,
  flattenSchemaFields,
  slugId,
};
