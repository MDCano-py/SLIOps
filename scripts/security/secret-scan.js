#!/usr/bin/env node
/**
 * WOS-79 — Safe repository secret scan.
 * Usage: npm run security:secret-scan
 *
 * Read-only. Scans first-party source for high-confidence hardcoded secrets and
 * verifies that .env* files (other than *.example templates) are covered by
 * .gitignore. NEVER prints matched secret values — only file, line, and the
 * rule name. Exits non-zero when a high-confidence secret or an un-ignored
 * credential file is found so it can gate CI.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.idea',
  '.vscode',
  'dist',
  'build',
  'coverage',
]);

const IGNORE_FILE_SUFFIXES = ['.min.js', '.map', '.lock'];

const SCAN_EXTENSIONS = new Set([
  '.js', '.cjs', '.mjs', '.ts', '.jsx', '.tsx',
  '.html', '.css', '.json', '.md', '.sh', '.yml', '.yaml',
]);

// A local or example host in a connection string is a documentation
// placeholder, not a real credential leak.
const EXAMPLE_HOST = /@(?:localhost|127\.0\.0\.1|(?:[a-z0-9-]+\.)*example\.(?:com|org|net)|your-[a-z0-9-]+|host)\b/i;

// High-confidence rules — a match fails the scan. `skipIf` lets a rule ignore
// obvious placeholders without weakening detection of real secrets.
const HIGH_CONFIDENCE_RULES = [
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: 'Resend API key', re: /\bre_[A-Za-z0-9]{20,}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  {
    name: 'Credentialed connection string (user:pass@host)',
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|rediss?):\/\/[^\s'":/@]+:[^\s'":/@]+@[^\s'"/]+/i,
    skipIf: (line) => isPlaceholderLine(line) || EXAMPLE_HOST.test(line),
  },
];

// Lower-confidence rules — reported as warnings only (do not fail).
const WARN_RULES = [
  {
    name: 'Possible hardcoded secret assignment',
    re: /\b(SESSION_SECRET|CLIENT_SECRET|ENTRA_CLIENT_SECRET|RESEND_API_KEY|BLOB_READ_WRITE_TOKEN|UPSTASH_REDIS_REST_TOKEN|AWS_SECRET_ACCESS_KEY)\b\s*[:=]\s*['"][^'"\n]{8,}['"]/,
  },
];

// Values that clearly indicate a placeholder/template rather than a real secret.
const PLACEHOLDER_HINT = /(YOUR_|EXAMPLE|CHANGE_?ME|PLACEHOLDER|xxxx|<[^>]+>|\.\.\.|process\.env)/i;

function isPlaceholderLine(line) {
  return PLACEHOLDER_HINT.test(line);
}

let failed = 0;
let warned = 0;
const findings = [];

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.git')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      walk(full);
    } else if (entry.isFile()) {
      scanFile(full);
    }
  }
}

function scanFile(file) {
  const base = path.basename(file);
  if (IGNORE_FILE_SUFFIXES.some((s) => base.endsWith(s))) return;
  const ext = path.extname(file).toLowerCase();
  // Skip .env* files here — they are validated separately by env coverage check.
  if (base === '.env' || base.startsWith('.env.')) return;
  if (!SCAN_EXTENSIONS.has(ext)) return;

  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  if (text.length > 3 * 1024 * 1024) return; // skip very large generated files
  const rel = path.relative(ROOT, file);
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const rule of HIGH_CONFIDENCE_RULES) {
      if (rule.re.test(line)) {
        if (rule.skipIf && rule.skipIf(line)) continue;
        failed += 1;
        findings.push({ level: 'FAIL', rule: rule.name, file: rel, line: i + 1 });
      }
    }
    for (const rule of WARN_RULES) {
      if (rule.re.test(line) && !isPlaceholderLine(line)) {
        warned += 1;
        findings.push({ level: 'WARN', rule: rule.name, file: rel, line: i + 1 });
      }
    }
  });
}

function loadGitignorePatterns() {
  const gi = path.join(ROOT, '.gitignore');
  if (!fs.existsSync(gi)) return [];
  return fs
    .readFileSync(gi, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

// Very small matcher covering the patterns we actually use: exact names and the
// `.env.*` glob, plus negations (!*.example).
function isIgnoredByGitignore(name, patterns) {
  let ignored = false;
  for (const pat of patterns) {
    const neg = pat.startsWith('!');
    const body = neg ? pat.slice(1) : pat;
    if (matchGlob(body, name)) ignored = !neg;
  }
  return ignored;
}

function matchGlob(pattern, name) {
  if (pattern === name) return true;
  const re = new RegExp(
    '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
  );
  return re.test(name);
}

function checkEnvCoverage() {
  const patterns = loadGitignorePatterns();
  const entries = fs.readdirSync(ROOT, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (name !== '.env' && !name.startsWith('.env.')) continue;
    const isExample = name.endsWith('.example');
    if (isExample) continue; // templates are meant to be committed
    const ignored = isIgnoredByGitignore(name, patterns);
    if (!ignored) {
      failed += 1;
      findings.push({
        level: 'FAIL',
        rule: 'Credential file not covered by .gitignore',
        file: name,
        line: 0,
      });
    } else {
      findings.push({ level: 'OK', rule: '.env file gitignored', file: name, line: 0 });
    }
  }
}

function main() {
  console.log('=== WOS-79 Secret Scan (safe — values never printed) ===\n');
  walk(ROOT);
  checkEnvCoverage();

  for (const f of findings) {
    const loc = f.line ? `${f.file}:${f.line}` : f.file;
    console.log(`${f.level.padEnd(4)}  ${f.rule} — ${loc}`);
  }

  console.log('\n=== Summary ===');
  console.log(`High-confidence secrets: ${failed}`);
  console.log(`Warnings: ${warned}`);
  if (failed) {
    console.error('RESULT: FAIL — review the findings above (no values printed).');
    process.exit(1);
  }
  console.log('RESULT: PASS — no high-confidence hardcoded secrets or un-ignored credential files.');
}

main();
