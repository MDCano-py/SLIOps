/**
 * Shared SLIOps identity helper — session /me only (never localStorage).
 * Prefills name/email as read-only; optional contact fields stay editable when unknown.
 */
(function (global) {
  'use strict';

  let _cache = null;
  let _inflight = null;

  function buildDisplayName(data) {
    if (!data) return '';
    if (data.displayName) return String(data.displayName).trim();
    if (data.name) return String(data.name).trim();
    const parts = [data.firstName, data.lastName].filter(Boolean).join(' ').trim();
    if (parts) return parts;
    return '';
  }

  function normalize(data) {
    if (!data || typeof data !== 'object') {
      return {
        authenticated: false,
        email: null,
        name: '',
        phone: null,
        department: null,
        jobTitle: null,
        externalId: null,
        userId: null,
      };
    }
    const email = data.email ? String(data.email).trim().toLowerCase() : null;
    const externalId = data.external_id || data.oid || data.externalId || null;
    return {
      authenticated: data.authenticated !== false && !!email,
      email,
      name: buildDisplayName(data),
      phone: data.phone || data.phoneNumber || null,
      department: data.department || null,
      jobTitle: data.jobTitle || data.job_title || data.title || null,
      externalId: externalId ? String(externalId) : null,
      // Canonical local id: prefer stable external id, else email
      userId: externalId ? String(externalId) : email,
      raw: data,
    };
  }

  async function fetchMe() {
    if (typeof global.proxyFetch === 'function') {
      const res = await global.proxyFetch('/me');
      return res.json();
    }
    throw new Error('proxyFetch unavailable');
  }

  async function loadIdentity(opts) {
    const force = !!(opts && opts.force);
    if (!force && _cache) return _cache;
    if (!force && _inflight) return _inflight;
    _inflight = (async () => {
      let data = null;
      try {
        if (!force && global._meLoad) data = await global._meLoad;
        if (!data) data = await fetchMe();
      } catch {
        data = null;
      }
      _cache = normalize(data);
      _inflight = null;
      return _cache;
    })();
    return _inflight;
  }

  function getCachedIdentity() {
    return _cache;
  }

  function clearCache() {
    _cache = null;
    _inflight = null;
  }

  function setReadonly(el, value) {
    if (!el) return;
    el.value = value == null ? '' : String(value);
    el.readOnly = true;
    el.setAttribute('readonly', 'readonly');
    el.classList.add('hub-identity-readonly');
    el.setAttribute('aria-readonly', 'true');
  }

  /**
   * Apply authenticated identity to form fields.
   * opts: {
   *   nameEl, emailEl, phoneEl, departmentEl, jobTitleEl,
   *   nameReadonly=true, emailReadonly=true,
   *   refresh?: boolean
   * }
   */
  async function applyToForm(opts) {
    const o = opts || {};
    const id = await loadIdentity({ force: !!o.refresh });
    if (o.nameEl) {
      if (id.name) setReadonly(o.nameEl, id.name);
      else if (o.nameReadonly !== false) {
        // No name available — leave editable only if not forcing readonly empty
        o.nameEl.readOnly = false;
        o.nameEl.classList.remove('hub-identity-readonly');
      }
    }
    if (o.emailEl) {
      if (id.email) setReadonly(o.emailEl, id.email);
    }
    if (o.phoneEl) {
      if (id.phone) {
        o.phoneEl.value = id.phone;
      }
      // Phone stays editable (optional contact); never invent
      o.phoneEl.readOnly = false;
    }
    if (o.departmentEl) {
      if (id.department) setReadonly(o.departmentEl, id.department);
      else {
        o.departmentEl.readOnly = false;
      }
    }
    if (o.jobTitleEl) {
      if (id.jobTitle) setReadonly(o.jobTitleEl, id.jobTitle);
      else {
        o.jobTitleEl.readOnly = false;
      }
    }
    return id;
  }

  /** Ensure submit payload cannot override session email with a forged contact. */
  function enforceSubmitterEmail(payloadEmail, identity) {
    const session = (identity && identity.email) || (global._hubUserEmail || '').toLowerCase() || null;
    if (!session) return payloadEmail;
    return session;
  }

  global.HubIdentity = {
    loadIdentity,
    getCachedIdentity,
    clearCache,
    applyToForm,
    enforceSubmitterEmail,
    normalize,
  };
})(typeof window !== 'undefined' ? window : globalThis);
