/**
 * Vendor identity HTTP routes — magic-link auth + vendor-scoped workspace APIs.
 *
 * Employee invite/list/revoke stay on /vendors/:ref/contacts|invitations (RBAC).
 * External auth/workspace under /vendor/auth/* and /vendor/workspace (SSO-exempt).
 */
const contacts = require('./contacts');
const invitations = require('./invitations');
const sessions = require('./sessions');
const { writeAudit } = require('./audit');
const { isPostgresConfigured } = require('./db');
const { toExternalVendorView, assertNoInternalLeak } = require('./external-view');
const { publicPath, getAppBasePath } = require('../../app-paths');

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

  // ---------- External: workspace snapshot ----------
  if (path === '/vendor/workspace' || path === '/vendor/workspace/') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const resolved = await sessions.resolveVendorSession(req);
    if (!resolved) return jsonError(res, 401, 'VENDOR_AUTH_REQUIRED', 'Vendor session required');

    // Scope: only the bound vendor — ignore any client-supplied vendor id/ref.
    const clientRef = String((req.query && req.query.ref) || '').trim();
    const all = await vendorStore.getAllVendorRecords();
    const mine = all.find((r) => r.id === resolved.vendorId);
    if (!mine) return jsonError(res, 404, 'VENDOR_NOT_FOUND', 'Vendor record not found');
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
