/**
 * WOS-88 — Object storage facade (Amazon S3 on EC2; optional local for development).
 *
 * Staging/production never fall back to Vercel Blob, memory, or local disk.
 */

const { getStorageConfig, isConfigured, isDeployedEnv } = require('./config');
const { createS3Adapter } = require('./s3');
const { createLocalAdapter } = require('./local');
const {
  StorageValidationError,
  assertAllowedObjectKey,
  assertVendorDocKey,
  buildPhotoObjectKey,
  buildVendorDocObjectKey,
  validateUploadBuffer,
  parseVendorObjectKey,
  sanitizeFilename,
} = require('./keys');

let cached = null;
let cachedKey = '';

function cacheKey(cfg) {
  return [
    cfg.driver,
    cfg.bucket,
    cfg.region,
    cfg.endpoint || '',
    cfg.localRoot || '',
  ].join('|');
}

function getAdapter() {
  const cfg = getStorageConfig();
  const key = cacheKey(cfg);
  if (cached && cachedKey === key) return cached;

  if (cfg.driver === 'local' && isDeployedEnv()) {
    throw Object.assign(new Error('Local object storage is not allowed on staging/production'), {
      code: 'STORAGE_LOCAL_FORBIDDEN',
      statusCode: 503,
    });
  }

  if (!isConfigured(cfg)) {
    return null;
  }

  if (cfg.driver === 's3') {
    cached = createS3Adapter(cfg);
  } else if (cfg.driver === 'local') {
    cached = createLocalAdapter(cfg);
  } else {
    cached = null;
  }
  cachedKey = key;
  return cached;
}

/** Test helper — clear adapter cache after env changes. */
function resetStorageCache() {
  cached = null;
  cachedKey = '';
}

function configured() {
  return isConfigured(getStorageConfig());
}

function getStatus() {
  const cfg = getStorageConfig();
  const ok = isConfigured(cfg);
  return {
    configured: ok,
    driver: cfg.driver,
    bucket: cfg.driver === 's3' && cfg.bucket ? cfg.bucket : undefined,
    // Never expose credentials
    message: ok
      ? cfg.driver === 's3'
        ? 'Amazon S3 object storage is configured.'
        : 'Local object storage is configured (development only).'
      : 'Object storage is not configured. Set S3_BUCKET (and prefer an EC2 IAM role) or STORAGE_DRIVER=local for development only.',
  };
}

function assertConfigured() {
  if (!configured()) {
    const err = new Error('Object storage not configured');
    err.code = 'STORAGE_NOT_CONFIGURED';
    err.statusCode = 503;
    throw err;
  }
  const adapter = getAdapter();
  if (!adapter) {
    const err = new Error('Object storage adapter unavailable');
    err.code = 'STORAGE_NOT_CONFIGURED';
    err.statusCode = 503;
    throw err;
  }
  return adapter;
}

async function putObject(args) {
  return assertConfigured().putObject(args);
}

async function getObject(args) {
  return assertConfigured().getObject(args);
}

async function deleteObject(args) {
  return assertConfigured().deleteObject(args);
}

async function deleteObjects(args) {
  return assertConfigured().deleteObjects(args);
}

async function listObjects(args) {
  return assertConfigured().listObjects(args);
}

async function getPresignedGetUrl(args) {
  return assertConfigured().getPresignedGetUrl(args);
}

async function healthCheck() {
  if (!configured()) {
    return { ok: false, ...getStatus() };
  }
  try {
    return await assertConfigured().healthCheck();
  } catch (err) {
    return {
      ok: false,
      driver: getStorageConfig().driver,
      error: err.code || err.name || 'StorageError',
      message: err.message,
    };
  }
}

module.exports = {
  configured: configured,
  isConfigured: configured,
  getStatus,
  getStorageConfig,
  assertConfigured,
  resetStorageCache,
  putObject,
  getObject,
  deleteObject,
  deleteObjects,
  listObjects,
  getPresignedGetUrl,
  healthCheck,
  StorageValidationError,
  assertAllowedObjectKey,
  assertVendorDocKey,
  buildPhotoObjectKey,
  buildVendorDocObjectKey,
  validateUploadBuffer,
  parseVendorObjectKey,
  sanitizeFilename,
};
