/**
 * WOS-88 — Server-controlled object keys and upload validation.
 * Never trust client-provided storage paths.
 */

const crypto = require('crypto');
const path = require('path');

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_VENDOR_DOC_BYTES = 25 * 1024 * 1024;

const PHOTO_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const VENDOR_MIME = new Set([
  ...PHOTO_MIME,
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'text/plain',
  'text/csv',
  'application/octet-stream',
]);

const PHOTO_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif']);
const VENDOR_EXT = new Set([
  ...PHOTO_EXT,
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.zip',
  '.txt',
  '.csv',
]);

class StorageValidationError extends Error {
  constructor(message, code = 'INVALID_UPLOAD') {
    super(message);
    this.name = 'StorageValidationError';
    this.code = code;
    this.statusCode = 400;
  }
}

function sanitizeFilename(name, maxLen = 120) {
  const base = path.basename(String(name || 'file'));
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').slice(0, maxLen);
  return cleaned || 'file';
}

function extensionOf(filename) {
  const m = String(filename).match(/(\.[A-Za-z0-9]{1,8})$/);
  return m ? m[1].toLowerCase() : '';
}

function randomId(bytes = 12) {
  return crypto.randomBytes(bytes).toString('hex');
}

function assertSafeKeySegment(seg, label) {
  if (!seg || typeof seg !== 'string') {
    throw new StorageValidationError(`Invalid ${label}`);
  }
  if (seg.includes('..') || seg.includes('/') || seg.includes('\\') || seg.includes('\0')) {
    throw new StorageValidationError(`Invalid ${label}`);
  }
}

/**
 * Validate key is under an allowed prefix and has no path traversal.
 */
function assertAllowedObjectKey(key, { allowedPrefixes } = {}) {
  if (!key || typeof key !== 'string') {
    throw new StorageValidationError('Missing object key', 'INVALID_KEY');
  }
  if (key.includes('..') || key.startsWith('/') || key.includes('\\') || key.includes('\0')) {
    throw new StorageValidationError('Invalid object key', 'INVALID_KEY');
  }
  if (key.length > 512) {
    throw new StorageValidationError('Object key too long', 'INVALID_KEY');
  }
  const prefixes = allowedPrefixes || ['vendor-docs/', 'parts-photos/', 'archive/'];
  if (!prefixes.some((p) => key.startsWith(p))) {
    throw new StorageValidationError('Object key prefix not allowed', 'INVALID_KEY');
  }
  return key;
}

/** Vendor doc keys must stay under vendor-docs/{ref}/ */
function assertVendorDocKey(key, ref) {
  assertAllowedObjectKey(key, { allowedPrefixes: ['vendor-docs/'] });
  assertSafeKeySegment(ref, 'vendor ref');
  const prefix = `vendor-docs/${ref}/`;
  if (!key.startsWith(prefix)) {
    throw new StorageValidationError('Object key does not match vendor', 'KEY_ISOLATION');
  }
  return key;
}

function buildPhotoObjectKey(filename) {
  const safe = sanitizeFilename(filename || `photo-${Date.now()}.jpg`);
  const ext = extensionOf(safe);
  if (ext && !PHOTO_EXT.has(ext)) {
    throw new StorageValidationError(`Photo file type not allowed (${ext})`);
  }
  const datePrefix = new Date().toISOString().slice(0, 10);
  return `parts-photos/${datePrefix}/${randomId()}_${safe}`;
}

function buildVendorDocObjectKey(ref, kind, filename) {
  assertSafeKeySegment(ref, 'vendor ref');
  const safeKind = String(kind || 'other').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'other';
  const safe = sanitizeFilename(filename);
  const ext = extensionOf(safe);
  if (ext && !VENDOR_EXT.has(ext)) {
    throw new StorageValidationError(`Document file type not allowed (${ext})`);
  }
  return `vendor-docs/${ref}/${Date.now()}__${safeKind}__${safe}__${randomId(8)}`;
}

function validateUploadBuffer({ kind, filename, contentType, byteLength }) {
  const len = Number(byteLength) || 0;
  if (len <= 0) throw new StorageValidationError('Empty body');

  if (kind === 'photo') {
    if (len > MAX_PHOTO_BYTES) {
      throw new StorageValidationError(`Photo exceeds ${MAX_PHOTO_BYTES} byte limit`, 'TOO_LARGE');
    }
    const ct = String(contentType || 'image/jpeg').split(';')[0].trim().toLowerCase();
    if (ct && !PHOTO_MIME.has(ct) && ct !== 'application/octet-stream') {
      throw new StorageValidationError(`Photo content-type not allowed (${ct})`);
    }
    const safe = sanitizeFilename(filename || 'photo.jpg');
    const ext = extensionOf(safe);
    if (ext && !PHOTO_EXT.has(ext)) {
      throw new StorageValidationError(`Photo extension not allowed (${ext})`);
    }
    return { safeFilename: safe, contentType: ct || 'image/jpeg' };
  }

  if (kind === 'vendor_doc') {
    if (len > MAX_VENDOR_DOC_BYTES) {
      throw new StorageValidationError(
        `Document exceeds ${MAX_VENDOR_DOC_BYTES} byte limit`,
        'TOO_LARGE'
      );
    }
    const ct = String(contentType || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    if (ct && !VENDOR_MIME.has(ct)) {
      throw new StorageValidationError(`Document content-type not allowed (${ct})`);
    }
    const safe = sanitizeFilename(filename || 'document');
    const ext = extensionOf(safe);
    if (ext && !VENDOR_EXT.has(ext)) {
      throw new StorageValidationError(`Document extension not allowed (${ext})`);
    }
    return { safeFilename: safe, contentType: ct || 'application/octet-stream' };
  }

  throw new StorageValidationError('Unknown upload kind');
}

/**
 * Parse vendor-docs/{ref}/{ts}__{kind}__{filename}__{id} or legacy Vercel-style names.
 */
function parseVendorObjectKey(key, { size = 0, lastModified = null } = {}) {
  assertAllowedObjectKey(key, { allowedPrefixes: ['vendor-docs/'] });
  const parts = key.split('/');
  if (parts.length < 3) return null;
  const file = parts.slice(2).join('/');
  // New schema: timestamp__kind__filename__hexid
  let m = file.match(/^(\d+)__([a-z0-9_-]+)__(.+)__([a-f0-9]{8,32})$/i);
  if (m) {
    return {
      key,
      filename: m[3],
      kind: m[2],
      uploadedAt: new Date(parseInt(m[1], 10)).toISOString(),
      size: size || 0,
      lastModified,
    };
  }
  // Legacy Vercel: timestamp__kind__filename-randomSuffix
  m = file.match(/^(\d+)__([a-z0-9_-]+)__(.+)$/i);
  if (m) {
    let filename = m[3];
    const suffixMatch = filename.match(/^(.+)-([A-Za-z0-9]{20,32})(\.[^.]+)?$/);
    if (suffixMatch) filename = suffixMatch[1] + (suffixMatch[3] || '');
    return {
      key,
      filename,
      kind: m[2],
      uploadedAt: new Date(parseInt(m[1], 10)).toISOString(),
      size: size || 0,
      lastModified,
    };
  }
  return {
    key,
    filename: file,
    kind: 'other',
    uploadedAt: lastModified ? new Date(lastModified).toISOString() : new Date().toISOString(),
    size: size || 0,
    lastModified,
  };
}

module.exports = {
  StorageValidationError,
  MAX_PHOTO_BYTES,
  MAX_VENDOR_DOC_BYTES,
  sanitizeFilename,
  assertAllowedObjectKey,
  assertVendorDocKey,
  buildPhotoObjectKey,
  buildVendorDocObjectKey,
  validateUploadBuffer,
  parseVendorObjectKey,
  randomId,
};
