/**
 * WOS-88 — Object storage configuration (Amazon S3 primary).
 *
 * Staging/production: STORAGE_DRIVER=s3 (or omit when S3_BUCKET is set).
 * Local only: STORAGE_DRIVER=local with STORAGE_LOCAL_ROOT — never used when
 * NODE_ENV is staging or production.
 *
 * Prefer EC2 instance IAM role. Long-lived AWS_ACCESS_KEY_ID /
 * AWS_SECRET_ACCESS_KEY are optional for local/dev only.
 */

function nodeEnv() {
  return String(process.env.NODE_ENV || 'development').toLowerCase();
}

function isDeployedEnv() {
  const env = nodeEnv();
  return env === 'staging' || env === 'production';
}

function resolveDriver() {
  const explicit = String(process.env.STORAGE_DRIVER || '').trim().toLowerCase();
  if (explicit === 's3' || explicit === 'local' || explicit === 'none') return explicit;
  if (process.env.S3_BUCKET) return 's3';
  return 'none';
}

function getStorageConfig() {
  const driver = resolveDriver();
  const bucket = String(process.env.S3_BUCKET || '').trim();
  const region = String(process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1').trim();
  const endpoint = String(process.env.S3_ENDPOINT || '').trim() || undefined;
  const forcePathStyle = ['1', 'true', 'yes'].includes(
    String(process.env.S3_FORCE_PATH_STYLE || '').toLowerCase()
  );
  const presignExpires = Math.min(
    Math.max(parseInt(process.env.PRESIGNED_URL_EXPIRES_SECONDS || '300', 10) || 300, 30),
    3600
  );
  const localRoot = String(process.env.STORAGE_LOCAL_ROOT || '').trim();

  return {
    driver,
    bucket,
    region,
    endpoint,
    forcePathStyle,
    presignExpires,
    localRoot,
    deployed: isDeployedEnv(),
  };
}

function isConfigured(cfg = getStorageConfig()) {
  if (cfg.driver === 'none') return false;
  if (cfg.driver === 's3') return !!cfg.bucket;
  if (cfg.driver === 'local') {
    if (cfg.deployed) return false; // local adapter forbidden on staging/production
    return !!cfg.localRoot;
  }
  return false;
}

module.exports = {
  nodeEnv,
  isDeployedEnv,
  resolveDriver,
  getStorageConfig,
  isConfigured,
};
