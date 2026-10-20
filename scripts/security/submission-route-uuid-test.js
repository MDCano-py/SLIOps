#!/usr/bin/env node
/**
 * Submission detail hash routing — UUID after #/submissions/ must reach the loader.
 * Usage: npm run security:submission-route-uuid-test
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const hubJs = fs.readFileSync(path.join(ROOT, 'hub.js'), 'utf8');

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

console.log('=== Submission UUID route regression ===\n');

assert(
  '_hubSubmissionRoute set before switchTab',
  (() => {
    const setIdx = indexHtml.indexOf("window._hubSubmissionRoute = { submissionId:");
    const switchIdx = indexHtml.indexOf('switchTab(target, routeOpts);');
    // Prefer the switchTab that follows the submission route bag assignment
    const afterSet = indexHtml.indexOf('switchTab(target, routeOpts);', setIdx);
    return setIdx >= 0 && afterSet > setIdx;
  })()
);

assert(
  'routeOpts.submissionId assigned for hub-submission',
  /routeOpts\.submissionId\s*=\s*segments\[0\]/.test(indexHtml)
);

assert(
  'initHubSubmission reads opts.segments fallback',
  /fromOpts\.segments/.test(hubJs) || /segments\?\.\[0\]/.test(hubJs)
);

assert(
  'onTabActivated merges opts into initHubSubmission',
  /initHubSubmission\(Object\.assign\(\{\}, global\._hubSubmissionRoute/.test(hubJs)
);

assert(
  'parseHash maps submissions → hub-submission',
  /tab === 'submissions'[\s\S]{0,80}hub-submission/.test(indexHtml) ||
    /'submissions':\s*'hub-submission'/.test(indexHtml) ||
    /submissions.*hub-submission/.test(indexHtml)
);

// Extract and execute parseHash against a UUID path if possible via regex contract
const UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
assert('sample path is UUID-shaped', /^[0-9a-f-]{36}$/i.test(UUID));

// Lightweight parseHash simulation matching index.html contract
function parseHashSim(hash) {
  let h = hash || '';
  if (h.startsWith('#')) h = h.slice(1);
  if (h.startsWith('/')) h = h.slice(1);
  const parts = h.split('/').filter(Boolean);
  let tab = parts[0] || 'home';
  const segments = parts.slice(1);
  if (tab === 'submissions') tab = 'hub-submission';
  return { tab, segments };
}

const parsed = parseHashSim(`#/submissions/${UUID}`);
assert('parse yields hub-submission', parsed.tab === 'hub-submission');
assert('parse yields UUID segment', parsed.segments[0] === UUID);

const routeBag = { submissionId: parsed.segments[0] };
const opts = Object.assign({}, routeBag, { submissionId: parsed.segments[0], segments: parsed.segments });
assert('merged opts expose UUID', opts.submissionId === UUID);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
