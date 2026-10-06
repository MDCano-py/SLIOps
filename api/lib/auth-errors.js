/**
 * Machine-readable auth / integration error codes for WOS API responses.
 *
 * WOS session failure (browser may restart Entra):
 *   HTTP 401 + code WOS_AUTH_REQUIRED
 *
 * WOS RBAC (authenticated, not allowed — never restart Entra):
 *   HTTP 403 + code WOS_FORBIDDEN
 *
 * MaintainX / upstream integration (never restart Entra):
 *   HTTP 502 + code MAINTAINX_AUTH_FAILED | MAINTAINX_UNAVAILABLE | …
 */

const WOS_AUTH_REQUIRED = 'WOS_AUTH_REQUIRED';
const WOS_FORBIDDEN = 'WOS_FORBIDDEN';
const VENDOR_AUTH_REQUIRED = 'VENDOR_AUTH_REQUIRED';
const MAINTAINX_AUTH_FAILED = 'MAINTAINX_AUTH_FAILED';
const MAINTAINX_UNAVAILABLE = 'MAINTAINX_UNAVAILABLE';
const MAINTAINX_RATE_LIMITED = 'MAINTAINX_RATE_LIMITED';
const MAINTAINX_UPSTREAM_ERROR = 'MAINTAINX_UPSTREAM_ERROR';

function wosAuthRequiredBody(message = 'Authentication required') {
  return { error: message, code: WOS_AUTH_REQUIRED };
}

function wosForbiddenBody(message = 'Forbidden') {
  return { error: message, code: WOS_FORBIDDEN };
}

function vendorAuthRequiredBody(message = 'Vendor session required or expired') {
  return { error: message, code: VENDOR_AUTH_REQUIRED };
}

/**
 * Classify a MaintainX upstream HTTP response into a WOS integration error.
 * Never returns HTTP 401 — that status is reserved for WOS session failure.
 */
function classifyMaintainxUpstream(upstreamStatus, bodyText) {
  const status = Number(upstreamStatus) || 0;
  let upstreamError = null;
  try {
    const parsed = JSON.parse(bodyText || '');
    if (parsed && typeof parsed.error === 'string') upstreamError = parsed.error;
    else if (parsed && typeof parsed.message === 'string') upstreamError = parsed.message;
  } catch {
    /* ignore */
  }

  const looksLikeAuth =
    status === 401 ||
    status === 403 ||
    /invalid\s*token|unauthorized|authentication|forbidden/i.test(String(upstreamError || bodyText || ''));

  if (looksLikeAuth) {
    return {
      httpStatus: 502,
      body: {
        error: 'MaintainX authentication failed',
        code: MAINTAINX_AUTH_FAILED,
        upstreamStatus: status || undefined,
      },
    };
  }
  if (status === 429) {
    return {
      httpStatus: 502,
      body: {
        error: 'MaintainX rate limited',
        code: MAINTAINX_RATE_LIMITED,
        upstreamStatus: 429,
      },
    };
  }
  if (status >= 500) {
    return {
      httpStatus: 502,
      body: {
        error: 'MaintainX unavailable',
        code: MAINTAINX_UNAVAILABLE,
        upstreamStatus: status,
      },
    };
  }
  if (status >= 400) {
    return {
      httpStatus: 502,
      body: {
        error: 'MaintainX request failed',
        code: MAINTAINX_UPSTREAM_ERROR,
        upstreamStatus: status,
        upstreamError: upstreamError || undefined,
      },
    };
  }
  return null;
}

function logMaintainxCredentialDiagnostics({ path, upstreamStatus, hasApiKey, orgIdConfigured }) {
  // Never log the token or Authorization header.
  console.error('[maintainx] upstream failure', {
    path: String(path || '').slice(0, 200),
    upstreamStatus,
    credentialEnv: 'MAINTAINX_API_KEY',
    credentialPresent: !!hasApiKey,
    orgHeaderEnv: 'MAINTAINX_ORG_ID',
    orgHeaderConfigured: !!orgIdConfigured,
    authScheme: 'Bearer',
    hint: 'Verify MAINTAINX_API_KEY in the process environment (PM2/systemd), restart after change, and confirm the token belongs to the expected MaintainX org.',
  });
}

module.exports = {
  WOS_AUTH_REQUIRED,
  WOS_FORBIDDEN,
  VENDOR_AUTH_REQUIRED,
  MAINTAINX_AUTH_FAILED,
  MAINTAINX_UNAVAILABLE,
  MAINTAINX_RATE_LIMITED,
  MAINTAINX_UPSTREAM_ERROR,
  wosAuthRequiredBody,
  wosForbiddenBody,
  vendorAuthRequiredBody,
  classifyMaintainxUpstream,
  logMaintainxCredentialDiagnostics,
};
