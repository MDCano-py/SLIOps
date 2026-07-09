/**
 * WOS-69 — New Request form registry wiring (legacy types + published dynamic forms).
 */
(function (global) {
  'use strict';

  /** Legacy/static request types expected on New Request (parity with document-registry). */
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

  function publishedFormsFromRegistry(registryData) {
    const spaces = registryData?.spaces || [];
    const formsSpace = spaces.find((s) => s.key === 'forms');
    if (!formsSpace) return [];
    return (formsSpace.entries || []).map((entry, index) => ({
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
    }));
  }

  function mergeNewRequestTypes(legacyTypes, publishedForms) {
    return [...(legacyTypes || []), ...(publishedForms || [])];
  }

  function isPublishedFormCard(item) {
    return item?.render_mode === 'published_form' && !!item?.launch_entry_id;
  }

  function cardActionLabel(item) {
    if (isPublishedFormCard(item)) return 'Fill out form';
    if (item?.render_mode === 'custom') return 'Start request';
    if (item?.render_mode === 'schema') return 'Start request';
    return 'Start request';
  }

  function groupNewRequestTypes(types) {
    const legacy = [];
    const published = [];
    (types || []).forEach((t) => {
      if (t.category === PUBLISHED_FORMS_CATEGORY || isPublishedFormCard(t)) published.push(t);
      else legacy.push(t);
    });
    return { legacy, published };
  }

  function legacyKeysPresent(types) {
    const keys = new Set((types || []).map((t) => t.key));
    return LEGACY_REQUEST_TYPE_KEYS.filter((k) => keys.has(k));
  }

  const api = {
    LEGACY_REQUEST_TYPE_KEYS,
    PUBLISHED_FORMS_CATEGORY,
    publishedFormsFromRegistry,
    mergeNewRequestTypes,
    isPublishedFormCard,
    cardActionLabel,
    groupNewRequestTypes,
    legacyKeysPresent,
  };

  global.HubNewRequestRegistry = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
