#!/usr/bin/env node
/**
 * WOS-89 — Staging launch / Cyber handoff readiness checks (NOT a penetration test).
 *
 * Validates that handoff docs, deploy templates, seed catalog, and critical
 * staging gates exist in the repository. Live EC2 verification is documented
 * separately for operators.
 *
 * Usage: npm run security:staging-launch-readiness-test
 */
const path = require('path');
const fs = require('fs');

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

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function main() {
  console.log('=== WOS-89 Staging Launch Readiness (pre-handoff checks — not a pentest) ===\n');

  // --- Deliverable docs ---
  assert(
    'WOS-89 report exists',
    exists('docs/reports/WOS_89_STAGING_LAUNCH_CYBER_HANDOFF_READINESS_REPORT.md')
  );
  assert(
    'Cyber handoff package exists',
    exists('docs/cyber/CYBER_PENTEST_HANDOFF.md')
  );
  assert(
    'Operational acceptance checklist exists',
    exists('docs/cyber/OPERATIONAL_ACCEPTANCE_CHECKLIST.md')
  );
  assert(
    'Role test matrix exists',
    exists('docs/cyber/ROLE_TEST_MATRIX.md')
  );
  assert(
    'S3 deferred checklist exists',
    exists('docs/cyber/S3_DEFERRED_CHECKLIST.md')
  );

  // --- Deploy templates ---
  assert('PM2 ecosystem present', exists('deploy/ecosystem.config.cjs'));
  assert('Nginx staging sample present', exists('deploy/nginx/ops-hub-staging.conf'));
  assert('systemd unit present', exists('deploy/ops-hub-staging.service'));
  assert('.env.staging.example present', exists('.env.staging.example'));

  const eco = read('deploy/ecosystem.config.cjs');
  assert('PM2 app name ops-hub-staging', /name:\s*'ops-hub-staging'/.test(eco));
  assert('PM2 worker name ops-hub-staging-worker', /ops-hub-staging-worker/.test(eco));
  assert('PM2 NODE_ENV staging', /NODE_ENV:\s*'staging'/.test(eco));

  const nginx = read('deploy/nginx/ops-hub-staging.conf');
  assert('Nginx path /ops-hub-staging/', /location \/ops-hub-staging\//.test(nginx));
  assert('Nginx proxies to 127.0.0.1:3010', /127\.0\.0\.1:3010/.test(nginx));

  const envEx = read('.env.staging.example');
  assert('staging example PORTAL_BASE_URL', /PORTAL_BASE_URL=https:\/\/automation\.streamlinescada\.com\/ops-hub-staging\//.test(envEx));
  assert('staging example ALLOWED_ORIGIN exact', /ALLOWED_ORIGIN=https:\/\/automation\.streamlinescada\.com/.test(envEx));
  assert('staging example HUB_STORE_MODE postgres', /HUB_STORE_MODE=postgres/.test(envEx));
  assert('staging example S3_BUCKET placeholder', /S3_BUCKET=/.test(envEx));
  assert('staging example no BLOB_READ_WRITE_TOKEN', !/BLOB_READ_WRITE_TOKEN/.test(envEx));
  assert('staging example STAGING_DEMO_DATA_ENABLED=0', /STAGING_DEMO_DATA_ENABLED=0/.test(envEx));
  assert('staging example MaintainX placeholder', /MAINTAINX_API_KEY=/.test(envEx));

  // --- Seed catalog ---
  const users = require(path.join(ROOT, 'api/lib/staging-test-users.js'));
  assert('eight staging test users', users.STAGING_TEST_USERS.length === 8);
  const keys = users.STAGING_TEST_USERS.map((u) => u.key).sort();
  assert(
    'expected persona keys',
    keys.join(',') ===
      [
        'accounting',
        'client_representative',
        'external_vendor',
        'field_supervisor',
        'field_technician',
        'hr_manager',
        'hub_admin',
        'operations_manager',
      ].sort().join(',')
  );
  assert(
    'all emails use staging-test domain',
    users.STAGING_TEST_USERS.every((u) => u.email.endsWith('@staging-test.streamlinecorp.com'))
  );
  assert('migration 012 present', exists('migrations/012_staging_test_users.sql'));
  assert('seed script present', exists('scripts/db/seed-staging-test-users.js'));

  // --- UI polish gates ---
  const indexHtml = read('index.html');
  const hubJs = read('hub.js');
  assert('PSSR not in Management menu', !/data-mgmt-section="pssr"/.test(indexHtml));
  assert('SSO banner not shown for authenticated sessions', /ssoBanner\.style\.display = 'none'/.test(indexHtml));
  assert('portalSignOut shared', /window\.portalSignOut/.test(indexHtml));
  assert('hub account sign-out present', /hubAccountSignOut/.test(indexHtml) || /hubAccountSignOut/.test(hubJs));
  assert('no fake ⌘K affordance', !/<kbd>⌘K<\/kbd>/.test(indexHtml));
  assert('demoSeedEnabled default false', /demoSeedEnabled:\s*false/.test(read('api/lib/hub/portal-settings.js')));

  // --- Architecture docs ---
  const depStg = read('DEPLOYMENT_STAGING.md');
  assert('DEPLOYMENT_STAGING mentions Amazon S3', /Amazon S3/.test(depStg));
  assert('DEPLOYMENT_STAGING no Vercel Blob architecture line', !/Vercel Blob \(vendor docs\)/.test(depStg));

  // --- Package scripts ---
  const pkg = JSON.parse(read('package.json'));
  assert('seed-staging-test-users script', !!pkg.scripts['db:seed-staging-test-users']);
  assert('db:migrate script', !!pkg.scripts['db:migrate']);
  assert('object-storage readiness script', !!pkg.scripts['security:object-storage-test']);

  // --- Explicit: this suite is not a pentest ---
  const thisFile = read('scripts/security/staging-launch-readiness-test.js');
  assert('suite labels itself not a pentest', /not a penetration test/i.test(thisFile));

  console.log('\n=== Summary ===');
  console.log(`Checks: ${passed} passed, ${failed} failed`);
  console.log('NOTE: These are repository pre-handoff readiness checks, not a penetration test.');
  if (failed) {
    console.error('RESULT: FAIL');
    process.exit(1);
  }
  console.log('RESULT: PASS');
}

main();
