/**
 * Dev-only Operations Workflow Hub demo data (isolated from production routes).
 * All seeded entities are marked demo: true and tracked for clean removal.
 */

const crypto = require('crypto');
const store = require('../api/lib/hub/store/index.js');
const { REQUEST_NUMBER_PREFIX } = require('../api/lib/hub/constants');

const DEMO_INDEX = 'hub:demo:requests';

const SITES = [
  'Midland Construction Yard',
  'Permian Battery Hub — Block C',
  'Eagle Ford Pad 12',
  'South Texas OEM Yard',
  'Houston Fabrication Shop',
];

const INTERNAL = [
  { name: 'Sarah Chen', email: 'sarah.chen@streamlinecorp.com', dept: 'Field Operations' },
  { name: 'Marcus Webb', email: 'marcus.webb@streamlinecorp.com', dept: 'Maintenance' },
  { name: 'Elena Vasquez', email: 'elena.vasquez@streamlinecorp.com', dept: 'EHS' },
  { name: 'David Park', email: 'david.park@streamlinecorp.com', dept: 'Logistics' },
  { name: 'Priya Nair', email: 'priya.nair@streamlinecorp.com', dept: 'Client Services' },
];

const CLIENTS = [
  { name: 'James Okonkwo', email: 'j.okonkwo@continental-energy.com', company: 'Continental Energy' },
  { name: 'Rachel Holt', email: 'r.holt@pioneer-drilling.com', company: 'Pioneer Drilling' },
  { name: 'Tom Bradley', email: 't.bradley@gridline-partners.com', company: 'Gridline Partners' },
];

const SCENARIOS = [
  {
    type: 'work_order',
    title: 'Replace hydraulic hose on Cat 390F — leak at swing joint',
    description: 'Operator reported visible fluid at swing bearing during morning walkdown. Machine tagged out until repaired.',
    status: 'sent_to_maintainx',
    priority: 'high',
    location: SITES[0],
    assignee: 'marcus.webb@streamlinecorp.com',
    maintainx_id: 'mx-demo-48291',
    maintainx_sequential_id: 'MX-WO-48291',
    maintainx_status: 'open',
    aging: 'fresh',
    steps: [
      { step_type: 'review', step_title: 'Ops review', status: 'completed' },
      { step_type: 'send_to_maintainx', step_title: 'Create MaintainX work order', status: 'completed' },
    ],
  },
  {
    type: 'work_order',
    title: 'Annual PM — Tesla Megapack skid cooling loop inspection',
    description: 'Scheduled preventive maintenance per OEM bulletin TB-2024-18. Verify glycol levels and pump operation.',
    status: 'failed_sync',
    priority: 'normal',
    location: SITES[1],
    assignee: 'marcus.webb@streamlinecorp.com',
    aging: 'stale',
    steps: [
      { step_type: 'review', step_title: 'Maintenance planner review', status: 'completed' },
      { step_type: 'send_to_maintainx', step_title: 'Push to MaintainX', status: 'failed' },
    ],
  },
  {
    type: 'parts_request',
    title: 'Emergency order — 2× Parker 387TC-16 hydraulic hose assemblies',
    description: 'Needed for active leak repair WO. Vendor: Industrial Hose Supply. Deliver to Midland yard gate 3.',
    status: 'in_review',
    priority: 'urgent',
    location: SITES[0],
    assignee: 'david.park@streamlinecorp.com',
    aging: 'aging',
    steps: [
      { step_type: 'review', step_title: 'Parts desk verification', status: 'in_progress' },
      { step_type: 'approve', step_title: 'Procurement approval', status: 'not_started' },
    ],
  },
  {
    type: 'parts_request',
    title: 'Consumables restock — thread sealant, rags, nitrile gloves (Q2)',
    description: 'Standard field consumables replenishment for Eagle Ford crew trailers.',
    status: 'submitted',
    priority: 'normal',
    location: SITES[2],
    aging: 'fresh',
    steps: [{ step_type: 'review', step_title: 'Inventory check', status: 'pending' }],
  },
  {
    type: 'equipment_request',
    title: 'Rental — 60 ft articulating boom lift for facade panel install',
    description: 'Needed 14–18 May for client walkthrough at Permian Battery Hub. Insurance cert on file.',
    status: 'waiting_on_client_review',
    priority: 'normal',
    location: SITES[1],
    assignee: 'priya.nair@streamlinecorp.com',
    client: CLIENTS[0],
    aging: 'aging',
    steps: [
      { step_type: 'review', step_title: 'Equipment coordinator review', status: 'completed' },
      { step_type: 'approve', step_title: 'Client confirms dates', status: 'pending', visible_to_client: true },
    ],
  },
  {
    type: 'equipment_request',
    title: 'Deploy portable lighting tower — night shift concrete pour',
    description: 'Four LED towers requested for Pad 12 pour window. Power drop confirmed with site electrician.',
    status: 'submitted',
    priority: 'high',
    location: SITES[2],
    aging: 'fresh',
    steps: [{ step_type: 'review', step_title: 'Logistics scheduling', status: 'not_started' }],
  },
  {
    type: 'safe_work_permit',
    title: 'Hot work permit — cutting corroded handrail on mezzanine B',
    description: 'Fire watch assigned. Adjacent battery racks isolated per SWP template v3.2.',
    status: 'in_review',
    priority: 'high',
    location: SITES[1],
    assignee: 'elena.vasquez@streamlinecorp.com',
    aging: 'aging',
    steps: [
      { step_type: 'review', step_title: 'EHS review', status: 'in_progress' },
      { step_type: 'approve', step_title: 'Area authority sign-off', status: 'not_started' },
    ],
  },
  {
    type: 'jsa',
    title: 'JSA — rigging and setting precast transformer pad',
    description: 'Critical lift over energized yard corridor. Crane mat survey attached in documents.',
    status: 'waiting_on_signature',
    priority: 'high',
    location: SITES[0],
    assignee: 'elena.vasquez@streamlinecorp.com',
    aging: 'stale',
    steps: [
      { step_type: 'review', step_title: 'Safety lead review', status: 'completed' },
      { step_type: 'sign', step_title: 'Superintendent signature', status: 'pending', requires_signature: true },
    ],
  },
  {
    type: 'bol',
    title: 'Bill of lading — inbound switchgear from Siemens Houston',
    description: 'PO 44018-BOL. Seal intact at receipt; offload scheduled with rigging crew Tuesday 06:00.',
    status: 'completed',
    priority: 'normal',
    location: SITES[4],
    assignee: 'david.park@streamlinecorp.com',
    aging: 'fresh',
    steps: [
      { step_type: 'review', step_title: 'Receiving inspection', status: 'completed' },
      { step_type: 'upload', step_title: 'Attach signed BOL scan', status: 'completed' },
    ],
  },
  {
    type: 'document_review',
    title: 'Review — revised single-line diagram for Pad 12 interconnection',
    description: 'Client submitted Rev C markup. Engineering must confirm protective device coordination.',
    status: 'waiting_on_client_review',
    priority: 'normal',
    location: SITES[2],
    assignee: 'priya.nair@streamlinecorp.com',
    client: CLIENTS[1],
    aging: 'stale',
    steps: [
      { step_type: 'review', step_title: 'Internal engineering review', status: 'completed' },
      { step_type: 'review', step_title: 'Client comment resolution', status: 'pending', visible_to_client: true },
    ],
  },
  {
    type: 'document_signature',
    title: 'Sign — subcontractor indemnity rider (Gridline trenching package)',
    description: 'Legal approved base agreement; rider requires officer signature before mobilization.',
    status: 'waiting_on_signature',
    priority: 'normal',
    location: SITES[3],
    assignee: 'priya.nair@streamlinecorp.com',
    client: CLIENTS[2],
    aging: 'aging',
    steps: [
      { step_type: 'sign', step_title: 'Officer e-signature', status: 'pending', requires_signature: true },
    ],
  },
  {
    type: 'general_request',
    title: 'Visitor badge batch — OEM commissioning team (12 people)',
    description: 'Names and training certs uploaded to SharePoint folder OEM-May-2026.',
    status: 'closed',
    priority: 'low',
    location: SITES[1],
    assignee: 'sarah.chen@streamlinecorp.com',
    aging: 'fresh',
    steps: [
      { step_type: 'review', step_title: 'Site access review', status: 'completed' },
      { step_type: 'close', step_title: 'Close request', status: 'completed' },
    ],
  },
  {
    type: 'general_request',
    title: 'After-hours gate access — concrete testing lab courier',
    description: 'One-time access Saturday 21:00–23:00 for cylinder pickup.',
    status: 'submitted',
    priority: 'normal',
    location: SITES[0],
    aging: 'fresh',
    steps: [{ step_type: 'review', step_title: 'Security coordination', status: 'not_started' }],
  },
];

function isDevDemoAllowed(_isAdmin) {
  const env = (process.env.NODE_ENV || 'development').toLowerCase();
  // Demo seed/clear API routes are local development only — never staging or production.
  return env !== 'production' && env !== 'staging';
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function hoursAgo(n) {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d.toISOString();
}

function pick(arr, i) {
  return arr[i % arr.length];
}

function buildStatusTimeline(requestId, status, createdAt, actorEmail) {
  const chain = ['submitted'];
  if (status !== 'submitted') chain.push('received', 'in_review');
  if (
    ['waiting_on_client_review', 'waiting_on_signature', 'sent_to_maintainx', 'failed_sync', 'completed', 'closed'].includes(
      status
    )
  ) {
    if (!chain.includes('in_review')) chain.push('in_review');
  }
  if (status === 'waiting_on_client_review') chain.push('waiting_on_client_review');
  if (status === 'waiting_on_signature') chain.push('waiting_on_signature');
  if (status === 'sent_to_maintainx' || status === 'failed_sync') chain.push('sent_to_maintainx');
  if (status === 'failed_sync') chain.push('failed_sync');
  if (status === 'completed' || status === 'closed') {
    if (!chain.includes('completed')) chain.push('completed');
  }
  if (status === 'closed') chain.push('closed');
  if (chain[chain.length - 1] !== status && !chain.includes(status)) chain.push(status);

  const unique = [];
  for (const s of chain) {
    if (!unique.includes(s)) unique.push(s);
  }
  if (unique[unique.length - 1] !== status) unique.push(status);

  const entries = [];
  let prev = null;
  unique.forEach((st, idx) => {
    const at = new Date(new Date(createdAt).getTime() + idx * 3600 * 1000 * 4).toISOString();
    entries.push({
      request_id: requestId,
      old_status: prev,
      new_status: st,
      changed_by: actorEmail || 'demo-seed@streamlinecorp.com',
      changed_by_type: idx === 0 ? 'user' : 'system',
      note:
        idx === 0
          ? 'Demo request opened via Operations Workflow Hub'
          : `Status advanced to ${st.replace(/_/g, ' ')}`,
      source: 'demo_seed',
      changed_at: at,
      demo: true,
    });
    prev = st;
  });
  return entries;
}

function agingOffsets(bucket) {
  switch (bucket) {
    case 'stale':
      return { createdDays: 6, updatedHours: 72 };
    case 'aging':
      return { createdDays: 3, updatedHours: 52 };
    case 'fresh':
    default:
      return { createdDays: 0, updatedHours: 4 };
  }
}

async function trackDemoRequest(requestId) {
  if (typeof store.trackDemoRequest === 'function') {
    return store.trackDemoRequest(requestId);
  }
  if (store.redis?.sadd) {
    return store.redis.sadd(DEMO_INDEX, requestId);
  }
}

function usesPostgresStore() {
  const mode = String(process.env.HUB_STORE_MODE || process.env.HUB_STORE || '').toLowerCase();
  return mode === 'postgres' || typeof store.listDemoRequestIds === 'function';
}

async function saveDemoIntegrationEvent({ event_type, request_id, workflow_step_id, status, payload, attempts, last_error, sent_at }) {
  const body = {
    event_type,
    request_id: request_id || null,
    workflow_step_id: workflow_step_id || null,
    payload: { ...(payload || {}), demo: true },
  };
  if (typeof store.queueIntegrationEvent === 'function') {
    const ev = await store.queueIntegrationEvent(body);
    const patch = {
      status: status || 'pending',
      attempts: attempts ?? 0,
      last_error: last_error || null,
      sent_at: sent_at || null,
    };
    if (typeof store.updateIntegrationEvent === 'function') {
      return store.updateIntegrationEvent(ev.id, patch);
    }
    return { ...ev, ...patch };
  }
  if (!store.redis?.pipeline) {
    return null;
  }
  const id = store.generateId();
  const ev = {
    id,
    demo: true,
    event_type,
    request_id: request_id || null,
    workflow_step_id: workflow_step_id || null,
    payload: payload || {},
    status: status || 'pending',
    attempts: attempts ?? 0,
    last_error: last_error || null,
    created_at: store.nowIso(),
    sent_at: sent_at || null,
  };
  const p = store.redis.pipeline();
  p.set(`hub:integration_event:${id}`, JSON.stringify(ev));
  if (ev.request_id) {
    p.zadd(`hub:request:${ev.request_id}:integration_events`, { score: Date.now(), member: id });
  }
  if (ev.status === 'pending') {
    p.zadd('hub:integration_events:pending', { score: Date.now(), member: id });
  }
  await p.exec();
  return ev;
}

function demoNotifId(requestNumber, type) {
  const hash = crypto.createHash('sha256').update(`demo-notif:${requestNumber}:${type}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

async function saveDemoNotification(input) {
  const save = typeof store.saveNotification === 'function' ? store.saveNotification : store.createNotification;
  if (typeof save !== 'function') return null;
  return save(input);
}

async function seedDemoNotifications({ rec, scenario, request_number, internal, client, savedSteps, index }) {
  const assignee = scenario.assignee || internal.email;
  const ageHours = index % 5 === 0 ? 96 : index % 3 === 0 ? 48 : index % 2 === 0 ? 12 : 2;
  const created_at = hoursAgo(ageHours);
  const readSome = index % 4 === 0;
  const signStep = savedSteps.find((s) => s.requires_signature || s.step_type === 'sign');
  const reviewStep = savedSteps.find((s) => s.step_type === 'review' && s.status !== 'completed');

  const notifs = [
    {
      id: demoNotifId(request_number, 'assignment'),
      recipient_email: assignee,
      recipient_name: internal.name,
      type: 'workflow_assigned',
      title: 'Assignment requested',
      message: `You are assigned to ${request_number}: ${scenario.title}`,
      request_id: rec.id,
      read_at: readSome ? hoursAgo(1) : null,
      created_at,
    },
  ];

  if (['in_review', 'waiting_on_internal_review', 'waiting_on_approval'].includes(scenario.status)) {
    notifs.push({
      id: demoNotifId(request_number, 'review'),
      recipient_email: assignee,
      recipient_name: internal.name,
      type: 'review_requested',
      title: 'Review requested',
      message: `Internal review needed on ${request_number}.`,
      request_id: rec.id,
      workflow_step_id: reviewStep?.id || null,
      read_at: index % 5 === 1 ? hoursAgo(2) : null,
      created_at: hoursAgo(ageHours + 1),
    });
  }

  if (scenario.status === 'waiting_on_signature') {
    notifs.push({
      id: demoNotifId(request_number, 'signature'),
      recipient_email: client?.email || assignee,
      recipient_name: client?.name || internal.name,
      type: 'signature_requested',
      title: 'Signature requested',
      message: `Signature required for ${request_number}.`,
      request_id: rec.id,
      workflow_step_id: signStep?.id || null,
      read_at: null,
      created_at: hoursAgo(6),
    });
  }

  if (scenario.status === 'waiting_on_client_review') {
    notifs.push({
      id: demoNotifId(request_number, 'client'),
      recipient_email: client?.email || 'j.okonkwo@continental-energy.com',
      recipient_name: client?.name || 'Client reviewer',
      type: 'client_action',
      title: 'Client action waiting',
      message: `Client review pending on ${request_number}.`,
      request_id: rec.id,
      read_at: index % 6 === 2 ? hoursAgo(3) : null,
      created_at: hoursAgo(8),
    });
  }

  if (['completed', 'closed'].includes(scenario.status)) {
    notifs.push({
      id: demoNotifId(request_number, 'completed'),
      recipient_email: assignee,
      recipient_name: internal.name,
      type: 'document_completed',
      title: 'Document completed',
      message: `${request_number} was marked ${scenario.status.replace(/_/g, ' ')}.`,
      request_id: rec.id,
      read_at: hoursAgo(4),
      created_at: hoursAgo(10),
    });
  }

  if (scenario.status === 'rejected') {
    notifs.push({
      id: demoNotifId(request_number, 'rejected'),
      recipient_email: assignee,
      recipient_name: internal.name,
      type: 'document_rejected',
      title: 'Document rejected',
      message: `${request_number} was rejected during review.`,
      request_id: rec.id,
      read_at: null,
      created_at: hoursAgo(5),
    });
  }

  if (scenario.status === 'failed_sync') {
    notifs.push({
      id: demoNotifId(request_number, 'mx-failed'),
      recipient_email: 'marcus.webb@streamlinecorp.com',
      recipient_name: 'Marcus Webb',
      type: 'maintainx_failed',
      title: 'MaintainX handoff failed',
      message: `MaintainX sync failed for ${request_number} (simulated 503).`,
      request_id: rec.id,
      read_at: null,
      created_at: hoursAgo(3),
    });
  } else if (scenario.maintainx_id || scenario.status === 'sent_to_maintainx') {
    notifs.push({
      id: demoNotifId(request_number, 'mx-sent'),
      recipient_email: 'marcus.webb@streamlinecorp.com',
      recipient_name: 'Marcus Webb',
      type: 'maintainx_sent',
      title: 'MaintainX handoff succeeded',
      message: `${request_number} was sent to MaintainX${scenario.maintainx_sequential_id ? ` (${scenario.maintainx_sequential_id})` : ''}.`,
      request_id: rec.id,
      read_at: index % 7 === 0 ? hoursAgo(1) : null,
      created_at: hoursAgo(7),
    });
  }

  for (const n of notifs) {
    await saveDemoNotification(n);
  }
}

async function seedOneRequest(template, index, actorEmail, opts = {}) {
  const scenario = { ...template };
  const internal = pick(INTERNAL, index);
  const client = scenario.client || pick(CLIENTS, index);
  const isClient = !!scenario.client || scenario.status === 'waiting_on_client_review';
  const offsets = agingOffsets(scenario.aging || 'fresh');
  const created_at = daysAgo(offsets.createdDays);
  const updated_at = hoursAgo(offsets.updatedHours);

  const prefix = REQUEST_NUMBER_PREFIX[scenario.type] || 'REQ';
  const request_number = `DEMO-${prefix}-${String(900001 + index).padStart(6, '0')}`;

  const existing =
    typeof store.getRequestByNumber === 'function' ? await store.getRequestByNumber(request_number) : null;
  if (existing && !existing.demo) {
    return { skipped: true, reason: 'non_demo_conflict', request_number };
  }

  const requester = isClient
    ? {
        requester_name: client.name,
        requester_email: client.email,
        requester_company: client.company,
        requester_type: 'client',
      }
    : {
        requester_name: internal.name,
        requester_email: internal.email,
        requester_company: 'Streamline Operations',
        requester_type: 'employee',
      };

  const rec = await store.saveRequest({
    ...store.emptyRequest(),
    id: existing?.id || store.generateId(),
    demo: true,
    request_number,
    request_type: scenario.type,
    title: scenario.title,
    description: scenario.description,
    ...requester,
    location: scenario.location,
    department: internal.dept,
    priority: scenario.priority || 'normal',
    status: scenario.status,
    assigned_to: scenario.assignee || internal.email,
    assigned_team: scenario.assignee ? 'Maintenance' : internal.dept,
    client_visible_status:
      scenario.status === 'waiting_on_client_review' ? 'Awaiting your review' : null,
    maintainx_id: scenario.maintainx_id || null,
    maintainx_sequential_id: scenario.maintainx_sequential_id || null,
    maintainx_status: scenario.maintainx_status || null,
    maintainx_synced_at: scenario.maintainx_id ? updated_at : null,
    n8n_workflow_run_id: scenario.status === 'failed_sync' ? null : `n8n-demo-run-${index}`,
    created_at,
    updated_at,
    due_at: daysAgo(-7),
    completed_at: ['completed', 'closed'].includes(scenario.status) ? hoursAgo(12) : null,
    closed_at: scenario.status === 'closed' ? hoursAgo(6) : null,
  });

  await trackDemoRequest(rec.id);

  if (existing?.demo && opts.updateOnly) {
    await seedDemoNotifications({
      rec,
      scenario,
      request_number,
      internal,
      client,
      savedSteps: [],
      index,
    });
    return { request: rec, steps: [], updated: true, created: false, skipped: false };
  }

  const history = buildStatusTimeline(rec.id, scenario.status, created_at, actorEmail);
  for (const h of history) {
    const entry = await store.addStatusHistory(h);
    if (!usesPostgresStore() && store.redis?.set) {
      await store.redis.set(`hub:status_history:${entry.id}`, JSON.stringify({ ...entry, demo: true }));
    }
  }

  const steps = scenario.steps || [];
  const savedSteps = [];
  for (let si = 0; si < steps.length; si++) {
    const s = steps[si];
    const step = await store.saveWorkflowStep({
      demo: true,
      request_id: rec.id,
      step_order: si + 1,
      step_type: s.step_type,
      step_title: s.step_title,
      assigned_to_email: s.visible_to_client ? client.email : scenario.assignee || internal.email,
      assigned_to_name: s.visible_to_client ? client.name : internal.name,
      assigned_type: s.visible_to_client ? 'client' : 'employee',
      status: s.status || 'not_started',
      visible_to_client: !!s.visible_to_client,
      requires_signature: !!s.requires_signature,
      started_at: ['in_progress', 'completed', 'failed', 'rejected'].includes(s.status)
        ? hoursAgo(20)
        : null,
      completed_at: s.status === 'completed' ? hoursAgo(8) : null,
      completed_by: s.status === 'completed' ? internal.email : null,
      notes: s.status === 'failed' ? 'MaintainX API returned 503 — demo simulated failure' : '',
    });
    savedSteps.push(step);
  }

  const comments = [
    {
      author_email: internal.email,
      author_name: internal.name,
      body: 'Acknowledged — coordinating with field supervisor before next shift.',
      visible_to_client: false,
    },
    {
      author_email: internal.email,
      author_name: internal.name,
      body: 'Updated priority per morning ops standup.',
      visible_to_client: false,
    },
  ];
  if (isClient) {
    comments.push({
      author_email: client.email,
      author_name: client.name,
      body: 'Please confirm the proposed window works for our commissioning team.',
      visible_to_client: true,
    });
  }
  for (const c of comments) {
    const comment = await store.addComment({ request_id: rec.id, ...c });
    if (!usesPostgresStore() && store.redis?.set) {
      await store.redis.set(`hub:comment:${comment.id}`, JSON.stringify({ ...comment, demo: true }));
    }
  }

  const docs = [
    {
      document_type: 'attachment',
      file_name: `${request_number}-site-photo.jpg`,
      file_url: `https://demo.streamlinecorp.local/docs/${rec.id}/site-photo.jpg`,
      storage_provider: 'sharepoint',
      uploaded_by: internal.email,
    },
  ];
  if (scenario.type === 'bol') {
    docs.push({
      document_type: 'bol_scan',
      file_name: `${request_number}-signed-bol.pdf`,
      file_url: `https://demo.streamlinecorp.local/docs/${rec.id}/bol.pdf`,
      storage_provider: 'sharepoint',
      uploaded_by: internal.email,
    });
  }
  for (const d of docs) {
    const doc = await store.saveDocument({ request_id: rec.id, ...d, demo: true });
    if (!usesPostgresStore() && store.redis?.set) {
      await store.redis.set(`hub:document:${doc.id}`, JSON.stringify(doc));
    }
  }

  await saveDemoIntegrationEvent({
    event_type: 'request.created',
    request_id: rec.id,
    status: 'sent',
    payload: { demo: true, request_number },
    attempts: 1,
    sent_at: created_at,
  });

  if (scenario.status === 'failed_sync') {
    await saveDemoIntegrationEvent({
      event_type: 'work_order.sent_to_maintainx',
      request_id: rec.id,
      status: 'failed',
      payload: { demo: true, error: 'MaintainX timeout (simulated)' },
      attempts: 3,
      last_error: 'HTTP 503 upstream — demo seed',
    });
  } else if (scenario.maintainx_id) {
    await saveDemoIntegrationEvent({
      event_type: 'work_order.sent_to_maintainx',
      request_id: rec.id,
      status: 'sent',
      payload: { demo: true, maintainx_id: scenario.maintainx_id },
      attempts: 1,
      sent_at: updated_at,
    });
  } else if (scenario.status === 'waiting_on_signature') {
    await saveDemoIntegrationEvent({
      event_type: 'workflow_step.created',
      request_id: rec.id,
      workflow_step_id: savedSteps[savedSteps.length - 1]?.id,
      status: 'pending',
      payload: { demo: true, note: 'Awaiting n8n signature workflow' },
    });
  } else {
    await saveDemoIntegrationEvent({
      event_type: 'request.status_changed',
      request_id: rec.id,
      status: 'sent',
      payload: { demo: true, status: scenario.status },
      attempts: 1,
      sent_at: updated_at,
    });
  }

  await seedDemoNotifications({
    rec,
    scenario,
    request_number,
    internal,
    client,
    savedSteps,
    index,
  });

  return { request: rec, steps: savedSteps, updated: !!existing?.demo, created: !existing?.demo, skipped: false };
}

const DEMO_STATUSES = [
  'submitted',
  'received',
  'in_review',
  'waiting_on_internal_review',
  'waiting_on_client_review',
  'waiting_on_signature',
  'waiting_on_approval',
  'sent_to_maintainx',
  'maintainx_in_progress',
  'waiting_on_parts',
  'in_progress',
  'failed_sync',
  'completed',
  'closed',
  'rejected',
  'canceled',
];

function expandTemplates(count) {
  const out = [];
  let i = 0;
  while (out.length < count) {
    for (const t of SCENARIOS) {
      if (out.length >= count) break;
      const variant = { ...t };
      variant.status = DEMO_STATUSES[i % DEMO_STATUSES.length];
      if (i >= SCENARIOS.length) {
        variant.title = `${t.title} (${Math.floor(i / SCENARIOS.length) + 1})`;
      }
      if (variant.status === 'maintainx_in_progress') {
        variant.maintainx_id = variant.maintainx_id || `mx-demo-${9000 + i}`;
        variant.maintainx_sequential_id = `MX-WO-${9000 + i}`;
        variant.maintainx_status = 'in_progress';
      }
      out.push(variant);
      i++;
    }
  }
  return out;
}

async function seedDemoData(actorEmail) {
  const TARGET = 75;
  const { getHubStoreMode } = require('../api/lib/hub/db/config');
  const templates = expandTemplates(TARGET);
  const created = [];
  const actionLinks = [];
  let created_count = 0;
  let updated_count = 0;
  let skipped_count = 0;

  for (let i = 0; i < templates.length; i++) {
    const prefix = REQUEST_NUMBER_PREFIX[templates[i].type] || 'REQ';
    const request_number = `DEMO-${prefix}-${String(900001 + i).padStart(6, '0')}`;
    const hadExisting =
      typeof store.getRequestByNumber === 'function' ? await store.getRequestByNumber(request_number) : null;

    const result = await seedOneRequest(templates[i], i, actorEmail, { updateOnly: !!hadExisting?.demo });
    if (result.skipped) {
      skipped_count++;
      continue;
    }
    if (result.updated) updated_count++;
    else if (result.created) created_count++;
    created.push(result.request);

    if (
      !hadExisting?.demo &&
      i < 8 &&
      ['waiting_on_client_review', 'waiting_on_signature'].includes(templates[i].status)
    ) {
      const signStep = result.steps.find((s) => s.status === 'pending' && (s.requires_signature || s.visible_to_client));
      const { link, token } = await store.createActionLink({
        request_id: result.request.id,
        workflow_step_id: signStep?.id || null,
        recipient_email:
          templates[i].client?.email || result.request.requester_email,
        action_type: signStep?.requires_signature ? 'sign' : 'complete',
        expires_in_hours: 168,
      });
      if (!usesPostgresStore() && store.redis?.set) {
        await store.redis.set(
          `hub:action_link:${link.id}`,
          JSON.stringify({ ...link, demo: true })
        );
        await store.redis.sadd(`hub:request:${result.request.id}:action_links`, link.id);
      }
      const base = process.env.PORTAL_BASE_URL || 'http://127.0.0.1:3000';
      actionLinks.push({
        request_id: result.request.id,
        request_number: result.request.request_number,
        url: `${base}/action.html?t=${encodeURIComponent(token)}`,
        demo: true,
      });
    }
  }

  return {
    ok: true,
    seeded: created.length,
    created_count,
    updated_count,
    skipped_count,
    store_mode: getHubStoreMode(),
    request_ids: created.map((r) => r.id),
    action_links: actionLinks,
    message: `Demo seed complete: ${created_count} created, ${updated_count} updated, ${skipped_count} skipped (${getHubStoreMode()}).`,
  };
}

async function seedAllDemoData(actorEmail) {
  const hubResult = await seedDemoData(actorEmail);
  let archiveResult = { created_count: 0, skipped_count: 0, message: 'Archive seed skipped' };
  try {
    const archiveSeed = require('./hub-archive-demo-seed');
    archiveResult = await archiveSeed.seedArchiveDemoData(actorEmail);
  } catch (err) {
    console.warn('[hub-demo-seed] archive demo seed failed:', err.message);
    archiveResult = { ok: false, error: err.message };
  }
  return {
    ...hubResult,
    archive: archiveResult,
    message: `${hubResult.message} ${archiveResult.message || ''}`.trim(),
  };
}

async function clearDemoData() {
  const requestIds =
    typeof store.listDemoRequestIds === 'function'
      ? await store.listDemoRequestIds()
      : store.redis?.smembers
        ? await store.redis.smembers(DEMO_INDEX)
        : [];

  if (!requestIds?.length) {
    return { ok: true, cleared: 0, message: 'No demo data to clear.' };
  }

  let cleared = 0;
  for (const requestId of requestIds) {
    const req = await store.getRequest(requestId);
    if (!req?.demo) {
      if (!usesPostgresStore() && store.redis?.srem) await store.redis.srem(DEMO_INDEX, requestId);
      continue;
    }
    await store.deleteDemoRequest(requestId);
    cleared++;
  }
  if (!usesPostgresStore() && store.redis?.del) await store.redis.del(DEMO_INDEX);

  let archiveClear = { cleared: 0 };
  try {
    const archiveSeed = require('./hub-archive-demo-seed');
    archiveClear = await archiveSeed.clearArchiveDemoData();
  } catch (err) {
    console.warn('[hub-demo-seed] archive demo clear failed:', err.message);
  }

  return {
    ok: true,
    cleared,
    archive_cleared: archiveClear.cleared || 0,
    message: `Removed ${cleared} demo requests and related records (CASCADE). ${archiveClear.message || ''}`.trim(),
  };
}

module.exports = {
  isDevDemoAllowed,
  seedDemoData,
  seedAllDemoData,
  clearDemoData,
};
