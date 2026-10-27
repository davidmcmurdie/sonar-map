// Renders preview.html headless with two of Dave's files loaded through the real file input.
// node test/screenshot.js
const { chromium } = require('playwright');
const path = require('path');
const ATT = process.env.SVM_ATTACH_DIR || '';
const files = ['e3eccba593f98ac6a9d04b5afd3985677d9df66796964fb46266c79d8a410c14.json',
  '205d627866a76a8bea6272fb77f292c4e8f553b24193259dc3298e8400ea2023.json'].map((f) => path.join(ATT, f));
const out = path.join(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];
  async function page(viewport) {
    const p = await browser.newPage({ viewport });
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await p.goto('file://' + path.join(out, 'preview.html'));
    await p.waitForFunction(() => window.__svmApp);
    await p.setInputFiles('#svm-root input[type=file]', files);
    await p.waitForFunction(() => window.__svmApp.sessions().length === 2);
    await p.waitForTimeout(2500); // tiles
    return p;
  }
  const p = await page({ width: 1366, height: 900 });
  await p.screenshot({ path: path.join(out, 'preview.png'), fullPage: true });
  // swath + rejected on, info popup on a leg start marker
  await p.check('#svm-root [data-opt=swath]');
  await p.check('#svm-root [data-opt=rejected]');
  await p.waitForTimeout(800);
  const start = await p.$$('#svm-root path.leaflet-interactive[fill="#00c853"]');
  if (start.length) await start[0].click({ force: true });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(out, 'preview-swath.png'), fullPage: true });
  const panel = await p.$eval('#svm-root .svm-list', (e) => e.innerText);
  const m = await page({ width: 390, height: 844 });
  await m.screenshot({ path: path.join(out, 'preview-mobile.png'), fullPage: true });
  console.log(panel);
  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close();
})();
