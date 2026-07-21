/**
 * WOS-87 — When demo-tagged hub requests are visible in list/dashboard APIs.
 * Production: never. Staging: only if STAGING_DEMO_DATA_ENABLED. Development: yes.
 * Callers cannot override this to force demo visibility in production/staging-off.
 */
function isDemoDataVisible() {
  const env = String(process.env.NODE_ENV || 'development').toLowerCase();
  if (env === 'production') return false;
  if (env === 'staging') {
    return ['1', 'true', 'yes'].includes(
      String(process.env.STAGING_DEMO_DATA_ENABLED || '').toLowerCase()
    );
  }
  return true;
}

/** Whether list/get should include demo-tagged rows (env gate wins over opts). */
function shouldIncludeDemoRows(opts = {}) {
  if (!isDemoDataVisible()) return false;
  if (opts.include_demo === false) return false;
  return true;
}

module.exports = { isDemoDataVisible, shouldIncludeDemoRows };
