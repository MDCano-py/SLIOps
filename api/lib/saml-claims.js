// Shared SAML claim extraction for Entra ID / Microsoft Entra.

function firstClaim(profile, keys) {
  if (!profile || typeof profile !== 'object') return null;
  for (const key of keys) {
    const val = profile[key];
    if (val === undefined || val === null || val === '') continue;
    if (Array.isArray(val)) {
      const item = val.find((v) => v !== undefined && v !== null && v !== '');
      if (item !== undefined) return item;
      continue;
    }
    return val;
  }
  return null;
}

function normalizeGroups(raw) {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((g) => String(g)).filter(Boolean);
}

const EMAIL_KEYS = [
  'email',
  'mail',
  'user.mail',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn',
];

const NAME_KEYS = [
  'name',
  'displayName',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
];

const FIRST_NAME_KEYS = [
  'firstName',
  'givenName',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
];

const LAST_NAME_KEYS = [
  'lastName',
  'surname',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
];

const GROUP_KEYS = [
  'groups',
  'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups',
];

function extractIdentityFromSamlProfile(profile) {
  const emailRaw = firstClaim(profile, EMAIL_KEYS);
  const email = emailRaw ? String(emailRaw).toLowerCase().trim() : null;

  const displayNameRaw = firstClaim(profile, NAME_KEYS);
  const firstName = firstClaim(profile, FIRST_NAME_KEYS);
  const lastName = firstClaim(profile, LAST_NAME_KEYS);
  const groups = normalizeGroups(firstClaim(profile, GROUP_KEYS));
  const nameID = profile?.nameID ? String(profile.nameID) : null;

  if (!email) {
    throw new Error('SAML response did not contain an email claim');
  }

  return {
    email,
    firstName: firstName ? String(firstName) : null,
    lastName: lastName ? String(lastName) : null,
    displayName: displayNameRaw ? String(displayNameRaw) : null,
    groups,
    external_id: nameID,
    nameID,
    raw: profile,
  };
}

module.exports = {
  extractIdentityFromSamlProfile,
  EMAIL_KEYS,
  NAME_KEYS,
  GROUP_KEYS,
};
