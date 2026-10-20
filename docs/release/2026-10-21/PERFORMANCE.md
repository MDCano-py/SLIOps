# Performance — 2026-10-21 release candidate

Measurements were taken on 2026-10-20 on the developer workstation. They are single samples, not a staged load test. Authorization results are not cached.

## Vendor workspace read

Before this change, `GET /vendor/workspace` called `vendorStore.getAllVendorRecords()` and then `Array.find` for the session vendor. It now calls `getVendorRecordById`, which is `SELECT * FROM vendor_master WHERE id = $1 LIMIT 1`. `id` is the primary key from migration `006`.

### In-memory filter versus keyed lookup

`npm run perf:vendor-scope-bench` (200 iterations, last row targeted):

| Rows | Full scan | Keyed lookup |
| --- | ---: | ---: |
| 100 | 0.741 ms | 0.008 ms |
| 1,000 | 1.931 ms | 0.004 ms |
| 5,000 | 8.316 ms | 0.005 ms |

This is the cost of scanning a registry in process. It is not a Postgres timing.

### Local Postgres

Same command, `getAllVendorRecords` versus `getVendorRecordById`, **3 rows** in `vendor_master` at sample time:

| Call | Time |
| --- | ---: |
| `getAllVendorRecords` | 62.659 ms |
| `getVendorRecordById` | 2.423 ms |

A later single pair inside the release test, after the pool was warm:

| Call | Time |
| --- | ---: |
| `getAllVendorRecords` | 1.60 ms |
| `getVendorRecordById` | 0.73 ms |

With three rows the absolute gap is small. The query no longer grows with the vendor table. The 62 ms figure includes a cold pool and must not be quoted as a steady-state production latency.

## Not measured

No before/after timings were captured for Hub task aggregation, notification lists, session permission lookups, frontend render counts, or bundle size. Those items from the performance workstream were not changed. N+1 patterns in assignment and signature notification loaders were inspected only enough to leave them on the existing per-request `getRequest` calls. Changing them without a benchmark would risk audit and transaction behavior.

## Indexes added

`018_vendor_login_codes.sql` adds:

- `idx_vendor_login_codes_contact_active` on `(contact_id, created_at DESC)` where `used_at` is null
- `idx_vendor_login_codes_vendor` on `(vendor_id)`

No existing index was dropped.
