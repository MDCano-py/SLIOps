/**
 * WOS-24 — Inbound email parsing helpers.
 */
const crypto = require('crypto');
const { REQUEST_NUMBER_PREFIX } = require('../constants');

const PREFIXES = [...new Set(Object.values(REQUEST_NUMBER_PREFIX))].join('|');
const REQUEST_NUMBER_RE = new RegExp(`\\b((?:${PREFIXES})-\\d{4,8})\\b`, 'gi');
const EXPLICIT_REQUEST_RE = /(?:request\s*(?:number)?\s*:?\s*)((?:WO|EQ|PR|SWP|JSA|BOL|DR|DS|GR)-\d{4,8})/gi;
const ACTION_TOKEN_RES = [
  /action\.html\?t=([^\s"'<>&]+)/gi,
  /[?&]t=([a-f0-9]{32,64})/gi,
];

function normalizeEmailAddress(value) {
  if (!value) return '';
  const s = String(value).trim();
  const angle = s.match(/<([^>]+)>/);
  return (angle ? angle[1] : s).trim().toLowerCase();
}

function normalizeInboundEmailPayload(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid inbound email payload');
  }
  const from = normalizeEmailAddress(raw.from);
  const to = normalizeEmailAddress(raw.to);
  const subject = String(raw.subject || '').trim();
  const text = String(raw.text || '').trim();
  const html = String(raw.html || '').trim();
  const receivedAt = raw.received_at ? new Date(raw.received_at).toISOString() : new Date().toISOString();
  const messageId = String(raw.message_id || '').trim() || null;
  const provider = String(raw.provider || 'unknown').trim().toLowerCase();
  const attachments = Array.isArray(raw.attachments) ? raw.attachments.slice(0, 20) : [];

  return {
    message_id: messageId,
    from,
    to,
    subject,
    text,
    html,
    attachments,
    received_at: receivedAt,
    provider,
  };
}

function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function cleanEmailBody({ text, html }) {
  const fromText = String(text || '').trim();
  if (fromText) return fromText.slice(0, 20000);
  const cleaned = stripHtml(html);
  return cleaned.slice(0, 20000);
}

function extractRequestNumbers(subject, body) {
  const haystack = `${subject || ''}\n${body || ''}`;
  const found = new Set();
  let m;
  REQUEST_NUMBER_RE.lastIndex = 0;
  while ((m = REQUEST_NUMBER_RE.exec(haystack)) !== null) {
    found.add(m[1].toUpperCase());
  }
  EXPLICIT_REQUEST_RE.lastIndex = 0;
  while ((m = EXPLICIT_REQUEST_RE.exec(haystack)) !== null) {
    found.add(m[1].toUpperCase());
  }
  return [...found];
}

function extractActionTokens(subject, body, html) {
  const haystack = `${subject || ''}\n${body || ''}\n${html || ''}`;
  const tokens = new Set();
  for (const re of ACTION_TOKEN_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(haystack)) !== null) {
      const token = decodeURIComponent(String(m[1]).trim());
      if (token.length >= 16) tokens.add(token);
    }
  }
  return [...tokens];
}

function buildInboundDedupeKey(payload, cleanedBody) {
  if (payload.message_id) {
    return `inbound:${payload.provider}:${payload.message_id}`;
  }
  const hash = crypto
    .createHash('sha256')
    .update(
      [payload.from, payload.subject, payload.received_at, cleanedBody.slice(0, 2000)].join('|')
    )
    .digest('hex');
  return `inbound:hash:${hash}`;
}

function formatInboundCommentBody(payload, cleanedBody) {
  const lines = [
    `[Inbound email from ${payload.from || 'unknown'}]`,
    `Subject: ${payload.subject || '(no subject)'}`,
    `Received: ${payload.received_at}`,
  ];
  if (payload.message_id) lines.push(`Message-ID: ${payload.message_id}`);
  lines.push('', cleanedBody || '(empty body)');
  return lines.join('\n').slice(0, 25000);
}

module.exports = {
  normalizeInboundEmailPayload,
  normalizeEmailAddress,
  cleanEmailBody,
  extractRequestNumbers,
  extractActionTokens,
  buildInboundDedupeKey,
  formatInboundCommentBody,
  stripHtml,
};
