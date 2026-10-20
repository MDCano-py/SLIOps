#!/usr/bin/env node
/**
 * Print DATABASE_URL hostnames from local env files. Never prints credentials.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const files = ['.env.local.postgres', '.env.local', '.env.staging', '.env'];
for (const file of files) {
  const full = path.join(process.cwd(), file);
  if (!fs.existsSync(full)) {
    console.log(`${file}: absent`);
    continue;
  }
  let host = '';
  for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('DATABASE_URL=')) continue;
    let value = trimmed.slice('DATABASE_URL='.length).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    try {
      host = new URL(value).hostname;
    } catch {
      host = 'unparsed';
    }
  }
  console.log(`${file}: ${host || 'no DATABASE_URL'}`);
}
