/**
 * Workflow builder — add/reorder/remove steps before sending a document.
 * Used on New Request (schema forms) and admin workflow edit on request detail.
 *
 * Each step: action_type (fill|review|sign|approve), assignee email, instructions,
 * requires_signature, review_required.
 */
(function (global) {
  'use strict';

  const ACTION_TYPES = [
    { value: 'fill', label: 'Fill', desc: 'Complete form fields' },
    { value: 'review', label: 'Review', desc: 'Approve / reject / comment' },
    { value: 'sign', label: 'Sign', desc: 'Signature required' },
    { value: 'approve', label: 'Approve', desc: 'Final approval' },
  ];

  function esc(s) {
    if (s == null) return '';
    if (typeof global.escapeHtml === 'function') return global.escapeHtml(s);
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeStep(raw, order) {
    const action = raw.action_type || raw.step_type || 'review';
    return {
      step_order: order,
      step_type: action,
      action_type: action,
      step_title: raw.step_title || `${action.charAt(0).toUpperCase()}${action.slice(1)} — step ${order}`,
      assigned_to_email: raw.assigned_to_email || '',
      assigned_to_name: raw.assigned_to_name || raw.assigned_to_email || '',
      instructions: raw.instructions || '',
      requires_signature: action === 'sign' || !!raw.requires_signature,
      review_required: action === 'review' || action === 'approve' || !!raw.review_required,
      required: raw.required !== false,
      due_at: raw.due_at || null,
      status: raw.status || 'not_started',
    };
  }

  function actionToggleGroup(step, index) {
    return `<div class="hub-wf-action-toggles" role="group" aria-label="Step ${index + 1} action type">
      ${ACTION_TYPES.map(
        (a) =>
          `<button type="button" class="hub-wf-action-btn${step.action_type === a.value ? ' is-active' : ''}" data-action="${a.value}" title="${esc(a.desc)}">${esc(a.label)}</button>`
      ).join('')}
      <input type="hidden" data-field="action_type" value="${esc(step.action_type)}" />
    </div>`;
  }

  function renderStepRow(step, index, total) {
    return `<div class="hub-wf-step hub-wf-step--${esc(step.action_type)}" data-step-index="${index}">
      <div class="hub-wf-step-head">
        <span class="hub-wf-step-num">${index + 1}</span>
        ${actionToggleGroup(step, index)}
        <input type="text" class="hub-wf-title" data-field="step_title" value="${esc(step.step_title)}" placeholder="Step title" aria-label="Step title" />
        <div class="hub-wf-step-actions">
          <button type="button" class="hub-btn hub-btn-ghost hub-wf-up" title="Move up"${index === 0 ? ' disabled' : ''}>↑</button>
          <button type="button" class="hub-btn hub-btn-ghost hub-wf-down" title="Move down"${index >= total - 1 ? ' disabled' : ''}>↓</button>
          <button type="button" class="hub-btn hub-btn-ghost hub-wf-remove" title="Remove step" aria-label="Remove step">×</button>
        </div>
      </div>
      <div class="hub-wf-step-body">
        <div class="hub-wf-field hub-wf-field--full">
          <label class="hub-field-label">Assignee email</label>
          <input type="email" class="hub-wf-email" data-field="assigned_to_email" value="${esc(step.assigned_to_email)}" placeholder="name@company.com" />
        </div>
        <div class="hub-wf-field hub-wf-field--full">
          <label class="hub-field-label">Instructions (optional)</label>
          <input type="text" class="hub-wf-instructions" data-field="instructions" value="${esc(step.instructions)}" placeholder="What should they do?" />
        </div>
        <label class="hub-check hub-wf-flag hub-wf-flag-sig"><input type="checkbox" data-field="requires_signature"${step.requires_signature ? ' checked' : ''} /> Requires signature</label>
        <label class="hub-check hub-wf-flag hub-wf-flag-rev"><input type="checkbox" data-field="review_required"${step.review_required ? ' checked' : ''} /> Requires review</label>
      </div>
    </div>`;
  }

  function syncActionFlags(row) {
    const action = row.querySelector('[data-field="action_type"]')?.value || 'review';
    row.classList.remove('hub-wf-step--fill', 'hub-wf-step--review', 'hub-wf-step--sign', 'hub-wf-step--approve');
    row.classList.add(`hub-wf-step--${action}`);
    const sig = row.querySelector('[data-field="requires_signature"]');
    const rev = row.querySelector('[data-field="review_required"]');
    if (action === 'sign') {
      if (sig) sig.checked = true;
    } else if (action === 'review' || action === 'approve') {
      if (rev) rev.checked = true;
    }
  }

  function wireStepRow(row) {
    row.querySelectorAll('.hub-wf-action-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        row.querySelectorAll('.hub-wf-action-btn').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        const hidden = row.querySelector('[data-field="action_type"]');
        if (hidden) hidden.value = btn.dataset.action;
        syncActionFlags(row);
      });
    });
  }

  function readStepsFromDom(container) {
    const rows = container.querySelectorAll('.hub-wf-step');
    const steps = [];
    rows.forEach((row, i) => {
      const action =
        row.querySelector('[data-field="action_type"]')?.value ||
        row.querySelector('.hub-wf-action-btn.is-active')?.dataset.action ||
        'review';
      steps.push(
        normalizeStep(
          {
            step_order: i + 1,
            action_type: action,
            step_type: action,
            step_title: row.querySelector('[data-field="step_title"]')?.value || '',
            assigned_to_email: row.querySelector('[data-field="assigned_to_email"]')?.value?.trim() || '',
            assigned_to_name: row.querySelector('[data-field="assigned_to_email"]')?.value?.trim() || '',
            instructions: row.querySelector('[data-field="instructions"]')?.value || '',
            requires_signature: row.querySelector('[data-field="requires_signature"]')?.checked,
            review_required: row.querySelector('[data-field="review_required"]')?.checked,
          },
          i + 1
        )
      );
    });
    return steps;
  }

  function render(container, opts) {
    if (!container) return;
    const steps = (opts.initialSteps || []).map((s, i) => normalizeStep(s, i + 1));
    const readOnly = !!opts.readOnly;
    const showSaveTemplate = !!opts.showSaveTemplate && !readOnly;

    container.innerHTML = `
      <div class="hub-wf-builder">
        <div class="hub-wf-builder-head">
          <h3>Workflow routing</h3>
          <p class="hub-sub">Add steps in order. Routed workflows need at least <strong>2 assigned steps</strong> (review, sign, or approve). Fill-only can be a single self-assigned step.</p>
        </div>
        <div class="hub-wf-steps" id="hubWfStepsList">${steps.length ? steps.map((s, i) => renderStepRow(s, i, steps.length)).join('') : '<p class="hub-wf-empty">No steps yet — click “Add step” below.</p>'}</div>
        ${
          readOnly
            ? ''
            : `<div class="hub-wf-toolbar">
          <button type="button" class="hub-btn hub-btn-ghost" id="hubWfAddStep">+ Add step</button>
          ${showSaveTemplate ? '<button type="button" class="hub-btn hub-btn-ghost" id="hubWfSaveTemplate">Save as type default</button>' : ''}
        </div>`
        }
        <p class="hub-wf-validation" id="hubWfValidation" hidden></p>
      </div>`;

    container.querySelectorAll('.hub-wf-step').forEach(wireStepRow);

    if (readOnly) return;

    container.querySelector('#hubWfAddStep')?.addEventListener('click', () => {
      const current = readStepsFromDom(container);
      current.push(normalizeStep({ action_type: 'review', step_title: 'Review' }, current.length + 1));
      opts.initialSteps = current;
      render(container, opts);
      if (opts.onChange) opts.onChange(getSteps(container));
    });

    const list = container.querySelector('#hubWfStepsList');
    list?.addEventListener('click', (e) => {
      const row = e.target.closest('.hub-wf-step');
      if (!row) return;
      const idx = parseInt(row.dataset.stepIndex, 10);
      const current = readStepsFromDom(container);
      if (e.target.closest('.hub-wf-remove')) {
        current.splice(idx, 1);
        opts.initialSteps = current;
        render(container, opts);
        if (opts.onChange) opts.onChange(getSteps(container));
        return;
      }
      if (e.target.closest('.hub-wf-up') && idx > 0) {
        [current[idx - 1], current[idx]] = [current[idx], current[idx - 1]];
        opts.initialSteps = current;
        render(container, opts);
        if (opts.onChange) opts.onChange(getSteps(container));
        return;
      }
      if (e.target.closest('.hub-wf-down') && idx < current.length - 1) {
        [current[idx], current[idx + 1]] = [current[idx + 1], current[idx]];
        opts.initialSteps = current;
        render(container, opts);
        if (opts.onChange) opts.onChange(getSteps(container));
      }
    });

    list?.addEventListener('change', () => {
      if (opts.onChange) opts.onChange(getSteps(container));
    });
    list?.addEventListener('input', () => {
      if (opts.onChange) opts.onChange(getSteps(container));
    });

    container.querySelector('#hubWfSaveTemplate')?.addEventListener('click', () => {
      if (opts.onSaveTemplate) opts.onSaveTemplate(getSteps(container));
    });
  }

  function getSteps(container) {
    if (!container) return [];
    return readStepsFromDom(container);
  }

  function validateSteps(steps, { fillOnlyOk = true } = {}) {
    if (!steps.length) return { ok: true, message: '' };
    const routed = steps.filter((s) => s.action_type !== 'fill');
    if (routed.length >= 2) {
      const missing = routed.filter((s) => !s.assigned_to_email);
      if (missing.length) return { ok: false, message: 'Each routed step needs an assignee email.' };
      return { ok: true, message: '' };
    }
    if (steps.length === 1 && steps[0].action_type === 'fill' && fillOnlyOk) {
      return { ok: true, message: '' };
    }
    return {
      ok: false,
      message:
        'Add at least 2 routed steps (Review, Sign, or Approve) with assignee emails, or use a single Fill step for self-assigned forms.',
    };
  }

  function showValidation(container, result) {
    const el = container?.querySelector('#hubWfValidation');
    if (!el) return result.ok;
    el.hidden = result.ok;
    el.textContent = result.message || '';
    el.className = result.ok ? 'hub-wf-validation' : 'hub-wf-validation is-error';
    return result.ok;
  }

  global.HubWorkflowBuilder = {
    render,
    getSteps,
    validateSteps,
    showValidation,
    normalizeStep,
  };
})(typeof window !== 'undefined' ? window : global);
