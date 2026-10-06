# WOS-32 Signature Scope and UI Language

**Date:** 2026-05-26  
**Status:** Proposed (documentation only)  
**Scope:** Define what WOS v1 signatures mean — legally, operationally, and in user-facing language  
**Code changes:** None  
**Schema changes:** None

---

## Executive summary

WOS v1 signatures are **internal workflow acknowledgments and approval records** captured inside the Operations Workflow Hub. They support operational routing, accountability, and audit trails — not ESIGN-grade electronic signatures for legally consequential client-facing documents.

**Recommended v1 scope statement:**

> WOS v1 signatures are internal workflow acknowledgments and approval records. They are suitable for operational routing, internal accountability, and documenting that a user acknowledged or approved a workflow step. They are **not** represented as ESIGN-grade electronic signatures for legally consequential client-facing documents until signed PDF generation, tamper-evident sealing, identity verification, and final archive packaging are implemented.

**WOS-32 recommendation:** **Ready for Under review** as a documentation deliverable. UI/README should adopt the language in §7–8 before marketing signatures broadly or using client-facing legally consequential flows.

**Related docs:** [SIGNATURE_EMAIL_NOTIFICATION_REPORT.md](./SIGNATURE_EMAIL_NOTIFICATION_REPORT.md) (WOS-23), [WORK_ORDER_SOURCE_OF_TRUTH_DECISION.md](./WORK_ORDER_SOURCE_OF_TRUTH_DECISION.md) (WOS-30), [OUTBOX_SCHEDULER_ARCHITECTURE.md](./OUTBOX_SCHEDULER_ARCHITECTURE.md) (WOS-31).

---

## 1. Current signature behavior summary

### 1.1 What signing does in the workflow

When a workflow step has `action_type === 'sign'` or `requires_signature === true`:

1. Step becomes active (`waiting` / actionable).
2. WOS-23 may send **signature_requested** notification + email with optional secure action link.
3. Signer completes the step via one of:
   - **Authenticated hub user** — completes step from request detail (`POST /hub/workflow-steps/:id/complete`) with a browser `confirm()` acknowledgement.
   - **Action link (token)** — client/external user opens `action.html?t={token}` (no Entra session required).
4. On completion:
   - Workflow step → `completed`
   - Audit event → `signature_completed` (or `step_completed`)
   - Next workflow step may activate
   - Web document may move to `waiting_on_signature` / `locked` when workflow finishes
   - n8n event `document.signed` may fire if a document payload was saved

Signing **advances workflow**; it does **not** produce a sealed legal PDF package.

### 1.2 Signature paths (two surfaces)

| Path | Auth model | Capture method |
|------|------------|----------------|
| **Hub (logged-in employee)** | Entra SSO session (`sliops_session` cookie) + RBAC on hub routes | Confirm dialog: “electronic signature” acknowledgement; `storage_provider: 'acknowledgement'`, no canvas image |
| **Action link (`action.html`)** | **Capability token** — `action_links.token_hash`; bound to `recipient_email` | Canvas draw (PNG data URL) **or** typed acknowledgement checkbox; optional name + comment |

Action links are **public** routes (SSO bypass for `/hub/action/`). Security is **possession of the secret URL** + expiry + single-use — **not** identity verification comparable to ESIGN or KBA.

### 1.3 Email notifications (WOS-23)

Signature emails notify assignees to act; they may include a secure action link. Email content uses subject **“Signature requested: …”** and action line **“Please review and sign this item.”** — operational language, not legal attestation.

Emails do **not** constitute a signed document delivery.

---

## 2. What is stored today

### 2.1 `signatures` table (Postgres)

Schema (`migrations/001_init.sql`):

| Column | Content |
|--------|---------|
| `request_id`, `workflow_step_id`, `document_id` | Links to workflow context |
| `signer_email`, `signer_name` | From action link recipient or authenticated actor |
| `signature_type` | `canvas` or `typed_acknowledgement` |
| `signature_data` | PNG data URL (canvas) or null |
| `acknowledgement_text` | Fixed `'Acknowledged in hub'` for typed path in adapter |
| `ip_address`, `user_agent` | Captured on action-link sign |
| `signed_at` | Timestamp |

Written via `saveDocument()` when `document_type === 'signature'` (`postgres.js`).

### 2.2 `request_files` table

Non-signature uploads (attachments) during sign/upload steps — separate from legal PDF output.

### 2.3 Audit and workflow state

| Artifact | Purpose |
|----------|---------|
| `audit_events` | `signature_completed`, step events, notification audits |
| `workflow_steps.status` | `completed` after sign |
| `web_documents.status` | May become `locked` when workflow completes — **content JSON/HTML, not sealed PDF** |
| `action_links` | `used_at` after successful action; token invalidated |

### 2.4 Storage gaps (honest)

| Scenario | Persisted to `signatures`? |
|----------|---------------------------|
| Action link + canvas draw | **Yes** — `signature_data` = PNG data URL |
| Action link + typed checkbox only (no canvas) | **Often no** — `body.document` omitted if no canvas; step still completes |
| Hub internal confirm (acknowledgement, `file_url: null`) | **Often no** — `onStepCompleted` only saves signature when `file_url` is truthy |
| Hub authenticated complete with signature payload | **Yes** if file_url provided |

Workflow and audit still record completion even when no `signatures` row is inserted.

---

## 3. What is NOT implemented

| Capability | Status |
|------------|--------|
| Final signed PDF generation | **Not implemented** |
| Tamper-evident sealing / cryptographic document hash | **Not implemented** |
| Identity verification (KBA, government ID, SMS OTP beyond email on link) | **Not implemented** |
| Certificate of completion (ESIGN-style signing package) | **Not implemented** |
| Final archive bundle (PDF + cert + audit export) | **Not implemented** |
| Long-term qualified timestamp / TSA | **Not implemented** |
| WORM / immutable legal archive tier | **Not implemented** |
| ESIGN/UETA consent flow with legal policy pages | **Not implemented** (only operational checkbox/confirm) |
| Non-repudiation beyond workflow audit | **Not implemented** |
| Client-facing “legally binding e-signature” attestation | **Must not be claimed** |

Root `README.md` is currently **empty** — architecture intent lives in code comments and WOS reports, not user-facing README.

---

## 4. Recommended v1 signature scope

### 4.1 In scope (what WOS v1 signatures ARE)

- Workflow step acknowledgment that a designated recipient completed a **sign** action
- Internal operational approval tracking for Streamline teams
- Audit trail: who (email/name), when, IP/UA (action link), workflow step, request number
- Canvas capture or typed acknowledgement as **evidence of intent to proceed**, not legal seal
- Routing to next workflow step (review, MaintainX handoff, close, etc.)
- Notification and email prompting signers to act (WOS-23)

### 4.2 Out of scope (what WOS v1 signatures are NOT)

- Substitute for DocuSign/Adobe Sign/ESIGN platform for regulated or high-stakes contracts
- Legally definitive “final signed document” for external clients without additional controls
- Proof of signer identity beyond email-on-link or logged-in employee session
- Tamper-proof published document

### 4.3 Appropriate use cases (v1)

| Use case | Appropriate? |
|----------|--------------|
| Internal employee acknowledges SWP/JSA review step | **Yes** |
| Client acknowledges permit terms via action link (low-risk operational) | **Yes, with disclaimer** |
| Client contract requiring enforceable e-signature | **No — defer** |
| Regulatory submission requiring sealed PDF | **No — defer** |
| MaintainX work order routing acknowledgment | **Yes** |

---

## 5. Internal-use wording

Use in hub UI, training, and internal docs:

- “**Workflow signature**” or “**workflow acknowledgment**” — prefer over “e-signature” alone
- “Records that **[name/email]** completed the sign step on **[request_number]**”
- “Stored for **operational audit** and routing”
- “MaintainX execution status is separate — see work order source-of-truth doc”

**Avoid internally:** “Legally binding,” “ESIGN compliant,” “final signed document,” “certified signature.”

---

## 6. Client-facing warning language

Display when `assigned_type === 'client'` or on `action.html` sign mode:

> **Workflow acknowledgment**  
> You are completing a workflow step in Streamline’s Operations Workflow Hub. This records your acknowledgment for operational routing and internal records. It does **not** by itself create a sealed final PDF or a third-party verified e-signature package.

For high-stakes document types (`document_signature`, permits, contracts):

> **Client-facing legally consequential signing** requires final PDF generation, tamper-evident sealing, identity verification, and archive packaging. Those capabilities are **outside WOS v1 scope**. Contact Streamline Operations if you need a formal signing process.

---

## 7. UI copy recommendations

### 7.1 Action link — sign banner (`action.html`)

**Replace current:**

> Sign — electronic signature  
> Draw your signature below or use the typed acknowledgement checkbox.

**Recommended:**

> **Sign — workflow acknowledgment**  
> Draw your acknowledgment below or use the typed confirmation checkbox. This records your approval for this workflow step inside Streamline’s Operations Workflow Hub.

### 7.2 Sign modal / button area

> By signing, you acknowledge and approve this workflow step inside Streamline’s Operations Workflow Hub.

### 7.3 Signature disclaimer (below canvas)

> WOS signatures record workflow acknowledgment and approval. They do not by themselves create a sealed final signed PDF or third-party verified e-signature package.

### 7.4 Typed acknowledgement checkbox

**Replace:**

> I agree that checking this box constitutes my electronic signature when I cannot draw above.

**Recommended:**

> I confirm this checkbox is my workflow acknowledgment when I cannot draw above. I understand this records my approval for routing purposes and is not a sealed legal signing package.

### 7.5 Submit button

Keep **“Sign & submit”** or use **“Acknowledge & submit”** if legal review prefers softer language.

### 7.6 Hub internal complete (confirm dialog)

**Replace:**

> By completing, you acknowledge this as your electronic signature.

**Recommended:**

> By completing, you acknowledge and approve this workflow step. This is recorded for operational audit and routing.

### 7.7 Hub request detail — documents tab

When listing signatures:

> Workflow signature capture (acknowledgment record) — not a sealed PDF.

### 7.8 Signature email (WOS-23) — future copy tweak (WOS-38+)

Subject may remain `Signature requested: {request_number} — {title}`.

Body action line:

> Please review and **complete the assigned workflow acknowledgment** for this item.

(Avoid “legally sign” in email body.)

---

## 8. README and architecture wording

### 8.1 README (when populated)

```markdown
## Workflow signatures (v1)

WOS v1 signature capture is intended for **operational workflow acknowledgment**
and **internal approval tracking** inside the Operations Workflow Hub.

It records who completed a sign step, when, and optional canvas/acknowledgment
evidence for audit purposes. It should **not** be described as a complete
ESIGN-grade signing platform until final signed document generation, tamper-evident
sealing, identity verification, and archive packaging are implemented.

For work orders handed off to MaintainX, execution status in the field is owned
by MaintainX — see WORK_ORDER_SOURCE_OF_TRUTH_DECISION.md.
```

### 8.2 Architecture docs cross-reference

| Doc | Addendum |
|-----|----------|
| WORK_ORDER_SOURCE_OF_TRUTH_DECISION.md | WOS owns document/signature **workflow state**, not field execution |
| OUTBOX_SCHEDULER_ARCHITECTURE.md | Signature **emails** are delivery side effects; legal scope unchanged |
| SIGNATURE_EMAIL_NOTIFICATION_REPORT.md | Emails prompt action; not legal delivery |

### 8.3 `constants.js` comment (future, optional one-line)

No change in WOS-32 — suggest for WOS-38: extend hub constants header with signature scope pointer.

---

## 9. Risk table

| Risk | Current status | Recommendation |
|------|----------------|----------------|
| User assumes legal e-signature | **Possible** — UI says “electronic signature”; emails say “sign” | Adopt §7 copy; add disclaimer on action.html and client steps |
| No sealed PDF | **Deferred / not implemented** | Do not market as “final signed document” |
| No identity verification | **Deferred** | Use for internal acknowledgment; warn on client-facing flows |
| Capability link misuse | **Controlled by token** expiry, single-use, recipient email on link — **not identity proof** | Keep scope limited; do not use for high-stakes contracts |
| Token forwarded to wrong person | **Possible** | Operational policy; future: OTP or Entra for client signers |
| Audit interpretation | **Good for workflow accountability** | Do not overstate legal enforceability in court |
| Hub ack without `signatures` row | **Possible** | Document in runbooks; optional future fix (implementation card) |
| Email says “sign” | **Operational ambiguity** | Soften email copy in future polish |
| Empty README | **No public scope statement** | Add README section per §8.1 |
| ESIGN consent records | **Not stored** | Do not claim ESIGN compliance |

---

## 10. Future work for stronger signatures

| # | Capability | Suggested card |
|---|------------|----------------|
| 1 | Final signed PDF generation (template + signatures embedded) | WOS-41+ |
| 2 | Tamper-evident seal (hash + optional PKI) | WOS-41+ |
| 3 | Identity verification for external signers | WOS-41+ |
| 4 | Certificate of completion PDF | WOS-41+ |
| 5 | Immutable archive bundle (PDF + cert + audit export) | WOS-41+ |
| 6 | ESIGN/UETA consent capture + policy versioning | Legal + WOS-41+ |
| 7 | Persist typed acknowledgement consistently to `signatures` | Small implementation fix |
| 8 | UI copy rollout (§7) | WOS-38 or dedicated UX card |
| 9 | Signature completion email (optional) | WOS-23 deferred item |

**Note:** User suggested follow-up **WOS-38** in prior architecture was “Review and Signature Due Reminder Jobs” in outbox doc — signature **legal scope UI** may be a separate small card or combined with WOS-38 naming alignment.

---

## 11. Answers to review questions

| # | Question | Answer |
|---|----------|--------|
| 1 | What does signature feature do? | Completes sign workflow steps; stores optional capture; audit; routing — §1 |
| 2 | What is stored? | `signatures` row (canvas/typed), audit, workflow state — §2 |
| 3 | Auth model? | **Hub:** Entra SSO session. **Action link:** token capability, not identity proof — §1.2 |
| 4 | Final signed PDF? | **No** |
| 5 | Document sealing? | **No** — web doc may `lock` JSON content only |
| 6 | Legal identity verification? | **No** |
| 7 | Certificate of completion? | **No** |
| 8 | What may users assume? | Workflow was acknowledged; step completed; audit exists — §4.1 |
| 9 | What must users NOT assume? | ESIGN-grade, sealed PDF, legal enforceability, identity proof — §4.2 |
| 10 | UI/README wording? | §5–8 |

---

## 12. WOS-29 production readiness recommendation

| Area | Gate |
|------|------|
| Signature **functionality** for internal ops | **Acceptable** for staging/demo with disclaimers |
| Client-facing **legally consequential** signing | **Not ready** — requires §10 future work + legal review |
| UI language accuracy | **Blocker for broad client rollout** until §7 copy deployed (implementation follow-up) |
| Email language | **Minor gap** — WOS-23 operational; soften in polish |
| README scope statement | **Add before production** marketing |

**WOS-29 may proceed** for internal production readiness **if**:

1. Stakeholders accept v1 = workflow acknowledgment only (this document signed off).
2. UI/README updates are scheduled (not necessarily in WOS-32 — doc only).
3. High-stakes client document flows are flagged or disabled until WOS-41+ .

Signature scope documentation **does not block** WOS-29 on the same terms as outbox worker (WOS-31) — but **combined** readiness requires both operational infrastructure (outbox) and **clear signature scope** (this doc) before external/client production use.

---

## 13. Follow-up cards (suggested)

| Card | Title |
|------|-------|
| **WOS-38** | Review/signature due reminders *(outbox)* OR rename split: legal UI vs reminders |
| **WOS-41** | Signed PDF generation and sealing *(future)* |
| **WOS-42** | Signature UI copy rollout *(action.html, hub.js confirm, emails)* |
| **WOS-43** | Consistent typed-ack persistence to `signatures` table |

---

## Validation record (WOS-32)

| Check | Result |
|-------|--------|
| Code changed | **No** |
| Schema changed | **No** |
| Runtime behavior changed | **No** |
| Tests run | **Not required** (documentation only) |
| Report created | **Yes** |

---

**Document owner:** WOS Platform / Legal-ops liaison  
**Next step:** Legal/ops review of §6–7 copy; schedule WOS-42 UI rollout when approved
