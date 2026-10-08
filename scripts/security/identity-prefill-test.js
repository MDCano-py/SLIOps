#!/usr/bin/env node
/**
 * Identity prefill / submitter enforcement tests (no Graph, no localStorage identity).
 * Usage: npm run security:identity-prefill-test
 */
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
let passed = 0;
let failed = 0;

function assert(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function loadHubIdentity() {
  const code = fs.readFileSync(path.join(ROOT, 'hub-identity.js'), 'utf8');
  const sandbox = {
    window: {},
    globalThis: {},
    console,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox);
  return sandbox.HubIdentity;
}

async function main() {
  console.log('=== Identity Prefill Test ===\n');

  const HubIdentity = loadHubIdentity();
  assert('HubIdentity exported', !!HubIdentity && typeof HubIdentity.normalize === 'function');

  const full = HubIdentity.normalize({
    authenticated: true,
    email: 'Alex@Streamline.com',
    displayName: 'Alex Operator',
    phone: null,
    department: null,
    jobTitle: null,
    external_id: 'oid-abc',
  });
  assert('normalizes email lowercase', full.email === 'alex@streamline.com');
  assert('uses display name', full.name === 'Alex Operator');
  assert('missing phone stays null (not invented)', full.phone === null);
  assert('missing department stays null', full.department === null);
  assert('canonical userId prefers external_id', full.userId === 'oid-abc');

  const noExt = HubIdentity.normalize({
    authenticated: true,
    email: 'bob@sliops.test',
    firstName: 'Bob',
    lastName: 'Builder',
  });
  assert('name from first+last', noExt.name === 'Bob Builder');
  assert('userId falls back to email', noExt.userId === 'bob@sliops.test');

  const empty = HubIdentity.normalize(null);
  assert('null payload unauthenticated', empty.authenticated === false && empty.email === null);

  // applyToForm with fake DOM
  const nameEl = { value: '', readOnly: false, classList: { add() {}, remove() {} }, setAttribute() {} };
  const emailEl = { value: '', readOnly: false, classList: { add() {}, remove() {} }, setAttribute() {} };
  const phoneEl = { value: '', readOnly: false, classList: { add() {}, remove() {} }, setAttribute() {} };

  HubIdentity.clearCache();
  const sandboxGlobal = { HubIdentity, _meLoad: Promise.resolve({
    authenticated: true,
    email: 'pat@sliops.test',
    displayName: 'Pat User',
    phone: null,
  }), proxyFetch: null };
  // Re-bind load to use our promise via injecting into the same module instance:
  // HubIdentity.loadIdentity uses global._meLoad — set on the vm sandbox's global.
  // Instead call normalize+manual apply path:
  const id = HubIdentity.normalize({
    authenticated: true,
    email: 'pat@sliops.test',
    displayName: 'Pat User',
    phone: null,
  });
  assert('enforceSubmitterEmail locks forged email', HubIdentity.enforceSubmitterEmail('attacker@evil.com', id) === 'pat@sliops.test');
  assert('enforceSubmitterEmail keeps session', HubIdentity.enforceSubmitterEmail('pat@sliops.test', id) === 'pat@sliops.test');

  // Static file wiring checks
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert('hub-identity.js linked', indexHtml.includes('hub-identity.js'));
  assert('parts contact-name field', indexHtml.includes('id="contact-name"'));
  assert('parts contact readonly', /id="contact"[^>]*readonly|readonly[^>]*id="contact"/.test(indexHtml) || indexHtml.includes('hub-identity-readonly'));
  assert('wo contact-name field', indexHtml.includes('id="wo-contact-name"'));
  assert('applyPortalIdentityPrefill present', indexHtml.includes('applyPortalIdentityPrefill'));
  assert(
    'no localStorage as identity source in helper',
    !/localStorage\.(get|set)Item/.test(fs.readFileSync(path.join(ROOT, 'hub-identity.js'), 'utf8'))
  );

  const meSrc = fs.readFileSync(path.join(ROOT, 'api/maintainx.js'), 'utf8');
  assert('/me exposes external_id when present', meSrc.includes('external_id: userRecord.external_id'));
  assert('/me does not invent phone', /phone:\s*userRecord\.phone/.test(meSrc));

  // Duplicate User Management header removed
  assert(
    'hubPageUsers has no duplicate hub-page-head',
    !/id="hubPageUsers"[\s\S]{0,400}hub-page-head[\s\S]{0,200}User Management/.test(indexHtml)
  );

  // Layout: scrollable nav
  const hubCss = fs.readFileSync(path.join(ROOT, 'hub.css'), 'utf8');
  assert('hub-nav independently scrollable', /\.hub-nav\s*\{[^}]*overflow-y:\s*auto/s.test(hubCss));
  assert('sidebar min-height 0', /\.hub-sidebar\s*\{[^}]*min-height:\s*0/s.test(hubCss));

  const themes = fs.readFileSync(path.join(ROOT, 'hub-themes.css'), 'utf8');
  assert('modern glass uses 100dvh', themes.includes('100dvh'));

  console.log(`\n=== Summary ===\nChecks: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
