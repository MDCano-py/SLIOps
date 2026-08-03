/**
 * WOS-93 — Configurable platform feature flag.
 * When disabled, new Configuration Center APIs/UI must stay inactive
 * and legacy hub behavior remains unchanged.
 */

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value == null ? '' : value).trim().toLowerCase());
}

function isConfigurablePlatformEnabled(env = process.env) {
  return isTruthyEnv(env.CONFIGURABLE_PLATFORM_ENABLED);
}

function disabledPayload() {
  return {
    error: 'Configurable platform is disabled',
    code: 'CONFIGURABLE_PLATFORM_DISABLED',
    detail: 'Set CONFIGURABLE_PLATFORM_ENABLED=1 to enable Configuration Center features.',
  };
}

module.exports = {
  isConfigurablePlatformEnabled,
  disabledPayload,
  isTruthyEnv,
};
