/**
 * WOS-60 — Template kind classification.
 */

const TEMPLATE_KINDS = ['form', 'document', 'workflow', 'checklist', 'inspection'];

const BINDABLE_KINDS = new Set(['form', 'document', 'checklist', 'inspection']);

const DOCUMENT_TAG = '[document-backed]';
const FORM_TAG = '[form-backed]';

function normalizeTemplateKind(raw) {
  const k = String(raw || '')
    .trim()
    .toLowerCase();
  return TEMPLATE_KINDS.includes(k) ? k : null;
}

function inferTemplateKind(template = {}) {
  const explicit = normalizeTemplateKind(template.template_kind);
  if (explicit) return explicit;

  const space = template.launch_config_json?.space_key;
  if (space === 'forms') return 'form';
  if (space === 'documents') return 'document';
  if (space === 'workflows') return 'workflow';

  const key = String(template.key || '');
  const desc = String(template.description || '');
  if (key.startsWith('doc_') || desc.includes(DOCUMENT_TAG)) return 'document';
  if (key.startsWith('form_') || desc.includes(FORM_TAG)) return 'form';

  // Legacy generic templates without tags default to workflow (historical approval templates).
  return 'workflow';
}

function kindForSpace(space) {
  if (space === 'documents') return 'document';
  if (space === 'workflows') return 'workflow';
  return 'form';
}

function isBindableKind(kind) {
  return BINDABLE_KINDS.has(kind);
}

function isWorkflowKind(kind) {
  return kind === 'workflow';
}

module.exports = {
  TEMPLATE_KINDS,
  BINDABLE_KINDS,
  DOCUMENT_TAG,
  FORM_TAG,
  normalizeTemplateKind,
  inferTemplateKind,
  kindForSpace,
  isBindableKind,
  isWorkflowKind,
};
