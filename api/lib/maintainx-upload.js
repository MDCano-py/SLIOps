/**
 * MaintainX PUT passthrough carries binary work-order attachments.
 * The Node server already consumed the socket into req.body, so reading
 * req as a stream throws and the proxy returns HTTP 500.
 */

const ALLOWED_TYPES = new Set([
  'application/octet-stream',
  'multipart/form-data',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function readRawBody(req) {
  if (Buffer.isBuffer(req?.body)) return Promise.resolve(req.body);
  if (req?.rawBody && Buffer.isBuffer(req.rawBody)) return Promise.resolve(req.rawBody);
  if (req?.body == null || req.body === '') return Promise.resolve(Buffer.alloc(0));
  if (typeof req.body === 'string') return Promise.resolve(Buffer.from(req.body));
  if (!req || typeof req.on !== 'function') return Promise.resolve(Buffer.alloc(0));
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function assertUploadAllowed(contentType, byteLength) {
  const ct = String(contentType || '').toLowerCase().split(';')[0].trim();
  if (!ALLOWED_TYPES.has(ct)) {
    return { ok: false, status: 415, error: 'File type is not allowed' };
  }
  if (!Number.isFinite(byteLength) || byteLength <= 0) {
    return { ok: false, status: 400, error: 'Upload body is empty' };
  }
  if (byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, status: 413, error: 'File exceeds the upload size limit' };
  }
  return { ok: true, contentType: ct };
}

module.exports = {
  ALLOWED_TYPES,
  MAX_UPLOAD_BYTES,
  readRawBody,
  assertUploadAllowed,
};
