/**
 * WOS-69 / WOS-94 — New Request registry.
 * Prefer published request types; published forms are supporting assets, not duplicate cards.
 */
(function (root) {
  'use strict';

  const LEGACY_REQUEST_TYPE_KEYS = [
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

  const PUBLISHED_FORMS_CATEGORY = 'published_forms';
  const REQUEST_TYPES_CATEGORY = 'request_types';
  const LEGACY_CATEGORY = 'legacy_operations';

  const TEST_NAME_RE = /^(dd|test|zsx|new\s*form.*|nr\s*published\s*form)$/i;

  function isLikelyTestRecord(item) {
    const label = String(item?.label || item?.name || item?.display_name || '').trim();
    const key = String(item?.key || '').trim();
    if (item?.is_test || item?.test === true) return true;
    if (TEST_NAME_RE.test(label) || TEST_NAME_RE.test(key)) return true;
    if (label.length <= 2 && !/^(jsa|bol|wo)$/i.test(label)) return true;
    return false;
  }

  function publishedFormsFromRegistry(registryData) {
    const spaces = registryData?.spaces || [];
    const formsSpace = spaces.find((s) => s.key === 'forms');
    if (!formsSpace) return [];
    return (formsSpace.entries || [])
      .map((entry, index) => ({
        id: `published_form_${entry.id}`,
        key: entry.template_key || entry.id,
        label: entry.label || 'Published form',
        description: entry.description || 'Fill out this published form and submit your request.',
        category: PUBLISHED_FORMS_CATEGORY,
        render_mode: 'published_form',
        launch_entry_id: entry.id,
        template_id: entry.template_id,
        icon: 'form',
        sort_order: 500 + (entry.sort_order || index),
      }))
      .filter((item) => !isLikelyTestRecord(item));
  }

  function requestTypesFromConfiguration(definitions) {
    return (definitions || [])
      .filter((d) => d.status === 'published' || d.status === 'active')
      .map((d, index) => {
        const payload =
          (d.published_version && d.published_version.payload_json) ||
          d.payload_json ||
          {};
        return {
          id: `cfg_request_type_${d.id}`,
          key: d.key,
          label: payload.display_name || d.name || d.key,
          description: payload.description || d.description || 'Start this request type.',
          category: REQUEST_TYPES_CATEGORY,
          render_mode: 'cfg_request_type',
          request_type_id: d.id,
          starting_form_template_id: payload.starting_form_template_id || payload.form_definition_id || null,
          workflow_definition_id: payload.workflow_definition_id || null,
          number_prefix: payload.number_prefix || 'REQ-',
          icon: payload.icon || 'request',
          sort_order: 100 + index,
        };
      })
      .filter((item) => !isLikelyTestRecord(item));
  }

  /**
   * When published request types exist, do not also list every supporting form as a start card.
   * Legacy tools remain in a separate category.
   */
  function mergeNewRequestTypes(legacyTypes, publishedForms, requestTypes) {
    const types = (requestTypes || []).filter((t) => !isLikelyTestRecord(t));
    const legacy = (legacyTypes || [])
      .map((t) => ({
        ...t,
        category: t.category || LEGACY_CATEGORY,
      }))
      .filter((t) => !isLikelyTestRecord(t));

    if (types.length) {
      return [...types, ...legacy];
    }
    // Fallback until request types are configured: keep published forms (filtered)
    return [...legacy, ...(publishedForms || []).filter((t) => !isLikelyTestRecord(t))];
  }

  function isPublishedFormCard(item) {
    return item?.render_mode === 'published_form' && !!item?.launch_entry_id;
  }

  function isCfgRequestTypeCard(item) {
    return item?.render_mode === 'cfg_request_type' && !!item?.request_type_id;
  }

  function cardActionLabel(item) {
    if (isCfgRequestTypeCard(item)) return 'Start request';
    if (isPublishedFormCard(item)) return 'Fill out form';
    if (item?.render_mode === 'custom') return 'Start request';
    return 'Start request';
  }

  function categoryLabel(category) {
    if (category === REQUEST_TYPES_CATEGORY) return 'Published Request Types';
    if (category === PUBLISHED_FORMS_CATEGORY) return 'Published Forms';
    if (category === LEGACY_CATEGORY || category === 'operations') return 'Legacy Operations';
    if (category === 'safety') return 'Safety Tools';
    return category || 'Other';
  }

  const api = {
    LEGACY_REQUEST_TYPE_KEYS,
    PUBLISHED_FORMS_CATEGORY,
    REQUEST_TYPES_CATEGORY,
    publishedFormsFromRegistry,
    requestTypesFromConfiguration,
    mergeNewRequestTypes,
    isPublishedFormCard,
    isCfgRequestTypeCard,
    isLikelyTestRecord,
    cardActionLabel,
    categoryLabel,
  };

  root.HubNewRequestRegistry = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : typeof global !== 'undefined' ? global : this);
