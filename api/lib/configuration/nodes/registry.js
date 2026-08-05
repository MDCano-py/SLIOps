/** Workflow node type registry for the visual designer + runtime. */

const NODE_TYPES = Object.freeze([
  { type: 'trigger.request_created', category: 'trigger', label: 'Request created', isStart: true },
  { type: 'trigger.request_submitted', category: 'trigger', label: 'Request submitted', isStart: true },
  { type: 'trigger.vendor_request_submitted', category: 'trigger', label: 'Vendor request submitted', isStart: true },
  { type: 'trigger.vendor_created', category: 'trigger', label: 'Vendor created', isStart: true },
  { type: 'trigger.vendor_status_changed', category: 'trigger', label: 'Vendor status changed', isStart: true },
  { type: 'trigger.form_submitted', category: 'trigger', label: 'Form submitted', isStart: true },
  { type: 'trigger.manual', category: 'trigger', label: 'Manual start', isStart: true },
  { type: 'trigger.client_link_opened', category: 'trigger', label: 'Client link opened', isStart: true },
  { type: 'trigger.document_signed', category: 'trigger', label: 'Document signed', isStart: true },
  { type: 'trigger.document_completed', category: 'trigger', label: 'Document completed', isStart: true },
  { type: 'trigger.task_completed', category: 'trigger', label: 'Task completed', isStart: true },
  { type: 'trigger.previous_completed', category: 'trigger', label: 'Previous workflow completed', isStart: true },
  { type: 'trigger.integration_event', category: 'trigger', label: 'Integration event received', isStart: true },
  { type: 'trigger.scheduled', category: 'trigger', label: 'Scheduled date reached', isStart: true },

  { type: 'human.fill', category: 'human', label: 'Fill form', taskType: 'Fill' },
  { type: 'human.review', category: 'human', label: 'Review request', taskType: 'Review' },
  { type: 'human.approve', category: 'human', label: 'Approve', taskType: 'Approve' },
  { type: 'human.reject', category: 'human', label: 'Reject', taskType: 'Reject' },
  { type: 'human.sign', category: 'human', label: 'Sign document', taskType: 'Sign' },
  { type: 'human.acknowledge', category: 'human', label: 'Acknowledge', taskType: 'Acknowledge' },
  { type: 'human.provide_info', category: 'human', label: 'Provide information', taskType: 'Provide Information' },
  { type: 'human.upload', category: 'human', label: 'Upload document', taskType: 'Upload' },

  { type: 'assign.user', category: 'assignment', label: 'Assign to user' },
  { type: 'assign.role', category: 'assignment', label: 'Assign to role' },
  { type: 'assign.creator', category: 'assignment', label: 'Assign to request creator' },
  { type: 'assign.manager', category: 'assignment', label: 'Assign to manager' },
  { type: 'assign.form_value', category: 'assignment', label: 'Assign using form value' },
  { type: 'assign.external', category: 'assignment', label: 'Assign to external participant' },
  { type: 'assign.client', category: 'assignment', label: 'Assign to client representative' },
  { type: 'assign.vendor_contact', category: 'assignment', label: 'Assign vendor contact' },
  { type: 'assign.shared_queue', category: 'assignment', label: 'Assign shared queue' },

  { type: 'logic.condition', category: 'logic', label: 'Condition' },
  { type: 'logic.multi_branch', category: 'logic', label: 'Multi-branch condition' },
  { type: 'logic.wait', category: 'logic', label: 'Wait' },
  { type: 'logic.delay_until', category: 'logic', label: 'Delay until date' },
  { type: 'logic.wait_for_action', category: 'logic', label: 'Wait for action' },
  { type: 'logic.merge', category: 'logic', label: 'Branch join / merge paths' },
  { type: 'logic.parallel_split', category: 'logic', label: 'Parallel split' },
  { type: 'logic.set_variable', category: 'logic', label: 'Set variable' },
  { type: 'logic.update_request', category: 'logic', label: 'Update request field' },
  { type: 'logic.update_vendor', category: 'logic', label: 'Update vendor field' },
  { type: 'logic.change_status', category: 'logic', label: 'Change status' },

  { type: 'notify.in_app', category: 'notification', label: 'In-app notification' },
  { type: 'notify.email', category: 'notification', label: 'Email (Automation)' },
  { type: 'notify.secure_link', category: 'notification', label: 'Send secure action link' },
  { type: 'notify.reminder', category: 'notification', label: 'Reminder' },
  { type: 'notify.escalation', category: 'notification', label: 'Escalation' },
  { type: 'notify.completion', category: 'notification', label: 'Completion notification' },

  { type: 'document.generate', category: 'document', label: 'Generate web document' },
  { type: 'document.request_signature', category: 'document', label: 'Request signature' },
  { type: 'document.request_initials', category: 'document', label: 'Request initials' },
  { type: 'document.request_ack', category: 'document', label: 'Request acknowledgement' },
  { type: 'document.attach', category: 'document', label: 'Attach document' },
  { type: 'document.archive', category: 'document', label: 'Archive document' },

  { type: 'integration.automation_webhook', category: 'integration', label: 'Emit automation event' },
  { type: 'integration.maintainx_create', category: 'integration', label: 'Create MaintainX work order' },
  { type: 'integration.maintainx_update', category: 'integration', label: 'Update MaintainX work order' },
  { type: 'integration.object_storage_upload', category: 'integration', label: 'Upload to object storage' },
  { type: 'integration.generic_webhook', category: 'integration', label: 'Generic webhook' },
  { type: 'integration.placeholder', category: 'integration', label: 'Future integration' },

  { type: 'terminal.complete', category: 'terminal', label: 'Complete', isTerminal: true },
  { type: 'terminal.cancel', category: 'terminal', label: 'Cancel', isTerminal: true },
  { type: 'terminal.reject', category: 'terminal', label: 'Reject', isTerminal: true },
  { type: 'terminal.archive', category: 'terminal', label: 'Archive', isTerminal: true },
  { type: 'terminal.fail', category: 'terminal', label: 'Fail', isTerminal: true },
]);

const NODE_BY_TYPE = Object.freeze(
  NODE_TYPES.reduce((acc, n) => {
    acc[n.type] = n;
    return acc;
  }, {})
);

function listNodeTypes() {
  return NODE_TYPES.slice();
}

function getNodeType(type) {
  return NODE_BY_TYPE[type] || null;
}

function isStartNodeType(type) {
  return !!(NODE_BY_TYPE[type] && NODE_BY_TYPE[type].isStart);
}

function isTerminalNodeType(type) {
  return !!(NODE_BY_TYPE[type] && NODE_BY_TYPE[type].isTerminal);
}

function isHumanNodeType(type) {
  return !!(NODE_BY_TYPE[type] && NODE_BY_TYPE[type].category === 'human');
}

module.exports = {
  NODE_TYPES,
  listNodeTypes,
  getNodeType,
  isStartNodeType,
  isTerminalNodeType,
  isHumanNodeType,
};
