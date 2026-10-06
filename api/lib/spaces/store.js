/**
 * WOS-58 — App spaces store facade (Postgres when enabled).
 */
const pg = require('./postgres');

function isSpacesPostgresMode() {
  const mode = (process.env.HUB_STORE_MODE || '').toLowerCase();
  return mode === 'postgres' && !!process.env.DATABASE_URL;
}

function requirePostgres() {
  if (!isSpacesPostgresMode()) {
    const err = new Error('App spaces store requires HUB_STORE_MODE=postgres and DATABASE_URL');
    err.code = 'POSTGRES_REQUIRED';
    err.status = 503;
    throw err;
  }
  return pg;
}

function wrap(name) {
  return async (...args) => {
    requirePostgres();
    return pg[name](...args);
  };
}

module.exports = {
  SpaceStoreError: pg.SpaceStoreError,
  isSpacesPostgresMode,
  healthCheck: wrap('healthCheck'),
  ensureDefaultSpaces: wrap('ensureDefaultSpaces'),
  listSpaces: wrap('listSpaces'),
  getSpaceByKey: wrap('getSpaceByKey'),
  createSpace: wrap('createSpace'),
  updateSpace: wrap('updateSpace'),
  archiveSpace: wrap('archiveSpace'),
  listLaunchEntriesForSpace: wrap('listLaunchEntriesForSpace'),
  listAllLaunchEntries: wrap('listAllLaunchEntries'),
  getLaunchEntry: wrap('getLaunchEntry'),
  getLaunchEntryForTemplate: wrap('getLaunchEntryForTemplate'),
  updateLaunchEntry: wrap('updateLaunchEntry'),
  setLaunchEntryStatus: wrap('setLaunchEntryStatus'),
  updateTemplateLaunchConfig: wrap('updateTemplateLaunchConfig'),
  getTemplateLaunchConfig: wrap('getTemplateLaunchConfig'),
  syncLaunchEntryOnPublish: wrap('syncLaunchEntryOnPublish'),
  hideLaunchEntriesForTemplate: wrap('hideLaunchEntriesForTemplate'),
  repointLaunchEntriesAfterRetire: wrap('repointLaunchEntriesAfterRetire'),
  getLaunchRegistry: wrap('getLaunchRegistry'),
  deleteLaunchDataForTemplateTest: wrap('deleteLaunchDataForTemplateTest'),
};
