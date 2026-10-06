/**
 * Dev-only demo seed for legacy portal archives (JSA, BOL, WO, Parts, Roll Off Swap).
 * Records are marked demo: true and tracked for cleanup via hub:demo:archives.
 */

const { createRedisClient } = require('./redis-client');

const DEMO_ARCHIVE_INDEX = 'hub:demo:archives';

const SITES = [
  'Midland Construction Yard',
  'Permian Battery Hub — Block C',
  'Eagle Ford Pad 12',
  'Houston Fabrication Shop',
];

const PEOPLE = {
  sarah: { name: 'Sarah Chen', email: 'sarah.chen@streamlinecorp.com' },
  marcus: { name: 'Marcus Webb', email: 'marcus.webb@streamlinecorp.com' },
  elena: { name: 'Elena Vasquez', email: 'elena.vasquez@streamlinecorp.com' },
  david: { name: 'David Park', email: 'david.park@streamlinecorp.com' },
};

function archiveBlobKindKeys(kind) {
  if (kind !== 'jsa' && kind !== 'bol') {
    throw new Error(`Unknown blob-archive kind: ${kind}`);
  }
  return {
    recKeyFor: (id) => `archive:${kind}:rec:${id}`,
    indexKey: `archive:${kind}:idx`,
  };
}

function archiveKindKeys(kind) {
  if (kind === 'parts') {
    return { recordPrefix: 'parts_request', indexKey: 'parts_requests:by-date' };
  }
  if (kind === 'wo') {
    return { recordPrefix: 'work_order', indexKey: 'work_orders:by-date' };
  }
  if (kind === 'roll-off-swap') {
    return { recordPrefix: 'roll_off_swap', indexKey: 'roll_off_swap:by-date' };
  }
  throw new Error(`Unknown archive kind: ${kind}`);
}

function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function daysAgoMs(days) {
  return new Date(daysAgoIso(days)).getTime();
}

function formatDisplayDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

async function trackDemoArchive(redis, kind, id) {
  await redis.sadd(DEMO_ARCHIVE_INDEX, `${kind}:${id}`);
}

async function demoArchiveExists(redis, kind, id) {
  if (kind === 'jsa' || kind === 'bol') {
    const keys = archiveBlobKindKeys(kind);
    const raw = await redis.get(keys.recKeyFor(id));
    return !!raw;
  }
  const { recordPrefix } = archiveKindKeys(kind);
  const raw = await redis.get(`${recordPrefix}:${id}`);
  return !!raw;
}

async function writeDemoBlobArchive(redis, kind, record) {
  const keys = archiveBlobKindKeys(kind);
  const createdMs = new Date(record.createdAt).getTime();
  const pipe = redis.pipeline();
  pipe.set(keys.recKeyFor(record.id), JSON.stringify(record));
  pipe.zadd(keys.indexKey, { score: createdMs, member: record.id });
  pipe.sadd(DEMO_ARCHIVE_INDEX, `${kind}:${record.id}`);
  await pipe.exec();
}

async function writeDemoRequestArchive(redis, kind, record) {
  const { recordPrefix, indexKey } = archiveKindKeys(kind);
  const createdMs = new Date(record.createdAt).getTime();
  const pipe = redis.pipeline();
  pipe.set(`${recordPrefix}:${record.id}`, JSON.stringify(record));
  pipe.zadd(indexKey, { score: createdMs, member: record.id });
  pipe.sadd(DEMO_ARCHIVE_INDEX, `${kind}:${record.id}`);
  await pipe.exec();
}

function buildJsaRecord(spec) {
  const person = PEOPLE[spec.person] || PEOPLE.elena;
  const createdAt = daysAgoIso(spec.daysAgo || 0);
  const dateIso = createdAt.slice(0, 10);
  return {
    id: spec.id,
    kind: 'jsa',
    demo: true,
    createdAt,
    createdBy: {
      ssoEmail: person.email,
      ssoName: person.name,
      formName: person.name,
    },
    data: {
      employee: person.name,
      date: formatDisplayDate(createdAt),
      dateIso,
      customers: spec.customers,
      briefWork: spec.briefWork,
      briefHaz: spec.briefHaz,
      issuer: 'Streamline EHS',
      employeeSigs: [{ name: person.name }],
      rows: spec.rows,
      selectedActivities: spec.activities || [],
      mode: spec.mode || 'lite',
      exportedToWorkOrder: spec.workOrder || null,
    },
  };
}

function buildBolRecord(spec) {
  const person = PEOPLE[spec.person] || PEOPLE.david;
  const createdAt = daysAgoIso(spec.daysAgo || 0);
  const dateIso = createdAt.slice(0, 10);
  return {
    id: spec.id,
    kind: 'bol',
    demo: true,
    createdAt,
    createdBy: {
      ssoEmail: person.email,
      ssoName: person.name,
      formName: person.name,
    },
    data: {
      employee: person.name,
      driver: person.name,
      date: formatDisplayDate(createdAt),
      dateIso,
      bolNumber: spec.bolNumber,
      truck: spec.truck,
      trailer: spec.trailer || '',
      fromCompany: 'Streamline Operations',
      consigneeName: spec.consigneeName,
      consigneeAddr: spec.consigneeAddr || '1200 Industrial Blvd',
      consigneeCity: spec.consigneeCity || 'Midland',
      consigneeState: spec.consigneeState || 'TX',
      consigneeZip: spec.consigneeZip || '79701',
      items: spec.items,
      notes: spec.notes || 'Demo archive record — seeded for local development.',
    },
  };
}

const JSA_SCENARIOS = [
  {
    id: 'demo-archive-jsa-001',
    person: 'elena',
    daysAgo: 2,
    customers: 'Continental Energy',
    briefWork: 'Rigging and setting precast transformer pad',
    briefHaz: 'Critical lift over energized yard corridor',
    activities: ['Rigging', 'Crane operations'],
    workOrder: { workOrderNumber: '48291', workOrderId: 'mx-demo-48291' },
    rows: [
      { step: 'Mobilize crane and set mats', hazards: 'Pinch points, swing radius', controls: 'Barricade swing zone, spotter assigned' },
      { step: 'Lift and set pad', hazards: 'Suspended load, energised corridor', controls: 'Critical lift plan, EHS standby' },
    ],
  },
  {
    id: 'demo-archive-jsa-002',
    person: 'marcus',
    daysAgo: 8,
    customers: 'Streamline Operations',
    briefWork: 'Excavator bucket change-out at Midland yard',
    briefHaz: 'Hydraulic pressure, dropped objects',
    activities: ['Maintenance'],
    rows: [
      { step: 'Isolate machine and relieve pressure', hazards: 'Unexpected movement', controls: 'LOTO, verify zero energy' },
      { step: 'Remove and install bucket pins', hazards: 'Hand injury, dropped bucket', controls: 'Pin retainers, lift plan' },
    ],
  },
  {
    id: 'demo-archive-jsa-003',
    person: 'sarah',
    daysAgo: 18,
    customers: 'Pioneer Drilling',
    briefWork: 'Confined space entry — vessel inspection Pad 12',
    briefHaz: 'Atmospheric hazard, limited egress',
    activities: ['Confined space'],
    rows: [
      { step: 'Atmospheric monitoring', hazards: 'O2 deficiency, H2S', controls: 'Continuous monitor, attendant posted' },
      { step: 'Entry and inspection', hazards: 'Engulfment', controls: 'Harness, retrieval tripod, permit signed' },
    ],
  },
];

const BOL_SCENARIOS = [
  {
    id: 'demo-archive-bol-001',
    person: 'david',
    daysAgo: 4,
    bolNumber: 'BOL-44018',
    truck: 'Unit 214',
    trailer: 'Flatbed T-88',
    consigneeName: 'Permian Battery Hub',
    items: [
      { description: 'Switchgear section A', quantity: 1, weight: '4200 lb' },
      { description: 'Switchgear section B', quantity: 1, weight: '3800 lb' },
    ],
    notes: 'PO 44018-BOL — seal intact at receipt.',
  },
  {
    id: 'demo-archive-bol-002',
    person: 'marcus',
    daysAgo: 14,
    bolNumber: 'BOL-44102',
    truck: 'Unit 107',
    consigneeName: 'Scrap Solutions LLC',
    items: [{ description: 'Scrap steel cuttings', quantity: 1, weight: '12600 lb' }],
    notes: 'Outbound load from fabrication shop cleanup.',
  },
];

const WO_SCENARIOS = [
  {
    id: 'demo-archive-wo-001',
    person: 'sarah',
    daysAgo: 1,
    title: 'Replace hydraulic hose on Cat 390F — swing joint leak',
    locationName: SITES[0],
    assetName: 'Cat 390F #17',
    workOrderNumber: '48291',
    maintainxId: 'mx-demo-48291',
    priority: 'HIGH',
    brief: 'Visible fluid at swing bearing during morning walkdown.',
  },
  {
    id: 'demo-archive-wo-002',
    person: 'marcus',
    daysAgo: 6,
    title: 'Annual PM — Megapack skid cooling loop inspection',
    locationName: SITES[1],
    assetName: 'Megapack Skid C-04',
    workOrderNumber: '51002',
    maintainxId: 'mx-demo-51002',
    priority: 'MEDIUM',
    brief: 'Scheduled PM per OEM bulletin TB-2024-18.',
  },
  {
    id: 'demo-archive-wo-003',
    person: 'elena',
    daysAgo: 21,
    title: 'Deploy portable lighting towers — night concrete pour',
    locationName: SITES[2],
    assetName: 'Pad 12 pour zone',
    workOrderNumber: '49877',
    maintainxId: 'mx-demo-49877',
    priority: 'HIGH',
    brief: 'Four LED towers for overnight pour window.',
  },
];

const PARTS_SCENARIOS = [
  {
    id: 'demo-archive-parts-001',
    person: 'elena',
    daysAgo: 3,
    locationName: SITES[0],
    workOrderNumber: '48291',
    maintainxId: 'mx-demo-48291',
    parts: [
      { partNumber: '387TC-16', quantity: 2, serialNumber: '', photoCount: 0 },
      { partNumber: 'Parker-8-JIC', quantity: 4, serialNumber: '', photoCount: 0 },
    ],
    notes: 'Emergency order for active leak repair WO.',
  },
  {
    id: 'demo-archive-parts-002',
    person: 'david',
    daysAgo: 11,
    locationName: SITES[2],
    workOrderNumber: '50144',
    maintainxId: 'mx-demo-50144',
    parts: [
      { partNumber: 'SEAL-TAPE-1IN', quantity: 12, serialNumber: '', photoCount: 0 },
      { partNumber: 'NITRILE-L', quantity: 6, serialNumber: '', photoCount: 0 },
    ],
    notes: 'Q2 consumables restock for field trailers.',
  },
];

const ROS_SCENARIOS = [
  {
    id: 'demo-archive-ros-001',
    person: 'marcus',
    daysAgo: 5,
    locationName: SITES[0],
    binType: 'DWB',
    incomingBinNumber: 'DWB-4421',
    submittedBy: PEOPLE.marcus.name,
  },
  {
    id: 'demo-archive-ros-002',
    person: 'sarah',
    daysAgo: 16,
    locationName: SITES[2],
    binType: 'SULFUR',
    incomingBinNumber: 'SF-1188',
    submittedBy: PEOPLE.sarah.name,
  },
];

async function seedArchiveDemoData(actorEmail) {
  const redis = createRedisClient();
  let created_count = 0;
  let skipped_count = 0;

  for (const spec of JSA_SCENARIOS) {
    if (await demoArchiveExists(redis, 'jsa', spec.id)) {
      skipped_count++;
      continue;
    }
    await writeDemoBlobArchive(redis, 'jsa', buildJsaRecord(spec));
    created_count++;
  }

  for (const spec of BOL_SCENARIOS) {
    if (await demoArchiveExists(redis, 'bol', spec.id)) {
      skipped_count++;
      continue;
    }
    await writeDemoBlobArchive(redis, 'bol', buildBolRecord(spec));
    created_count++;
  }

  for (const spec of WO_SCENARIOS) {
    if (await demoArchiveExists(redis, 'wo', spec.id)) {
      skipped_count++;
      continue;
    }
    const person = PEOPLE[spec.person] || PEOPLE.sarah;
    const createdAt = daysAgoIso(spec.daysAgo || 0);
    await writeDemoRequestArchive(redis, 'wo', {
      id: spec.id,
      kind: 'wo',
      demo: true,
      createdAt,
      submittedBy: person.email,
      contactEmail: person.email,
      title: spec.title,
      brief: spec.brief,
      locationName: spec.locationName,
      assetName: spec.assetName,
      workOrderNumber: spec.workOrderNumber,
      maintainxId: spec.maintainxId,
      priority: spec.priority,
      submittedAt: createdAt,
      seededBy: actorEmail || person.email,
    });
    created_count++;
  }

  for (const spec of PARTS_SCENARIOS) {
    if (await demoArchiveExists(redis, 'parts', spec.id)) {
      skipped_count++;
      continue;
    }
    const person = PEOPLE[spec.person] || PEOPLE.elena;
    const createdAt = daysAgoIso(spec.daysAgo || 0);
    await writeDemoRequestArchive(redis, 'parts', {
      id: spec.id,
      kind: 'parts',
      demo: true,
      createdAt,
      submittedBy: person.email,
      contactEmail: person.email,
      locationName: spec.locationName,
      workOrderNumber: spec.workOrderNumber,
      maintainxId: spec.maintainxId,
      parts: spec.parts,
      notes: spec.notes,
      submittedAt: createdAt,
      seededBy: actorEmail || person.email,
    });
    created_count++;
  }

  for (const spec of ROS_SCENARIOS) {
    if (await demoArchiveExists(redis, 'roll-off-swap', spec.id)) {
      skipped_count++;
      continue;
    }
    const person = PEOPLE[spec.person] || PEOPLE.marcus;
    const createdAt = daysAgoIso(spec.daysAgo || 0);
    await writeDemoRequestArchive(redis, 'roll-off-swap', {
      id: spec.id,
      kind: 'roll-off-swap',
      demo: true,
      createdAt,
      submittedBy: spec.submittedBy || person.name,
      locationName: spec.locationName,
      binType: spec.binType,
      incomingBinNumber: spec.incomingBinNumber,
      submittedAt: createdAt,
      answers: {
        q1: { answer: 'yes' },
        q2: { answer: 'yes' },
        q3: { answer: spec.binType === 'SULFUR' ? 'no' : 'yes' },
      },
      seededBy: actorEmail || person.email,
    });
    created_count++;
  }

  return {
    ok: true,
    created_count,
    skipped_count,
    message: `Archive demo seed: ${created_count} created, ${skipped_count} skipped.`,
  };
}

async function clearArchiveDemoData() {
  const redis = createRedisClient();
  const entries = (await redis.smembers(DEMO_ARCHIVE_INDEX)) || [];
  if (!entries.length) {
    return { ok: true, cleared: 0, message: 'No demo archive records to clear.' };
  }

  let cleared = 0;
  for (const entry of entries) {
    const sep = entry.indexOf(':');
    if (sep < 0) continue;
    const kind = entry.slice(0, sep);
    const id = entry.slice(sep + 1);

    if (kind === 'jsa' || kind === 'bol') {
      const keys = archiveBlobKindKeys(kind);
      const pipe = redis.pipeline();
      pipe.del(keys.recKeyFor(id));
      pipe.zrem(keys.indexKey, id);
      await pipe.exec();
    } else if (kind === 'parts' || kind === 'wo' || kind === 'roll-off-swap') {
      const { recordPrefix, indexKey } = archiveKindKeys(kind);
      const pipe = redis.pipeline();
      pipe.del(`${recordPrefix}:${id}`);
      pipe.zrem(indexKey, id);
      await pipe.exec();
    }
    cleared++;
  }

  await redis.del(DEMO_ARCHIVE_INDEX);
  return { ok: true, cleared, message: `Removed ${cleared} demo archive records.` };
}

module.exports = {
  seedArchiveDemoData,
  clearArchiveDemoData,
  JSA_SCENARIOS,
  BOL_SCENARIOS,
  WO_SCENARIOS,
  PARTS_SCENARIOS,
  ROS_SCENARIOS,
};
