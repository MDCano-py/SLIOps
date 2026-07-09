// Bridge legacy archive submissions into the central hub (backward compatible).

const store = require('./store/index.js');
const { queueN8nEvent } = require('./integrations');
const documents = require('./documents');
const registry = require('./document-registry');

const ARCHIVE_TO_HUB_TYPE = {
  parts: 'parts_request',
  wo: 'work_order',
  'roll-off-swap': 'general_request',
};

/**
 * Called after saveRequestArchive — mirrors into hub without breaking old endpoints.
 */
async function mirrorArchiveToHub(kind, archiveRecord, actorEmail) {
  const requestType = ARCHIVE_TO_HUB_TYPE[kind] || 'general_request';
  const title =
    archiveRecord.title ||
    (requestType === 'parts_request'
      ? `Parts request — ${archiveRecord.locationName || 'Unknown location'}`
      : requestType === 'work_order'
        ? archiveRecord.title || `Work order — ${archiveRecord.locationName || 'Site'}`
        : `Request — ${kind}`);

  let existing = archiveRecord.hubRequestId
    ? await store.getRequest(archiveRecord.hubRequestId)
    : null;
  if (!existing && archiveRecord.id) {
    existing = await store.findRequestByArchive(kind, archiveRecord.id);
  }
  if (existing) {
    const { record } = await store.patchRequest(existing.id, {
      maintainx_id: archiveRecord.maintainxId || existing.maintainx_id,
      maintainx_sequential_id:
        archiveRecord.workOrderNumber || existing.maintainx_sequential_id,
      status: archiveRecord.maintainxId ? 'sent_to_maintainx' : existing.status,
      archive_kind: kind,
      archive_id: archiveRecord.id,
    });
    let webDoc = await store.getWebDocumentByRequestId(existing.id);
    if (!webDoc) {
      webDoc = await documents.createWebDocumentForRequest(
        record || existing,
        { content_json: archiveRecord, form_payload: archiveRecord },
        actorEmail
      );
    }
    return record || existing;
  }

  const rec = await store.createRequest(
    {
      request_type: requestType,
      title,
      description: archiveRecord.description || archiveRecord.brief || archiveRecord.notes || '',
      requester_name: archiveRecord.submittedBy || actorEmail,
      requester_email: (archiveRecord.contactEmail || actorEmail || '').toLowerCase(),
      requester_type: 'employee',
      location: archiveRecord.locationName || '',
      priority: archiveRecord.priority || 'normal',
      status: archiveRecord.maintainxId ? 'sent_to_maintainx' : 'submitted',
      maintainx_id: archiveRecord.maintainxId || null,
      maintainx_sequential_id: archiveRecord.workOrderNumber || null,
      maintainx_synced_at: archiveRecord.maintainxId ? store.nowIso() : null,
      archive_kind: kind,
      archive_id: archiveRecord.id,
      form_payload: archiveRecord,
      client_visible_status: archiveRecord.maintainxId
        ? `Work order ${archiveRecord.workOrderNumber || archiveRecord.maintainxId}`
        : 'Submitted',
    },
    actorEmail
  );

  await store.addStatusHistory({
    request_id: rec.id,
    old_status: null,
    new_status: rec.status,
    changed_by: actorEmail,
    changed_by_type: 'system',
    note: `Mirrored from legacy archive (${kind})`,
    source: 'portal',
  });

  await documents.createWebDocumentForRequest(
    rec,
    { content_json: archiveRecord, form_payload: archiveRecord },
    actorEmail
  );

  const docType = registry.getDocumentType(requestType);
  const steps = await documents.resolveWorkflowStepsAsync({
    request_type: requestType,
    requester_email: rec.requester_email,
    form_payload: archiveRecord,
  });

  if (requestType === 'work_order' && archiveRecord.maintainxId) {
    await documents.startWorkflow(rec.id, [
      {
        step_order: 1,
        step_type: 'send_to_maintainx',
        step_title: 'Sent to MaintainX',
        status: 'completed',
        assigned_type: 'system',
      },
    ], actorEmail);
  } else if (steps.length) {
    await documents.startWorkflow(rec.id, steps, actorEmail);
  }

  await queueN8nEvent('request.created', rec);
  return rec;
}

module.exports = { mirrorArchiveToHub, ARCHIVE_TO_HUB_TYPE };
