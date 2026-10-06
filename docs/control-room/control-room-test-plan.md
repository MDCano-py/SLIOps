# Control Room Test Plan

**Date:** 2026-10-05  
**Status:** Draft — execute after Gate 4 implementation  
**Depends on:** `control-room-permissions.md` answers + working `/hub/control-room/*`

---

## Automated (to add with implementation)

| Suite | Coverage |
| --- | --- |
| `security:control-room-authz-test` | Capability deny/allow, no body actor trust |
| `security:control-room-resource-scope-test` | Horizontal cases from documented policy |
| Hub integration tests | Transactions, audit rows, ack append-only |

---

## Scenario A — Shift logging

1. Operator enters Control Room → current shift loads.  
2. Create Normal event → appears immediately.  
3. Create Urgent event → appears.  
4. Another authorized user acknowledges Urgent → identity + timestamp persist.  
5. Supervisor view reflects ack state.

## Scenario B — Cross-shift board

1. Create board issue → remains open at shift end.  
2. Appears in handover.  
3. Incoming ack handover → board still open.  
4. Resolve explicitly → leaves active view; history kept; audit present.

## Scenario C — Task lifecycle

1. Create task with assignee + due.  
2. Assignee sees it; overdue derived when due passes.  
3. Complete with note → identity/timestamp/history.

## Scenario D — Vertical authz

Standard calls supervisor/admin-only mutation → 403, no data change, audit optional.

## Scenario E — Horizontal authz

UserA vs UserB on a resource that policy isolates — not a shared station log chosen only to force a deny.

## Scenario F — SSO trust (platform)

Non-`manage_sso` user mutates SAML → 403 (platform Gate 2; prerequisite).

## Scenario G — Sensitive files

Anonymous probes (Gate 1).

## Scenario H — Logout

Login/logout/reauth without loop (platform Gate 3).

---

## MaintainX degradation

With MaintainX unset: Quick Log and board still usable; asset reference optional fields show unavailable state without crashing.
