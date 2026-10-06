/**
 * WOS-66 — Safe AI/JSON form import normalizer (paste-only; no external AI APIs).
 * Output uses platform canonical v1 field vocabulary for schema_json storage.
 */
const { slugId, normalizeSchemaJson } = require('./schema-normalize');
const { validateTemplateVersion } = require('./validator');

/** Canonical v1 schema field types (stored in schema_json). */
const CANONICAL_TYPES = new Set([
  'text',
  'long_text',
  'dropdown',
  'checkbox',
  'date',
  'email',
  'number',
  'file_ref',
  'signature_ack',
]);

/** Maps non-canonical / AI aliases → canonical storage type. */
const TYPE_ALIASES = {
  short_answer: 'text',
  short_text: 'text',
  paragraph: 'long_text',
  textarea: 'long_text',
  multiline: 'long_text',
  select: 'dropdown',
  multiple_choice: 'dropdown',
  radio: 'dropdown',
  checkbox_group: 'dropdown',
  file: 'file_ref',
  file_upload: 'file_ref',
  attachment: 'file_ref',
  signature: 'signature_ack',
  phone: 'text',
  tel: 'text',
  currency: 'number',
  money: 'number',
  url: 'text',
  link: 'text',
};

const SKIP_TYPES = new Set(['table', 'grid', 'matrix', 'ranking', 'scale', 'linear_scale', 'section_break', 'page_break']);

function sanitizeText(value, maxLen = 2000) {
  if (value == null) return '';
  let s = String(value);
  s = s.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  s = s.replace(/on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/javascript:/gi, '');
  return s.trim().slice(0, maxLen);
}

function slugKeyFromLabel(label, fallback) {
  const base = sanitizeText(label || fallback || 'field')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .slice(0, 48);
  return base || 'field';
}

function categorizeWarning(message) {
  const m = String(message || '');
  if (/converted to/i.test(m)) return 'type_mapping';
  if (/Duplicate key/i.test(m)) return 'duplicate_keys';
  if (/Duplicate section/i.test(m)) return 'duplicate_keys';
  if (/Unsupported/i.test(m) || /skipped/i.test(m)) return 'unsupported';
  if (/conditional/i.test(m)) return 'sanitization';
  return 'general';
}

function groupWarnings(warnings) {
  const groups = {
    type_mapping: [],
    duplicate_keys: [],
    unsupported: [],
    sanitization: [],
    general: [],
  };
  (warnings || []).forEach((w) => {
    const cat = categorizeWarning(w);
    groups[cat].push(w);
  });
  return groups;
}

function mapFieldType(rawType, warnings) {
  const raw = String(rawType || 'text').toLowerCase().trim();
  if (SKIP_TYPES.has(raw)) {
    warnings.push(`Unsupported field type \`${raw}\` was skipped.`);
    return null;
  }
  if (raw.includes('condition') || raw === 'conditional') {
    warnings.push('Unsupported conditional logic was ignored.');
    return null;
  }
  if (CANONICAL_TYPES.has(raw)) {
    return raw;
  }
  const mapped = TYPE_ALIASES[raw];
  if (mapped) {
    warnings.push(`Field type \`${raw}\` was converted to \`${mapped}\`.`);
    return mapped;
  }
  if (CANONICAL_TYPES.has(raw)) return raw;
  warnings.push(`Unsupported field type \`${raw}\` was skipped.`);
  return null;
}

function coerceOptions(field) {
  if (Array.isArray(field.options)) return field.options.map((o) => sanitizeText(typeof o === 'object' ? o.label || o.value || o : o, 200));
  if (Array.isArray(field.choices)) return field.choices.map((o) => sanitizeText(typeof o === 'object' ? o.label || o.value || o : o, 200));
  if (Array.isArray(field.values)) return field.values.map((o) => sanitizeText(o, 200));
  return [];
}

function normalizeImportedField(raw, warnings, usedKeys) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.conditional || raw.logic || raw.show_if) {
    warnings.push('Unsupported conditional logic was ignored.');
  }
  const type = mapFieldType(raw.type || raw.field_type || raw.question_type, warnings);
  if (!type) return null;

  const label = sanitizeText(raw.label || raw.title || raw.question || raw.name || raw.key || 'Field');
  let key = sanitizeText(raw.key || raw.name || slugKeyFromLabel(label), 64)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!key) key = slugKeyFromLabel(label);

  if (usedKeys.has(key)) {
    let n = 2;
    while (usedKeys.has(`${key}_${n}`)) n += 1;
    warnings.push(`Duplicate key \`${key}\` was renamed to \`${key}_${n}\`.`);
    key = `${key}_${n}`;
  }
  usedKeys.add(key);

  const out = {
    id: slugId('field_', key),
    key,
    label: label || key,
    type,
    required: raw.required === true || raw.is_required === true || raw.validation?.required === true,
  };
  if (type === 'dropdown') {
    const opts = coerceOptions(raw);
    if (opts.length) out.options = opts;
    else out.options = ['Option 1', 'Option 2'];
  }
  return out;
}

function normalizeImportedSection(raw, index, warnings, usedKeys, usedSectionIds) {
  if (!raw || typeof raw !== 'object') return null;
  const title = sanitizeText(raw.title || raw.name || raw.section_title || `Section ${index + 1}`) || `Section ${index + 1}`;
  let id = slugId('sec_', raw.id || title);
  if (usedSectionIds.has(id)) {
    id = slugId('sec_', `${title}_${index}`);
    warnings.push(`Duplicate section id was adjusted for "${title}".`);
  }
  usedSectionIds.add(id);

  const rawFields = raw.fields || raw.questions || raw.items || (Array.isArray(raw) ? raw : []);
  const fields = (Array.isArray(rawFields) ? rawFields : [])
    .map((f) => normalizeImportedField(f, warnings, usedKeys))
    .filter(Boolean);

  return {
    id,
    title,
    description: sanitizeText(raw.description || raw.subtitle || '', 1000),
    fields,
  };
}

function parseJsonInput(input) {
  if (input == null) return { ok: false, error: 'Input is required.' };
  if (typeof input === 'object') return { ok: true, data: input };
  const text = String(input).trim();
  if (!text) return { ok: false, error: 'Input is empty.' };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, error: 'Invalid JSON. Paste valid JSON or use a plain-text outline.' };
  }
}

function parsePlainOutline(text) {
  const warnings = [];
  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) {
    return { ok: false, error: 'Outline is empty. Paste JSON or a structured outline with section headers and field lines.' };
  }

  const sections = [];
  let current = null;
  const usedKeys = new Set();

  for (const line of lines) {
    const sectionMatch = line.match(/^(?:#{1,3}\s*|section\s*:\s*)(.+)$/i);
    if (sectionMatch) {
      current = { id: slugId('sec_', sectionMatch[1]), title: sanitizeText(sectionMatch[1]), description: '', fields: [] };
      sections.push(current);
      continue;
    }
    const fieldMatch = line.match(/^(?:[-*•]|\d+[.)])\s*(.+?)(?:\s*\(([^)]+)\))?(?:\s*\[(required|\*)\])?$/i);
    if (fieldMatch) {
      if (!current) {
        current = { id: 'sec_default', title: 'Details', description: '', fields: [] };
        sections.push(current);
      }
      const label = sanitizeText(fieldMatch[1]);
      const typeHint = fieldMatch[2] || 'text';
      const field = normalizeImportedField(
        { label, type: typeHint, required: !!(fieldMatch[3] && /required|\*/i.test(fieldMatch[3])) },
        warnings,
        usedKeys
      );
      if (field) current.fields.push(field);
      continue;
    }
    if (!current) {
      return {
        ok: false,
        error: 'Could not parse outline. Use section headers (# Title or Section: Title) and field lines (- Label or 1. Label).',
      };
    }
  }

  if (!sections.length) {
    return { ok: false, error: 'No sections found in outline. Add at least one section header.' };
  }
  return { ok: true, schema_json: { sections }, warnings, source: 'outline' };
}

function extractSectionsFromData(data, warnings) {
  const usedKeys = new Set();
  const usedSectionIds = new Set();

  if (Array.isArray(data)) {
    return data.map((s, i) => normalizeImportedSection(s, i, warnings, usedKeys, usedSectionIds)).filter(Boolean);
  }

  if (data && typeof data === 'object') {
    if (Array.isArray(data.sections)) {
      return data.sections.map((s, i) => normalizeImportedSection(s, i, warnings, usedKeys, usedSectionIds)).filter(Boolean);
    }
    if (Array.isArray(data.fields)) {
      return [
        normalizeImportedSection({ id: 'sec_default', title: 'Details', fields: data.fields }, 0, warnings, usedKeys, usedSectionIds),
      ].filter(Boolean);
    }
    if (Array.isArray(data.questions)) {
      return [
        normalizeImportedSection({ id: 'sec_default', title: data.title || 'Details', fields: data.questions }, 0, warnings, usedKeys, usedSectionIds),
      ].filter(Boolean);
    }
    if (data.form && typeof data.form === 'object') {
      return extractSectionsFromData(data.form, warnings);
    }
    if (data.schema_json) {
      return extractSectionsFromData(data.schema_json, warnings);
    }
  }
  return [];
}

function buildImportResult(schema_json, warnings, errors, extra = {}) {
  const norm = normalizeSchemaJson(schema_json, { assignIds: true });
  const mergedWarnings = [...warnings, ...(extra.warnings || [])];
  return {
    ok: norm.ok && !(errors || []).length,
    schema_json: norm.schema_json,
    warnings: mergedWarnings,
    warnings_grouped: groupWarnings(mergedWarnings),
    errors: [...(errors || []), ...norm.errors],
    field_count: countFields(norm.schema_json),
    section_count: (norm.schema_json.sections || []).length,
    ...extra,
  };
}

/**
 * @param {string|object} input - JSON string or parsed object
 * @param {{ inputKind?: 'json'|'outline' }} options
 */
function importSchemaInput(input, options = {}) {
  const warnings = [];
  const inputKind = options.inputKind || 'json';

  if (inputKind === 'outline' || (typeof input === 'string' && !String(input).trim().startsWith('{') && !String(input).trim().startsWith('['))) {
    const outline = parsePlainOutline(input);
    if (!outline.ok) return { ok: false, errors: [{ code: 'IMPORT_PARSE', message: outline.error }], warnings: [], warnings_grouped: groupWarnings([]) };
    return buildImportResult(outline.schema_json, [...(outline.warnings || []), ...warnings], []);
  }

  const parsed = parseJsonInput(input);
  if (!parsed.ok) {
    return { ok: false, errors: [{ code: 'IMPORT_PARSE', message: parsed.error }], warnings: [], warnings_grouped: groupWarnings([]) };
  }

  const sections = extractSectionsFromData(parsed.data, warnings);
  if (!sections.length) {
    return {
      ok: false,
      errors: [{ code: 'IMPORT_EMPTY', message: 'No importable sections or fields found. Paste canonical sections[], fields[], or AI form JSON.' }],
      warnings,
      warnings_grouped: groupWarnings(warnings),
    };
  }

  return buildImportResult({ sections }, warnings, []);
}

function countFields(schema_json) {
  return (schema_json?.sections || []).reduce((n, s) => n + (s.fields?.length || 0), 0);
}

function mergeImportedSchema(currentSchema, importedSchema, mode) {
  const current = normalizeSchemaJson(currentSchema || {}, { assignIds: true }).schema_json;
  const imported = normalizeSchemaJson(importedSchema || {}, { assignIds: true }).schema_json;
  if (mode === 'append') {
    return { sections: [...(current.sections || []), ...(imported.sections || [])] };
  }
  return imported;
}

/** Schema-only validation for import preview/apply (no workflow / EMPTY_STEPS). */
function validateImportedSchema(schema_json, template_kind) {
  return validateTemplateVersion({
    schema_json,
    template_kind: template_kind || 'form',
    schema_only: true,
  });
}

/** @deprecated use validateImportedSchema */
function validateImportedDraft(schema_json, workflow_json, template_kind) {
  return validateImportedSchema(schema_json, template_kind);
}

function workflowPublishNotice(workflow_json, binding_mode) {
  const steps = workflow_json?.steps;
  const notices = [];
  if (!Array.isArray(steps) || steps.length === 0) {
    notices.push('Workflow steps must be configured before publish.');
  }
  if (binding_mode === 'required') {
    notices.push('Required workflow binding must have a published workflow attached before launch.');
  }
  return notices;
}

module.exports = {
  importSchemaInput,
  mergeImportedSchema,
  validateImportedSchema,
  validateImportedDraft,
  workflowPublishNotice,
  sanitizeText,
  mapFieldType,
  groupWarnings,
  categorizeWarning,
  CANONICAL_TYPES,
  TYPE_ALIASES,
};
