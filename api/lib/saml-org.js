// Per-organization SAML 2.0 Service Provider (@node-saml/node-saml).

const { SAML } = require('@node-saml/node-saml');
const { extractIdentityFromSamlProfile } = require('./saml-claims.js');

function normalizeCertPEM(certRaw) {
  if (!certRaw || !String(certRaw).trim()) {
    throw new Error('IdP X.509 certificate is required');
  }
  const certBody = String(certRaw)
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
  if (!certBody) throw new Error('IdP X.509 certificate is empty');
  return `-----BEGIN CERTIFICATE-----\n${certBody.match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----`;
}

function validateConnectionConfig(connection) {
  const missing = [];
  if (!connection?.idp_sso_url) missing.push('idp_sso_url');
  if (!connection?.idp_entity_id) missing.push('idp_entity_id');
  if (!connection?.idp_x509_cert) missing.push('idp_x509_cert');
  if (!connection?.sp_entity_id) missing.push('sp_entity_id');
  if (!connection?.sp_acs_url) missing.push('sp_acs_url');
  if (missing.length) {
    throw new Error(`SAML connection incomplete — missing: ${missing.join(', ')}`);
  }
}

function buildSamlInstance(connection) {
  validateConnectionConfig(connection);
  const certPem = normalizeCertPEM(connection.idp_x509_cert);

  return new SAML({
    entryPoint: connection.idp_sso_url,
    issuer: connection.sp_entity_id,
    callbackUrl: connection.sp_acs_url,
    idpIssuer: connection.idp_entity_id,
    idpCert: certPem,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    signatureAlgorithm: 'sha256',
    digestAlgorithm: 'sha256',
    identifierFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
    disableRequestedAuthnContext: true,
    authnRequestBinding: 'HTTP-Redirect',
  });
}

async function getOrgLoginUrl(connection, relayState) {
  const saml = buildSamlInstance(connection);
  return saml.getAuthorizeUrlAsync(relayState || '', undefined, {});
}

async function validateOrgResponse(connection, samlResponseB64) {
  const saml = buildSamlInstance(connection);
  const result = await saml.validatePostResponseAsync({
    SAMLResponse: samlResponseB64,
  });
  const profile = result.profile || {};
  return extractIdentityFromSamlProfile(profile);
}

function getOrgServiceProviderMetadata(connection) {
  const saml = buildSamlInstance(connection);
  return saml.generateServiceProviderMetadata(null, null);
}

function testConnectionConfig(connection) {
  validateConnectionConfig(connection);
  normalizeCertPEM(connection.idp_x509_cert);
  const url = new URL(connection.idp_sso_url);
  if (url.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
    throw new Error('IdP SSO URL must use HTTPS in production');
  }
  buildSamlInstance(connection);
  return {
    ok: true,
    idp_host: url.host,
    sp_entity_id: connection.sp_entity_id,
    sp_acs_url: connection.sp_acs_url,
  };
}

module.exports = {
  normalizeCertPEM,
  buildSamlInstance,
  getOrgLoginUrl,
  validateOrgResponse,
  getOrgServiceProviderMetadata,
  testConnectionConfig,
};
