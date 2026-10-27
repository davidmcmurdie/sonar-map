// Runs the built index.html (GitHub Pages page) in headless Chrome against a stub google.maps
// (no key, no network): checks the placeholder notice and the bootstrap + adapter wiring.
// node test/index-mock-google.js
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const fixture = path.join(__dirname, 'fixtures', 'old_format_sonar.json');
const stub = `<script>
window.__calls = {Polyline:0, Polygon:0, Marker:0, fit:0, removed:0};
function Obj(kind){ return function(o){ window.__calls[kind]++; this.o=o; this.setMap=function(m){ if(!m) window.__calls.removed++; }; this.addListener=function(){}; }; }
window.google = { maps: {
  importLibrary: function(){ return Promise.resolve({}); },
  Map: function(){ this.fitBounds=function(b){ window.__calls.fit++; }; },
  InfoWindow: function(){ this.setContent=function(){}; this.setPosition=function(){}; this.open=function(){}; },
  Polyline: Obj('Polyline'), Polygon: Obj('Polygon'), Marker: Obj('Marker'),
  SymbolPath: { CIRCLE: 0 } } };
</script>`;
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];
  let ok = true;
  async function run(key, viewport) {
    const p = await browser.newPage({ viewport: viewport || { width: 1280, height: 800 } });
    p.on('pageerror', (e) => errors.push(e.message));
    await p.route('**/*', (r) => r.abort());
    let html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    if (key) html = html.replace("window.SVM_GOOGLE_MAPS_API_KEY = 'YOUR_API_KEY';", "window.SVM_GOOGLE_MAPS_API_KEY = '" + key + "';").replace('<head>', '<head>' + stub);
    await p.setContent(html);
    return p;
  }
  const noKey = await run(null);
  const notice = await noKey.$eval('#svm-root .svm-map', (e) => e.innerText);
  console.log('no key notice:', JSON.stringify(notice));
  ok = ok && /not set up yet/.test(notice);
  const editHref = await noKey.$eval('#svm-root .svm-map a', (e) => e.href);
  console.log('edit link:', editHref);
  const mapBox = await noKey.$eval('#svm-root .svm-map', (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  console.log('map box at 1280x800:', mapBox);
  const p = await run('TESTKEY');
  await p.setInputFiles('#svm-root input[type=file]', [fixture]);
  await p.waitForFunction(() => document.querySelectorAll('#svm-root .svm-item').length === 1);
  const calls = await p.evaluate(() => window.__calls);
  console.log('after load:', JSON.stringify(calls));
  ok = ok && calls.Polyline > 0 && calls.fit > 0;
  await p.click('#svm-root [data-act=clear]');
  const items = await p.$$eval('#svm-root .svm-item', (e) => e.length);
  console.log('after clear items:', items);
  ok = ok && items === 0;
  console.log('page errors:', errors.length ? errors : 'none');
  ok = ok && !errors.length;
  await browser.close();
  console.log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
})();
