/**
 * WOS-72 — Central workflow assignee role catalog (Postgres with static fallback).
 */
const postgres = require('./postgres');

const DEFAULT_WORKFLOW_ROLE_KEYS = postgres.DEFAULT_WORKFLOW_ROLE_KEYS;

let cachedKeys = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 30_000;

async function refreshAllowedAssigneeRoleKeys(force = false) {
  const now = Date.now();
  if (!force && cachedKeys && now < cacheExpiresAt) return cachedKeys;
  if (postgres.isAvailable()) {
    try {
      const keys = await postgres.listActiveRoleKeys();
      cachedKeys = keys.length ? keys : [...DEFAULT_WORKFLOW_ROLE_KEYS];
    } catch {
      cachedKeys = [...DEFAULT_WORKFLOW_ROLE_KEYS];
    }
  } else {
    cachedKeys = [...DEFAULT_WORKFLOW_ROLE_KEYS];
  }
  cacheExpiresAt = now + CACHE_TTL_MS;
  return cachedKeys;
}

function getAllowedAssigneeRoleKeysSync() {
  return cachedKeys?.length ? cachedKeys : [...DEFAULT_WORKFLOW_ROLE_KEYS];
}

function getAllowedAssigneeRoleSetSync() {
  return new Set(getAllowedAssigneeRoleKeysSync());
}

async function listRoleOptionsForUi() {
  if (postgres.isAvailable()) {
    try {
      const roles = await postgres.listActiveRoles();
      if (roles.length) {
        return roles.map((r) => ({ key: r.key, name: r.name, description: r.description || '' }));
      }
    } catch {
      /* fallback below */
    }
  }
  return DEFAULT_WORKFLOW_ROLE_KEYS.map((key) => ({
    key,
    name: key.charAt(0).toUpperCase() + key.slice(1),
    description: '',
  }));
}

function resetRoleCatalogCacheForTest() {
  cachedKeys = null;
  cacheExpiresAt = 0;
}

module.exports = {
  DEFAULT_WORKFLOW_ROLE_KEYS,
  refreshAllowedAssigneeRoleKeys,
  getAllowedAssigneeRoleKeysSync,
  getAllowedAssigneeRoleSetSync,
  listRoleOptionsForUi,
  resetRoleCatalogCacheForTest,
};
