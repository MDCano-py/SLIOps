/**
 * Allowlist sanitizer for stored archive HTML snapshots.
 * Historical records are treated as untrusted until this runs on read.
 * This is not a browser DOM parser; regression tests cover the payloads
 * that executed in the October 2026 assessments.
 */

const ALLOWED_TAGS = new Set([
  'p', 'div', 'span', 'br', 'hr', 'strong', 'em', 'b', 'i', 'u',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code',
  'colgroup', 'col', 'caption', 'a', 'img',
]);

const VOID_TAGS = new Set(['br', 'hr', 'img', 'col']);

const DROP_WITH_CONTENT = /<\s*(script|style|iframe|object|embed|svg|math|link|meta|base|form|textarea|button|input|select|option)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;

function sanitizeUrl(value, { allowDataImage = false } = {}) {
  const raw = String(value || '').trim().replace(/[\u0000-\u001F\u007F]/g, '');
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('vbscript:') || lower.startsWith('data:text')) {
    return '';
  }
  if (lower.startsWith('data:')) {
    if (allowDataImage && /^data:image\/(png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(raw)) {
      return raw.replace(/\s/g, '');
    }
    return '';
  }
  if (lower.startsWith('https://') || lower.startsWith('http://') || raw.startsWith('/') || raw.startsWith('#')) {
    if (raw.includes('\\')) return '';
    return raw;
  }
  return '';
}

function sanitizeAttrs(tag, rawAttrs) {
  const attrs = [];
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match;
  while ((match = re.exec(rawAttrs || ''))) {
    const name = match[1].toLowerCase();
    const value = match[3] ?? match[4] ?? match[5] ?? '';
    if (name.startsWith('on') || name === 'style' || name === 'srcdoc' || name === 'formaction') continue;
    if (tag === 'a' && name === 'href') {
      const href = sanitizeUrl(value);
      if (href) attrs.push(`href="${escapeAttr(href)}"`);
      continue;
    }
    if (tag === 'img' && name === 'src') {
      const src = sanitizeUrl(value, { allowDataImage: true });
      if (src) attrs.push(`src="${escapeAttr(src)}"`);
      continue;
    }
    if (tag === 'img' && (name === 'alt' || name === 'width' || name === 'height')) {
      attrs.push(`${name}="${escapeAttr(value)}"`);
      continue;
    }
    if ((name === 'colspan' || name === 'rowspan') && /^\d{1,3}$/.test(value)) {
      attrs.push(`${name}="${value}"`);
      continue;
    }
    if (name === 'class' && /^[a-zA-Z0-9 _-]{0,80}$/.test(value)) {
      attrs.push(`class="${escapeAttr(value)}"`);
    }
  }
  if (tag === 'a') attrs.push('rel="noopener noreferrer"');
  return attrs.length ? ` ${attrs.join(' ')}` : '';
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sanitizeRenderedHtml(html) {
  if (typeof html !== 'string' || !html) return '';
  let src = html.replace(/<!--[\s\S]*?-->/g, '');
  src = src.replace(DROP_WITH_CONTENT, '');
  src = src.replace(/<\s*(script|style|iframe|object|embed|svg|math|link|meta|base|form)\b[^>]*\/?\s*>/gi, '');
  return src.replace(/<\/?\s*([a-zA-Z0-9:-]+)([^>]*)>/g, (full, tag, attrs) => {
    const name = String(tag || '').toLowerCase();
    if (!ALLOWED_TAGS.has(name)) return '';
    if (full.startsWith('</')) return `</${name}>`;
    const safe = sanitizeAttrs(name, attrs);
    if (VOID_TAGS.has(name)) return `<${name}${safe}>`;
    return `<${name}${safe}>`;
  });
}

function sanitizeSnapshotFields(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeSnapshotFields(item, seen));
  const out = { ...value };
  if (typeof out.renderedHtml === 'string') {
    out.renderedHtml = sanitizeRenderedHtml(out.renderedHtml);
    out.renderedHtmlSanitized = true;
  }
  if (typeof out.rendered_html === 'string') {
    out.rendered_html = sanitizeRenderedHtml(out.rendered_html);
  }
  for (const key of Object.keys(out)) {
    if (key === 'renderedHtml' || key === 'rendered_html') continue;
    if (out[key] && typeof out[key] === 'object') {
      out[key] = sanitizeSnapshotFields(out[key], seen);
    }
  }
  return out;
}

module.exports = {
  sanitizeRenderedHtml,
  sanitizeSnapshotFields,
  sanitizeUrl,
};
