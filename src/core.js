/* ===== SVM CORE START (pure functions: parsing, stats, geometry, formatting; no DOM, no map) ===== */
var SVMCore = (function () {
  'use strict';
  var FT_PER_M = 3.28084;
  var M_PER_FT = 0.3048;
  var BLIND_ZONE_FT = 5; // same constant as the app (lib/settings/sonar_range.dart)

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  /** One fix from the file. Unknown keys are ignored; missing ones are null. */
  function parsePoint(p) {
    if (!p || typeof p !== 'object') return null;
    var lat = num(p.lat), lng = num(p.lng);
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return {
      lat: lat, lng: lng,
      heading: num(p.heading),
      time: num(p.time),            // ms since epoch (UTC); absent on old track points
      acc: num(p.acc),              // reported horizontal accuracy, m
      spd: num(p.spd),              // m/s
      src: typeof p.src === 'string' ? p.src : null,  // raw / fused / fusedFb
      fb: typeof p.fb === 'string' ? p.fb : null,     // fallback reason
      sats: num(p.sats), satsV: num(p.satsV),
      crs: num(p.crs), hdg: num(p.hdg),
      hSrc: typeof p.hSrc === 'string' ? p.hSrc : null,
      rej: typeof p.rej === 'string' ? p.rej : null   // warmup / acc / jump: not drawn by the app
    };
  }

  function parseList(list) {
    var out = [];
    if (!Array.isArray(list)) return out;
    for (var i = 0; i < list.length; i++) { var q = parsePoint(list[i]); if (q) out.push(q); }
    return out;
  }

  function isDiveProfile(obj) {
    return !!obj && typeof obj === 'object' && ('searchLines' in obj || 'timeIn' in obj || 'diver' in obj);
  }

  /**
   * Parses a DiveTeamSonarApp sonar session file (object or JSON text).
   * Throws Error with a readable message for anything else.
   */
  function parseSession(input, fileName) {
    var obj = input;
    if (typeof input === 'string') {
      try { obj = JSON.parse(input); } catch (e) { throw new Error('Not a JSON file.'); }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Not a sonar session file.');
    // Older app versions may write only "tracks" or only "breadcrumb"; either one is enough.
    if (isDiveProfile(obj) && !Array.isArray(obj.tracks)) throw new Error('This is a Dive Profiler profile, not a sonar session. Only sonar sessions can be shown.');
    if (!Array.isArray(obj.tracks) && !Array.isArray(obj.breadcrumb)) throw new Error('Not a sonar session file (no "tracks" / "breadcrumb").');
    var legs = [], tracks = Array.isArray(obj.tracks) ? obj.tracks : [];
    for (var i = 0; i < tracks.length; i++) legs.push(parseList(tracks[i]));
    var breadcrumb = parseList(obj.breadcrumb);
    var marks = [];
    var rawMarks = Array.isArray(obj.marks) ? obj.marks : [];
    var times = Array.isArray(obj.markTimes) ? obj.markTimes : [];
    for (var m = 0; m < rawMarks.length; m++) {
      var mk = rawMarks[m];
      var lat = mk && num(mk.lat), lng = mk && num(mk.lng);
      if (lat === null || lng === null || lat === undefined) continue;
      // markTimes is a parallel list; only trust it when the lengths match.
      marks.push({ n: m + 1, lat: lat, lng: lng, time: times.length === rawMarks.length ? num(times[m]) : null });
    }
    var diag = obj.diag && typeof obj.diag === 'object' && !Array.isArray(obj.diag) ? obj.diag : null;
    return { fileName: fileName || 'session.json', legs: legs, breadcrumb: breadcrumb, marks: marks, diag: diag };
  }

  /** Great-circle distance in metres. */
  function haversine(a, b) {
    var R = 6371008.8, toRad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toRad, dLng = (b.lng - a.lng) * toRad;
    var s = Math.sin(dLat / 2), t = Math.sin(dLng / 2);
    var h = s * s + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * t * t;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function accepted(points) { return points.filter(function (p) { return !p.rej; }); }

  function pathLength(points) {
    var d = 0;
    for (var i = 1; i < points.length; i++) d += haversine(points[i - 1], points[i]);
    return d;
  }

  function median(values) {
    if (!values.length) return null;
    var v = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  }

  function timeSpan(points) {
    var first = null, last = null;
    for (var i = 0; i < points.length; i++) {
      var t = points[i].time;
      if (t === null) continue;
      if (first === null || t < first) first = t;
      if (last === null || t > last) last = t;
    }
    return { start: first, end: last };
  }

  /** Summary numbers for the side panel. All measured from the file. */
  function sessionStats(s) {
    var all = s.breadcrumb.length ? s.breadcrumb : [].concat.apply([], s.legs);
    var span = timeSpan(all);
    if (span.start === null) span = timeSpan([].concat.apply([], s.legs));
    var legs = s.legs.map(function (pts, i) {
      var good = accepted(pts);
      var ls = timeSpan(pts);
      return {
        n: i + 1, fixes: pts.length, rejected: pts.length - good.length,
        distanceM: pathLength(good),
        start: ls.start, end: ls.end,
        durationMs: ls.start !== null && ls.end !== null ? ls.end - ls.start : null
      };
    });
    var src = {}, rej = {}, fallbacks = [], accs = [], accsUsed = [];
    for (var i = 0; i < all.length; i++) {
      var p = all[i];
      if (p.src) src[p.src] = (src[p.src] || 0) + 1;
      if (p.rej) rej[p.rej] = (rej[p.rej] || 0) + 1;
      if (p.fb && fallbacks.indexOf(p.fb) < 0) fallbacks.push(p.fb);
      if (p.acc !== null) { accs.push(p.acc); if (!p.rej) accsUsed.push(p.acc); }
    }
    var rejectedTotal = 0; for (var k in rej) rejectedTotal += rej[k];
    return {
      start: span.start, end: span.end,
      durationMs: span.start !== null && span.end !== null ? span.end - span.start : null,
      fixes: all.length,
      rejected: rejectedTotal, rejectedByReason: rej,
      sources: src, fallbacks: fallbacks,
      medianAcc: median(accs), medianAccUsed: median(accsUsed),
      legs: legs.filter(function (l) { return l.fixes > 0; }),
      legsTotal: legs.length,
      sonarDistanceM: legs.reduce(function (a, l) { return a + l.distanceM; }, 0),
      pathDistanceM: pathLength(accepted(s.breadcrumb)),
      marks: s.marks.length,
      hasDiagnostics: accs.length > 0 || Object.keys(src).length > 0,
      rawGpsSetting: s.diag && typeof s.diag.rawGps === 'boolean' ? s.diag.rawGps : null,
      diagVersion: s.diag && num(s.diag.v) !== null ? s.diag.v : null
    };
  }

  /** Bounds over every fix (rejected ones too, so nothing falls off-screen when shown). */
  function bounds(sessions) {
    var b = null;
    sessions.forEach(function (s) {
      var pts = [].concat(s.breadcrumb, [].concat.apply([], s.legs), s.marks);
      pts.forEach(function (p) {
        if (!b) b = { south: p.lat, north: p.lat, west: p.lng, east: p.lng };
        else {
          b.south = Math.min(b.south, p.lat); b.north = Math.max(b.north, p.lat);
          b.west = Math.min(b.west, p.lng); b.east = Math.max(b.east, p.lng);
        }
      });
    });
    return b;
  }

  /**
   * Sonar swath beside a leg, display only: two bands from the blind zone
   * out to rangeFt on each side of the track (like the app's map).
   * Returns [leftRing, rightRing] as arrays of {lat,lng}, or [] if < 2 points.
   */
  function swathPolygons(points, rangeFt, blindFt) {
    var pts = accepted(points);
    // drop consecutive duplicates (no direction between them)
    var clean = [];
    for (var i = 0; i < pts.length; i++) {
      if (!clean.length || haversine(clean[clean.length - 1], pts[i]) > 0.05) clean.push(pts[i]);
    }
    if (clean.length < 2) return [];
    var inner = (blindFt === undefined ? BLIND_ZONE_FT : blindFt) * M_PER_FT;
    var outer = rangeFt * M_PER_FT;
    var lat0 = clean[0].lat * Math.PI / 180;
    var mPerDegLat = 111320, mPerDegLng = 111320 * Math.cos(lat0);
    var xy = clean.map(function (p) { return { x: (p.lng - clean[0].lng) * mPerDegLng, y: (p.lat - clean[0].lat) * mPerDegLat }; });
    function back(x, y) { return { lat: clean[0].lat + y / mPerDegLat, lng: clean[0].lng + x / mPerDegLng }; }
    var normals = xy.map(function (_, j) {
      var a = xy[Math.max(0, j - 1)], c = xy[Math.min(xy.length - 1, j + 1)];
      var dx = c.x - a.x, dy = c.y - a.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
      return { x: -dy / len, y: dx / len }; // left of travel
    });
    function band(sign) {
      var outerSide = [], innerSide = [];
      for (var j = 0; j < xy.length; j++) {
        var n = normals[j];
        outerSide.push(back(xy[j].x + sign * n.x * outer, xy[j].y + sign * n.y * outer));
        innerSide.push(back(xy[j].x + sign * n.x * inner, xy[j].y + sign * n.y * inner));
      }
      return outerSide.concat(innerSide.reverse());
    }
    return [band(1), band(-1)];
  }

  /** Fix nearest to a clicked position (for the info popup). */
  function nearestPoint(points, lat, lng) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < points.length; i++) {
      var d = haversine(points[i], { lat: lat, lng: lng });
      if (d < bestD) { bestD = d; best = { point: points[i], index: i, distanceM: d }; }
    }
    return best;
  }

  /* ---------- formatting ---------- */
  function fmtDist(m) {
    if (m === null || m === undefined) return '–';
    var ft = m * FT_PER_M;
    if (m >= 1000) return (ft / 5280).toFixed(2) + ' mi / ' + (m / 1000).toFixed(2) + ' km (' + Math.round(ft) + ' ft)';
    return Math.round(ft) + ' ft / ' + (m < 100 ? m.toFixed(1) : Math.round(m)) + ' m';
  }
  function fmtDuration(ms) {
    if (ms === null || ms === undefined) return '–';
    var s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ' h ' : '') + (h || m ? m + ' min ' : '') + sec + ' s';
  }
  function pad(v) { return (v < 10 ? '0' : '') + v; }
  /** Local date/time of the viewer's browser, e.g. 2026-10-27 10:22:05. */
  function fmtTime(ms) {
    if (ms === null || ms === undefined) return '–';
    var d = new Date(ms);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function fmtCoord(p) { return p.lat.toFixed(6) + ', ' + p.lng.toFixed(6); }
  var SRC_LABEL = { raw: 'raw GPS', fused: 'Android location (fused)', fusedFb: 'fallback to fused' };
  function fmtSources(src) {
    var keys = Object.keys(src);
    if (!keys.length) return 'not recorded (older file)';
    var total = keys.reduce(function (a, k) { return a + src[k]; }, 0);
    return keys.map(function (k) {
      return (SRC_LABEL[k] || k) + ' ' + Math.round(100 * src[k] / total) + '%';
    }).join(', ');
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /** Info popup text for one fix (HTML, escaped). */
  function fixInfoHtml(title, p) {
    var rows = [['Time', p.time === null ? 'n/a (not recorded in this file)' : fmtTime(p.time)], ['Position', fmtCoord(p)]];
    if (p.acc !== null) rows.push(['Accuracy', p.acc.toFixed(1) + ' m (' + Math.round(p.acc * FT_PER_M) + ' ft)']);
    if (p.spd !== null) rows.push(['Speed', (p.spd * 2.23694).toFixed(1) + ' mph']);
    if (p.src) rows.push(['Source', SRC_LABEL[p.src] || p.src]);
    if (p.sats !== null) rows.push(['Satellites', p.sats + (p.satsV !== null ? ' used / ' + p.satsV + ' seen' : ' used')]);
    if (p.hdg !== null) rows.push(['Heading', Math.round(p.hdg) + '° true']);
    else if (p.heading !== null && p.acc === null && !p.src) rows.push(['Heading', Math.round(p.heading) + '° (as recorded)']); // older files
    if (p.rej) rows.push(['Not drawn by app', p.rej]);
    if (p.fb) rows.push(['Fallback', p.fb]);
    return '<div class="svm-iw"><b>' + escapeHtml(title) + '</b><table>' + rows.map(function (r) {
      return '<tr><td>' + escapeHtml(r[0]) + '</td><td>' + escapeHtml(r[1]) + '</td></tr>';
    }).join('') + '</table></div>';
  }

  /** "2026-09-29 13:36 Sonar.json" -> {date:'2026-09-29', time:'13:36', label:'2026-09-29 13:36 Sonar', minutes: 816}; null otherwise. */
  function parseServerName(name) {
    var m = /^(\d{4}-\d{2}-\d{2}) (\d{1,2})[:.](\d{1,2}(?:\.\d+)?)(?::(\d+(?:\.\d+)?))?([A-Za-z]?) (.+)\.json$/i.exec(String(name || ''));
    if (!m) return null;
    var h = parseInt(m[2], 10), mi = Math.floor(parseFloat(m[3]));
    return { date: m[1], time: h + ':' + pad(mi) + (m[5] || ''), who: m[6], label: String(name).replace(/\.json$/i, ''),
      minutes: h * 60 + mi + (m[5] ? 0.5 : 0) };
  }

  return {
    parseServerName: parseServerName,
    FT_PER_M: FT_PER_M, M_PER_FT: M_PER_FT, BLIND_ZONE_FT: BLIND_ZONE_FT,
    parsePoint: parsePoint, parseSession: parseSession, isDiveProfile: isDiveProfile,
    haversine: haversine, accepted: accepted, pathLength: pathLength, median: median,
    sessionStats: sessionStats, bounds: bounds, swathPolygons: swathPolygons, nearestPoint: nearestPoint,
    fmtDist: fmtDist, fmtDuration: fmtDuration, fmtTime: fmtTime, fmtCoord: fmtCoord,
    fmtSources: fmtSources, escapeHtml: escapeHtml, fixInfoHtml: fixInfoHtml
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SVMCore;
/* ===== SVM CORE END ===== */
