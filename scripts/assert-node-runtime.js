'use strict';

/**
 * October 21, 2026 Node.js security release.
 * Supported line: 24.22.1 or any later 24.x security release.
 * Node 20 is outside the patched release lines. Node 22 needs 22.23.4.
 * Node 26 needs 26.12.1 and is not the runtime this repository targets.
 */
const MINIMUM = Object.freeze({ major: 24, minor: 22, patch: 1 });

function parseNodeVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version || ''));
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function isSupportedNodeVersion(version) {
  const parsed = parseNodeVersion(version);
  if (!parsed || parsed.major !== MINIMUM.major) return false;
  if (parsed.minor > MINIMUM.minor) return true;
  if (parsed.minor < MINIMUM.minor) return false;
  return parsed.patch >= MINIMUM.patch;
}

function assertNodeRuntime() {
  const version = process.versions.node;
  if (isSupportedNodeVersion(version)) return version;
  console.error(
    `[runtime] Node.js ${version} is outside the supported 24.x line. Install Node.js 24.22.1 or a later 24.x security release (https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).`
  );
  process.exit(1);
}

module.exports = {
  MINIMUM,
  parseNodeVersion,
  isSupportedNodeVersion,
  assertNodeRuntime,
};
