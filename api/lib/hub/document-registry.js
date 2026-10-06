/**
 * Document / form registry — single source of truth for request types.
 *
 * HOW TO ADD A NEW DOCUMENT TYPE (no portal rewrite):
 * 1. Add an entry to DOCUMENT_TYPES below (enabled: true, unique key).
 * 2. For a simple form: set render_mode: 'schema' and add FORM_DEFINITIONS[key].
 * 3. For a complex legacy form: set render_mode: 'custom', custom_component + portal_tab.
 * 4. Optionally add WORKFLOW_TEMPLATES keyed by default_workflow_template_id.
 * 5. Redeploy — GET /hub/registry/document-types exposes the new type to the UI.
 *
 * Future admin UI can replace this file with Redis-backed CRUD; routes stay the same.
 */

const DOCUMENT_TYPES = [
  {
    id: 'dt_work_order',
    key: 'work_order',
    label: 'Work Order',
    description: 'Maintenance work order routed to MaintainX.',
    category: 'operations',
    enabled: true,
    icon: 'wrench',
    requires_signature: false,
    requires_review: false,
    allow_custom_workflow: true,
    default_workflow_template_id: 'wf_work_order',
    storage_destination: 'maintainx',
    render_mode: 'custom',
    custom_component: 'WorkOrderForm',
    portal_tab: 'work-order',
    sort_order: 10,
  },
  {
    id: 'dt_parts',
    key: 'parts_request',
    label: 'Parts / Material',
    description: 'Parts request with photos and inventory routing.',
    category: 'operations',
    enabled: true,
    icon: 'package',
    requires_signature: false,
    requires_review: false,
    default_workflow_template_id: 'wf_parts',
    storage_destination: 'archive',
    render_mode: 'custom',
    custom_component: 'PartsRequestForm',
    portal_tab: 'parts',
    sort_order: 20,
  },
  {
    id: 'dt_equipment',
    key: 'equipment_request',
    label: 'Equipment Request',
    description: 'Internal equipment need with approval steps.',
    category: 'operations',
    enabled: true,
    icon: 'truck',
    requires_signature: false,
    requires_review: true,
    allow_custom_workflow: true,
    default_workflow_template_id: 'wf_equipment',
    storage_destination: 'hub',
    render_mode: 'schema',
    sort_order: 30,
  },
  {
    id: 'dt_swp',
    key: 'safe_work_permit',
    label: 'Safe Work Permit',
    description: 'Full permit lifecycle (custom SWP module).',
    category: 'safety',
    enabled: true,
    icon: 'shield',
    requires_signature: true,
    requires_review: true,
    allow_custom_workflow: true,
    default_workflow_template_id: 'wf_swp',
    storage_destination: 'archive',
    render_mode: 'custom',
    custom_component: 'SafeWorkPermitForm',
    portal_tab: 'swp',
    sort_order: 40,
  },
  {
    id: 'dt_jsa',
    key: 'jsa',
    label: 'JSA',
    description: 'Job safety analysis generator.',
    category: 'safety',
    enabled: true,
    icon: 'clipboard',
    requires_signature: true,
    requires_review: true,
    allow_custom_workflow: true,
    default_workflow_template_id: 'wf_jsa',
    storage_destination: 'archive',
    render_mode: 'custom',
    custom_component: 'JsaForm',
    portal_tab: 'jsa',
    sort_order: 50,
  },
  {
    id: 'dt_bol',
    key: 'bol',
    label: 'BOL',
    description: 'Bill of lading / delivery document.',
    category: 'logistics',
    enabled: true,
    icon: 'file',
    requires_signature: false,
    requires_review: true,
    allow_custom_workflow: true,
    default_workflow_template_id: 'wf_bol',
    storage_destination: 'archive',
    render_mode: 'custom',
    custom_component: 'BolForm',
    portal_tab: 'bol',
    sort_order: 60,
  },
  {
    id: 'dt_doc_review',
    key: 'document_review',
    label: 'Document Review',
    description: 'Route a document for internal or client review.',
    category: 'documents',
    enabled: true,
    icon: 'eye',
    requires_signature: false,
    requires_review: true,
    allow_custom_workflow: true,
    default_workflow_template_id: 'wf_doc_review',
    storage_destination: 'hub',
    render_mode: 'schema',
    sort_order: 70,
  },
  {
    id: 'dt_doc_sign',
    key: 'document_signature',
    label: 'Document Signature',
    description: 'Collect signature via secure client action link.',
    category: 'documents',
    enabled: true,
    icon: 'pen',
    requires_signature: true,
    requires_review: false,
    allow_custom_workflow: true,
    default_workflow_template_id: 'wf_doc_sign',
    storage_destination: 'hub',
    render_mode: 'schema',
    sort_order: 80,
  },
  {
    id: 'dt_general',
    key: 'general_request',
    label: 'General Request',
    description: 'Catch-all operational request.',
    category: 'general',
    enabled: true,
    icon: 'inbox',
    requires_signature: false,
    requires_review: false,
    default_workflow_template_id: 'wf_general',
    storage_destination: 'hub',
    render_mode: 'schema',
    sort_order: 90,
  },
  // --- Examples disabled until schemas/workflows are added ---
  {
    id: 'dt_inspection',
    key: 'inspection_form',
    label: 'Inspection Form',
    description: 'Field inspection checklist (schema-driven when enabled).',
    category: 'safety',
    enabled: false,
    icon: 'checklist',
    requires_signature: false,
    requires_review: true,
    default_workflow_template_id: 'wf_inspection',
    storage_destination: 'hub',
    render_mode: 'schema',
    sort_order: 200,
  },
  {
    id: 'dt_commissioning',
    key: 'commissioning_checklist',
    label: 'Commissioning Checklist',
    description: 'Equipment commissioning steps.',
    category: 'operations',
    enabled: false,
    icon: 'checklist',
    requires_signature: true,
    requires_review: true,
    default_workflow_template_id: 'wf_commissioning',
    storage_destination: 'hub',
    render_mode: 'schema',
    sort_order: 210,
  },
];

const FORM_DEFINITIONS = {
  equipment_request: {
    id: 'fd_equipment_v1',
    document_type_key: 'equipment_request',
    version: 1,
    title: 'Equipment Request',
    enabled: true,
    schema_json: [
      { type: 'text', name: 'title', label: 'Request title', required: true, fullWidth: true },
      { type: 'textarea', name: 'description', label: 'What is needed', fullWidth: true },
      { type: 'text', name: 'location', label: 'Site / location' },
      {
        type: 'select',
        name: 'priority',
        label: 'Priority',
        options: [
          { value: 'low', label: 'Low' },
          { value: 'normal', label: 'Normal' },
          { value: 'high', label: 'High' },
          { value: 'urgent', label: 'Urgent' },
        ],
        default: 'normal',
      },
    ],
    ui_schema_json: { layout: 'two-column', density: 'compact' },
  },
  document_review: {
    id: 'fd_doc_review_v1',
    document_type_key: 'document_review',
    version: 1,
    title: 'Document Review',
    enabled: true,
    schema_json: [
      { type: 'text', name: 'title', label: 'Document title', required: true, fullWidth: true },
      { type: 'textarea', name: 'description', label: 'Review instructions', fullWidth: true },
      { type: 'text', name: 'file_url', label: 'Document URL (optional)', fullWidth: true },
    ],
    ui_schema_json: {},
    workflow_steps: [
      { step_type: 'review', action_type: 'review', step_title: 'Document review', status: 'pending' },
    ],
  },
  document_signature: {
    id: 'fd_doc_sign_v1',
    document_type_key: 'document_signature',
    version: 1,
    title: 'Document Signature',
    enabled: true,
    schema_json: [
      { type: 'text', name: 'title', label: 'Document title', required: true, fullWidth: true },
      { type: 'textarea', name: 'description', label: 'Notes for signers', fullWidth: true },
      { type: 'email', name: 'signer_email', label: 'Signer email', required: true, fullWidth: true },
    ],
    ui_schema_json: {},
    workflow_steps: [
      {
        step_type: 'sign',
        action_type: 'sign',
        step_title: 'Signature required',
        status: 'pending',
        requires_signature: true,
      },
    ],
  },
  general_request: {
    id: 'fd_general_v1',
    document_type_key: 'general_request',
    version: 1,
    title: 'General Request',
    enabled: true,
    schema_json: [
      { type: 'text', name: 'title', label: 'Title', required: true, fullWidth: true },
      { type: 'textarea', name: 'description', label: 'Details', fullWidth: true },
      {
        type: 'select',
        name: 'priority',
        label: 'Priority',
        options: [
          { value: 'low', label: 'Low' },
          { value: 'normal', label: 'Normal' },
          { value: 'high', label: 'High' },
        ],
        default: 'normal',
      },
    ],
    ui_schema_json: {},
  },
};

const WORKFLOW_TEMPLATES = {
  wf_work_order: {
    id: 'wf_work_order',
    key: 'work_order_default',
    label: 'Work order → MaintainX',
    applies_to_document_type: 'work_order',
    enabled: true,
    steps_json: [
      { step_type: 'intake', step_title: 'Submitted', status: 'completed' },
      { step_type: 'maintainx', step_title: 'MaintainX work order', status: 'pending' },
    ],
  },
  wf_equipment: {
    id: 'wf_equipment',
    key: 'equipment_default',
    label: 'Equipment approval',
    applies_to_document_type: 'equipment_request',
    enabled: true,
    steps_json: [
      { step_type: 'review', step_title: 'Supervisor review', status: 'pending' },
      { step_type: 'fulfill', step_title: 'Procurement / deploy', status: 'pending' },
    ],
  },
  wf_doc_review: {
    id: 'wf_doc_review',
    key: 'doc_review_default',
    label: 'Document review',
    applies_to_document_type: 'document_review',
    enabled: true,
    steps_json: [
      { step_type: 'fill', action_type: 'fill', step_title: 'Submit document', status: 'completed' },
      { step_type: 'review', action_type: 'review', step_title: 'Internal review', status: 'pending', review_required: true },
      { step_type: 'review', action_type: 'review', step_title: 'Accounting review', status: 'pending', review_required: true },
    ],
  },
  wf_doc_sign: {
    id: 'wf_doc_sign',
    key: 'doc_sign_default',
    label: 'Client signature',
    applies_to_document_type: 'document_signature',
    enabled: true,
    steps_json: [
      { step_type: 'fill', action_type: 'fill', step_title: 'Prepare document', status: 'completed' },
      { step_type: 'sign', action_type: 'sign', step_title: 'Client signature', status: 'pending', requires_signature: true },
    ],
  },
  wf_jsa: {
    id: 'wf_jsa',
    key: 'jsa_default',
    label: 'JSA review & sign-off (sample)',
    applies_to_document_type: 'jsa',
    enabled: true,
    steps_json: [
      {
        step_type: 'fill',
        action_type: 'fill',
        step_title: '1. Field employee completes JSA',
        status: 'completed',
        instructions: 'Complete all hazard and control fields before routing for review.',
      },
      {
        step_type: 'review',
        action_type: 'review',
        step_title: '2. Supervisor review',
        status: 'pending',
        review_required: true,
        instructions: 'Review the JSA for completeness. Approve, reject, or add comments.',
      },
      {
        step_type: 'sign',
        action_type: 'sign',
        step_title: '3. Safety manager sign-off',
        status: 'pending',
        requires_signature: true,
        instructions: 'Sign to authorize work. Use signature pad or typed acknowledgement.',
      },
    ],
  },
  wf_swp: {
    id: 'wf_swp',
    key: 'swp_default',
    label: 'Safe Work Permit workflow',
    applies_to_document_type: 'safe_work_permit',
    enabled: true,
    steps_json: [
      { step_type: 'fill', action_type: 'fill', step_title: 'Permit author completes form', status: 'completed' },
      { step_type: 'review', action_type: 'review', step_title: 'Site supervisor review', status: 'pending', review_required: true },
      { step_type: 'sign', action_type: 'sign', step_title: 'Authorized signer', status: 'pending', requires_signature: true },
    ],
  },
  wf_bol: {
    id: 'wf_bol',
    key: 'bol_default',
    label: 'BOL review workflow',
    applies_to_document_type: 'bol',
    enabled: true,
    steps_json: [
      { step_type: 'fill', action_type: 'fill', step_title: 'Generate BOL', status: 'completed' },
      { step_type: 'review', action_type: 'review', step_title: 'Logistics review', status: 'pending', review_required: true },
    ],
  },
  wf_general: {
    id: 'wf_general',
    key: 'general_default',
    label: 'General intake',
    applies_to_document_type: 'general_request',
    enabled: true,
    steps_json: [{ step_type: 'intake', action_type: 'fill', step_title: 'Triage', status: 'pending' }],
  },
  wf_parts: {
    id: 'wf_parts',
    key: 'parts_default',
    label: 'Parts request intake',
    applies_to_document_type: 'parts_request',
    enabled: true,
    steps_json: [
      { step_type: 'fill', action_type: 'fill', step_title: 'Submit parts request', status: 'completed' },
      { step_type: 'review', action_type: 'review', step_title: 'Parts desk review', status: 'pending' },
    ],
  },
};

function stamp(doc) {
  const now = '2026-01-01T00:00:00.000Z';
  return { ...doc, created_at: doc.created_at || now, updated_at: doc.updated_at || now };
}

function listDocumentTypes({ enabledOnly = true, category } = {}) {
  let list = DOCUMENT_TYPES.map(stamp);
  if (enabledOnly) list = list.filter((d) => d.enabled);
  if (category) list = list.filter((d) => d.category === category);
  return list.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
}

function getDocumentType(key) {
  return DOCUMENT_TYPES.find((d) => d.key === key) || null;
}

function listCategories() {
  const cats = new Set(DOCUMENT_TYPES.filter((d) => d.enabled).map((d) => d.category));
  return [...cats].sort();
}

/** Fallback schema when a document type has no registry form (e.g. custom JSA portal tab). */
const ACTION_FILL_FALLBACK = {
  id: 'fd_action_fallback',
  document_type_key: '_action_fallback',
  version: 1,
  title: 'Complete assigned fields',
  enabled: true,
  schema_json: [
    { type: 'text', name: 'title', label: 'Document title', fullWidth: true },
    { type: 'text', name: 'location', label: 'Site / location' },
    { type: 'textarea', name: 'summary', label: 'Summary of work', fullWidth: true, rows: 4 },
    { type: 'textarea', name: 'hazards', label: 'Key hazards identified', fullWidth: true, rows: 3 },
    { type: 'textarea', name: 'controls', label: 'Controls in place', fullWidth: true, rows: 3 },
    { type: 'textarea', name: 'notes', label: 'Additional notes', fullWidth: true, rows: 2 },
  ],
  ui_schema_json: { layout: 'single-column' },
};

function getFormDefinition(documentTypeKey, version) {
  const def = FORM_DEFINITIONS[documentTypeKey];
  if (!def) return null;
  if (version != null && def.version !== version) return null;
  return stamp(def);
}

/** Schema for client action fill: registry form when available, else clean fallback (never raw JSON). */
function getFormDefinitionForAction(documentTypeKey) {
  const def = getFormDefinition(documentTypeKey);
  if (def?.schema_json?.length) {
    return { ...def, source: 'registry' };
  }
  const type = getDocumentType(documentTypeKey);
  return {
    ...ACTION_FILL_FALLBACK,
    title: type ? `Complete: ${type.label}` : ACTION_FILL_FALLBACK.title,
    document_type_key: documentTypeKey || '_action_fallback',
    source: 'fallback',
  };
}

function getWorkflowTemplate(idOrKey) {
  return (
    WORKFLOW_TEMPLATES[idOrKey] ||
    Object.values(WORKFLOW_TEMPLATES).find((w) => w.key === idOrKey) ||
    null
  );
}

function getRegistryBundle() {
  return {
    document_types: listDocumentTypes({ enabledOnly: false }),
    categories: listCategories(),
    form_definition_keys: Object.keys(FORM_DEFINITIONS),
    workflow_template_keys: Object.keys(WORKFLOW_TEMPLATES),
  };
}

module.exports = {
  DOCUMENT_TYPES,
  FORM_DEFINITIONS,
  WORKFLOW_TEMPLATES,
  listDocumentTypes,
  getDocumentType,
  listCategories,
  getFormDefinition,
  getFormDefinitionForAction,
  getWorkflowTemplate,
  getRegistryBundle,
  ACTION_FILL_FALLBACK,
};
