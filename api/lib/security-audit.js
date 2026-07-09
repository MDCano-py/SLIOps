/**
 * WOS-80 — Lightweight structured security-audit logger.
 *
 * The primary DB audit table (`audit_events`) is request-scoped
 * (`request_id NOT NULL`), so it cannot hold template / role / security-admin
 * events without a schema change (out of scope for this card). This logger
 * emits one structured, secret-free JSON line per security-sensitive action so
 * staging/production log pipelines (PM2 / CloudWatch) retain an auditable
 * trail. Persisting these to a dedicated table is tracked as a follow-up.
 */

const SENSITIVE_KEY = /(secret|token|password|authorization|cookie|api[_-]?key)/i;

function sanitize(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (SENSITIVE_KEY.test(k)) {
      out[k] = '[redacted]';
    } else if (v && typeof v === 'object') {
      out[k] = Array.isArray(v) ? v.filter((x) => typeof x !== 'object') : '[object]';
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * @param {string} action e.g. 'template.publish', 'rbac.role_assigned'
 * @param {object} details secret-free contextual fields (actor, ids, counts)
 */
function recordSecurityAudit(action, details = {}) {
  try {
    const entry = {
      tag: 'security-audit',
      action,
      at: new Date().toISOString(),
      ...sanitize(details),
    };
    console.log(`[security-audit] ${JSON.stringify(entry)}`);
  } catch {
    /* audit logging must never throw into the request path */
  }
}

module.exports = { recordSecurityAudit };
