#!/usr/bin/env node
/**
 * Static validation that Modern Glass materials are present and Classic 99 intact.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const css = fs.readFileSync(path.join(ROOT, 'hub-themes.css'), 'utf8');
let pass = 0;
let fail = 0;
function assert(name, cond) {
  if (cond) {
    pass += 1;
    console.log('PASS  ' + name);
  } else {
    fail += 1;
    console.error('FAIL  ' + name);
  }
}

assert('atmospheric glass-background token', css.includes('--glass-background:'));
assert('example radial green diffusion', css.includes('rgba(41, 135, 113, 0.18)'));
assert('glass-surface utility', css.includes('.glass-surface'));
assert('backdrop blur+saturate shell', css.includes('--glass-blur-shell'));
assert('level tokens: overlay blur', css.includes('--glass-blur-overlay'));
assert('floating sidebar shadow', css.includes('--glass-shadow-shell'));
assert('panel glass material', css.includes('.hub-panel') && css.includes('var(--glass-blur-panel)'));
assert('KPI glass elevation', css.includes('.hub-kpi') && css.includes('blur(16px) saturate(140%)'));
assert('dense tables opaque', css.includes('--glass-dense'));
assert('dark mode distinct tokens', css.includes('html[data-ui-theme="modern-glass"][data-theme="dark"]'));
assert('dark panel separation shadows', css.includes('--glass-shadow-panel') && css.includes('rgba(0, 0, 0, 0.38)'));
assert('overlay menus glass', css.includes('.hub-account-menu') && css.includes('--glass-modal-blur'));
assert('modal glass surface', css.includes('.sl-modal') && css.includes('--glass-modal-surface'));
assert('modal backdrop blur', css.includes('.sl-modal-overlay') && css.includes('--glass-backdrop-blur'));
assert('tmpl + legacy modals glass', css.includes('.tmpl-modal') && css.includes('.modal-backdrop'));
assert('solid modal inputs', css.includes('--glass-modal-input') && css.includes('.sl-modal .input'));
assert('modal action Streamline green', css.includes('.sl-modal-actions .primary') && css.includes('var(--sli-green'));
assert('classic-99 preserved', css.includes('data-ui-theme="classic-99"') && css.includes('#008080'));
assert('classic beveled panels', css.includes('border-color: #fff #404040 #404040 #fff'));
assert('classic modals not glass', css.includes('classic-99"] .sl-modal') && css.includes('backdrop-filter: none'));
assert('nav scroll not removed', fs.readFileSync(path.join(ROOT, 'hub.css'), 'utf8').includes('overflow-y: auto'));

console.log(`\nSummary: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
