/**
 * WOS-61 — Sectioned schema builder helpers + preview renderer.
 */
(function (global) {
  'use strict';

  const FIELD_TYPES_UI = [
    { value: 'text', label: 'Text' },
    { value: 'long_text', label: 'Long text' },
    { value: 'dropdown', label: 'Dropdown' },
    { value: 'checkbox', label: 'Checkbox' },
    { value: 'date', label: 'Date' },
    { value: 'email', label: 'Email' },
    { value: 'number', label: 'Number' },
    { value: 'file_ref', label: 'File reference' },
    { value: 'signature_ack', label: 'Signature acknowledgment' },
  ];

  const FIELD_TYPES_STORAGE = FIELD_TYPES_UI.map((t) => t.value);

  function slugId(prefix, seed) {
    const base = String(seed || 'item')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_+/g, '_')
      .slice(0, 48);
    return `${prefix}${base || 'item'}`;
  }

  function normalizeField(field) {
    const key = String(field?.key || '').trim();
    return {
      id: String(field?.id || slugId('field_', key || 'field')).trim(),
      key,
      label: String(field?.label || key || '').trim(),
      type: field?.type || 'text',
      required: field?.required === true,
      options: Array.isArray(field?.options) ? field.options.map(String) : [],
    };
  }

  function normalizeSections(schema_json, opts = {}) {
    const raw = schema_json && typeof schema_json === 'object' ? schema_json : {};
    let sectionsInput = [];
    if (Array.isArray(raw.sections) && raw.sections.length) {
      sectionsInput = raw.sections;
    } else if (Array.isArray(raw.fields) && raw.fields.length) {
      sectionsInput = [{ id: 'sec_default', title: 'Details', description: '', fields: raw.fields }];
    } else {
      sectionsInput = [{ id: 'sec_default', title: 'Details', description: '', fields: [] }];
    }
    return sectionsInput.map((sec, si) => ({
      id: String(sec.id || slugId('sec_', sec.title || `section_${si}`)).trim(),
      title: String(sec.title || 'Details').trim() || 'Details',
      description: sec.description != null ? String(sec.description) : '',
      collapsed: !!sec.collapsed,
      fields: (Array.isArray(sec.fields) ? sec.fields : []).map(normalizeField),
    }));
  }

  function flattenFieldKeys(sections) {
    const keys = [];
    (sections || []).forEach((sec) => {
      (sec.fields || []).forEach((f) => {
        if (f.key) keys.push(f.key);
      });
    });
    return keys;
  }

  function buildPayloadFromSections(sections, steps) {
    return {
      schema_json: {
        sections: (sections || []).map((sec) => ({
          id: sec.id,
          title: sec.title,
          description: sec.description || '',
          fields: (sec.fields || []).map((f) => {
            const out = {
              id: f.id || slugId('field_', f.key),
              key: f.key,
              label: f.label,
              type: f.type,
              required: f.required === true,
            };
            if (f.type === 'select' || f.type === 'dropdown') out.options = f.options;
            return out;
          }),
        })),
      },
      workflow_json: {
        steps: (steps || []).map((s) => {
          const out = { step_type: s.step_type, assignee_role: s.assignee_role };
          if (['Fill', 'Upload'].includes(s.step_type) && s.field_keys?.length) {
            out.field_keys = [...s.field_keys];
          }
          if (s.label) out.label = s.label;
          return out;
        }),
      },
    };
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

  function duplicateSection(sections, index) {
    const src = sections[index];
    if (!src) return sections;
    const copy = {
      ...src,
      id: slugId('sec_', `${src.title}_copy`),
      title: `${src.title} (copy)`,
      fields: (src.fields || []).map((f) => ({
        ...f,
        id: slugId('field_', `${f.key}_copy`),
        key: `${f.key}_copy`,
      })),
    };
    const out = sections.slice();
    out.splice(index + 1, 0, copy);
    return out;
  }

  function fieldTypeLabel(type) {
    const canonical = String(type || 'text');
    const labels = {
      text: 'Text',
      long_text: 'Long text',
      dropdown: 'Dropdown',
      checkbox: 'Checkbox',
      date: 'Date',
      email: 'Email',
      number: 'Number',
      file_ref: 'File reference',
      signature_ack: 'Signature',
      textarea: 'Long text',
      select: 'Dropdown',
      file: 'File reference',
    };
    return labels[canonical] || FIELD_TYPES_UI.find((t) => t.value === canonical)?.label || canonical;
  }

  function fieldLabelForType(type) {
    return fieldTypeLabel(type);
  }

  /** Small inline SVG icon per field type (Streamline design system — not copied from external UIs). */
  function fieldTypeIconHtml(type) {
    const t = normalizeFieldType(type);
    const icons = {
      text: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>',
      long_text: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h10M4 18h14"/></svg>',
      dropdown: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>',
      checkbox: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12l2 2 4-4"/></svg>',
      date: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
      email: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/></svg>',
      number: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9h16M4 15h16M10 3v18M14 3v18"/></svg>',
      file_ref: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
      signature_ack: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17c3-3 6-8 10-8 2 0 4 2 4 4s-2 4-4 4H5"/><path d="M17 17l3 3"/></svg>',
    };
    return icons[t] || icons.text;
  }

  function wrapPreviewFrame(title, innerHtml) {
    const safeTitle = escapeHtml(title || 'Form preview');
    return `<div class="tmpl-preview-frame">
      <div class="tmpl-preview-frame-chrome">
        <span class="tmpl-preview-frame-title">${safeTitle}</span>
        <span class="tmpl-preview-frame-sub">Updates as you edit</span>
      </div>
      <div class="tmpl-preview-frame-body">${innerHtml || ''}</div>
    </div>`;
  }

  function renderImportPreviewPanel({ sections, sectionCount, fieldCount, warningsGrouped, validation, publishNotices }) {
    const warnGroups = warningsGrouped || {};
    const warnLabels = {
      type_mapping: 'Type mapping',
      duplicate_keys: 'Duplicate keys',
      unsupported: 'Unsupported content',
      sanitization: 'Sanitization',
      general: 'Other',
    };
    let warningsHtml = '';
    for (const [key, items] of Object.entries(warnGroups)) {
      if (!items?.length) continue;
      warningsHtml += `<div class="tmpl-import-warn-group"><h5>${escapeHtml(warnLabels[key] || key)}</h5><ul>${items.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul></div>`;
    }
    if (!warningsHtml) {
      warningsHtml = '<p class="tmpl-import-warn-none">No import warnings.</p>';
    }

    const valHtml = validation?.ok
      ? '<p class="tmpl-validation-ok">Schema validation passed.</p>'
      : validation?.errors?.length
        ? `<p class="tmpl-validation-fail">${validation.errors.length} schema issue${validation.errors.length === 1 ? '' : 's'}</p>${formatValidationErrorsGrouped(validation.errors, sections || [])}`
        : '';

    const noticesHtml = (publishNotices || []).length
      ? `<div class="tmpl-import-notice-panel">${publishNotices.map((n) => `<p class="tmpl-import-notice">${escapeHtml(n)}</p>`).join('')}</div>`
      : '';

    const sectionCards = (sections || [])
      .map(
        (sec) => `<section class="tmpl-import-preview-section">
          <header class="tmpl-import-preview-section-head"><h4>${escapeHtml(sec.title)}</h4><span class="tmpl-import-field-count">${(sec.fields || []).length} fields</span></header>
          <div class="tmpl-import-field-rows">${(sec.fields || [])
            .map(
              (f) =>
                `<div class="tmpl-import-field-row">
                  <span class="tmpl-import-field-label">${escapeHtml(f.label)}</span>
                  <code class="tmpl-import-field-type">${escapeHtml(f.type)}</code>
                  ${f.required ? '<span class="tmpl-import-req-badge">Required</span>' : '<span class="tmpl-import-opt-badge">Optional</span>'}
                </div>`
            )
            .join('') || '<p class="hub-sub">No fields</p>'}
          </div>
        </section>`
      )
      .join('');

    return `<div class="tmpl-import-preview-panel">
      <div class="tmpl-import-stats"><span><strong>${sectionCount ?? (sections || []).length}</strong> sections</span><span><strong>${fieldCount ?? flattenFieldKeys(sections).length}</strong> fields</span></div>
      <div class="tmpl-import-preview-sections">${sectionCards || '<p class="hub-sub">No sections to preview.</p>'}</div>
      <div class="tmpl-import-side-panels">
        <div class="tmpl-import-warnings-panel"><h4>Warnings</h4>${warningsHtml}</div>
        <div class="tmpl-import-validation-panel"><h4>Schema validation</h4>${valHtml}${noticesHtml}</div>
      </div>
    </div>`;
  }

  function renderPreviewField(field) {
    const req = field.required ? '<span class="tmpl-preview-req" aria-hidden="true">*</span>' : '';
    const label = `<label class="tmpl-preview-label">${escapeHtml(field.label)}${req}</label>`;
    const disabled = ' disabled';
    const type = normalizeFieldType(field.type);
    let control = '';
    switch (type) {
      case 'textarea':
        control = `<textarea class="tmpl-preview-input" rows="3"${disabled} placeholder="Long text"></textarea>`;
        break;
      case 'select':
        control = `<select class="tmpl-preview-input"${disabled}><option>— Select —</option>${(field.options || [])
          .map((o) => `<option>${escapeHtml(o)}</option>`)
          .join('')}</select>`;
        break;
      case 'checkbox':
        control = `<label class="tmpl-preview-check"><input type="checkbox"${disabled} /> <span>Yes</span></label>`;
        break;
      case 'date':
        control = `<input type="date" class="tmpl-preview-input"${disabled} />`;
        break;
      case 'email':
        control = `<input type="email" class="tmpl-preview-input"${disabled} placeholder="name@example.com" />`;
        break;
      case 'number':
        control = `<input type="number" class="tmpl-preview-input"${disabled} />`;
        break;
      case 'file':
        control = `<div class="tmpl-preview-file"><span class="tmpl-preview-file-icon">📎</span> File attachment (preview)</div>`;
        break;
      case 'signature_ack':
        control = `<div class="tmpl-preview-signature"><span>✍</span> Signature acknowledgment (preview)</div>`;
        break;
      default:
        control = `<input type="text" class="tmpl-preview-input"${disabled} />`;
    }
    return `<div class="tmpl-preview-field" data-field-key="${escapeHtml(field.key)}">${label}${control}</div>`;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderPreviewHtml({ title, templateKind, sections, bindingMode }) {
    const kind = templateKind || 'form';
    const binding =
      bindingMode === 'required'
        ? 'Required workflow'
        : bindingMode === 'optional'
          ? 'Optional workflow'
          : 'No workflow attached';
    const sectionHtml = (sections || [])
      .map(
        (sec) => `<section class="tmpl-preview-section-card">
          <header class="tmpl-preview-section-head">
            <h3>${escapeHtml(sec.title)}</h3>
            ${sec.description ? `<p class="tmpl-preview-section-desc">${escapeHtml(sec.description)}</p>` : ''}
          </header>
          <div class="tmpl-preview-section-body">${(sec.fields || []).map(renderPreviewField).join('') || '<p class="hub-sub">No fields in this section.</p>'}</div>
        </section>`
      )
      .join('');
    return `<div class="tmpl-preview-shell">
      <header class="tmpl-preview-header">
        <div>
          <p class="tmpl-preview-eyebrow">Streamline form preview</p>
          <h2 class="tmpl-preview-title">${escapeHtml(title || 'Untitled template')}</h2>
        </div>
        <div class="tmpl-preview-badges">
          <span class="tmpl-preview-kind-badge">${escapeHtml(kind)}</span>
          <span class="tmpl-preview-binding-badge">${escapeHtml(binding)}</span>
        </div>
      </header>
      <div class="tmpl-preview-sections">${sectionHtml || '<p class="hub-sub">Add sections to preview the form.</p>'}</div>
      <footer class="tmpl-preview-footer">
        <button type="button" class="hub-btn hub-btn-primary" disabled>Submit preview</button>
        <span class="hub-sub">Preview only — not a live submission</span>
      </footer>
    </div>`;
  }

  function lookupFieldMeta(path, sections) {
    const m = String(path || '').match(/sections\[(\d+)\](?:\.fields\[(\d+)\])?/);
    if (!m) return null;
    const sec = sections[Number(m[1])];
    if (!sec) return { sectionTitle: null, sectionId: null, fieldLabel: null, fieldKey: null };
    const fi = m[2] != null ? Number(m[2]) : null;
    const field = fi != null ? sec.fields?.[fi] : null;
    return {
      sectionTitle: sec.title,
      sectionId: sec.id,
      fieldLabel: field?.label || null,
      fieldKey: field?.key || null,
    };
  }

  function categorizeValidationPath(path) {
    const p = String(path || '');
    if (p.includes('workflow') || p.includes('steps')) return 'Workflow';
    if (p.includes('launch')) return 'Launch';
    if (p.includes('sections[') || p.includes('fields[')) return 'Fields';
    if (p.includes('section')) return 'Sections';
    return 'General';
  }

  function groupValidationErrors(errors, sections) {
    const groups = { Fields: [], Sections: [], Workflow: [], Launch: [], General: [] };
    (errors || []).forEach((e) => {
      const cat = categorizeValidationPath(e.path);
      const meta = lookupFieldMeta(e.path, sections);
      groups[cat] = groups[cat] || [];
      groups[cat].push({ ...e, ...meta });
    });
    return groups;
  }

  function formatValidationErrorsGrouped(errors, sections, opts = {}) {
    const groups = groupValidationErrors(errors, sections);
    const total = (errors || []).length;
    if (!total) return '';
    let html = `<p class="tmpl-val-count">${total} issue${total === 1 ? '' : 's'}</p>`;
    for (const [name, items] of Object.entries(groups)) {
      if (!items.length) continue;
      html += `<div class="tmpl-val-group"><h4 class="tmpl-val-group-title">${escapeHtml(name)} <span class="tmpl-val-group-count">${items.length}</span></h4><ul class="tmpl-validation-list">`;
      html += items
        .map((e) => {
          const parts = [];
          if (e.sectionTitle) parts.push(`Section: ${e.sectionTitle}`);
          if (e.fieldLabel) parts.push(`Field: ${e.fieldLabel}`);
          else if (e.fieldKey) parts.push(`Key: ${e.fieldKey}`);
          const where = parts.length ? `<span class="tmpl-val-where">${escapeHtml(parts.join(' · '))}</span>` : '';
          const goto =
            opts.linkGoto && (e.sectionId || e.fieldKey)
              ? ` <button type="button" class="hub-btn hub-btn-ghost hub-btn-sm tmpl-val-goto" data-section-id="${escapeHtml(e.sectionId || '')}" data-field-key="${escapeHtml(e.fieldKey || '')}">Go to</button>`
              : '';
          return `<li><code>${escapeHtml(e.code || '')}</code> ${where}<br/><span>${escapeHtml(e.message)}</span>${goto}</li>`;
        })
        .join('');
      html += '</ul></div>';
    }
    return html;
  }

  function formatValidationErrors(errors, sections) {
    if (!errors?.length) return '';
    return errors
      .map((e) => {
        const meta = lookupFieldMeta(e.path, sections);
        const parts = [];
        if (meta?.sectionTitle) parts.push(`Section: ${meta.sectionTitle}`);
        else if (e.path?.includes('sections[')) parts.push(`Section id: ${meta?.sectionId || '—'}`);
        if (meta?.fieldLabel) parts.push(`Field: ${meta.fieldLabel}`);
        else if (meta?.fieldKey) parts.push(`Field key: ${meta.fieldKey}`);
        const where = parts.length ? `<span class="tmpl-val-where">${escapeHtml(parts.join(' · '))}</span>` : '';
        return `<li><code>${escapeHtml(e.code || '')}</code> ${where}<br/><span>${escapeHtml(e.message)}</span></li>`;
      })
      .join('');
  }

  function normalizeFieldType(type) {
    const t = String(type || 'text').toLowerCase();
    if (t === 'long_text') return 'textarea';
    if (t === 'dropdown') return 'select';
    if (t === 'file_ref') return 'file';
    return t;
  }

  function clientValidateSubmission(sections, values) {
    const errors = [];
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    (sections || []).forEach((sec, si) => {
      (sec.fields || []).forEach((field, fi) => {
        const type = normalizeFieldType(field.type);
        const val = values[field.key];
        const empty =
          type === 'checkbox'
            ? val !== true
            : type === 'signature_ack'
              ? val?.acknowledged !== true
              : val == null || (typeof val === 'string' && !val.trim());
        if (field.required && empty) {
          errors.push({
            code: 'REQUIRED_FIELD',
            sectionTitle: sec.title,
            fieldKey: field.key,
            fieldLabel: field.label,
            message: `${field.label || field.key} is required`,
          });
        }
        if (!empty && type === 'email' && !EMAIL_RE.test(String(val).trim())) {
          errors.push({
            code: 'INVALID_EMAIL',
            sectionTitle: sec.title,
            fieldKey: field.key,
            fieldLabel: field.label,
            message: `${field.label || field.key} must be a valid email`,
          });
        }
        if (!empty && type === 'number' && Number.isNaN(Number(val))) {
          errors.push({
            code: 'INVALID_NUMBER',
            sectionTitle: sec.title,
            fieldKey: field.key,
            fieldLabel: field.label,
            message: `${field.label || field.key} must be a number`,
          });
        }
      });
    });
    return errors;
  }

  function renderRuntimeField(field, value, error) {
    const type = normalizeFieldType(field.type);
    const req = field.required ? '<span class="tmpl-preview-req" aria-hidden="true">*</span>' : '';
    const err = error ? `<p class="tmpl-runtime-field-error">${escapeHtml(error)}</p>` : '';
    const label = `<label class="tmpl-preview-label" for="rt_${escapeHtml(field.key)}">${escapeHtml(field.label)}${req}</label>`;
    const key = escapeHtml(field.key);
    let control = '';
    switch (type) {
      case 'textarea':
        control = `<textarea class="tmpl-preview-input tmpl-runtime-input" id="rt_${key}" name="${key}" data-field-key="${key}" rows="3">${escapeHtml(value || '')}</textarea>`;
        break;
      case 'select':
        control = `<select class="tmpl-preview-input tmpl-runtime-input" id="rt_${key}" name="${key}" data-field-key="${key}">
          <option value="">— Select —</option>
          ${(field.options || [])
            .map((o) => `<option value="${escapeHtml(o)}"${value === o ? ' selected' : ''}>${escapeHtml(o)}</option>`)
            .join('')}
        </select>`;
        break;
      case 'checkbox':
        control = `<label class="tmpl-preview-check"><input type="checkbox" class="tmpl-runtime-input" id="rt_${key}" name="${key}" data-field-key="${key}"${value === true ? ' checked' : ''} /> <span>Yes</span></label>`;
        break;
      case 'date':
        control = `<input type="date" class="tmpl-preview-input tmpl-runtime-input" id="rt_${key}" name="${key}" data-field-key="${key}" value="${escapeHtml(value || '')}" />`;
        break;
      case 'email':
        control = `<input type="email" class="tmpl-preview-input tmpl-runtime-input" id="rt_${key}" name="${key}" data-field-key="${key}" value="${escapeHtml(value || '')}" placeholder="name@example.com" />`;
        break;
      case 'number':
        control = `<input type="number" class="tmpl-preview-input tmpl-runtime-input" id="rt_${key}" name="${key}" data-field-key="${key}" value="${escapeHtml(value != null ? value : '')}" />`;
        break;
      case 'file':
        control = `<input type="text" class="tmpl-preview-input tmpl-runtime-input" id="rt_${key}" name="${key}" data-field-key="${key}" value="${escapeHtml(typeof value === 'string' ? value : value?.reference || '')}" placeholder="File URL or reference (paste link or note)" />
          <p class="hub-sub tmpl-runtime-hint">File reference only — attach a URL or description until upload is wired.</p>`;
        break;
      case 'signature_ack':
        control = `<label class="tmpl-preview-check tmpl-runtime-signature">
          <input type="checkbox" class="tmpl-runtime-input" id="rt_${key}" name="${key}" data-field-key="${key}" data-signature="1"${value?.acknowledged ? ' checked' : ''} />
          <span>I acknowledge: ${escapeHtml(field.label)}</span>
        </label>`;
        break;
      default:
        control = `<input type="text" class="tmpl-preview-input tmpl-runtime-input" id="rt_${key}" name="${key}" data-field-key="${key}" value="${escapeHtml(value || '')}" />`;
    }
    return `<div class="tmpl-preview-field tmpl-runtime-field${error ? ' has-error' : ''}" data-field-key="${key}">${label}${control}${err}</div>`;
  }

  function renderRuntimeFormHtml({ title, description, templateKind, spaceKey, bindingMode, sections, fieldErrors, versionNumber }) {
    const errMap = {};
    (fieldErrors || []).forEach((e) => {
      if (e.fieldKey) errMap[e.fieldKey] = e.message;
    });
    const binding =
      bindingMode === 'required'
        ? 'Required workflow'
        : bindingMode === 'optional'
          ? 'Optional workflow'
          : 'No workflow attached';
    const sectionHtml = (sections || [])
      .map(
        (sec) => `<section class="tmpl-preview-section-card">
          <header class="tmpl-preview-section-head">
            <h3>${escapeHtml(sec.title)}</h3>
            ${sec.description ? `<p class="tmpl-preview-section-desc">${escapeHtml(sec.description)}</p>` : ''}
          </header>
          <div class="tmpl-preview-section-body">${(sec.fields || [])
            .map((f) => renderRuntimeField(f, null, errMap[f.key]))
            .join('')}</div>
        </section>`
      )
      .join('');
    const versionBadge =
      versionNumber != null
        ? `<span class="tmpl-preview-version-badge">v${escapeHtml(versionNumber)}</span>`
        : '';
    return `<form id="tmplRuntimeForm" class="tmpl-runtime-form hub-request-form-runtime" novalidate>
      <div id="tmplRuntimeValidationSummary" class="tmpl-runtime-validation-summary" hidden></div>
      <div class="tmpl-preview-shell tmpl-runtime-shell hub-request-form-shell">
        <header class="tmpl-preview-header hub-request-form-header">
          <div class="hub-request-form-header-main">
            <p class="tmpl-preview-eyebrow">Published form · Fill out and submit</p>
            <h2 class="tmpl-preview-title hub-request-form-title">${escapeHtml(title || 'Untitled')}</h2>
            ${description ? `<p class="hub-request-form-desc">${escapeHtml(description)}</p>` : ''}
          </div>
          <div class="tmpl-preview-badges">
            <span class="tmpl-preview-kind-badge">${escapeHtml(templateKind || 'form')}</span>
            ${versionBadge}
            <span class="tmpl-preview-binding-badge">${escapeHtml(binding)}</span>
          </div>
        </header>
        <div class="tmpl-preview-sections">${sectionHtml}</div>
        <footer class="tmpl-preview-footer tmpl-runtime-footer hub-request-form-footer">
          <button type="submit" class="hub-btn hub-btn-primary" id="tmplRuntimeSubmitBtn">Submit</button>
          <button type="button" class="hub-btn hub-btn-ghost" id="tmplRuntimeCancelBtn">Cancel</button>
        </footer>
      </div>
    </form>`;
  }

  function formatAnswerValue(field, value) {
    const type = normalizeFieldType(field.type);
    if (type === 'checkbox') return value === true ? 'Yes' : 'No';
    if (type === 'signature_ack') return value?.acknowledged ? 'Acknowledged' : '—';
    if (type === 'file') return typeof value === 'string' ? value : value?.reference || '—';
    if (value == null || value === '') return '—';
    return String(value);
  }

  function statusBadgeClass(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'completed' || s === 'submitted') return 'tmpl-status-badge is-success';
    if (s === 'in_progress') return 'tmpl-status-badge is-progress';
    if (s === 'rejected') return 'tmpl-status-badge is-rejected';
    return 'tmpl-status-badge';
  }

  function renderReadOnlySubmissionHtml({ title, templateKind, spaceKey, status, sections, data, versionNumber, submissionId, submittedBy, submittedAt }) {
    const sectionHtml = (sections || [])
      .map(
        (sec) => `<section class="tmpl-preview-section-card">
          <header class="tmpl-preview-section-head"><h3>${escapeHtml(sec.title)}</h3>${sec.description ? `<p class="tmpl-preview-section-desc">${escapeHtml(sec.description)}</p>` : ''}</header>
          <div class="tmpl-preview-section-body">${(sec.fields || [])
            .map(
              (f) =>
                `<div class="tmpl-runtime-readonly-field"><span class="tmpl-runtime-readonly-label">${escapeHtml(f.label)}</span><span class="tmpl-runtime-readonly-value">${escapeHtml(formatAnswerValue(f, data?.[f.key]))}</span></div>`
            )
            .join('')}</div>
        </section>`
      )
      .join('');
    return `<div class="tmpl-record-shell">
      <header class="tmpl-record-header">
        <div class="tmpl-record-meta-grid">
          <div><span class="tmpl-record-label">Record ID</span><span class="tmpl-record-value mono">${escapeHtml(submissionId || '—')}</span></div>
          <div><span class="tmpl-record-label">Status</span><span class="${statusBadgeClass(status)}">${escapeHtml(status || 'unknown')}</span></div>
          <div><span class="tmpl-record-label">Submitted by</span><span class="tmpl-record-value">${escapeHtml(submittedBy || '—')}</span></div>
          <div><span class="tmpl-record-label">Submitted at</span><span class="tmpl-record-value">${escapeHtml(submittedAt || '—')}</span></div>
          <div><span class="tmpl-record-label">Template</span><span class="tmpl-record-value">${escapeHtml(title || 'Submission')} · v${escapeHtml(versionNumber != null ? versionNumber : '?')}</span></div>
          <div><span class="tmpl-record-label">Form</span><span class="tmpl-record-value">${escapeHtml(spaceKey === 'forms' ? 'Published form' : spaceKey || '—')}</span></div>
        </div>
        <div class="tmpl-preview-badges">
          <span class="tmpl-preview-kind-badge">${escapeHtml(templateKind || 'form')}</span>
        </div>
      </header>
      <div class="tmpl-preview-shell tmpl-runtime-readonly-shell">
        <div class="tmpl-preview-sections">${sectionHtml}</div>
      </div>
    </div>`;
  }

  function collectRuntimeValues(formEl) {
    const values = {};
    if (!formEl) return values;
    formEl.querySelectorAll('.tmpl-runtime-input').forEach((el) => {
      const key = el.dataset.fieldKey || el.name;
      if (!key) return;
      if (el.type === 'checkbox') {
        if (el.dataset.signature === '1') values[key] = { acknowledged: el.checked };
        else values[key] = el.checked;
      } else if (el.type === 'number') {
        values[key] = el.value === '' ? null : Number(el.value);
      } else {
        values[key] = el.value;
      }
    });
    return values;
  }

  const api = {
    FIELD_TYPES_UI,
    FIELD_TYPES_STORAGE,
    slugId,
    normalizeField,
    normalizeSections,
    normalizeFieldType,
    flattenFieldKeys,
    buildPayloadFromSections,
    moveItem,
    duplicateSection,
    renderPreviewHtml,
    renderRuntimeFormHtml,
    renderReadOnlySubmissionHtml,
    renderRuntimeField,
    clientValidateSubmission,
    collectRuntimeValues,
    renderImportPreviewPanel,
    fieldTypeLabel,
    fieldLabelForType,
    fieldTypeIconHtml,
    wrapPreviewFrame,
    formatValidationErrors,
    formatValidationErrorsGrouped,
    groupValidationErrors,
    categorizeValidationPath,
    formatAnswerValue,
    escapeHtml,
  };

  global.TemplateSectionBuilder = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
