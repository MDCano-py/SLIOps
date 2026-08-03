/**
 * Validate custom variable definitions (no code execution).
 */

const { isCustomVariableKey, isKnownVariableShape } = require('./registry');
const { LIMITS } = require('../limits');
const { safeKey, stripControlChars } = require('../sanitize');

const ALLOWED_TYPES = new Set(['string', 'number', 'boolean', 'date', 'datetime', 'currency']);

function validateCustomVariable(input) {
  const issues = [];
  const raw = input || {};
  let key = safeKey(raw.key || '', LIMITS.MAX_KEY_LENGTH);
  if (key && !key.startsWith('custom.')) key = `custom.${key}`;
  if (!key || !isCustomVariableKey(key)) {
    issues.push({
      severity: 'error',
      code: 'INVALID_VARIABLE_KEY',
      message: 'Custom variable keys must match custom.<name>',
      entity: 'variable',
    });
  }
  if (!raw.label || !String(raw.label).trim()) {
    issues.push({
      severity: 'error',
      code: 'VARIABLE_LABEL_REQUIRED',
      message: 'Label is required',
      entity: 'variable',
    });
  }
  const type = String(raw.type || 'string');
  if (!ALLOWED_TYPES.has(type)) {
    issues.push({
      severity: 'error',
      code: 'INVALID_VARIABLE_TYPE',
      message: `Unsupported type: ${type}`,
      entity: 'variable',
    });
  }
  if (String(raw.label || '').length > LIMITS.MAX_LABEL_LENGTH) {
    issues.push({
      severity: 'error',
      code: 'VARIABLE_LABEL_TOO_LONG',
      message: 'Label is too long',
      entity: 'variable',
    });
  }
  return {
    ok: !issues.some((i) => i.severity === 'error'),
    issues,
    normalized: {
      key,
      label: stripControlChars(raw.label || '').slice(0, LIMITS.MAX_LABEL_LENGTH),
      description: stripControlChars(raw.description || '').slice(0, LIMITS.MAX_STRING_LENGTH),
      type,
      value: raw.value == null ? null : raw.value,
      sensitive: !!raw.sensitive,
      active: raw.active !== false,
    },
  };
}

function assertVariableReference(key) {
  if (!isKnownVariableShape(key)) {
    return {
      severity: 'error',
      code: 'UNKNOWN_VARIABLE',
      message: `Unknown or invalid variable: ${key}`,
      entity: 'variable',
      affected: key,
    };
  }
  return null;
}

module.exports = {
  validateCustomVariable,
  assertVariableReference,
  ALLOWED_TYPES,
};
