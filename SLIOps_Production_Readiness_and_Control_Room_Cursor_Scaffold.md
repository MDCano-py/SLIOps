# SLIOps / WOS Production Readiness, Security Remediation, and Control Room Completion Scaffold

## Purpose

This document is the authoritative implementation scaffold for bringing the current SLIOps / WOS platform to a defensible production ready state, remediating the issues identified by the BW Cyber assessment and the later internal penetration testing, correcting normal frontend and backend defects, and completing the Control Room operator experience requested by Dylan.

The goal is not to maximize the number of findings marked closed. The goal is to make the real SLIOps product secure, stable, auditable, operationally useful, and ready for a future professional penetration test without breaking the workflows that already exist.

SLIOps must remain one coherent application. Control Room is a feature area inside SLIOps, not a separate product and not a replacement for MaintainX.

---

# 1. Nonnegotiable operating rules

## 1.1 Current code wins

The current repository state is authoritative.

Historical references such as `production-ec2`, older production SHAs, `control-room-workspace`, and `1e86af775ca4aa941ece8b4cd54e255fd9d0081a` are references only.

Do not reset the current repository to an older branch. Do not overwrite newer implementations with historical files. Do not cherry pick a historical feature blindly.

For historical Control Room work, diff the historical implementation against the current code and selectively port only functionality that is still missing and still compatible.

## 1.2 Never confuse assessment evidence with deployed truth

For every security issue, distinguish these states:

1. Pentest observed behavior
2. Pentest source review finding
3. Current repository state
4. Current infrastructure and configuration state
5. Current deployed runtime behavior

A report stating that a patch exists locally does not prove production contains it. A report showing a source code weakness does not automatically prove the currently deployed path is exploitable. A current source fix does not prove the server has been redeployed.

Nothing may be labeled `FIXED` until the relevant current code, configuration, and runtime behavior have been validated.

## 1.3 Do not invent business rules

Do not guess which users own which records, which records are private, what a Standard user should see, what a Supervisor should see, which roles exist, which station or unit boundaries apply, which workflows are user scoped versus team scoped, which current endpoints or database tables exist, or which deployment branch is live.

Discover the existing behavior first.

If a security control requires a business decision that cannot be safely inferred, stop at the defined review gate and document the exact decision required.

## 1.4 Frontend visibility is never authorization

Hiding a page, button, menu item, tab, or action is not a security control.

Every privileged API action and every resource access decision must be enforced on the server.

The UI should reflect permissions for usability, but the API must be secure even if a user manually calls it.

## 1.5 Never deploy automatically

Cursor may inspect, refactor, implement, write migrations, write configuration templates, write tests, produce deployment instructions, produce rollback instructions, and produce Cyber retest evidence.

Cursor must not merge to production automatically, deploy to production automatically, rotate real secrets automatically, invent credentials, make Entra changes automatically, make AWS IAM changes automatically, modify DNS automatically, apply production Nginx changes automatically, or claim infrastructure actions were completed when they were only documented.

---

# 2. What SLIOps / WOS actually is

SLIOps is Streamline's Operations Workflow Hub.

Production readiness must cover the existing WOS capabilities, not only the new Control Room area.

The current application may include some or all of the following and Cursor must verify the actual implementation:

1. Microsoft Entra authentication
2. AuthBridge
3. SLIOps session creation and enforcement
4. users
5. roles
6. permissions
7. request workflows
8. workflow steps
9. equipment and operational requests
10. operational records
11. document management
12. S3 backed document storage
13. client secure link workflows
14. fill actions
15. review actions
16. sign actions
17. document audit trail
18. MaintainX integration or proxy behavior
19. administrative functions
20. SSO administration
21. application logging
22. security audit logging
23. Postgres persistence
24. production versus staging safety controls
25. Control Room

Control Room is the operational continuity workspace inside SLIOps.

It must answer:

1. What is happening right now?
2. What changed during this shift?
3. What needs attention?
4. What has not been acknowledged?
5. What carries into the next shift?
6. Who is responsible for the next action?
7. What happened previously?

MaintainX remains the maintenance system.

Control Room may reference MaintainX assets, locations, work orders, or maintenance items where useful, but it must not recreate MaintainX.

---

# 3. Definition of production ready

Do not declare SLIOps production ready until all of the following are true:

1. No known Critical or High exploitable path remains.
2. Any credential or secret reasonably considered exposed has been rotated or explicitly dispositioned by an authorized human.
3. Sessions or tokens affected by credential exposure have been invalidated where required.
4. Authentication is fail closed.
5. AuthBridge token validation is fail closed.
6. Application entitlement is enforced where required.
7. Capability authorization is proven.
8. Resource authorization is proven against the actual business model.
9. SSO trust administration is protected by least privilege.
10. Production proxy and forwarded header trust boundaries are defined and verified.
11. Production configuration does not enable demo, local, development, bypass, or unsafe fallback behavior.
12. Sensitive files and deployment metadata are not web accessible.
13. Existing WOS workflows pass regression testing.
14. S3 backed document workflows pass regression testing.
15. MaintainX integration passes regression testing.
16. Login, logout, session expiry, reauthentication, refresh, and deep links work correctly.
17. Control Room's agreed operator MVP works against Postgres.
18. Control Room writes are authorized and audited.
19. Every pentest finding has an explicit disposition.
20. Every remaining risk has a documented owner and rationale.
21. Database changes have a tested rollback path.
22. Deployment has a tested rollback plan.
23. A production smoke suite and security probe suite pass after deployment.
24. Cyber can retest the relevant findings using documented reproduction steps.

---

# 4. Security source material

Treat the latest internal penetration testing package as the primary assessment of the later SLIOps state.

Reconcile it with the earlier BW Cyber findings.

The BW assessment contains 46 reportable findings plus 4 informational observations.

Known BW severity counts:

Critical: 1

High: 7

Moderate: 17

Low: 21

Info: 4

Known BW Critical and High IDs:

`SCR-W06`

`SCR-A01`

`SCR-A02`

`SCR-A03`

`SCR-D01`

`SCR-S20`

`SCR-W01`

`SCR-W05`

The later internal assessment reportedly expands the total security register and includes stronger validation of some attack chains. Do not guess internal `STR-*` identifiers. Extract all of them directly from the supplied reports and include each in the remediation matrix.

Where the BW and internal assessments describe the same underlying flaw, implement one root cause fix and map all applicable finding IDs to that remediation.

---

# 5. Mandatory Phase 0: establish current SLIOps truth

Do not begin architectural remediation until this phase is complete.

Create:

`docs/architecture/sliops-current-state.md`

The document must be generated from the current repository and current deployment information available to the developer.

## 5.1 Repository truth

Record:

1. current branch
2. current HEAD SHA
3. working tree state
4. relevant remotes
5. relationship to any production branch
6. relationship to historical Control Room branch
7. recent migrations
8. build scripts
9. startup scripts
10. package manager
11. lockfiles
12. current test commands
13. deployment related files

Do not assume `main` is production. Do not assume `production-ec2` is production. Do not assume a historical SHA is still live.

## 5.2 Runtime topology

Discover and document the actual runtime topology.

Where applicable, identify EC2, Nginx, PM2, Node application, AuthBridge, Postgres, Redis, S3, Entra, MaintainX, public domains, public route prefixes, callback URLs, cookie domains, internal service routes, TLS termination point, reverse proxy chain, trusted proxy addresses or ranges, health endpoints, documentation endpoints, and n8n routing if it shares infrastructure.

Mark each item:

`VERIFIED_CURRENT`

`HISTORICAL_REFERENCE`

`UNKNOWN_REQUIRES_HUMAN_CONFIRMATION`

## 5.3 Existing product inventory

Inventory the actual application before changing it.

At minimum inspect Dashboard, Request Queue, New Request, Request Detail, Operations, Documents, My Tasks, Insights, Admin, Users and Permissions, SSO Admin, Logs, Reports, and Control Room.

Do not assume all listed areas still exist.

Record route, frontend entry point, API dependency, authentication requirement, permission requirement, major data tables, external integration, and current known failure.

## 5.4 Existing request and workflow model

Document request types, workflow states, workflow step model, request owner behavior, step assignee behavior, step role behavior, Fill behavior, Review behavior, Sign behavior, client secure link behavior, document requirements, and audit behavior.

Pay special attention to the authorization checks previously added around actor, step assignee, step role, and request owner.

Do not weaken those checks while restructuring RBAC.

## 5.5 Existing document model

Verify S3 driver, upload flow, download flow, metadata storage, document type registry, templates, audit events, client links, authorization, expiration behavior, and error behavior.

## 5.6 MaintainX behavior

Verify proxy route, server side credential use, organization ID requirements, assets, locations, categories, work order references, failure behavior, authorization, and frontend error behavior.

The browser must never receive MaintainX secrets.

## 5.7 Production safety inventory

Search for and document all controls or fallbacks related to:

`DEMO_BYPASS`

`ALLOW_DEV_LOGIN`

`SSO_ENFORCEMENT`

`local_json`

`HUB_USE_LOCAL_STORE`

staging demo data

seed data

preview routes

test routes

debug routes

development login

mock identities

unsafe local storage

weak session secrets

fallback auth providers

production environment detection

Production must fail closed.

## 5.8 Static serving and exposure boundary

Identify exactly what Nginx serves directly, what Node serves statically, public document roots, whether raw repository files exist inside deploy roots, whether `.env` files exist in or below any web accessible root, whether `.git` exists in or below any web accessible root, whether `package.json`, lockfiles, source maps, backups, logs, or deployment files are reachable, and whether path normalization can bypass deny rules.

## 5.9 Current role and permission inventory

Generate:

`docs/security/2026-auth-rbac-model.md`

Extract the real current model from migrations, seed data, configuration, permission constants, backend route checks, frontend visibility checks, database records where available, and AuthBridge claims where relevant.

Produce a table:

| Role | Permission | UI capability | API capability | Resource scope | Source of truth | Verified |
| --- | --- | --- | --- | --- | --- | --- |

Do not invent roles to fill gaps.

If role names such as Supervisor, Legal, Manager, Operator, Standard, Hub Admin, or SSO Admin do not exist in the current system, mark them as proposals rather than current truth.

## 5.10 Route authorization inventory

Produce:

| Route | Method | Authentication | Capability permission | Resource authorization | Audit | Notes |
| --- | --- | --- | --- | --- | --- | --- |

Include all sensitive routes.

Prioritize admin, users, roles, permissions, SSO configuration, requests, documents, client actions, MaintainX proxy, cleanup or destructive endpoints, templates, submissions, and Control Room.

## 5.11 Separate the authorization layers

### Capability authorization

Can this identity perform this type of action?

### Resource authorization

May this identity access or modify this specific object?

Do not implement global `created_by = currentUser` filtering unless the actual product rules require it.

An operations platform often contains shared operational records.

### Application entitlement

May AuthBridge issue this user a token for this target application?

### Administrative trust boundary

Who may alter identity provider certificates, SAML endpoints, issuer settings, application registrations, role mappings, and privileged security configuration?

### UI visibility

What should the user see?

This is a presentation layer only.

## 5.12 Pentest user model

The two Cyber test users were ultimately intended to be equivalent Standard users.

Do not modify the application merely to make UserA and UserB appear different.

Use them to test horizontal authorization against real resource boundaries.

Expected model:

UserA: Standard

UserB: Standard

Admin test user: SLIOps Hub Admin

The admin account does not need Microsoft Global Admin privileges.

Create an explicit test matrix for Standard versus Standard, Standard versus Hub Admin, Standard versus SSO trust administration, permitted shared operational records, and restricted resources where current product rules require isolation.

## 5.13 Control Room current state

Inspect the current repository first.

Then diff the historical branch:

`control-room-workspace`

historical commit:

`1e86af775ca4aa941ece8b4cd54e255fd9d0081a`

Determine which historical functionality is already present in current SLIOps.

Known historical work may include Operations to Control Room route, Current Shift, quick operational log, acknowledgements, supervisor KPI foundation, Postgres migration, shift log persistence, acknowledgement persistence, audit records, stations, units, and `/hub/control-room/*` APIs.

Do not assume any historical table, endpoint, or component still matches current architecture.

Create a delta using:

`CURRENT_EXISTS`

`HISTORICAL_ONLY`

`MISSING_REQUIRED`

`OBSOLETE`

`CONFLICTS_WITH_CURRENT`

## 5.14 Frontend defect inventory

Perform a systematic frontend production audit.

Search for dead navigation, stale routes, broken deep links, hash routing regressions, blank pages, uncaught errors, raw backend errors exposed to users, 401 handling problems, 403 handling problems, login loops, logout loops, refresh state problems, stale state after mutation, duplicate form submissions, buttons that do nothing, filters that do nothing, inconsistent permission visibility, controls visible to unauthorized users, controls hidden from authorized users, invalid loading states, invalid empty states, missing error states, modal state bugs, validation gaps, date and time bugs, timezone bugs, mobile layout defects, keyboard navigation problems, focus management problems, missing labels, MaintainX failure handling, S3 failure handling, session expiration UX, and Control Room refresh behavior.

Create a prioritized bug table using:

`P0_PRODUCTION_BLOCKER`

`P1_FIX_BEFORE_LAUNCH`

`P2_HARDEN_THIS_WEEK`

`P3_DEFER`

---

# 6. Gate 0 output and stop condition

Before architecture changes, produce all Phase 0 documentation.

Stop if any of these remain materially unknown:

1. live deployment branch
2. role source of truth
3. permission source of truth
4. production cookie scope
5. trusted proxy chain
6. SSO configuration source
7. current Control Room schema
8. whether sensitive credentials are still active
9. whether the currently deployed system still exposes sensitive artifacts

Document what is known and what needs human confirmation.

---

# 7. Master pentest remediation matrix

Create:

`docs/security/2026-pentest-remediation-matrix.md`

Every applicable `SCR-*` and `STR-*` finding must appear.

Do not create duplicate engineering work merely because two reports use different IDs.

Each record must contain finding ID, source report, severity, affected component, finding title, evidence type, whether exploitation was demonstrated, whether only source risk was demonstrated, related finding IDs, consolidated root cause, current repository verification, current deployment verification, required code change, required configuration change, required infrastructure change, secret rotation requirement, session invalidation requirement, affected files, affected services, automated tests, manual validation, Cyber retest procedure, implementation commit, final disposition, residual risk, owner, and launch blocker yes or no.

Allowed dispositions:

`FIXED`

`MITIGATED`

`VALIDATED_NOT_EXPLOITABLE`

`CONFIGURATION_CHANGE_REQUIRED`

`INFRASTRUCTURE_CHANGE_REQUIRED`

`ACCEPTED_HARDENING`

`INFORMATIONAL`

`NEEDS_MANUAL_VALIDATION`

`DEFERRED_WITH_RISK_ACCEPTANCE`

Do not use `FIXED` as shorthand for "code written."

---

# 8. Gate 1: immediate containment and exposure response

This gate is mandatory before feature expansion.

## 8.1 Sensitive web exposure

Address the root cause behind findings involving `.env`, `.env.staging`, `.git`, `package.json`, lockfiles, source maps if inappropriate, backups, repository metadata, build metadata, raw source files, deployment manifests, log files, and secret bearing debug output.

Defense must exist at more than one layer.

### Deployment packaging

Production deployment should contain only files needed at runtime.

Do not deploy a raw repository into a web served directory when a constrained runtime artifact is possible.

### Nginx

Use explicit deny rules for sensitive paths.

Do not copy a generic CIDR or proxy configuration without verifying the actual environment.

### Application static serving

Static middleware must serve from an intentional public asset directory, not from repository root.

### Automated security probes

Create a script that tests known sensitive paths.

At minimum probe:

`/.env`

`/.env.staging`

`/.git/HEAD`

`/.git/config`

`/package.json`

`/package-lock.json`

common backup extensions

common dotfiles

The expected response must not reveal the file. Prefer indistinguishable 404 behavior.

## 8.2 Credential exposure response

Where assessment evidence supports exposure of credentials or secrets, treat them as compromised until an authorized owner determines otherwise.

Produce:

`docs/security/2026-production-exposure-checklist.md`

For each affected secret category record secret type, system, current owner, whether confirmed exposed, whether rotation is required, whether old credential must be revoked, whether active sessions must be invalidated, downstream consumers, rotation order, and verification after rotation.

Potential categories must be verified before action:

database credentials

session signing secrets

Entra client credentials

AuthBridge secrets

MaintainX keys

AWS credentials

S3 credentials

SMTP or SES credentials

other integration keys

Do not write any real secret values into documentation.

## 8.3 Session and token invalidation

If a signing secret, session secret, admin session artifact, or equivalent was exposed, determine whether existing sessions or tokens can survive rotation.

If yes, define the invalidation procedure as a manual production action.

## 8.4 Exit criteria for Gate 1

Gate 1 passes only when current staging exposure probes fail closed, deploy artifact no longer contains web reachable sensitive files, applicable secret rotation plan is approved, required staging rotations are complete, any required session invalidation is complete in staging, current code and Nginx templates both enforce exposure boundaries, and no Critical artifact exposure path remains.

---

# 9. Gate 2: authentication, sessions, authorization, SAML, proxy trust, dependencies

## 9.1 Canonical AuthBridge implementation

Find every implementation capable of validating AuthBridge tokens.

If duplicate adapters or packages exist, establish one canonical supported implementation.

Remove, deprecate, or make unreachable any weaker verification path.

Tests must prove that the production application cannot silently fall back to weaker local token validation.

## 9.2 Token verification

Verify and enforce signature, accepted algorithm, issuer, audience, expiration, not before where present, tenant identity where required, application identity, subject identity, session state where architecture requires it, and token revocation or active session state where supported.

Reject malformed, missing, ambiguous, or invalid claims.

No security check may silently convert failure into anonymous trusted identity.

## 9.3 Application entitlement

Before AuthBridge issues an application specific token, verify that the user is entitled to the requested application when the architecture expects entitlement.

Do not assume membership merely because the application exists and is active.

Record denial in security audit logs without logging secrets or full tokens.

## 9.4 Trusted proxy model

Do not trust arbitrary client supplied `X-Forwarded-For`, `X-Real-IP`, or similar forwarded headers for authentication, session binding, rate limiting, or security decisions unless they have been normalized through an explicitly trusted proxy chain.

Document public edge, Nginx, load balancer if present, trusted proxy addresses or ranges, which component rewrites the forwarded chain, and which application framework setting trusts the proxy.

Never copy placeholder private CIDRs into production configuration.

Validate against the real deployment topology.

## 9.5 IP based security controls

Review every use of IP in session binding, hijack detection, rate limiting, audit logging, and token claims.

Determine whether IP binding is appropriate for the actual workforce network environment.

Do not make legitimate mobile, VPN, NAT, or corporate proxy users unusable merely to satisfy a finding.

Security controls should be robust without depending solely on mutable client IP.

## 9.6 Cookie scope and session lifecycle

Inventory each security relevant cookie.

Verify name, host or Domain, Path, Secure, HttpOnly, SameSite, lifetime, creation point, refresh behavior, deletion behavior, and whether sibling subdomains need access.

Prefer host scoped cookies unless cross subdomain sharing is a verified architecture requirement.

Do not break the previously corrected signout behavior.

Regression test login, hard refresh, deep link, idle or expiry, logout, signed out interstitial, reauthentication, and no redirect loop.

## 9.7 Identity fallback headers

Search for fallback identity derived from headers such as `x-vercel-user-email`, `x-vercel-id-token-email`, or similar.

If the production architecture does not cryptographically guarantee these headers and strip attacker supplied versions at the edge, do not trust them.

Prefer authenticated session or verified AuthBridge identity.

## 9.8 SSO trust administration

Review every operation capable of changing SAML certificate, IdP sign in URL, entity ID, issuer, metadata, application trust, OIDC client settings, and role or group mapping.

A read oriented permission such as `view_management` must not grant write access to trust configuration.

Create a dedicated privileged capability if the current permission model lacks one.

Suggested name:

`manage_sso`

This is a proposal, not a required role name.

Map it into the existing RBAC model rather than creating a parallel authorization system.

Every trust configuration mutation must be audited.

## 9.9 SAML request correlation and replay protection

Validate AuthnRequest identifier generation, request state storage, expiration, `InResponseTo`, recipient, destination, issuer, audience, signature, and replay resistance.

Reject reused or unmatched responses where protocol expectations require correlation.

## 9.10 XML and SAML dependencies

Resolve the vulnerable dependency chain identified by the assessments.

Do not hard code a target version from an old report without checking the current ecosystem.

Use the latest compatible secure versions.

Regenerate lockfiles.

Run SAML regression tests.

## 9.11 Python dependency reproducibility

Do not rely on unbounded production ranges.

Choose a reproducible approach appropriate to the current Python project using locked requirements, constraints, Poetry, uv, or another supported mechanism.

Record actual resolved versions.

## 9.12 Sanitization and output safety

Find regex based HTML sanitizers.

Replace unsafe ad hoc sanitization with a maintained allowlist based implementation if rich HTML is genuinely required.

If rich HTML is not required, prefer storing plain text and escaping on output.

Test script tags, event handlers, SVG payloads, javascript URLs, data URLs, malformed HTML, and attribute breaking payloads.

Do not trust frontend sanitization alone.

## 9.13 Diagnostic and documentation surfaces

Inventory `/docs`, `/redoc`, `/openapi.json`, `/hub/dev/status`, health endpoints, debug endpoints, diagnostic endpoints, and internal admin endpoints.

Do not automatically remove useful health checks.

Classify each surface as public safe health, authenticated operational health, admin only diagnostic, development only, or disabled in production.

Ensure responses do not leak secrets, database URLs, tokens, stack traces, filesystem paths, internal configuration, or security flags beyond what is intentionally exposed.

## 9.14 Workflow automation routing

Verify whether n8n or another workflow automation service is reachable through the AuthBridge or SLIOps public domain unexpectedly.

Separate application routes intentionally.

Management UIs must not become public merely because a reverse proxy location overlaps.

## 9.15 Destructive endpoints

Find cleanup, purge, delete all, seed, reset, restore, and destructive maintenance endpoints.

Require authentication, dedicated authorization, production restrictions, CSRF protection where cookie authenticated, audit, safe confirmation or explicit request semantics, and no weak shared secret as the only control where stronger identity exists.

## 9.16 Shared external tokens

Review shared vendor or client access tokens.

Determine whether individual identity is required.

Where shared tokens are intentionally used, constrain object scope, lifetime, operation scope, revocation, audit, rate limits, and replay exposure.

Do not redesign a workflow merely because a token is not a full user account if the secure link model intentionally uses scoped tokens.

## 9.17 Template and submission authorization

Review template submission routes and other create endpoints.

Ensure authenticated or token scoped callers can only create or mutate allowed resources.

Never trust actor ID, owner ID, role, tenant, station, organization, or equivalent authorization scope directly from request body without server validation.

## 9.18 Inbound email identity

If inbound email creates comments or records, distinguish reported sender address, authenticated sender, and trusted mail gateway identity.

Do not claim cryptographic sender identity if only the message From field is stored.

Where this is not a launch blocker, document residual risk honestly.

## 9.19 CSRF

Inventory all cookie authenticated state changing endpoints.

Determine whether SameSite and origin protections are sufficient for current architecture.

Add CSRF tokens or origin validation where required.

Document the chosen approach.

## 9.20 Security headers

Evaluate and implement where compatible:

Content Security Policy

X-Content-Type-Options

Referrer-Policy

Permissions-Policy

frame protections using CSP `frame-ancestors`

Strict-Transport-Security at the correct TLS boundary

Do not break legitimate integrations without validation.

## 9.21 Rate limiting

Apply rate limiting to security sensitive and abuse sensitive endpoints where appropriate.

Examples include login, token issuance, SAML initiation, public secure link validation, and destructive actions.

Do not add arbitrary global throttling that breaks normal operators.

## 9.22 Safe errors

Production responses must not expose stack traces, SQL errors, filesystem locations, secret names and values, raw tokens, private headers, or internal service URLs unless intentionally public.

Log detailed errors server side with correlation IDs where possible.

## 9.23 Audit logging

Audit privileged mutations and important operational actions.

At minimum consider role changes, permission changes, SSO trust changes, user administration, security configuration changes, request workflow changes, document actions, and Control Room mutations.

Do not log passwords, cookies, OAuth authorization codes, raw JWTs, API keys, environment secrets, or private encryption keys.

## 9.24 Gate 2 tests

Automate negative tests for wrong issuer, wrong audience, wrong algorithm, expired token, malformed token, invalid signature, disabled session, unauthorized application, spoofed forwarded headers, Standard user calling admin endpoint, Standard user changing SSO trust, resource access outside actual business scope, SAML replay, SAML mismatched correlation, XSS payloads, unsafe diagnostics, unsafe production flags, and sensitive file exposure.

## 9.25 Gate 2 exit criteria

No known Critical or High authentication, authorization, trust, dependency, or exposure path remains unresolved without explicit security approval.

---

# 10. RBAC redesign rules

Redesign authorization where the current implementation is unsafe, but do not replace the whole RBAC framework merely for aesthetic cleanliness.

## 10.1 Preserve one authorization framework

Control Room must use the existing SLIOps authorization system.

Do not create an isolated second permissions database.

## 10.2 Permission design

Permissions should describe capabilities.

Examples of potentially useful granular capabilities:

`control_room_view`

`control_room_log`

`control_room_acknowledge`

`control_room_task_manage`

`control_room_board_manage`

`control_room_handover`

`control_room_schedule_view`

`control_room_schedule_manage`

`control_room_supervisor`

`control_room_admin`

These are candidate capabilities.

Before adding them, inspect current permission naming, reuse existing equivalents, avoid redundant permissions, document proposed additions, and map them to real roles only after role discovery.

## 10.3 Resource rules

Write resource authorization policies explicitly.

For each sensitive resource type answer:

1. who can list it?
2. who can view it?
3. who can create it?
4. who can edit it?
5. who can delete or resolve it?
6. who can assign it?
7. what is shared within station, team, department, or organization?
8. what is private?
9. what is admin only?

Do not infer privacy from `created_by`.

## 10.4 Default deny

Unknown permission combinations should not become privileged by accident.

Missing identity, role, permission, or resource scope should fail closed.

## 10.5 Role changes

If the pentest exposed poor role distribution, correct role assignments and seed data only after confirming intended business behavior.

Do not create arbitrary role differences just to make pentest users produce different responses.

---

# 11. Gate 3: existing WOS regression and production quality cleanup

Security remediation is not complete if it breaks the product.

## 11.1 Authentication regression

Verify Entra login, AuthBridge callback, SLIOps session, hard refresh, direct deep link, session renewal if supported, session expiry, logout, signed out state, reauthentication, and no signout loop.

## 11.2 Request workflow regression

Use representative current workflows.

Verify create request, open request, workflow progression, step authorization, assigned actor actions, request owner behavior, comments, activity, documents, completed state, error state, and failed external integration state if supported.

## 11.3 Document regression

Verify upload, S3 persistence, metadata, retrieval, authorized access, unauthorized access denial, client fill, review, sign, audit, and token expiration where applicable.

## 11.4 MaintainX regression

Verify server side API access, organization ID, assets, locations, categories, work order reference behavior, upstream error presentation, no credential leakage, and graceful degradation.

## 11.5 Admin regression

Verify user list, user detail, roles, permissions, SSO read access, SSO write access, audit logs, integrations, and reports where present.

## 11.6 Frontend cleanup

Fix P0 and P1 defects found in Phase 0.

For every frontend defect, record route, reproduction, expected behavior, root cause, fix, and test.

## 11.7 API and UI consistency

For every mutation prevent duplicate submission, show pending state, handle success, handle validation failure, handle 401, handle 403, handle network failure, refresh affected data, avoid stale state, and preserve user input where reasonable.

## 11.8 Accessibility baseline

At minimum address input labels, keyboard focus, modal focus, button names, table semantics, error association, color independent status indicators, and reachable interactive controls.

Do not turn this phase into a visual redesign unless the current layout prevents correct use.

## 11.9 Gate 3 exit criteria

All existing production critical workflows must pass on the secured codebase before Control Room expansion proceeds.

---

# 12. Gate 4: Control Room implementation

## 12.1 Product boundary

Control Room is operational memory and shift continuity.

It is not a new CMMS, a replacement for MaintainX, a payroll system, a Paycom replacement, a Snowflake analytics project, a Samsara exposure engine, a full workforce management product, a separate authentication system, or a separate RBAC framework.

## 12.2 Navigation

Control Room belongs under:

Operations -> Control Room

Target information architecture:

1. Current Shift
2. Handover
3. Operating Board
4. Tasks
5. Schedule
6. History
7. Supervisor Overview

Reuse the current SLIOps shell, navigation, top bar, typography, cards, tables, status components, modals, empty state patterns, loading patterns, error patterns, responsive layout, and dark mode behavior if supported.

Do not create a second design system.

## 12.3 Schema discovery before migration

Before creating new tables:

1. inspect current migrations
2. inspect current production like schema
3. inspect historical Control Room migration
4. inspect current `/hub/control-room/*` code
5. produce a schema delta

Do not recreate existing tables under new names.

Do not introduce duplicate concepts such as two shift log tables.

## 12.4 Relational design principles

Core operational lifecycle state belongs in relational Postgres.

Use primary keys, foreign keys, constraints, transactions, timestamps, indexes, unique constraints where appropriate, and append only history where required.

Avoid arbitrary JSON blobs for core lifecycle state.

## 12.5 Shift and assignment model

Do not assume one shift equals one operator.

Model the real operational requirement discovered from the current product and Dylan's intended workflow.

The design should be capable of representing shift window, station, one or more assignments if required, operator identity, role or assignment function where needed, active state, completed state, and audit.

If the existing schema already models this adequately, extend it instead of replacing it.

## 12.6 Current Shift

The Current Shift page should quickly tell the operator active shift, assignment context, station, start, end, current time, unacknowledged count, open board count, open task count, and recent important events.

## 12.7 Quick Log

The log entry flow must be fast.

Support station or unit, controlled category, priority, summary, details, event timestamp, optional equipment or asset reference, and optional follow up requirement.

Suggested priorities:

Normal

Attention

Urgent

Suggested categories may include Operations, Maintenance, Safety, Process, Communication, and Other.

Use existing terminology if the current product already defines categories.

Every record should capture created by, created at, updated by where edits are allowed, updated at, shift, station or unit, acknowledgements, and audit history.

## 12.8 Shift timeline

Show chronological operational events with time, station or unit, category, priority, summary, author, acknowledgement state, and follow up indicator.

Filters should support the real operator use case.

At minimum consider unit, category, priority, and acknowledgement.

Edits must preserve history.

## 12.9 Acknowledgements

Acknowledgement is an append only event.

Do not represent it only as a mutable boolean.

Record target record, user, acknowledged at, and shift context if relevant.

The system must be able to answer who acknowledged this, when, and who has not acknowledged it if the workflow requires a known audience.

Do not invent mandatory acknowledgement audiences without business evidence.

## 12.10 Handover

Handover should assemble operational continuity information.

Candidate inputs include important shift logs, Attention events, Urgent events, unresolved board items, unfinished tasks, explicitly marked handover items, relevant MaintainX references, and important unit conditions.

Support outgoing shift, incoming shift where known, outgoing operator note, outgoing author, outgoing timestamp, incoming acknowledgement, incoming user, incoming timestamp, and historical persistence.

Unresolved important items must not silently disappear when a shift changes.

Do not automatically create or complete handovers based solely on a timer unless the current operational process supports that behavior.

## 12.11 Operating Board

The Operating Board is for conditions that persist across shifts.

Examples include watched equipment condition, temporary restriction, ongoing operational issue, maintenance coordination, safety concern, and important reminder.

Suggested fields include title, description, station or unit, category, priority, status, owner where appropriate, created by, created at, target or resolution date, linked shift log, linked MaintainX item, resolved by, resolved at, and resolution note.

Suggested lifecycle:

Open

Monitoring

Blocked

Resolved

If existing product conventions use different states, preserve them unless there is a strong reason to change.

Board items remain active across shifts until explicitly resolved.

Resolution must be audited.

## 12.12 Operator Tasks

These are lightweight operational actions.

They are not maintenance work orders.

Suggested fields include title, description, station or unit, assignee or assignment role, due time, priority, source, status, linked log, linked board item, created by, completed by, completed at, and completion note.

Suggested states:

Open

In Progress

Completed

Cancelled

Overdue should normally be derived from due time and status rather than stored as an independent mutable status.

Tasks should appear where relevant in Current Shift, Tasks, Handover if unresolved, and Supervisor Overview.

## 12.13 Schedule

This week, build only the schedule foundation required for Control Room.

Support operator, station, date, start, end, role or assignment context where needed, coverage state, current assignments, upcoming assignments, coverage gaps, overlap detection, supervisor edit where authorized, operator view, and audit.

Do not build Paycom integration, payroll calculations, Snowflake scheduling analytics, Samsara exposure calculations, advanced optimization, or full workforce management unless already implemented and merely requiring regression.

## 12.14 History

History is operational history.

Support useful filters such as date, shift, station, unit, operator, category, priority, record type, and status.

Possible record types include shift log, handover, board lifecycle, task lifecycle, and acknowledgement.

Do not merge security audit logs into operator history.

## 12.15 Supervisor Overview

Supervisor Overview should answer who is currently active, where coverage is missing, which Urgent or Attention items remain unacknowledged, which board items remain open, which tasks are overdue, whether a handover is pending, which units have important open conditions, what changed recently, and where upcoming coverage gaps exist.

Provide actions only when current permissions allow them.

The server enforces every action.

## 12.16 MaintainX integration

Control Room may reference MaintainX asset, location, work order, or other stable maintenance identifiers.

Store stable IDs and useful display metadata as appropriate.

Do not duplicate full maintenance data.

If MaintainX is unavailable, Control Room should degrade gracefully.

Operators must still be able to use core shift logging unless the requested action fundamentally requires MaintainX.

## 12.17 Control Room audit

Audit at minimum log create, log edit, acknowledgement, handover submit, handover acknowledgement, board create, board update, board resolve, task create, task assignment, task completion, schedule assignment, schedule change, and privileged Control Room configuration.

## 12.18 Control Room API rules

Continue using `/hub/control-room/*` if the current implementation already uses it.

Do not create duplicate endpoint namespaces unnecessarily.

Every mutation must authenticate, authorize capability, authorize resource, validate input, use a database transaction where multiple writes must succeed together, write audit, return safe errors, and never trust caller supplied actor identity.

## 12.19 Control Room UI quality

The operator experience must favor speed and clarity.

Requirements include large clear action targets, minimal modal depth, fast Quick Log, keyboard friendly controls, obvious timestamps, obvious priority, obvious acknowledgement state, useful empty states, useful loading states, useful error states, responsive layout, and consistent SLIOps styling.

Avoid building an overdesigned analytics dashboard.

---

# 13. Control Room authorization

Do not assign new capabilities to guessed roles.

Process:

1. define the capability required by each action
2. compare with existing permissions
3. reuse current capabilities where suitable
4. add granular `control_room_*` capabilities only where needed
5. propose role mappings
6. review mappings against discovered business roles
7. update migrations or seeds only after the mapping is validated
8. enforce server side
9. align frontend visibility

For every Control Room resource, explicitly define shared versus restricted scope.

Questions that must be answered include:

Can any operator at a station see all station logs?

Can all operators see all board items?

Are tasks visible to the whole team or only assignee plus supervisors?

Can operators acknowledge another shift's logs?

Can only supervisors resolve board items?

Do not guess these answers.

---

# 14. Control Room database quality

Index for the actual query patterns.

Likely candidates, subject to schema discovery, include current shift by station and time, shift timeline by shift and timestamp, logs by station or unit, unacknowledged logs, open board items, open tasks, tasks by assignee, tasks by due time, schedule by station and date, history by date, and handover by source or target shift.

Use constraints to prevent invalid states where practical.

Do not encode assumptions that conflict with real workflow.

---

# 15. Gate 4 acceptance scenarios

## Scenario A: shift logging

1. Operator enters Control Room.
2. Current shift context loads.
3. Operator creates a Normal event.
4. Operator creates an Urgent event.
5. Events appear immediately.
6. Another authorized user acknowledges the Urgent event.
7. Acknowledgement identity and timestamp persist.
8. Supervisor view reflects the acknowledgement state.

## Scenario B: cross shift board continuity

1. An operational issue is created on the board.
2. It remains open at shift end.
3. It appears in handover.
4. Incoming operator acknowledges the handover.
5. Board item remains open after handover.
6. Board item disappears from active view only after explicit resolution.
7. Resolution is preserved in history.

## Scenario C: task lifecycle

1. Authorized user creates task.
2. Task receives assignment and due time.
3. Assignee sees task.
4. Due task becomes overdue when appropriate.
5. Authorized user completes it.
6. Completion identity, timestamp, and note persist.
7. History includes completion.

## Scenario D: vertical authorization

1. Standard user calls supervisor or admin only mutation.
2. API returns 403.
3. No data changes.
4. Attempt may be audited where appropriate.

## Scenario E: horizontal authorization

Use UserA and UserB.

Test an actual resource that product policy says should be isolated.

Do not select a shared operational record merely to manufacture a denial.

Expected result must follow documented business scope.

## Scenario F: SSO trust

1. User without SSO management capability attempts trust configuration mutation.
2. API returns 403.
3. No configuration changes.
4. Authorized SSO administrator succeeds.
5. Audit event records the change without secrets.

## Scenario G: sensitive files

Verify public requests do not expose `.env`, `.env.staging`, `.git/HEAD`, `.git/config`, `package.json`, or other blocked deployment metadata.

## Scenario H: logout

1. Login.
2. Use application.
3. Logout.
4. Session cookie clears.
5. IdP logout behavior works according to intended design.
6. User reaches signed out state.
7. No immediate login loop occurs.
8. Reauthentication works when intentionally initiated.

---

# 16. Gate 5: full security regression and future pentest readiness

## 16.1 Future pentest principles

The system should be designed to survive common professional testing against broken access control, authentication bypass, horizontal privilege escalation, vertical privilege escalation, session fixation, session replay, token tampering, SAML replay, SSO misconfiguration, exposed secrets, exposed repository metadata, unsafe debug endpoints, injection, XSS, CSRF, insecure direct object reference, mass assignment, insecure file handling, path traversal, SSRF where outbound requests exist, unsafe redirects, weak rate limiting, sensitive error leakage, dependency vulnerabilities, security misconfiguration, and missing auditability.

Do not add controls only to satisfy a scanner.

Fix root causes.

## 16.2 Automated security regression suite

Create or extend tests for authentication, authorization, resource scope, token validation, SAML, cookie lifecycle, CSRF where applicable, trusted proxy behavior, sanitization, input validation, sensitive paths, debug routes, production flags, dependency checks, Control Room permissions, request workflow permissions, document permissions, and admin permissions.

## 16.3 Production exposure probe

Create a repeatable probe that Cyber and engineering can run after deployment.

It should verify sensitive files unavailable, docs and debug surfaces have intended access, expected auth endpoints behave correctly, unexpected admin endpoints are denied, security headers are present where intended, and production health endpoints reveal only safe information.

## 16.4 Dependency security

For Node require a lockfile, audit current resolved packages, and upgrade security critical vulnerabilities.

For Python require a resolved lock or constraints and scan the actual resolved environment.

Do not fail production builds blindly for every low severity advisory without context.

Critical and High dependency risk in an exploitable production path must be explicitly resolved or accepted by security leadership.

## 16.5 Secure build artifact

The production artifact should contain only runtime required assets.

Create a check that fails if the artifact contains forbidden files such as `.git`, `.env`, private key files, local database files, backup archives, test secrets, and unexpected credential exports.

## 16.6 Logging review

Verify production logs do not contain auth cookies, JWTs, OAuth codes, SAML assertions, API keys, database passwords, full secret bearing environment dumps, sensitive headers, or MaintainX secrets.

Maintain useful timestamp, request correlation, user ID where appropriate, action, resource, result, error category, and source service.

---

# 17. Deployment readiness

Before deployment, produce:

`docs/security/2026-production-readiness-report.md`

The report must include evidence, not statements of confidence.

## 17.1 Predeploy checks

1. clean working tree or documented changes
2. reviewed branch
3. tests green
4. security tests green
5. dependency review complete
6. migration plan reviewed
7. rollback tested
8. environment variables validated
9. no secrets in commit diff
10. no test accounts embedded in source
11. no dev bypass
12. no demo data enabled
13. Postgres required in production
14. no local JSON production fallback
15. S3 configured
16. MaintainX configuration checked
17. Entra/AuthBridge settings checked
18. Nginx config syntax tested
19. service config validated
20. production artifact inspected

## 17.2 Database

Before applying migration:

1. take backup
2. record current schema version
3. test migration on production like copy
4. test rollback
5. confirm backward compatibility during deploy window if required

## 17.3 Deploy

Cursor must only document commands.

Human operator performs deployment.

## 17.4 Postdeploy smoke

Immediately verify site loads, login, logout, Standard user, Hub Admin, sensitive path probes, request workflow, document upload and retrieval, client action if safely testable, MaintainX lookup, Admin permissions, Control Room, database persistence, S3 persistence, audit creation, and logs show no new critical failures.

## 17.5 Rollback trigger

Rollback if authentication is unavailable, authorization becomes unexpectedly permissive, authorization unexpectedly blocks core operations, database migration corruption occurs, document access fails, S3 write failure affects core workflow, request workflow becomes unusable, Control Room migration damages existing data, persistent 5xx errors affect core workflows, or the security exposure probe fails.

---

# 18. Cyber retest package

Create:

`docs/security/2026-pentest-retest-guide.md`

For every assessment finding provide finding ID, original condition, consolidated root cause, remediation, code commit, configuration action, infrastructure action, test command, expected result, required test account, affected environment, evidence location, residual risk, and final disposition.

Do not tell Cyber a finding is fixed if a manual production action remains incomplete.

---

# 19. Required project documentation

Create or update:

`docs/architecture/sliops-current-state.md`

`docs/security/2026-pentest-remediation-matrix.md`

`docs/security/2026-pentest-retest-guide.md`

`docs/security/2026-production-exposure-checklist.md`

`docs/security/2026-auth-rbac-model.md`

`docs/security/2026-production-readiness-report.md`

`docs/control-room/control-room-phase2-implementation.md`

`docs/control-room/control-room-permissions.md`

`docs/control-room/control-room-test-plan.md`

Do not duplicate existing documentation unnecessarily.

If an equivalent authoritative document already exists, update it and record why.

---

# 20. Suggested EOW execution order

Do not skip a gate because a later feature is easier to demonstrate.

## Workstream 1: establish truth

Output current state, route map, role map, finding map, Control Room delta, and frontend bug inventory.

## Workstream 2: containment

Output sensitive file protection, safe build artifact, credential rotation plan, session invalidation plan, and exposure tests.

## Workstream 3: authentication and authorization

Output canonical AuthBridge validation, application entitlement, trusted proxy model, cookie and session hardening, unsafe identity fallback removal, SSO trust separation, SAML correlation and replay defense, and RBAC and resource authorization tests.

## Workstream 4: dependency and platform hardening

Output XML and SAML dependency remediation, Python locking, debug and docs exposure correction, sanitizer remediation, safe errors, headers, CSRF review, rate limiting where needed, and destructive endpoint protection.

## Workstream 5: existing WOS regression and frontend production fixes

Output auth regression, requests regression, documents regression, MaintainX regression, admin regression, and P0/P1 frontend defects fixed.

## Workstream 6: Control Room operator MVP

Output Current Shift, Quick Log, timeline, acknowledgements, Handover, Operating Board, Tasks, Schedule foundation, History, Supervisor Overview, correct authorization, and audit.

## Workstream 7: future pentest readiness

Output security regression suite, production probes, retest matrix, production readiness report, deploy checklist, and rollback plan.

---

# 21. What not to build this week

Unless already required by current production behavior, defer:

1. Snowflake integration
2. Paycom integration
3. Samsara exposure calculations
4. advanced workforce scheduling
5. predictive analytics
6. Control Room AI features
7. full MaintainX work order replacement
8. major UI redesign unrelated to defects
9. broad framework rewrites
10. authentication framework replacement if the current design can be safely hardened
11. database rewrites for aesthetic reasons
12. new microservices without a production security need

Do not destabilize the platform to make the architecture look cleaner.

---

# 22. Coding standards

Follow current repository conventions unless they are the source of a security problem.

For new or changed code:

1. validate external input
2. use parameterized database operations
3. avoid string built SQL
4. use transactions for multiwrite state changes
5. use server derived actor identity
6. use centralized authorization helpers
7. use safe error responses
8. do not log secrets
9. preserve audit
10. add tests with each security fix
11. keep functions focused
12. remove dead code only when verified unused
13. document nonobvious security decisions
14. keep production and development configuration clearly separated

---

# 23. Finding disposition discipline

Every finding must end in one of the allowed dispositions.

Examples:

A vulnerable dependency present and upgraded with passing tests:

`FIXED`

A header trust issue proven impossible because Nginx overwrites the header and runtime validation confirms it:

`VALIDATED_NOT_EXPLOITABLE`

A server configuration change required but not yet applied by the human operator:

`INFRASTRUCTURE_CHANGE_REQUIRED`

A low impact hardening recommendation intentionally postponed:

`DEFERRED_WITH_RISK_ACCEPTANCE`

An observation with no security defect:

`INFORMATIONAL`

Never use `FIXED` merely because a code branch contains a proposed change.

---

# 24. Final implementation report

At the end of the work, produce one final report in chat and in:

`docs/security/2026-production-readiness-report.md`

Include branch, base commit, final commit, changed files, migrations, dependency changes, infrastructure changes required, infrastructure changes verified, credential rotation actions required, credential rotation actions verified, every STR disposition, every SCR disposition, Critical status, High status, Moderate status summary, Low status summary, Info summary, actual current role matrix, authorization changes, application entitlement changes, proxy trust changes, cookie and session changes, SAML changes, sensitive path changes, frontend bugs fixed, existing WOS regression results, Control Room completed features, Control Room deferred features, automated tests and results, manual tests and results, deployment instructions, rollback instructions, Cyber retest instructions, residual risk, and manual actions still required.

No unsupported claim may be labeled verified.

---

# 25. Final STOP condition

Do not recommend production deployment if any of the following remain:

1. unresolved Critical exploitable finding
2. unresolved High exploitable finding without explicit security acceptance
3. exposed credential still active
4. sensitive deployment file publicly reachable
5. authentication bypass
6. token validation bypass
7. application entitlement bypass where entitlement is required
8. known vertical privilege escalation
9. known horizontal privilege escalation against a resource that is actually intended to be isolated
10. nonadmin SSO trust mutation
11. unsafe production bypass enabled
12. existing WOS core workflow regression
13. broken document security
14. broken S3 production flow
15. broken logout creating an authentication loop
16. Control Room schema migration risk not understood
17. database rollback unavailable
18. production configuration state unknown
19. current deployed SHA unknown
20. security retest evidence not reproducible

If any item above remains, report the blocker clearly.

Do not conceal it by lowering severity or changing wording.

---

# 26. Definition of success

The end state should be one coherent SLIOps platform where AuthBridge establishes trusted identity, SLIOps establishes server side authorization, application entitlement is explicit where required, capability and resource authorization are separate and testable, privileged SSO configuration is tightly controlled, deployment artifacts do not expose secrets, sessions behave predictably, production fails closed, request workflows still work, documents still work, S3 still works, MaintainX still works, administrative functions still work, Control Room gives operators a fast current shift workflow, handover preserves continuity, persistent board items survive shift changes, operational tasks have accountable lifecycle, schedule provides basic coverage awareness, supervisor views summarize operational risk, audit trails explain important mutations, automated tests protect security boundaries, Cyber can retest findings without guesswork, and future penetration tests encounter a system designed around least privilege, explicit trust boundaries, safe deployment, validated input, secure sessions, and auditable actions rather than a collection of one off patches.

That is the production standard.

Do not optimize for closing a spreadsheet.

Optimize for making SLIOps secure and operationally correct.
