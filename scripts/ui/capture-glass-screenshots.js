#!/usr/bin/env node
/**
 * Capture Modern Glass / Classic 99 viewport screenshots via Playwright (npx).
 * Auth may show signed-out interstitial — still validates glass chrome + theme switcher.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// Gitignored output — do not commit screenshots (see .gitignore).
const OUT = path.join(__dirname, '..', '..', 'tmp', 'ui-glass-validation');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1536x864', width: 1536, height: 864 },
  { name: '1920x1080', width: 1920, height: 1080 },
];

async function setTheme(page, uiTheme, colorMode) {
  await page.evaluate(
    ({ uiTheme, colorMode }) => {
      localStorage.setItem('sli.uiTheme', uiTheme);
      localStorage.setItem('sli.theme', colorMode === 'dark' ? 'dark' : 'light');
      document.documentElement.setAttribute('data-ui-theme', uiTheme);
      if (colorMode === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
      else document.documentElement.removeAttribute('data-theme');
    },
    { uiTheme, colorMode }
  );
}

async function shot(page, file) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, file), fullPage: false });
  console.log('SHOT', file);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1536, height: 864 } });
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle', timeout: 60000 });

  // Force hub shell visible if signed-out interstitial blocks — toggle themes on document
  await setTheme(page, 'modern-glass', 'light');
  await page.reload({ waitUntil: 'networkidle' });
  await setTheme(page, 'modern-glass', 'light');
  await shot(page, 'dashboard-modern-light-1536.png');

  await setTheme(page, 'modern-glass', 'dark');
  await shot(page, 'dashboard-modern-dark-1536.png');

  await setTheme(page, 'classic-99', 'light');
  await shot(page, 'dashboard-classic99-1536.png');

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await setTheme(page, 'modern-glass', 'light');
    await shot(page, `modern-light-${vp.name}.png`);
    await page.evaluate(() => {
      document.body.style.zoom = '1.25';
    });
    await shot(page, `modern-light-${vp.name}-zoom125.png`);
    await page.evaluate(() => {
      document.body.style.zoom = '1';
    });
  }

  // Computed style check — glass background present
  const check = await page.evaluate(() => {
    document.documentElement.setAttribute('data-ui-theme', 'modern-glass');
    document.documentElement.removeAttribute('data-theme');
    const shell = document.querySelector('.hub-shell');
    if (!shell) return { ok: false, reason: 'no .hub-shell' };
    const cs = getComputedStyle(shell);
    return {
      ok: true,
      bg: cs.backgroundImage.slice(0, 120),
      pad: cs.padding,
      topbarBg: getComputedStyle(document.querySelector('.hub-topbar') || shell).backdropFilter,
      panelBg: getComputedStyle(document.querySelector('.hub-panel') || shell).backdropFilter,
    };
  });
  console.log('STYLE_CHECK', JSON.stringify(check, null, 2));
  fs.writeFileSync(path.join(OUT, 'style-check.json'), JSON.stringify(check, null, 2));

  await browser.close();
  console.log('OUT', OUT);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
