/** Extensible form field type registry. */

const FIELD_TYPES = Object.freeze([
  { type: 'short_text', label: 'Short text', category: 'input' },
  { type: 'long_text', label: 'Long text', category: 'input' },
  { type: 'email', label: 'Email', category: 'input' },
  { type: 'phone', label: 'Phone', category: 'input' },
  { type: 'number', label: 'Number', category: 'input' },
  { type: 'currency', label: 'Currency', category: 'input' },
  { type: 'date', label: 'Date', category: 'input' },
  { type: 'datetime', label: 'Date and time', category: 'input' },
  { type: 'select', label: 'Select', category: 'choice' },
  { type: 'multi_select', label: 'Multi-select', category: 'choice' },
  { type: 'radio', label: 'Radio group', category: 'choice' },
  { type: 'checkbox_group', label: 'Checkbox group', category: 'choice' },
  { type: 'yes_no', label: 'Yes/No', category: 'choice' },
  { type: 'file_upload', label: 'File upload', category: 'media' },
  { type: 'signature_placeholder', label: 'Signature request', category: 'media' },
  { type: 'user_selector', label: 'User selector', category: 'reference' },
  { type: 'role_selector', label: 'Role selector', category: 'reference' },
  { type: 'department_selector', label: 'Department selector', category: 'reference' },
  { type: 'vendor_selector', label: 'Vendor selector', category: 'reference' },
  { type: 'address_group', label: 'Address group', category: 'group' },
  { type: 'section_heading', label: 'Section heading', category: 'layout' },
  { type: 'instructional_text', label: 'Instructional text', category: 'layout' },
  { type: 'divider', label: 'Divider', category: 'layout' },
  { type: 'hidden', label: 'Hidden field', category: 'input' },
  { type: 'computed', label: 'Computed / read-only', category: 'input' },
]);

const FIELD_TYPE_SET = new Set(FIELD_TYPES.map((f) => f.type));
const LAYOUT_TYPES = new Set(['section_heading', 'instructional_text', 'divider']);

function listFieldTypes() {
  return FIELD_TYPES.slice();
}

function isKnownFieldType(type) {
  return FIELD_TYPE_SET.has(type);
}

function isLayoutField(type) {
  return LAYOUT_TYPES.has(type);
}

module.exports = {
  FIELD_TYPES,
  listFieldTypes,
  isKnownFieldType,
  isLayoutField,
};
