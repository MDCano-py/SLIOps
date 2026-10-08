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

module.exports = { hashToken, mintOpaqueToken };
