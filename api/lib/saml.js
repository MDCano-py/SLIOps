// lib/saml.js — SAML 2.0 service provider helpers
//
// Implements the bare minimum SAML SP flow needed for Entra ID:
//   1. Build a SAML AuthnRequest, redirect the user to Entra's login URL
//      with the request as a base64-deflated query param
//   2. Receive Entra's POST-back to /api/auth/acs with a base64 SAMLResponse
//      containing a signed assertion with the user's email + name claims
//   3. Validate the response signature against the IdP cert + extract claims
//   4. Generate SP metadata XML for IT to import (so they don't have to
//      paste fields by hand)
//
// We use the @node-saml/node-saml library — the maintained fork of the
// well-known passport-saml core, without the passport framework wrapper.
// It handles the signature verification (the part with real security
// stakes) and the XML wrangling. We just orchestrate the flow.
//
// Required env vars at runtime:
//   SAML_ENTRY_POINT           Login URL from Entra (https://login.microsoftonline.com/...)
//   SAML_ISSUER                Microsoft Entra Identifier from Entra (https://sts.windows.net/...)
//   SAML_CERT                  Base64 IdP signing certificate (the .cer contents, line breaks OK)
//   SAML_SP_ENTITY_ID          Our service-provider identifier (https://sliops.com/saml/metadata)
//   SAML_SP_ACS_URL            ACS callback URL (https://sliops.com/api/auth/acs)
//   SAML_LOGOUT_URL            (optional) IdP single-logout endpoint
//
// The cert in env vars must be the BODY of the .cer file — between
// -----BEGIN CERTIFICATE----- and -----END CERTIFICATE----- — without
// the begin/end markers. Newlines are tolerated; we strip them on load.

const { SAML } = require('@node-saml/node-saml');
const { extractIdentityFromSamlProfile } = require('./saml-claims.js');
const { normalizeCertPEM } = require('./saml-org.js');

let _samlInstance = null;

function buildSamlInstance() {
  const entryPoint = process.env.SAML_ENTRY_POINT;
  const issuer     = process.env.SAML_ISSUER;
  const certRaw    = process.env.SAML_CERT;
  const spEntityId = process.env.SAML_SP_ENTITY_ID;
  const acsUrl     = process.env.SAML_SP_ACS_URL;
  const logoutUrl  = process.env.SAML_LOGOUT_URL || undefined;

  const missing = [];
  if (!entryPoint) missing.push('SAML_ENTRY_POINT');
  if (!issuer)     missing.push('SAML_ISSUER');
  if (!certRaw)    missing.push('SAML_CERT');
  if (!spEntityId) missing.push('SAML_SP_ENTITY_ID');
  if (!acsUrl)     missing.push('SAML_SP_ACS_URL');
  if (missing.length) {
    throw new Error(`SAML config incomplete — missing env vars: ${missing.join(', ')}`);
  }

  const certPem = normalizeCertPEM(certRaw);

  return new SAML({
    entryPoint,
    issuer: spEntityId,           // SP entity ID — what we identify ourselves as
    callbackUrl: acsUrl,
    idpIssuer: issuer,            // IdP entity ID — what we expect Entra to identify as
    idpCert: certPem,
    logoutUrl,
    // Security defaults — keep these strict
    wantAssertionsSigned: true,
    // Entra signs the assertion but not the outer Response wrapper by default.
    // node-saml v5+ defaults wantAuthnResponseSigned to true, which would
    // reject Entra's perfectly valid responses. Explicitly relax this to
    // accept assertion-only signing. The assertion is still cryptographically
    // verified — we just don't require the outer envelope to be signed too.
    wantAuthnResponseSigned: false,
    signatureAlgorithm: 'sha256',
    digestAlgorithm: 'sha256',
    // Entra always sends Persistent NameID for SSO, regardless of what we
    // request — so just match that to avoid format-mismatch errors
    identifierFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
    // Disable inbound RelayState requirement; we use our own state cookie
    disableRequestedAuthnContext: true,
    // The library logs a deprecation warning if this isn't set. Disable
    // signing of our outbound AuthnRequest (Entra doesn't require it for
    // standard SP-initiated SSO).
    authnRequestBinding: 'HTTP-Redirect',
  });
}

function getSaml() {
  if (!_samlInstance) _samlInstance = buildSamlInstance();
  return _samlInstance;
}

// Build the redirect URL to send the user to for IdP login. The library
// returns a fully-formed URL with the AuthnRequest base64-deflate-encoded
// as a query param — we just need to redirect to it.
async function getLoginUrl(relayState) {
  const saml = getSaml();
  return saml.getAuthorizeUrlAsync(relayState || '', undefined, {});
}

// Validate the POSTed SAMLResponse and extract the user's identity claims.
// Returns { email, firstName, lastName, raw } on success.
// Throws on invalid signature, expired assertion, wrong audience, etc.
async function validateResponse(samlResponseB64) {
  const saml = getSaml();
  // The library's validatePostResponseAsync expects an object with the
  // POSTed body params. Mock it minimally — we only have SAMLResponse.
  const result = await saml.validatePostResponseAsync({
    SAMLResponse: samlResponseB64,
  });
  // result.profile contains the user's claims. Entra sends them with the
  // claim names we mapped in IT's setup ('email', 'firstName', 'lastName')
  // — but the library may also expose them under their full URI namespace
  // depending on the IdP's response format. Try both.
  return extractIdentityFromSamlProfile(result.profile || {});
}

// Build SP metadata XML. IT can import this in Entra to auto-fill the
// Identifier, ACS URL, and Sign-on URL fields — saves them clicking through.
function getServiceProviderMetadata() {
  const saml = getSaml();
  return saml.generateServiceProviderMetadata(null, null);
}

// Build the IdP-initiated logout URL, if SAML_LOGOUT_URL is configured.
// Returns the URL to redirect to after clearing the local session.
async function getLogoutUrl(email) {
  const saml = getSaml();
  if (!process.env.SAML_LOGOUT_URL) return null;
  try {
    return saml.getLogoutUrlAsync(
      { nameID: email, nameIDFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent' },
      ''
    );
  } catch (e) {
    // Don't fail logout because IdP SLO failed — local session is already
    // cleared, that's the important part.
    console.error('SAML logout URL generation failed:', e.message);
    return null;
  }
}

module.exports = {
  getLoginUrl,
  validateResponse,
  getServiceProviderMetadata,
  getLogoutUrl,
};
