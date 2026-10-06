// Business-day aging rules for dashboard metrics.

const store = require('./store/index.js');

function isWeekend(d) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function addBusinessDays(start, days) {
  const d = new Date(start);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    if (!isWeekend(d)) added++;
  }
  return d;
}

function businessDaysBetween(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  if (e <= s) return 0;
  let count = 0;
  const cur = new Date(s);
  cur.setHours(0, 0, 0, 0);
  const endDay = new Date(e);
  endDay.setHours(0, 0, 0, 0);
  while (cur < endDay) {
    cur.setDate(cur.getDate() + 1);
    if (!isWeekend(cur)) count++;
  }
  return count;
}

function hoursBetween(start, end) {
  return (new Date(end) - new Date(start)) / (1000 * 60 * 60);
}

function minutesBetween(start, end) {
  return (new Date(end) - new Date(start)) / (1000 * 60);
}

const CLOSED_STATUSES = ['closed', 'canceled', 'rejected'];

/**
 * Classify a request into aging buckets using configurable thresholds.
 */
async function classifyRequestAging(request, cfg) {
  const config = cfg || (await store.getAgingConfig());
  const now = new Date();
  const created = new Date(request.created_at);
  const ageBizDays = businessDaysBetween(created, now);
  const priority = (request.priority || 'normal').toLowerCase();

  if (CLOSED_STATUSES.includes(request.status)) {
    return { bucket: 'closed', label: 'Closed', severity: 'neutral', ageBizDays };
  }

  if (request.status === 'waiting_on_signature') {
    const ref = request.updated_at || request.created_at;
    const hrs = hoursBetween(ref, now);
    if (hrs >= config.signatureAgingHours) {
      return { bucket: 'stale', label: 'Signature overdue', severity: 'high', ageBizDays, hours: hrs };
    }
    return { bucket: 'aging', label: 'Awaiting signature', severity: 'medium', ageBizDays, hours: hrs };
  }

  if (
    request.status === 'waiting_on_internal_review' ||
    request.status === 'waiting_on_client_review' ||
    request.status === 'in_review'
  ) {
    const ref = request.updated_at || request.created_at;
    const hrs = hoursBetween(ref, now);
    if (hrs >= config.reviewAgingHours) {
      return { bucket: 'stale', label: 'Review overdue', severity: 'high', ageBizDays, hours: hrs };
    }
    return { bucket: 'aging', label: 'In review', severity: 'medium', ageBizDays, hours: hrs };
  }

  if (
    request.status === 'sent_to_maintainx' ||
    request.status === 'maintainx_in_progress' ||
    request.status === 'failed_sync'
  ) {
    const ref = request.maintainx_synced_at || request.updated_at || request.created_at;
    const mins = minutesBetween(ref, now);
    if (mins >= config.maintainxSyncAttentionMinutes && request.status === 'failed_sync') {
      return { bucket: 'stale', label: 'MaintainX sync failed', severity: 'high', ageBizDays, minutes: mins };
    }
    if (mins >= config.maintainxSyncAttentionMinutes) {
      return { bucket: 'attention', label: 'MaintainX attention', severity: 'medium', ageBizDays, minutes: mins };
    }
    return { bucket: 'on_track', label: 'MaintainX', severity: 'low', ageBizDays, minutes: mins };
  }

  if (request.status === 'completed' && !request.closed_at) {
    const ref = request.completed_at || request.updated_at;
    const biz = businessDaysBetween(ref, now);
    if (biz >= config.completedNotClosedStaleBusinessDays) {
      return { bucket: 'stale', label: 'Completed, not closed', severity: 'high', ageBizDays: biz };
    }
    return { bucket: 'aging', label: 'Awaiting closure', severity: 'medium', ageBizDays: biz };
  }

  const highStale = priority === 'high' || priority === 'urgent';
  const staleDays = highStale
    ? config.highPriorityStaleBusinessDays
    : config.normalAgingBusinessDays;
  const agingDays = Math.max(1, staleDays - 1);

  if (ageBizDays >= staleDays) {
    return {
      bucket: 'stale',
      label: highStale ? 'High priority stale' : 'Stale',
      severity: 'high',
      ageBizDays,
    };
  }
  if (ageBizDays >= agingDays) {
    return { bucket: 'aging', label: 'Aging', severity: 'medium', ageBizDays };
  }
  return { bucket: 'on_track', label: 'On track', severity: 'low', ageBizDays };
}

async function enrichRequestsWithAging(requests) {
  const cfg = await store.getAgingConfig();
  return Promise.all(
    requests.map(async (r) => {
      const aging = await classifyRequestAging(r, cfg);
      return { ...r, aging };
    })
  );
}

async function buildDashboardSummary(requests) {
  const enriched = await enrichRequestsWithAging(requests);
  const open = enriched.filter((r) => !CLOSED_STATUSES.includes(r.status));
  const byStatus = {};
  const byType = {};
  const byPriority = {};
  const agingBuckets = { on_track: 0, aging: 0, stale: 0, attention: 0 };

  for (const r of enriched) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    byType[r.request_type] = (byType[r.request_type] || 0) + 1;
    byPriority[r.priority || 'normal'] = (byPriority[r.priority || 'normal'] || 0) + 1;
    if (!CLOSED_STATUSES.includes(r.status) && r.aging?.bucket) {
      agingBuckets[r.aging.bucket] = (agingBuckets[r.aging.bucket] || 0) + 1;
    }
  }

  const maintainxWaiting = open.filter((r) =>
    ['sent_to_maintainx', 'maintainx_in_progress', 'failed_sync'].includes(r.status)
  );
  const docsReview = open.filter((r) =>
    ['in_review', 'waiting_on_internal_review', 'waiting_on_client_review'].includes(r.status)
  );
  const docsSign = open.filter((r) => r.status === 'waiting_on_signature');
  const clientAction = open.filter((r) => r.status === 'waiting_on_client_review');
  const internalAction = open.filter((r) =>
    ['waiting_on_internal_review', 'waiting_on_approval', 'submitted', 'received'].includes(r.status)
  );
  const recentlyCompleted = enriched
    .filter((r) => r.status === 'completed' || r.status === 'closed')
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, 10);
  const staleItems = open.filter((r) => r.aging?.bucket === 'stale').slice(0, 20);

  return {
    open_count: open.length,
    aging_count: open.filter((r) => r.aging?.bucket === 'aging').length,
    stale_count: open.filter((r) => r.aging?.bucket === 'stale').length,
    by_status: byStatus,
    by_type: byType,
    by_priority: byPriority,
    aging_buckets: agingBuckets,
    maintainx_waiting: maintainxWaiting.length,
    documents_review: docsReview.length,
    documents_signature: docsSign.length,
    waiting_on_client: clientAction.length,
    waiting_on_internal: internalAction.length,
    recently_completed: recentlyCompleted,
    stale_items: staleItems,
  };
}

module.exports = {
  classifyRequestAging,
  enrichRequestsWithAging,
  buildDashboardSummary,
  businessDaysBetween,
  addBusinessDays,
};
