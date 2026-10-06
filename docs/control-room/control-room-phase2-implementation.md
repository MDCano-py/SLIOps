# Control Room — Phase 2 Implementation Plan

**Date:** 2026-10-05  
**Status:** BLOCKED on Gate 0 human confirmations + Gates 1–3  
**Product boundary:** Operational memory and shift continuity inside SLIOps. Not MaintainX, Paycom, Snowflake, or a second RBAC system.

---

## Current repository delta

| Capability | Classification |
| --- | --- |
| Operations → Control Room nav | `MISSING_REQUIRED` |
| Current Shift | `MISSING_REQUIRED` |
| Quick Log + timeline | `MISSING_REQUIRED` |
| Acknowledgements (append-only) | `MISSING_REQUIRED` |
| Handover | `MISSING_REQUIRED` |
| Operating Board | `MISSING_REQUIRED` |
| Operator Tasks | `MISSING_REQUIRED` |
| Schedule foundation | `MISSING_REQUIRED` |
| History | `MISSING_REQUIRED` |
| Supervisor Overview | `MISSING_REQUIRED` |
| `/hub/control-room/*` APIs | `MISSING_REQUIRED` |
| Postgres CR schema | `MISSING_REQUIRED` |
| Historical port from `control-room-workspace` @ `1e86af7…` | `UNKNOWN` — objects not in this git repo |

Do **not** invent tables until historical migration (if any) is provided and compared to migrations 001–014.

---

## Prerequisites before coding Gate 4

1. Gate 1 remote exposure probes pass.  
2. Gate 2 Critical/High authz issues closed or accepted.  
3. Gate 3 WOS regression green on secured codebase.  
4. Business answers for resource scope (see `control-room-permissions.md`).  
5. Historical CR source available **or** explicit greenlight to design net-new schema.

---

## Target IA (when unblocked)

Operations → Control Room:

1. Current Shift  
2. Handover  
3. Operating Board  
4. Tasks  
5. Schedule  
6. History  
7. Supervisor Overview  

Reuse existing SLIOps shell (`index.html`, `hub.css`, hash router). API namespace: `/hub/control-room/*`.

---

## Suggested delivery slices (after unblocked)

| Slice | Deliverable |
| --- | --- |
| CR-0 | Schema delta doc + migration design + permission proposals |
| CR-1 | Current Shift + Quick Log + timeline + ack |
| CR-2 | Operating Board + continuity across shifts |
| CR-3 | Tasks lifecycle |
| CR-4 | Handover assemble/ack |
| CR-5 | Schedule foundation |
| CR-6 | History + Supervisor Overview |
| CR-7 | Audit + authz tests + scenarios A–E |

---

## Explicitly deferred

Snowflake, Paycom, Samsara exposure math, AI features, MaintainX WO replacement, major UI redesign, new microservices.
