/**
 * WOS-48 Vendor dashboard queue classification — browser + Node (UMD).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.VendorDashboardQueues = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  const QUEUE_IDS = [
    'my_queue',
    'pending_rebekah',
    'pending_ap',
    'pending_contract',
    'pending_dylan',
    'missing_docs',
    'stalled',
    'recent',
    'all_active',
  ];

  const QUEUE_LABELS = {
    my_queue: 'My Queue',
    pending_rebekah: 'Pending Rebekah / Admin',
    pending_ap: 'Pending AP Setup',
    pending_contract: 'Pending Contract / MSA / NDA',
    pending_dylan: 'Pending Dylan / Legal',
    missing_docs: 'Missing Required Docs',
    stalled: 'Aging / Stalled',
    recent: 'Recently Added',
    all_active: 'All Active Vendors',
  };

  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  function pipelineStage(r) {
    return r.pipelineStage || (r.overallStatus === 'complete' ? 'complete' : 'in_progress');
  }

  function isComplete(r) {
    return pipelineStage(r) === 'complete' || r.overallStatus === 'complete';
  }

  function isActive(r) {
    return !isComplete(r);
  }

  function assignedOwner(r) {
    return r.assignedOwner || r.assignedTo || 'rebekah';
  }

  function isStalled(r, now = Date.now()) {
    if (isComplete(r)) return false;
    const last = new Date(r.lastActionDate || r.createdAt).getTime();
    return last > 0 && (now - last) > SEVEN_DAYS_MS;
  }

  function isRecent(r, now = Date.now()) {
    const created = new Date(r.createdAt).getTime();
    return created > 0 && (now - created) < SEVEN_DAYS_MS;
  }

  function isMissingDocs(r) {
    if (isComplete(r)) return false;
    if (r.requiredDocumentsComplete === false) return true;
    const w9 = r.w9Status || '';
    const bank = r.bankingStatus || '';
    return w9 === 'missing' || w9 === 'not_received' || bank === 'missing' || bank === 'not_received';
  }

  function isPendingRebekah(r) {
    if (isComplete(r)) return false;
    const os = r.overallStatus || '';
    if (os === 'pending_rebekah_review') return true;
    return assignedOwner(r) === 'rebekah' && isActive(r);
  }

  function isPendingAp(r) {
    if (isComplete(r)) return false;
    const os = r.overallStatus || '';
    if (os === 'pending_ap_setup' || os === 'pending_ap') return true;
    return assignedOwner(r) === 'ap';
  }

  function isPendingContract(r) {
    if (isComplete(r)) return false;
    const os = r.overallStatus || '';
    if (os === 'pending_contract_review' || os === 'pending_contract') return true;
    const cs = r.contractStatus || '';
    if (cs === 'in_progress' || cs === 'legal_review' || cs === 'required') return true;
    return (r.msaRequired || r.ndaRequired) && cs !== 'complete' && cs !== 'not_required' && assignedOwner(r) === 'rebekah';
  }

  function isPendingDylan(r) {
    if (isComplete(r)) return false;
    const os = r.overallStatus || '';
    if (os === 'pending_dylan_review') return true;
    return assignedOwner(r) === 'dylan';
  }

  function myQueueOwnersForPersona(persona) {
    switch (persona) {
      case 'admin':
        return ['rebekah', 'ap', 'dylan'];
      case 'rebekah':
        return ['rebekah'];
      case 'ap':
        return ['ap'];
      case 'dylan':
        return ['dylan'];
      case 'ops':
        return ['rebekah', 'ap'];
      case 'viewer':
        return [];
      default:
        return [];
    }
  }

  function isMyQueueVendor(r, persona) {
    if (isComplete(r)) return false;
    const owners = myQueueOwnersForPersona(persona);
    if (!owners.length) return false;
    if (persona === 'admin') return owners.includes(assignedOwner(r));
    return owners.includes(assignedOwner(r));
  }

  function inferDashboardPersona(permissions, rolePreviewId) {
    if (rolePreviewId) {
      const map = {
        admin: 'admin',
        rebekah: 'rebekah',
        ap: 'ap',
        dylan: 'dylan',
        vendor_viewer: 'viewer',
        standard: 'none',
      };
      if (map[rolePreviewId]) return map[rolePreviewId];
    }

    const p = Array.isArray(permissions) ? permissions : [];
    const isAdmin = p.includes('admin') || p.includes('hub_admin');
    const canView = isAdmin || p.includes('view_vendor_dashboard') || p.includes('view_vendor_list');
    if (!canView) return 'none';
    if (isAdmin) return 'admin';
    if (p.includes('edit_vendor_workflow')) return 'ops';
    if (p.includes('edit_vendor_compliance') || p.includes('manage_vendor_documents')) return 'dylan';
    if (p.includes('view_vendor_documents') || p.includes('view_vendor_list')) return 'viewer';
    return 'none';
  }

  function queuesVisibleForPersona(persona) {
    switch (persona) {
      case 'none':
        return [];
      case 'viewer':
        return ['all_active', 'pending_rebekah', 'pending_ap', 'pending_contract', 'pending_dylan', 'missing_docs', 'stalled', 'recent'];
      case 'dylan':
        return ['my_queue', 'pending_dylan', 'pending_contract', 'missing_docs', 'stalled', 'recent', 'all_active'];
      case 'ap':
        return ['my_queue', 'pending_ap', 'missing_docs', 'stalled', 'recent', 'all_active', 'pending_rebekah'];
      case 'rebekah':
        return QUEUE_IDS.slice();
      case 'ops':
        return ['my_queue', 'pending_rebekah', 'pending_ap', 'pending_contract', 'pending_dylan', 'missing_docs', 'stalled', 'recent', 'all_active'];
      case 'admin':
        return QUEUE_IDS.slice();
      default:
        return ['all_active'];
    }
  }

  function defaultQueueForPersona(persona) {
    switch (persona) {
      case 'admin':
      case 'rebekah':
      case 'ap':
      case 'dylan':
      case 'ops':
        return 'my_queue';
      case 'viewer':
        return 'all_active';
      default:
        return null;
    }
  }

  function matchesQueue(r, queueId, persona, now = Date.now()) {
    if (!queueId || queueId === 'all_active') return isActive(r);
    switch (queueId) {
      case 'my_queue':
        return isMyQueueVendor(r, persona === 'ops' ? 'ops' : persona);
      case 'pending_rebekah':
        return isPendingRebekah(r);
      case 'pending_ap':
        return isPendingAp(r);
      case 'pending_contract':
        return isPendingContract(r);
      case 'pending_dylan':
        return isPendingDylan(r);
      case 'missing_docs':
        return isMissingDocs(r);
      case 'stalled':
        return isStalled(r, now);
      case 'recent':
        return isRecent(r, now);
      default:
        return true;
    }
  }

  function filterVendorsByQueue(records, queueId, persona, now = Date.now()) {
    const list = Array.isArray(records) ? records : [];
    if (!queueId) return list;
    return list.filter((r) => matchesQueue(r, queueId, persona, now));
  }

  function classifyVendorQueues(r, persona, now = Date.now()) {
    const out = [];
    for (const id of QUEUE_IDS) {
      if (matchesQueue(r, id, persona, now)) out.push(id);
    }
    return out;
  }

  function countByQueue(records, persona, now = Date.now()) {
    const counts = {};
    for (const id of QUEUE_IDS) {
      counts[id] = filterVendorsByQueue(records, id, persona, now).length;
    }
    return counts;
  }

  function queueLabel(queueId) {
    return QUEUE_LABELS[queueId] || queueId;
  }

  return {
    QUEUE_IDS,
    QUEUE_LABELS,
    SEVEN_DAYS_MS,
    pipelineStage,
    isComplete,
    isActive,
    isStalled,
    isRecent,
    isMissingDocs,
    isPendingRebekah,
    isPendingAp,
    isPendingContract,
    isPendingDylan,
    isMyQueueVendor,
    inferDashboardPersona,
    queuesVisibleForPersona,
    defaultQueueForPersona,
    matchesQueue,
    filterVendorsByQueue,
    classifyVendorQueues,
    countByQueue,
    queueLabel,
    myQueueOwnersForPersona,
  };
}));
