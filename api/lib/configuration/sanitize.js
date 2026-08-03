/**
 * Sanitize document/template HTML — strip scripts, event handlers, unsafe URLs.
 * Controlled allowlist; not a full Word clone.
 */

const BLOCKED_TAGS = /<\/?(script|iframe|object|embed|link|meta|base|form|input|button|textarea|select)\b[^>]*>/gi;
const EVENT_ATTR = /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URL = /\s(href|src|xlink:href)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]+)/gi;
const DATA_URL_SCRIPT = /\s(href|src)\s*=\s*("\s*data:text\/html[^"]*"|'\s*data:text\/html[^']*')/gi;

function sanitizeHtml(input) {
  if (input == null) return '';
  let html = String(input);
  if (html.length > 200000) html = html.slice(0, 200000);
  html = html.replace(BLOCKED_TAGS, '');
  html = html.replace(EVENT_ATTR, '');
  html = html.replace(JS_URL, ' $1="#"');
  html = html.replace(DATA_URL_SCRIPT, ' $1="#"');
  return html;
}

function stripControlChars(value) {
  return String(value == null ? '' : value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function safeKey(value, max = 120) {
  const raw = stripControlChars(value).trim().toLowerCase();
  const key = raw.replace(/[^a-z0-9_.-]/g, '_').replace(/_+/g, '_').slice(0, max);
  return key.replace(/^[._-]+|[._-]+$/g, '') || '';
}

module.exports = {
  sanitizeHtml,
  stripControlChars,
  safeKey,
};
