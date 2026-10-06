// Operations Workflow Hub — shared constants and default aging rules.
// Central portal DB (Upstash Redis) is source of truth for intake + workflow;
// MaintainX remains execution for work orders; n8n handles automation side effects.

const REQUEST_TYPES = [
  'work_order',
  'equipment_request',
  'parts_request',
  'safe_work_permit',
  'jsa',
  'bol',
  'document_review',
  'document_signature',
  'general_request',
];

const REQUEST_NUMBER_PREFIX = {
  work_order: 'WO',
  equipment_request: 'EQ',
  parts_request: 'PR',
  safe_work_permit: 'SWP',
  jsa: 'JSA',
  bol: 'BOL',
  document_review: 'DR',
  document_signature: 'DS',
  general_request: 'GR',
};

const REQUEST_STATUSES = [
  'submitted',
  'received',
  'in_review',
  'waiting_on_internal_review',
  'waiting_on_client_review',
  'waiting_on_signature',
  'waiting_on_approval',
  'approved',
  'sent_to_maintainx',
  'maintainx_in_progress',
  'waiting_on_parts',
  'in_progress',
  'completed',
  'closed',
  'rejected',
  'canceled',
  'failed_sync',
];

const STEP_TYPES = [
  'review',
  'approve',
  'sign',
  'upload',
  'verify',
  'send_to_maintainx',
  'send_to_sharepoint',
  'send_to_dynamics',
  'close',
];

const STEP_STATUSES = [
  'not_started',
  'pending',
  'in_progress',
  'completed',
  'skipped',
  'rejected',
  'failed',
];

const ASSIGNED_TYPES = ['employee', 'client', 'admin', 'system'];

const STORAGE_PROVIDERS = ['local', 'sharepoint', 'dynamics', 'external_url'];

const INTEGRATION_EVENT_TYPES = [
  'request.created',
  'request.status_changed',
  'request.assigned',
  'workflow_step.created',
  'workflow_step.completed',
  'workflow_step.rejected',
  'document.signed',
  'document.approved',
  'document.uploaded',
  'work_order.sent_to_maintainx',
  'work_order.maintainx_status_changed',
  'request.closed',
];

// Default aging thresholds (configurable via hub:settings:aging in Redis).
const DEFAULT_AGING_CONFIG = {
  highPriorityStaleBusinessDays: 1,
  normalAgingBusinessDays: 3,
  signatureAgingHours: 24,
  reviewAgingHours: 48,
  maintainxSyncAttentionMinutes: 15,
  completedNotClosedStaleBusinessDays: 3,
};

const HUB_ROLES = ['admin', 'manager', 'employee', 'technician', 'client', 'viewer'];

module.exports = {
  REQUEST_TYPES,
  REQUEST_NUMBER_PREFIX,
  REQUEST_STATUSES,
  STEP_TYPES,
  STEP_STATUSES,
  ASSIGNED_TYPES,
  STORAGE_PROVIDERS,
  INTEGRATION_EVENT_TYPES,
  DEFAULT_AGING_CONFIG,
  HUB_ROLES,
};
