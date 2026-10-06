# Control Room — Production Station/Unit Bootstrap

**Do not** ship fake `Main Station` / `Unit 1` data in migrations.  
Migration `015_control_room.sql` creates empty `cr_stations` / `cr_units` only.

Until at least one active station exists, Control Room returns `needs_bootstrap: true` and the UI shows a setup banner (no shift, no logging).

---

## 1. Add a station (SQL)

```sql
INSERT INTO cr_stations (key, name, active)
VALUES ('plant-a', 'Plant A Control Room', true)
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name,
      active = true,
      updated_at = now()
RETURNING id, key, name;
```

Use a stable lowercase `key` (slug). Use the real site name for `name`.

---

## 2. Add units under that station (SQL)

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

Replace keys/names with real production units.

---

## 3. Verify

```sql
SELECT s.key AS station, u.key AS unit, u.name
FROM cr_stations s
LEFT JOIN cr_units u ON u.station_id = s.id AND u.active
WHERE s.active
ORDER BY s.key, u.key;
```

Then as an authorized operator:

```bash
# After login session cookie available:
curl -sk -b 'sliops_session=<COOKIE>' \
  'https://<PORTAL>/api/maintainx?path=/hub/control-room/meta' | jq '{stations, units}'
curl -sk -b 'sliops_session=<COOKIE>' \
  'https://<PORTAL>/api/maintainx?path=/hub/control-room/current' | jq '{needs_bootstrap, station, shift}'
```

Expect `needs_bootstrap` false/absent and a `station` object.

---

## 4. Deactivate (do not delete if history exists)

```sql
UPDATE cr_units SET active = false, updated_at = now()
WHERE key = 'unit-100'
  AND station_id = (SELECT id FROM cr_stations WHERE key = 'plant-a');

UPDATE cr_stations SET active = false, updated_at = now()
WHERE key = 'plant-a';
```

Prefer deactivate over hard delete when logs/board rows reference the station.

---

## Application note

There is no Control Room admin UI for station CRUD in this release. Bootstrap is SQL (or a future admin tool). Hub Admin / DB access is required for this step.
