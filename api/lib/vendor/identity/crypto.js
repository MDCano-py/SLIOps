/**
 * Shared opaque-token primitives for vendor magic links / sessions.
 * Same pattern as hub action_links / cfg external participants (SHA-256 hash at rest).
 */
const crypto = require('crypto');

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function mintOpaqueToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/** Six-digit code from a CSPRNG. Inclusive range 000000–999999. */
function mintVerificationCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function hashesEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

module.exports = { hashToken, mintOpaqueToken, mintVerificationCode, hashesEqual };
