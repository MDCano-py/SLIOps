const { validateFormDefinition, validateSubmission } = require('./form');
const { validateWorkflowDefinition } = require('./workflow');
const { validateDocumentDefinition } = require('./document');
const { isKnownWidgetType } = require('../widgets/registry');
const { LIMITS } = require('../limits');
const { safeKey, stripControlChars } = require('../sanitize');

function validateDashboardDefinition(payload) {
  const issues = [];
  const body = payload || {};
  const widgets = Array.isArray(body.widgets) ? body.widgets : [];
  if (widgets.length > LIMITS.MAX_DASHBOARD_WIDGETS) {
    issues.push({
      severity: 'error',
      code: 'TOO_MANY_WIDGETS',
      message: `Dashboards may have at most ${LIMITS.MAX_DASHBOARD_WIDGETS} widgets`,
      entity: 'dashboard',
    });
  }
  const normalizedWidgets = widgets.slice(0, LIMITS.MAX_DASHBOARD_WIDGETS).map((w, i) => {
    const type = String(w.type || '');
    if (!isKnownWidgetType(type)) {
      issues.push({
        severity: 'error',
        code: 'UNKNOWN_WIDGET_TYPE',
        message: `Unknown widget type: ${type}`,
        entity: 'widget',
        affected: w.key || String(i),
      });
    }
    return {
      key: safeKey(w.key || `widget_${i + 1}`) || `widget_${i + 1}`,
      type,
      title: stripControlChars(w.title || type).slice(0, LIMITS.MAX_LABEL_LENGTH),
      subtitle: stripControlChars(w.subtitle || '').slice(0, 500),
      size: ['sm', 'md', 'lg', 'xl'].includes(w.size) ? w.size : 'md',
      order: Number.isFinite(w.order) ? w.order : i,
      config: w.config && typeof w.config === 'object' ? w.config : {},
    };
  });
  return {
    ok: !issues.some((i) => i.severity === 'error'),
    issues,
    normalized: {
      name: stripControlChars(body.name || 'Dashboard').slice(0, LIMITS.MAX_LABEL_LENGTH),
      description: stripControlChars(body.description || '').slice(0, 2000),
      audience_roles: Array.isArray(body.audience_roles) ? body.audience_roles.map((r) => safeKey(r)).filter(Boolean) : [],
      layout: body.layout === 'grid' ? 'grid' : 'stack',
      widgets: normalizedWidgets,
    },
  };
}

function validateRequestTypeDefinition(payload) {
  const issues = [];
  const body = payload || {};
  const key = safeKey(body.key || '');
  const displayName = stripControlChars(body.display_name || body.name || '').slice(0, LIMITS.MAX_LABEL_LENGTH);
  if (!key) {
    issues.push({ severity: 'error', code: 'REQUEST_TYPE_KEY_REQUIRED', message: 'Request type key is required', entity: 'request_type' });
  }
  if (!displayName) {
    issues.push({ severity: 'error', code: 'REQUEST_TYPE_NAME_REQUIRED', message: 'Display name is required', entity: 'request_type' });
  }
  return {
    ok: !issues.some((i) => i.severity === 'error'),
    issues,
    normalized: {
      key,
      display_name: displayName,
      description: stripControlChars(body.description || '').slice(0, 2000),
      icon: stripControlChars(body.icon || 'request').slice(0, 40),
      active: body.active !== false,
      default_priority: safeKey(body.default_priority || 'normal') || 'normal',
      available_priorities: Array.isArray(body.available_priorities)
        ? body.available_priorities.map((p) => safeKey(p)).filter(Boolean)
        : ['low', 'normal', 'high', 'urgent'],
      form_definition_id: body.form_definition_id || null,
      workflow_definition_id: body.workflow_definition_id || null,
      document_definition_ids: Array.isArray(body.document_definition_ids) ? body.document_definition_ids : [],
      initiating_roles: Array.isArray(body.initiating_roles) ? body.initiating_roles.map((r) => safeKey(r)).filter(Boolean) : [],
      participant_roles: Array.isArray(body.participant_roles) ? body.participant_roles.map((r) => safeKey(r)).filter(Boolean) : [],
      number_prefix: stripControlChars(body.number_prefix || 'REQ-').slice(0, 12),
      sla_hours: body.sla_hours == null ? null : Number(body.sla_hours),
      archive_behavior: safeKey(body.archive_behavior || 'standard') || 'standard',
      completion_behavior: safeKey(body.completion_behavior || 'standard') || 'standard',
      integration_behavior: body.integration_behavior && typeof body.integration_behavior === 'object' ? body.integration_behavior : {},
    },
  };
}

function validateDefinitionPayload(kind, payload) {
  switch (kind) {
    case 'form':
      return validateFormDefinition(payload);
    case 'workflow':
      return validateWorkflowDefinition(payload);
    case 'document':
      return validateDocumentDefinition(payload);
    case 'dashboard':
      return validateDashboardDefinition(payload);
    case 'request_type':
      return validateRequestTypeDefinition(payload);
    case 'saved_view':
      return {
        ok: true,
        issues: [],
        normalized: {
          name: stripControlChars((payload && payload.name) || 'Saved view').slice(0, LIMITS.MAX_LABEL_LENGTH),
          owner_type: (payload && payload.owner_type) === 'personal' ? 'personal' : 'organization',
          filters: (payload && payload.filters && typeof payload.filters === 'object') ? payload.filters : {},
          columns: Array.isArray(payload && payload.columns) ? payload.columns : [],
          sort: (payload && payload.sort) || { field: 'updated_at', direction: 'desc' },
        },
      };
    default:
      return {
        ok: false,
        issues: [{ severity: 'error', code: 'UNKNOWN_KIND', message: `Unknown definition kind: ${kind}`, entity: 'definition' }],
        normalized: null,
      };
  }
}

module.exports = {
  validateDefinitionPayload,
  validateFormDefinition,
  validateSubmission,
  validateWorkflowDefinition,
  validateDocumentDefinition,
  validateDashboardDefinition,
  validateRequestTypeDefinition,
};
