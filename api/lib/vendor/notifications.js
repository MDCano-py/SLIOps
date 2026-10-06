/**
 * WOS-45/47 Vendor notifications — queue via outbox email delivery path only.
 */
const { sanitizeIntegrationPayload } = require('../hub/integration-events');
const { queueNotificationEmailDelivery } = require('../hub/email-delivery');
const { DOC_LABELS } = require('./documents');
const { getVendorActionRequired, getVendorAssignedOwner } = require('./workflow');
const { vendorDetailPath, getAssignedOwnerLabel } = require('./visibility');

const DOC_EVENT_TYPES = [
  'vendor.docs_requested',
  'vendor.doc_received',
  'vendor.doc_approved',
  'vendor.docs_missing_warning',
  'vendor.contract_docs_ready',
  'vendor.docs_complete',
];

function vendorNotifyEmail(role) {
  const map = {
    rebekah: process.env.VENDOR_NOTIFY_EMAIL_ADMIN || process.env.VENDOR_NOTIFY_EMAIL_REBEKAH,
    ap: process.env.VENDOR_NOTIFY_EMAIL_AP,
    dylan: process.env.VENDOR_NOTIFY_EMAIL_LEGAL || process.env.VENDOR_NOTIFY_EMAIL_DYLAN,
  };
  return map[role] || null;
}

function portalUrl() {
  return process.env.PORTAL_BASE_URL || '';
}

function buildSafeVendorNotifyPayload(record, extras = {}) {
  const safe = sanitizeIntegrationPayload({
    ref_number: record?.refNumber,
    company_name: record?.companyName,
    overall_status: record?.overallStatus,
    assigned_owner: extras.assignedOwner || getVendorAssignedOwner(record),
    action_required: extras.actionRequired || getVendorActionRequired(record),
    doc_type: extras.docType || null,
    doc_status: extras.docStatus || null,
    doc_label: extras.docType ? (DOC_LABELS[extras.docType] || extras.docType) : null,
    event_type: extras.eventType || null,
    vendor_detail_path: vendorDetailPath(record?.refNumber),
    warnings: Array.isArray(extras.warnings) ? extras.warnings.slice(0, 10) : undefined,
    actor: extras.actor || null,
    note: extras.note || null,
  });
  delete safe.url;
  delete safe.token;
  delete safe.blob;
  return safe;
}

function recipientsForDocEvent(eventType, record, docType) {
  const financial = new Set(['w9', 'banking']);
  const contract = new Set(['msa', 'nda']);

  switch (eventType) {
    case 'vendor.docs_requested':
      return ['rebekah'];
    case 'vendor.doc_received':
    case 'vendor.doc_approved':
      if (financial.has(docType)) return ['rebekah', 'ap'];
      if (contract.has(docType)) return ['rebekah', 'dylan'];
      if (docType === 'insurance') return ['rebekah'];
      return ['rebekah'];
    case 'vendor.docs_missing_warning':
      return ['ap', 'rebekah'];
    case 'vendor.contract_docs_ready':
      return ['dylan', 'rebekah'];
    case 'vendor.docs_complete':
      return ['rebekah'];
    default:
      return ['rebekah'];
  }
}

function buildDocEventEmail(eventType, record, payload, extras = {}) {
  const ref = record.refNumber || '—';
  const company = record.companyName || 'Vendor';
  const docLabel = payload.doc_label || 'Document';
  const status = payload.doc_status || '—';
  const path = payload.vendor_detail_path || portalUrl();
  const action = payload.action_required || 'Review vendor record';
  const owner = getAssignedOwnerLabel(payload.assigned_owner);

  const subjects = {
    'vendor.docs_requested': `[Vendor Docs] ${ref} — documents requested`,
    'vendor.doc_received': `[Vendor Doc] ${ref} — ${docLabel} received`,
    'vendor.doc_approved': `[Vendor Doc] ${ref} — ${docLabel} approved`,
    'vendor.docs_missing_warning': `[Vendor Warning] ${ref} — financial docs incomplete`,
    'vendor.contract_docs_ready': `[Vendor Contract] ${ref} — contract docs ready for review`,
    'vendor.docs_complete': `[Vendor Docs] ${ref} — all required documents complete`,
  };

  const bodies = {
    'vendor.docs_requested': `Required documents have been requested for ${company} (${ref}).`,
    'vendor.doc_received': `${docLabel} was received for ${company} (${ref}). Status: ${status}.`,
    'vendor.doc_approved': `${docLabel} was approved for ${company} (${ref}).`,
    'vendor.docs_missing_warning': `Send to AP was attempted but required financial documents are still incomplete for ${company} (${ref}).`,
    'vendor.contract_docs_ready': `Contract documents are ready for legal review on ${company} (${ref}).`,
    'vendor.docs_complete': `All required documents are complete for ${company} (${ref}).`,
  };

  const warningsHtml = (extras.warnings || []).length
    ? `<ul>${extras.warnings.map((w) => `<li>${String(w).replace(/</g, '')}</li>`).join('')}</ul>`
    : '';

  const html = `
    <h2>Vendor Notification</h2>
    <p>${bodies[eventType] || 'Vendor update'}</p>
    <table cellpadding="6" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;">
      <tr><td><strong>Reference:</strong></td><td>${ref}</td></tr>
      <tr><td><strong>Company:</strong></td><td>${company}</td></tr>
      <tr><td><strong>Assigned to:</strong></td><td>${owner}</td></tr>
      <tr><td><strong>Action required:</strong></td><td>${action}</td></tr>
      ${payload.doc_label ? `<tr><td><strong>Document:</strong></td><td>${docLabel} (${status})</td></tr>` : ''}
      ${extras.note ? `<tr><td><strong>Note:</strong></td><td>${String(extras.note).replace(/</g, '')}</td></tr>` : ''}
    </table>
    ${warningsHtml}
    <p style="margin-top:16px;"><a href="${path}">Open vendor record</a></p>
  `;
  const text = [
    bodies[eventType],
    `Ref: ${ref}`,
    `Company: ${company}`,
    `Assigned: ${owner}`,
    `Action: ${action}`,
    payload.doc_label ? `Document: ${docLabel} (${status})` : '',
    extras.note ? `Note: ${extras.note}` : '',
    `Open: ${path}`,
  ].filter(Boolean).join('\n');

  return {
    subject: subjects[eventType] || `[Vendor] ${ref}`,
    html,
    text,
    template_key: eventType,
  };
}

function buildVendorAssignedEmail(record, role, actor, note) {
  const roleLabel = { ap: 'Accounts Payable', dylan: 'Legal / Executive', rebekah: 'Administration' }[role] || role;
  const path = vendorDetailPath(record.refNumber);
  const html = `
    <h2>Vendor Request Assigned to You</h2>
    <p><strong>${record.companyName || record.refNumber}</strong> needs your attention as <strong>${roleLabel}</strong>.</p>
    <table cellpadding="6" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;">
      <tr><td><strong>Reference:</strong></td><td>${record.refNumber}</td></tr>
      <tr><td><strong>Company:</strong></td><td>${record.companyName || '—'}</td></tr>
      <tr><td><strong>Status:</strong></td><td>${record.overallStatus || '—'}</td></tr>
      <tr><td><strong>Action required:</strong></td><td>${getVendorActionRequired(record)}</td></tr>
      <tr><td><strong>Reassigned by:</strong></td><td>${actor || 'unknown'}</td></tr>
      ${note ? `<tr><td><strong>Note:</strong></td><td>${note}</td></tr>` : ''}
    </table>
    <p style="margin-top:20px;"><a href="${path}">Open vendor record</a></p>
  `;
  const text = `Vendor ${record.refNumber} (${record.companyName || 'unnamed'}) assigned to ${roleLabel}. Action: ${getVendorActionRequired(record)}. Open: ${path}`;
  return {
    subject: `[Vendor] ${record.refNumber} — assigned to you (${record.companyName || 'unnamed'})`,
    html,
    text,
  };
}

function buildVendorCreatedEmail(record) {
  const path = vendorDetailPath(record.refNumber);
  const html = `
    <h2>New Vendor Request</h2>
    <p>A new vendor request has been submitted and is awaiting your review.</p>
    <p><strong>${record.refNumber}</strong> — ${record.companyName || 'New Vendor'}</p>
    <p>Requested by: ${record.requestedBy || '—'}</p>
    <p>Action required: ${getVendorActionRequired(record)}</p>
    <p><a href="${path}">Open vendor record</a></p>
  `;
  const text = `New vendor ${record.refNumber} — ${record.companyName}. Requested by ${record.requestedBy || '—'}. Open: ${path}`;
  return {
    subject: `[Vendor Request] ${record.refNumber} — ${record.companyName || 'New Vendor'}`,
    html,
    text,
  };
}

function buildVendorCompleteEmail(record, actor) {
  const path = vendorDetailPath(record.refNumber);
  const html = `
    <h2>Vendor Onboarding Complete</h2>
    <p><strong>${record.companyName || record.refNumber}</strong> is complete.</p>
    <p>Reference: ${record.refNumber}</p>
    <p>Marked complete by: ${actor || 'system'}</p>
    <p><a href="${path}">Open vendor record</a></p>
  `;
  const text = `Vendor ${record.refNumber} (${record.companyName}) is complete. Open: ${path}`;
  return {
    subject: `[Vendor Complete] ${record.refNumber} — ${record.companyName || 'Vendor'}`,
    html,
    text,
  };
}

async function queueVendorEmailNotification({
  channel,
  record,
  assigneeRole,
  email,
  safePayload,
  dedupeSuffix,
}) {
  const recipient = assigneeRole ? vendorNotifyEmail(assigneeRole) : null;
  if (!recipient) {
    return { skipped: true, reason: 'no_recipient', role: assigneeRole, channel };
  }
  const dedupeKey = `vendor:${record.refNumber}:${channel}${dedupeSuffix ? `:${dedupeSuffix}` : ''}`;
  try {
    return await queueNotificationEmailDelivery({
      channel,
      dedupeKey,
      recipientEmail: recipient,
      email: {
        to: recipient,
        subject: email.subject,
        html: email.html,
        text: email.text,
        template_key: email.template_key || channel,
      },
      audit: {},
    });
  } catch (err) {
    console.warn('[vendor-notify] queue failed:', err.message);
    return { ok: false, error: err.message, channel };
  }
}

async function notifyVendorDocumentEvent({
  eventType,
  record,
  docType,
  docStatus,
  actor,
  note,
  warnings,
  dedupeSuffix,
}) {
  if (!eventType || !record || !DOC_EVENT_TYPES.includes(eventType)) {
    return { skipped: true, reason: 'invalid_event' };
  }

  const payload = buildSafeVendorNotifyPayload(record, {
    eventType,
    docType,
    docStatus,
    actor,
    note,
    warnings,
  });

  const emailTpl = buildDocEventEmail(eventType, record, payload, { note, warnings });
  const roles = recipientsForDocEvent(eventType, record, docType);
  const channel = eventType.replace(/^vendor\./, 'vendor.');
  const results = [];

  for (const role of roles) {
    const r = await queueVendorEmailNotification({
      channel: `${channel}.${role}`,
      record,
      assigneeRole: role,
      email: emailTpl,
      safePayload: payload,
      dedupeSuffix: dedupeSuffix || docType || 'all',
    });
    results.push({ role, ...r });
  }

  return { eventType, results, payload };
}

async function queueVendorWorkflowNotification({ channel, record, assigneeRole, actorEmail, note, email }) {
  const payload = buildSafeVendorNotifyPayload(record, { eventType: `vendor.${channel}`, actor: actorEmail, note });
  return queueVendorEmailNotification({
    channel: `vendor.${channel}`,
    record,
    assigneeRole,
    email: { ...email, template_key: `vendor.${channel}` },
    safePayload: payload,
    dedupeSuffix: null,
  });
}

async function notifyVendorWorkflowEvent({ notifyKey, record, actor, note, warnings }) {
  if (!notifyKey || !record) return { skipped: true };

  switch (notifyKey) {
    case 'new_vendor_rebekah':
      return queueVendorWorkflowNotification({
        channel: 'created',
        record,
        assigneeRole: 'rebekah',
        actorEmail: actor,
        note,
        email: buildVendorCreatedEmail(record),
      });
    case 'documents_requested':
      return notifyVendorDocumentEvent({
        eventType: 'vendor.docs_requested',
        record,
        actor,
        note,
        dedupeSuffix: 'requested',
      });
    case 'sent_to_ap': {
      const workflow = await queueVendorWorkflowNotification({
        channel: 'sent_to_ap',
        record,
        assigneeRole: 'ap',
        actorEmail: actor,
        note,
        email: buildVendorAssignedEmail(record, 'ap', actor, note),
      });
      if (warnings && warnings.length) {
        await notifyVendorDocumentEvent({
          eventType: 'vendor.docs_missing_warning',
          record,
          actor,
          note,
          warnings,
          dedupeSuffix: 'send_ap',
        });
      }
      return workflow;
    }
    case 'ap_complete_contract':
      return queueVendorWorkflowNotification({
        channel: 'ap_complete',
        record,
        assigneeRole: 'rebekah',
        actorEmail: actor,
        note: note || 'AP setup complete — contract review required',
        email: buildVendorAssignedEmail(record, 'rebekah', actor, note || 'AP setup complete'),
      });
    case 'sent_to_dylan':
      return queueVendorWorkflowNotification({
        channel: 'sent_to_dylan',
        record,
        assigneeRole: 'dylan',
        actorEmail: actor,
        note,
        email: buildVendorAssignedEmail(record, 'dylan', actor, note),
      });
    case 'vendor_complete':
      return notifyVendorDocumentEvent({
        eventType: 'vendor.docs_complete',
        record,
        actor,
        note: note || 'Vendor onboarding complete',
        dedupeSuffix: 'complete',
      });
    case 'contract_docs_ready':
      return notifyVendorDocumentEvent({
        eventType: 'vendor.contract_docs_ready',
        record,
        docType: note?.docType,
        docStatus: note?.docStatus,
        actor,
        note: typeof note === 'string' ? note : note?.text,
        dedupeSuffix: note?.docType || 'contract',
      });
    default:
      return { skipped: true, reason: 'unknown_notify_key' };
  }
}

async function notifyAfterDocumentChange(record, { docType, newStatus, actor, wasDocsComplete }) {
  if (!record || !docType) return { skipped: true };
  const status = newStatus || record.documentMeta?.[docType]?.status;
  const isNowComplete = record.requiredDocumentsComplete;

  if (status === 'received') {
    await notifyVendorDocumentEvent({
      eventType: 'vendor.doc_received',
      record,
      docType,
      docStatus: status,
      actor,
      dedupeSuffix: `${docType}:received`,
    });
  } else if (status === 'approved') {
    await notifyVendorDocumentEvent({
      eventType: 'vendor.doc_approved',
      record,
      docType,
      docStatus: status,
      actor,
      dedupeSuffix: `${docType}:approved`,
    });
  }

  const contractTypes = new Set(['msa', 'nda']);
  if (
    contractTypes.has(docType) &&
    (status === 'received' || status === 'approved') &&
    ['pending_contract_review', 'pending_dylan_review'].includes(record.overallStatus)
  ) {
    await notifyVendorDocumentEvent({
      eventType: 'vendor.contract_docs_ready',
      record,
      docType,
      docStatus: status,
      actor,
      dedupeSuffix: `${docType}:contract`,
    });
  }

  if (wasDocsComplete === false && isNowComplete) {
    await notifyVendorDocumentEvent({
      eventType: 'vendor.docs_complete',
      record,
      actor,
      dedupeSuffix: 'all_complete',
    });
  }

  return { ok: true };
}

module.exports = {
  DOC_EVENT_TYPES,
  vendorNotifyEmail,
  buildSafeVendorNotifyPayload,
  recipientsForDocEvent,
  notifyVendorDocumentEvent,
  notifyVendorWorkflowEvent,
  notifyAfterDocumentChange,
  queueVendorWorkflowNotification,
  buildVendorCreatedEmail,
  buildVendorAssignedEmail,
  buildVendorCompleteEmail,
  buildDocEventEmail,
};
