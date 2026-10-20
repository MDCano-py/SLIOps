#!/usr/bin/env node
/**
 * Print whether vendor OTP email settings are present. Never prints secret values.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const files = ['.env.local.postgres', '.env.local', '.env.staging', '.env'];
const keys = ['EMAIL_NOTIFICATIONS_ENABLED', 'EMAIL_FROM', 'VENDOR_NOTIFY_FROM', 'RESEND_API_KEY', 'TRUST_FORWARDED_CLIENT_IP', 'NODE_ENV'];

for (const file of files) {
  const full = path.join(process.cwd(), file);
  if (!fs.existsSync(full)) {
    console.log(`${file}: absent`);
    continue;
  }
  const found = {};
  for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!keys.includes(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key === 'RESEND_API_KEY') found[key] = value ? `set length=${value.length}` : 'empty';
    else found[key] = value || 'empty';
  }
  const summary = keys.map((key) => `${key}=${found[key] || 'unset'}`).join(' ');
  console.log(`${file}: ${summary}`);
}
