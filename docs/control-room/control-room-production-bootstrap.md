# Control Room — Production Station/Unit Bootstrap

**Do not** ship fake `Main Station` / `Unit 1` / `Test Station` data in migrations.  
Migration `015_control_room.sql` creates empty `cr_stations` / `cr_units` only.

`Test Station` appears only when the **in-memory test store** is used with
`CONTROL_ROOM_MEMORY_SEED=1` (automated tests). Production Postgres never seeds it.

Until at least one active station exists, Control Room returns `needs_bootstrap: true`
and the UI shows a setup state (no shift, no logging).

---

## Preferred: authorized UI / API

Hub Admin, Admin, or users with `control_room_supervisor` can create stations and units
from the Control Room **Station setup** panel, or via API:

```bash
# Create station
curl -sk -b 'sliops_session=<COOKIE>' -X POST \
  -H 'Content-Type: application/json' \
  -d '{"name":"Plant A Control Room","key":"plant-a"}' \
  'https://<PORTAL>/api/maintainx?path=/hub/control-room/stations'

# Create unit (use station id from previous response)
curl -sk -b 'sliops_session=<COOKIE>' -X POST \
  -H 'Content-Type: application/json' \
  -d '{"station_id":"<STATION_UUID>","name":"Unit 100","key":"unit-100"}' \
  'https://<PORTAL>/api/maintainx?path=/hub/control-room/units'
```

Use real operational names. Keys are lowercase slugs.

---

## Alternate: SQL

### 1. Add a station

```sql
INSERT INTO cr_stations (key, name, active)
VALUES ('plant-a', 'Plant A Control Room', true)
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name,
      active = true,
      updated_at = now()
RETURNING id, key, name;
```

### 2. Add units under that station

```sql
INSERT INTO cr_units (station_id, key, name, active)
SELECT s.id, u.key, u.name, true
FROM cr_stations s
CROSS JOIN (VALUES
  ('unit-100', 'Unit 100'),
  ('unit-200', 'Unit 200')
) AS u(key, name)
WHERE s.key = 'plant-a'
ON CONFLICT (station_id, key) DO UPDATE
  SET name = EXCLUDED.name,
      active = true,
      updated_at = now();
```

---

## MaintainX mapping (recommendation — no auto-sync)

Control Room stations/units are **authoritative in `cr_stations` / `cr_units`**.

MaintainX locations and assets can inform naming and optional log fields
(`maintainx_asset_id` on shift logs), but **do not auto-import or sync** MaintainX
locations into CR tables until Streamline confirms a stable mapping, for example:

| Control Room | MaintainX (candidate) |
|--------------|------------------------|
| Station `key` / `name` | Site or location name |
| Unit `key` / `name` | Asset / location under that site |
| Log `maintainx_asset_id` | MaintainX asset id (optional, per event) |

Keep CR records independent so operator continuity is not blocked by MaintainX
API availability or location hierarchy changes.

---

## Verify

```sql
SELECT s.key AS station, u.key AS unit, u.name
FROM cr_stations s
LEFT JOIN cr_units u ON u.station_id = s.id AND u.active
WHERE s.active
ORDER BY s.key, u.key;
```

```bash
curl -sk -b 'sliops_session=<COOKIE>' \
  'https://<PORTAL>/api/maintainx?path=/hub/control-room/meta' | jq '{stations, units}'
curl -sk -b 'sliops_session=<COOKIE>' \
  'https://<PORTAL>/api/maintainx?path=/hub/control-room/current' | jq '{needs_bootstrap, station, shift}'
```

Expect `needs_bootstrap` false/absent and a `station` object.

---

## Deactivate (do not delete if history exists)

```sql
UPDATE cr_units SET active = false, updated_at = now()
WHERE key = 'unit-100'
  AND station_id = (SELECT id FROM cr_stations WHERE key = 'plant-a');

UPDATE cr_stations SET active = false, updated_at = now()
WHERE key = 'plant-a';
```

Prefer deactivate over hard delete when logs/board rows reference the station.
