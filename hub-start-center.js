/**
 * WOS-81 — Admin-only Start Center (static help content).
 */
(function (global) {
  'use strict';

  function esc(s) {
    if (s == null) return '';
    if (typeof global.escapeHtml === 'function') return global.escapeHtml(s);
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const TOP_CARDS = [
    {
      id: 'sc-start-here',
      title: 'Start here',
      blurb: 'What Streamline does and how the hub fits together.',
      chip: 'Overview',
    },
    {
      id: 'sc-daily-flow',
      title: 'Daily workflow',
      blurb: 'How most users start work, submit requests, and complete tasks.',
      chip: 'Users',
    },
    {
      id: 'sc-admin-setup',
      title: 'Admin setup',
      blurb: 'Forms, roles, approval routes, and publishing for New Request.',
      chip: 'Admins',
    },
    {
      id: 'sc-launch-checklist',
      title: 'Launch checklist',
      blurb: 'Pre-launch verification steps before the team goes live.',
      chip: 'Checklist',
    },
  ];

  const LAUNCH_CHECKLIST = [
    'Create or verify admin users',
    'Assign roles',
    'Create a test form',
    'Add sections and fields',
    'Attach a workflow if needed',
    'Publish the form',
    'Confirm it appears in New Request',
    'Submit a test request',
    'Confirm the record opens',
    'Confirm it appears in Archive → Forms',
    'Confirm workflow step appears for the right role',
    'Complete the workflow action',
    'Confirm Archive categories still work',
    'Confirm dark mode is readable',
    'Confirm non-admin users cannot access admin pages',
  ];

  const TROUBLESHOOTING = [
    {
      title: 'I published a form but do not see it in New Request',
      items: [
        'Check form availability',
        'Check role visibility',
        'Confirm it is published, not draft',
      ],
    },
    {
      title: 'A submitted form is not in Archive',
      items: [
        'Check Archive → Forms',
        'Confirm the form was actually submitted',
        'Confirm the user has permission to view the record',
      ],
    },
    {
      title: 'A user cannot approve a step',
      items: [
        'Check the step\u2019s assigned role',
        'Check the user has that role',
        'Confirm they are signed in as the right user',
      ],
    },
    {
      title: 'A form is read-only',
      items: [
        'Published versions are locked',
        'Clone to draft to make changes',
      ],
    },
    {
      title: 'A role cannot be deleted',
      items: [
        'System roles cannot be deleted',
        'Roles already used by users, workflows, or records cannot be hard-deleted',
        'Deactivate the role instead',
      ],
    },
    {
      title: 'Archive looks empty',
      items: [
        'Confirm the selected archive category has records',
        'Try Archive overview',
        'Confirm route is not filtered unexpectedly',
      ],
    },
  ];

  const SECTIONS = [
    {
      id: 'sc-overview',
      title: 'System overview',
      open: true,
      body: `<p>Streamline Operations Hub helps the team start requests, fill forms, route approvals, complete workflow actions, and keep records in one place.</p>
        <p>Use the sidebar to move between <strong>New Request</strong>, <strong>My Tasks</strong>, the <strong>Request Queue</strong>, <strong>Archive</strong>, <strong>Reports</strong>, and <strong>Analytics</strong>. Admins also manage <strong>Forms</strong>, <strong>Workflows</strong>, <strong>Users and roles</strong>, and <strong>Settings</strong>.</p>`,
    },
    {
      id: 'sc-daily-flow',
      title: 'Daily user flow',
      body: `<p>Most users start in <strong>New Request</strong>, choose a request type or form, fill it out, and submit it. If a request needs action, it appears in <strong>My Tasks</strong> or the <strong>Request Queue</strong>.</p>
        <ul class="hub-start-center-list">
          <li>Open <strong>New Request</strong> and pick a published form or system-managed request type.</li>
          <li>Fill required fields and submit.</li>
          <li>Track open work in <strong>My Tasks</strong> or the <strong>Request Queue</strong>.</li>
          <li>When assigned a workflow step, open the record and complete the action.</li>
          <li>Find completed or submitted records in <strong>Archive</strong>.</li>
        </ul>`,
    },
    {
      id: 'sc-admin-setup-flow',
      title: 'Admin setup flow',
      body: `<p>Admins create and manage forms, assign users to roles, attach approval routes where needed, and publish forms so they appear in <strong>New Request</strong>.</p>
        <ol class="hub-start-center-list">
          <li>Confirm admin users and assign <strong>Users and roles</strong>.</li>
          <li>Create or edit a form in <strong>Forms</strong>.</li>
          <li>Add sections and fields, then preview the layout.</li>
          <li>Attach an approval route in <strong>Workflows</strong> when routing is required.</li>
          <li>Set availability and role visibility, then publish.</li>
          <li>Verify the form appears in <strong>New Request</strong> for the intended audience.</li>
        </ol>`,
    },
    {
      id: 'sc-forms',
      title: 'Forms',
      body: `<p>Forms are reusable request templates. Admins can create drafts, add sections and fields, preview the form, attach a workflow if needed, and publish it for the team.</p>
        <p>Drafts can be edited freely. Published versions are locked for day-to-day use; clone to draft when you need structural changes.</p>`,
    },
    {
      id: 'sc-workflows',
      title: 'Workflows / approval routes',
      body: `<p>Workflows define what happens after a form is submitted. A workflow can include fill, review, approval, sign-off, and upload/reference steps. Each step should be assigned to a role.</p>
        <p>Attach an approval route while building a form, or reuse a route already defined under <strong>Workflows</strong>.</p>`,
    },
    {
      id: 'sc-new-request',
      title: 'New Request',
      body: `<p>New Request is where users begin work. Published forms and system-managed request types appear here.</p>
        <p>Users should not need admin access to start a request. If a form is missing, check that it is published, available, and visible to the user\u2019s roles.</p>`,
    },
    {
      id: 'sc-my-tasks',
      title: 'My Tasks',
      body: `<p><strong>My Tasks</strong> shows workflow steps and actions waiting on the signed-in user. Open a task to review the record and complete the required action.</p>
        <p>If a user expects a task but sees none, confirm their role matches the step assignment and that the request was submitted successfully.</p>`,
    },
    {
      id: 'sc-request-queue',
      title: 'Request Queue',
      body: `<p>The <strong>Request Queue</strong> is the operational list of requests across the hub. Filter by status, type, or assignment to monitor workload and aging items.</p>
        <p>Double-click a row or use the inspector to open full request details.</p>`,
    },
    {
      id: 'sc-archive',
      title: 'Archive',
      body: `<p>Archive stores completed and submitted records. Legacy records such as BOL, JSA, Work Orders, Parts Requests, and Roll Off Swap remain available. Submitted dynamic forms appear under <strong>Archive \u2192 Forms</strong>.</p>
        <p>Use the category filters to browse legacy archives or submitted form records. Click a row to open the record or submission detail.</p>`,
    },
    {
      id: 'sc-users-roles',
      title: 'Users and roles',
      body: `<p>Roles control what users can see and what workflow steps they can act on. System roles cannot be deleted. Roles that are already used by users, workflows, or submitted records cannot be hard-deleted; they can be deactivated so old records remain readable.</p>
        <p>Assign workflow roles in <strong>Users</strong>. Manage the role catalog under the workflow role section. Deactivate unused custom roles instead of deleting referenced ones.</p>`,
    },
    {
      id: 'sc-reports-analytics',
      title: 'Reports and Analytics',
      body: `<p>Reports summarize operational activity. Analytics gives higher-level visibility into trends and status breakdowns.</p>
        <p>Use <strong>Reports</strong> for day-to-day operational metrics. Use <strong>Analytics</strong> for trend views across requests and cycle time.</p>`,
    },
    {
      id: 'sc-legacy-tools',
      title: 'Legacy tools',
      body: `<p>Some request types are system-managed legacy tools. They can be used by the team but are not edited through the Forms builder.</p>
        <p>Examples include Parts Request, Work Order, BOL, JSA, Safe Work Permits, and Roll Off Swap. Legacy archives for these records remain under <strong>Archive</strong>.</p>`,
    },
    {
      id: 'sc-launch-checklist',
      title: 'Launch-day checklist',
      body: `<p class="hub-start-center-note">This checklist is for launch preparation only. Completion is not saved to the database.</p>
        <ul class="hub-start-center-checklist">${LAUNCH_CHECKLIST.map(
          (item) =>
            `<li><label class="hub-start-center-check"><input type="checkbox" aria-label="${esc(item)}"> <span>${esc(item)}</span></label></li>`
        ).join('')}</ul>`,
    },
    {
      id: 'sc-troubleshooting',
      title: 'Troubleshooting',
      body: `<div class="hub-start-center-trouble-grid">${TROUBLESHOOTING.map(
        (card) =>
          `<article class="hub-start-center-trouble-card">
            <h3>${esc(card.title)}</h3>
            <ul>${card.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
          </article>`
      ).join('')}</div>`,
    },
  ];

  function renderTopCards() {
    return `<div class="hub-start-center-top-cards" role="list">${TOP_CARDS.map(
      (c) =>
        `<button type="button" class="hub-start-center-top-card" data-scroll-target="${esc(c.id)}" role="listitem">
          <span class="hub-start-center-chip">${esc(c.chip)}</span>
          <strong>${esc(c.title)}</strong>
          <span>${esc(c.blurb)}</span>
        </button>`
    ).join('')}</div>`;
  }

  function renderSections() {
    return `<div class="hub-start-center-sections">${SECTIONS.map(
      (s) =>
        `<details class="hub-start-center-accordion" id="${esc(s.id)}"${s.open ? ' open' : ''}>
          <summary>${esc(s.title)}</summary>
          <div class="hub-start-center-accordion-body">${s.body}</div>
        </details>`
    ).join('')}</div>`;
  }

  function renderStartCenterHtml() {
    return `<div class="hub-start-center">
      ${renderTopCards()}
      ${renderSections()}
    </div>`;
  }

  function wireStartCenter(root) {
    if (!root) return;
    root.querySelectorAll('[data-scroll-target]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-scroll-target');
        const target = id ? document.getElementById(id) : null;
        if (!target) return;
        if (target.tagName === 'DETAILS' && !target.open) target.open = true;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target.classList.add('hub-start-center-flash');
        global.setTimeout(() => target.classList.remove('hub-start-center-flash'), 1200);
      });
    });
  }

  function renderStartCenter(root) {
    if (!root) return;
    root.innerHTML = renderStartCenterHtml();
    wireStartCenter(root);
  }

  global.HubStartCenter = {
    renderStartCenter,
    renderStartCenterHtml,
    wireStartCenter,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.HubStartCenter;
  }
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
