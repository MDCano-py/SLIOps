// Redis-backed organizations + SAML connection records (multi-tenant SSO).

const crypto = require('crypto');

const ORG_INDEX = 'orgs:index';
const ORG_SLUG_PREFIX = 'org:slug:';
const ORG_KEY_PREFIX = 'org:';
const SAML_ORG_PREFIX = 'saml:org:';

function nowIso() {
  return new Date().toISOString();
}

function slugify(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function isValidSlug(slug) {
  return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug || '');
}

function computeSpUrls(portalBase, slug) {
  const base = String(portalBase || '').replace(/\/$/, '');
  return {
    sp_entity_id: `${base}/sso/${slug}/metadata`,
    sp_acs_url: `${base}/sso/${slug}/acs`,
    sp_metadata_url: `${base}/sso/${slug}/metadata`,
  };
}

function createOrgStore(redis) {
  async function getOrgById(id) {
    if (!id) return null;
    const raw = await redis.get(`${ORG_KEY_PREFIX}${id}`);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }

  async function getOrgBySlug(slug) {
    const normalized = slugify(slug);
    if (!isValidSlug(normalized)) return null;
    const id = await redis.get(`${ORG_SLUG_PREFIX}${normalized}`);
    if (!id) return null;
    return getOrgById(id);
  }

  async function listOrganizations() {
    const ids = (await redis.smembers(ORG_INDEX)) || [];
    const orgs = [];
    for (const id of ids) {
      const org = await getOrgById(id);
      if (org) orgs.push(org);
    }
    orgs.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return orgs;
  }

  async function getSamlConnection(orgId) {
    if (!orgId) return null;
    const raw = await redis.get(`${SAML_ORG_PREFIX}${orgId}`);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }

  async function getSamlConnectionBySlug(slug) {
    const org = await getOrgBySlug(slug);
    if (!org) return { org: null, connection: null };
    const connection = await getSamlConnection(org.id);
    return { org, connection };
  }

  async function saveOrganization(input, portalBase) {
    const slug = slugify(input.slug || input.name);
    if (!isValidSlug(slug)) {
      throw new Error('Organization slug must be lowercase letters, numbers, and hyphens');
    }

    let org = input.id ? await getOrgById(input.id) : null;
    const ts = nowIso();

    if (!org) {
      const existingId = await redis.get(`${ORG_SLUG_PREFIX}${slug}`);
      if (existingId) {
        org = await getOrgById(existingId);
      }
    }

    if (org && org.slug !== slug) {
      const conflict = await redis.get(`${ORG_SLUG_PREFIX}${slug}`);
      if (conflict && conflict !== org.id) {
        throw new Error(`Slug "${slug}" is already in use`);
      }
    }

    if (!org) {
      org = {
        id: crypto.randomUUID(),
        name: String(input.name || slug).trim(),
        slug,
        sso_enabled: !!input.sso_enabled,
        created_at: ts,
        updated_at: ts,
      };
    } else {
      org.name = String(input.name || org.name).trim();
      org.slug = slug;
      org.sso_enabled = input.sso_enabled !== undefined ? !!input.sso_enabled : org.sso_enabled;
      org.updated_at = ts;
    }

    const p = redis.pipeline();
    if (org.slug !== slug) {
      // slug change: caller should avoid; keep simple
    }
    p.set(`${ORG_KEY_PREFIX}${org.id}`, JSON.stringify(org));
    p.set(`${ORG_SLUG_PREFIX}${org.slug}`, org.id);
    p.sadd(ORG_INDEX, org.id);
    await p.exec();

    const sp = computeSpUrls(portalBase, org.slug);
    let connection = await getSamlConnection(org.id);
    if (input.saml) {
      connection = await saveSamlConnection(org.id, { ...input.saml, ...sp }, portalBase);
    } else if (connection) {
      connection = {
        ...connection,
        ...sp,
        updated_at: ts,
      };
      await redis.set(`${SAML_ORG_PREFIX}${org.id}`, JSON.stringify(connection));
    }

    return { org, connection, sp };
  }

  async function saveSamlConnection(orgId, input, portalBase) {
    const org = await getOrgById(orgId);
    if (!org) throw new Error('Organization not found');

    const sp = computeSpUrls(portalBase, org.slug);
    const ts = nowIso();
    const existing = await getSamlConnection(orgId);

    const connection = {
      id: existing?.id || crypto.randomUUID(),
      organization_id: orgId,
      provider_name: String(input.provider_name || 'Microsoft Entra ID').trim(),
      idp_entity_id: String(input.idp_entity_id || '').trim(),
      idp_sso_url: String(input.idp_sso_url || '').trim(),
      idp_x509_cert: String(input.idp_x509_cert || '').trim(),
      sp_entity_id: sp.sp_entity_id,
      sp_acs_url: sp.sp_acs_url,
      sp_metadata_url: sp.sp_metadata_url,
      default_role: String(input.default_role || 'employee').trim(),
      active: input.active !== undefined ? !!input.active : true,
      created_at: existing?.created_at || ts,
      updated_at: ts,
    };

    await redis.set(`${SAML_ORG_PREFIX}${orgId}`, JSON.stringify(connection));
    return connection;
  }

  function sanitizeConnectionForAdmin(connection) {
    if (!connection) return null;
    const cert = connection.idp_x509_cert || '';
    const hasCert = cert.replace(/\s/g, '').length > 0;
    return {
      ...connection,
      idp_x509_cert: undefined,
      has_certificate: hasCert,
      certificate_preview: hasCert
        ? `${cert.replace(/\s+/g, '').slice(0, 24)}… (${cert.length} chars)`
        : null,
    };
  }

  async function bootstrapLegacySamlOrg(portalBase) {
    const entryPoint = process.env.SAML_ENTRY_POINT;
    const issuer = process.env.SAML_ISSUER;
    const cert = process.env.SAML_CERT;
    if (!entryPoint || !issuer || !cert) return null;

    const slug = slugify(process.env.SAML_ORG_SLUG || 'default');
    let { org, connection } = await getSamlConnectionBySlug(slug);
    if (org && connection) return { org, connection };

    const result = await saveOrganization(
      {
        name: process.env.SAML_ORG_NAME || 'Default Organization',
        slug,
        sso_enabled: true,
        saml: {
          provider_name: 'Microsoft Entra ID (legacy env)',
          idp_entity_id: issuer,
          idp_sso_url: entryPoint,
          idp_x509_cert: cert,
          default_role: 'employee',
          active: true,
        },
      },
      portalBase
    );
    return result;
  }

  return {
    slugify,
    isValidSlug,
    computeSpUrls,
    getOrgById,
    getOrgBySlug,
    listOrganizations,
    getSamlConnection,
    getSamlConnectionBySlug,
    saveOrganization,
    saveSamlConnection,
    sanitizeConnectionForAdmin,
    bootstrapLegacySamlOrg,
  };
}

module.exports = { createOrgStore };
