/**
 * Vendor identity HTTP routes — magic-link auth + vendor-scoped workspace APIs.
 *
 * Employee invite/list/revoke stay on /vendors/:ref/contacts|invitations (RBAC).
 * External auth/workspace under /vendor/auth/* and /vendor/workspace (SSO-exempt).
 */
const contacts = require('./contacts');
const invitations = require('./invitations');
const sessions = require('./sessions');
const loginCodes = require('./login-codes');
const vendorAuthRate = require('./rate-limit');
const { deliverVerificationCode } = require('./deliver-code');
const { writeAudit } = require('./audit');
const { isPostgresConfigured } = require('./db');
const { toExternalVendorView, assertNoInternalLeak } = require('./external-view');
const { assertVendorCompanyScope } = require('../../platform/authorization');
const { publicPath, getAppBasePath } = require('../../app-paths');

const CODE_REQUEST_BODY = {
  ok: true,
  message: 'If an active vendor account matches that email, a verification code has been sent.',
};
const CODE_REJECT_BODY = {
  error: 'Invalid or expired verification code',
  code: 'invalid_code',
};

function inviteUrl(token) {
  const base = (process.env.PORTAL_BASE_URL || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const rel = `/vendor-workspace.html?token=${encodeURIComponent(token)}`;
  if (base) return `${base}${rel.startsWith('/') ? rel : `/${rel}`}`;
  return publicPath(rel, getAppBasePath());
}

async function resolveVendorUuidByRef(vendorStore, ref) {
  const result = await vendorStore.readVendorRecord(ref);
  if (!result?.record) return null;
  // Prefer explicit id from row mapping; fall back to DB lookup.
  if (result.record.id) return result.record.id;
  if (typeof vendorStore.getVendorIdByRef === 'function') {
    return vendorStore.getVendorIdByRef(ref);
  }
  return null;
}

function jsonError(res, status, code, message) {
  return res.status(status).json({ error: message || code, code });
}

function readJsonBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body || {};
}

/**
 * Try to handle a vendor-identity path. Returns true if handled.
 *
 * @param {object} deps
 * @param {object} deps.vendorStore
 * @param {function} deps.requirePermissions
 * @param {function} deps.auth
 */
async function handleVendorIdentityRoute(path, req, res, deps) {
  if (!path || typeof path !== 'string') return false;
  if (!path.startsWith('/vendor/') && !/^\/vendors\/[^/]+\/(contacts|invitations)/.test(path)) {
    return false;
  }

  if (!isPostgresConfigured()) {
    return jsonError(res, 503, 'VENDOR_IDENTITY_UNAVAILABLE', 'Vendor identity requires Postgres');
  }

  const { vendorStore, requirePermissions, auth } = deps;

  // ---------- External: consume magic link ----------
  if (path === '/vendor/auth/consume') {
    if (req.method !== 'GET' && req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const body = typeof req.body === 'string'
      ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
      : (req.body || {});
    const token = String(
      (req.query && req.query.token) || body.token || ''
    ).trim();
    if (vendorAuthRate.isLimited(req)) {
      return jsonError(res, 429, 'RATE_LIMITED', 'Too many invitation attempts. Try again later.');
    }
    try {
      const { invitation, contact } = await invitations.consumeInvitation(token);
      const { session } = await sessions.createSession({
        vendorId: invitation.vendorId,
        contact,
        res,
      });
      // Never echo raw token
      return res.status(200).json({
        ok: true,
        vendorIdBound: true,
        contactEmail: contact.email,
        sessionExpiresAt: session.expiresAt,
        redirect: publicPath('/vendor-workspace.html', getAppBasePath()),
      });
    } catch (err) {
      const code = err.code || err.message || 'consume_failed';
      const map = {
        invalid_token: [401, 'Invalid invitation token'],
        invite_used: [410, 'Invitation already used'],
        invite_expired: [410, 'Invitation expired'],
        invite_revoked: [410, 'Invitation revoked'],
        contact_not_active: [403, 'Vendor contact is not active'],
      };
      const [status, msg] = map[code] || [400, 'Unable to consume invitation'];
      if (status === 401 || code === 'invalid_token') vendorAuthRate.recordFailure(req);
      return jsonError(res, status, code, msg);
    }
  }

  // ---------- External: session me / logout ----------
  if (path === '/vendor/auth/me') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const resolved = await sessions.resolveVendorSession(req);
    if (!resolved) return jsonError(res, 401, 'VENDOR_AUTH_REQUIRED', 'Vendor session required');
    return res.status(200).json({
      ok: true,
      email: resolved.contact.email,
      name: resolved.contact.name || '',
      contactId: resolved.contact.id,
      scopes: resolved.session.scopes,
      expiresAt: resolved.session.expiresAt,
      idleExpiresAt: resolved.session.idleExpiresAt,
    });
  }

  if (path === '/vendor/auth/logout') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    await sessions.logoutRequest(req, res);
    return res.status(200).json({ ok: true });
  }

  // ---------- External: email verification code (no account enumeration) ----------
  if (path === '/vendor/auth/code/request') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = readJsonBody(req);
    const email = contacts.normalizeEmail(body.email);
    if (!email) return jsonError(res, 400, 'email_required', 'Email is required');
    if (vendorAuthRate.isCodeRequestLimited(req, email)) {
      return jsonError(res, 429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
    }
    vendorAuthRate.recordCodeRequest(req, email);
    try {
      const matches = email.length > 320 ? [] : await contacts.listActiveContactsByEmail(email);
      if (matches.length === 1) {
        const issued = await loginCodes.issueLoginCode(matches[0]);
        const delivery = await deliverVerificationCode({ to: matches[0].email, code: issued.code });
        await writeAudit({
          eventType: 'vendor_login_code_delivery',
          vendorId: matches[0].vendorId,
          contactId: matches[0].id,
          actorKind: 'vendor_contact',
          actorId: matches[0].email,
          detail: 'Verification code delivery attempted',
          meta: { delivery: delivery.ok ? 'sent' : (delivery.reason || 'skipped') },
        });
      } else if (matches.length > 1) {
        await writeAudit({
          eventType: 'vendor_login_ambiguous_email',
          actorKind: 'vendor_contact',
          actorId: '',
          detail: 'Verification code suppressed because the email matches more than one vendor',
          meta: { matchCount: matches.length },
        });
      }
    } catch (err) {
      console.error('[vendor-otp] code request failed');
      await writeAudit({
        eventType: 'vendor_login_code_error',
        actorKind: 'system',
        actorId: '',
        detail: 'Verification code request failed',
        meta: { reason: 'internal' },
      });
    }
    return res.status(200).json(CODE_REQUEST_BODY);
  }

  if (path === '/vendor/auth/code/verify') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = readJsonBody(req);
    const email = contacts.normalizeEmail(body.email);
    const code = String(body.code || '').trim();
    if (!email || !code) return jsonError(res, 400, 'code_required', 'Email and code are required');
    if (vendorAuthRate.isVerifyLimited(req, email) || vendorAuthRate.isLimited(req)) {
      return jsonError(res, 429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
    }
    try {
      const matches = await contacts.listActiveContactsByEmail(email);
      if (matches.length !== 1) {
        vendorAuthRate.recordVerifyFailure(req, email);
        return res.status(401).json(CODE_REJECT_BODY);
      }
      await loginCodes.verifyAndConsume({ contactId: matches[0].id, code });
      const { session } = await sessions.createSession({
        vendorId: matches[0].vendorId,
        contact: matches[0],
        res,
      });
      await writeAudit({
        eventType: 'vendor_login_code_verified',
        vendorId: matches[0].vendorId,
        contactId: matches[0].id,
        actorKind: 'vendor_contact',
        actorId: matches[0].email,
        detail: 'Verification code accepted',
      });
      return res.status(200).json({
        ok: true,
        vendorIdBound: true,
        contactEmail: matches[0].email,
        sessionExpiresAt: session.expiresAt,
        redirect: publicPath('/vendor-workspace.html', getAppBasePath()),
      });
    } catch (err) {
      if (!err || err.code !== 'invalid_code') {
        console.error('[vendor-otp] verify failed');
        return jsonError(res, 503, 'VENDOR_AUTH_UNAVAILABLE', 'Vendor sign-in is temporarily unavailable');
      }
      vendorAuthRate.recordVerifyFailure(req, email);
      await writeAudit({
        eventType: 'vendor_login_code_rejected',
        actorKind: 'vendor_contact',
        actorId: '',
        detail: 'Verification code rejected',
        meta: { reason: 'invalid_code' },
      });
      return res.status(401).json(CODE_REJECT_BODY);
    }
  }

  // ---------- External: workspace snapshot ----------
  if (path === '/vendor/workspace' || path === '/vendor/workspace/') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const resolved = await sessions.resolveVendorSession(req);
    if (!resolved) return jsonError(res, 401, 'VENDOR_AUTH_REQUIRED', 'Vendor session required');

    // Scope: only the bound vendor — parameterized lookup, ignore client vendor id.
    const clientRef = String((req.query && req.query.ref) || '').trim();
    const mine = typeof vendorStore.getVendorRecordById === 'function'
      ? await vendorStore.getVendorRecordById(resolved.vendorId)
      : null;
    if (!mine) return jsonError(res, 404, 'VENDOR_NOT_FOUND', 'Vendor record not found');
    try {
      assertVendorCompanyScope(resolved.vendorId, mine.id);
    } catch (err) {
      return jsonError(res, 403, err.code || 'VENDOR_SCOPE_DENIED', 'Not authorized for that vendor');
    }
    if (clientRef && clientRef !== mine.refNumber) {
      await writeAudit({
        eventType: 'vendor_scope_escape_blocked',
        vendorId: resolved.vendorId,
        contactId: resolved.contact.id,
        actorKind: 'vendor_contact',
        actorId: resolved.contact.email,
        detail: 'Client attempted to request a different vendor ref',
        meta: { attemptedRef: clientRef },
      });
      return jsonError(res, 403, 'VENDOR_SCOPE_DENIED', 'Not authorized for that vendor');
    }

    const view = toExternalVendorView(mine, { contact: resolved.contact });
    assertNoInternalLeak(view);
    return res.status(200).json({ ok: true, vendor: view });
  }

  // ---------- Internal: contacts list / invite ----------
  const contactsMatch = path.match(/^\/vendors\/([A-Za-z0-9_-]+)\/contacts$/);
  if (contactsMatch) {
    const ref = contactsMatch[1];
    const ctx = await requirePermissions(req, res, [
      'view_management',
      'view_vendor_list',
      'edit_vendor_info',
      'manage_vendor_documents',
    ]);
    if (!ctx) return true;

    const vendorId = await resolveVendorUuidByRef(vendorStore, ref);
    if (!vendorId) return jsonError(res, 404, 'VENDOR_NOT_FOUND', 'Vendor not found');

    if (req.method === 'GET') {
      const list = await contacts.listContacts(vendorId);
      return res.status(200).json({ contacts: list });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string'
        ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
        : (req.body || {});
      const email = String(body.email || '').trim();
      const name = String(body.name || '').trim();
      if (!email) return jsonError(res, 400, 'email_required', 'Contact email is required');

      const contact = await contacts.upsertContact({
        vendorId,
        email,
        name: name || String(body.contactName || '').trim(),
      });

      // Optional immediate invite
      let invite = null;
      if (body.invite !== false) {
        const created = await invitations.createInvitation({
          vendorId,
          contactId: contact.id,
          createdBy: ctx.actorEmail || '',
          meta: { refNumber: ref },
        });
        invite = {
          id: created.invitation.id,
          expiresAt: created.invitation.expiresAt,
          // Plaintext token returned once to the inviting employee (copy/email).
          // Never logged. Email delivery is EC2/live-only.
          inviteUrl: inviteUrl(created.token),
          token: created.token,
        };
      }

      await writeAudit({
        eventType: 'vendor_contact_upserted',
        vendorId,
        contactId: contact.id,
        actorKind: 'employee',
        actorId: ctx.actorEmail || '',
        detail: invite ? 'Contact upserted and invited' : 'Contact upserted',
      });

      return res.status(200).json({ contact, invitation: invite });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ---------- Internal: invitations list / revoke ----------
  const invitationsMatch = path.match(/^\/vendors\/([A-Za-z0-9_-]+)\/invitations(?:\/([A-Za-z0-9-]+))?$/);
  if (invitationsMatch) {
    const ref = invitationsMatch[1];
    const inviteId = invitationsMatch[2] || null;
    const ctx = await requirePermissions(req, res, [
      'view_management',
      'edit_vendor_info',
      'manage_vendor_documents',
    ]);
    if (!ctx) return true;

    const vendorId = await resolveVendorUuidByRef(vendorStore, ref);
    if (!vendorId) return jsonError(res, 404, 'VENDOR_NOT_FOUND', 'Vendor not found');

    if (req.method === 'GET' && !inviteId) {
      const list = await invitations.listInvitations(vendorId, { includeUsed: true });
      // Never include token hashes in API responses beyond presence metadata
      return res.status(200).json({
        invitations: list.map((i) => ({
          id: i.id,
          contactId: i.contactId,
          purpose: i.purpose,
          expiresAt: i.expiresAt,
          usedAt: i.usedAt,
          revokedAt: i.revokedAt,
          createdBy: i.createdBy,
          createdAt: i.createdAt,
        })),
      });
    }

    if (req.method === 'POST' && !inviteId) {
      // Resend / create invite for existing contact
      const body = typeof req.body === 'string'
        ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
        : (req.body || {});
      const contactId = String(body.contactId || '').trim();
      if (!contactId) return jsonError(res, 400, 'contact_id_required', 'contactId is required');
      const contact = await contacts.getContact(contactId);
      if (!contact || contact.vendorId !== vendorId) {
        return jsonError(res, 404, 'contact_not_found', 'Contact not found for this vendor');
      }
      const created = await invitations.createInvitation({
        vendorId,
        contactId,
        createdBy: ctx.actorEmail || '',
        meta: { refNumber: ref },
      });
      return res.status(200).json({
        invitation: {
          id: created.invitation.id,
          expiresAt: created.invitation.expiresAt,
          inviteUrl: inviteUrl(created.token),
          token: created.token,
        },
      });
    }

    if (req.method === 'DELETE' && inviteId) {
      const revoked = await invitations.revokeInvitation(inviteId, ctx.actorEmail || '');
      if (!revoked || revoked.vendorId !== vendorId) {
        return jsonError(res, 404, 'invite_not_found', 'Invitation not found');
      }
      return res.status(200).json({ ok: true, invitation: revoked });
    }

    // Revoke all sessions for a contact
    if (req.method === 'POST' && inviteId === 'revoke-access') {
      const body = typeof req.body === 'string'
        ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
        : (req.body || {});
      const contactId = String(body.contactId || '').trim();
      if (!contactId) return jsonError(res, 400, 'contact_id_required', 'contactId is required');
      const contact = await contacts.getContact(contactId);
      if (!contact || contact.vendorId !== vendorId) {
        return jsonError(res, 404, 'contact_not_found', 'Contact not found');
      }
      await contacts.setContactStatus(contactId, body.disable === false ? 'active' : 'disabled');
      const n = await sessions.revokeAllForContact(contactId, {
        actorKind: 'employee',
        actorId: ctx.actorEmail || '',
      });
      return res.status(200).json({ ok: true, sessionsRevoked: n });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Unmatched /vendor/* — do not claim unrelated paths except auth/workspace
  if (path.startsWith('/vendor/')) {
    return jsonError(res, 404, 'NOT_FOUND', 'Not found');
  }

  return false;
}

/** Paths that may bypass employee SSO enforcement (still gated by token/session). */
function isVendorIdentityPublicPath(pathOnly) {
  if (!pathOnly || typeof pathOnly !== 'string') return false;
  return (
    pathOnly === '/vendor/auth/consume' ||
    pathOnly === '/vendor/auth/code/request' ||
    pathOnly === '/vendor/auth/code/verify' ||
    pathOnly === '/vendor/auth/me' ||
    pathOnly === '/vendor/auth/logout' ||
    pathOnly === '/vendor/workspace' ||
    pathOnly === '/vendor/workspace/'
  );
}

module.exports = {
  handleVendorIdentityRoute,
  isVendorIdentityPublicPath,
  inviteUrl,
};
