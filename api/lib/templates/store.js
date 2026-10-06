/**
 * WOS-55 — Form template store facade (Postgres when enabled).
 */
const pg = require('./postgres');

function isTemplatePostgresMode() {
  const mode = (process.env.HUB_STORE_MODE || '').toLowerCase();
  return mode === 'postgres' && !!process.env.DATABASE_URL;
}

function requirePostgres() {
  if (!isTemplatePostgresMode()) {
    const err = new Error('Template store requires HUB_STORE_MODE=postgres and DATABASE_URL');
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

function wrapBinding(name) {
  const bindings = require('./bindings-postgres');
  return async (...args) => {
    requirePostgres();
    return bindings[name](...args);
  };
}

module.exports = {
  TemplateStoreError: pg.TemplateStoreError,
  isTemplatePostgresMode,
  healthCheck: wrap('healthCheck'),
  getTemplate: wrap('getTemplate'),
  getVersion: wrap('getVersion'),
  getLatestDraftVersion: wrap('getLatestDraftVersion'),
  getCurrentPublishedVersion: wrap('getCurrentPublishedVersion'),
  listTemplates: wrap('listTemplates'),
  listVersionsForTemplate: wrap('listVersionsForTemplate'),
  createTemplate: wrap('createTemplate'),
  createDraftVersion: wrap('createDraftVersion'),
  updateDraftVersion: wrap('updateDraftVersion'),
  publishDraftVersion: wrap('publishDraftVersion'),
  clonePublishedToDraft: wrap('clonePublishedToDraft'),
  retirePublishedVersion: wrap('retirePublishedVersion'),
  archiveTemplate: wrap('archiveTemplate'),
  countSubmissionsForTemplate: wrap('countSubmissionsForTemplate'),
  listSubmissions: wrap('listSubmissions'),
  deleteDraftTemplate: wrap('deleteDraftTemplate'),
  createSubmission: wrap('createSubmission'),
  getSubmissionWithVersion: wrap('getSubmissionWithVersion'),
  getSubmissionDetail: wrap('getSubmissionDetail'),
  resolveLaunchRuntimeBundle: wrap('resolveLaunchRuntimeBundle'),
  submitLaunchEntry: wrap('submitLaunchEntry'),
  actOnSubmissionStep: wrap('actOnSubmissionStep'),
  listSubmissionEvents: wrap('listSubmissionEvents'),
  deleteTemplateForTest: wrap('deleteTemplateForTest'),
  getTemplateBinding: wrapBinding('getActiveBinding'),
  upsertTemplateBinding: wrapBinding('upsertTemplateBinding'),
  deleteTemplateBinding: wrapBinding('deleteTemplateBinding'),
  listPublishedWorkflowTemplates: wrapBinding('listPublishedWorkflowTemplates'),
};
