/**
 * Operations Workflow Hub — operational UI + registry-driven document types.
 * API: /api/maintainx?path=/hub/...
 * Registry: GET /hub/registry/document-types
 * Forms: HubFormRenderer (schema) or custom portal_tab (SWP, JSA, BOL, etc.)
 */
(function (global) {
  'use strict';

  const STATUS_LABELS = {
    submitted: 'Submitted',
    received: 'Received',
    in_review: 'In review',
    waiting_on_internal_review: 'Waiting on internal review',
    waiting_on_client_review: 'Waiting on client',
    waiting_on_signature: 'Waiting on client signature',
    waiting_on_approval: 'Waiting on approval',
    approved: 'Approved',
    sent_to_maintainx: 'Queued for MaintainX',
    maintainx_in_progress: 'MaintainX in progress',
    waiting_on_parts: 'Waiting on parts',
    in_progress: 'In progress',
    completed: 'Completed',
    closed: 'Closed',
    rejected: 'Rejected',
    canceled: 'Canceled',
    failed_sync: 'MaintainX sync failed',
  };

  const CATEGORY_LABELS = {
    operations: 'Operations',
    safety: 'Safety',
    logistics: 'Logistics',
    documents: 'Documents',
    general: 'General',
    published_forms: 'Published forms',
  };

  const HUB_NATIVE_TABS = [
    'hub-dashboard',
    'hub-analytics',
    'hub-requests',
    'hub-request-detail',
    'hub-new-request',
    'hub-my-tasks',
    'hub-reports',
    'hub-settings',
    'hub-start-center',
    'hub-configuration',
    'hub-workflows',
    'hub-forms',
    'hub-documents',
    'hub-users',
    'hub-spaces',
    'hub-launch',
    'hub-submission',
    'hub-archive',
  ];

  const HUB_PAGE_META = {
    'hub-reports': {
      title: 'Reports',
      subtitle: 'Operational metrics across requests, workflows, documents, and MaintainX handoffs.',
    },
    'hub-analytics': {
      title: 'Analytics',
      subtitle: 'Trend analysis across requests, workflows, and cycle time.',
    },
    'hub-settings': {
      title: 'Settings',
      subtitle: 'Configure hub defaults, registry, integrations, and system health.',
    },
    'hub-start-center': {
      title: 'Start Center',
      subtitle: 'Learn how to run requests, forms, workflows, users, roles, and records in Streamline.',
    },
    'hub-configuration': {
      title: 'Configuration Center',
      subtitle: 'Configure request types, forms, documents, workflows, dashboards, and variables.',
    },
    'hub-workflows': {
      title: 'Workflows',
      subtitle: 'Reusable approval routes and routing templates. Attach to a form when building it.',
    },
    'hub-forms': {
      title: 'Forms',
      subtitle: 'Create reusable forms, publish for your team, and fill out published forms from one place.',
    },
    'hub-documents': {
      title: 'Documents',
      subtitle: 'Document-backed templates with upload, review, and sign steps.',
    },
    'hub-users': {
      title: 'User Management',
      subtitle: 'Manage hub users, roles, and permissions.',
    },
    'hub-spaces': {
      title: 'App Spaces',
      subtitle: 'Launch published templates from configurable app spaces.',
    },
    'hub-launch': {
      title: 'Launch',
      subtitle: 'Template launch entry.',
    },
    'hub-submission': {
      title: 'Submission',
      subtitle: 'Submitted form or document record.',
    },
    'hub-archive': {
      title: 'Archive',
      subtitle: 'Search and open archived JSA, BOL, work order, parts, and roll off swap records.',
    },
  };

  const LEGACY_PANEL_IDS = {
    home: 'panel-home',
    parts: 'panel-parts',
    'work-order': 'panel-work-order',
    bol: 'panel-bol',
    jsa: 'panel-jsa',
    'jsa-archive': 'panel-jsa-archive',
    'bol-archive': 'panel-bol-archive',
    'parts-request-archive': 'panel-parts-request-archive',
    'work-order-archive': 'panel-work-order-archive',
    'forms-archive': 'panel-forms-archive',
    'roll-off-swap': 'panel-roll-off-swap',
    'roll-off-swap-archive': 'panel-roll-off-swap-archive',
    swp: 'panel-swp',
    management: 'panel-management',
  };

  const LEGACY_PANEL_META = {
    home: {
      title: 'Reports',
      subtitle: 'Operational reports and quick links across the portal.',
      breadcrumb: ['Operations Hub', 'Reports'],
    },
    parts: {
      title: 'Parts Request',
      subtitle: 'Submit a request to the parts team with photos and line-item detail.',
      breadcrumb: ['Operations Hub', 'Forms', 'Parts Request'],
    },
    'work-order': {
      title: 'Work Order Request',
      subtitle: 'Create and route work orders through MaintainX and internal review.',
      breadcrumb: ['Operations Hub', 'Forms', 'Work Order'],
    },
    bol: {
      title: 'BOL Generator',
      subtitle: 'Generate bill of lading documents for inbound equipment and materials.',
      breadcrumb: ['Operations Hub', 'Generators', 'BOL'],
    },
    jsa: {
      title: 'JSA Generator',
      subtitle: 'Build job safety analysis forms for field and shop work.',
      breadcrumb: ['Operations Hub', 'Generators', 'JSA'],
    },
    swp: {
      title: 'Safe Work Permits',
      subtitle: 'Create, review, and track safe work permits and live permit lists.',
      breadcrumb: ['Operations Hub', 'Safe Work Permits'],
    },
    'roll-off-swap': {
      title: 'Roll Off Swap',
      subtitle: 'Submit roll-off container swap requests for sites and yards.',
      breadcrumb: ['Operations Hub', 'Forms', 'Roll Off Swap'],
    },
    'jsa-archive': {
      title: 'JSA Archive',
      subtitle: 'Search and open archived job safety analysis records.',
      breadcrumb: ['Operations Hub', 'Archives', 'JSA'],
    },
    'bol-archive': {
      title: 'BOL Archive',
      subtitle: 'Search and open archived bills of lading.',
      breadcrumb: ['Operations Hub', 'Archives', 'BOL'],
    },
    'parts-request-archive': {
      title: 'Parts Request Archive',
      subtitle: 'Browse submitted parts requests and open prior submissions.',
      breadcrumb: ['Operations Hub', 'Archives', 'Parts Requests'],
    },
    'work-order-archive': {
      title: 'Work Order Archive',
      subtitle: 'Browse submitted work orders and historical MaintainX handoffs.',
      breadcrumb: ['Operations Hub', 'Archives', 'Work Orders'],
    },
    'roll-off-swap-archive': {
      title: 'Roll Off Swap Archive',
      subtitle: 'Browse completed roll-off swap submissions.',
      breadcrumb: ['Operations Hub', 'Archives', 'Roll Off Swap'],
    },
    management: {
      title: 'Management',
      subtitle: 'Vendor, user, role, SSO, and integrations administration.',
      breadcrumb: ['Operations Hub', 'Admin'],
    },
  };

  const MGMT_SECTION_TITLES = {
    vendor: 'Vendor Management',
    user: 'User Management',
    role: 'Role Management',
  };

  let mountedLegacyTab = null;

  const BOTTLENECK_LABELS = {
    sent_to_maintainx: 'MaintainX Queue',
    maintainx_in_progress: 'MaintainX In Progress',
    waiting_on_signature: 'Client Signature',
    waiting_on_client_review: 'Client Review',
    waiting_on_internal_review: 'Internal Review',
    failed_sync: 'Failed Sync',
    in_review: 'In Review',
  };

  let hubPermissions = [];
  let selectedRequestId = null;
  let registryCache = null;
  let activeQuickFilter = 'open';
  let inspectorRequestId = null;
  let lastDashboardSummary = null;

  function hubFetch(path, init) {
    if (typeof global.proxyFetch !== 'function') {
      return Promise.reject(new Error('proxyFetch not available'));
    }
    return global.proxyFetch(path, init);
  }

  function hasPerm(id) {
    if (global.RbacClient && global.RbacClient.isPortalNoAuthMode()) return true;
    if (global.RbacClient) return global.RbacClient.hasPerm(hubPermissions, id);
    return hubPermissions.includes(id) || hubPermissions.includes('admin') || hubPermissions.includes('hub_admin');
  }

  function applyHubNavPermissions() {
    if (!global.RbacClient) return;
    global.RbacClient.applyNav(document, hubPermissions);
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

  function chipStatus(status) {
    const label = STATUS_LABELS[status] || (status || '').replace(/_/g, ' ');
    return `<span class="hub-chip status-${esc(status)}">${esc(label)}</span>`;
  }

  function chipAging(aging) {
    if (!aging) return '';
    const label = aging.label || aging.bucket || '';
    return `<span class="hub-chip aging-${esc(aging.bucket)}">${esc(label)}</span>`;
  }

  function initials(nameOrEmail) {
    const s = (nameOrEmail || '').trim();
    if (!s) return '?';
    if (s.includes('@')) {
      const local = s.split('@')[0];
      const parts = local.split(/[._-]+/).filter(Boolean);
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
      return local.slice(0, 2).toUpperCase();
    }
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return s.slice(0, 2).toUpperCase();
  }

  function ownerCell(name) {
    const label = name || 'Unassigned';
    return `<span class="hub-cell-owner"><span class="hub-avatar" aria-hidden="true">${esc(initials(label))}</span><span>${esc(label)}</span></span>`;
  }

  function typeIcon(key) {
    const icons = {
      work_order: '🔧',
      parts_request: '📦',
      document_review: '📄',
      document_signature: '✍️',
      generator_bol: '⚡',
      swp: '🛡️',
    };
    return icons[key] || '📋';
  }

  function formatDate(iso, short) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (short) {
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      }
      return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }

  function typeLabel(key, registry) {
    const t = registry?.find((d) => d.key === key);
    return t ? t.label : key;
  }

  async function loadPermissionsFromMe() {
    try {
      const r = await hubFetch('/me');
      const data = await r.json();
      hubPermissions = data.permissions || [];
      if (data.ssoEnforced === false || (global.RbacClient && global.RbacClient.isPortalNoAuthMode())) {
        global._portalNoAuth = true;
        if (global.RbacClient) global.RbacClient.enablePortalNoAuthMode();
      }
      global._hubUserEmail = data.email || global._hubUserEmail;
      global._hubUserDisplayName = data.displayName || data.name || '';
      global._hubUserRole = data.role || (Array.isArray(data.role_keys) ? data.role_keys[0] : '') || '';
      if (
        Array.isArray(data.permissions) &&
        (data.permissions.includes('hub_admin') || data.permissions.includes('admin')) &&
        !global._hubUserRole
      ) {
        global._hubUserRole = data.permissions.includes('hub_admin') ? 'hub_admin' : 'admin';
      }
    } catch {
      hubPermissions = [];
    }
  }

  async function fetchRegistry() {
    if (registryCache) return registryCache;
    const r = await hubFetch('/hub/registry/document-types');
    if (!r.ok) throw new Error('Could not load document registry');
    const data = await r.json();
    registryCache = (data.document_types || []).filter((d) => d.enabled);
    populateTypeFilter(registryCache);
    return registryCache;
  }

  function populateTypeFilter(types) {
    const sel = document.getElementById('hubFilterType');
    if (!sel || sel.dataset.registryWired) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">All types</option>';
    types.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.key;
      opt.textContent = t.label;
      sel.appendChild(opt);
    });
    sel.value = current;
    sel.dataset.registryWired = '1';
  }

  async function fetchFormDefinition(key) {
    const r = await hubFetch(`/hub/registry/form-definitions/${encodeURIComponent(key)}`);
    if (!r.ok) return null;
    const data = await r.json();
    return data.form_definition;
  }

  async function fetchDashboardSummary() {
    const r = await hubFetch('/hub/dashboard/summary');
    if (!r.ok) throw new Error('Dashboard unavailable');
    return r.json();
  }

  async function fetchActionRequired() {
    const r = await hubFetch('/hub/dashboard/action-required');
    if (!r.ok) return { items: [] };
    return r.json();
  }

  async function fetchOpenRequests(params) {
    const qs = new URLSearchParams(params || {}).toString();
    const r = await hubFetch(`/hub/requests?${qs}`);
    if (!r.ok) throw new Error('Request queue unavailable');
    return r.json();
  }

  async function fetchRequestDetail(id) {
    const r = await hubFetch(`/hub/requests/${encodeURIComponent(id)}`);
    if (r.status === 403) throw new Error('You do not have access to this request');
    if (r.status === 404) throw new Error('Request not found');
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || 'Request load failed');
    }
    return r.json();
  }

  function canAccessHubTab(tabName) {
    if (global.RbacClient && global.RbacClient.isPortalNoAuthMode()) return true;
    if (!global.RbacClient) return true;
    return global.RbacClient.canAccessHubTab(hubPermissions, tabName);
  }

  function renderAccessRestricted(rootEl, title) {
    if (!rootEl) return;
    rootEl.innerHTML = `<div class="hub-access-restricted" role="status">
      <div class="hub-access-icon" aria-hidden="true">🔒</div>
      <h2>Access restricted</h2>
      <p>You do not have permission to view ${esc(title || 'this page')}. Contact an administrator if you need access.</p>
      <button type="button" class="hub-btn hub-btn-secondary" data-hub-tab="hub-dashboard">Back to Dashboard</button>
    </div>`;
    rootEl.querySelector('[data-hub-tab]')?.addEventListener('click', () => {
      if (typeof global.switchTab === 'function') global.switchTab('hub-dashboard');
    });
  }

  function renderHubPageHead(tabName) {
    const meta = HUB_PAGE_META[tabName];
    if (!meta) return '';
    return `<div class="hub-page-head">
      <div>
        <h1>${esc(meta.title)}</h1>
        <p class="hub-sub">${esc(meta.subtitle)}</p>
      </div>
    </div>`;
  }

  function shouldUseShell(tabName) {
    return HUB_NATIVE_TABS.includes(tabName) || !!LEGACY_PANEL_IDS[tabName];
  }

  async function fetchWorkflowTemplates() {
    const r = await hubFetch('/hub/registry/workflow-templates');
    if (!r.ok) throw new Error('Could not load workflow templates');
    const data = await r.json();
    return data.workflow_templates || [];
  }

  let myTasksFilter = 'all';
  let myTasksCache = null;

  async function fetchMyTasks() {
    const r = await hubFetch('/hub/my-tasks');
    if (!r.ok) throw new Error('Could not load tasks');
    return r.json();
  }

  async function fetchNotifications() {
    const r = await hubFetch('/hub/notifications');
    if (!r.ok) return { notifications: [], unread_count: 0 };
    return r.json();
  }

  function renderTaskSection(title, items, emptyMsg) {
    if (!items?.length) return `<div class="hub-panel"><div class="hub-panel-head"><h2>${esc(title)}</h2></div><div class="hub-panel-body pad"><p class="hub-empty" style="padding:8px">${esc(emptyMsg)}</p></div></div>`;
    return `<div class="hub-panel"><div class="hub-panel-head"><h2>${esc(title)}</h2><span>${items.length}</span></div><div class="hub-panel-body"><div class="hub-table-wrap"><table class="hub-table"><thead><tr><th>Request</th><th>Step</th><th>Type</th><th>Action</th></tr></thead><tbody>${items
      .map(({ request, step }) => {
        const act = step?.action_type || step?.step_type || '—';
        return `<tr data-open-request="${esc(request.id)}"><td class="mono">${esc(request.request_number)}</td><td>${esc(step?.step_title || request.title)}</td><td>${esc(typeLabel(request.request_type, registryCache))}</td><td><span class="hub-chip">${esc(act)}</span></td></tr>`;
      })
      .join('')}</tbody></table></div></div></div>`;
  }

  async function initMyTasks() {
    showHubPage('hub-my-tasks');
    setSidebarForTab('hub-my-tasks');
    const root = document.getElementById('hubMyTasksRoot');
    if (!root) return;
    root.innerHTML = '<div class="hub-loading">Loading your tasks…</div>';
    try {
      await fetchRegistry();
      myTasksCache = await fetchMyTasks();
      const t = myTasksCache;
      let sections = [];
      if (myTasksFilter === 'all' || myTasksFilter === 'fill') {
        sections.push(renderTaskSection('Forms to fill', t.fill, 'Nothing to fill right now.'));
      }
      if (myTasksFilter === 'all' || myTasksFilter === 'review') {
        sections.push(renderTaskSection('Documents to review', t.review, 'No reviews assigned.'));
      }
      if (myTasksFilter === 'all' || myTasksFilter === 'sign') {
        sections.push(renderTaskSection('Documents to sign', t.sign, 'No signatures pending.'));
      }
      if (myTasksFilter === 'all' || myTasksFilter === 'waiting') {
        sections.push(renderTaskSection('Waiting on me', t.waiting_on_me, 'Your queue is clear.'));
      }
      if (myTasksFilter === 'all' || myTasksFilter === 'others') {
        const others = (t.waiting_on_others || []).map((x) => ({
          request: x.request,
          step: x.steps?.[0] || { step_title: 'In progress', action_type: '—' },
        }));
        sections.push(renderTaskSection('Waiting on others', others, 'Nothing blocked on other people.'));
      }
      if (myTasksFilter === 'all' || myTasksFilter === 'client') {
        const client = (t.waiting_on_client || []).map((x) => ({
          request: x.request,
          step: x.steps?.[0] || { step_title: 'Client action', action_type: 'client' },
        }));
        sections.push(renderTaskSection('Waiting on client', client, 'Nothing waiting on clients.'));
      }
      if (myTasksFilter === 'all' || myTasksFilter === 'completed') {
        const done = (t.recently_completed || []).map((x) => ({
          request: x.request,
          step: { step_title: 'Completed', action_type: 'done' },
        }));
        sections.push(renderTaskSection('Recently completed', done, 'No recent completions.'));
      }

      // WOS-94 — configurable platform human tasks
      try {
        const cfgRes = await hubFetch('/hub/workflow-runtime/tasks');
        if (cfgRes.ok) {
          const cfgData = await cfgRes.json();
          const cfgTasks = cfgData.tasks || [];
          if (cfgTasks.length && (myTasksFilter === 'all' || myTasksFilter === 'waiting')) {
            const rows = cfgTasks
              .map((task) => {
                const title = task.task_type || 'Action needed';
                return `<tr data-cfg-task="${esc(task.id)}"><td class="mono">${esc(task.related_request_id || task.instance_id || '—')}</td><td>${esc(title)}</td><td>Configurable</td><td><span class="hub-chip">${esc(task.assigned_role || task.assigned_user_email || 'queue')}</span></td></tr>`;
              })
              .join('');
            sections.push(
              `<div class="hub-panel"><div class="hub-panel-head"><h2>Configurable workflow tasks</h2><span>${cfgTasks.length}</span></div><div class="hub-panel-body"><div class="hub-table-wrap"><table class="hub-table"><thead><tr><th>Request / instance</th><th>Action needed</th><th>Type</th><th>Assignment</th></tr></thead><tbody>${rows}</tbody></table></div></div></div>`
            );
          }
        }
      } catch {
        /* optional when flag off */
      }

      root.innerHTML = sections.join('');
      root.querySelectorAll('[data-open-request]').forEach((row) => {
        row.addEventListener('click', () => openRequestDetail(row.dataset.openRequest));
      });
      root.querySelectorAll('[data-cfg-task]').forEach((row) => {
        row.addEventListener('click', async () => {
          const taskId = row.dataset.cfgTask;
          if (!taskId) return;
          const outcome = prompt('Complete task outcome (default / approved / rejected)', 'default') || 'default';
          try {
            await hubFetch(`/hub/workflow-runtime/tasks/${encodeURIComponent(taskId)}/complete`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ outcome }),
            });
            initMyTasks();
          } catch (err) {
            alert(err.message || 'Could not complete task');
          }
        });
      });
    } catch (err) {
      root.innerHTML = `<div class="hub-empty">${esc(err.message)}</div>`;
    }
  }

  async function refreshNotifications() {
    const data = await fetchNotifications();
    const badge = document.getElementById('hubNotifBadge');
    const panel = document.getElementById('hubNotifPanel');
    const n = data.unread_count || 0;
    if (badge) {
      badge.hidden = n === 0;
      badge.textContent = n > 99 ? '99+' : String(n);
    }
    if (panel && !panel.hidden) {
      panel.innerHTML = (data.notifications || []).length
        ? data.notifications
            .map(
              (x) =>
                `<button type="button" class="hub-notif-item${x.read_at ? '' : ' is-unread'}" data-notif-id="${esc(x.id)}" data-notif-req="${esc(x.request_id || '')}"><strong>${esc(x.title)}</strong><span>${esc(x.message)}</span><time>${formatDate(x.created_at, true)}</time></button>`
            )
            .join('')
        : '<p class="hub-empty">No notifications</p>';
      panel.querySelectorAll('.hub-notif-item').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await hubFetch(`/hub/notifications/${btn.dataset.notifId}/read`, { method: 'POST' });
          if (btn.dataset.notifReq) openRequestDetail(btn.dataset.notifReq);
          panel.hidden = true;
          refreshNotifications();
        });
      });
    }
  }

  function wireNotifications() {
    const btn = document.getElementById('hubNotificationsBtn');
    const panel = document.getElementById('hubNotifPanel');
    if (!btn || btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!panel) return;
      panel.hidden = !panel.hidden;
      if (!panel.hidden) await refreshNotifications();
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#hubNotificationsBtn') && !e.target.closest('#hubNotifPanel')) {
        if (panel) panel.hidden = true;
      }
    });
    document.querySelectorAll('#hubMyTasksFilters .hub-qf[data-my-filter]').forEach((b) => {
      b.addEventListener('click', () => {
        myTasksFilter = b.dataset.myFilter;
        document.querySelectorAll('#hubMyTasksFilters .hub-qf').forEach((x) => {
          x.classList.toggle('is-active', x.dataset.myFilter === myTasksFilter);
        });
        initMyTasks();
      });
    });
    refreshNotifications();
    setInterval(refreshNotifications, 60000);
  }

  function updateInspectorVisibility(tabName) {
    const shell = document.getElementById('hubShell');
    const mainRow = shell?.querySelector('.hub-main-row');
    const inspector = document.getElementById('hubInspector');
    const show = inspectorTabs().includes(tabName);
    if (mainRow) mainRow.classList.toggle('hub-hide-inspector', !show);
    if (inspector && !show) inspector.classList.remove('is-open');
  }

  function inspectorTabs() {
    return ['hub-dashboard', 'hub-requests'];
  }

  function getLegacyPanelStash() {
    return document.getElementById('hubLegacyPanelStash');
  }

  /**
   * Hide and unmount all legacy panels from hub mount slots (preserves DOM in stash).
   */
  function clearLegacyMount() {
    const stash = getLegacyPanelStash();
    const content = document.getElementById('hubLegacyContent');
    const archiveSlot = document.getElementById('hubArchiveSlot');
    const usersMount = document.getElementById('hubUsersMount');
    const legacyMount = document.getElementById('hubLegacyMount');
    const legacyHeader = document.getElementById('hubLegacyHeader');
    const archiveContent = document.getElementById('hubArchiveContent');
    const mountSlots = [content, archiveSlot, archiveContent, usersMount].filter(Boolean);

    Object.values(LEGACY_PANEL_IDS).forEach((panelId) => {
      const panel = document.getElementById(panelId);
      if (!panel) return;
      panel.classList.remove('hub-legacy-active', 'hub-archive-embedded', 'is-active');
      panel.style.display = 'none';
    });

    mountSlots.forEach((slot) => {
      while (slot.firstChild) {
        const child = slot.firstChild;
        if (stash) stash.appendChild(child);
        else slot.removeChild(child);
      }
    });

    if (legacyMount) {
      legacyMount.hidden = true;
      legacyMount.classList.remove('is-active');
    }
    if (legacyHeader) legacyHeader.hidden = true;

    mountedLegacyTab = null;
  }

  function mountLegacyPanelInto(contentEl, tabName, opts = {}) {
    const panelId = LEGACY_PANEL_IDS[tabName];
    const panel = panelId ? document.getElementById(panelId) : null;
    if (!panel || !contentEl) {
      console.warn('[hub] legacy panel mount failed:', tabName);
      return false;
    }

    Object.values(LEGACY_PANEL_IDS).forEach((id) => {
      const el = document.getElementById(id);
      if (!el || el === panel) return;
      el.classList.remove('hub-legacy-active', 'hub-archive-embedded', 'is-active');
      el.style.display = 'none';
    });

    panel.classList.add('hub-legacy-panel', 'hub-legacy-active');
    panel.classList.remove('hub-archive-embedded');
    panel.style.display = '';
    if (panel.parentElement !== contentEl) contentEl.appendChild(panel);
    mountedLegacyTab = tabName;
    if (tabName === 'management' && opts.mgmtSection && typeof global.mgmtPrepareHubSection === 'function') {
      global.mgmtPrepareHubSection(opts.mgmtSection);
    }
    return true;
  }

  function setSidebarForTab(tabName, opts = {}) {
    document.querySelectorAll('#hubSidebarNav .hub-nav-link').forEach((el) => {
      const hubTab = el.dataset.hubTab;
      const portalTab = el.dataset.portalTab;
      const mgmt = el.dataset.mgmtSection;
      let active = false;
      if (hubTab && hubTab === tabName) active = true;
      if (portalTab && portalTab === tabName) {
        if (tabName === 'management' && mgmt) {
          active = (opts.mgmtSection || 'vendor') === mgmt;
        } else if (tabName !== 'management') {
          active = true;
        }
      }
      if (tabName === 'hub-request-detail' && hubTab === 'hub-requests') active = true;
      el.classList.toggle('is-active', active);
    });
  }

  function showHubPage(tabName) {
    const shell = document.getElementById('hubShell');
    if (!shell) return;
    const legacyMount = document.getElementById('hubLegacyMount');
    const legacyHeader = document.getElementById('hubLegacyHeader');
    document.querySelectorAll('.hub-page[data-hub-page]').forEach((p) => {
      if (p.id === 'hubLegacyMount' || p.id === 'hubLegacyPanelStash') return;
      const isActive = p.dataset.hubPage === tabName;
      p.hidden = !isActive;
      p.classList.toggle('is-active', isActive);
    });
    if (legacyMount) {
      legacyMount.hidden = true;
      legacyMount.classList.remove('is-active');
    }
    if (legacyHeader) legacyHeader.hidden = true;
    updateInspectorVisibility(tabName);
  }

  function updateLegacyShellHeader(tabName, opts = {}) {
    if (mountedLegacyTab === tabName) renderLegacyHeader(tabName, opts);
    setSidebarForTab(tabName, opts);
  }

  function renderLegacyHeader(tabName, opts = {}) {
    const header = document.getElementById('hubLegacyHeader');
    if (!header) return;
    const meta = LEGACY_PANEL_META[tabName] || { title: tabName, subtitle: '', breadcrumb: ['Operations Hub'] };
    let title = meta.title;
    let crumb = meta.breadcrumb.slice();
    if (tabName === 'management' && opts.mgmtSection) {
      title = MGMT_SECTION_TITLES[opts.mgmtSection] || meta.title;
      crumb = ['Operations Hub', 'Admin', title];
    }
    header.hidden = false;
    header.innerHTML = `
      <nav class="hub-legacy-crumb" aria-label="Breadcrumb">${crumb
        .map((c, i) =>
          i < crumb.length - 1
            ? `<span>${esc(c)}</span><span class="hub-legacy-crumb-sep">/</span>`
            : `<span class="hub-legacy-crumb-current">${esc(c)}</span>`
        )
        .join('')}</nav>
      <h1>${esc(title)}</h1>
      ${meta.subtitle ? `<p class="hub-sub">${esc(meta.subtitle)}</p>` : ''}
    `;
  }

  function renderLegacyPanelInHubShell(tabName, opts = {}) {
    const mount = document.getElementById('hubLegacyMount');
    const content = document.getElementById('hubLegacyContent');
    if (!mount || !content) {
      console.warn('[hub] legacy panel not found:', tabName);
      return;
    }

    clearLegacyMount();

    document.body.classList.add('hub-mode');
    const shellPanel = document.getElementById('panel-hub-shell');
    if (shellPanel) shellPanel.style.display = '';

    document.querySelectorAll('.hub-page[data-hub-page]').forEach((p) => {
      if (p.id === 'hubLegacyMount' || p.id === 'hubLegacyPanelStash') return;
      p.hidden = true;
      p.classList.remove('is-active');
    });

    mount.hidden = false;
    mount.classList.add('is-active');
    updateInspectorVisibility('legacy');

    if (!mountLegacyPanelInto(content, tabName, opts)) return;

    renderLegacyHeader(tabName, opts);
    setSidebarForTab(tabName, opts);
    updateTopbarUser();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function navigateShell(tabName, opts = {}) {
    if (tabName === 'hub-archive') {
      showHubPage('hub-archive');
      setSidebarForTab('hub-archive');
      updateTopbarUser();
      return;
    }
    clearLegacyMount();
    if (HUB_NATIVE_TABS.includes(tabName)) {
      showHubPage(tabName);
      setSidebarForTab(tabName, opts);
    } else if (LEGACY_PANEL_IDS[tabName]) {
      renderLegacyPanelInHubShell(tabName, opts);
    }
  }

  function buildRouteHash(tab, routeOpts = {}) {
    const segments = routeOpts.segments || [];
    const mgmt = routeOpts.mgmtSection;
    const archiveReverse = {
      'jsa-archive': 'jsa',
      'bol-archive': 'bol',
      'parts-request-archive': 'parts',
      'work-order-archive': 'work-order',
      'roll-off-swap-archive': 'roll-off-swap',
    };
    if (tab === 'home') return '#/reports';
    if (tab === 'hub-dashboard') return '#/dashboard';
    if (tab === 'hub-analytics') return '#/analytics';
    if (tab === 'hub-reports') return '#/reports';
    if (tab === 'hub-settings') return '#/settings';
    if (tab === 'hub-start-center') return '#/start-center';
    if (tab === 'hub-configuration') return '#/configuration';
    if (tab === 'hub-spaces' && routeOpts.spaceKey) return '#/spaces/' + routeOpts.spaceKey;
    if (tab === 'hub-launch' && routeOpts.entryId) return '#/launch/' + routeOpts.entryId;
    if (tab === 'hub-submission' && routeOpts.submissionId) return '#/submissions/' + routeOpts.submissionId;
    if (tab === 'hub-forms') {
      const segs = routeOpts.segments || [];
      if (segs[0] === 'approval-routes' && segs[1] === 'builder' && segs[2] && segs[3]) {
        return '#/forms/approval-routes/templates/' + segs[2] + '/versions/' + segs[3];
      }
      if (segs[0] === 'approval-routes') return '#/forms/approval-routes';
      if (segs[0] === 'builder' && segs[1] && segs[2]) {
        return '#/forms/templates/' + segs[1] + '/versions/' + segs[2];
      }
      return '#/forms';
    }
    if (tab === 'hub-documents') {
      const segs = routeOpts.segments || [];
      if (segs[0] === 'builder' && segs[1] && segs[2]) {
        return '#/documents/templates/' + segs[1] + '/versions/' + segs[2];
      }
      return '#/documents/templates';
    }
    if (tab === 'hub-workflows') {
      const segs = routeOpts.segments || [];
      if (segs[0] === 'builder' && segs[1] && segs[2]) {
        return '#/forms/approval-routes/templates/' + segs[1] + '/versions/' + segs[2];
      }
      if (routeOpts.query && routeOpts.query.type === 'document') return '#/documents/templates';
      return '#/forms/approval-routes';
    }
    if (tab === 'hub-users') {
      return '#/management/users' + (segments.length ? '/' + segments.join('/') : '');
    }
    if (tab === 'management' && mgmt === 'user') {
      return '#/management/users' + (segments.length ? '/' + segments.join('/') : '');
    }
    if (tab === 'management' && mgmt === 'vendor') {
      return '#/management/vendors' + (segments.length ? '/' + segments.join('/') : '');
    }
    if (tab === 'management' && mgmt === 'role') {
      return '#/management/roles' + (segments.length ? '/' + segments.join('/') : '');
    }
    if (tab === 'management' && mgmt === 'pssr') return '#/management/pssr';
    if (tab === 'management' && mgmt === 'sso') return '#/management/sso';
    if (tab === 'management' && mgmt === 'integrations') return '#/management/integrations';
    if (archiveReverse[tab]) {
      const filter =
        tab === 'work-order-archive'
          ? 'work-orders'
          : tab === 'roll-off-swap-archive'
            ? 'ros'
            : tab === 'parts-request-archive'
              ? 'parts'
              : tab.replace('-archive', '');
      return (
        '#/archives/' +
        filter +
        (segments.length ? '/' + segments.join('/') : '')
      );
    }
    if (tab === 'hub-archive') {
      const filter = routeOpts.archiveFilter || 'all';
      const segs = routeOpts.segments || segments || [];
      if (global.HubUnifiedArchive) return global.HubUnifiedArchive.buildArchiveHash(filter, segs);
      return '#/archives';
    }
    if (tab === 'swp') return '#/safe-work-permits';
    if (tab === 'bol') return '#/generators/bol';
    if (tab === 'jsa') return '#/generators/jsa';
    if (tab === 'roll-off-swap') return '#/forms/roll-off-swap';
    if (tab === 'hub-my-tasks') return '#/hub-my-tasks';
    if (!tab) return '#/dashboard';
    return '#/' + [tab, ...segments].join('/');
  }

  function resolveHashTab(parsed) {
    return parsed;
  }

  function formatRoleLabel(role) {
    if (!role) return '';
    const map = {
      hub_admin: 'Hub Admin',
      admin: 'Admin',
      operations: 'Operations Manager',
      hr: 'HR Manager',
      ap: 'Accounting',
      field_supervisor: 'Field Supervisor',
      field_technician: 'Field Technician',
      client: 'Client Representative',
      vendor: 'External Vendor',
      manager: 'Manager',
      legal: 'Legal',
      requester: 'Requester',
      employee: 'Employee',
    };
    const key = String(role).toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
    if (map[key]) return map[key];
    return String(role)
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .replace(/\bHub Admin\b/i, 'Hub Admin');
  }

  function updateTopbarUser() {
    const email = global._hubUserEmail || '';
    const displayName = global._hubUserDisplayName || '';
    const roleRaw = global._hubUserRole || '';
    const nameEl = document.getElementById('hubTopbarName');
    const roleEl = document.getElementById('hubTopbarRole');
    const avEl = document.getElementById('hubTopbarAvatar');
    const metaEl = document.getElementById('hubAccountMenuMeta');
    const fromEmail = email ? email.split('@')[0].replace(/[._]/g, ' ') : 'User';
    const pretty = (displayName || fromEmail).replace(/\b\w/g, (c) => c.toUpperCase())
      .replace(/\bHub-Admin\b/gi, 'Hub Admin')
      .replace(/\bHub Admin\b/gi, 'Hub Admin');
    const roleLabel = formatRoleLabel(roleRaw);
    if (nameEl) nameEl.textContent = pretty;
    if (roleEl) {
      if (roleLabel) {
        roleEl.hidden = false;
        roleEl.textContent = roleLabel;
      } else {
        roleEl.hidden = true;
        roleEl.textContent = '';
      }
    }
    if (avEl) avEl.textContent = initials(email || pretty);
    if (metaEl) {
      metaEl.textContent = [pretty, roleLabel, email].filter(Boolean).join(' · ');
    }
    wireAccountMenu();
    syncThemeToggleIcon();
  }

  function wireAccountMenu() {
    const chip = document.getElementById('hubTopbarUser');
    const menu = document.getElementById('hubAccountMenu');
    const signOutBtn = document.getElementById('hubAccountSignOut');
    if (!chip || !menu || chip.dataset.accountWired) return;
    chip.dataset.accountWired = '1';

    function closeMenu() {
      menu.hidden = true;
      chip.setAttribute('aria-expanded', 'false');
    }
    function openMenu() {
      menu.hidden = false;
      chip.setAttribute('aria-expanded', 'true');
      signOutBtn?.focus();
    }
    function toggleMenu() {
      if (menu.hidden) openMenu();
      else closeMenu();
    }

    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu();
    });
    chip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        openMenu();
      }
    });
    signOutBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenu();
      if (typeof global.portalSignOut === 'function') global.portalSignOut();
      else if (typeof window.portalSignOut === 'function') window.portalSignOut();
      else {
        const base = (window.APP_BASE_PATH || '').replace(/\/$/, '');
        const go = () => {
          window.location.href = `${base}/api/auth/logout`;
        };
        const modal = global.streamlineModal || window.streamlineModal;
        if (modal && typeof modal.confirm === 'function') {
          modal
            .confirm({
              title: 'Sign out?',
              body: 'You will need to sign in again to access the Operations Workflow Hub.',
              confirmLabel: 'Sign out',
              cancelLabel: 'Cancel',
              focusCancel: true,
            })
            .then((ok) => {
              if (ok) go();
            });
        } else {
          go();
        }
      }
    });
    document.addEventListener('click', (e) => {
      if (!menu.hidden && !document.getElementById('hubUserMenu')?.contains(e.target)) {
        closeMenu();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) {
        closeMenu();
        chip.focus();
      }
    });
  }

  function syncThemeToggleIcon() {
    const btn = document.getElementById('hubThemeToggle');
    if (!btn) return;
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    btn.innerHTML = dark
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  }

  function wireShellNav() {
    document.querySelectorAll('#hubSidebarNav [data-hub-tab]').forEach((btn) => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', () => {
        const tab = btn.dataset.hubTab;
        if (tab && typeof global.switchTab === 'function') global.switchTab(tab);
      });
    });
    document.querySelectorAll('#hubShell [data-hub-tab]').forEach((btn) => {
      if (btn.closest('#hubSidebarNav') || btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = btn.getAttribute('data-hub-tab');
        if (tab && typeof global.switchTab === 'function') global.switchTab(tab);
      });
    });
    document.querySelectorAll('[data-portal-tab]').forEach((btn) => {
      if (btn.dataset.wiredPortal) return;
      btn.dataset.wiredPortal = '1';
      btn.addEventListener('click', () => {
        const tab = btn.dataset.portalTab;
        const mgmt = btn.dataset.mgmtSection;
        if (tab && typeof global.switchTab === 'function') {
          global.switchTab(tab, mgmt ? { mgmtSection: mgmt } : {});
        }
      });
    });
    document.getElementById('hubInspectorClose')?.addEventListener('click', () => {
      inspectorRequestId = null;
      document.getElementById('hubInspector')?.classList.remove('is-open');
      document.querySelectorAll('.hub-table tbody tr.is-selected').forEach((tr) => {
        tr.classList.remove('is-selected');
      });
    });
    document.getElementById('hubGlobalSearch')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = e.target.value?.trim();
        if (typeof global.switchTab === 'function') global.switchTab('hub-requests');
        const inp = document.getElementById('hubFilterSearch');
        if (inp && q) {
          inp.value = q;
          initRequestsList();
        }
      }
    });
  }

  function renderKpiRow(summary, el) {
    if (!el) return;
    const failed = summary.by_status?.failed_sync || 0;
    const cards = [
      { label: 'Open', value: summary.open_count ?? 0, cls: '' },
      { label: 'Aging &gt; 48h', value: summary.aging_count ?? 0, cls: 'warn' },
      { label: 'Stale &gt; 7d', value: summary.stale_count ?? 0, cls: 'danger' },
      { label: 'Waiting on Client', value: summary.waiting_on_client ?? 0, cls: '' },
      { label: 'Failed Sync', value: failed, cls: failed ? 'danger' : '' },
    ];
    el.innerHTML = cards
      .map(
        (c) => `<div class="hub-kpi">
          <div class="hub-kpi-label">${c.label}</div>
          <div class="hub-kpi-value ${c.cls}">${c.value}</div>
        </div>`
      )
      .join('');
  }

  function renderAttentionRow(r, selectedId) {
    const sel = selectedId === r.id ? ' is-selected' : '';
    const customer = r.location || r.requester_name || r.requester_email || '';
    return `<tr class="${sel}" data-request-id="${esc(r.id)}">
      <td class="mono">${esc(r.request_number)}${r.demo ? ' <span class="hub-chip demo-tag">DEMO</span>' : ''}</td>
      <td><span title="${esc(typeLabel(r.request_type, registryCache))}">${typeIcon(r.request_type)} ${esc(typeLabel(r.request_type, registryCache))}</span></td>
      <td><div class="hub-cell-title">${esc(r.title || '—')}</div>${customer ? `<div class="hub-cell-sub">${esc(customer)}</div>` : ''}</td>
      <td>${chipStatus(r.status)}</td>
      <td>${chipAging(r.aging)}</td>
      <td>${ownerCell(r.assigned_to)}</td>
      <td>${formatDate(r.updated_at, true)}</td>
    </tr>`;
  }

  function wireTableRows(tbody, { onSelect, onOpen } = {}) {
    if (!tbody) return;
    tbody.querySelectorAll('[data-request-id]').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.dataset.requestId;
        tbody.querySelectorAll('tr').forEach((tr) => tr.classList.remove('is-selected'));
        row.classList.add('is-selected');
        inspectorRequestId = id;
        if (onSelect) onSelect(id);
        else showInspector(id);
      });
      row.addEventListener('dblclick', () => {
        const id = row.dataset.requestId;
        if (onOpen) onOpen(id);
        else openRequestDetail(id);
      });
    });
  }

  function renderStatusChart(summary, el) {
    if (!el) return;
    const byStatus = summary.by_status || {};
    const entries = Object.entries(byStatus)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);
    const total = summary.open_count || entries.reduce((s, [, n]) => s + n, 0) || 1;
    const colors = ['#0f766e', '#2563eb', '#b7791f', '#7c3aed', '#c2410c', '#047857', '#667779'];
    let acc = 0;
    const stops = entries.length
      ? entries
          .map(([, count], i) => {
            const pct = (count / total) * 100;
            const start = acc;
            acc += pct;
            return `${colors[i % colors.length]} ${start}% ${acc}%`;
          })
          .join(', ')
      : '#d9e2e3 0% 100%';
    const legend = entries
      .map(([status, count]) => {
        const pct = Math.round((count / total) * 100);
        return `<div><span>${esc(STATUS_LABELS[status] || status)}</span><strong>${count} (${pct}%)</strong></div>`;
      })
      .join('');
    el.innerHTML = `<div class="hub-donut-wrap">
      <div class="hub-donut" style="background:conic-gradient(${stops})" role="img" aria-label="Requests by status"></div>
      <div class="hub-donut-legend">${legend || '<div>No open requests</div>'}</div>
    </div>`;
  }

  function renderBottlenecks(summary, el) {
    if (!el) return;
    const byStatus = summary.by_status || {};
    const rows = Object.entries(byStatus)
      .filter(([k, n]) => n > 0 && BOTTLENECK_LABELS[k])
      .map(([k, n]) => ({ key: k, label: BOTTLENECK_LABELS[k], count: n }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
    const max = rows[0]?.count || 1;
    if (!rows.length) {
      el.innerHTML = '<p class="hub-empty" style="padding:14px">No bottlenecks detected.</p>';
      return;
    }
    el.innerHTML = `<ul class="hub-bottleneck-list">${rows
      .map((r) => {
        const pct = Math.round((r.count / max) * 100);
        return `<li><div style="display:flex;justify-content:space-between"><strong>${esc(r.label)}</strong><span>${r.count}</span></div>
          <div class="hub-bottleneck-bar"><span style="width:${pct}%"></span></div>
          <div class="hub-cell-sub" style="margin-top:4px">Oldest in queue — check queue</div></li>`;
      })
      .join('')}</ul>`;
  }

  async function renderWorkloadBox() {
    const email = global._hubUserEmail;
    if (!email) return '';
    try {
      const data = await fetchOpenRequests({
        open_only: 'true',
        my_email: email,
        waiting_on_me: 'true',
        limit: '50',
      });
      const mine = (data.requests || []).filter(
        (r) => r.assigned_to === email || r.assigned_to?.toLowerCase() === email.toLowerCase()
      );
      const waiting = data.requests || [];
      return `<div class="hub-workload-box">
        <h3>Today&apos;s workload</h3>
        <div class="hub-workload-stat"><span>Assigned to me</span><strong>${mine.length}</strong></div>
        <div class="hub-workload-stat"><span>Waiting on me</span><strong>${waiting.length}</strong></div>
        <p style="margin:10px 0 0"><button type="button" class="hub-link-btn" data-hub-tab="hub-requests">View my queue</button></p>
      </div>`;
    } catch {
      return '';
    }
  }

  function buildStepper(steps, currentStatus) {
    if (!steps?.length) {
      return '<p class="hub-empty" style="padding:0">No workflow steps defined.</p>';
    }
    const order = ['submitted', 'received', 'in_review', 'sent_to_maintainx', 'maintainx_in_progress', 'in_progress', 'waiting_on_signature', 'completed'];
    const statusIdx = order.indexOf(currentStatus);
    return `<ul class="hub-stepper">${steps
      .map((s, i) => {
        let state = 'pending';
        if (s.status === 'completed' || s.status === 'done') state = 'done';
        else if (s.status === 'active' || s.status === 'in_progress') state = 'current';
        else if (i === 0 && statusIdx >= 0) state = 'done';
        const mark = state === 'done' ? '✓' : state === 'current' ? '●' : '';
        return `<li class="${state}"><span class="hub-step-dot">${mark}</span><div class="hub-step-body"><strong>${esc(s.step_title || s.step_type)}</strong><span>${esc(s.assigned_to_email || s.status || '')}</span></div></li>`;
      })
      .join('')}</ul>`;
  }

  function renderReportsTypeTable(byType, registry) {
    const entries = Object.entries(byType || {})
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);
    if (!entries.length) return '<p class="hub-empty" style="padding:14px">No requests yet.</p>';
    return `<div class="hub-table-wrap"><table class="hub-table hub-table-compact"><thead><tr><th>Type</th><th>Count</th></tr></thead><tbody>${entries
      .map(
        ([type, count]) =>
          `<tr><td>${esc(typeLabel(type, registry))}</td><td><strong>${count}</strong></td></tr>`
      )
      .join('')}</tbody></table></div>`;
  }

  function renderRecentlyCompletedTable(rows, registry) {
    if (!rows?.length) {
      return '<p class="hub-empty" style="padding:14px">No recently completed requests.</p>';
    }
    return `<div class="hub-table-wrap"><table class="hub-table"><thead><tr><th>Request #</th><th>Type</th><th>Title</th><th>Status</th><th>Updated</th></tr></thead><tbody>${rows
      .map(
        (r) =>
          `<tr data-open-request="${esc(r.id)}"><td class="mono">${esc(r.request_number)}</td><td>${esc(typeLabel(r.request_type, registry))}</td><td>${esc(r.title || '—')}</td><td>${chipStatus(r.status)}</td><td>${formatDate(r.updated_at, true)}</td></tr>`
      )
      .join('')}</tbody></table></div>`;
  }

  async function initHubReports() {
    showHubPage('hub-reports');
    setSidebarForTab('hub-reports');
    updateTopbarUser();
    await loadPermissionsFromMe();
    applyHubNavPermissions();

    const root = document.getElementById('hubReportsRoot');
    if (!root) return;
    if (!canAccessHubTab('hub-reports')) {
      renderAccessRestricted(root, 'Reports');
      return;
    }

    root.innerHTML = '<div class="hub-loading">Loading reports…</div>';
    const asOfEl = document.getElementById('hubReportsAsOf');

    try {
      await fetchRegistry();
      const summary = await fetchDashboardSummary();
      lastDashboardSummary = summary;
      const byStatus = summary.by_status || {};
      const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
      const completed = (byStatus.completed || 0) + (byStatus.closed || 0);
      const maintainxPending = (byStatus.sent_to_maintainx || 0) + (byStatus.maintainx_in_progress || 0);
      const maintainxFailed = byStatus.failed_sync || 0;

      if (asOfEl) {
        asOfEl.textContent = `Data as of ${new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
      }

      const kpiHtml = [
        { label: 'Total requests', value: total },
        { label: 'Open', value: summary.open_count ?? 0 },
        { label: 'Aging &gt; 48h', value: summary.aging_count ?? 0, cls: 'warn' },
        { label: 'Stale &gt; 7d', value: summary.stale_count ?? 0, cls: 'danger' },
        { label: 'Completed / closed', value: completed },
        { label: 'Waiting on review', value: summary.documents_review ?? 0 },
        { label: 'Waiting on signature', value: summary.documents_signature ?? 0 },
        { label: 'MaintainX queue', value: maintainxPending },
        { label: 'MaintainX failed', value: maintainxFailed, cls: maintainxFailed ? 'danger' : '' },
      ]
        .map(
          (c) =>
            `<div class="hub-kpi"><div class="hub-kpi-label">${c.label}</div><div class="hub-kpi-value ${c.cls || ''}">${c.value}</div></div>`
        )
        .join('');

      root.innerHTML = `<div class="hub-kpi-row hub-reports-kpis">${kpiHtml}</div>
        <div class="hub-dash-grid hub-reports-grid">
          <div class="hub-panel"><div class="hub-panel-head"><h2>Requests by status</h2></div><div class="hub-panel-body" id="hubReportsStatusChart"></div></div>
          <div class="hub-panel"><div class="hub-panel-head"><h2>Requests by type</h2></div><div class="hub-panel-body">${renderReportsTypeTable(summary.by_type, registryCache)}</div></div>
        </div>
        <div class="hub-panel hub-reports-export-placeholder">
          <div class="hub-panel-head"><h2>Export</h2></div>
          <div class="hub-panel-body pad"><p class="hub-muted">CSV / PDF export will be available in a future release. Use Request Queue filters for ad-hoc lists today.</p></div>
        </div>
        <div class="hub-panel">
          <div class="hub-panel-head"><h2>Recently completed</h2></div>
          <div class="hub-panel-body" id="hubReportsCompleted">${renderRecentlyCompletedTable(summary.recently_completed, registryCache)}</div>
        </div>`;

      renderStatusChart(summary, document.getElementById('hubReportsStatusChart'));
      root.querySelectorAll('[data-open-request]').forEach((row) => {
        row.addEventListener('click', () => openRequestDetail(row.dataset.openRequest));
      });
    } catch (err) {
      root.innerHTML = `<div class="hub-empty">${esc(err.message)}</div>`;
    }
  }

  async function initHubAnalytics() {
    showHubPage('hub-analytics');
    setSidebarForTab('hub-analytics');
    updateTopbarUser();
    await loadPermissionsFromMe();
    applyHubNavPermissions();

    const root = document.getElementById('hubAnalyticsRoot');
    if (!root) return;

    root.innerHTML = '<div class="hub-loading">Loading analytics…</div>';
    const asOfEl = document.getElementById('hubAnalyticsAsOf');

    try {
      await fetchRegistry();
      const summary = await fetchDashboardSummary();
      lastDashboardSummary = summary;
      const byStatus = summary.by_status || {};
      const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
      const completed = (byStatus.completed || 0) + (byStatus.closed || 0);
      const completionRate = total ? Math.round((completed / total) * 100) : 0;

      if (asOfEl) {
        asOfEl.textContent = `Data as of ${new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
      }

      const kpiHtml = [
        { label: 'Total requests', value: total },
        { label: 'Completion rate', value: `${completionRate}%` },
        { label: 'Aging &gt; 48h', value: summary.aging_count ?? 0, cls: 'warn' },
        { label: 'Stale &gt; 7d', value: summary.stale_count ?? 0, cls: 'danger' },
      ]
        .map(
          (c) =>
            `<div class="hub-kpi"><div class="hub-kpi-label">${c.label}</div><div class="hub-kpi-value ${c.cls || ''}">${c.value}</div></div>`
        )
        .join('');

      root.innerHTML = `<div class="hub-kpi-row hub-analytics-kpis">${kpiHtml}</div>
        <div class="hub-dash-grid hub-analytics-grid">
          <div class="hub-panel"><div class="hub-panel-head"><h2>Requests by status</h2></div><div class="hub-panel-body" id="hubAnalyticsStatusChart"></div></div>
          <div class="hub-panel"><div class="hub-panel-head"><h2>Requests by type</h2></div><div class="hub-panel-body">${renderReportsTypeTable(summary.by_type, registryCache)}</div></div>
        </div>
        <div class="hub-panel hub-analytics-trend-placeholder">
          <div class="hub-panel-head"><h2>Trends</h2></div>
          <div class="hub-panel-body pad"><p class="hub-muted">Deeper trend analysis (cycle time over time, throughput by team) will build on these metrics in a future release. This is the Analytics view — for point-in-time operational reports see Reports.</p></div>
        </div>`;

      renderStatusChart(summary, document.getElementById('hubAnalyticsStatusChart'));
    } catch (err) {
      root.innerHTML = `<div class="hub-empty">${esc(err.message)}</div>`;
    }
  }

  function setActiveSettingsCard(key) {
    document.querySelectorAll('[data-hub-settings-card]').forEach((card) => {
      card.classList.toggle('is-active', card.dataset.hubSettingsCard === key);
    });
  }

  function hideSettingsDetail() {
    const detail = document.getElementById('hubSettingsDetail');
    if (detail) {
      detail.hidden = true;
      detail.innerHTML = '';
    }
    document.querySelectorAll('[data-hub-settings-card]').forEach((card) => {
      card.classList.remove('is-active');
    });
  }

  let _generalSettingsSnapshot = null;
  let _portalSettingsLoaded = false;

  function navigateToIntegrations() {
    hideSettingsDetail();
    global._pendingMgmtSection = 'integrations';
    if (global.HubUI && typeof global.HubUI.renderLegacyPanelInHubShell === 'function') {
      global.HubUI.renderLegacyPanelInHubShell('management', { mgmtSection: 'integrations' });
    } else if (typeof global.switchTab === 'function') {
      global.switchTab('management', { mgmtSection: 'integrations' });
    }
    if (global.streamlineRouter) {
      global.streamlineRouter.setHash('#/management/integrations');
    }
  }

  function resolveHashTab(out) {
    const legacyArchive = {
      'forms-archive': 'forms',
      'jsa-archive': 'jsa',
      'bol-archive': 'bol',
      'parts-request-archive': 'parts',
      'work-order-archive': 'work-orders',
      'roll-off-swap-archive': 'ros',
    };
    if (legacyArchive[out.tab]) {
      return {
        tab: 'hub-archive',
        archiveFilter: legacyArchive[out.tab],
        segments: out.segments || [],
        query: out.query || {},
      };
    }
    if (out.tab === 'hub-workflows') {
      return {
        tab: 'hub-forms',
        segments: ['approval-routes', ...(out.segments || [])],
        query: out.query || {},
        space: 'workflows',
      };
    }
    return out;
  }

  function navigateToWorkflows(query) {
    const q = query || {};
    if (q.type === 'document') {
      navigateToTemplateSpace('documents', q);
      return;
    }
    hideSettingsDetail();
    global._hubTemplateRoute = { space: 'workflows', segments: ['approval-routes'], query: q };
    if (typeof global.switchTab === 'function') {
      global.switchTab('hub-forms', { space: 'workflows', approvalRoutes: true });
    } else if (global.streamlineRouter) {
      global.streamlineRouter.setHash('#/forms/approval-routes');
    }
  }

  function navigateToTemplateSpace(space, extraQuery) {
    const q = { ...(extraQuery || {}), space };
    global._hubTemplateRoute = { space, segments: space === 'workflows' ? ['approval-routes'] : [], query: q };
    hideSettingsDetail();
    const tab = space === 'documents' ? 'hub-documents' : 'hub-forms';
    if (typeof global.switchTab === 'function') {
      global.switchTab(tab, { space, query: q, approvalRoutes: space === 'workflows' });
    } else if (global.streamlineRouter) {
      const hash =
        space === 'forms'
          ? '#/forms'
          : space === 'documents'
            ? '#/documents/templates'
            : '#/forms/approval-routes';
      global.streamlineRouter.setHash(hash);
    }
  }

  function applyPortalSettingsUi(settings) {
    if (!settings) return;
    global._portalSettings = settings;
    const brand = document.getElementById('hubBrandTitle');
    if (brand && settings.displayName) brand.textContent = settings.displayName;
    if (settings.displayName) {
      document.title = settings.displayName + ' · Streamline';
    }
    const devPanel = document.getElementById('hubDevToolsPanel');
    if (devPanel && settings.demoSeedEnabled === false) {
      devPanel.hidden = true;
    }
  }

  async function fetchPortalSettings() {
    const res = await hubFetch('/hub/settings/portal');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not load portal settings');
    return data.settings || {};
  }

  async function savePortalSettings(patch) {
    const res = await hubFetch('/hub/settings/portal', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not save portal settings');
    applyPortalSettingsUi(data.settings);
    return data.settings;
  }

  function getThemePreference() {
    try {
      return localStorage.getItem('sli.theme') || 'light';
    } catch {
      return 'light';
    }
  }

  function applyThemePreference(mode) {
    const html = document.documentElement;
    const pref = mode || 'light';
    if (pref === 'dark') {
      html.setAttribute('data-theme', 'dark');
    } else if (pref === 'system') {
      const prefersDark =
        global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches;
      if (prefersDark) html.setAttribute('data-theme', 'dark');
      else html.removeAttribute('data-theme');
    } else {
      html.removeAttribute('data-theme');
    }
    try {
      localStorage.setItem('sli.theme', pref);
    } catch {
      /* ignore */
    }
    syncThemeToggleIcon();
  }

  function showSettingsStatus(host, message, kind) {
    if (!host) return;
    host.textContent = message || '';
    host.hidden = !message;
    host.className = 'hub-settings-status' + (kind ? ' is-' + kind : '');
  }

  function renderGeneralSettingsForm(detail, settings) {
    _generalSettingsSnapshot = { ...settings };
    const landingOpts = [
      ['hub-dashboard', 'Dashboard'],
      ['hub-requests', 'Requests'],
      ['hub-my-tasks', 'My tasks'],
      ['hub-reports', 'Reports'],
      ['hub-workflows', 'Workflow templates'],
    ];
    const roleOpts = [
      ['requester', 'Requester'],
      ['employee', 'Employee'],
      ['manager', 'Manager'],
      ['admin', 'Admin'],
    ];
    detail.innerHTML = `<div class="hub-panel hub-settings-detail-panel">
      <div class="hub-panel-head"><h2>General settings</h2><p class="hub-sub" style="margin:4px 0 0">Portal defaults stored in hub_settings (portal:general).</p></div>
      <div class="hub-panel-body pad">
        <div class="hub-settings-form">
          <label class="hub-settings-field">
            <span>Portal display name</span>
            <input type="text" id="hubSetDisplayName" maxlength="120" value="${esc(settings.displayName || '')}" />
          </label>
          <label class="hub-settings-field">
            <span>Default landing page</span>
            <select id="hubSetLanding">${landingOpts
              .map(
                ([v, l]) =>
                  `<option value="${esc(v)}"${settings.defaultLandingPage === v ? ' selected' : ''}>${esc(l)}</option>`
              )
              .join('')}</select>
            <span class="hub-settings-field-hint">Preference saved for future sign-in redirect.</span>
          </label>
          <label class="hub-settings-field">
            <span>Default requester role</span>
            <select id="hubSetRequesterRole">${roleOpts
              .map(
                ([v, l]) =>
                  `<option value="${esc(v)}"${settings.defaultRequesterRole === v ? ' selected' : ''}>${esc(l)}</option>`
              )
              .join('')}</select>
            <span class="hub-settings-field-hint">Preference saved for future request defaults.</span>
          </label>
          ${
            settings._demoSeedToggleVisible
              ? `<label class="hub-settings-check">
            <input type="checkbox" id="hubSetDemoSeed" ${settings.demoSeedEnabled ? 'checked' : ''} />
            <span>Show staging demo seed controls for hub admins (requires STAGING_DEMO_DATA_ENABLED)</span>
          </label>`
              : ''
          }
        </div>
        <div id="hubGeneralSettingsStatus" class="hub-settings-status" hidden></div>
        <div class="hub-settings-actions">
          <button type="button" class="hub-btn hub-btn-primary" id="hubGeneralSaveBtn">Save</button>
          <button type="button" class="hub-btn hub-btn-ghost" id="hubGeneralCancelBtn">Cancel</button>
        </div>
      </div>
    </div>`;
    const statusEl = detail.querySelector('#hubGeneralSettingsStatus');
    detail.querySelector('#hubGeneralCancelBtn')?.addEventListener('click', () => {
      if (_generalSettingsSnapshot) renderGeneralSettingsForm(detail, _generalSettingsSnapshot);
      showSettingsStatus(statusEl, '', '');
    });
    detail.querySelector('#hubGeneralSaveBtn')?.addEventListener('click', async () => {
      try {
        showSettingsStatus(statusEl, 'Saving…', 'loading');
        const saved = await savePortalSettings({
          displayName: detail.querySelector('#hubSetDisplayName')?.value || '',
          defaultLandingPage: detail.querySelector('#hubSetLanding')?.value,
          defaultRequesterRole: detail.querySelector('#hubSetRequesterRole')?.value,
          demoSeedEnabled: detail.querySelector('#hubSetDemoSeed')
            ? !!detail.querySelector('#hubSetDemoSeed').checked
            : !!_generalSettingsSnapshot?.demoSeedEnabled,
        });
        _generalSettingsSnapshot = {
          ...saved,
          _demoSeedToggleVisible: !!_generalSettingsSnapshot?._demoSeedToggleVisible,
        };
        renderGeneralSettingsForm(detail, _generalSettingsSnapshot);
        showSettingsStatus(
          detail.querySelector('#hubGeneralSettingsStatus'),
          'Settings saved' + (saved.updatedAt ? ' · ' + saved.updatedAt : ''),
          'success'
        );
        initDevTools();
      } catch (err) {
        showSettingsStatus(
          detail.querySelector('#hubGeneralSettingsStatus') || statusEl,
          err.message,
          'error'
        );
      }
    });
  }

  async function showGeneralSettingsPanel() {
    const detail = document.getElementById('hubSettingsDetail');
    if (!detail) return;
    setActiveSettingsCard('general');
    detail.hidden = false;
    detail.innerHTML = '<div class="hub-loading">Loading general settings…</div>';
    try {
      const settings = global._portalSettings || (await fetchPortalSettings());
      let demoSeedToggleVisible = false;
      try {
        const statusRes = await hubFetch('/hub/dev/status');
        const status = await statusRes.json().catch(() => ({}));
        demoSeedToggleVisible = !!status.allowed;
      } catch {
        demoSeedToggleVisible = false;
      }
      renderGeneralSettingsForm(detail, { ...settings, _demoSeedToggleVisible: demoSeedToggleVisible });
    } catch (err) {
      detail.innerHTML = `<div class="hub-settings-inline-warn"><strong>General settings unavailable</strong><span>${esc(err.message)}</span></div>`;
    }
  }

  function showAppearanceSettingsPanel() {
    const detail = document.getElementById('hubSettingsDetail');
    if (!detail) return;
    setActiveSettingsCard('appearance');
    detail.hidden = false;
    const current = getThemePreference();
    detail.innerHTML = `<div class="hub-panel hub-settings-detail-panel">
      <div class="hub-panel-head"><h2>Appearance</h2></div>
      <div class="hub-panel-body pad">
        <p class="hub-sub" style="margin-top:0">Theme preference is saved in this browser via localStorage.</p>
        <div class="hub-settings-theme-options" role="radiogroup" aria-label="Theme mode">
          ${['light', 'dark', 'system']
            .map(
              (mode) => `<label class="hub-settings-theme-opt">
              <input type="radio" name="hubThemeMode" value="${mode}" ${current === mode ? 'checked' : ''} />
              <span>${mode.charAt(0).toUpperCase() + mode.slice(1)}</span>
            </label>`
            )
            .join('')}
        </div>
        <div id="hubAppearanceStatus" class="hub-settings-status" hidden></div>
        <div class="hub-settings-actions">
          <button type="button" class="hub-btn hub-btn-primary" id="hubAppearanceApplyBtn">Apply theme</button>
          <button type="button" class="hub-btn hub-btn-ghost" id="hubAppearanceToggleBtn">Toggle like top bar</button>
        </div>
      </div>
    </div>`;
    const statusEl = detail.querySelector('#hubAppearanceStatus');
    detail.querySelector('#hubAppearanceApplyBtn')?.addEventListener('click', () => {
      const picked = detail.querySelector('input[name="hubThemeMode"]:checked')?.value || 'light';
      applyThemePreference(picked);
      showSettingsStatus(statusEl, 'Theme applied: ' + picked, 'success');
    });
    detail.querySelector('#hubAppearanceToggleBtn')?.addEventListener('click', () => {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      applyThemePreference(dark ? 'light' : 'dark');
      const picked = getThemePreference();
      detail.querySelectorAll('input[name="hubThemeMode"]').forEach((el) => {
        el.checked = el.value === picked;
      });
      showSettingsStatus(statusEl, 'Theme toggled: ' + picked, 'success');
    });
  }

  function wireSettingsCards() {
    document.querySelectorAll('[data-hub-settings-card]').forEach((card) => {
      if (card.dataset.wiredSettings) return;
      card.dataset.wiredSettings = '1';
      card.addEventListener('click', () => {
        const key = card.dataset.hubSettingsCard;
        if (key === 'general') {
          showGeneralSettingsPanel();
          return;
        }
        if (key === 'appearance') {
          showAppearanceSettingsPanel();
          return;
        }
        if (key === 'integrations') {
          navigateToIntegrations();
          return;
        }
        if (key === 'health') {
          showSettingsHealthPanel();
          return;
        }
        if (key === 'workflows' || key === 'workflow') {
          navigateToTemplateSpace('workflows');
          return;
        }
        if (key === 'forms') {
          navigateToTemplateSpace('forms');
          return;
        }
        if (key === 'documents' || key === 'registry') {
          navigateToTemplateSpace('documents');
          return;
        }
        if (key === 'app-spaces') {
          showAppSpacesSettingsPanel();
          return;
        }
      });
    });
  }

  async function renderDeliveryQueueHealth(host) {
    if (!host) return;
    if (!hasPerm('hub_admin') && !hasPerm('admin')) {
      host.innerHTML = '<p class="hub-sub">Admin access required to view delivery queue health.</p>';
      return;
    }
    host.innerHTML = '<div class="hub-loading">Loading delivery queue health…</div>';
    try {
      const res = await hubFetch('/hub/admin/delivery-status?limit=5');
      const data = res.ok ? await res.json() : null;
      if (!res.ok || !data?.ok) {
        host.innerHTML = `<div class="hub-settings-inline-warn"><strong>Delivery status unavailable</strong><span>${esc(data?.error || 'Could not load delivery status')}</span></div>`;
        return;
      }
      const ie = data.integration_events || {};
      const ed = data.email_delivery || {};
      const w = data.worker || {};
      const failRows = (rows) =>
        (rows || [])
          .map(
            (r) =>
              `<tr><td>${esc(r.event_type || '')}</td><td>${esc(r.status)}</td><td>${esc(r.last_error || '—')}</td><td style="font-size:0.72rem;color:var(--hub-muted)">${esc(r.last_attempt_at || r.created_at || '')}</td></tr>`
          )
          .join('') || '<tr><td colspan="4" style="color:var(--hub-muted)">No recent failures</td></tr>';
      host.innerHTML = `<div class="hub-panel hub-settings-health-panel">
        <div class="hub-panel-head"><h2>Delivery queue health</h2><span class="hub-sub" style="margin:0;font-size:0.78rem">Admin · ${esc(data.generated_at || '')}</span></div>
        <div class="hub-panel-body pad">
          <p class="hub-sub" style="margin-top:0">Integration dispatch: <strong>${esc(w.integration_dispatch_mode || 'inline')}</strong> · Email delivery: <strong>${esc(w.email_delivery_mode || 'inline')}</strong></p>
          <div class="hub-settings-health-metrics">
            <div><strong>Integration</strong><ul>
              <li>Pending: ${ie.pending ?? 0}</li><li>Retrying: ${ie.retrying ?? 0}</li><li>Processing: ${ie.processing ?? 0}</li><li>Dead letter: ${ie.dead_lettered ?? 0}</li>
            </ul></div>
            <div><strong>Email</strong><ul>
              <li>Pending: ${ed.pending ?? 0}</li><li>Retrying: ${ed.retrying ?? 0}</li><li>Processing: ${ed.processing ?? 0}</li><li>Dead letter: ${ed.dead_lettered ?? 0}</li>
            </ul></div>
          </div>
          <p class="action-section-title">Recent integration failures</p>
          <table class="hub-table hub-table-compact" style="width:100%;margin-bottom:14px"><thead><tr><th>Type</th><th>Status</th><th>Error</th><th>When</th></tr></thead><tbody>${failRows(ie.recent_failures)}</tbody></table>
          <p class="action-section-title">Recent email failures</p>
          <table class="hub-table hub-table-compact" style="width:100%"><thead><tr><th>Channel</th><th>Status</th><th>Error</th><th>When</th></tr></thead><tbody>${(ed.recent_failures || [])
            .map(
              (r) =>
                `<tr><td>${esc(r.channel || r.event_type || '')}</td><td>${esc(r.status)}</td><td>${esc(r.last_error || '—')}</td><td style="font-size:0.72rem;color:var(--hub-muted)">${esc(r.last_attempt_at || r.created_at || '')}</td></tr>`
            )
            .join('') || '<tr><td colspan="4" style="color:var(--hub-muted)">No recent failures</td></tr>'}</tbody></table>
        </div>
      </div>`;
    } catch (err) {
      host.innerHTML = `<div class="hub-settings-inline-warn"><strong>Delivery status unavailable</strong><span>${esc(err.message)}</span></div>`;
    }
  }

  async function showSettingsHealthPanel() {
    const detail = document.getElementById('hubSettingsDetail');
    if (!detail) return;
    setActiveSettingsCard('health');
    detail.hidden = false;
    const fetchedAt = new Date().toLocaleString();
    detail.innerHTML = `<div class="hub-settings-health-wrap">
      <div class="hub-settings-detail-toolbar">
        <span class="hub-sub">Last checked: ${esc(fetchedAt)}</span>
        <button type="button" class="hub-btn hub-btn-ghost hub-btn-sm" id="hubHealthRefreshBtn">Refresh</button>
      </div>
      <div class="hub-loading">Loading system health…</div>
    </div>`;
    detail.querySelector('#hubHealthRefreshBtn')?.addEventListener('click', () => showSettingsHealthPanel());
    const wrap = detail.querySelector('.hub-settings-health-wrap');
    const loading = wrap.querySelector('.hub-loading');
    try {
      let healthHtml = '';
      try {
        const healthUrl = typeof global.appPath === 'function' ? global.appPath('/health') : '/health';
        const healthRes = await fetch(healthUrl);
        const health = healthRes.ok ? await healthRes.json() : null;
        if (health) {
          const ok = health.ok !== false;
          const pg = health.postgres || {};
          healthHtml = `<div class="hub-panel hub-settings-health-panel">
            <div class="hub-panel-head"><h2>Service health</h2><span class="hub-badge ${ok ? 'tmpl-badge-published' : 'tmpl-badge-retired'}">${ok ? 'OK' : 'Degraded'}</span></div>
            <div class="hub-panel-body pad">
              <ul class="hub-settings-health-list">
                <li><span>Store mode</span><strong>${esc(health.hub_store_mode || health.store_mode || '—')}</strong></li>
                <li><span>Postgres</span><strong>${pg.ok === false || pg.connected === false ? 'Unavailable' : 'Connected'}</strong></li>
                <li><span>Service</span><strong>${ok ? 'Running' : 'Degraded'}</strong></li>
                <li><span>Environment</span><strong>${esc(health.node_env || '—')}</strong></li>
                <li><span>Version</span><strong>${esc(health.version || '—')}</strong></li>
              </ul>
              ${health.store_error ? `<div class="hub-settings-inline-warn"><strong>Store warning</strong><span>${esc(health.store_error)}</span></div>` : ''}
            </div>
          </div>`;
        }
      } catch {
        healthHtml = `<div class="hub-settings-inline-warn"><strong>Service health unavailable</strong><span>Could not reach /health</span></div>`;
      }
      if (loading) loading.remove();
      wrap.insertAdjacentHTML('beforeend', healthHtml + '<div id="hubSettingsDeliveryHost"></div>');
      await renderDeliveryQueueHealth(document.getElementById('hubSettingsDeliveryHost'));
    } catch (err) {
      if (loading) loading.remove();
      wrap.insertAdjacentHTML(
        'beforeend',
        `<div class="hub-settings-inline-warn"><strong>System health unavailable</strong><span>${esc(err.message)}</span></div>`
      );
    }
  }

  async function showAppSpacesSettingsPanel() {
    const detail = document.getElementById('hubSettingsDetail');
    if (!detail) return;
    setActiveSettingsCard('app-spaces');
    if (global.AppSpacesUI && typeof global.AppSpacesUI.renderAppSpacesAdminPanel === 'function') {
      await global.AppSpacesUI.renderAppSpacesAdminPanel(detail);
    } else {
      detail.hidden = false;
      detail.innerHTML =
        '<div class="hub-settings-inline-warn"><strong>App Spaces UI unavailable</strong><span>app-spaces-ui.js failed to load.</span></div>';
    }
  }

  async function initHubSpaces(opts) {
    showHubPage('hub-spaces');
    setSidebarForTab('hub-spaces');
    updateTopbarUser();
    await loadPermissionsFromMe();
    applyHubNavPermissions();
    const root = document.getElementById('hubSpacesRoot');
    if (!root) return;
    const spaceKey = opts?.spaceKey || global._hubSpaceRoute?.spaceKey || 'workflows';
    if (global.AppSpacesUI && typeof global.AppSpacesUI.renderSpaceView === 'function') {
      await global.AppSpacesUI.renderSpaceView(root, spaceKey);
    } else {
      root.innerHTML = '<div class="hub-empty">App spaces UI unavailable.</div>';
    }
  }

  async function initHubSubmission(opts) {
    showHubPage('hub-submission');
    setSidebarForTab('hub-submission');
    updateTopbarUser();
    await loadPermissionsFromMe();
    applyHubNavPermissions();
    const root = document.getElementById('hubSubmissionRoot');
    const submissionId = opts?.submissionId || global._hubSubmissionRoute?.submissionId;
    if (!root || !submissionId) {
      if (root) root.innerHTML = '<div class="hub-empty">Submission not specified.</div>';
      return;
    }
    if (global.TemplateRuntimeUI && typeof global.TemplateRuntimeUI.renderSubmissionDetail === 'function') {
      await global.TemplateRuntimeUI.renderSubmissionDetail(root, submissionId);
    } else {
      root.innerHTML = '<div class="hub-empty">Submission UI unavailable.</div>';
    }
  }

  async function initHubLaunch(opts) {
    showHubPage('hub-launch');
    setSidebarForTab('hub-launch');
    updateTopbarUser();
    await loadPermissionsFromMe();
    applyHubNavPermissions();
    const root = document.getElementById('hubLaunchRoot');
    const entryId = opts?.entryId || global._hubLaunchRoute?.entryId;
    if (!root || !entryId) {
      if (root) root.innerHTML = '<div class="hub-empty">Launch entry not specified.</div>';
      return;
    }
    if (global.AppSpacesUI && typeof global.AppSpacesUI.renderLaunchRuntime === 'function') {
      await global.AppSpacesUI.renderLaunchRuntime(root, entryId);
    } else {
      root.innerHTML = '<div class="hub-empty">Launch UI unavailable.</div>';
    }
  }

  async function initHubStartCenter() {
    showHubPage('hub-start-center');
    setSidebarForTab('hub-start-center');
    updateTopbarUser();
    await loadPermissionsFromMe();
    applyHubNavPermissions();

    const root = document.getElementById('hubStartCenterRoot');
    if (!root) return;
    if (!canAccessHubTab('hub-start-center')) {
      renderAccessRestricted(root, 'Start Center');
      return;
    }
    if (global.HubStartCenter && typeof global.HubStartCenter.renderStartCenter === 'function') {
      global.HubStartCenter.renderStartCenter(root);
    } else {
      root.innerHTML = '<div class="hub-empty">Start Center content failed to load.</div>';
    }
  }

  async function initHubConfigurationCenter() {
    showHubPage('hub-configuration');
    setSidebarForTab('hub-configuration');
    updateTopbarUser();
    await loadPermissionsFromMe();
    applyHubNavPermissions();

    const root = document.getElementById('hubConfigurationRoot');
    if (!root) return;
    if (!canAccessHubTab('hub-configuration')) {
      renderAccessRestricted(root, 'Configuration Center');
      return;
    }
    // Reveal nav only when feature is enabled (status check inside UI)
    const navBtn = document.querySelector('[data-hub-tab="hub-configuration"]');
    if (navBtn) navBtn.hidden = false;
    if (global.HubConfigurationCenter && typeof global.HubConfigurationCenter.init === 'function') {
      await global.HubConfigurationCenter.init();
    } else {
      root.innerHTML = '<div class="hub-empty">Configuration Center failed to load.</div>';
    }
  }

  async function initHubSettings() {
    showHubPage('hub-settings');
    setSidebarForTab('hub-settings');
    updateTopbarUser();
    await loadPermissionsFromMe();
    applyHubNavPermissions();
    wireSettingsCards();

    const root = document.getElementById('hubSettingsRoot');
    if (!root) return;
    if (!canAccessHubTab('hub-settings')) {
      renderAccessRestricted(root, 'Settings');
      return;
    }
    root.hidden = false;
    hideSettingsDetail();
    if (!_portalSettingsLoaded) {
      _portalSettingsLoaded = true;
      try {
        const settings = await fetchPortalSettings();
        applyPortalSettingsUi(settings);
      } catch {
        /* non-blocking */
      }
    }
  }

  async function initTemplateAuthoring(tabName) {
    const route = global._hubTemplateRoute || { space: 'workflows', segments: [], query: {} };
    let space =
      route.space ||
      (tabName === 'hub-forms' ? 'forms' : tabName === 'hub-documents' ? 'documents' : 'workflows');
    if (route.segments && route.segments[0] === 'approval-routes') {
      space = 'workflows';
      route.segments = route.segments.slice(1);
    }
    const pageTab = tabName === 'hub-workflows' ? 'hub-forms' : tabName;
    showHubPage(pageTab);
    setSidebarForTab('hub-forms');
    updateTopbarUser();
    await loadPermissionsFromMe();
    applyHubNavPermissions();

    const rootId =
      pageTab === 'hub-forms'
        ? 'hubFormsRoot'
        : pageTab === 'hub-documents'
          ? 'hubDocumentsRoot'
          : 'hubWorkflowsRoot';
    const root = document.getElementById(rootId);
    if (!root) return;
    const accessTab = space === 'workflows' ? 'hub-workflows' : pageTab;
    if (!canAccessHubTab(accessTab)) {
      renderAccessRestricted(root, space === 'workflows' ? 'Approval routes' : SPACE_PAGE_LABELS[space] || 'Templates');
      return;
    }

    if (global.TemplateRegistryUI && typeof global.TemplateRegistryUI.init === 'function') {
      await global.TemplateRegistryUI.init(root, { ...route, space, segments: route.segments || [] });
      return;
    }
    root.innerHTML = '<div class="hub-empty">Template registry UI failed to load.</div>';
  }

  const SPACE_PAGE_LABELS = { forms: 'Forms', documents: 'Documents', workflows: 'Workflows' };

  async function initHubForms() {
    return initTemplateAuthoring('hub-forms');
  }

  async function initHubDocuments() {
    return initTemplateAuthoring('hub-documents');
  }

  async function initHubWorkflows() {
    global._hubTemplateRoute = {
      ...(global._hubTemplateRoute || {}),
      space: 'workflows',
      segments: ['approval-routes', ...((global._hubTemplateRoute || {}).segments || []).filter((s) => s !== 'approval-routes')],
    };
    return initTemplateAuthoring('hub-forms');
  }

  async function initHubArchive(opts = {}) {
    showHubPage('hub-archive');
    setSidebarForTab('hub-archive');
    updateTopbarUser();
    if (global.HubUnifiedArchive && typeof global.HubUnifiedArchive.applyArchiveRouteFromHash === 'function') {
      await global.HubUnifiedArchive.applyArchiveRouteFromHash(opts);
    } else if (global.HubUnifiedArchive && typeof global.HubUnifiedArchive.initUnifiedArchive === 'function') {
      const hashRoute = global.HubUnifiedArchive.parseArchiveRouteFromHash?.(global.location?.hash || '') || {};
      const filter = global.HubUnifiedArchive.resolveArchiveFilter?.({
        filter: opts.archiveFilter || opts.filter || hashRoute.filter,
      }) || 'all';
      const segments = opts.segments || hashRoute.segments || [];
      await global.HubUnifiedArchive.initUnifiedArchive({ filter, segments });
    }
    await loadPermissionsFromMe();
    applyHubNavPermissions();
  }

  async function initHubUsers() {
    showHubPage('hub-users');
    setSidebarForTab('hub-users');
    updateTopbarUser();
    await loadPermissionsFromMe();
    applyHubNavPermissions();

    const restricted = document.getElementById('hubUsersRestricted');
    const mount = document.getElementById('hubUsersMount');
    if (!canAccessHubTab('hub-users')) {
      if (restricted) {
        restricted.hidden = false;
        renderAccessRestricted(restricted, 'User Management');
      }
      if (mount) mount.hidden = true;
      return;
    }

    if (restricted) restricted.hidden = true;
    if (mount) {
      mount.hidden = false;
      mountLegacyPanelInto(mount, 'management', { mgmtSection: 'user' });
    }
  }

  async function initDevTools() {
    const panel = document.getElementById('hubDevToolsPanel');
    const statusEl = document.getElementById('hubDevToolsStatus');
    const seedBtn = document.getElementById('hubSeedDemoBtn');
    const clearBtn = document.getElementById('hubClearDemoBtn');
    if (!panel) return;

    await loadPermissionsFromMe();
    let demoAllowed = false;
    try {
      const statusRes = await hubFetch('/hub/dev/status');
      const status = await statusRes.json().catch(() => ({}));
      demoAllowed = !!status.allowed;
    } catch {
      demoAllowed = false;
    }

    if (!demoAllowed) {
      panel.hidden = true;
      return;
    }

    panel.hidden = false;

    function setStatus(msg, isError) {
      if (!statusEl) return;
      statusEl.hidden = !msg;
      statusEl.textContent = msg || '';
      statusEl.style.color = isError ? 'var(--danger, #b42318)' : '';
    }

    if (!seedBtn?.dataset.wired) {
      seedBtn.dataset.wired = '1';
      seedBtn.addEventListener('click', async () => {
        if (!confirm('Load staging test requests? Only demo-tagged records are created; real data is not modified.')) return;
        seedBtn.disabled = true;
        setStatus('Seeding staging test data…');
        try {
          const res = await hubFetch('/hub/dev/seed-demo-data', { method: 'POST' });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'Could not seed staging test data.');
          setStatus(data.message || `Seeded ${data.seeded ?? data.created_count ?? 0} demo request(s).`);
          initDashboard();
          initHubReports();
          if (document.getElementById('hubPageRequests')?.classList.contains('is-active')) {
            initRequestsList();
          }
        } catch (err) {
          setStatus(err.message || 'Seed failed.', true);
        } finally {
          seedBtn.disabled = false;
        }
      });
    }

    if (!clearBtn?.dataset.wired) {
      clearBtn.dataset.wired = '1';
      clearBtn.addEventListener('click', async () => {
        if (!confirm('Remove all demo-tagged hub records? Test users, templates, and real requests are kept.')) return;
        clearBtn.disabled = true;
        setStatus('Clearing staging test data…');
        try {
          const res = await hubFetch('/hub/dev/clear-demo-data', { method: 'POST' });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'Could not clear staging test data.');
          setStatus(data.message || 'Staging test data cleared.');
          initDashboard();
          if (document.getElementById('hubPageRequests')?.classList.contains('is-active')) {
            initRequestsList();
          }
        } catch (err) {
          setStatus(err.message || 'Clear failed.', true);
        } finally {
          clearBtn.disabled = false;
        }
      });
    }
  }

  async function initDashboard() {
    showHubPage('hub-dashboard');
    setSidebarForTab('hub-dashboard');
    initDevTools();
    updateTopbarUser();

    const kpiEl = document.getElementById('hubDashboardKpis');
    const attentionBody = document.getElementById('hubDashboardAttentionBody');
    const chartEl = document.getElementById('hubDashboardStatusChart');
    const bottlenecksEl = document.getElementById('hubDashboardBottlenecks');
    const asOfEl = document.getElementById('hubDashboardAsOf');

    await loadPermissionsFromMe();
    if (!hasPerm('view_hub_dashboard')) {
      if (kpiEl) kpiEl.innerHTML = '<div class="hub-empty">Dashboard access not granted.</div>';
      return;
    }

    if (asOfEl) {
      asOfEl.textContent = `Data as of ${new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
    }

    try {
      await fetchRegistry();
      const [summary, actionData] = await Promise.all([
        fetchDashboardSummary(),
        fetchActionRequired(),
      ]);
      lastDashboardSummary = summary;
      renderKpiRow(summary, kpiEl);
      renderStatusChart(summary, chartEl);
      renderBottlenecks(summary, bottlenecksEl);

      const badge = document.getElementById('hubNavQueueCount');
      if (badge) {
        const n = summary.open_count ?? 0;
        if (n > 0) {
          badge.hidden = false;
          badge.textContent = n > 99 ? '99+' : String(n);
        } else {
          badge.hidden = true;
        }
      }

      const stale = summary.stale_items || [];
      const actionItems = actionData.items || [];
      const seen = new Set();
      const attention = [];
      [...stale, ...actionItems].forEach((r) => {
        if (!r?.id || seen.has(r.id)) return;
        seen.add(r.id);
        attention.push(r);
      });

      if (attentionBody) {
        if (!attention.length) {
          attentionBody.innerHTML =
            '<tr><td colspan="7" class="hub-empty">No items need attention right now.</td></tr>';
        } else {
          attentionBody.innerHTML = attention
            .slice(0, 20)
            .map((r) => renderAttentionRow(r, inspectorRequestId))
            .join('');
          wireTableRows(attentionBody);
          if (!inspectorRequestId && attention[0]) {
            inspectorRequestId = attention[0].id;
            attentionBody.querySelector('tr')?.classList.add('is-selected');
            showInspector(attention[0].id);
          }
        }
      }
    } catch (err) {
      if (kpiEl) kpiEl.innerHTML = `<div class="hub-empty">${esc(err.message)}</div>`;
      if (attentionBody) {
        attentionBody.innerHTML = `<tr><td colspan="7" class="hub-empty">${esc(err.message)}</td></tr>`;
      }
    }
  }

  function applyQuickFilter(params) {
    const email = global._hubUserEmail;
    delete params.open_only;
    delete params.status;
    delete params.aging_bucket;
    delete params.my_email;
    delete params.waiting_on_me;

    switch (activeQuickFilter) {
      case 'open':
        params.open_only = 'true';
        break;
      case 'aging':
        params.open_only = 'true';
        params.aging_bucket = 'aging';
        break;
      case 'waiting_me':
        params.open_only = 'true';
        if (email) params.my_email = email;
        params.waiting_on_me = 'true';
        break;
      case 'waiting_client':
        params.status = 'waiting_on_client_review';
        break;
      case 'failed_sync':
        params.status = 'failed_sync';
        break;
      case 'completed':
        params.status = 'completed';
        break;
      default:
        params.open_only = 'true';
    }
    return params;
  }

  function collectFilters() {
    const params = { limit: '200', include_progress: 'true' };
    const search = document.getElementById('hubFilterSearch')?.value?.trim();
    const type = document.getElementById('hubFilterType')?.value;
    const priority = document.getElementById('hubFilterPriority')?.value;
    if (search) params.search = search;
    if (type) params.request_type = type;
    if (priority) params.priority = priority;
    return applyQuickFilter(params);
  }

  async function initRequestsList() {
    showHubPage('hub-requests');
    setSidebarForTab('hub-requests');
    updateTopbarUser();
    const tbody = document.getElementById('hubRequestsTableBody');
    const inspector = document.getElementById('hubInspector');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="9" class="hub-loading">Loading queue…</td></tr>';
    if (inspector) inspector.classList.add('is-open');

    await loadPermissionsFromMe();
    if (!hasPerm('view_hub_requests')) {
      tbody.innerHTML = '<tr><td colspan="9" class="hub-empty">Request hub access not granted.</td></tr>';
      return;
    }

    try {
      await fetchRegistry();
      const data = await fetchOpenRequests(collectFilters());
      const requests = (data.requests || []).slice(0, 100);
      tbody.innerHTML = requests.length
        ? requests
            .map((r) => {
              const sel = inspectorRequestId === r.id ? ' is-selected' : '';
              const pct = r.progress?.percent ?? 0;
              const progClass = r.progress?.state === 'warning' ? 'warning' : '';
              return `<tr class="${sel}" data-request-id="${esc(r.id)}">
                <td class="mono">${esc(r.request_number)}${r.demo ? ' <span class="hub-chip demo-tag">DEMO</span>' : ''}</td>
                <td>${typeIcon(r.request_type)} ${esc(typeLabel(r.request_type, registryCache))}</td>
                <td><div class="hub-cell-title">${esc(r.title || '—')}</div></td>
                <td>${chipStatus(r.status)}</td>
                <td>${chipAging(r.aging)}</td>
                <td><span class="hub-chip priority-${esc(r.priority)}">${esc(r.priority || 'normal')}</span></td>
                <td>${ownerCell(r.assigned_to)}</td>
                <td><div class="hub-progress" title="${pct}%"><div class="hub-progress-bar ${progClass}" style="width:${pct}%"></div></div></td>
                <td>${formatDate(r.created_at, true)}</td>
              </tr>`;
            })
            .join('')
        : '<tr><td colspan="9" class="hub-empty">No requests match this filter.</td></tr>';

      wireTableRows(tbody);
      if (requests.length && !inspectorRequestId) {
        inspectorRequestId = requests[0].id;
        tbody.querySelector('tr')?.classList.add('is-selected');
        showInspector(requests[0].id);
      } else if (inspectorRequestId) {
        showInspector(inspectorRequestId);
      }
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="9" class="hub-empty">${esc(err.message)}</td></tr>`;
    }
  }

  async function showInspector(id) {
    const panel = document.getElementById('hubInspector');
    const body = document.getElementById('hubInspectorBody');
    if (!panel || !body) return;
    panel.classList.add('is-open');
    body.innerHTML = '<div class="hub-loading">Loading…</div>';
    try {
      await fetchRegistry();
      const data = await fetchRequestDetail(id);
      const r = data.request;
      const workload = await renderWorkloadBox();
      body.innerHTML = `
        <p class="hub-insp-id">${esc(r.request_number)}${r.demo ? ' <span class="hub-chip demo-tag">DEMO</span>' : ''}</p>
        <div class="hub-insp-status-lg">${chipStatus(r.status)}</div>
        <p class="hub-insp-meta">${typeIcon(r.request_type)} ${esc(typeLabel(r.request_type, registryCache))} · ${ownerCell(r.assigned_to || 'Unassigned')}</p>
        <p class="hub-insp-desc">${esc((r.description || r.title || 'No description').slice(0, 280))}</p>
        <h3 style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--hub-muted);margin:0 0 8px">Progress</h3>
        ${buildStepper(data.steps, r.status)}
        ${workload}
        <p style="margin-top:14px"><button type="button" class="hub-btn hub-btn-primary" style="width:100%" data-open-detail="${esc(id)}">Open full record</button></p>
      `;
      body.querySelector('[data-open-detail]')?.addEventListener('click', () => openRequestDetail(id));
      body.querySelector('[data-hub-tab]')?.addEventListener('click', () => {
        if (typeof global.switchTab === 'function') global.switchTab('hub-requests');
      });
    } catch (err) {
      body.innerHTML = `<div class="hub-empty">${esc(err.message)}</div>`;
    }
  }

  function wireQuickFilters() {
    document.querySelectorAll('.hub-qf[data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeQuickFilter = btn.dataset.filter;
        document.querySelectorAll('.hub-qf[data-filter]').forEach((b) => {
          b.classList.toggle('is-active', b.dataset.filter === activeQuickFilter);
        });
        initRequestsList();
      });
    });
    ['hubFilterApply', 'hubFilterReset'].forEach((id) => {
      document.getElementById(id)?.addEventListener('click', () => {
        if (id === 'hubFilterReset') {
          document.querySelectorAll('.hub-toolbar input, .hub-toolbar select').forEach((el) => {
            if (el.type === 'checkbox') el.checked = false;
            else el.value = '';
          });
          activeQuickFilter = 'open';
          document.querySelectorAll('.hub-qf[data-filter]').forEach((b) => {
            b.classList.toggle('is-active', b.dataset.filter === 'open');
          });
        }
        initRequestsList();
      });
    });
  }

  async function openRequestDetail(id) {
    selectedRequestId = id;
    inspectorRequestId = id;
    if (typeof global.switchTab === 'function') global.switchTab('hub-request-detail');
    await renderRequestDetail(id);
  }

  function integrationPills(r) {
    if (!hasPerm('hub_admin') && !hasPerm('admin')) return '';
    const pills = [];
    if (r.maintainx_id || r.status?.includes('maintainx')) {
      const ok = r.status !== 'failed_sync';
      pills.push(
        `<span class="hub-integ-pill ${ok ? 'ok' : 'err'}">MaintainX ${esc(r.maintainx_sequential_id || r.maintainx_id || 'linked')}</span>`
      );
    } else if (['work_order', 'parts_request'].includes(r.request_type)) {
      pills.push('<span class="hub-integ-pill">MaintainX — not linked</span>');
    }
    if (r.request_type === 'document_review' || r.request_type === 'document_signature') {
      pills.push('<span class="hub-integ-pill">Client action link</span>');
    }
    return pills.join('');
  }

  async function renderRequestDetail(id) {
    showHubPage('hub-request-detail');
    setSidebarForTab('hub-request-detail');
    const root = document.getElementById('hubRequestDetailRoot');
    if (!root) return;
    root.innerHTML = '<div class="hub-loading">Loading request…</div>';

    try {
      await fetchRegistry();
      const data = await fetchRequestDetail(id);
      const r = data.request;
      const steps = data.steps || [];
      const pct = data.progress?.percent ?? 0;
      const progClass = data.progress?.state === 'warning' ? 'warning' : '';

      const timelineRes = await hubFetch(`/hub/requests/${encodeURIComponent(id)}/timeline`);
      const timelineData = timelineRes.ok ? await timelineRes.json() : { events: [] };

      const agingLabel = data.aging?.label || 'On track';
      const openDays = data.aging?.ageBizDays != null ? `${data.aging.ageBizDays} business day(s) open` : '';
      const webDoc = data.web_document;
      const myEmail = (global._hubUserEmail || '').toLowerCase();
      const myWaitingStep = steps.find(
        (s) => s.status === 'waiting' && (s.assigned_to_email || '').toLowerCase() === myEmail
      );

      root.innerHTML = `
        <div class="hub-detail-wrap">
          <div class="hub-page-head hub-detail-header">
            <div>
              <button type="button" class="hub-btn hub-btn-ghost" id="hubDetailBack">← Queue</button>
              <h1>${esc(r.request_number)} · ${esc(typeLabel(r.request_type, registryCache))}</h1>
              <p class="hub-sub">${esc(r.title)} · ${esc(agingLabel)}${openDays ? ` · ${esc(openDays)}` : ''}</p>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              ${chipStatus(r.status)} ${chipAging(data.aging)}
              ${r.demo ? '<span class="hub-chip demo-tag">DEMO DATA</span>' : ''}
              <span class="hub-chip priority-${esc(r.priority)}">${esc(r.priority || 'normal')} priority</span>
            </div>
          </div>
          ${webDoc ? `<div class="hub-panel" style="margin-bottom:14px"><div class="hub-panel-head"><h2>Web document</h2><span class="hub-chip">${esc(webDoc.status)}</span></div><div class="hub-panel-body pad">${webDoc.locked ? '<p class="hub-sub">Document locked after completion.</p>' : ''}${webDoc.content_json ? `<pre style="white-space:pre-wrap;font-size:0.75rem;max-height:200px;overflow:auto;margin:0">${esc(JSON.stringify(webDoc.content_json, null, 2).slice(0, 4000))}</pre>` : '<p class="hub-muted">No form content stored.</p>'}</div></div>` : ''}
          ${myWaitingStep ? `<div class="hub-panel" style="margin-bottom:14px"><div class="hub-panel-body pad"><p><strong>Your turn:</strong> ${esc(myWaitingStep.step_title)} (${esc(myWaitingStep.action_type || myWaitingStep.step_type)})</p>${myWaitingStep.instructions ? `<p class="hub-sub">${esc(myWaitingStep.instructions)}</p>` : ''}<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button type="button" class="hub-btn hub-btn-primary" id="hubStepComplete">${myWaitingStep.action_type === 'sign' ? 'Sign & complete' : myWaitingStep.action_type === 'fill' ? 'Save & continue' : 'Complete step'}</button><button type="button" class="hub-btn hub-btn-ghost" id="hubStepReject">Reject</button></div></div></div>` : ''}
          ${hasPerm('hub_admin') && !steps.some((s) => s.status === 'completed') ? `<div class="hub-panel" style="margin-bottom:14px"><div class="hub-panel-head"><h2>Edit workflow</h2></div><div class="hub-panel-body pad" id="hubAdminWorkflowEdit"></div></div>` : ''}
          <div class="hub-detail-layout">
            <div>
              <div class="hub-section">
                <div class="hub-section-head"><h2>Workflow</h2><span>${data.progress?.completed ?? 0}/${data.progress?.total ?? 0} steps</span></div>
                <div class="hub-section-body pad">
                  <div class="hub-progress" style="height:6px;margin-bottom:12px"><div class="hub-progress-bar ${progClass}" style="width:${pct}%"></div></div>
                  <ul class="hub-timeline">${steps
                    .map(
                      (s, i) =>
                        `<li><time>Step ${s.step_order}</time><strong>${esc(s.step_title)}</strong> — ${esc(s.status)}${s.assigned_to_email ? ` (${esc(s.assigned_to_email)})` : ''}</li>`
                    )
                    .join('') || '<li>No workflow steps defined.</li>'}</ul>
                </div>
              </div>
              <div class="hub-tabs" role="tablist">
                <button type="button" class="hub-tab is-active" data-hub-detail-tab="activity">Activity</button>
                <button type="button" class="hub-tab" data-hub-detail-tab="audit">Audit</button>
                <button type="button" class="hub-tab" data-hub-detail-tab="comments">Comments</button>
                <button type="button" class="hub-tab" data-hub-detail-tab="documents">Documents</button>
              </div>
              <div class="hub-tab-panel is-active" id="hubTabActivity">
                <ul class="hub-timeline">${(timelineData.events || [])
                  .map(
                    (e) =>
                      `<li><time>${formatDate(e.at)}</time><strong>${esc(e.title)}</strong>${e.detail ? `<br><span style="color:var(--hub-muted)">${esc(e.detail)}</span>` : ''}</li>`
                  )
                  .join('') || '<li>No activity recorded.</li>'}</ul>
              </div>
              <div class="hub-tab-panel" id="hubTabAudit"><div class="hub-loading">Loading audit…</div></div>
              <div class="hub-tab-panel" id="hubTabComments"><div class="hub-loading">Loading comments…</div></div>
              <div class="hub-tab-panel" id="hubTabDocuments"><div class="hub-loading">Loading attachments…</div></div>
              <div class="hub-integrations">${integrationPills(r)}</div>
              ${
                hasPerm('hub_admin') && r.status === 'failed_sync'
                  ? `<div class="hub-form-actions" style="border:none;padding:12px 0"><button type="button" class="hub-btn hub-btn-primary" id="hubRetryMx">Retry MaintainX sync</button></div>`
                  : ''
              }
            </div>
            <aside class="hub-detail-meta-panel">
              <div class="hub-meta-row"><label>Status</label><span>${esc(STATUS_LABELS[r.status] || r.status)}</span></div>
              <div class="hub-meta-row"><label>Owner</label><span>${esc(r.assigned_to || '—')}</span></div>
              <div class="hub-meta-row"><label>Requester</label><span>${esc(r.requester_name || r.requester_email || '—')}</span></div>
              <div class="hub-meta-row"><label>Location</label><span>${esc(r.location || '—')}</span></div>
              <div class="hub-meta-row"><label>Created</label><span>${formatDate(r.created_at)}</span></div>
              <div class="hub-meta-row"><label>Updated</label><span>${formatDate(r.updated_at)}</span></div>
              ${
                r.maintainx_id
                  ? `<div class="hub-meta-row"><label>MaintainX</label><span>${esc(r.maintainx_sequential_id || r.maintainx_id)}</span></div>`
                  : ''
              }
              <p style="margin-top:12px;font-size:0.72rem;color:var(--hub-muted)">${esc((r.description || '—').slice(0, 200))}</p>
            </aside>
          </div>
        </div>`;

      document.getElementById('hubDetailBack')?.addEventListener('click', () => {
        if (typeof global.switchTab === 'function') global.switchTab('hub-requests');
      });

      document.getElementById('hubStepComplete')?.addEventListener('click', async () => {
        const sid = myWaitingStep?.id;
        if (!sid) return;
        let payload = { notes: 'Completed from hub' };
        if (myWaitingStep.action_type === 'fill') {
          // For fill steps, persist the current web document payload before completing the step.
          // (The main fill/edit UI lives on the original form; this ensures we don't advance the
          // workflow without saving the content_json we already have.)
          try {
            const wr = await hubFetch(`/hub/requests/${encodeURIComponent(id)}/web-document`);
            if (wr.ok) {
              const wd = await wr.json();
              const existing = wd?.web_document;
              if (existing?.content_json !== undefined) {
                await hubFetch(`/hub/requests/${encodeURIComponent(id)}/web-document`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ content_json: existing.content_json }),
                });
              }
            }
          } catch {
            // Non-fatal; completing will still be attempted.
          }
        }
        if (myWaitingStep.action_type === 'sign' || myWaitingStep.requires_signature) {
          const ack = confirm('By completing, you acknowledge this as your electronic signature.');
          if (!ack) return;
          payload.signature = {
            file_url: null,
            storage_provider: 'acknowledgement',
            signer_email: global._hubUserEmail,
            signer_name: global._hubUserEmail,
          };
          payload.metadata = { signature_type: 'acknowledgement' };
        }
        const res = await hubFetch(`/hub/workflow-steps/${encodeURIComponent(sid)}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) renderRequestDetail(id);
        else alert((await res.json().catch(() => ({}))).error || 'Could not complete step');
      });
      document.getElementById('hubStepReject')?.addEventListener('click', async () => {
        const sid = myWaitingStep?.id;
        const notes = prompt('Rejection reason:');
        if (!sid || !notes) return;
        const res = await hubFetch(`/hub/workflow-steps/${encodeURIComponent(sid)}/reject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes }),
        });
        if (res.ok) renderRequestDetail(id);
        else alert((await res.json().catch(() => ({}))).error || 'Could not reject step');
      });

      root.querySelectorAll('[data-hub-detail-tab]').forEach((tab) => {
        tab.addEventListener('click', async () => {
          const name = tab.dataset.hubDetailTab;
          root.querySelectorAll('.hub-tab').forEach((t) => t.classList.toggle('is-active', t === tab));
          root.querySelectorAll('.hub-tab-panel').forEach((p) => p.classList.remove('is-active'));
          const panel = root.querySelector(
            name === 'activity'
              ? '#hubTabActivity'
              : name === 'audit'
                ? '#hubTabAudit'
                : name === 'comments'
                  ? '#hubTabComments'
                  : '#hubTabDocuments'
          );
          if (panel) panel.classList.add('is-active');
          if (name === 'audit') {
            const ar = await hubFetch(`/hub/requests/${encodeURIComponent(id)}/audit`);
            const ad = ar.ok ? await ar.json() : { audit: [] };
            panel.innerHTML = (ad.audit || []).length
              ? `<ul class="hub-timeline">${ad.audit
                  .map(
                    (a) =>
                      `<li><time>${formatDate(a.created_at)}</time><strong>${esc(a.event_type)}</strong> — ${esc(a.detail || '')}<br><span style="color:var(--hub-muted);font-size:0.72rem">${esc(a.actor_email || '')}</span></li>`
                  )
                  .join('')}</ul>`
              : '<div class="hub-empty">No audit entries.</div>';
          }
          if (name === 'comments') {
            const cr = await hubFetch(`/hub/requests/${encodeURIComponent(id)}/comments`);
            const cd = cr.ok ? await cr.json() : { comments: [] };
            panel.innerHTML = (cd.comments || []).length
              ? cd.comments
                  .map(
                    (c) =>
                      `<div style="padding:8px 0;border-bottom:1px solid var(--hub-border)"><strong>${esc(c.author_name || c.author_email)}</strong> <time style="font-size:0.68rem;color:var(--hub-muted)">${formatDate(c.created_at)}</time><p style="margin:4px 0 0">${esc(c.body)}</p></div>`
                  )
                  .join('')
              : '<div class="hub-empty">No comments yet.</div>';
          }
          if (name === 'documents') {
            const dr = await hubFetch(`/hub/requests/${encodeURIComponent(id)}/documents`);
            const dd = dr.ok ? await dr.json() : { documents: [] };
            const docs = dd.documents || [];
            panel.innerHTML = docs.length
              ? `<ul class="hub-feed">${docs
                  .map(
                    (d) =>
                      `<li><div class="feed-main"><strong>${esc(d.document_type)}</strong> ${esc(d.file_name || '')}${d.signed_at ? ` — signed ${formatDate(d.signed_at)}` : ''}</div></li>`
                  )
                  .join('')}</ul>`
              : '<div class="hub-empty">No attachments or signatures stored.</div>';
          }
        });
      });

      if (hasPerm('hub_admin') && global.HubWorkflowBuilder) {
        const wfEdit = document.getElementById('hubAdminWorkflowEdit');
        if (wfEdit && !steps.some((s) => s.status === 'completed')) {
          global.HubWorkflowBuilder.render(wfEdit, {
            initialSteps: steps,
            showSaveTemplate: false,
          });
          const saveBtn = document.createElement('button');
          saveBtn.type = 'button';
          saveBtn.className = 'hub-btn hub-btn-primary';
          saveBtn.textContent = 'Apply workflow changes';
          saveBtn.style.marginTop = '12px';
          saveBtn.addEventListener('click', async () => {
            const newSteps = global.HubWorkflowBuilder.getSteps(wfEdit);
            const v = global.HubWorkflowBuilder.validateSteps(newSteps);
            if (!global.HubWorkflowBuilder.showValidation(wfEdit, v)) return;
            const res = await hubFetch(`/hub/requests/${encodeURIComponent(id)}/workflow`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ steps: newSteps }),
            });
            if (res.ok) renderRequestDetail(id);
            else alert((await res.json().catch(() => ({}))).error || 'Could not update workflow');
          });
          wfEdit.appendChild(saveBtn);
        }
      }

      document.getElementById('hubRetryMx')?.addEventListener('click', async () => {
        const payload = r.form_payload?.maintainxPayload || r.form_payload;
        if (!payload) {
          alert('No stored MaintainX payload.');
          return;
        }
        const res = await hubFetch(`/hub/integrations/maintainx/retry/${encodeURIComponent(id)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ maintainxPayload: payload }),
        });
        if (res.ok) {
          alert('Retry submitted.');
          renderRequestDetail(id);
        } else {
          const err = await res.json().catch(() => ({}));
          alert(err.error || 'Retry failed');
        }
      });
    } catch (err) {
      root.innerHTML = `<div class="hub-empty">${esc(err.message)}</div>`;
    }
  }

  async function fetchLaunchRegistry() {
    const r = await hubFetch('/hub/spaces/registry');
    if (!r.ok) throw new Error('Could not load published forms');
    return r.json();
  }

  function renderNewRequestTypeGrid(items, nr) {
    if (!items.length) return '';
    const byCat = {};
    items.forEach((t) => {
      const cat = t.category || 'general';
      if (!byCat[cat]) byCat[cat] = [];
      byCat[cat].push(t);
    });
    let html = '';
    const catOrder = ['request_types', 'published_forms', 'legacy_operations', 'operations', 'safety', 'logistics', 'documents', 'general'];
    const cats = [...new Set([...catOrder, ...Object.keys(byCat)])].filter((c) => byCat[c]?.length);
    cats.forEach((cat) => {
      const catLabel =
        nr && typeof nr.categoryLabel === 'function'
          ? esc(nr.categoryLabel(cat))
          : cat === 'published_forms'
            ? 'Published forms'
            : cat === 'request_types'
              ? 'Published Request Types'
              : esc(CATEGORY_LABELS[cat] || cat);
      const catHint =
        cat === 'request_types'
          ? '<p class="hub-sub hub-type-cat-hint">Configured request types — start here. Supporting forms appear later as tasks.</p>'
          : cat === 'published_forms'
            ? '<p class="hub-sub hub-type-cat-hint">Published forms (shown only when no request types are published yet).</p>'
            : '<p class="hub-sub hub-type-cat-hint">Legacy operations and portal tools.</p>';
      html += `<div class="hub-type-category" data-category="${esc(cat)}"><h3>${catLabel}</h3>${catHint}<div class="hub-type-grid">`;
      byCat[cat].forEach((t) => {
        const action = nr.cardActionLabel(t);
        const icon = typeIcon(t.icon || t.key);
        const isDynamic = nr.isPublishedFormCard(t);
        const isCfg = nr.isCfgRequestTypeCard && nr.isCfgRequestTypeCard(t);
        const extra =
          (isDynamic ? ` data-launch-entry="${esc(t.launch_entry_id)}"` : '') +
          (isCfg ? ` data-request-type-id="${esc(t.request_type_id)}"` : '');
        html += `<button type="button" class="hub-type-item${isDynamic || isCfg ? ' hub-type-item-dynamic' : ''}" data-type-key="${esc(t.key)}" data-render="${esc(t.render_mode)}" data-tab="${esc(t.portal_tab || '')}"${extra}>
          <div class="hub-type-icon">${icon}</div>
          <strong>${esc(t.label)}</strong>
          <span class="hub-type-desc">${esc(t.description || '')}</span>
          <span class="hub-type-mode">${esc(action)}</span>
        </button>`;
      });
      html += '</div></div>';
    });
    return html;
  }

  async function initNewRequestHub() {
    showHubPage('hub-new-request');
    setSidebarForTab('hub-new-request');
    const typesEl = document.getElementById('hubNewRequestTypes');
    const formEl = document.getElementById('hubNewRequestForm');
    const backBtn = document.getElementById('hubNewRequestBack');
    const nr = global.HubNewRequestRegistry;
    if (!typesEl) return;

    typesEl.style.display = '';
    if (formEl) {
      formEl.style.display = 'none';
      formEl.innerHTML = '';
    }
    if (backBtn) backBtn.style.display = 'none';

    await loadPermissionsFromMe();
    typesEl.innerHTML = '<div class="hub-loading">Loading request types…</div>';

    const showTypeList = () => {
      typesEl.style.display = '';
      if (formEl) {
        formEl.style.display = 'none';
        formEl.innerHTML = '';
      }
      if (backBtn) backBtn.style.display = 'none';
    };

    const showFormHost = () => {
      typesEl.style.display = 'none';
      if (formEl) formEl.style.display = 'block';
      if (backBtn) backBtn.style.display = '';
    };

    try {
      const [legacyTypes, launchRegistry, cfgRequestTypes] = await Promise.all([
        fetchRegistry(),
        fetchLaunchRegistry().catch(() => ({ spaces: [] })),
        hubFetch('/hub/configuration/request-types')
          .then((d) => d.definitions || [])
          .catch(() => []),
      ]);
      const publishedForms = nr ? nr.publishedFormsFromRegistry(launchRegistry) : [];
      const requestTypes = nr && nr.requestTypesFromConfiguration
        ? nr.requestTypesFromConfiguration(cfgRequestTypes)
        : [];
      const allTypes = nr
        ? nr.mergeNewRequestTypes(legacyTypes, publishedForms, requestTypes)
        : legacyTypes;

      let html = '<div class="hub-type-list">';
      html += renderNewRequestTypeGrid(allTypes, nr || { cardActionLabel: () => 'Start request', isPublishedFormCard: () => false });
      html += '</div>';
      typesEl.innerHTML = html;

      typesEl.querySelectorAll('.hub-type-item').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const key = btn.dataset.typeKey;
          const render = btn.dataset.render;
          const tab = btn.dataset.tab;
          const launchEntryId = btn.dataset.launchEntry;
          const requestTypeId = btn.dataset.requestTypeId;

          if (render === 'cfg_request_type' && requestTypeId) {
            const item = allTypes.find((t) => t.request_type_id === requestTypeId);
            if (item && item.workflow_definition_id) {
              try {
                await hubFetch('/hub/workflow-runtime/start', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    workflow_definition_id: item.workflow_definition_id,
                    context: { request_type_id: requestTypeId, request_type_key: item.key },
                  }),
                });
              } catch (err) {
                console.warn('[hub] configurable workflow start', err);
              }
            }
            if (item && item.starting_form_template_id && formEl && global.TemplateRuntimeUI) {
              // Prefer launch entry matching template when available
              const formCard = publishedForms.find((f) => f.template_id === item.starting_form_template_id);
              if (formCard && formCard.launch_entry_id) {
                showFormHost();
                formEl.innerHTML = '';
                await global.TemplateRuntimeUI.renderLaunchForm(formEl, formCard.launch_entry_id, {
                  onCancel: showTypeList,
                  onSubmitSuccess: (submissionId) => {
                    if (typeof global.switchTab === 'function') {
                      global.switchTab('hub-submission', { submissionId });
                    }
                  },
                });
                return;
              }
            }
            alert(
              'Request type "' +
                (item && item.label ? item.label : key) +
                '" is published. Attach a starting form in Configuration Center to collect intake data.'
            );
            return;
          }

          if (render === 'published_form' && launchEntryId && formEl && global.TemplateRuntimeUI) {
            showFormHost();
            formEl.innerHTML = '';
            const shell = global.HubRequestFormShell;
            const showManage =
              shell && shell.canShowManageForm(hasPerm('hub_admin') || hasPerm('admin'), 'published_form');
            await global.TemplateRuntimeUI.renderLaunchForm(formEl, launchEntryId, {
              onCancel: showTypeList,
              showManageForm: showManage,
              onSubmitSuccess: (submissionId) => {
                if (typeof global.switchTab === 'function') {
                  global.switchTab('hub-submission', { submissionId });
                }
              },
            });
            return;
          }

          if (render === 'custom' && tab && typeof global.switchTab === 'function') {
            global.switchTab(tab);
            return;
          }
          if (render === 'schema' && formEl && global.HubFormRenderer) {
            const def = await fetchFormDefinition(key);
            if (!def) {
              alert('Form definition not found for this type.');
              return;
            }
            showFormHost();
            formEl.innerHTML = '';

            let workflowSteps = [];
            const docTypeMeta = allTypes.find((t) => t.key === key);
            try {
              const typeRes = await hubFetch(`/hub/registry/document-types/${encodeURIComponent(key)}`);
              if (typeRes.ok) {
                const typeData = await typeRes.json();
                workflowSteps = typeData.workflow_template?.steps_json || def.workflow_steps || [];
              }
            } catch {
              workflowSteps = def.workflow_steps || [];
            }

            const formHost = document.createElement('div');
            formEl.appendChild(formHost);

            global.HubFormRenderer.render(formHost, def, {
              onCancel: showTypeList,
              systemManaged: global.HubRequestFormShell ? global.HubRequestFormShell.isLegacySystemManaged(key) : true,
              description: docTypeMeta?.description || '',
              onSubmit: async (data) => {
                const body = {
                  request_type: key,
                  title: data.title,
                  description: data.description || '',
                  location: data.location || '',
                  priority: data.priority || 'normal',
                  requester_email: global._hubUserEmail,
                  content_json: data,
                  form_payload: data,
                };
                const wfMount = document.getElementById('hubNewRequestWorkflow');
                if (global.HubWorkflowBuilder && wfMount) {
                  const steps = global.HubWorkflowBuilder.getSteps(wfMount);
                  const validation = global.HubWorkflowBuilder.validateSteps(steps);
                  if (!global.HubWorkflowBuilder.showValidation(wfMount, validation)) return;
                  body.workflow_steps = steps.map((s) => ({
                    ...s,
                    assigned_to_email: s.assigned_to_email || data.signer_email || global._hubUserEmail,
                  }));
                } else if (key === 'document_signature' && data.signer_email) {
                  body.workflow_steps = [
                    {
                      step_type: 'sign',
                      step_title: 'Signature',
                      assigned_to_email: data.signer_email,
                      requires_signature: true,
                      status: 'pending',
                    },
                  ];
                } else if (def.workflow_steps) {
                  body.workflow_steps = def.workflow_steps.map((s) => ({
                    ...s,
                    assigned_to_email: data.signer_email || s.assigned_to_email || global._hubUserEmail,
                  }));
                }
                const res = await hubFetch('/hub/requests', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(body),
                });
                if (!res.ok) {
                  const err = await res.json().catch(() => ({}));
                  throw new Error(err.error || 'Submit failed');
                }
                const rec = await res.json();
                openRequestDetail(rec.id);
              },
            });

            if (global.HubWorkflowBuilder && docTypeMeta?.allow_custom_workflow !== false) {
              const wfMount = document.createElement('div');
              wfMount.id = 'hubNewRequestWorkflow';
              formEl.appendChild(wfMount);
              global.HubWorkflowBuilder.render(wfMount, {
                initialSteps: workflowSteps,
                showSaveTemplate: hasPerm('hub_admin'),
                onSaveTemplate: async (steps) => {
                  const tplId = docTypeMeta?.default_workflow_template_id;
                  if (!tplId) {
                    alert('No template id for this document type.');
                    return;
                  }
                  const res = await hubFetch(`/hub/registry/workflow-templates/${encodeURIComponent(tplId)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ steps_json: steps, label: docTypeMeta.label }),
                  });
                  if (res.ok) alert('Default workflow saved for this document type.');
                  else alert((await res.json().catch(() => ({}))).error || 'Save failed');
                },
                onChange: (steps) => {
                  workflowSteps = steps;
                },
              });
            }
          }
        });
      });
    } catch (err) {
      typesEl.innerHTML = `<div class="hub-empty">${esc(err.message)}</div>`;
    }

    backBtn?.addEventListener('click', showTypeList);
  }

  async function mirrorToHub(payload) {
    try {
      await hubFetch('/hub/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.warn('[hub] mirror skipped', e);
    }
  }

  function onTabActivated(tabName, opts = {}) {
    if (!shouldUseShell(tabName)) return;
    if (tabName === 'hub-dashboard') initDashboard();
    else if (tabName === 'hub-analytics') initHubAnalytics();
    else if (tabName === 'hub-reports') initHubReports();
    else if (tabName === 'hub-settings') initHubSettings();
    else if (tabName === 'hub-start-center') initHubStartCenter();
    else if (tabName === 'hub-configuration') initHubConfigurationCenter();
    else if (tabName === 'hub-forms') initHubForms();
    else if (tabName === 'hub-documents') initHubDocuments();
    else if (tabName === 'hub-workflows') initHubWorkflows();
    else if (tabName === 'hub-archive') {
      const routeOpts = opts && typeof opts === 'object' ? opts : {};
      const stored = global._hubArchiveRoute || {};
      const initPromise = initHubArchive({
        archiveFilter: routeOpts.archiveFilter || stored.filter,
        segments: routeOpts.segments || stored.segments || [],
      });
      global._hubArchiveInitPromise = initPromise;
    }
    else if (tabName === 'hub-users') initHubUsers();
    else if (tabName === 'hub-spaces') initHubSpaces(global._hubSpaceRoute || {});
    else if (tabName === 'hub-launch') initHubLaunch(global._hubLaunchRoute || {});
    else if (tabName === 'hub-submission') initHubSubmission(global._hubSubmissionRoute || {});
    else if (tabName === 'hub-requests') initRequestsList();
    else if (tabName === 'hub-my-tasks') initMyTasks();
    else if (tabName === 'hub-new-request') initNewRequestHub();
    else if (tabName === 'hub-request-detail' && selectedRequestId) renderRequestDetail(selectedRequestId);
  }

  function init() {
    wireShellNav();
    wireQuickFilters();
    wireNotifications();
    syncThemeToggleIcon();
    hubFetch('/me')
      .then((r) => r.json())
      .then((d) => {
        global._hubUserEmail = d.email;
        hubPermissions = d.permissions || [];
        if (global.RbacClient) global.RbacClient.syncPermissions(hubPermissions);
        applyHubNavPermissions();
        updateTopbarUser();
        refreshNotifications();
        initDevTools();
        if (global.AppSpacesUI && typeof global.AppSpacesUI.refreshLaunchNav === 'function') {
          global.AppSpacesUI.refreshLaunchNav();
        }
      })
      .catch(() => {});
    global.__hubShellReady = true;
    try {
      document.documentElement?.classList?.remove?.('hub-boot-hub');
    } catch (e) { /* headless / test env */ }
    if (typeof global.resetRouteCache === 'function') global.resetRouteCache();
    if (typeof global.applyRoute === 'function') {
      global.applyRoute({ force: true });
    } else if (typeof global.switchTab === 'function') {
      global.switchTab('hub-dashboard');
    }
  }

  global.HubUI = {
    init,
    onTabActivated,
    showHubPage,
    clearLegacyMount,
    shouldUseShell,
    navigateShell,
    renderLegacyPanelInHubShell,
    updateLegacyShellHeader,
    buildRouteHash,
    resolveHashTab,
    LEGACY_PANEL_IDS,
    initHubArchive,
    navigateToWorkflows,
    navigateToTemplateSpace,
    navigateToIntegrations,
    applyPortalSettingsUi,
    getThemePreference,
    applyThemePreference,
    openRequestDetail,
    mirrorToHub,
    initDashboard,
    initHubAnalytics,
    initRequestsList,
    fetchRegistry,
    hubFetch,
    _test: {
      buildWorkflowsHash(query) {
        if (query && query.type === 'document') return '#/documents/templates';
        return '#/forms/approval-routes';
      },
      buildFormsHash() {
        return '#/forms';
      },
      buildDocumentsHash() {
        return '#/documents/templates';
      },
      resolveHashTab,
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : typeof global !== 'undefined' ? global : this);
