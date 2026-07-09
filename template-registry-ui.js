/**
 * WOS-57 — Admin template registry + structured builder UI.
 */
(function (global) {
  'use strict';

  if (typeof module !== 'undefined' && module.exports && typeof global.TemplateSectionBuilder === 'undefined') {
    try {
      require('./template-section-builder.js');
    } catch (_) {
      /* browser bundle loads template-section-builder.js separately */
    }
  }

  const FIELD_TYPES = ['text', 'long_text', 'email', 'number', 'date', 'checkbox', 'dropdown', 'file_ref', 'signature_ack'];
  const STEP_TYPES = ['Fill', 'Review', 'Approve', 'Sign', 'Upload'];
  const FALLBACK_ASSIGNEE_ROLES = ['admin', 'requester', 'manager', 'ap', 'legal', 'operations'];

  const NEW_TEMPLATE_STARTER = {
    schema_json: {
      fields: [
        { key: 'title', type: 'text', label: 'Title', required: true },
        { key: 'description', type: 'textarea', label: 'Description', required: true },
        { key: 'requested_by', type: 'text', label: 'Requested By', required: true },
      ],
    },
    workflow_json: {
      steps: [
        { step_type: 'Fill', assignee_role: 'requester', field_keys: ['title', 'description', 'requested_by'] },
        { step_type: 'Review', assignee_role: 'manager' },
        { step_type: 'Sign', assignee_role: 'requester' },
      ],
    },
  };

  const DOCUMENT_TEMPLATE_STARTER_LEGACY = {
    schema_json: {
      fields: [
        { key: 'document_title', type: 'text', label: 'Document Title', required: true },
        {
          key: 'document_type',
          type: 'select',
          label: 'Document Type',
          required: true,
          options: ['Form', 'Certificate', 'Permit', 'Policy', 'Other'],
        },
        { key: 'requested_by', type: 'text', label: 'Requested By', required: true },
        { key: 'reference_file', type: 'file', label: 'Reference Document', required: false },
      ],
    },
    workflow_json: {
      steps: [
        {
          step_type: 'Fill',
          assignee_role: 'requester',
          field_keys: ['document_title', 'document_type', 'requested_by'],
        },
        { step_type: 'Upload', assignee_role: 'requester', field_keys: ['reference_file'] },
      ],
    },
  };

  const DOCUMENT_TAG = '[document-backed]';
  const FORM_TAG = '[form-backed]';
  const TEMPLATE_SPACES = ['forms', 'documents', 'workflows'];

  const FORM_TEMPLATE_STARTER = {
    schema_json: {
      sections: [
        {
          id: 'sec_general',
          title: 'General Information',
          description: 'Who is submitting and basic context',
          fields: [
            { id: 'field_form_title', key: 'form_title', type: 'text', label: 'Form Title', required: true },
            { id: 'field_submitted_by', key: 'submitted_by', type: 'text', label: 'Submitted By', required: true },
          ],
        },
        {
          id: 'sec_details',
          title: 'Details',
          description: 'Additional information for this form',
          fields: [{ id: 'field_notes', key: 'notes', type: 'textarea', label: 'Notes', required: false }],
        },
      ],
    },
    workflow_json: {
      steps: [{ step_type: 'Fill', assignee_role: 'requester', field_keys: ['form_title', 'submitted_by', 'notes'] }],
    },
    template_kind: 'form',
  };

  const SAFETY_FORM_STARTER = {
    schema_json: {
      sections: [
        {
          id: 'sec_job_info',
          title: 'Job Information',
          description: 'Site, job, and supervisor details',
          fields: [
            { id: 'field_job_name', key: 'job_name', type: 'text', label: 'Job Name', required: true },
            { id: 'field_site_location', key: 'site_location', type: 'text', label: 'Site / Location', required: true },
            { id: 'field_supervisor', key: 'supervisor', type: 'text', label: 'Supervisor', required: true },
          ],
        },
        {
          id: 'sec_hazard_review',
          title: 'Hazard Review',
          description: 'Identify hazards and controls',
          fields: [
            { id: 'field_hazards', key: 'hazards', type: 'textarea', label: 'Hazards identified', required: true },
            { id: 'field_controls', key: 'controls', type: 'textarea', label: 'Controls in place', required: false },
          ],
        },
        {
          id: 'sec_ppe',
          title: 'PPE / Controls',
          description: 'Required personal protective equipment',
          fields: [
            {
              id: 'field_ppe_required',
              key: 'ppe_required',
              type: 'select',
              label: 'PPE required',
              required: true,
              options: ['Hard hat', 'Safety glasses', 'Gloves', 'Harness', 'Other'],
            },
          ],
        },
        {
          id: 'sec_signatures',
          title: 'Signatures',
          description: 'Acknowledgments',
          fields: [
            { id: 'field_worker_ack', key: 'worker_ack', type: 'signature_ack', label: 'Worker acknowledgment', required: true },
          ],
        },
      ],
    },
    workflow_json: {
      steps: [
        {
          step_type: 'Fill',
          assignee_role: 'requester',
          field_keys: ['job_name', 'site_location', 'supervisor', 'hazards', 'controls', 'ppe_required', 'worker_ack'],
        },
      ],
    },
    template_kind: 'form',
  };

  const DOCUMENT_TEMPLATE_STARTER = {
    schema_json: {
      sections: [
        {
          id: 'sec_doc_info',
          title: 'Document Information',
          description: 'Core document metadata',
          fields: [
            { id: 'field_document_title', key: 'document_title', type: 'text', label: 'Document Title', required: true },
            { id: 'field_description', key: 'description', type: 'textarea', label: 'Description', required: false },
            { id: 'field_requested_by', key: 'requested_by', type: 'text', label: 'Requested By', required: true },
          ],
        },
        {
          id: 'sec_upload',
          title: 'Upload / Reference',
          description: 'Optional reference files',
          fields: [
            { id: 'field_reference_file', key: 'reference_file', type: 'file', label: 'Reference Document', required: false },
          ],
        },
      ],
    },
    workflow_json: {
      steps: [
        {
          step_type: 'Fill',
          assignee_role: 'requester',
          field_keys: ['document_title', 'description', 'requested_by', 'reference_file'],
        },
      ],
    },
    template_kind: 'document',
  };

  const CHECKLIST_TEMPLATE_STARTER = {
    schema_json: {
      sections: [
        {
          id: 'sec_checklist_details',
          title: 'Checklist Details',
          description: 'Checklist context',
          fields: [
            { id: 'field_checklist_title', key: 'checklist_title', type: 'text', label: 'Checklist Title', required: true },
            { id: 'field_inspector', key: 'inspector', type: 'text', label: 'Inspector', required: true },
          ],
        },
        {
          id: 'sec_items',
          title: 'Items',
          description: 'Checklist items',
          fields: [
            { id: 'field_item_notes', key: 'item_notes', type: 'textarea', label: 'Item notes', required: false },
          ],
        },
      ],
    },
    workflow_json: {
      steps: [{ step_type: 'Fill', assignee_role: 'requester', field_keys: ['checklist_title', 'inspector', 'item_notes'] }],
    },
    template_kind: 'checklist',
  };

  const INSPECTION_TEMPLATE_STARTER = {
    schema_json: {
      sections: [
        {
          id: 'sec_inspection_details',
          title: 'Inspection Details',
          description: 'Inspection context',
          fields: [
            { id: 'field_inspection_title', key: 'inspection_title', type: 'text', label: 'Inspection Title', required: true },
            { id: 'field_inspection_date', key: 'inspection_date', type: 'date', label: 'Inspection Date', required: true },
          ],
        },
        {
          id: 'sec_findings',
          title: 'Findings',
          description: 'Record findings',
          fields: [
            { id: 'field_findings', key: 'findings', type: 'textarea', label: 'Findings', required: false },
          ],
        },
      ],
    },
    workflow_json: {
      steps: [{ step_type: 'Fill', assignee_role: 'requester', field_keys: ['inspection_title', 'inspection_date', 'findings'] }],
    },
    template_kind: 'inspection',
  };

  const WORKFLOW_TEMPLATE_STARTER = {
    schema_json: {
      sections: [
        {
          id: 'sec_default',
          title: 'Details',
          description: '',
          fields: [{ id: 'field_workflow_title', key: 'workflow_title', type: 'text', label: 'Workflow Title', required: true }],
        },
      ],
    },
    workflow_json: {
      steps: [
        { step_type: 'Fill', assignee_role: 'requester', field_keys: ['workflow_title'] },
        { step_type: 'Review', assignee_role: 'manager' },
        { step_type: 'Approve', assignee_role: 'manager' },
      ],
    },
    template_kind: 'workflow',
  };

  const SPACE_META = {
    forms: {
      title: 'Forms',
      subtitle: 'Create reusable forms, publish for your team, and fill out published forms from one place.',
      breadcrumb: ['Forms'],
      bannerClass: 'tmpl-context-banner-forms',
      bannerHtml: '',
      newLabel: 'New Form',
      newKeyPrefix: 'form_',
      defaultName: 'New Form',
    },
    documents: {
      title: 'Documents',
      subtitle: 'Manage document-backed templates and document record types. Workflow routing is optional.',
      breadcrumb: ['Settings', 'Documents'],
      bannerClass: 'tmpl-context-banner-document',
      bannerHtml: `<strong>Documents</strong> — document record templates (${DOCUMENT_TAG}). Upload/review steps are optional after publish.`,
      newLabel: 'New Document Template',
      newKeyPrefix: 'doc_',
      defaultName: 'Document Template',
    },
    workflows: {
      title: 'Workflows',
      subtitle: 'Reusable approval routes and routing templates. Attach to a form when building it.',
      breadcrumb: ['Workflows'],
      bannerClass: 'tmpl-context-banner-workflows',
      bannerHtml:
        '<strong>Approval routes</strong> — reusable Fill → Review → Approve → Sign → Upload steps. Attach when editing a form.',
      newLabel: 'New Approval Route',
      newKeyPrefix: 'wf_',
      defaultName: 'Approval Route',
    },
  };

  let _root = null;
  let _route = { space: 'workflows', segments: [], query: {} };
  let _toastTimer = null;
  let _builderState = null;
  let _builderTab = 'edit';
  let _studioTab = 'build';
  let _formsManageFilter = 'all';
  let _formsManageSearch = '';
  let _formsManageAvailability = 'all';
  let _formsManageWorkflow = 'all';
  let _formsManageSort = 'newest';
  let _workflowRoleOptions = FALLBACK_ASSIGNEE_ROLES.map((key) => ({
    key,
    name: key.charAt(0).toUpperCase() + key.slice(1),
  }));
  let _workflowRolesLoaded = false;
  let _previewRefreshTimer = null;

  function sb() {
    return global.TemplateSectionBuilder;
  }

  function fieldTypesUi() {
    return sb()?.FIELD_TYPES_UI || FIELD_TYPES.map((t) => ({ value: t, label: t }));
  }

  function esc(s) {
    if (s == null) return '';
    if (typeof global.escapeHtml === 'function') return global.escapeHtml(s);
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function hubFetch(path, init) {
    if (typeof global.proxyFetch !== 'function') {
      return Promise.reject(new Error('API unavailable'));
    }
    // Use proxyFetch(path) — it already wraps with /api/maintainx?path= via proxyUrl().
    return global.proxyFetch(path, init);
  }

  async function parseHubResponse(res, path) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || data.detail || res.statusText || 'Request failed');
      err.status = res.status;
      err.path = path;
      err.body = data;
      if (data.validation) err.validation = data.validation;
      if (data.code) err.code = data.code;
      throw err;
    }
    return data;
  }

  function renderApiErrorPanel(err, title) {
    const path = err.path || '/hub/templates';
    const status = err.status != null ? err.status : '—';
    const detail = err.body?.detail || err.body?.path || '';
    return `
      <div class="hub-panel tmpl-panel">
        <div class="hub-panel-head">
          <div>
            <h2>${esc(title || 'Form & workflow templates')}</h2>
            <p class="hub-sub" style="margin:4px 0 0">Could not load template data from the hub API.</p>
          </div>
          <div class="hub-settings-actions">
            ${canManage() ? '<button type="button" class="hub-btn hub-btn-primary" id="tmplNewBtnRetry">New Template</button>' : ''}
            <button type="button" class="hub-btn hub-btn-ghost" id="tmplRetryBtn">Retry</button>
          </div>
        </div>
        <div class="hub-panel-body">
          <div class="tmpl-api-error">
            <p class="tmpl-validation-fail">${esc(err.message || 'Request failed')}</p>
            <ul class="tmpl-validation-list">
              <li><strong>API path:</strong> <code>${esc(path)}</code></li>
              <li><strong>HTTP status:</strong> <code>${esc(status)}</code></li>
              ${detail ? `<li><strong>Detail:</strong> <code>${esc(detail)}</code></li>` : ''}
            </ul>
            <p class="hub-sub">If you see “Path not allowed by proxy”, the client may be calling the wrong URL. Template APIs must use <code>proxyFetch('/hub/templates…')</code>, not a double-wrapped <code>/api/maintainx?path=</code> URL.</p>
            ${err.body?.code === 'POSTGRES_REQUIRED' ? '<p class="hub-sub">Template APIs require Postgres. Copy <code>.env.local.postgres.example</code> to <code>.env.local.postgres</code>, ensure Postgres is running, then restart <code>npm run dev</code>.</p>' : ''}
          </div>
        </div>
      </div>`;
  }

  function perms() {
    return global._hubPermissions || global._portalPermissions || [];
  }

  function canManage() {
    if (global.RbacClient && typeof global.RbacClient.hasAnyPerm === 'function') {
      return global.RbacClient.hasAnyPerm(perms(), ['hub_admin', 'admin']);
    }
    return (perms() || []).some((p) => p === 'hub_admin' || p === 'admin');
  }

  function fmtDate(v) {
    if (!v) return '—';
    try {
      return new Date(v).toLocaleString();
    } catch {
      return String(v);
    }
  }

  function slugKey(name) {
    return String(name || 'template')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_+/g, '_')
      .slice(0, 48) || 'template';
  }

  function statusBadge(status) {
    const s = String(status || '').toLowerCase();
    const cls =
      s === 'published' ? 'tmpl-badge tmpl-badge-published' :
      s === 'draft' ? 'tmpl-badge tmpl-badge-draft' :
      s === 'retired' ? 'tmpl-badge tmpl-badge-retired' :
      s === 'archived' ? 'tmpl-badge tmpl-badge-archived' :
      s === 'active' ? 'tmpl-badge tmpl-badge-active' : 'tmpl-badge';
    return `<span class="${cls}">${esc(status || 'unknown')}</span>`;
  }

  function normalizeFields(schema_json) {
    const sections = sb().normalizeSections(schema_json);
    return sections.flatMap((sec) => sec.fields);
  }

  function normalizeSections(schema_json) {
    return sb().normalizeSections(schema_json);
  }

  function normalizeSteps(workflow_json) {
    const raw = workflow_json && typeof workflow_json === 'object' ? workflow_json : {};
    return (Array.isArray(raw.steps) ? raw.steps : []).map((s) => ({
      step_type: s.step_type || s.type || 'Fill',
      assignee_role: s.assignee_role || s.role || 'requester',
      field_keys: Array.isArray(s.field_keys) ? [...s.field_keys] : Array.isArray(s.fields) ? [...s.fields] : [],
      label: s.label || s.step_type || s.type || '',
    }));
  }

  function buildPayload(fields, steps, sectionTitle) {
    const sections = sb().normalizeSections({
      sections: [{ id: 'sec_default', title: sectionTitle || 'Details', description: '', fields }],
    });
    return sb().buildPayloadFromSections(sections, steps);
  }

  function buildPayloadFromState() {
    return sb().buildPayloadFromSections(_builderState.sections, _builderState.steps);
  }

  function getTemplateKind(template) {
    if (template?.template_kind) return template.template_kind;
    const space = getSpaceContext();
    if (space === 'documents') return 'document';
    if (space === 'workflows') return 'workflow';
    return 'form';
  }

  function isBindableTemplate(template) {
    return ['form', 'document', 'checklist', 'inspection'].includes(getTemplateKind(template));
  }

  function moveItem(arr, index, dir) {
    const next = index + dir;
    if (next < 0 || next >= arr.length) return arr;
    const copy = arr.slice();
    const tmp = copy[index];
    copy[index] = copy[next];
    copy[next] = tmp;
    return copy;
  }

  function showToast(msg, kind) {
    if (!_root) return;
    let el = _root.querySelector('.tmpl-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'tmpl-toast';
      _root.appendChild(el);
    }
    el.className = 'tmpl-toast tmpl-toast-' + (kind || 'info');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 4200);
  }

  function getSpaceContext() {
    const space = _route.space || _route.query?.space;
    if (space && TEMPLATE_SPACES.includes(space)) return space;
    if (_route.query?.type === 'document') return 'documents';
    return 'workflows';
  }

  function spaceToHubTab(space) {
    if (space === 'forms') return 'hub-forms';
    if (space === 'documents') return 'hub-documents';
    return 'hub-workflows';
  }

  function isDocumentContext() {
    return getSpaceContext() === 'documents';
  }

  function isFormTemplate(t) {
    if (!t) return false;
    const cfg = t.launch_config_json || {};
    if (cfg.space_key === 'forms') return true;
    if (String(t.key || '').startsWith('form_')) return true;
    return String(t.description || '').includes(FORM_TAG);
  }

  function isDocumentTemplate(t) {
    if (!t) return false;
    const cfg = t.launch_config_json || {};
    if (cfg.space_key === 'documents') return true;
    if (String(t.key || '').startsWith('doc_')) return true;
    return String(t.description || '').includes(DOCUMENT_TAG);
  }

  function isWorkflowTemplate(t) {
    if (!t) return false;
    const cfg = t.launch_config_json || {};
    if (cfg.space_key === 'workflows') return true;
    if (isFormTemplate(t) || isDocumentTemplate(t)) return false;
    return true;
  }

  function getTemplateSpace(t) {
    const cfg = t?.launch_config_json || {};
    if (cfg.space_key && TEMPLATE_SPACES.includes(cfg.space_key)) return cfg.space_key;
    if (isDocumentTemplate(t)) return 'documents';
    if (isFormTemplate(t)) return 'forms';
    return 'workflows';
  }

  function filterTemplatesForContext(templates) {
    const space = getSpaceContext();
    const matched = templates.filter((t) => getTemplateSpace(t) === space);
    return matched.length ? matched : [];
  }

  function breadcrumbHtml(parts) {
    return parts.map((b, i) => (i ? ' › ' : '') + esc(b)).join('');
  }

  function updateWorkflowPageHead() {
    if (typeof document === 'undefined') return;
    const space = getSpaceContext();
    const meta = SPACE_META[space] || SPACE_META.workflows;
    const titleIds = {
      forms: 'hubFormsTitle',
      documents: 'hubDocumentsTitle',
      workflows: 'hubWorkflowsTitle',
    };
    const subIds = {
      forms: 'hubFormsSubtitle',
      documents: 'hubDocumentsSubtitle',
      workflows: 'hubWorkflowsSubtitle',
    };
    const crumbIds = {
      forms: 'hubFormsBreadcrumb',
      documents: 'hubDocumentsBreadcrumb',
      workflows: 'hubWorkflowsBreadcrumb',
    };
    const titleEl =
      document.getElementById(titleIds[space]) ||
      document.getElementById('hubTemplateAuthoringTitle') ||
      document.getElementById('hubWorkflowsTitle');
    const subEl =
      document.getElementById(subIds[space]) ||
      document.getElementById('hubTemplateAuthoringSubtitle') ||
      document.getElementById('hubWorkflowsSubtitle');
    const crumbEl =
      document.getElementById(crumbIds[space]) ||
      document.getElementById('hubTemplateAuthoringBreadcrumb');
    if (titleEl) titleEl.textContent = meta.title;
    if (subEl) subEl.textContent = meta.subtitle;
    if (crumbEl) crumbEl.innerHTML = breadcrumbHtml(meta.breadcrumb);
  }

  function launchStatusCell(t) {
    if (!t.current_published_version_id) {
      return '<span class="hub-sub">Not published</span>';
    }
    const cfg = t.launch_config_json || {};
    if (cfg.enabled === false) {
      return '<span class="tmpl-launch-badge tmpl-launch-hidden">Hidden</span>';
    }
    return '<span class="tmpl-launch-badge tmpl-launch-ready">Available</span>';
  }

  function renderContextBanner() {
    const space = getSpaceContext();
    const meta = SPACE_META[space];
    if (!meta || space === 'forms' || !meta.bannerHtml) return '';
    return `<div class="tmpl-context-banner ${meta.bannerClass}" role="status">${meta.bannerHtml}</div>`;
  }

  async function apiFetchLaunchRegistry() {
    const path = '/hub/spaces/registry';
    const res = await hubFetch(path);
    return parseHubResponse(res, path);
  }

  async function ensureDefaultLaunchConfig(templateId, templateName) {
    const space = getSpaceContext();
    if (space !== 'forms') return null;
    let existing = {};
    let name = templateName;
    try {
      const lc = await apiGetLaunchConfig(templateId);
      existing = lc.launch_config || {};
      if (!name && lc.template?.name) name = lc.template.name;
    } catch {
      existing = {};
    }
    const visibilityMode =
      existing.visibility_mode ||
      (Array.isArray(existing.visible_to_roles) && existing.visible_to_roles.length ? 'specific' : 'everyone');
    const config = {
      enabled: existing.enabled !== false,
      space_key: 'forms',
      label: existing.label || name || 'Form',
      description: existing.description || null,
      icon: existing.icon || 'form',
      quick_action_enabled: existing.quick_action_enabled !== false,
      visibility_mode: visibilityMode,
      visible_to_roles:
        visibilityMode === 'specific' && Array.isArray(existing.visible_to_roles) ? existing.visible_to_roles : [],
      route_type: 'template_runtime_placeholder',
    };
    await apiSaveLaunchConfig(templateId, config);
    return config;
  }

  function filterFormsManageTemplates(templates, filter) {
    const f = filter || _formsManageFilter;
    return (templates || []).filter((t) => {
      if (f === 'archived') return t.status === 'archived';
      if (t.status === 'archived') return false;
      if (f === 'draft') return !!t.latest_draft_id && !t.current_published_version_id;
      if (f === 'published') return !!t.current_published_version_id;
      return true;
    });
  }

  function isFormAvailable(t) {
    if (!t?.current_published_version_id) return false;
    const cfg = t.launch_config_json || {};
    return cfg.enabled !== false;
  }

  function hasWorkflowAttached(t) {
    if (t?.workflow_binding_mode && t.workflow_binding_mode !== 'none' && t.workflow_binding_template_id) {
      return true;
    }
    const steps = t?.published_workflow_json?.steps;
    return Array.isArray(steps) && steps.length > 0;
  }

  function formManageStatusLabel(t) {
    if (t.status === 'archived') return 'archived';
    if (t.current_published_version_id && t.latest_draft_id) return 'published';
    if (t.current_published_version_id) return 'published';
    if (t.latest_draft_id) return 'draft';
    return 'draft';
  }

  function applyFormsManageFilters(templates, opts = {}) {
    let list = filterFormsManageTemplates(templates, opts.statusFilter ?? _formsManageFilter);
    const q = String(opts.search ?? _formsManageSearch).trim().toLowerCase();
    if (q) {
      list = list.filter((t) => String(t.name || '').toLowerCase().includes(q));
    }
    const availability = opts.availability ?? _formsManageAvailability;
    if (availability === 'available') list = list.filter((t) => isFormAvailable(t));
    if (availability === 'not_available') list = list.filter((t) => !isFormAvailable(t));
    const workflow = opts.workflow ?? _formsManageWorkflow;
    if (workflow === 'attached') list = list.filter((t) => hasWorkflowAttached(t));
    if (workflow === 'none') list = list.filter((t) => !hasWorkflowAttached(t));
    const sort = opts.sort ?? _formsManageSort;
    list = [...list].sort((a, b) => {
      if (sort === 'name') return String(a.name || '').localeCompare(String(b.name || ''));
      const aTs = new Date(a.updated_at || a.created_at || 0).getTime();
      const bTs = new Date(b.updated_at || b.created_at || 0).getTime();
      return sort === 'oldest' ? aTs - bTs : bTs - aTs;
    });
    return list;
  }

  async function ensureWorkflowRolesLoaded() {
    if (_workflowRolesLoaded) return _workflowRoleOptions;
    try {
      const res = await hubFetch('/hub/rbac/workflow-roles');
      const data = await parseHubResponse(res, '/hub/rbac/workflow-roles');
      if (Array.isArray(data.roles) && data.roles.length) {
        _workflowRoleOptions = data.roles;
      }
    } catch {
      /* keep fallback */
    }
    _workflowRolesLoaded = true;
    return _workflowRoleOptions;
  }

  function assigneeRoleSelectOptions(selected) {
    const roles = _workflowRoleOptions.length
      ? _workflowRoleOptions
      : FALLBACK_ASSIGNEE_ROLES.map((key) => ({ key, name: key }));
    const sel = String(selected || 'requester').toLowerCase();
    return roles
      .map(
        (r) =>
          `<option value="${esc(r.key)}"${sel === String(r.key).toLowerCase() ? ' selected' : ''}>${esc(r.name || r.key)}</option>`
      )
      .join('');
  }

  function workflowStatusCell(t) {
    if (t.workflow_binding_mode && t.workflow_binding_mode !== 'none' && t.workflow_binding_name) {
      const mode = t.workflow_binding_mode === 'required' ? 'Required' : 'Optional';
      return `<span class="tmpl-badge tmpl-badge-workflow" title="${esc(mode)} approval route">${esc(t.workflow_binding_name)}</span>`;
    }
    const steps = t.published_workflow_json?.steps;
    if (Array.isArray(steps) && steps.length) {
      const n = steps.length;
      return `<span class="tmpl-badge tmpl-badge-workflow-inline">${n} step${n === 1 ? '' : 's'}</span>`;
    }
    return '<span class="hub-sub">None</span>';
  }

  function formMetadataDetailsHtml(t) {
    return `<details class="forms-manage-meta">
      <summary class="forms-manage-meta-toggle">Details</summary>
      <div class="forms-manage-meta-body">
        <div class="forms-manage-meta-row"><span class="forms-manage-meta-label">Internal key</span><code class="mono">${esc(t.key)}</code></div>
        ${t.description ? `<div class="forms-manage-meta-row"><span class="forms-manage-meta-label">Description</span><span>${esc(String(t.description).replace(FORM_TAG, '').trim())}</span></div>` : ''}
      </div>
    </details>`;
  }

  function navigateToFormLaunch(entryId) {
    if (typeof global.switchTab === 'function') {
      global.switchTab('hub-launch', { entryId });
    }
    if (global.streamlineRouter) {
      global.streamlineRouter.setHash('#/launch/' + entryId);
    }
  }

  function renderAvailableFormCard(entry, templateById) {
    const tpl = templateById?.[entry.template_id];
    const label = entry.label || tpl?.name || 'Form';
    const desc = entry.description || tpl?.description || '';
    const version = tpl?.published_version_number ? `v${tpl.published_version_number}` : '—';
    const updated = tpl?.updated_at ? fmtDate(tpl.updated_at) : '—';
    return `<article class="forms-hub-card" data-form-entry="${esc(entry.id)}">
      <div class="forms-hub-card-head">
        <h3>${esc(label)}</h3>
        ${statusBadge('published')}
      </div>
      ${desc ? `<p class="forms-hub-card-desc">${esc(desc.replace(FORM_TAG, '').trim())}</p>` : ''}
      <div class="forms-hub-card-meta">Version ${esc(version)} · Updated ${esc(updated)}</div>
      <div class="forms-hub-card-actions">
        <button type="button" class="hub-btn hub-btn-primary forms-hub-fill-btn" data-launch-entry="${esc(entry.id)}">Fill out form</button>
      </div>
    </article>`;
  }

  function renderFormsManageRows(templates, manage) {
    if (!templates.length) {
      return `<tr><td colspan="7" class="hub-empty">No forms in this view. ${manage ? 'Create one with "New Form" or adjust filters.' : ''}</td></tr>`;
    }
    return templates
      .map((t) => {
        const pub = t.published_version_number ? `v${t.published_version_number}` : '—';
        const availability = launchStatusCell(t);
        const workflow = workflowStatusCell(t);
        const status = formManageStatusLabel(t);
        const actions = [];
        if (t.current_published_version_id) {
          actions.push(`<button type="button" class="hub-btn hub-btn-ghost hub-btn-sm tmpl-act-view-pub" data-template-id="${esc(t.id)}" data-version-id="${esc(t.current_published_version_id)}">View Published</button>`);
        }
        if (manage && t.latest_draft_id) {
          actions.push(`<button type="button" class="hub-btn hub-btn-ghost hub-btn-sm tmpl-act-open-draft" data-template-id="${esc(t.id)}" data-version-id="${esc(t.latest_draft_id)}">Open Draft</button>`);
        }
        if (manage && t.current_published_version_id) {
          actions.push(`<button type="button" class="hub-btn hub-btn-ghost hub-btn-sm tmpl-act-clone" data-template-id="${esc(t.id)}">Clone to Draft</button>`);
          if (t.latest_draft_id) {
            actions.push(`<button type="button" class="hub-btn hub-btn-primary hub-btn-sm tmpl-act-publish" data-template-id="${esc(t.id)}" data-version-id="${esc(t.latest_draft_id)}">Publish Draft</button>`);
          }
        }
        actions.push(`<button type="button" class="hub-btn hub-btn-ghost hub-btn-sm tmpl-act-versions" data-template-id="${esc(t.id)}">View Versions</button>`);
        if (manage && t.status === 'active' && t.current_published_version_id) {
          actions.push(`<button type="button" class="hub-btn hub-btn-ghost hub-btn-sm tmpl-act-archive" data-template-id="${esc(t.id)}">Archive form</button>`);
        }
        if (manage && canDeleteDraftTemplate(t)) {
          actions.push(`<button type="button" class="hub-btn hub-btn-ghost hub-btn-sm tmpl-act-delete-draft" data-template-id="${esc(t.id)}">Delete draft</button>`);
        }
        return `<tr data-template-row="${esc(t.id)}">
          <td class="forms-manage-form-cell">
            <div class="forms-manage-form-name">${esc(t.name)}</div>
            ${manage ? formMetadataDetailsHtml(t) : ''}
          </td>
          <td>${statusBadge(status)}</td>
          <td>${esc(pub)}</td>
          <td>${workflow}</td>
          <td>${availability}</td>
          <td class="forms-manage-updated">${fmtDate(t.updated_at)}</td>
          <td><div class="tmpl-actions tmpl-actions-compact">${actions.join('')}</div></td>
        </tr>`;
      })
      .join('');
  }

  async function renderFormsHub() {
    if (!_root) return;
    updateWorkflowPageHead();
    const manage = canManage();
    _root.innerHTML = '<div class="hub-loading">Loading forms…</div>';
    try {
      if (manage) await ensureWorkflowRolesLoaded();
      const registry = await apiFetchLaunchRegistry();
      const formsSpace = (registry.spaces || []).find((s) => s.key === 'forms');
      const availableEntries = formsSpace?.entries || [];
      let formTemplates = [];
      let templateById = {};
      if (manage) {
        const allTemplates = await apiListTemplates();
        formTemplates = filterTemplatesForContext(allTemplates);
        templateById = Object.fromEntries(formTemplates.map((t) => [t.id, t]));
      } else {
        try {
          const allTemplates = await apiListTemplates();
          formTemplates = filterTemplatesForContext(allTemplates);
          templateById = Object.fromEntries(formTemplates.map((t) => [t.id, t]));
        } catch {
          templateById = {};
        }
      }

      const availableHtml = availableEntries.length
        ? availableEntries.map((e) => renderAvailableFormCard(e, templateById)).join('')
        : `<div class="forms-hub-empty"><p>No published forms available yet.</p><p class="hub-sub">${manage ? 'Create and publish a form to make it available to your team.' : 'Ask an admin to publish forms for your team.'}</p></div>`;

      const manageFiltered = manage ? applyFormsManageFilters(formTemplates) : [];
      const filterButtons = manage
        ? ['all', 'published', 'draft', 'archived']
            .map(
              (f) =>
                `<button type="button" class="forms-hub-filter${_formsManageFilter === f ? ' is-active' : ''}" data-forms-filter="${f}">${f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}</button>`
            )
            .join('')
        : '';

      const manageHtml = manage
        ? `<section class="forms-hub-manage hub-panel tmpl-panel">
          <div class="hub-panel-head">
            <div>
              <h2>Manage forms</h2>
              <p class="hub-sub" style="margin:4px 0 0">Create drafts, publish for your team, and archive when done.</p>
            </div>
            <div class="hub-settings-actions">
              <button type="button" class="hub-btn hub-btn-ghost" id="tmplApprovalRoutesBtn">Approval routes</button>
              <button type="button" class="hub-btn hub-btn-primary" id="tmplNewBtn">New Form</button>
            </div>
          </div>
          <div class="hub-panel-body">
            <div class="forms-manage-toolbar">
              <label class="forms-manage-search-wrap">
                <span class="sr-only">Search forms</span>
                <input type="search" class="input forms-manage-search" id="formsManageSearch" placeholder="Search by form name" value="${esc(_formsManageSearch)}" />
              </label>
              <div class="forms-hub-filter-row">${filterButtons}</div>
              <div class="forms-manage-filter-row">
                <select class="input forms-manage-select" id="formsManageAvailability" aria-label="Availability filter">
                  <option value="all"${_formsManageAvailability === 'all' ? ' selected' : ''}>All availability</option>
                  <option value="available"${_formsManageAvailability === 'available' ? ' selected' : ''}>Available</option>
                  <option value="not_available"${_formsManageAvailability === 'not_available' ? ' selected' : ''}>Not available</option>
                </select>
                <select class="input forms-manage-select" id="formsManageWorkflow" aria-label="Workflow filter">
                  <option value="all"${_formsManageWorkflow === 'all' ? ' selected' : ''}>All workflows</option>
                  <option value="attached"${_formsManageWorkflow === 'attached' ? ' selected' : ''}>Workflow attached</option>
                  <option value="none"${_formsManageWorkflow === 'none' ? ' selected' : ''}>No workflow</option>
                </select>
                <select class="input forms-manage-select" id="formsManageSort" aria-label="Sort forms">
                  <option value="newest"${_formsManageSort === 'newest' ? ' selected' : ''}>Newest first</option>
                  <option value="oldest"${_formsManageSort === 'oldest' ? ' selected' : ''}>Oldest first</option>
                  <option value="name"${_formsManageSort === 'name' ? ' selected' : ''}>Name A–Z</option>
                </select>
              </div>
            </div>
            <div class="hub-table-wrap forms-manage-table-wrap">
              <table class="hub-table tmpl-table forms-manage-table">
                <thead><tr>
                  <th>Form</th><th>Status</th><th>Version</th><th>Workflow</th><th>Available</th><th>Updated</th><th>Actions</th>
                </tr></thead>
                <tbody>${renderFormsManageRows(manageFiltered, manage)}</tbody>
              </table>
            </div>
          </div>
        </section>`
        : '';

      _root.innerHTML = `
        <section class="forms-hub-section hub-panel tmpl-panel">
          <div class="hub-panel-head">
            <div>
              <h2>Available forms</h2>
              <p class="hub-sub" style="margin:4px 0 0">Team members start published forms from <strong>New Request</strong>. Admins can also fill out forms here.</p>
            </div>
          </div>
          <div class="hub-panel-body">
            <div class="forms-hub-grid">${availableHtml}</div>
          </div>
        </section>
        ${manageHtml}
        <div id="tmplModalHost"></div>`;

      _root.querySelectorAll('.forms-hub-fill-btn').forEach((btn) => {
        btn.addEventListener('click', () => navigateToFormLaunch(btn.dataset.launchEntry));
      });
      _root.querySelectorAll('[data-forms-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
          _formsManageFilter = btn.dataset.formsFilter || 'all';
          renderFormsHub();
        });
      });
      const searchInput = _root.querySelector('#formsManageSearch');
      if (searchInput) {
        let searchTimer = null;
        searchInput.addEventListener('input', () => {
          clearTimeout(searchTimer);
          searchTimer = setTimeout(() => {
            _formsManageSearch = searchInput.value || '';
            renderFormsHub();
          }, 200);
        });
      }
      ['formsManageAvailability', 'formsManageWorkflow', 'formsManageSort'].forEach((id) => {
        _root.querySelector(`#${id}`)?.addEventListener('change', (e) => {
          const val = e.target.value;
          if (id === 'formsManageAvailability') _formsManageAvailability = val;
          if (id === 'formsManageWorkflow') _formsManageWorkflow = val;
          if (id === 'formsManageSort') _formsManageSort = val;
          renderFormsHub();
        });
      });
      if (manage) _root.querySelector('#tmplNewBtn')?.addEventListener('click', () => openNewTemplateModal());
      _root.querySelector('#tmplApprovalRoutesBtn')?.addEventListener('click', () => {
        if (global.HubUI && typeof global.HubUI.navigateToWorkflows === 'function') {
          global.HubUI.navigateToWorkflows();
        } else if (global.streamlineRouter) {
          global.streamlineRouter.setHash('#/forms/approval-routes');
        }
      });
      wireRegistryActions();
    } catch (err) {
      _root.innerHTML = renderApiErrorPanel(err, 'Forms');
      _root.querySelector('#tmplRetryBtn')?.addEventListener('click', () => renderFormsHub());
      _root.querySelector('#tmplNewBtnRetry')?.addEventListener('click', () => openNewTemplateModal());
    }
  }

  function setRouteHash(segments) {
    _route = { ..._route, segments: segments || [] };
    const space = getSpaceContext();
    const hubTab = spaceToHubTab(space);
    if (global.HubUI && typeof global.HubUI.buildRouteHash === 'function') {
      global.streamlineRouter?.setHash(
        global.HubUI.buildRouteHash(hubTab, {
          segments: _route.segments,
          query: _route.query || {},
          space,
        })
      );
    } else if (_route.segments[0] === 'builder' && _route.segments[1] && _route.segments[2]) {
      const base =
        space === 'forms'
          ? '#/forms/templates/'
          : space === 'documents'
            ? '#/documents/templates/'
            : '#/workflows/templates/';
      global.streamlineRouter?.setHash(base + _route.segments[1] + '/versions/' + _route.segments[2]);
    } else if (space === 'forms') {
      global.streamlineRouter?.setHash('#/forms');
    } else if (space === 'documents') {
      global.streamlineRouter?.setHash('#/documents/templates');
    } else {
      global.streamlineRouter?.setHash('#/workflows');
    }
  }

  function renderValidationPanel(result, sections) {
    if (!result) return '<p class="hub-sub">Run Validate before publish.</p>';
    const secs = sections || _builderState?.sections || [];
    let html = '';
    if (result.ok) {
      html += '<p class="tmpl-validation-ok">Validation passed — ready to publish.</p>';
    } else {
      const count = (result.errors || []).length;
      html += `<p class="tmpl-validation-fail">${count} issue${count === 1 ? '' : 's'} — fix before publish</p>`;
      html += sb().formatValidationErrorsGrouped(result.errors, secs, { linkGoto: true });
    }
    if (result.warnings?.length) {
      html += '<div class="tmpl-val-group"><h4 class="tmpl-val-group-title">Warnings <span class="tmpl-val-group-count">' + result.warnings.length + '</span></h4>';
      html += `<ul class="tmpl-validation-list">${sb().formatValidationErrors(result.warnings, secs)}</ul></div>`;
    }
    return html;
  }

  function wireValidationGoto() {
    _root?.querySelectorAll('.tmpl-val-goto').forEach((btn) => {
      btn.addEventListener('click', () => {
        setStudioTab('build');
        const sectionId = btn.dataset.sectionId;
        const fieldKey = btn.dataset.fieldKey;
        const card = sectionId ? _root.querySelector(`.tmpl-section-card[data-section-id="${sectionId}"]`) : null;
        if (card) {
          card.classList.remove('is-collapsed');
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        if (fieldKey) {
          const input = _root.querySelector(`.tmpl-field-row input[data-f="key"][value="${fieldKey}"]`);
          input?.closest('.tmpl-field-row')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    });
  }

  function renderStudioTabBar(activeTab) {
    const tabs = [
      { id: 'build', label: 'Build' },
      { id: 'workflow', label: 'Workflow' },
      { id: 'preview', label: 'Full preview' },
      { id: 'settings', label: 'Settings' },
      { id: 'advanced', label: 'JSON' },
    ];
    return `<nav class="tmpl-studio-tabs" aria-label="Form builder">
      ${tabs.map((t) => `<button type="button" class="tmpl-studio-tab${activeTab === t.id ? ' is-active' : ''}" data-studio-tab="${t.id}">${t.label}</button>`).join('')}
    </nav>`;
  }

  function schedulePreviewRefresh() {
    if (_previewRefreshTimer) clearTimeout(_previewRefreshTimer);
    _previewRefreshTimer = setTimeout(() => {
      _previewRefreshTimer = null;
      refreshPreviewPane();
    }, 120);
  }

  function renderBuildSplit(contentHtml) {
    return `<div class="tmpl-builder-split">
      <div class="tmpl-builder-edit-col">${contentHtml}</div>
      <aside class="tmpl-builder-preview-col" aria-label="Live preview">
        <div class="tmpl-preview-col-head">
          <h4>Live preview</h4>
          <span class="hub-sub">Updates as you edit</span>
        </div>
        <div id="tmplBuildPreviewPane" class="tmpl-build-preview-host"></div>
      </aside>
    </div>`;
  }

  function renderFieldEmptyState(sectionIndex, readOnly) {
    if (readOnly) return '<p class="hub-sub tmpl-empty-hint">No fields in this section.</p>';
    return `<div class="tmpl-empty-state">
      <div class="tmpl-empty-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/></svg>
      </div>
      <p class="tmpl-empty-title">Add your first field</p>
      <p class="hub-sub tmpl-empty-desc">Collect text, dates, dropdowns, files, and more.</p>
      <button type="button" class="hub-btn hub-btn-primary hub-btn-sm tmpl-add-field-in-section" data-section-index="${sectionIndex}">Add field</button>
    </div>`;
  }

  function fieldTypePill(type) {
    const label = sb().fieldTypeLabel(type);
    return `<span class="tmpl-field-type-pill" data-type-pill="${esc(type)}">${esc(label)}</span>`;
  }

  function setStudioTab(tab) {
    const allowed = ['build', 'workflow', 'preview', 'settings', 'advanced'];
    _studioTab = allowed.includes(tab) ? tab : 'build';
    _root?.querySelectorAll('.tmpl-studio-tab').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.studioTab === _studioTab);
    });
    _root?.querySelectorAll('[data-studio-pane]').forEach((pane) => {
      pane.hidden = pane.dataset.studioPane !== _studioTab;
    });
    if (_studioTab === 'preview' || _studioTab === 'build') refreshPreviewPane();
    if (_studioTab === 'advanced') refreshAdvancedJsonPane();
  }

  function refreshAdvancedJsonPane() {
    if (!_builderState || !_root) return;
    const ta = _root.querySelector('#tmplAdvancedJsonStudio');
    if (!ta) return;
    const payload = sb().buildPayloadFromSections(_builderState.sections, _builderState.steps);
    ta.value = JSON.stringify(payload.schema_json, null, 2);
  }

  async function apiImportNormalize(input, inputKind) {
    const path = '/hub/templates/import/normalize';
    const res = await hubFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, input_kind: inputKind || 'json', validate: true }),
    });
    return parseHubResponse(res, path);
  }

  async function apiImportApply(templateId, versionId, schema_json, mode) {
    const path = `/hub/templates/${encodeURIComponent(templateId)}/versions/${encodeURIComponent(versionId)}/import/apply`;
    const res = await hubFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schema_json, mode }),
    });
    return parseHubResponse(res, path);
  }

  function openImportModal() {
    if (!_builderState || _builderState.readOnly) return;
    const host = _root.querySelector('#tmplModalHost') || _root;
    host.insertAdjacentHTML(
      'beforeend',
      `<div class="tmpl-modal-backdrop" id="tmplImportBackdrop">
        <div class="tmpl-modal tmpl-import-modal" role="dialog" aria-labelledby="tmplImportTitle">
          <div class="tmpl-modal-head tmpl-import-head">
            <div>
              <h3 id="tmplImportTitle">Import / Generate Form</h3>
              <p class="hub-sub tmpl-import-sub">Paste AI or JSON output from an external tool. Updates your draft only — never publishes directly.</p>
            </div>
            <button type="button" class="hub-btn hub-btn-ghost" id="tmplImportClose" aria-label="Close">×</button>
          </div>
          <div class="tmpl-modal-body tmpl-import-body">
            <div class="tmpl-import-mode-tabs">
              <button type="button" class="tmpl-import-mode-tab is-active" data-import-kind="json">JSON</button>
              <button type="button" class="tmpl-import-mode-tab" data-import-kind="outline">Plain outline</button>
            </div>
            <div class="tmpl-import-layout">
              <div class="tmpl-import-input-col">
                <label class="tmpl-import-label" for="tmplImportInput">Paste input</label>
                <textarea id="tmplImportInput" class="tmpl-json-editor tmpl-import-textarea" rows="14" placeholder='{"sections":[{"title":"Job Information","fields":[{"label":"Job Name","type":"dropdown","options":["A","B"],"required":true}]}]}'></textarea>
                <div class="tmpl-import-actions">
                  <button type="button" class="hub-btn hub-btn-secondary" id="tmplImportNormalizeBtn">Normalize &amp; Preview</button>
                </div>
              </div>
              <div class="tmpl-import-preview-col">
                <label class="tmpl-import-label">Normalized preview</label>
                <div id="tmplImportPreview" class="tmpl-import-preview-empty">
                  <p class="hub-sub">Paste JSON or an outline, then click <strong>Normalize &amp; Preview</strong>.</p>
                </div>
              </div>
            </div>
            <div class="tmpl-import-apply-row">
              <div class="tmpl-import-mode-radios">
                <label class="hub-settings-check"><input type="radio" name="tmplImportMode" value="replace" checked /> Replace current draft schema</label>
                <label class="hub-settings-check"><input type="radio" name="tmplImportMode" value="append" /> Append as new sections</label>
              </div>
            </div>
          </div>
          <div class="tmpl-modal-foot tmpl-import-foot">
            <button type="button" class="hub-btn hub-btn-ghost" id="tmplImportCancel">Cancel</button>
            <button type="button" class="hub-btn hub-btn-primary" id="tmplImportApplyBtn" disabled>Apply to Draft</button>
          </div>
        </div>
      </div>`
    );
    let importKind = 'json';
    let normalizedSchema = null;
    const close = () => host.querySelector('#tmplImportBackdrop')?.remove();
    host.querySelector('#tmplImportClose')?.addEventListener('click', close);
    host.querySelector('#tmplImportCancel')?.addEventListener('click', close);
    host.querySelector('#tmplImportBackdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'tmplImportBackdrop') close();
    });
    host.querySelectorAll('[data-import-kind]').forEach((btn) => {
      btn.addEventListener('click', () => {
        importKind = btn.dataset.importKind;
        host.querySelectorAll('[data-import-kind]').forEach((b) => b.classList.toggle('is-active', b === btn));
      });
    });
    host.querySelector('#tmplImportNormalizeBtn')?.addEventListener('click', async () => {
      const input = host.querySelector('#tmplImportInput')?.value || '';
      const preview = host.querySelector('#tmplImportPreview');
      const applyBtn = host.querySelector('#tmplImportApplyBtn');
      try {
        const result = await apiImportNormalize(input, importKind);
        normalizedSchema = result.schema_json;
        const sections = sb().normalizeSections(result.schema_json);
        preview.className = 'tmpl-import-preview-col-inner';
        preview.innerHTML = sb().renderImportPreviewPanel({
          sections,
          sectionCount: result.section_count,
          fieldCount: result.field_count,
          warningsGrouped: result.warnings_grouped,
          validation: result.validation,
          publishNotices: result.publish_notices,
        });
        const schemaOk = result.ok && result.validation?.ok !== false;
        if (applyBtn) applyBtn.disabled = !schemaOk;
      } catch (e) {
        showToast(e.message, 'error');
        if (preview) {
          preview.className = 'tmpl-import-preview-col-inner tmpl-import-preview-error';
          preview.innerHTML = `<p class="tmpl-validation-fail">${esc(e.message)}</p>`;
        }
        if (applyBtn) applyBtn.disabled = true;
      }
    });
    host.querySelector('#tmplImportApplyBtn')?.addEventListener('click', async () => {
      if (!normalizedSchema) return;
      const mode = host.querySelector('input[name="tmplImportMode"]:checked')?.value || 'replace';
      try {
        const result = await apiImportApply(_builderState.templateId, _builderState.versionId, normalizedSchema, mode);
        _builderState.sections = sb().normalizeSections(result.version?.schema_json || normalizedSchema);
        showToast('Import applied to draft', 'success');
        close();
        setStudioTab('build');
        renderBuilder(_builderState.templateId, _builderState.versionId);
      } catch (e) {
        showToast(e.message, 'error');
      }
    });
  }

  function renderValidationErrors(errors) {
    if (!errors || !errors.length) return '';
    return sb().formatValidationErrors(errors, _builderState?.sections || []);
  }

  async function apiListTemplates() {
    const path = '/hub/templates';
    const res = await hubFetch(path);
    const data = await parseHubResponse(res, path);
    return data.templates || [];
  }

  async function apiCreateTemplate(payload) {
    const path = '/hub/templates';
    const res = await hubFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return parseHubResponse(res, path);
  }

  async function apiGetTemplate(id) {
    const path = '/hub/templates/' + encodeURIComponent(id);
    const res = await hubFetch(path);
    return parseHubResponse(res, path);
  }

  async function apiGetVersion(versionId) {
    const path = '/hub/templates/versions/' + encodeURIComponent(versionId);
    const res = await hubFetch(path);
    return parseHubResponse(res, path);
  }

  async function apiSaveDraft(versionId, body) {
    const path = '/hub/templates/versions/' + encodeURIComponent(versionId);
    const res = await hubFetch(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await parseHubResponse(res, path);
    return data.version;
  }

  async function apiValidate(versionId, body) {
    const path = '/hub/templates/versions/' + encodeURIComponent(versionId) + '/validate';
    const res = await hubFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    return parseHubResponse(res, path);
  }

  async function apiPublish(versionId) {
    const path = '/hub/templates/versions/' + encodeURIComponent(versionId) + '/publish';
    const res = await hubFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    return parseHubResponse(res, path);
  }

  async function apiGetLaunchConfig(templateId) {
    const path = '/hub/templates/' + encodeURIComponent(templateId) + '/launch-config';
    const res = await hubFetch(path);
    return parseHubResponse(res, path);
  }

  async function apiSaveLaunchConfig(templateId, config) {
    const path = '/hub/templates/' + encodeURIComponent(templateId) + '/launch-config';
    const res = await hubFetch(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    return parseHubResponse(res, path);
  }

  async function apiGetBinding(templateId) {
    const path = '/hub/templates/' + encodeURIComponent(templateId) + '/binding';
    const res = await hubFetch(path);
    return parseHubResponse(res, path);
  }

  async function apiSaveBinding(templateId, body) {
    const path = '/hub/templates/' + encodeURIComponent(templateId) + '/binding';
    const res = await hubFetch(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    return parseHubResponse(res, path);
  }

  async function apiDeleteBinding(templateId) {
    const path = '/hub/templates/' + encodeURIComponent(templateId) + '/binding';
    const res = await hubFetch(path, { method: 'DELETE' });
    return parseHubResponse(res, path);
  }

  async function apiListWorkflowTemplates() {
    const path = '/hub/workflow-templates';
    const res = await hubFetch(path);
    const data = await parseHubResponse(res, path);
    return data.workflows || [];
  }

  function defaultLaunchSpaceKey() {
    return getSpaceContext() === 'forms' ? 'forms' : getSpaceContext();
  }

  function launchRoleOptionsForUi() {
    return _workflowRoleOptions.length
      ? _workflowRoleOptions
      : FALLBACK_ASSIGNEE_ROLES.map((key) => ({ key, name: key.charAt(0).toUpperCase() + key.slice(1) }));
  }

  function renderVisibilityRoleCheckboxes(selectedRoles, readOnly, activeRoleKeys) {
    const selected = new Set(Array.isArray(selectedRoles) ? selectedRoles : []);
    const active = new Set(Array.isArray(activeRoleKeys) ? activeRoleKeys : launchRoleOptionsForUi().map((r) => r.key));
    const options = launchRoleOptionsForUi();
    const archivedSelected = [...selected].filter((key) => !active.has(key));
    const activeHtml = options
      .map(
        (r) =>
          `<label class="hub-settings-check hub-settings-check-inline tmpl-visibility-role"><input type="checkbox" name="tmplLaunchRole" value="${esc(r.key)}" ${selected.has(r.key) ? 'checked' : ''} ${readOnly ? 'disabled' : ''} /><span>${esc(r.name || r.key)}</span></label>`
      )
      .join('');
    const archivedHtml = archivedSelected.length
      ? `<div class="tmpl-visibility-archived"><span class="hub-sub">Saved inactive roles (preserved):</span> ${archivedSelected.map((k) => `<span class="tmpl-badge tmpl-badge-retired">${esc(k)}</span>`).join(' ')}</div>`
      : '';
    return activeHtml + archivedHtml;
  }

  function renderLaunchSettingsSection(launchConfig, templateName, readOnly, template) {
    const cfg = launchConfig || {};
    const isForm = getSpaceContext() === 'forms' || isFormTemplate(template);
    const isWorkflow = isWorkflowTemplate(template) || getSpaceContext() === 'workflows';

    if (isForm) {
      const enabled = cfg.enabled !== false;
      const visibilityMode =
        cfg.visibility_mode === 'specific' || (Array.isArray(cfg.visible_to_roles) && cfg.visible_to_roles.length)
          ? 'specific'
          : 'everyone';
      const selectedRoles = Array.isArray(cfg.visible_to_roles) ? cfg.visible_to_roles : [];
      return `<section class="tmpl-editor-section tmpl-launch-section" id="tmplLaunchSection">
        <h3>Availability</h3>
        <p class="hub-sub">Published forms appear in <strong>New Request</strong> when enabled below.</p>
        <div class="hub-settings-form tmpl-launch-form">
          <label class="hub-settings-check">
            <input type="checkbox" id="tmplLaunchEnabled" ${enabled ? 'checked' : ''} ${readOnly ? 'disabled' : ''} />
            <span>Make this form available in New Request</span>
          </label>
          <fieldset class="tmpl-launch-roles">
            <legend class="hub-sub">Who can fill this form?</legend>
            <label class="hub-settings-check"><input type="radio" name="tmplVisibilityMode" value="everyone" ${visibilityMode === 'everyone' ? 'checked' : ''} ${readOnly ? 'disabled' : ''} /><span>Everyone with access</span></label>
            <label class="hub-settings-check"><input type="radio" name="tmplVisibilityMode" value="specific" ${visibilityMode === 'specific' ? 'checked' : ''} ${readOnly ? 'disabled' : ''} /><span>Specific roles</span></label>
            <div id="tmplLaunchRolesWrap" class="tmpl-launch-roles-wrap"${visibilityMode === 'specific' ? '' : ' hidden'}>
              ${renderVisibilityRoleCheckboxes(selectedRoles, readOnly)}
            </div>
          </fieldset>
        </div>
        ${readOnly ? '' : '<button type="button" class="hub-btn hub-btn-secondary hub-btn-sm" id="tmplLaunchSaveBtn">Save availability</button>'}
        <div id="tmplLaunchStatus" class="hub-settings-status" hidden></div>
      </section>`;
    }

    if (isWorkflow) {
      return `<section class="tmpl-editor-section tmpl-launch-section" id="tmplLaunchSection">
        <h3>Approval route</h3>
        <p class="hub-sub">This template defines review and sign-off steps for forms and documents. Approval routes do not appear in New Request.</p>
      </section>`;
    }

    return `<section class="tmpl-editor-section tmpl-launch-section" id="tmplLaunchSection">
      <h3>Template settings</h3>
      <p class="hub-sub">Document templates use internal routing. New Request availability does not apply.</p>
    </section>`;
  }

  function readLaunchConfigFromDom(fallback = {}) {
    const isForm = getSpaceContext() === 'forms' || isFormTemplate(_builderState?.template);
    if (isForm) {
      const enabled = !!_root?.querySelector('#tmplLaunchEnabled')?.checked;
      const visibilityMode = _root?.querySelector('input[name="tmplVisibilityMode"]:checked')?.value || 'everyone';
      const roles = [];
      if (visibilityMode === 'specific') {
        _root?.querySelectorAll('input[name="tmplLaunchRole"]:checked').forEach((el) => roles.push(el.value));
        (fallback.visible_to_roles || []).forEach((key) => {
          const activeKeys = new Set(launchRoleOptionsForUi().map((r) => r.key));
          if (!activeKeys.has(key) && !roles.includes(key)) roles.push(key);
        });
      }
      return {
        enabled,
        space_key: 'forms',
        label: fallback.label || _builderState?.template?.name || null,
        description: fallback.description || null,
        icon: fallback.icon || 'form',
        quick_action_enabled: fallback.quick_action_enabled !== false,
        visibility_mode: visibilityMode,
        visible_to_roles: visibilityMode === 'specific' ? roles : [],
        route_type: 'template_runtime_placeholder',
      };
    }
    return {
      enabled: true,
      space_key: defaultLaunchSpaceKey(),
      label: fallback.label || _builderState?.template?.name || null,
      description: fallback.description || null,
      icon: fallback.icon || null,
      quick_action_enabled: false,
      visibility_mode: 'everyone',
      visible_to_roles: [],
      route_type: 'template_runtime_placeholder',
    };
  }

  function starterForSpace(space, preset) {
    if (space === 'documents') return DOCUMENT_TEMPLATE_STARTER;
    if (space === 'forms') {
      if (preset === 'safety') return SAFETY_FORM_STARTER;
      if (preset === 'checklist') return CHECKLIST_TEMPLATE_STARTER;
      if (preset === 'inspection') return INSPECTION_TEMPLATE_STARTER;
      return FORM_TEMPLATE_STARTER;
    }
    return WORKFLOW_TEMPLATE_STARTER;
  }

  function defaultDescriptionForSpace(space, description) {
    let desc = description || '';
    if (space === 'documents' && desc && !desc.includes(DOCUMENT_TAG)) desc = DOCUMENT_TAG + ' ' + desc;
    if (space === 'forms' && desc && !desc.includes(FORM_TAG)) desc = FORM_TAG + ' ' + desc;
    if (space === 'documents' && !desc) desc = DOCUMENT_TAG + ' Document workflow';
    if (space === 'forms' && !desc) desc = FORM_TAG + ' Form workflow';
    return desc || null;
  }

  async function saveLaunchConfigFromDom(templateId, fallback = {}) {
    const config = readLaunchConfigFromDom(fallback);
    await apiSaveLaunchConfig(templateId, config);
    return config;
  }

  async function apiCloneDraft(templateId) {
    const path = '/hub/templates/' + encodeURIComponent(templateId) + '/clone-draft';
    const res = await hubFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const data = await parseHubResponse(res, path);
    return data.draftVersion;
  }

  async function apiArchive(templateId) {
    const path = '/hub/templates/' + encodeURIComponent(templateId) + '/archive';
    const res = await hubFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const data = await parseHubResponse(res, path);
    return data.template;
  }

  async function apiDeleteDraft(templateId) {
    const path = '/hub/templates/' + encodeURIComponent(templateId) + '/delete';
    const res = await hubFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    return parseHubResponse(res, path);
  }

  function canDeleteDraftTemplate(t) {
    return !!t && t.status === 'active' && !t.current_published_version_id;
  }

  async function apiRetire(versionId) {
    const path = '/hub/templates/versions/' + encodeURIComponent(versionId) + '/retire';
    const res = await hubFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const data = await parseHubResponse(res, path);
    return data.version;
  }

  function readFieldRowFromDom(row) {
    const optionsRaw = row.querySelector('[data-f="options"]')?.value || '';
    const options = optionsRaw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return sb().normalizeField({
      id: row.dataset.fieldId || row.querySelector('[data-f="id"]')?.value,
      key: row.querySelector('[data-f="key"]')?.value?.trim() || '',
      label: row.querySelector('[data-f="label"]')?.value?.trim() || '',
      type: row.querySelector('[data-f="type"]')?.value || 'text',
      required: row.querySelector('[data-f="required"]')?.checked === true,
      options,
    });
  }

  function readSectionsFromDom() {
    return Array.from(_root.querySelectorAll('.tmpl-section-card')).map((card) => ({
      id: card.querySelector('[data-sec="id"]')?.value?.trim() || card.dataset.sectionId || 'sec_default',
      title: card.querySelector('[data-sec="title"]')?.value?.trim() || 'Details',
      description: card.querySelector('[data-sec="description"]')?.value || '',
      collapsed: card.classList.contains('is-collapsed'),
      fields: Array.from(card.querySelectorAll('.tmpl-field-row')).map(readFieldRowFromDom),
    }));
  }

  function readFieldsFromDom() {
    return readSectionsFromDom().flatMap((s) => s.fields);
  }

  function readStepsFromDom() {
    const rows = _root.querySelectorAll('.tmpl-step-row');
    return Array.from(rows).map((row) => {
      const fieldKeys = Array.from(row.querySelectorAll('[data-s="field_key"]:checked')).map((el) => el.value);
      return {
        step_type: row.querySelector('[data-s="step_type"]')?.value || 'Fill',
        assignee_role: row.querySelector('[data-s="assignee_role"]')?.value || 'requester',
        field_keys: fieldKeys,
        label: row.querySelector('[data-s="label"]')?.value?.trim() || '',
      };
    });
  }

  function renderFieldRow(field, fieldIndex, totalFields, sectionIndex, sectionCount, sections, readOnly) {
    const showOptions = field.type === 'select' || field.type === 'dropdown';
    const moveOptions =
      sectionCount > 1
        ? sections
            .map(
              (sec, si) =>
                `<option value="${si}"${si === sectionIndex ? ' selected' : ''}>${esc(sec.title || sec.id)}</option>`
            )
            .join('')
        : '';
    const typeIcon = sb().fieldTypeIconHtml(field.type);
    return `<div class="tmpl-field-row" data-section-index="${sectionIndex}" data-field-index="${fieldIndex}" data-field-id="${esc(field.id)}">
      <div class="tmpl-field-summary">
        <span class="tmpl-field-type-icon" data-type-icon="${esc(field.type)}" aria-hidden="true">${typeIcon}</span>
        <div class="tmpl-field-summary-main">
          <input class="input tmpl-field-label-input" data-f="label" placeholder="Field label" value="${esc(field.label)}" ${readOnly ? 'readonly' : ''} />
        </div>
        ${fieldTypePill(field.type)}
        ${field.required ? '<span class="tmpl-field-req-badge" title="Required">Required</span>' : '<span class="tmpl-field-opt-badge">Optional</span>'}
        <div class="tmpl-field-row-actions">
          ${readOnly ? '' : `<button type="button" class="hub-btn hub-btn-ghost tmpl-field-up" title="Move up" ${fieldIndex === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="hub-btn hub-btn-ghost tmpl-field-down" title="Move down" ${fieldIndex >= totalFields - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="hub-btn hub-btn-ghost tmpl-field-toggle-details" title="Field settings" aria-expanded="false">⚙</button>
          <button type="button" class="hub-btn hub-btn-ghost tmpl-field-remove" title="Remove field">×</button>`}
        </div>
      </div>
      <div class="tmpl-field-details" hidden>
        <input type="hidden" data-f="id" value="${esc(field.id)}" />
        <div class="tmpl-field-details-grid">
          <label class="hub-settings-field"><span>Field key</span><input class="input mono" data-f="key" placeholder="field_key" value="${esc(field.key)}" ${readOnly ? 'readonly' : ''} /></label>
          <label class="hub-settings-field"><span>Field type</span><select class="input" data-f="type" ${readOnly ? 'disabled' : ''}>${fieldTypesUi()
            .map((t) => `<option value="${t.value}"${field.type === t.value ? ' selected' : ''}>${esc(t.label)}</option>`)
            .join('')}</select></label>
          <label class="tmpl-check tmpl-field-req-check"><input type="checkbox" data-f="required"${field.required ? ' checked' : ''} ${readOnly ? 'disabled' : ''} /> Required field</label>
        </div>
        <div class="tmpl-row-extra" data-options-wrap style="${showOptions ? '' : 'display:none'}">
          <label class="hub-settings-field"><span>Dropdown options</span><input class="input" data-f="options" placeholder="Comma or newline separated" value="${esc((field.options || []).join(', '))}" ${readOnly ? 'readonly' : ''} /></label>
        </div>
        ${
          sectionCount > 1 && !readOnly
            ? `<label class="tmpl-field-move"><span class="hub-sub">Move to section</span><select class="input tmpl-field-move-sec" data-f="move_section">${moveOptions}</select></label>`
            : ''
        }
      </div>
    </div>`;
  }

  function renderSectionCard(section, sectionIndex, sections, readOnly) {
    const fields = section.fields || [];
    const collapsed = section.collapsed ? ' is-collapsed' : '';
    const fieldRows = fields.length
      ? `<div class="tmpl-field-stack">${fields
          .map((f, fi) => renderFieldRow(f, fi, fields.length, sectionIndex, sections.length, sections, readOnly))
          .join('')}</div>`
      : renderFieldEmptyState(sectionIndex, readOnly);
    return `<div class="tmpl-section-card${collapsed}" data-section-index="${sectionIndex}" data-section-id="${esc(section.id)}">
      <div class="tmpl-section-card-head">
        <button type="button" class="hub-btn hub-btn-ghost tmpl-section-collapse" title="Collapse/expand">${section.collapsed ? '▸' : '▾'}</button>
        <div class="tmpl-section-card-title-wrap">
          <input class="input tmpl-section-title" data-sec="title" value="${esc(section.title)}" ${readOnly ? 'readonly' : ''} placeholder="Section title" />
          <span class="tmpl-section-meta">${fields.length} field${fields.length === 1 ? '' : 's'}</span>
        </div>
        <div class="tmpl-section-card-actions">
          ${readOnly ? '' : `<button type="button" class="hub-btn hub-btn-ghost tmpl-sec-up" title="Move section up" ${sectionIndex === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="hub-btn hub-btn-ghost tmpl-sec-down" title="Move section down" ${sectionIndex >= sections.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="hub-btn hub-btn-ghost tmpl-sec-dup" title="Duplicate section">⧉</button>
          <button type="button" class="hub-btn hub-btn-ghost tmpl-sec-remove" title="Remove section">×</button>`}
        </div>
      </div>
      <div class="tmpl-section-card-body">
        <div class="tmpl-section-fields">${fieldRows}</div>
        ${readOnly || !fields.length ? '' : `<button type="button" class="hub-btn hub-btn-secondary hub-btn-sm tmpl-add-field-in-section tmpl-add-field-secondary" data-section-index="${sectionIndex}">+ Add field</button>`}
        <details class="tmpl-section-settings"${readOnly ? '' : ''}>
          <summary>Section settings</summary>
          <label class="hub-settings-field">
            <span>Description</span>
            <textarea class="input" data-sec="description" rows="2" ${readOnly ? 'readonly' : ''} placeholder="Optional section description">${esc(section.description || '')}</textarea>
          </label>
          <label class="hub-settings-field">
            <span>Section id</span>
            <input class="input mono" data-sec="id" value="${esc(section.id)}" ${readOnly ? 'readonly' : ''} />
          </label>
        </details>
      </div>
    </div>`;
  }

  function renderSectionsBuilder(sections, readOnly, templateKind, opts = {}) {
    const isWorkflow = templateKind === 'workflow';
    const cards = (sections || []).map((sec, i) => renderSectionCard(sec, i, sections, readOnly)).join('');
    const inner = `<section class="tmpl-editor-section tmpl-sections-builder">
      ${readOnly ? '' : `<div class="tmpl-build-toolbar">
        <button type="button" class="hub-btn hub-btn-primary" id="tmplAddFieldPrimary">+ Add field</button>
        <button type="button" class="hub-btn hub-btn-secondary" id="tmplAddSectionBtn">Add section</button>
        <button type="button" class="hub-btn hub-btn-ghost" id="tmplImportFormBtn">Import / Generate</button>
      </div>`}
      <div class="tmpl-editor-section-label">
        <h3>${isWorkflow ? 'Internal schema (minimal)' : 'Form structure'}</h3>
        <p class="hub-sub">${isWorkflow ? 'Workflow templates are step-first. Field sections are optional internal metadata.' : 'Add sections and fields. Preview updates on the right as you edit.'}</p>
      </div>
      <div id="tmplSectionsList" class="tmpl-sections-list">${cards}</div>
      ${readOnly ? '' : '<button type="button" class="hub-btn hub-btn-ghost hub-btn-sm" id="tmplAddSectionBtnFooter">+ Add another section</button>'}
    </section>`;
    if (opts.splitPreview && !isWorkflow) return renderBuildSplit(inner);
    return inner;
  }

  function renderAdvancedJsonSection(sections) {
    const payload = sb().buildPayloadFromSections(sections, _builderState?.steps || []);
    return `<details class="tmpl-advanced-json">
      <summary>Advanced JSON</summary>
      <p class="hub-sub">Structured builder is primary. Paste sectioned schema JSON here only if needed.</p>
      <textarea id="tmplAdvancedJson" class="tmpl-json-editor" rows="10">${esc(JSON.stringify(payload.schema_json, null, 2))}</textarea>
      <button type="button" class="hub-btn hub-btn-secondary hub-btn-sm" id="tmplApplyJsonBtn">Apply JSON to builder</button>
      <p id="tmplAdvancedJsonStatus" class="hub-settings-status" hidden></p>
    </details>`;
  }

  function refreshPreviewPane() {
    if (!_builderState || !_root) return;
    const sections = readSectionsFromDom();
    const previewHtml = sb().renderPreviewHtml({
      title: _builderState.template?.name,
      templateKind: getTemplateKind(_builderState.template),
      sections,
      bindingMode: _builderState.bindingMode || 'none',
    });
    const framed = sb().wrapPreviewFrame(_builderState.template?.name || 'Form preview', previewHtml);
    _root.querySelector('#tmplPreviewPane')?.replaceChildren?.();
    const fullPane = _root.querySelector('#tmplPreviewPane');
    if (fullPane) fullPane.innerHTML = framed;
    const buildPane = _root.querySelector('#tmplBuildPreviewPane');
    if (buildPane) buildPane.innerHTML = framed;
  }

  function refreshSectionsBuilder() {
    if (!_builderState || !_root) return;
    const readOnly = _builderState.readOnly;
    const list = _root.querySelector('#tmplSectionsList');
    if (list) {
      list.innerHTML = (_builderState.sections || [])
        .map((sec, i) => renderSectionCard(sec, i, _builderState.sections, readOnly))
        .join('');
    }
    const stepsEl = _root.querySelector('#tmplStepsList');
    if (stepsEl) {
      const keys = sb().flattenFieldKeys(_builderState.sections);
      stepsEl.innerHTML =
        _builderState.steps.map((s, i) => renderStepRow(s, i, _builderState.steps.length, keys, readOnly)).join('') ||
        '<p class="hub-sub tmpl-empty-hint">No steps yet.</p>';
    }
    wireSectionBuilderEvents();
    refreshPreviewPane();
  }

  function setBuilderTab(tab) {
    _builderTab = tab === 'preview' ? 'preview' : 'edit';
    const editPane = _root?.querySelector('#tmplEditPane');
    const previewPane = _root?.querySelector('#tmplPreviewPane');
    if (editPane) editPane.hidden = _builderTab !== 'edit';
    if (previewPane) previewPane.hidden = _builderTab !== 'preview';
    _root?.querySelectorAll('.tmpl-builder-tab').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.builderTab === _builderTab);
    });
    if (_builderTab === 'preview') refreshPreviewPane();
  }

  function renderFieldsSection(fields, readOnly) {
    return renderSectionsBuilder([{ id: 'sec_default', title: 'Details', description: '', fields }], readOnly, 'form', {
      splitPreview: true,
    });
  }

  function renderStepRow(step, index, total, allFieldKeys, readOnly) {
    const showFieldKeys = ['Fill', 'Upload'].includes(step.step_type);
    const fieldChecks = allFieldKeys
      .map(
        (k) =>
          `<label class="tmpl-check tmpl-field-key-check"><input type="checkbox" data-s="field_key" value="${esc(k)}"${(step.field_keys || []).includes(k) ? ' checked' : ''} ${readOnly ? 'disabled' : ''} /> ${esc(k)}</label>`
      )
      .join('');
    return `<div class="tmpl-step-row" data-index="${index}">
      <div class="tmpl-row-order">
        <button type="button" class="hub-btn hub-btn-ghost tmpl-step-up" title="Move up" ${index === 0 || readOnly ? 'disabled' : ''}>↑</button>
        <button type="button" class="hub-btn hub-btn-ghost tmpl-step-down" title="Move down" ${index >= total - 1 || readOnly ? 'disabled' : ''}>↓</button>
      </div>
      <div class="tmpl-step-main">
        <div class="tmpl-step-type-badge tmpl-step-type-${esc(step.step_type)}">${esc(step.step_type)}</div>
        <select class="input" data-s="step_type" ${readOnly ? 'disabled' : ''}>${STEP_TYPES.map((t) => `<option value="${t}"${step.step_type === t ? ' selected' : ''}>${t}</option>`).join('')}</select>
        <select class="input" data-s="assignee_role" ${readOnly ? 'disabled' : ''}>${assigneeRoleSelectOptions(step.assignee_role)}</select>
      </div>
      <div class="tmpl-step-fieldkeys" data-fieldkeys-wrap style="${showFieldKeys ? '' : 'display:none'}">${fieldChecks || '<span class="hub-sub">Add fields above first</span>'}</div>
      ${readOnly ? '' : '<button type="button" class="hub-btn hub-btn-ghost tmpl-step-remove" title="Remove step">×</button>'}
    </div>`;
  }

  function renderWorkflowBindingSection(bindingState, workflows, readOnly) {
    const mode = bindingState?.binding_mode || 'none';
    const currentId = bindingState?.binding?.workflow_template_id || '';
    const workflowOptions = (workflows || [])
      .map(
        (w) =>
          `<option value="${esc(w.id)}" ${w.id === currentId ? 'selected' : ''}>${esc(w.name)} (v${esc(w.published_version_number || '?')})</option>`
      )
      .join('');
    const statusLabel =
      mode === 'none' || !currentId
        ? 'No workflow attached'
        : mode === 'required'
          ? 'Required workflow attached'
          : 'Optional workflow attached';
    return `<section class="tmpl-editor-section tmpl-binding-section" id="tmplBindingSection">
      <div class="tmpl-section-head"><h3>Workflow Binding <span class="hub-sub">(optional)</span></h3></div>
      <p class="hub-sub">Attach a reusable published workflow template. Forms and documents do not require a binding to publish.</p>
      <p class="tmpl-binding-status"><strong>${esc(statusLabel)}</strong></p>
      ${
        !workflows?.length
          ? '<p class="hub-settings-inline-warn">No published workflow templates yet. Create and publish one under Workflows first.</p>'
          : ''
      }
      <div class="hub-settings-grid" style="max-width:640px">
        <label class="hub-settings-field">
          <span>Binding mode</span>
          <select id="tmplBindingMode" ${readOnly ? 'disabled' : ''}>
            <option value="none" ${mode === 'none' ? 'selected' : ''}>None</option>
            <option value="optional" ${mode === 'optional' ? 'selected' : ''}>Optional</option>
            <option value="required" ${mode === 'required' ? 'selected' : ''}>Required</option>
          </select>
        </label>
        <label class="hub-settings-field">
          <span>Workflow template</span>
          <select id="tmplBindingWorkflow" ${readOnly ? 'disabled' : ''}>
            <option value="">— Select published workflow —</option>
            ${workflowOptions}
          </select>
        </label>
      </div>
      ${
        readOnly
          ? ''
          : `<div class="hub-settings-actions" style="margin-top:10px">
              <button type="button" class="hub-btn hub-btn-secondary" id="tmplBindingSaveBtn">Save Binding</button>
              <button type="button" class="hub-btn hub-btn-ghost" id="tmplBindingRemoveBtn">Remove Binding</button>
            </div>`
      }
      <p id="tmplBindingStatus" class="hub-settings-status" hidden></p>
    </section>`;
  }

  function renderStepsSection(steps, fieldKeys, readOnly) {
    const rows = steps.map((s, i) => renderStepRow(s, i, steps.length, fieldKeys, readOnly)).join('');
    return `<section class="tmpl-editor-section">
      <div class="tmpl-section-head">
        <h3>Workflow Steps</h3>
        ${readOnly ? '' : '<button type="button" class="hub-btn hub-btn-secondary" id="tmplAddStepBtn">+ Add Step</button>'}
      </div>
      <p class="hub-sub">Configure Fill, Review, Approve, Sign, and Upload steps with assignee roles.</p>
      <div id="tmplStepsList" class="tmpl-builder-list">${rows || '<p class="hub-sub tmpl-empty-hint">No steps yet.</p>'}</div>
    </section>`;
  }

  function refreshBuilderLists() {
    refreshSectionsBuilder();
  }

  function syncSectionsFromDomToState() {
    if (!_builderState) return;
    _builderState.sections = readSectionsFromDom();
    _builderState.steps = readStepsFromDom();
  }

  function wireSectionBuilderEvents() {
    if (!_builderState || !_root) return;
    const readOnly = _builderState.readOnly;

    _root.querySelector('#tmplImportFormBtn')?.addEventListener('click', () => openImportModal());

    _root.querySelector('#tmplApplyJsonStudioBtn')?.addEventListener('click', () => {
      const statusEl = _root.querySelector('#tmplAdvancedJsonStudioStatus');
      const raw = _root.querySelector('#tmplAdvancedJsonStudio')?.value || '';
      try {
        const parsed = JSON.parse(raw);
        _builderState.sections = sb().normalizeSections(parsed);
        if (statusEl) {
          statusEl.hidden = false;
          statusEl.textContent = 'JSON applied to builder';
          statusEl.className = 'hub-settings-status is-success';
        }
        refreshSectionsBuilder();
        setStudioTab('build');
      } catch (e) {
        if (statusEl) {
          statusEl.hidden = false;
          statusEl.textContent = 'Invalid JSON: ' + e.message;
          statusEl.className = 'hub-settings-status is-error';
        }
      }
    });

    if (_studioTab === 'preview' || _studioTab === 'build') refreshPreviewPane();

    if (readOnly) return;

    function addFieldToSection(si) {
      syncSectionsFromDomToState();
      const sec = _builderState.sections[si];
      if (!sec) return;
      const n = (sec.fields || []).length + 1;
      sec.fields.push({
        id: sb().slugId('field_', `new_field_${n}`),
        key: `new_field_${n}`,
        label: 'New Field',
        type: 'text',
        required: false,
        options: [],
      });
      refreshSectionsBuilder();
    }

    _root.querySelector('#tmplAddFieldPrimary')?.addEventListener('click', () => {
      syncSectionsFromDomToState();
      const sections = _builderState.sections || [];
      if (!sections.length) return;
      const target = sections.findIndex((s) => (s.fields || []).length > 0);
      addFieldToSection(target >= 0 ? target : 0);
    });

    _root.querySelector('#tmplAddSectionBtn')?.addEventListener('click', () => {
      syncSectionsFromDomToState();
      const n = (_builderState.sections || []).length + 1;
      _builderState.sections.push({
        id: sb().slugId('sec_', `section_${n}`),
        title: `Section ${n}`,
        description: '',
        collapsed: false,
        fields: [],
      });
      refreshSectionsBuilder();
    });

    _root.querySelector('#tmplAddStepBtn')?.addEventListener('click', () => {
      syncSectionsFromDomToState();
      _builderState.steps.push({ step_type: 'Review', assignee_role: 'manager', field_keys: [], label: '' });
      refreshSectionsBuilder();
    });

    _root.querySelector('#tmplAddSectionBtnFooter')?.addEventListener('click', () => {
      syncSectionsFromDomToState();
      const n = (_builderState.sections || []).length + 1;
      _builderState.sections.push({
        id: sb().slugId('sec_', `section_${n}`),
        title: `Section ${n}`,
        description: '',
        collapsed: false,
        fields: [],
      });
      refreshSectionsBuilder();
    });

    _root.querySelectorAll('.tmpl-add-field-in-section').forEach((btn) => {
      btn.addEventListener('click', () => {
        addFieldToSection(Number(btn.dataset.sectionIndex));
      });
    });

    _root.querySelectorAll('.tmpl-sec-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncSectionsFromDomToState();
        const card = btn.closest('.tmpl-section-card');
        const si = Number(card?.dataset.sectionIndex);
        const sec = _builderState.sections[si];
        if (!sec) return;
        if ((_builderState.sections || []).length <= 1) {
          showToast('At least one section must remain', 'error');
          return;
        }
        if ((sec.fields || []).length > 0) {
          if (!confirm(`Section "${sec.title}" has ${sec.fields.length} field(s). Remove anyway? Fields will be deleted.`)) return;
        }
        _builderState.sections.splice(si, 1);
        refreshSectionsBuilder();
      });
    });

    _root.querySelectorAll('.tmpl-sec-dup').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncSectionsFromDomToState();
        const si = Number(btn.closest('.tmpl-section-card')?.dataset.sectionIndex);
        _builderState.sections = sb().duplicateSection(_builderState.sections, si);
        refreshSectionsBuilder();
      });
    });

    _root.querySelectorAll('.tmpl-sec-up').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncSectionsFromDomToState();
        const si = Number(btn.closest('.tmpl-section-card')?.dataset.sectionIndex);
        _builderState.sections = moveItem(_builderState.sections, si, -1);
        refreshSectionsBuilder();
      });
    });
    _root.querySelectorAll('.tmpl-sec-down').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncSectionsFromDomToState();
        const si = Number(btn.closest('.tmpl-section-card')?.dataset.sectionIndex);
        _builderState.sections = moveItem(_builderState.sections, si, 1);
        refreshSectionsBuilder();
      });
    });

    _root.querySelectorAll('.tmpl-section-collapse').forEach((btn) => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.tmpl-section-card');
        if (!card) return;
        card.classList.toggle('is-collapsed');
        btn.textContent = card.classList.contains('is-collapsed') ? '▸' : '▾';
      });
    });

    _root.querySelectorAll('.tmpl-field-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncSectionsFromDomToState();
        const row = btn.closest('.tmpl-field-row');
        const si = Number(row?.dataset.sectionIndex);
        const fi = Number(row?.dataset.fieldIndex);
        if (_builderState.sections[si]?.fields) {
          _builderState.sections[si].fields.splice(fi, 1);
          refreshSectionsBuilder();
        }
      });
    });

    _root.querySelectorAll('.tmpl-field-up').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncSectionsFromDomToState();
        const row = btn.closest('.tmpl-field-row');
        const si = Number(row?.dataset.sectionIndex);
        const fi = Number(row?.dataset.fieldIndex);
        const fields = _builderState.sections[si]?.fields;
        if (fields) {
          _builderState.sections[si].fields = moveItem(fields, fi, -1);
          refreshSectionsBuilder();
        }
      });
    });
    _root.querySelectorAll('.tmpl-field-down').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncSectionsFromDomToState();
        const row = btn.closest('.tmpl-field-row');
        const si = Number(row?.dataset.sectionIndex);
        const fi = Number(row?.dataset.fieldIndex);
        const fields = _builderState.sections[si]?.fields;
        if (fields) {
          _builderState.sections[si].fields = moveItem(fields, fi, 1);
          refreshSectionsBuilder();
        }
      });
    });

    _root.querySelectorAll('.tmpl-field-move-sec').forEach((sel) => {
      sel.addEventListener('change', () => {
        syncSectionsFromDomToState();
        const row = sel.closest('.tmpl-field-row');
        const fromSi = Number(row?.dataset.sectionIndex);
        const fi = Number(row?.dataset.fieldIndex);
        const toSi = Number(sel.value);
        if (fromSi === toSi || Number.isNaN(toSi)) return;
        const field = _builderState.sections[fromSi]?.fields?.[fi];
        if (!field || !_builderState.sections[toSi]) return;
        _builderState.sections[fromSi].fields.splice(fi, 1);
        _builderState.sections[toSi].fields.push(field);
        refreshSectionsBuilder();
      });
    });

    _root.querySelectorAll('.tmpl-step-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncSectionsFromDomToState();
        const idx = Number(btn.closest('.tmpl-step-row')?.dataset.index);
        _builderState.steps.splice(idx, 1);
        refreshSectionsBuilder();
      });
    });
    _root.querySelectorAll('.tmpl-step-row .tmpl-step-up').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncSectionsFromDomToState();
        const idx = Number(btn.closest('.tmpl-step-row')?.dataset.index);
        _builderState.steps = moveItem(_builderState.steps, idx, -1);
        refreshSectionsBuilder();
      });
    });
    _root.querySelectorAll('.tmpl-step-row .tmpl-step-down').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncSectionsFromDomToState();
        const idx = Number(btn.closest('.tmpl-step-row')?.dataset.index);
        _builderState.steps = moveItem(_builderState.steps, idx, 1);
        refreshSectionsBuilder();
      });
    });

    _root.querySelectorAll('.tmpl-field-toggle-details').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.tmpl-field-row');
        const details = row?.querySelector('.tmpl-field-details');
        if (!details) return;
        const open = details.hidden;
        details.hidden = !open;
        row.classList.toggle('is-expanded', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });

    function syncFieldRowSummary(row) {
      if (!row) return;
      const type = row.querySelector('[data-f="type"]')?.value || 'text';
      const key = row.querySelector('[data-f="key"]')?.value?.trim() || 'field_key';
      const required = row.querySelector('[data-f="required"]')?.checked === true;
      const iconEl = row.querySelector('.tmpl-field-type-icon');
      if (iconEl) {
        iconEl.dataset.typeIcon = type;
        iconEl.innerHTML = sb().fieldTypeIconHtml(type);
      }
      const pill = row.querySelector('.tmpl-field-type-pill');
      if (pill) {
        pill.dataset.typePill = type;
        pill.textContent = sb().fieldTypeLabel(type);
      }
      const reqBadge = row.querySelector('.tmpl-field-req-badge, .tmpl-field-opt-badge');
      if (reqBadge) {
        reqBadge.className = required ? 'tmpl-field-req-badge' : 'tmpl-field-opt-badge';
        reqBadge.textContent = required ? 'Required' : 'Optional';
        reqBadge.title = required ? 'Required' : 'Optional';
      }
    }

    _root.querySelectorAll('.tmpl-field-row [data-f="type"]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const wrap = sel.closest('.tmpl-field-row')?.querySelector('[data-options-wrap]');
        if (wrap) wrap.style.display = sel.value === 'select' || sel.value === 'dropdown' ? '' : 'none';
        syncFieldRowSummary(sel.closest('.tmpl-field-row'));
        schedulePreviewRefresh();
      });
    });
    _root.querySelectorAll('.tmpl-field-row [data-f="key"], .tmpl-field-row [data-f="label"], .tmpl-field-row [data-f="required"], .tmpl-field-row [data-f="options"]').forEach((el) => {
      el.addEventListener('input', () => {
        syncFieldRowSummary(el.closest('.tmpl-field-row'));
        schedulePreviewRefresh();
      });
      el.addEventListener('change', () => {
        syncFieldRowSummary(el.closest('.tmpl-field-row'));
        schedulePreviewRefresh();
      });
    });
    _root.querySelectorAll('[data-sec="title"], [data-sec="description"]').forEach((el) => {
      el.addEventListener('input', schedulePreviewRefresh);
      el.addEventListener('change', schedulePreviewRefresh);
    });

    _root.querySelectorAll('.tmpl-step-row [data-s="step_type"]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const badge = sel.closest('.tmpl-step-row')?.querySelector('.tmpl-step-type-badge');
        if (badge) {
          badge.textContent = sel.value;
          badge.className = 'tmpl-step-type-badge tmpl-step-type-' + sel.value;
        }
        const wrap = sel.closest('.tmpl-step-row')?.querySelector('[data-fieldkeys-wrap]');
        if (wrap) wrap.style.display = ['Fill', 'Upload'].includes(sel.value) ? '' : 'none';
      });
    });

    _root.querySelector('#tmplApplyJsonBtn')?.addEventListener('click', () => {
      const statusEl = _root.querySelector('#tmplAdvancedJsonStatus');
      const raw = _root.querySelector('#tmplAdvancedJson')?.value || '';
      try {
        const parsed = JSON.parse(raw);
        _builderState.sections = sb().normalizeSections(parsed);
        if (statusEl) {
          statusEl.hidden = false;
          statusEl.textContent = 'JSON applied to builder';
          statusEl.className = 'hub-settings-status is-success';
        }
        refreshSectionsBuilder();
      } catch (e) {
        if (statusEl) {
          statusEl.hidden = false;
          statusEl.textContent = 'Invalid JSON: ' + e.message;
          statusEl.className = 'hub-settings-status is-error';
        }
      }
    });
  }

  function wireBuilderListEvents() {
    wireSectionBuilderEvents();
  }

  function syncBuilderStateFromDom() {
    if (!_builderState) return buildPayload([], []);
    syncSectionsFromDomToState();
    return buildPayloadFromState();
  }

  async function renderRegistry() {
    if (!_root) return;
    updateWorkflowPageHead();
    const manage = canManage();
    const space = getSpaceContext();
    const meta = SPACE_META[space] || SPACE_META.workflows;
    _root.innerHTML = '<div class="hub-loading">Loading templates…</div>';
    try {
      const allTemplates = await apiListTemplates();
      const templates = filterTemplatesForContext(allTemplates);
      const emptyHint =
        templates.length === 0
          ? `No ${meta.title.toLowerCase()} templates yet. ${manage ? `Create one with "${meta.newLabel}".` : 'Ask an admin to create templates.'}`
          : '';
      const rows =
        templates.length === 0
          ? `<tr><td colspan="8" class="hub-empty">${emptyHint}</td></tr>`
          : templates
              .map((t) => {
                const pub = t.published_version_number ? `v${t.published_version_number}` : '—';
                const draft = t.latest_draft_id ? statusBadge('draft') : '<span class="hub-sub">—</span>';
                const valState = t.published_version_number ? statusBadge('published') : t.latest_draft_id ? statusBadge('draft') : '—';
                const launch = launchStatusCell(t);
                const actions = [];
                if (t.current_published_version_id) {
                  actions.push(`<button type="button" class="hub-btn hub-btn-ghost tmpl-act-view-pub" data-template-id="${esc(t.id)}" data-version-id="${esc(t.current_published_version_id)}">View Published</button>`);
                }
                if (manage && t.latest_draft_id) {
                  actions.push(`<button type="button" class="hub-btn hub-btn-ghost tmpl-act-open-draft" data-template-id="${esc(t.id)}" data-version-id="${esc(t.latest_draft_id)}">Open Draft</button>`);
                }
                if (manage && t.current_published_version_id) {
                  actions.push(`<button type="button" class="hub-btn hub-btn-ghost tmpl-act-clone" data-template-id="${esc(t.id)}">Clone to Draft</button>`);
                  if (t.latest_draft_id) {
                    actions.push(`<button type="button" class="hub-btn hub-btn-primary tmpl-act-publish" data-template-id="${esc(t.id)}" data-version-id="${esc(t.latest_draft_id)}">Publish Draft</button>`);
                  }
                }
                actions.push(`<button type="button" class="hub-btn hub-btn-ghost tmpl-act-versions" data-template-id="${esc(t.id)}">View Versions</button>`);
                if (manage && t.status === 'active') {
                  actions.push(`<button type="button" class="hub-btn hub-btn-ghost tmpl-act-archive" data-template-id="${esc(t.id)}">Archive</button>`);
                }
                return `<tr data-template-row="${esc(t.id)}">
                  <td><strong>${esc(t.name)}</strong>${manage ? formMetadataDetailsHtml(t) : ''}</td>
                  <td>${statusBadge(t.status)}</td>
                  <td>${esc(pub)}</td>
                  <td>${draft}</td>
                  <td>${valState}</td>
                  <td>${launch}</td>
                  <td style="font-size:0.78rem;color:var(--hub-muted)">${fmtDate(t.updated_at)}</td>
                  <td><div class="tmpl-actions">${actions.join('')}</div></td>
                </tr>`;
              })
              .join('');

      _root.innerHTML = `
        ${renderContextBanner()}
        <div class="hub-panel tmpl-panel">
          <div class="hub-panel-head">
            <div>
              <h2>${esc(meta.title)} templates</h2>
              <p class="hub-sub" style="margin:4px 0 0">Showing templates assigned to the <strong>${esc(space)}</strong> space only.</p>
            </div>
            <div class="hub-settings-actions">
              ${manage ? `<button type="button" class="hub-btn hub-btn-primary" id="tmplNewBtn">${esc(meta.newLabel)}</button>` : '<span class="hub-sub">View only — admin required to edit</span>'}
            </div>
          </div>
          <div class="hub-panel-body">
            <div class="hub-table-wrap">
              <table class="hub-table tmpl-table">
                <thead><tr>
                  <th>Template</th><th>Status</th><th>Published</th><th>Draft</th><th>Publish state</th><th>Launch</th><th>Updated</th><th>Actions</th>
                </tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </div>
        </div>
        <div id="tmplModalHost"></div>`;

      if (manage) _root.querySelector('#tmplNewBtn')?.addEventListener('click', () => openNewTemplateModal());
      wireRegistryActions();
    } catch (err) {
      _root.innerHTML = renderApiErrorPanel(err, 'Form & workflow templates');
      _root.querySelector('#tmplRetryBtn')?.addEventListener('click', () => renderRegistry());
      _root.querySelector('#tmplNewBtnRetry')?.addEventListener('click', () => openNewTemplateModal());
    }
  }

  function wireRegistryActions() {
    if (!_root) return;
    const manage = canManage();

    _root.querySelectorAll('.tmpl-act-view-pub, .tmpl-act-open-draft').forEach((btn) => {
      btn.addEventListener('click', () => {
        setRouteHash(['builder', btn.dataset.templateId, btn.dataset.versionId]);
        renderCurrentRoute();
      });
    });

    if (!manage) return;

    _root.querySelectorAll('.tmpl-act-clone').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const draft = await apiCloneDraft(btn.dataset.templateId);
          showToast('Draft cloned from published version', 'success');
          setRouteHash(['builder', btn.dataset.templateId, draft.id]);
          renderCurrentRoute();
        } catch (e) {
          showToast(e.message, 'error');
        }
      });
    });
    _root.querySelectorAll('.tmpl-act-publish').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const templateId =
            btn.dataset.templateId || btn.closest('[data-template-row]')?.getAttribute('data-template-row');
          if (templateId && getSpaceContext() === 'forms') {
            await ensureDefaultLaunchConfig(templateId);
          }
          await apiPublish(btn.dataset.versionId);
          showToast(getSpaceContext() === 'forms' ? 'Form published' : 'Template published', 'success');
          renderCurrentRoute();
        } catch (e) {
          if (e.validation) openValidationModal(e.validation);
          else showToast(e.message, 'error');
        }
      });
    });
    _root.querySelectorAll('.tmpl-act-archive').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Archive this form? It will no longer appear in New Request.')) return;
        try {
          await apiArchive(btn.dataset.templateId);
          showToast('Form archived', 'success');
          renderCurrentRoute();
        } catch (e) {
          showToast(e.message, 'error');
        }
      });
    });
    _root.querySelectorAll('.tmpl-act-delete-draft').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this draft form permanently? This cannot be undone.')) return;
        try {
          await apiDeleteDraft(btn.dataset.templateId);
          showToast('Draft deleted', 'success');
          renderCurrentRoute();
        } catch (e) {
          showToast(e.message, 'error');
        }
      });
    });
    _root.querySelectorAll('.tmpl-act-versions').forEach((btn) => {
      btn.addEventListener('click', () => openVersionsModal(btn.dataset.templateId));
    });
  }

  function openNewTemplateModal() {
    const host = _root.querySelector('#tmplModalHost');
    if (!host) return;
    const space = getSpaceContext();
    const meta = SPACE_META[space] || SPACE_META.workflows;
    const prefix = meta.newKeyPrefix || '';
    host.innerHTML = `
      <div class="tmpl-modal-backdrop" id="tmplModalBackdrop">
        <div class="tmpl-modal" role="dialog" aria-labelledby="tmplModalTitle">
          <div class="tmpl-modal-head">
            <h3 id="tmplModalTitle">${esc(meta.newLabel)}</h3>
            <button type="button" class="hub-btn hub-btn-ghost" id="tmplModalClose">×</button>
          </div>
          <div class="tmpl-modal-body">
            <div class="field"><label for="tmplNewName">Name</label><input class="input" id="tmplNewName" placeholder="Internal Approval" value="${esc(meta.defaultName)}" /></div>
            <div class="field"><label for="tmplNewKey">Key</label><input class="input mono" id="tmplNewKey" placeholder="${esc(prefix)}example" value="${esc(prefix)}" /></div>
            <div class="field"><label for="tmplNewDesc">Description</label><textarea class="input" id="tmplNewDesc" rows="2" placeholder="Optional description">${esc(defaultDescriptionForSpace(space, '') || '')}</textarea></div>
            ${
              space === 'forms'
                ? `<div class="field"><label for="tmplNewPreset">Starter preset</label>
              <select class="input" id="tmplNewPreset">
                <option value="general">General form (General Information + Details)</option>
                <option value="safety">Safety-style (Job / Hazard / PPE / Signatures)</option>
                <option value="checklist">Checklist (Details + Items)</option>
                <option value="inspection">Inspection (Details + Findings)</option>
              </select></div>`
                : `<p class="hub-sub">Space: <strong>${esc(space)}</strong> · starter sections and steps for this area.</p>`
            }
            ${space !== 'forms' ? '' : '<p class="hub-sub">Space: <strong>forms</strong> · choose a sectioned starter preset.</p>'}
          </div>
          <div class="tmpl-modal-foot">
            <button type="button" class="hub-btn hub-btn-ghost" id="tmplModalCancel">Cancel</button>
            <button type="button" class="hub-btn hub-btn-primary" id="tmplModalCreate">Create Draft</button>
          </div>
        </div>
      </div>`;
    const nameEl = host.querySelector('#tmplNewName');
    const keyEl = host.querySelector('#tmplNewKey');
    nameEl?.addEventListener('input', () => {
      if (keyEl && !keyEl.dataset.touched) {
        const base = slugKey(nameEl.value);
        keyEl.value = prefix + base.replace(new RegExp('^' + prefix), '');
      }
    });
    keyEl?.addEventListener('input', () => {
      keyEl.dataset.touched = '1';
    });
    const close = () => {
      host.innerHTML = '';
    };
    host.querySelector('#tmplModalClose')?.addEventListener('click', close);
    host.querySelector('#tmplModalCancel')?.addEventListener('click', close);
    host.querySelector('#tmplModalBackdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'tmplModalBackdrop') close();
    });
    host.querySelector('#tmplModalCreate')?.addEventListener('click', async () => {
      const name = nameEl?.value?.trim();
      const key = keyEl?.value?.trim();
      if (!name || !key) {
        showToast('Name and key are required', 'error');
        return;
      }
      try {
        const preset = host.querySelector('#tmplNewPreset')?.value || 'general';
        const starter = starterForSpace(space, preset === 'general' ? null : preset);
        const description = defaultDescriptionForSpace(
          space,
          host.querySelector('#tmplNewDesc')?.value?.trim() || null
        );
        const result = await apiCreateTemplate({
          name,
          key,
          description,
          template_kind: space === 'documents' ? 'document' : space === 'workflows' ? 'workflow' : 'form',
          ...starter,
        });
        await apiSaveLaunchConfig(result.template.id, {
          enabled: space === 'forms',
          space_key: space === 'forms' ? 'forms' : space,
          label: name,
          description,
          quick_action_enabled: space === 'forms',
          visibility_mode: 'everyone',
          visible_to_roles: [],
          route_type: 'template_runtime_placeholder',
        });
        close();
        showToast('Template created', 'success');
        setRouteHash(['builder', result.template.id, result.draftVersion.id]);
        renderCurrentRoute();
      } catch (e) {
        showToast(e.message, 'error');
      }
    });
    nameEl?.focus();
  }

  async function openVersionsModal(templateId) {
    const host = _root.querySelector('#tmplModalHost') || _root;
    host.insertAdjacentHTML('beforeend', '<div class="hub-loading tmpl-modal-loading">Loading versions…</div>');
    try {
      const data = await apiGetTemplate(templateId);
      const versions = data.versions || [];
      const manage = canManage();
      const rows = versions
        .map((v) => {
          const acts = [`<button type="button" class="hub-btn hub-btn-ghost tmpl-ver-open" data-version-id="${esc(v.id)}" data-template-id="${esc(templateId)}">Open</button>`];
          if (manage && v.status === 'draft') {
            acts.push(`<button type="button" class="hub-btn hub-btn-primary tmpl-ver-publish" data-version-id="${esc(v.id)}">Publish</button>`);
          }
          if (manage && v.status === 'published') {
            acts.push(`<button type="button" class="hub-btn hub-btn-ghost tmpl-ver-clone" data-template-id="${esc(templateId)}">Clone to Draft</button>`);
            acts.push(`<button type="button" class="hub-btn hub-btn-ghost tmpl-ver-retire" data-version-id="${esc(v.id)}">Retire</button>`);
          }
          const val = v.validation_json?.ok ? 'Valid at publish' : v.status === 'draft' ? 'Not published' : '—';
          return `<tr>
            <td>${v.version_number != null ? 'v' + esc(v.version_number) : '—'}</td>
            <td>${statusBadge(v.status)}</td>
            <td style="font-size:0.78rem">${fmtDate(v.created_at)}</td>
            <td style="font-size:0.78rem">${fmtDate(v.published_at)}</td>
            <td style="font-size:0.78rem">${fmtDate(v.retired_at)}</td>
            <td style="font-size:0.78rem">${esc(val)}</td>
            <td><div class="tmpl-actions">${acts.join('')}</div></td>
          </tr>`;
        })
        .join('');
      host.querySelector('.tmpl-modal-loading')?.remove();
      host.insertAdjacentHTML(
        'beforeend',
        `<div class="tmpl-modal-backdrop" id="tmplVersionsBackdrop">
          <div class="tmpl-modal tmpl-modal-wide" role="dialog">
            <div class="tmpl-modal-head"><h3>Versions — ${esc(data.template.name)}</h3><button type="button" class="hub-btn hub-btn-ghost" id="tmplVersionsClose">×</button></div>
            <div class="tmpl-modal-body"><table class="hub-table"><thead><tr><th>Ver</th><th>Status</th><th>Created</th><th>Published</th><th>Retired</th><th>Validation</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="7">No versions</td></tr>'}</tbody></table></div>
          </div></div>`
      );
      const close = () => host.querySelector('#tmplVersionsBackdrop')?.remove();
      host.querySelector('#tmplVersionsClose')?.addEventListener('click', close);
      host.querySelector('#tmplVersionsBackdrop')?.addEventListener('click', (e) => {
        if (e.target.id === 'tmplVersionsBackdrop') close();
      });
      host.querySelectorAll('.tmpl-ver-open').forEach((btn) => {
        btn.addEventListener('click', () => {
          close();
          setRouteHash(['builder', btn.dataset.templateId, btn.dataset.versionId]);
          renderCurrentRoute();
        });
      });
      host.querySelectorAll('.tmpl-ver-publish').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            if (getSpaceContext() === 'forms') {
              await ensureDefaultLaunchConfig(templateId, data.template?.name);
            }
            await apiPublish(btn.dataset.versionId);
            showToast('Published', 'success');
            close();
            renderCurrentRoute();
          } catch (e) {
            if (e.validation) openValidationModal(e.validation);
            else showToast(e.message, 'error');
          }
        });
      });
      host.querySelectorAll('.tmpl-ver-clone').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            const draft = await apiCloneDraft(btn.dataset.templateId);
            close();
            setRouteHash(['builder', btn.dataset.templateId, draft.id]);
            renderCurrentRoute();
          } catch (e) {
            showToast(e.message, 'error');
          }
        });
      });
      host.querySelectorAll('.tmpl-ver-retire').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Retire this published version?')) return;
          try {
            await apiRetire(btn.dataset.versionId);
            showToast('Version retired', 'success');
            close();
            renderCurrentRoute();
          } catch (e) {
            showToast(e.message, 'error');
          }
        });
      });
    } catch (e) {
      host.querySelector('.tmpl-modal-loading')?.remove();
      showToast(e.message, 'error');
    }
  }

  function openValidationModal(validation) {
    const host = _root.querySelector('#tmplModalHost') || _root;
    host.insertAdjacentHTML(
      'beforeend',
      `<div class="tmpl-modal-backdrop" id="tmplValBackdrop">
        <div class="tmpl-modal" role="dialog"><div class="tmpl-modal-head"><h3>Validation errors</h3><button type="button" class="hub-btn hub-btn-ghost" id="tmplValClose">×</button></div>
        <div class="tmpl-modal-body">${renderValidationPanel(validation)}</div></div></div>`
    );
    const close = () => host.querySelector('#tmplValBackdrop')?.remove();
    host.querySelector('#tmplValClose')?.addEventListener('click', close);
    host.querySelector('#tmplValBackdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'tmplValBackdrop') close();
    });
  }

  async function renderBuilder(templateId, versionId) {
    if (!_root) return;
    const manage = canManage();
    _root.innerHTML = '<div class="hub-loading">Loading builder…</div>';
    try {
      await ensureWorkflowRolesLoaded();
      const data = await apiGetVersion(versionId);
      const { template, version } = data;
      const readOnly = version.status !== 'draft' || !manage;
      const sections = normalizeSections(version.schema_json);
      const steps = normalizeSteps(version.workflow_json);
      const fieldKeys = sb().flattenFieldKeys(sections);
      const templateKind = getTemplateKind(template);
      const isWorkflow = templateKind === 'workflow';

      _builderState = {
        templateId,
        versionId,
        readOnly,
        sections,
        steps,
        template,
        version,
        bindingMode: 'none',
      };
      _builderTab = 'edit';
      _studioTab = 'build';

      let launchConfig = {};
      let bindingState = { binding: null, binding_mode: 'none' };
      let workflowTemplates = [];
      try {
        const lc = await apiGetLaunchConfig(templateId);
        launchConfig = lc.launch_config || {};
      } catch {
        launchConfig = { space_key: defaultLaunchSpaceKey(), label: template.name };
      }
      if (isBindableTemplate(template)) {
        try {
          bindingState = await apiGetBinding(templateId);
          _builderState.bindingMode = bindingState.binding_mode || 'none';
        } catch {
          bindingState = { binding: null, binding_mode: 'none' };
        }
        try {
          workflowTemplates = await apiListWorkflowTemplates();
        } catch {
          workflowTemplates = [];
        }
      }

      const showBinding = isBindableTemplate(template);
      const sectionsHtml = renderSectionsBuilder(sections, readOnly, templateKind, { splitPreview: !isWorkflow });
      const stepsHtml = renderStepsSection(steps, fieldKeys, readOnly);
      const bindingHtml = showBinding ? renderWorkflowBindingSection(bindingState, workflowTemplates, readOnly) : '';
      const workflowPaneHtml = isWorkflow ? stepsHtml + sectionsHtml : stepsHtml + bindingHtml;
      const buildPaneHtml = isWorkflow ? sectionsHtml : sectionsHtml;

      _builderState.launchConfig = launchConfig;

      _root.innerHTML = `
        <div id="tmplModalHost"></div>
        <div class="hub-panel tmpl-panel tmpl-studio">
          <div class="hub-panel-head tmpl-studio-head">
            <div class="tmpl-studio-title-block">
              <button type="button" class="hub-btn hub-btn-ghost" id="tmplBackBtn">← Forms</button>
              <h2 class="tmpl-studio-title">${esc(template.name)}</h2>
              <div class="tmpl-studio-badges">
                <span class="tmpl-kind-pill">${esc(templateKind)}</span>
                ${statusBadge(version.status)}
                ${version.version_number != null ? `<span class="tmpl-badge">v${esc(version.version_number)}</span>` : ''}
              </div>
              <p class="hub-sub mono tmpl-studio-key">${esc(template.key)}</p>
            </div>
            <div class="tmpl-builder-actions">
              ${!readOnly ? '<button type="button" class="hub-btn hub-btn-secondary" id="tmplSaveBtn">Save</button><button type="button" class="hub-btn hub-btn-secondary" id="tmplValidateBtn">Validate</button><button type="button" class="hub-btn hub-btn-primary" id="tmplPublishBtn">Publish</button><button type="button" class="hub-btn hub-btn-ghost" id="tmplPreviewTabBtn">Full preview</button><button type="button" class="hub-btn hub-btn-ghost" id="tmplSettingsTabBtn">Settings</button>' : '<span class="hub-sub">Read-only — clone to draft to edit</span>'}
            </div>
          </div>
          ${renderStudioTabBar(_studioTab)}
          <div class="hub-panel-body tmpl-studio-body">
            ${readOnly ? '<div class="tmpl-readonly-banner">This version is read-only. Use <strong>Clone to Draft</strong> from the registry to make changes.</div>' : ''}
            <div class="tmpl-studio-pane tmpl-studio-pane-build" data-studio-pane="build" ${_studioTab !== 'build' ? 'hidden' : ''}>${buildPaneHtml}</div>
            <div class="tmpl-studio-pane" data-studio-pane="workflow" ${_studioTab !== 'workflow' ? 'hidden' : ''}>${workflowPaneHtml}</div>
            <div class="tmpl-studio-pane" data-studio-pane="preview" ${_studioTab !== 'preview' ? 'hidden' : ''}><div id="tmplPreviewPane"></div></div>
            <div class="tmpl-studio-pane" data-studio-pane="settings" ${_studioTab !== 'settings' ? 'hidden' : ''}>
              ${renderLaunchSettingsSection(launchConfig, template.name, readOnly, template)}
              <section class="tmpl-editor-section" id="tmplValidationSection">
                <h3>Validation</h3>
                <div id="tmplValidationResults"><p class="hub-sub">Run Validate before publish.</p></div>
              </section>
              ${version.compiled_workflow_json ? `<details class="tmpl-advanced-json" hidden><summary>Internal routing contract</summary><pre class="tmpl-json-preview">${esc(JSON.stringify(version.compiled_workflow_json, null, 2))}</pre></details>` : ''}
            </div>
            <div class="tmpl-studio-pane" data-studio-pane="advanced" ${_studioTab !== 'advanced' ? 'hidden' : ''}>
              <details class="tmpl-advanced-json">
                <summary>Advanced JSON</summary>
                <p class="hub-sub">Structured builder is primary. Paste sectioned schema JSON here only when needed.</p>
                <textarea id="tmplAdvancedJsonStudio" class="tmpl-json-editor" rows="14"></textarea>
                ${readOnly ? '' : '<button type="button" class="hub-btn hub-btn-secondary hub-btn-sm" id="tmplApplyJsonStudioBtn">Apply JSON to builder</button>'}
                <p id="tmplAdvancedJsonStudioStatus" class="hub-settings-status" hidden></p>
              </details>
            </div>
          </div>
        </div>`;

      wireSectionBuilderEvents();
      refreshPreviewPane();
      refreshAdvancedJsonPane();

      _root.querySelector('#tmplBackBtn')?.addEventListener('click', () => {
        _builderState = null;
        setRouteHash([]);
        renderCurrentRoute();
      });
      _root.querySelectorAll('.tmpl-studio-tab').forEach((btn) => {
        btn.addEventListener('click', () => setStudioTab(btn.dataset.studioTab));
      });
      _root.querySelector('#tmplPreviewTabBtn')?.addEventListener('click', () => setStudioTab('preview'));
      _root.querySelector('#tmplSettingsTabBtn')?.addEventListener('click', () => setStudioTab('settings'));

      if (!readOnly) {
        _root.querySelector('#tmplSaveBtn')?.addEventListener('click', async () => {
          try {
            const payload = syncBuilderStateFromDom();
            await apiSaveDraft(versionId, payload);
            showToast('Draft saved', 'success');
          } catch (e) {
            showToast(e.message, 'error');
          }
        });
        _root.querySelector('#tmplValidateBtn')?.addEventListener('click', async () => {
          try {
            const payload = syncBuilderStateFromDom();
            const result = await apiValidate(versionId, payload);
            _root.querySelector('#tmplValidationResults').innerHTML = renderValidationPanel(result);
            wireValidationGoto();
            setStudioTab('settings');
          } catch (e) {
            showToast(e.message, 'error');
          }
        });
        _root.querySelector('#tmplPublishBtn')?.addEventListener('click', async () => {
          try {
            const payload = syncBuilderStateFromDom();
            await apiSaveDraft(versionId, payload);
            if (!readOnly) {
              await saveLaunchConfigFromDom(templateId, launchConfig);
            }
            await apiPublish(versionId);
            showToast('Published successfully', 'success');
            renderBuilder(templateId, versionId);
          } catch (e) {
            if (e.validation) {
              _root.querySelector('#tmplValidationResults').innerHTML = renderValidationPanel(e.validation);
              wireValidationGoto();
              setStudioTab('settings');
            }
            showToast(e.message, 'error');
          }
        });
        _root.querySelector('#tmplLaunchSaveBtn')?.addEventListener('click', async () => {
          const statusEl = _root.querySelector('#tmplLaunchStatus');
          try {
            if (statusEl) {
              statusEl.hidden = false;
              statusEl.textContent = 'Saving…';
              statusEl.className = 'hub-settings-status is-loading';
            }
            const saved = await saveLaunchConfigFromDom(templateId, launchConfig);
            _builderState.launchConfig = saved;
            if (statusEl) {
              statusEl.textContent = 'Availability saved';
              statusEl.className = 'hub-settings-status is-success';
            }
            showToast('Availability saved', 'success');
          } catch (e) {
            if (statusEl) {
              statusEl.textContent = e.message;
              statusEl.className = 'hub-settings-status is-error';
            }
            showToast(e.message, 'error');
          }
        });
        _root.querySelectorAll('input[name="tmplVisibilityMode"]').forEach((radio) => {
          radio.addEventListener('change', () => {
            const wrap = _root.querySelector('#tmplLaunchRolesWrap');
            if (!wrap) return;
            wrap.hidden = radio.value !== 'specific';
          });
        });
        _root.querySelector('#tmplBindingSaveBtn')?.addEventListener('click', async () => {
          const statusEl = _root.querySelector('#tmplBindingStatus');
          const mode = _root.querySelector('#tmplBindingMode')?.value || 'none';
          const workflowId = _root.querySelector('#tmplBindingWorkflow')?.value || '';
          try {
            if (statusEl) {
              statusEl.hidden = false;
              statusEl.textContent = 'Saving binding…';
              statusEl.className = 'hub-settings-status is-loading';
            }
            if (mode !== 'none' && !workflowId) {
              throw new Error('Select a published workflow template or set mode to None');
            }
            await apiSaveBinding(templateId, {
              binding_mode: mode,
              workflow_template_id: mode === 'none' ? null : workflowId,
              source_space_key: launchConfig.space_key || defaultLaunchSpaceKey(),
            });
            if (statusEl) {
              statusEl.textContent = 'Workflow binding saved';
              statusEl.className = 'hub-settings-status is-success';
            }
            showToast('Workflow binding saved', 'success');
            renderBuilder(templateId, versionId);
          } catch (e) {
            if (statusEl) {
              statusEl.textContent = e.message;
              statusEl.className = 'hub-settings-status is-error';
            }
            showToast(e.message, 'error');
          }
        });
        _root.querySelector('#tmplBindingRemoveBtn')?.addEventListener('click', async () => {
          try {
            await apiDeleteBinding(templateId);
            showToast('Workflow binding removed', 'success');
            renderBuilder(templateId, versionId);
          } catch (e) {
            showToast(e.message, 'error');
          }
        });
      }
    } catch (err) {
      _builderState = null;
      _root.innerHTML = renderApiErrorPanel(err, 'Template builder') + `<div style="margin-top:12px"><button type="button" class="hub-btn hub-btn-ghost" id="tmplBackErr">← ${getSpaceContext() === 'forms' ? 'Forms' : 'Templates'}</button></div>`;
      _root.querySelector('#tmplRetryBtn')?.addEventListener('click', () => renderBuilder(templateId, versionId));
      _root.querySelector('#tmplBackErr')?.addEventListener('click', () => {
        setRouteHash([]);
        renderCurrentRoute();
      });
    }
  }

  function renderCurrentRoute() {
    const segs = _route.segments || [];
    if (segs[0] === 'builder' && segs[1] && segs[2]) {
      renderBuilder(segs[1], segs[2]);
    } else if (getSpaceContext() === 'forms') {
      _builderState = null;
      renderFormsHub();
    } else {
      _builderState = null;
      renderRegistry();
    }
  }

  async function init(root, route) {
    _root = root;
    const spaceFromRoute =
      route?.space ||
      (route?.query?.type === 'document' ? 'documents' : null) ||
      route?.query?.space ||
      'workflows';
    _route = {
      space: TEMPLATE_SPACES.includes(spaceFromRoute) ? spaceFromRoute : 'workflows',
      segments: route?.segments || [],
      query: { ...(route?.query || {}), space: spaceFromRoute },
    };
    updateWorkflowPageHead();
    if (!canManage() && _route.space !== 'forms' && global.RbacClient && !global.RbacClient.isPortalNoAuthMode()) {
      const tab = spaceToHubTab(_route.space);
      const allowed = global.RbacClient.canAccessHubTab(perms(), tab);
      if (!allowed) {
        root.innerHTML = '<div class="hub-empty">You do not have access to template authoring.</div>';
        return;
      }
    }
    renderCurrentRoute();
  }

  function applyRoute(segments, query, space) {
    const resolvedSpace =
      space ||
      query?.space ||
      (query?.type === 'document' ? 'documents' : null) ||
      _route.space ||
      'workflows';
    _route = {
      space: TEMPLATE_SPACES.includes(resolvedSpace) ? resolvedSpace : 'workflows',
      segments: segments || [],
      query: { ...(query != null ? query : _route.query || {}), space: resolvedSpace },
    };
    updateWorkflowPageHead();
    if (_root) renderCurrentRoute();
  }

  global.TemplateRegistryUI = {
    init,
    applyRoute,
    NEW_TEMPLATE_STARTER,
    _test: {
      slugKey,
      canManage,
      normalizeFields,
      normalizeSections,
      normalizeSteps,
      buildPayload,
      buildPayloadFromState,
      moveItem,
      readSectionsFromDom,
      starterForSpace,
      hubApiPath: (p) => p,
      isDocumentTemplate,
      isFormTemplate,
      isWorkflowTemplate,
      getTemplateSpace,
      getSpaceContext,
      filterTemplatesForContext,
      getTemplateKind,
      isBindableTemplate,
      spaceToHubTab,
      launchStatusCell,
      breadcrumbHtml,
      canDeleteDraftTemplate,
      filterFormsManageTemplates,
      applyFormsManageFilters,
      isFormAvailable,
      hasWorkflowAttached,
      formManageStatusLabel,
      workflowStatusCell,
      formMetadataDetailsHtml,
      assigneeRoleSelectOptions,
      renderVisibilityRoleCheckboxes,
      readLaunchConfigFromDom,
      launchRoleOptionsForUi,
      ensureDefaultLaunchConfig,
      TEMPLATE_SPACES,
      DOCUMENT_TAG,
      FORM_TAG,
      FORM_TEMPLATE_STARTER,
      SAFETY_FORM_STARTER,
      DOCUMENT_TEMPLATE_STARTER,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TemplateRegistryUI: global.TemplateRegistryUI };
  }
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
