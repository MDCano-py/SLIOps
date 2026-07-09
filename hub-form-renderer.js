/**
 * Schema-based form renderer for Operations Workflow Hub.
 * Complex legacy forms (SWP, JSA, BOL) stay on custom_component + portal_tab.
 *
 * Supported schema_json field types:
 * text, textarea, select, multiselect, date, datetime, email, number,
 * checkbox, radio, file_upload, signature, section, repeater
 *
 * Usage:
 *   HubFormRenderer.render(container, formDefinition, { onSubmit, onCancel });
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

  function fieldClass(field) {
    return field.fullWidth ? 'hub-field hub-field--full' : 'hub-field';
  }

  function renderField(field, values) {
    const name = field.name;
    const val = values && name ? values[name] : '';
    const req = field.required ? ' required' : '';
    const id = `hub-f-${esc(name)}`;

    if (field.type === 'section') {
      return `<div class="hub-field-section"><h3 class="hub-field-section-title">${esc(field.label || field.title)}</h3>${field.description ? `<p class="hub-field-hint">${esc(field.description)}</p>` : ''}</div>`;
    }

    let control = '';
    switch (field.type) {
      case 'textarea':
        control = `<textarea id="${id}" name="${esc(name)}" rows="${field.rows || 4}"${req}>${esc(val)}</textarea>`;
        break;
      case 'select':
        control = `<select id="${id}" name="${esc(name)}"${req}>${(field.options || [])
          .map((o) => {
            const v = typeof o === 'object' ? o.value : o;
            const l = typeof o === 'object' ? o.label : o;
            const sel = String(val) === String(v) || (!val && field.default === v) ? ' selected' : '';
            return `<option value="${esc(v)}"${sel}>${esc(l)}</option>`;
          })
          .join('')}</select>`;
        break;
      case 'multiselect':
        control = `<select id="${id}" name="${esc(name)}" multiple${req}>${(field.options || [])
          .map((o) => {
            const v = typeof o === 'object' ? o.value : o;
            const l = typeof o === 'object' ? o.label : o;
            const arr = Array.isArray(val) ? val : String(val || '').split(',');
            const sel = arr.includes(String(v)) ? ' selected' : '';
            return `<option value="${esc(v)}"${sel}>${esc(l)}</option>`;
          })
          .join('')}</select>`;
        break;
      case 'checkbox':
        control = `<label class="hub-check"><input type="checkbox" id="${id}" name="${esc(name)}" value="1"${val ? ' checked' : ''}${req} /> ${esc(field.label)}</label>`;
        return `<div class="${fieldClass(field)}">${control}</div>`;
      case 'radio':
        control = (field.options || [])
          .map((o) => {
            const v = typeof o === 'object' ? o.value : o;
            const l = typeof o === 'object' ? o.label : o;
            return `<label class="hub-radio"><input type="radio" name="${esc(name)}" value="${esc(v)}"${String(val) === String(v) ? ' checked' : ''}${req} /> ${esc(l)}</label>`;
          })
          .join('');
        break;
      case 'date':
        control = `<input type="date" id="${id}" name="${esc(name)}" value="${esc(val)}"${req} />`;
        break;
      case 'datetime':
        control = `<input type="datetime-local" id="${id}" name="${esc(name)}" value="${esc(val)}"${req} />`;
        break;
      case 'file_upload':
        control = `<input type="file" id="${id}" name="${esc(name)}"${field.accept ? ` accept="${esc(field.accept)}"` : ''}${req} />`;
        break;
      case 'signature':
        control = `<div class="hub-signature-pad" data-name="${esc(name)}"><p class="hub-field-hint">Signature capture via client action link after submit.</p></div>`;
        break;
      case 'repeater':
        return `<div class="${fieldClass(field)} hub-repeater" data-repeater="${esc(name)}"><label>${esc(field.label)}</label><div class="hub-repeater-body"></div><button type="button" class="hub-btn hub-btn-ghost hub-repeater-add">Add row</button></div>`;
      case 'number':
        control = `<input type="number" id="${id}" name="${esc(name)}" value="${esc(val)}"${field.min != null ? ` min="${field.min}"` : ''}${field.max != null ? ` max="${field.max}"` : ''}${req} />`;
        break;
      case 'email':
        control = `<input type="email" id="${id}" name="${esc(name)}" value="${esc(val)}"${req} />`;
        break;
      default:
        control = `<input type="text" id="${id}" name="${esc(name)}" value="${esc(val)}"${req} placeholder="${esc(field.placeholder || '')}" />`;
    }

    if (field.type === 'checkbox') return control;
    if (field.type === 'radio') {
      return `<div class="${fieldClass(field)}"><span class="hub-field-label">${esc(field.label)}</span><div class="hub-radio-group">${control}</div></div>`;
    }

    return `<div class="${fieldClass(field)}"><label class="hub-field-label" for="${id}">${esc(field.label)}${field.required ? ' <span class="hub-req">*</span>' : ''}</label>${control}${field.hint ? `<p class="hub-field-hint">${esc(field.hint)}</p>` : ''}</div>`;
  }

  function collectFormData(formEl) {
    const fd = new FormData(formEl);
    const out = {};
    for (const [k, v] of fd.entries()) {
      if (out[k] !== undefined) {
        if (!Array.isArray(out[k])) out[k] = [out[k]];
        out[k].push(v);
      } else out[k] = v;
    }
    return out;
  }

  /**
   * @param {HTMLElement} container
   * @param {object} formDefinition — from registry (schema_json, title, workflow_steps)
   * @param {object} opts — { onSubmit, onCancel, initialValues }
   */
  function render(container, formDefinition, opts) {
    if (!container || !formDefinition) return;
    const schema = formDefinition.schema_json || [];
    const title = formDefinition.title || 'New request';
    const values = (opts && opts.initialValues) || {};
    const submitLabel = (opts && opts.submitLabel) || 'Submit request';
    const hideCancel = !!(opts && opts.hideCancel);
    const shell = global.HubRequestFormShell;
    const systemManaged = !!(opts && opts.systemManaged);
    const description =
      (opts && opts.description) ||
      (systemManaged
        ? 'Fill out the fields below and submit your request. This request type is managed by the system.'
        : '');
    const hint =
      opts && opts.formHint
        ? `<p class="hub-field-hint hub-form-hint">${esc(opts.formHint)}</p>`
        : formDefinition.source === 'fallback'
          ? '<p class="hub-field-hint hub-form-hint">Complete the fields below to submit your request.</p>'
          : '';

    let fieldsHtml = hint ? `<div class="hub-field--full">${hint}</div>` : '';
    fieldsHtml += `<div class="hub-request-form-section tmpl-preview-section-card"><div class="tmpl-preview-section-body hub-form-fields">`;
    schema.forEach((field) => {
      if (field.when) return;
      fieldsHtml += renderField(field, values);
    });
    fieldsHtml += `</div></div>`;

    const bodyHtml = `${fieldsHtml}
      <div class="hub-request-form-footer-host">${shell ? shell.renderFooterHtml({ submitLabel, hideCancel }) : `<div class="hub-form-footer"><button type="submit" class="hub-btn hub-btn-primary">${esc(submitLabel)}</button>${hideCancel ? '' : '<button type="button" class="hub-btn hub-btn-ghost" data-hub-form-cancel>Cancel</button>'}</div>`}</div>`;

    const wrapped = shell
      ? shell.wrapFormShell(bodyHtml, {
          title,
          description,
          systemManaged,
          eyebrow: systemManaged ? shell.systemManagedEyebrow(title) : 'Start request',
          showManageForm: false,
        })
      : `<form class="hub-dynamic-form" id="hubDynamicForm"><div class="hub-panel-title">${esc(title)}</div>${bodyHtml}</form>`;

    container.innerHTML = shell
      ? `<form class="hub-dynamic-form hub-request-form-runtime" id="hubDynamicForm">${wrapped}</form>`
      : wrapped;

    const form = container.querySelector('#hubDynamicForm');
    form.querySelector('[data-hub-form-cancel]')?.addEventListener('click', () => {
      if (opts && opts.onCancel) opts.onCancel();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = collectFormData(form);
      if (opts && opts.onSubmit) opts.onSubmit(data, formDefinition);
    });
    return form;
  }

  global.HubFormRenderer = { render, renderField, collectFormData, esc };
})(typeof window !== 'undefined' ? window : global);
