// Runs the real Squarespace snippet in headless Chrome against a stub google.maps
// (no key, no network) to check the bootstrap + Google adapter wiring.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ATT = process.env.SVM_ATTACH_DIR || '';
// Uses two real exported sessions when SVM_ATTACH_DIR has them, otherwise the two bundled fixtures.
const real = ['e3eccba593f98ac6a9d04b5afd3985677d9df66796964fb46266c79d8a410c14.json', '9da2bf52d09236bc6d5b02416da37b66734b850e2942fec07f32623a7a80d76d.json'].map((f) => path.join(ATT, f));
const files = real.every((f) => fs.existsSync(f)) ? real : ['old_format_sonar.json', 'very_old_no_time.json'].map((f) => path.join(__dirname, 'fixtures', f));
const stub = `<script>
window.__calls = {Polyline:0, Polygon:0, Marker:0, fit:0, removed:0};
function Obj(kind){ return function(o){ window.__calls[kind]++; this.o=o; this.setMap=function(m){ if(!m) window.__calls.removed++; }; this.addListener=function(){}; }; }
window.google = { maps: {
  importLibrary: function(){ return Promise.resolve({}); },
  Map: function(){ this.fitBounds=function(b){ window.__calls.fit++; window.__lastBounds=b; }; },
  InfoWindow: function(){ this.setContent=function(){}; this.setPosition=function(){}; this.open=function(){}; },
  Polyline: Obj('Polyline'), Polygon: Obj('Polygon'), Marker: Obj('Marker'),
  SymbolPath: { CIRCLE: 0 } } };
</script>`;
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];
  async function run(key) {
    const p = await browser.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.route('**/*', (r) => r.abort());
    let snip = fs.readFileSync(path.join(__dirname, '..', 'sonar-map-viewer.html'), 'utf8');
    if (key) snip = snip.replace("'YOUR_API_KEY'; //", "'" + key + "'; //");
    await p.setContent('<html><body>' + (key ? stub : '') + snip + '</body></html>');
    return p;
  }
  const noKey = await run(null);
  console.log('no key message:', await noKey.$eval('#svm-root .svm-map', (e) => e.innerText));
  const p = await run('TESTKEY');
  await p.setInputFiles('#svm-root input[type=file]', files);
  await p.waitForFunction(() => document.querySelectorAll('#svm-root .svm-item').length === 2);
  console.log('after load:', JSON.stringify(await p.evaluate(() => window.__calls)));
  await p.check('#svm-root [data-opt=swath]');
  console.log('after swath on:', JSON.stringify(await p.evaluate(() => window.__calls)));
  await p.click('#svm-root [data-act=clear]');
  console.log('after clear:', JSON.stringify(await p.evaluate(() => window.__calls)), 'items:', await p.$$eval('#svm-root .svm-item', (e) => e.length));
  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
