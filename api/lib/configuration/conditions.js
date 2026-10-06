/**
 * Structured condition evaluation — allowlisted operators only.
 * No eval / new Function / arbitrary expressions.
 */

const { LIMITS } = require('./limits');
const { resolveValue } = require('./variables/resolver');

const OPERATORS = Object.freeze([
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'greater_than',
  'greater_than_or_equal',
  'less_than',
  'less_than_or_equal',
  'is_empty',
  'is_not_empty',
  'is_true',
  'is_false',
  'in_list',
  'not_in_list',
]);

function resolveOperand(operand, ctx) {
  if (!operand || typeof operand !== 'object') return undefined;
  if (operand.type === 'literal') return operand.value;
  if (operand.type === 'variable') return resolveValue(operand.key, ctx);
  return undefined;
}

function asNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function evalLeaf(leaf, ctx) {
  const op = leaf.operator;
  if (!OPERATORS.includes(op)) {
    return { ok: false, error: `Unsupported operator: ${op}` };
  }
  const left = resolveOperand(leaf.left, ctx);
  const right = resolveOperand(leaf.right, ctx);

  switch (op) {
    case 'equals':
      return { ok: true, value: left == null && right == null ? true : String(left) === String(right) };
    case 'not_equals':
      return { ok: true, value: String(left) !== String(right) };
    case 'contains':
      return { ok: true, value: String(left == null ? '' : left).includes(String(right == null ? '' : right)) };
    case 'not_contains':
      return { ok: true, value: !String(left == null ? '' : left).includes(String(right == null ? '' : right)) };
    case 'greater_than': {
      const a = asNumber(left);
      const b = asNumber(right);
      return { ok: true, value: a != null && b != null && a > b };
    }
    case 'greater_than_or_equal': {
      const a = asNumber(left);
      const b = asNumber(right);
      return { ok: true, value: a != null && b != null && a >= b };
    }
    case 'less_than': {
      const a = asNumber(left);
      const b = asNumber(right);
      return { ok: true, value: a != null && b != null && a < b };
    }
    case 'less_than_or_equal': {
      const a = asNumber(left);
      const b = asNumber(right);
      return { ok: true, value: a != null && b != null && a <= b };
    }
    case 'is_empty':
      return { ok: true, value: left == null || left === '' || (Array.isArray(left) && left.length === 0) };
    case 'is_not_empty':
      return { ok: true, value: !(left == null || left === '' || (Array.isArray(left) && left.length === 0)) };
    case 'is_true':
      return { ok: true, value: left === true || left === 'true' || left === 1 || left === '1' };
    case 'is_false':
      return { ok: true, value: left === false || left === 'false' || left === 0 || left === '0' };
    case 'in_list': {
      const list = Array.isArray(right) ? right : String(right == null ? '' : right).split(',').map((s) => s.trim());
      return { ok: true, value: list.map(String).includes(String(left)) };
    }
    case 'not_in_list': {
      const list = Array.isArray(right) ? right : String(right == null ? '' : right).split(',').map((s) => s.trim());
      return { ok: true, value: !list.map(String).includes(String(left)) };
    }
    default:
      return { ok: false, error: `Unsupported operator: ${op}` };
  }
}

function evalGroup(node, ctx, depth) {
  if (depth > LIMITS.MAX_CONDITION_DEPTH) {
    return { ok: false, error: 'Condition nesting too deep', value: false };
  }
  if (!node || typeof node !== 'object') {
    return { ok: false, error: 'Invalid condition', value: false };
  }
  if (node.operator) return evalLeaf(node, ctx);
  if (node.all) {
    const results = [];
    for (const child of node.all) {
      const r = evalGroup(child, ctx, depth + 1);
      if (!r.ok) return r;
      results.push(!!r.value);
    }
    return { ok: true, value: results.every(Boolean), results };
  }
  if (node.any) {
    const results = [];
    for (const child of node.any) {
      const r = evalGroup(child, ctx, depth + 1);
      if (!r.ok) return r;
      results.push(!!r.value);
    }
    return { ok: true, value: results.some(Boolean), results };
  }
  if (node.not) {
    const r = evalGroup(node.not, ctx, depth + 1);
    if (!r.ok) return r;
    return { ok: true, value: !r.value };
  }
  return { ok: false, error: 'Condition must use all, any, not, or a leaf operator', value: false };
}

function evaluateCondition(condition, ctx) {
  if (condition == null) return { ok: true, value: true };
  return evalGroup(condition, ctx || {}, 0);
}

function validateConditionShape(condition, depth = 0) {
  const issues = [];
  if (condition == null) return issues;
  if (depth > LIMITS.MAX_CONDITION_DEPTH) {
    issues.push({
      severity: 'error',
      code: 'CONDITION_TOO_DEEP',
      message: `Conditions cannot nest deeper than ${LIMITS.MAX_CONDITION_DEPTH}`,
      entity: 'condition',
    });
    return issues;
  }
  if (typeof condition !== 'object') {
    issues.push({ severity: 'error', code: 'INVALID_CONDITION', message: 'Condition must be an object', entity: 'condition' });
    return issues;
  }
  if (condition.operator) {
    if (!OPERATORS.includes(condition.operator)) {
      issues.push({
        severity: 'error',
        code: 'UNSUPPORTED_OPERATOR',
        message: `Unsupported operator: ${condition.operator}`,
        entity: 'condition',
      });
    }
    return issues;
  }
  const groups = ['all', 'any'];
  for (const g of groups) {
    if (condition[g]) {
      if (!Array.isArray(condition[g])) {
        issues.push({ severity: 'error', code: 'INVALID_CONDITION_GROUP', message: `${g} must be an array`, entity: 'condition' });
      } else {
        for (const child of condition[g]) issues.push(...validateConditionShape(child, depth + 1));
      }
    }
  }
  if (condition.not) issues.push(...validateConditionShape(condition.not, depth + 1));
  if (!condition.all && !condition.any && !condition.not && !condition.operator) {
    issues.push({ severity: 'error', code: 'EMPTY_CONDITION', message: 'Condition is empty', entity: 'condition' });
  }
  return issues;
}

module.exports = {
  OPERATORS,
  evaluateCondition,
  validateConditionShape,
};
