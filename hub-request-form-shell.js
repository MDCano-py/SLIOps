/**
 * WOS-70 — Shared request form shell + admin edit policy helpers.
 * Visual language aligned with dynamic template runtime; legacy logic unchanged.
 */
(function (global) {
  'use strict';

  const LEGACY_SYSTEM_MANAGED_KEYS = [
    'work_order',
    'parts_request',
    'equipment_request',
    'safe_work_permit',
    'jsa',
    'bol',
    'document_review',
    'document_signature',
    'general_request',
  ];

  const LEGACY_PORTAL_TABS = ['work-order', 'parts', 'bol', 'jsa', 'swp'];

  function esc(s) {
    if (s == null) return '';
    if (typeof global.escapeHtml === 'function') return global.escapeHtml(s);
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isLegacySystemManaged(requestTypeKey) {
    return LEGACY_SYSTEM_MANAGED_KEYS.includes(String(requestTypeKey || ''));
  }

  /** Admins may manage dynamic forms via Forms — never legacy modules. */
  function canShowManageForm(isAdmin, renderMode) {
    return !!isAdmin && renderMode === 'published_form';
  }

  function shouldShowEditFormAction() {
    return false;
  }

  function systemManagedEyebrow(label) {
    const name = label || 'Request';
    return `System-managed request type · ${name}`;
  }

  function renderHeaderHtml(opts = {}) {
    const eyebrow = opts.eyebrow || (opts.systemManaged ? systemManagedEyebrow(opts.title) : opts.kindLabel || 'Start request');
    const title = opts.title || 'New request';
    const description = opts.description || '';
    const badge = opts.badge
      ? `<span class="tmpl-preview-kind-badge">${esc(opts.badge)}</span>`
      : opts.systemManaged
        ? '<span class="tmpl-preview-binding-badge">System-managed</span>'
        : '';
    const manageLink =
      opts.manageFormHref && opts.showManageForm
        ? `<a class="hub-request-manage-link" href="${esc(opts.manageFormHref)}">Manage form</a>`
        : '';
    return `<header class="hub-request-form-header tmpl-preview-header">
      <div class="hub-request-form-header-main">
        <p class="tmpl-preview-eyebrow">${esc(eyebrow)}</p>
        <h2 class="tmpl-preview-title hub-request-form-title">${esc(title)}</h2>
        ${description ? `<p class="hub-request-form-desc">${esc(description)}</p>` : ''}
        ${manageLink}
      </div>
      ${badge ? `<div class="tmpl-preview-badges">${badge}</div>` : ''}
    </header>`;
  }

  function renderSectionHeadHtml(title, meta) {
    return `<header class="tmpl-preview-section-head hub-request-section-head">
      <h3>${esc(title || 'Details')}</h3>
      ${meta ? `<p class="tmpl-preview-section-desc">${esc(meta)}</p>` : ''}
    </header>`;
  }

  function renderFooterHtml(opts = {}) {
    const submitLabel = opts.submitLabel || 'Submit';
    const hideCancel = !!opts.hideCancel;
    return `<footer class="hub-request-form-footer tmpl-preview-footer">
      <button type="submit" class="hub-btn hub-btn-primary">${esc(submitLabel)}</button>
      ${hideCancel ? '' : '<button type="button" class="hub-btn hub-btn-ghost" data-hub-form-cancel>Cancel</button>'}
    </footer>`;
  }

  function wrapFormShell(innerHtml, opts = {}) {
    return `<div class="hub-request-form-shell tmpl-preview-shell tmpl-runtime-shell">
      ${renderHeaderHtml(opts)}
      <div class="hub-request-form-body tmpl-preview-sections">${innerHtml}</div>
    </div>`;
  }

  function markLegacyPortalPanel(tabName) {
    const panelId =
      tabName === 'work-order'
        ? 'panel-work-order'
        : tabName === 'parts'
          ? 'panel-parts'
          : tabName === 'bol'
            ? 'panel-bol'
            : tabName === 'jsa'
              ? 'panel-jsa'
              : tabName === 'swp'
                ? 'panel-swp'
                : null;
    if (!panelId) return;
    const panel = document.getElementById(panelId);
    if (panel) panel.classList.add('hub-legacy-request-panel');
  }

  const api = {
    LEGACY_SYSTEM_MANAGED_KEYS,
    LEGACY_PORTAL_TABS,
    isLegacySystemManaged,
    canShowManageForm,
    shouldShowEditFormAction,
    systemManagedEyebrow,
    renderHeaderHtml,
    renderSectionHeadHtml,
    renderFooterHtml,
    wrapFormShell,
    markLegacyPortalPanel,
    esc,
  };

  global.HubRequestFormShell = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
