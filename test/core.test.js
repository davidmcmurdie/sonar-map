// node --test   (from /workspace/sonar_map_viewer)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const C = require('../src/core.js');

const ATT = process.env.SVM_ATTACH_DIR || '';
const attachFiles = fs.existsSync(ATT) ? fs.readdirSync(ATT).filter((f) => f.endsWith('.json')).map((f) => path.join(ATT, f)) : [];
const fx = (n) => path.join(__dirname, 'fixtures', n);

// Real exported sessions are private (positions), so they are not in the repo. Set SVM_ATTACH_DIR to a folder of them to run these.
test('attachment files are present', { skip: attachFiles.length ? false : 'no SVM_ATTACH_DIR session files on this machine' }, () => assert.ok(attachFiles.length >= 5, 'found ' + attachFiles.length));

for (const file of attachFiles) {
  test('parses + stats: ' + path.basename(file).slice(0, 8), () => {
    const text = fs.readFileSync(file, 'utf8');
    const raw = JSON.parse(text);
    const s = C.parseSession(text, path.basename(file));
    const st = C.sessionStats(s);
    // counts match the raw file
    assert.strictEqual(s.legs.length, raw.tracks.length);
    s.legs.forEach((l, i) => assert.strictEqual(l.length, raw.tracks[i].length));
    assert.strictEqual(st.fixes, raw.breadcrumb.length);
    const rawRej = raw.breadcrumb.filter((p) => p.rej).length + raw.tracks.flat().filter((p) => p.rej).length;
    const bcRej = raw.breadcrumb.filter((p) => p.rej).length;
    assert.strictEqual(st.rejected, bcRej);
    assert.ok(rawRej >= bcRej);
    assert.strictEqual(st.legs.length, raw.tracks.filter((t) => t.length).length);
    const srcTotal = Object.values(st.sources).reduce((a, b) => a + b, 0);
    assert.strictEqual(srcTotal, raw.breadcrumb.filter((p) => p.src).length);
    assert.strictEqual(st.marks, raw.marks.length);
    // sane numbers
    assert.ok(st.durationMs >= 0);
    st.legs.forEach((l) => assert.ok(l.distanceM >= 0 && l.distanceM < 5000));
    if (st.medianAcc !== null) assert.ok(st.medianAcc > 0 && st.medianAcc < 100);
    // swath polygons build and stay near the track
    s.legs.forEach((l) => {
      const polys = C.swathPolygons(l, 50);
      if (C.accepted(l).length >= 2) {
        assert.strictEqual(polys.length, 2);
        polys.forEach((ring) => assert.ok(ring.length >= 4));
      }
    });
    assert.ok(C.bounds([s]));
  });
}

test('known values: Oct 27 LifThor Android-location walk (e3eccba5)', () => {
  const f = attachFiles.find((x) => path.basename(x).startsWith('e3eccba5'));
  if (!f) return;
  const st = C.sessionStats(C.parseSession(fs.readFileSync(f, 'utf8'), 'a.json'));
  assert.deepStrictEqual(st.legs.map((l) => l.fixes), [51, 37]);
  assert.strictEqual(st.fixes, 127);
  assert.deepStrictEqual(st.sources, { fused: 127 });
  assert.strictEqual(st.rawGpsSetting, false);
  assert.strictEqual(C.fmtSources(st.sources), 'Android location (fused) 100%');
});

test('known values: Oct 27 LifThor raw walk (205d6278)', () => {
  const f = attachFiles.find((x) => path.basename(x).startsWith('205d6278'));
  if (!f) return;
  const st = C.sessionStats(C.parseSession(fs.readFileSync(f, 'utf8'), 'b.json'));
  assert.deepStrictEqual(st.legs.map((l) => l.fixes), [30, 25]);
  assert.strictEqual(st.rejected, 2);
  assert.deepStrictEqual(st.rejectedByReason, { acc: 1, warmup: 1 });
  assert.strictEqual(st.rawGpsSetting, true);
});

test('fallback session reports raw -> fused fallback (856270cf)', () => {
  const f = attachFiles.find((x) => path.basename(x).startsWith('856270cf'));
  if (!f) return;
  const st = C.sessionStats(C.parseSession(fs.readFileSync(f, 'utf8'), 'c.json'));
  assert.ok(st.sources.fusedFb > 0 && st.sources.raw > 0);
  assert.deepStrictEqual(st.fallbacks, ['stalled, no fix for 6 s']);
});

test('old file without per-fix fields loads', () => {
  const s = C.parseSession(fs.readFileSync(fx('old_format_sonar.json'), 'utf8'), 'old.json');
  const st = C.sessionStats(s);
  assert.strictEqual(st.fixes, 3);
  assert.strictEqual(st.legs.length, 1);
  assert.strictEqual(st.legsTotal, 2);
  assert.strictEqual(st.legs[0].durationMs, null);
  assert.strictEqual(st.hasDiagnostics, false);
  assert.strictEqual(st.medianAcc, null);
  assert.strictEqual(st.durationMs, 40000);
  assert.deepStrictEqual(s.marks, [{ n: 1, lat: 37.7103, lng: -121.9403, time: 1792000000000 }]);
  assert.strictEqual(C.fmtSources(st.sources), 'not recorded (older file)');
  assert.ok(C.fixInfoHtml('x', s.legs[0][0]).includes('Time'));
});

test('very old file without times loads', () => {
  const st = C.sessionStats(C.parseSession(fs.readFileSync(fx('very_old_no_time.json'), 'utf8'), 'v.json'));
  assert.strictEqual(st.start, null);
  assert.strictEqual(st.durationMs, null);
  assert.strictEqual(C.fmtTime(st.start), '–');
  // 0.0005 deg lat ~ 55.6 m
  assert.ok(Math.abs(st.legs[0].distanceM - 55.6) < 0.5, String(st.legs[0].distanceM));
});

test('Dive Profiler profile and junk give clear errors', () => {
  assert.throws(() => C.parseSession(fs.readFileSync(fx('dive_profile.json'), 'utf8'), 'd.json'), /Dive Profiler/);
  assert.throws(() => C.parseSession('not json', 'x'), /Not a JSON/);
  assert.throws(() => C.parseSession('[1,2]', 'x'), /Not a sonar/);
  assert.throws(() => C.parseSession('{"a":1}', 'x'), /Not a sonar/);
});

test('geometry and formatting', () => {
  assert.ok(Math.abs(C.haversine({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) - 111195) < 5);
  assert.strictEqual(C.fmtDist(30.48), '100 ft / 30.5 m');
  assert.strictEqual(C.fmtDuration(3723000), '1 h 2 min 3 s');
  assert.strictEqual(C.median([3, 1, 2, 10]), 2.5);
  // straight north leg: swath outer edge ~50 ft (15.24 m) each side
  const leg = [{ lat: 37.71, lng: -121.94 }, { lat: 37.711, lng: -121.94 }].map((p) => C.parsePoint(p));
  const [left, right] = C.swathPolygons(leg, 50);
  const dLeft = C.haversine(leg[0], left[0]), dRight = C.haversine(leg[0], right[0]);
  assert.ok(Math.abs(dLeft - 15.24) < 0.05 && Math.abs(dRight - 15.24) < 0.05, dLeft + ' ' + dRight);
  assert.ok(left[0].lng < leg[0].lng && right[0].lng > leg[0].lng, 'left of northbound is west');
  const inner = C.haversine(leg[0], left[left.length - 1]);
  assert.ok(Math.abs(inner - 5 * 0.3048) < 0.02, 'blind zone 5 ft');
  assert.strictEqual(C.escapeHtml('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
});

test('built snippet is current, scoped, and has the key placeholder', () => {
  const root = path.join(__dirname, '..');
  const snip = fs.readFileSync(path.join(root, 'sonar-map-viewer.html'), 'utf8');
  for (const f of ['core.js', 'ui.js', 'adapter-google.js', 'style.css', 'markup.html']) {
    assert.ok(snip.includes(fs.readFileSync(path.join(root, 'src', f), 'utf8').trim()), f + ' not in snippet: run node build.js');
  }
  assert.ok(snip.includes("window.SVM_GOOGLE_MAPS_API_KEY = 'YOUR_API_KEY'"));
  assert.ok(!/leaflet|openstreetmap/i.test(snip.replace(/Leaflet preview/g, '')), 'no preview code in snippet');
  const ids = [...snip.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(ids, ['svm-root']);
  const css = fs.readFileSync(path.join(root, 'src', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = css.replace(/@media[^{]+\{/g, '').split('}').map((b) => b.split('{')[0].trim()).filter(Boolean);
  for (const sel of selectors) for (const part of sel.split(',')) assert.ok(part.trim().startsWith('#svm-root'), 'unscoped: ' + part);
  assert.ok(Buffer.byteLength(snip) < 400 * 1024, 'Squarespace code block limit');
});

test('built index.html (GitHub Pages) is current and has the key placeholder', () => {
  const root = path.join(__dirname, '..');
  const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const f of ['core.js', 'ui.js', 'adapter-google.js', 'style.css', 'markup.html']) {
    assert.ok(page.includes(fs.readFileSync(path.join(root, 'src', f), 'utf8').trim()), f + ' not in index.html: run node build.js');
  }
  assert.ok(/^<!doctype html>/i.test(page));
  assert.ok(page.includes('<title>California Recovery Divers – Sonar Session Map</title>'));
  assert.ok(page.includes('name="viewport"'));
  assert.strictEqual((page.match(/window\.SVM_GOOGLE_MAPS_API_KEY = 'YOUR_API_KEY';/g) || []).length, 1);
  assert.ok(!/leaflet|openstreetmap/i.test(page.replace(/Leaflet preview/g, '')), 'no preview code in index.html');
});

// ---- acsodiveteam.org server page (acso target) ----
test('legacy server shapes: tracks only, breadcrumb only, heading-only fixes', () => {
  const tracksOnly = C.parseSession('{"tracks":[[{"lat":38.5,"lng":-121.5,"heading":0.0},{"lat":38.5,"lng":-121.5,"heading":0.0},{"lat":38.5001,"lng":-121.5,"heading":210.0}],[]]}', 'a');
  assert.strictEqual(tracksOnly.breadcrumb.length, 0);
  const st = C.sessionStats(tracksOnly);
  assert.strictEqual(st.fixes, 3);
  assert.strictEqual(st.legs.length, 1);
  assert.strictEqual(st.hasDiagnostics, false);
  assert.strictEqual(st.start, null);
  const bcOnly = C.parseSession('{"tracks":[],"marks":[{"lat":37.7,"lng":-121.9}],"breadcrumb":[{"lat":37.7,"lng":-121.9,"heading":114.3}]}', 'b');
  assert.strictEqual(C.sessionStats(bcOnly).fixes, 1);
  assert.strictEqual(bcOnly.marks[0].time, null);
  const html = C.fixInfoHtml('x', bcOnly.breadcrumb[0]);
  assert.ok(html.includes('n/a (not recorded in this file)'));
  assert.ok(html.includes('114° (as recorded)'));
  assert.throws(() => C.parseSession('{"diver":"x","searchLines":[]}', 'p'), /Dive Profiler/);
});

test('server file names and lister filtering', () => {
  const { SVMServerList } = (() => { global.SVMCore = C; const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'acso-server.js'), 'utf8'); return new Function('SVMCore', src + '\nreturn { SVMServerList };')(C); })();
  const names = ['2026-09-29 13:36 Sonar.json', '2026-09-29 9:05 Sonar.json', '2026-09-29 10:00 Some Diver.json', '2025-07-09 8:11B Sonar.json', '2025-07-09 8:11 Sonar.json', 'junk', 7];
  assert.deepStrictEqual(SVMServerList.sonarFiles(names, '2026-09-29'), ['2026-09-29 9:05 Sonar.json', '2026-09-29 13:36 Sonar.json']);
  assert.deepStrictEqual(SVMServerList.sonarFiles(names, '2025-07-09'), ['2025-07-09 8:11 Sonar.json', '2025-07-09 8:11B Sonar.json']);
  assert.deepStrictEqual(SVMServerList.dates(names), [{ date: '2026-09-29', count: 2 }, { date: '2025-07-09', count: 2 }]);
  assert.strictEqual(SVMServerList.hashDate('#2026-09-29'), '2026-09-29');
  assert.strictEqual(SVMServerList.hashDate('#2026-09-29%2013:36'), '2026-09-29 13:36');
  assert.strictEqual(SVMServerList.hashDate('#x'), null);
  assert.strictEqual(SVMServerList.hashDate(''), null);
});
