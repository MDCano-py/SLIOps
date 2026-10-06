/**
 * Control Room store selector.
 * CONTROL_ROOM_STORE=memory forces memory (tests).
 * Otherwise postgres when HUB_STORE_MODE=postgres and DATABASE_URL set.
 */
const { createMemoryStore } = require('./store-memory');
const { createPostgresStore } = require('./store-postgres');

let _store = null;

function createControlRoomStore(opts = {}) {
  if (opts.store) return opts.store;
  if (opts.memory || process.env.CONTROL_ROOM_STORE === 'memory') {
    return createMemoryStore();
  }
  const mode = String(process.env.HUB_STORE_MODE || '').toLowerCase();
  if (mode === 'postgres' && process.env.DATABASE_URL) {
    return createPostgresStore();
  }
  // Dev fallback so UI can be exercised without Postgres
  return createMemoryStore();
}

function getControlRoomStore() {
  if (!_store) _store = createControlRoomStore();
  return _store;
}

function resetControlRoomStoreForTests(store) {
  _store = store || null;
}

module.exports = {
  createControlRoomStore,
  getControlRoomStore,
  resetControlRoomStoreForTests,
  createMemoryStore,
};
