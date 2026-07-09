// Multi-tenant SAML SSO routes: /sso/:orgSlug/{login|acs|metadata}
// Admin config: /sso-admin/organizations/:slug

const auth = require('./auth.js');
const { createOrgStore } = require('./org-store.js');
const {
  getOrgLoginUrl,
  validateOrgResponse,
  getOrgServiceProviderMetadata,
  testConnectionConfig,
} = require('./saml-org.js');

function escapeHtmlServer(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getPortalBaseUrl(req) {
  const env = process.env.PORTAL_BASE_URL;
  if (env && /^https?:\/\//i.test(env)) {
    return env.replace(/\/$/, '');
  }
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https');
  return `${proto}://${host}`.replace(/\/$/, '');
}

function renderError(res, status, title, message, portalBase) {
  res.status(status);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const esc = escapeHtmlServer;
  const escAttr = (s) => esc(s).replace(/"/g, '&quot;');
  res.send(`<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:80px auto;padding:0 24px;color:#1a1a2e;line-height:1.5}h1{font-size:20px;margin:0 0 12px}.msg{color:#5a6b6d;margin-bottom:24px}a{color:#1f7a7f}</style>
</head><body>
<h1>${esc(title)}</h1>
<p class="msg">${esc(message)}</p>
<p><a href="${escAttr(portalBase || '/')}">← Return to portal</a></p>
</body></html>`);
}

function parseFormBody(req) {
  let body = req.body || {};
  if (typeof body === 'string') {
    body = Object.fromEntries(new URLSearchParams(body));
  }
  if (Buffer.isBuffer(body)) {
    body = Object.fromEntries(new URLSearchParams(body.toString('utf8')));
  }
  return body;
}

function parseJsonBody(req) {
  if (!req.body) return {};
  try {
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return null;
  }
}

function createSsoHandlers(redis) {
  const orgStore = createOrgStore(redis);

  async function resolveOrgContext(orgSlug, portalBase) {
    let { org, connection } = await orgStore.getSamlConnectionBySlug(orgSlug);
    if (!org && orgSlug === 'default') {
      const boot = await orgStore.bootstrapLegacySamlOrg(portalBase);
      if (boot) {
        org = boot.org;
        connection = boot.connection;
      }
    }
    return { org, connection };
  }

  async function handleSsoRoute(path, req, res, deps = {}) {
    const ensureUserProvisioned = deps.ensureUserProvisioned;
    const portalBase = getPortalBaseUrl(req);
    const match = path.match(/^\/sso\/([^/]+)\/(login|acs|metadata)$/);
    if (!match) {
      return res.status(404).json({ error: 'Unknown SSO route' });
    }

    const orgSlug = match[1].toLowerCase();
    const action = match[2];

    try {
      const { org, connection } = await resolveOrgContext(orgSlug, portalBase);

      if (!org) {
        if (action === 'login' || action === 'acs') {
          return renderError(res, 404, 'Organization not found',
            `No organization is registered for slug "${orgSlug}".`, portalBase);
        }
        return res.status(404).json({ error: 'Organization not found' });
      }

      if (!org.sso_enabled) {
        const msg = 'Single sign-on is disabled for this organization. Contact your administrator.';
        if (action === 'login' || action === 'acs') {
          return renderError(res, 403, 'SSO disabled', msg, portalBase);
        }
        return res.status(403).json({ error: 'SSO disabled for organization' });
      }

      if (!connection || !connection.active) {
        const msg = 'SAML is not configured for this organization yet.';
        if (action === 'login' || action === 'acs') {
          return renderError(res, 503, 'SSO not configured', msg, portalBase);
        }
        return res.status(503).json({ error: 'SAML connection not configured' });
      }

      if (action === 'metadata') {
        if (req.method !== 'GET') {
          return res.status(405).json({ error: 'Method not allowed' });
        }
        const xml = getOrgServiceProviderMetadata(connection);
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        return res.status(200).send(xml);
      }

      if (action === 'login') {
        if (req.method !== 'GET') {
          return res.status(405).json({ error: 'Method not allowed' });
        }
        const next = typeof req.query.next === 'string' ? req.query.next : '';
        const remember = req.query.remember === '1' || req.query.remember === 'true';
        const relay = JSON.stringify({ r: remember ? 1 : 0, n: next.slice(0, 256), org: orgSlug });
        const url = await getOrgLoginUrl(connection, relay);
        res.setHeader('Location', url);
        return res.status(302).end();
      }

      if (action === 'acs') {
        if (req.method !== 'POST') {
          return res.status(405).json({ error: 'Method not allowed for ACS' });
        }
        const body = parseFormBody(req);
        const samlResponse = body.SAMLResponse;
        const relayState = body.RelayState || '';
        if (!samlResponse) {
          return renderError(res, 400, 'Missing SAML response',
            'The identity provider did not include a SAMLResponse field.', portalBase);
        }

        let identity;
        try {
          identity = await validateOrgResponse(connection, samlResponse);
        } catch (err) {
          console.error(`[sso/${orgSlug}/acs] SAML validation failed:`, err.message);
          return renderError(res, 401, 'Sign-in failed',
            'We could not verify your identity provider response. Check SAML configuration or certificate expiry.',
            portalBase);
        }

        let remember = false;
        let next = '';
        try {
          const parsed = JSON.parse(relayState || '{}');
          remember = parsed.r === 1;
          next = typeof parsed.n === 'string' ? parsed.n : '';
        } catch { /* defaults */ }

        auth.issueSession(res, identity.email, { remember });

        if (typeof ensureUserProvisioned === 'function') {
          try {
            await ensureUserProvisioned({
              ...identity,
              organization_id: org.id,
              organization_slug: org.slug,
              auth_provider: 'saml',
              external_id: identity.external_id || identity.nameID,
              role: connection.default_role || 'employee',
            });
          } catch (err) {
            console.error(`[sso/${orgSlug}/acs] Provisioning failed (non-fatal):`, err.message);
          }
        }

        let target = portalBase.endsWith('/') ? portalBase : `${portalBase}/`;
        if (next && next.startsWith('/') && !next.startsWith('//')) {
          const base = portalBase.replace(/\/$/, '');
          target = base + next;
        }
        res.setHeader('Location', target);
        return res.status(302).end();
      }

      return res.status(404).json({ error: 'Unknown SSO action' });
    } catch (err) {
      console.error(`[sso/${orgSlug}] handler error:`, err.message);
      if (action === 'login' || action === 'acs') {
        return renderError(res, 500, 'SSO error',
          'Something went wrong during sign-in. Please contact your administrator.', portalBase);
      }
      return res.status(500).json({ error: 'SSO handler error' });
    }
  }

  async function handleSsoAdminRoute(path, req, res, { requireVendorAuth }) {
    if (!requireVendorAuth(req, res)) return true;

    const portalBase = getPortalBaseUrl(req);

    if (path === '/sso-admin/organizations' && req.method === 'GET') {
      const orgs = await orgStore.listOrganizations();
      const enriched = [];
      for (const org of orgs) {
        const connection = await orgStore.getSamlConnection(org.id);
        enriched.push({
          ...org,
          saml: orgStore.sanitizeConnectionForAdmin(connection),
          sp_urls: orgStore.computeSpUrls(portalBase, org.slug),
        });
      }
      res.status(200).json({ organizations: enriched, portal_base: portalBase });
      return true;
    }

    const orgMatch = path.match(/^\/sso-admin\/organizations\/([^/]+)(?:\/(test))?$/);
    if (!orgMatch) return false;

    const slug = decodeURIComponent(orgMatch[1]).toLowerCase();
    const isTest = orgMatch[2] === 'test';

    if (req.method === 'GET' && !isTest) {
      let { org, connection } = await orgStore.getSamlConnectionBySlug(slug);
      if (!org) {
        return res.status(404).json({ error: 'Organization not found' });
      }
      res.status(200).json({
        organization: org,
        saml: orgStore.sanitizeConnectionForAdmin(connection),
        sp_urls: orgStore.computeSpUrls(portalBase, org.slug),
        login_url: `${portalBase}/sso/${org.slug}/login`,
      });
      return true;
    }

    if (req.method === 'PUT' && !isTest) {
      const body = parseJsonBody(req);
      if (!body) return res.status(400).json({ error: 'Invalid JSON body' });

      const existing = await orgStore.getOrgBySlug(slug);
      const payload = {
        id: existing?.id,
        name: body.name || existing?.name || slug,
        slug: body.slug || slug,
        sso_enabled: body.sso_enabled !== undefined ? !!body.sso_enabled : (existing?.sso_enabled ?? false),
      };

      if (body.saml || body.idp_entity_id || body.idp_sso_url || body.idp_x509_cert) {
        const prevConn = existing ? await orgStore.getSamlConnection(existing.id) : null;
        payload.saml = {
          provider_name: body.provider_name || body.saml?.provider_name || prevConn?.provider_name || 'Microsoft Entra ID',
          idp_entity_id: body.idp_entity_id || body.saml?.idp_entity_id || prevConn?.idp_entity_id || '',
          idp_sso_url: body.idp_sso_url || body.saml?.idp_sso_url || prevConn?.idp_sso_url || '',
          idp_x509_cert: body.idp_x509_cert || body.saml?.idp_x509_cert || prevConn?.idp_x509_cert || '',
          default_role: body.default_role || body.saml?.default_role || prevConn?.default_role || 'employee',
          active: body.active !== undefined ? !!body.active : (body.saml?.active !== undefined ? !!body.saml.active : (prevConn?.active ?? true)),
        };
      }

      const saved = await orgStore.saveOrganization(payload, portalBase);
      res.status(200).json({
        organization: saved.org,
        saml: orgStore.sanitizeConnectionForAdmin(saved.connection),
        sp_urls: orgStore.computeSpUrls(portalBase, saved.org.slug),
        login_url: `${portalBase}/sso/${saved.org.slug}/login`,
      });
      return true;
    }

    if (req.method === 'POST' && isTest) {
      const { org, connection } = await orgStore.getSamlConnectionBySlug(slug);
      if (!org) return res.status(404).json({ error: 'Organization not found' });
      if (!connection) return res.status(400).json({ error: 'SAML connection not configured' });
      try {
        const result = testConnectionConfig(connection);
        res.status(200).json({ ok: true, ...result });
      } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
      }
      return true;
    }

    res.status(405).json({ error: 'Method not allowed' });
    return true;
  }

  return {
    handleSsoRoute,
    handleSsoAdminRoute,
    getPortalBaseUrl,
    orgStore,
  };
}

module.exports = { createSsoHandlers, escapeHtmlServer, getPortalBaseUrl };
