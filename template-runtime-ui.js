/**
 * WOS-62 — Template runtime: launch form, submit, submission detail, workflow actions.
 */
(function (global) {
  'use strict';

  function sb() {
    return global.TemplateSectionBuilder;
  }

  function esc(s) {
    if (s == null) return '';
    return sb()?.escapeHtml(String(s)) || String(s);
  }

  function hubFetch(path, opts) {
    if (typeof global.proxyFetch === 'function') return global.proxyFetch(path, opts);
    return fetch('/api/maintainx?path=' + encodeURIComponent(path), opts);
  }

  async function apiJson(path, opts) {
    const res = await hubFetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || res.statusText || 'Request failed');
      err.status = res.status;
      err.code = data.code;
      err.validation = data.validation;
      throw err;
    }
    return data;
  }

  function navigateToSubmission(submissionId) {
    if (typeof global.switchTab === 'function') {
      global.switchTab('hub-submission', { submissionId });
    }
    if (global.streamlineRouter) {
      global.streamlineRouter.setHash('#/submissions/' + submissionId);
    }
  }

  function showValidationSummary(root, errors) {
    const el = root.querySelector('#tmplRuntimeValidationSummary');
    if (!el) return;
    if (!errors?.length) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML = `<p class="tmpl-validation-fail">Please fix the following:</p><ul class="tmpl-validation-list">${errors
      .map(
        (e) =>
          `<li><strong>${esc(e.sectionTitle || 'Form')} · ${esc(e.fieldLabel || e.fieldKey)}</strong> — ${esc(e.message)}</li>`
      )
      .join('')}</ul>`;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderWorkflowProgress(steps, currentIndex, status) {
    if (!steps?.length) return '';
    const items = steps
      .map((s) => {
        let cls = 'tmpl-wf-step';
        if (s.status === 'completed') cls += ' is-done';
        else if (s.status === 'rejected') cls += ' is-rejected';
        else if (s.step_index === currentIndex && status === 'in_progress') cls += ' is-current';
        const payloadSummary = summarizeStepPayload(s);
        return `<li class="${cls}">
          <div class="tmpl-wf-step-head"><span class="tmpl-wf-step-type">${esc(s.step_type)}</span><span class="tmpl-wf-step-status">${esc(s.status)}</span></div>
          <div class="tmpl-wf-step-meta"><span class="tmpl-wf-step-role">${esc(s.assignee_role || '')}</span>${s.acted_by ? ` · ${esc(s.acted_by)}` : ''}${s.acted_at ? ` · ${esc(new Date(s.acted_at).toLocaleString())}` : ''}</div>
          ${payloadSummary ? `<div class="tmpl-wf-step-payload">${payloadSummary}</div>` : ''}
        </li>`;
      })
      .join('');
    return `<section class="tmpl-runtime-wf-progress"><h3>Workflow progress</h3><ol class="tmpl-wf-step-list">${items}</ol></section>`;
  }

  function summarizeStepPayload(step) {
    const p = step.payload_json || {};
    const parts = [];
    if (p.comment) parts.push(`Comment: ${esc(p.comment)}`);
    if (p.reason || p.reject_reason) parts.push(`Reason: ${esc(p.reason || p.reject_reason)}`);
    if (p.reference || p.file_reference) parts.push(`Reference: ${esc(p.reference || p.file_reference)}`);
    if (p.signature_text) parts.push(`Signature: ${esc(p.signature_text)}`);
    if (p.acknowledged) parts.push('Acknowledged');
    return parts.join(' · ');
  }

  function renderActionPanel(currentStep, canAct) {
    if (!currentStep || currentStep.status !== 'pending') {
      return '<p class="hub-sub">No action required on your role right now.</p>';
    }
    const type = currentStep.step_type;
    let controls = '';
    if (type === 'Review') {
      controls = `<button type="button" class="hub-btn hub-btn-primary tmpl-act-btn" data-action="approve">Approve review</button>
        <button type="button" class="hub-btn hub-btn-secondary tmpl-act-btn" data-action="request_changes">Request changes</button>
        <label class="hub-settings-field"><span>Comment</span><textarea class="input tmpl-act-comment" rows="2"></textarea></label>`;
    } else if (type === 'Approve') {
      controls = `<button type="button" class="hub-btn hub-btn-primary tmpl-act-btn" data-action="approve">Approve</button>
        <button type="button" class="hub-btn hub-btn-ghost tmpl-act-btn" data-action="reject">Reject</button>
        <label class="hub-settings-field tmpl-act-reject-reason" hidden><span>Reject reason (required)</span><textarea class="input tmpl-act-reason" rows="2"></textarea></label>`;
    } else if (type === 'Sign') {
      controls = `<label class="hub-settings-field"><span>Typed name (optional)</span><input class="input tmpl-act-signature" /></label>
        <label class="tmpl-preview-check"><input type="checkbox" class="tmpl-act-ack" /> I acknowledge and sign</label>
        <button type="button" class="hub-btn hub-btn-primary tmpl-act-btn" data-action="sign">Complete signature</button>`;
    } else if (type === 'Upload') {
      controls = `<label class="hub-settings-field"><span>File reference / URL / note</span><input class="input tmpl-act-upload-ref" placeholder="https://… or reference note" /></label>
        <button type="button" class="hub-btn hub-btn-primary tmpl-act-btn" data-action="upload">Save reference</button>`;
    } else if (type === 'Fill') {
      controls = `<button type="button" class="hub-btn hub-btn-primary tmpl-act-btn" data-action="complete">Mark fill complete</button>`;
    } else {
      controls = `<button type="button" class="hub-btn hub-btn-primary tmpl-act-btn" data-action="complete">Complete step</button>`;
    }
    return `<section class="tmpl-runtime-action-panel ${canAct ? '' : 'is-readonly'}">
      <h3>Action required: ${esc(type)}</h3>
      <p class="hub-sub">Assignee role: <strong>${esc(currentStep.assignee_role)}</strong></p>
      ${canAct ? controls : '<p class="hub-sub">Waiting for the assigned role or an admin.</p>'}
      <p id="tmplActionStatus" class="hub-settings-status" hidden></p>
    </section>`;
  }

  async function renderLaunchForm(root, entryId, options = {}) {
    if (!root) return;
    root.innerHTML = '<div class="hub-loading">Loading form…</div>';
    try {
      const data = await apiJson('/hub/launch/' + encodeURIComponent(entryId));
      const entry = data.launch_entry;
      const compiled = data.compiled || {};
      const sections = sb().normalizeSections({ sections: compiled.sections, fields: compiled.fields });
      root.innerHTML = renderRuntimeFormHtml({
        title: entry.label || data.template?.name,
        description: entry.description || data.template?.description,
        templateKind: data.template?.template_kind,
        spaceKey: entry.space_key,
        bindingMode: data.binding_mode,
        versionNumber: data.version?.version_number,
        sections,
      });
      if (options.showManageForm && data.template?.id) {
        const headerMain = root.querySelector('.hub-request-form-header-main, .tmpl-preview-header > div');
        if (headerMain && !headerMain.querySelector('.hub-request-manage-link')) {
          const link = document.createElement('a');
          link.className = 'hub-request-manage-link';
          link.href = '#/forms/' + encodeURIComponent(data.template.id);
          link.textContent = 'Manage form';
          headerMain.appendChild(link);
        }
      }
      const form = root.querySelector('#tmplRuntimeForm');
      root.querySelector('#tmplRuntimeCancelBtn')?.addEventListener('click', () => {
        if (typeof options.onCancel === 'function') {
          options.onCancel();
          return;
        }
        if (typeof global.switchTab === 'function') global.switchTab('hub-forms');
        if (global.streamlineRouter) global.streamlineRouter.setHash('#/forms');
      });
      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const values = sb().collectRuntimeValues(form);
        const errors = sb().clientValidateSubmission(sections, values);
        showValidationSummary(root, errors);
        if (errors.length) return;
        const btn = root.querySelector('#tmplRuntimeSubmitBtn');
        if (btn) {
          btn.disabled = true;
          btn.textContent = 'Submitting…';
        }
        try {
          const result = await apiJson('/hub/launch/' + encodeURIComponent(entryId) + '/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data_json: values }),
          });
          if (result.notice) global.showToast?.(result.notice, 'info');
          if (typeof options.onSubmitSuccess === 'function') {
            options.onSubmitSuccess(result.submission.id, result);
          } else {
            navigateToSubmission(result.submission.id);
          }
        } catch (err) {
          if (err.validation?.errors) showValidationSummary(root, err.validation.errors);
          else global.showToast?.(err.message, 'error');
          if (btn) {
            btn.disabled = false;
            btn.textContent = 'Submit';
          }
        }
      });
    } catch (err) {
      const msg =
        err.status === 403
          ? 'You do not have permission to open this launch entry.'
          : err.status === 404 || err.status === 410
            ? 'This launch entry is unavailable.'
            : err.message;
      root.innerHTML = `<div class="hub-panel"><div class="hub-panel-body pad"><div class="tmpl-api-error"><strong>Cannot open form</strong><p>${esc(msg)}</p>
        <button type="button" class="hub-btn hub-btn-ghost" id="tmplRuntimeBack">Back to New Request</button></div></div></div>`;
      root.querySelector('#tmplRuntimeBack')?.addEventListener('click', () => {
        if (typeof options.onCancel === 'function') {
          options.onCancel();
          return;
        }
        if (typeof global.switchTab === 'function') global.switchTab('hub-new-request');
        if (global.streamlineRouter) global.streamlineRouter.setHash('#/new-request');
      });
    }
  }

  function renderRuntimeFormHtml(opts) {
    return sb().renderRuntimeFormHtml(opts);
  }

  async function renderSubmissionDetail(root, submissionId) {
    if (!root) return;
    root.innerHTML = '<div class="hub-loading">Loading submission…</div>';
    try {
      const [detail, actions] = await Promise.all([
        apiJson('/hub/submissions/' + encodeURIComponent(submissionId)),
        apiJson('/hub/submissions/' + encodeURIComponent(submissionId) + '/actions').catch(() => null),
      ]);
      const compiled = detail.templateVersion?.compiled_workflow_json || {};
      const sections = sb().normalizeSections({ sections: compiled.sections, fields: compiled.fields });
      const meta = detail.submission;
      const spaceKey = detail.events?.[0]?.metadata_json?.space_key || 'forms';
      root.innerHTML = `<div class="tmpl-runtime-detail">
        <div class="tmpl-runtime-detail-head">
          <button type="button" class="hub-btn hub-btn-ghost" id="tmplSubBackSpace">← Forms</button>
          <div>
            <h2>${esc(detail.template?.name || 'Submission')}</h2>
            <p class="hub-sub">Official submission record</p>
          </div>
        </div>
        ${renderWorkflowProgress(detail.stepInstances, meta.current_step_index, meta.status)}
        ${renderActionPanel(actions?.current_step, actions?.can_act)}
        ${sb().renderReadOnlySubmissionHtml({
          title: detail.template?.name,
          templateKind: detail.template?.template_kind,
          spaceKey,
          status: meta.status,
          sections,
          data: meta.data_json,
          versionNumber: detail.templateVersion?.version_number,
          submissionId: meta.id,
          submittedBy: meta.created_by,
          submittedAt: new Date(meta.created_at).toLocaleString(),
        })}
        <section class="tmpl-runtime-history">
          <h3>History</h3>
          ${
            detail.events?.length
              ? `<ul class="tmpl-runtime-event-list">${detail.events
                  .map(
                    (ev) =>
                      `<li><span class="tmpl-event-time">${esc(new Date(ev.created_at).toLocaleString())}</span><span class="tmpl-event-type">${esc(ev.event_type)}</span>${ev.actor_email ? `<span class="tmpl-event-actor">${esc(ev.actor_email)}</span>` : ''}${ev.detail ? `<span class="tmpl-event-detail">${esc(ev.detail)}</span>` : ''}</li>`
                  )
                  .join('')}</ul>`
              : '<p class="hub-sub">No history events yet.</p>'
          }
        </section>
      </div>`;

      root.querySelector('#tmplSubBackSpace')?.addEventListener('click', () => {
        if (typeof global.switchTab === 'function') global.switchTab('hub-forms');
        if (global.streamlineRouter) global.streamlineRouter.setHash('#/forms');
      });

      const panel = root.querySelector('.tmpl-runtime-action-panel');
      if (panel && actions?.can_act && actions?.current_step) {
        const stepId = actions.current_step.id;
        const statusEl = root.querySelector('#tmplActionStatus');
        panel.querySelectorAll('.tmpl-act-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const action = btn.dataset.action;
            let payload = { action };
            if (action === 'reject') {
              payload.reason = root.querySelector('.tmpl-act-reason')?.value?.trim();
              if (!payload.reason) {
                const reasonWrap = panel.querySelector('.tmpl-act-reject-reason');
                if (reasonWrap) reasonWrap.hidden = false;
                global.showToast?.('Reject reason is required', 'error');
                return;
              }
            }
            if (action === 'request_changes' || action === 'approve') {
              payload.comment = root.querySelector('.tmpl-act-comment')?.value?.trim() || '';
            }
            if (action === 'sign') {
              payload.acknowledged = root.querySelector('.tmpl-act-ack')?.checked === true;
              payload.signature_text = root.querySelector('.tmpl-act-signature')?.value?.trim() || '';
              if (!payload.acknowledged) {
                global.showToast?.('Acknowledgment is required', 'error');
                return;
              }
            }
            if (action === 'upload') {
              payload.reference = root.querySelector('.tmpl-act-upload-ref')?.value?.trim();
              if (!payload.reference) {
                global.showToast?.('Reference is required', 'error');
                return;
              }
            }
            try {
              if (statusEl) {
                statusEl.hidden = false;
                statusEl.textContent = 'Saving…';
                statusEl.className = 'hub-settings-status is-loading';
              }
              await apiJson('/hub/submissions/' + submissionId + '/actions/' + stepId, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });
              global.showToast?.('Action saved', 'success');
              await renderSubmissionDetail(root, submissionId);
            } catch (err) {
              if (statusEl) {
                statusEl.textContent = err.message;
                statusEl.className = 'hub-settings-status is-error';
              }
              global.showToast?.(err.message, 'error');
            }
          });
        });
        panel.querySelector('[data-action="reject"]')?.addEventListener('click', () => {
          const reasonWrap = panel.querySelector('.tmpl-act-reject-reason');
          if (reasonWrap) reasonWrap.hidden = false;
        });
      }
    } catch (err) {
      root.innerHTML = `<div class="hub-settings-inline-warn"><strong>Submission unavailable</strong><span>${esc(err.message)}</span></div>`;
    }
  }

  global.TemplateRuntimeUI = {
    renderLaunchForm,
    renderSubmissionDetail,
    navigateToSubmission,
    _test: { renderWorkflowProgress, renderActionPanel },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TemplateRuntimeUI: global.TemplateRuntimeUI };
  }
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
