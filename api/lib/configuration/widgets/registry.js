/** Dashboard widget registry — reuses operational concepts. */

const WIDGET_TYPES = Object.freeze([
  { type: 'kpi_value', label: 'KPI value' },
  { type: 'request_count', label: 'Request count' },
  { type: 'requests_by_status', label: 'Requests by status' },
  { type: 'requests_by_type', label: 'Requests by type' },
  { type: 'requests_by_priority', label: 'Requests by priority' },
  { type: 'aging_requests', label: 'Aging requests' },
  { type: 'waiting_on_me', label: 'Waiting on me' },
  { type: 'waiting_on_client', label: 'Waiting on client' },
  { type: 'failed_automation', label: 'Failed Automation actions' },
  { type: 'failed_maintainx', label: 'Failed MaintainX sync' },
  { type: 'recent_activity', label: 'Recent activity' },
  { type: 'recently_updated', label: 'Recently updated' },
  { type: 'my_tasks', label: 'My Tasks' },
  { type: 'needs_action', label: 'Needs action' },
  { type: 'sla_warning', label: 'SLA warning' },
  { type: 'completion_trend', label: 'Completion trend' },
  { type: 'saved_queue', label: 'Custom saved queue' },
  { type: 'quick_action', label: 'Quick action' },
  { type: 'instructional_text', label: 'Instructional text' },
  { type: 'admin_system_health', label: 'Admin system health' },
]);

const WIDGET_TYPE_SET = new Set(WIDGET_TYPES.map((w) => w.type));

function listWidgetTypes() {
  return WIDGET_TYPES.slice();
}

function isKnownWidgetType(type) {
  return WIDGET_TYPE_SET.has(type);
}

module.exports = {
  WIDGET_TYPES,
  listWidgetTypes,
  isKnownWidgetType,
};
