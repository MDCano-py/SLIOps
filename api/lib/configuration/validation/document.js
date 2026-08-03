const { sanitizeHtml, stripControlChars, safeKey } = require('../sanitize');
const { LIMITS } = require('../limits');
const { extractVariableKeys, isKnownVariableShape } = require('../variables/registry');
const { validateConditionShape } = require('../conditions');

function validateDocumentDefinition(payload) {
  const issues = [];
  const body = payload || {};
  const title = stripControlChars(body.title || '').slice(0, LIMITS.MAX_LABEL_LENGTH);
  if (!title) {
    issues.push({ severity: 'error', code: 'DOCUMENT_TITLE_REQUIRED', message: 'Document title is required', entity: 'document' });
  }
  let html = sanitizeHtml(body.body_html || body.content_html || '');
  if (html.length > LIMITS.MAX_TEMPLATE_HTML_LENGTH) {
    issues.push({
      severity: 'error',
      code: 'DOCUMENT_TOO_LARGE',
      message: 'Document template exceeds size limit',
      entity: 'document',
    });
    html = html.slice(0, LIMITS.MAX_TEMPLATE_HTML_LENGTH);
  }
  const keys = extractVariableKeys(html);
  for (const key of keys) {
    if (!isKnownVariableShape(key)) {
      issues.push({
        severity: 'warning',
        code: 'UNKNOWN_VARIABLE',
        message: `Variable ${key} is not in the known registry shape`,
        entity: 'document',
        affected: key,
      });
    }
  }
  const blocks = Array.isArray(body.blocks) ? body.blocks : [];
  for (const block of blocks) {
    if (block.condition) issues.push(...validateConditionShape(block.condition));
  }
  const signers = Array.isArray(body.signers) ? body.signers : [];
  const normalizedSigners = signers.slice(0, 20).map((s, i) => ({
    key: safeKey(s.key || `signer_${i + 1}`) || `signer_${i + 1}`,
    role: safeKey(s.role || 'signer') || 'signer',
    order: Number.isFinite(s.order) ? s.order : i + 1,
    require_drawn: !!s.require_drawn,
    allow_typed: s.allow_typed !== false,
    require_initials: !!s.require_initials,
    require_review: s.require_review !== false,
  }));

  return {
    ok: !issues.some((i) => i.severity === 'error'),
    issues,
    normalized: {
      title,
      document_type: safeKey(body.document_type || 'web_document') || 'web_document',
      body_html: html,
      footer_text: stripControlChars(body.footer_text || '').slice(0, 2000),
      blocks,
      signers: normalizedSigners,
      signing_mode: body.signing_mode === 'parallel' ? 'parallel' : 'sequential',
      pdf_status: 'unavailable',
      pdf_message: 'Final sealed PDF generation is not available in this release.',
    },
  };
}

module.exports = { validateDocumentDefinition };
