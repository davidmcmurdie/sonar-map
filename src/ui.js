/* ===== SVM UI (DOM + drawing through a small map adapter; same code for Google Maps and the Leaflet preview) ===== */
function SVMApp(root, adapter) {
  'use strict';
  var C = SVMCore;
  var COLORS = ['#ffeb3b', '#00e5ff', '#ff4081', '#76ff03', '#ff9100', '#e040fb', '#ffffff', '#40c4ff'];
  var q = function (sel) { return root.querySelector(sel); };
  var opts = { breadcrumb: true, swath: false, range: 50, rejected: false, marks: true };
  var sessions = [];
  var nextId = 1;

  function readOpts() {
    opts.breadcrumb = q('[data-opt=breadcrumb]').checked;
    opts.swath = q('[data-opt=swath]').checked;
    opts.rejected = q('[data-opt=rejected]').checked;
    opts.marks = q('[data-opt=marks]').checked;
    opts.range = parseInt(q('[data-opt=range]').value, 10) || 50;
  }

  function clearLayers(sess) {
    sess.layers.forEach(function (h) { adapter.remove(h); });
    sess.layers = [];
  }

  function legLabel(sess, i) { return sess.s.fileName + ' · leg ' + (i + 1); }

  function draw(sess) {
    clearLayers(sess);
    if (!sess.visible) return;
    var s = sess.s, L = sess.layers, color = sess.color;
    // Swath first so the lines sit on top of it.
    if (opts.swath) {
      s.legs.forEach(function (pts) {
        C.swathPolygons(pts, opts.range).forEach(function (ring) {
          L.push(adapter.polygon(ring, { color: color, fillOpacity: 0.18, strokeOpacity: 0.35 }));
        });
      });
    }
    if (opts.breadcrumb && s.breadcrumb.length) {
      var bc = C.accepted(s.breadcrumb);
      var h = adapter.polyline(bc, { color: color, weight: 2, opacity: 0.75, dashed: true });
      adapter.onClick(h, function (ll) {
        var n = C.nearestPoint(bc, ll.lat, ll.lng);
        if (n) adapter.openInfo(n.point, C.fixInfoHtml(s.fileName + ' · full path fix ' + (n.index + 1), n.point));
      });
      L.push(h);
    }
    var drewLeg = false;
    s.legs.forEach(function (pts, i) {
      var good = C.accepted(pts);
      if (!good.length) return;
      drewLeg = true;
      var h = adapter.polyline(good, { color: color, weight: 4, opacity: 1 });
      adapter.onClick(h, function (ll) {
        var n = C.nearestPoint(good, ll.lat, ll.lng);
        if (n) adapter.openInfo(n.point, C.fixInfoHtml(legLabel(sess, i) + ', fix ' + (n.index + 1), n.point));
      });
      L.push(h);
      var a = good[0], b = good[good.length - 1];
      L.push(infoMarker(a, { kind: 'start', label: String(i + 1) }, C.fixInfoHtml(legLabel(sess, i) + ' start', a)));
      L.push(infoMarker(b, { kind: 'end' }, C.fixInfoHtml(legLabel(sess, i) + ' end', b)));
    });
    if (!drewLeg && s.breadcrumb.length) { // no sonar legs: mark where the session started / ended
      var bcg = C.accepted(s.breadcrumb);
      if (bcg.length) {
        L.push(infoMarker(bcg[0], { kind: 'start', label: 'S' }, C.fixInfoHtml(s.fileName + ' · session start', bcg[0])));
        L.push(infoMarker(bcg[bcg.length - 1], { kind: 'end' }, C.fixInfoHtml(s.fileName + ' · session end', bcg[bcg.length - 1])));
      }
    }
    if (opts.rejected) {
      var all = s.breadcrumb.concat([].concat.apply([], s.legs));
      all.filter(function (p) { return p.rej; }).forEach(function (p) {
        L.push(infoMarker(p, { kind: 'rej' }, C.fixInfoHtml(s.fileName + ' · rejected fix', p)));
      });
    }
    if (opts.marks) {
      s.marks.forEach(function (m) {
        var html = '<div class="svm-iw"><b>' + C.escapeHtml(s.fileName + ' · mark ' + m.n) + '</b><table>' +
          '<tr><td>Time</td><td>' + C.escapeHtml(C.fmtTime(m.time)) + '</td></tr>' +
          '<tr><td>Position</td><td>' + C.escapeHtml(C.fmtCoord(m)) + '</td></tr></table></div>';
        L.push(infoMarker(m, { kind: 'mark', label: String(m.n) }, html));
      });
    }
  }

  function infoMarker(p, o, html) {
    var h = adapter.marker(p, o);
    adapter.onClick(h, function () { adapter.openInfo(p, html); });
    return h;
  }

  function redrawAll() { readOpts(); sessions.forEach(draw); }

  function fit(list) {
    var b = C.bounds(list.map(function (x) { return x.s; }));
    if (b) adapter.fitBounds(b);
  }

  function row(label, value) {
    return '<tr><th>' + C.escapeHtml(label) + '</th><td>' + C.escapeHtml(value) + '</td></tr>';
  }

  function renderList() {
    var list = q('.svm-list');
    // Rejected-fix toggle only makes sense if a loaded file has rejected fixes (older files never do).
    var rejBox = q('[data-opt=rejected]'), anyRej = sessions.some(function (x) { return x.stats.rejected > 0; });
    if (rejBox) {
      rejBox.disabled = !anyRej;
      var rl = rejBox.closest ? rejBox.closest('label') : null;
      if (rl) { rl.style.opacity = anyRej ? '' : '0.5'; rl.title = anyRej ? 'Shows, in grey, fixes the app rejected as too inaccurate and did not draw' : 'None of the loaded files has rejected fixes (older files do not record them)'; }
    }
    if (!sessions.length) {
      list.innerHTML = '<p class="svm-empty">No sessions loaded. Use <b>Open session files…</b> or drop exported sonar session (.json) files onto this box.</p>';
      return;
    }
    list.innerHTML = '';
    sessions.forEach(function (sess) {
      var st = sess.stats, el = document.createElement('div');
      el.className = 'svm-item';
      var srcs = C.fmtSources(st.sources);
      if (st.fallbacks.length) srcs += ' (fell back: ' + st.fallbacks.join('; ') + ')';
      var rej = st.rejected ? st.rejected + ' (' + Object.keys(st.rejectedByReason).map(function (k) {
        return k + ' ' + st.rejectedByReason[k]; }).join(', ') + ')' : (st.hasDiagnostics ? '0' : 'not recorded');
      var legRows = st.legs.map(function (l) {
        return row('Leg ' + l.n, C.fmtDist(l.distanceM) + ' · ' + l.fixes + ' fixes' +
          (l.durationMs !== null ? ' · ' + C.fmtDuration(l.durationMs) : ''));
      }).join('');
      el.innerHTML =
        '<div class="svm-item-head"><span class="svm-swatch" style="background:' + sess.color + '"></span>' +
        '<label class="svm-show"><input type="checkbox" ' + (sess.visible ? 'checked' : '') + '> Show</label>' +
        '<span class="svm-name" title="' + C.escapeHtml(sess.s.fileName) + '">' + C.escapeHtml(sess.s.fileName) + '</span></div>' +
        '<div class="svm-item-btns"><button type="button" class="svm-btn svm-small" data-act="zoom">Zoom to this file</button>' +
        '<button type="button" class="svm-btn svm-small" data-act="remove">Remove from map</button></div>' +
        '<table class="svm-stats">' +
        row('Started', st.start !== null ? C.fmtTime(st.start) : sess.nameStart ? sess.nameStart + ' (from file name)' : 'n/a (no times in file)') +
        row('Duration', st.durationMs !== null ? C.fmtDuration(st.durationMs) : 'n/a (no times in file)') +
        row('Fixes', String(st.fixes)) +
        legRows +
        (st.legs.length ? row('Sonar total', C.fmtDist(st.sonarDistanceM)) : row('Sonar legs', 'none recorded')) +
        row('Full path', sess.s.breadcrumb.length ? C.fmtDist(st.pathDistanceM) : 'n/a (not recorded in this file)') +
        (st.hasDiagnostics ? row('GPS source', srcs) +
          row('Median accuracy', st.medianAcc !== null ? st.medianAcc.toFixed(1) + ' m (' + Math.round(st.medianAcc * C.FT_PER_M) + ' ft)' : 'not recorded') +
          row('Rejected fixes', rej) : '') +
        (st.rawGpsSetting !== null ? row('Raw GPS switch', st.rawGpsSetting ? 'on' : 'off') : '') +
        row('Marks', String(st.marks)) +
        '</table>' +
        (st.hasDiagnostics ? '' : '<p class="svm-warn">Older file: GPS accuracy, source and rejected fixes were not recorded' + (st.start === null ? ', nor fix times' : '') + '.</p>');
      el.querySelector('.svm-show input').addEventListener('change', function (e) {
        sess.visible = e.target.checked; draw(sess);
      });
      el.querySelector('[data-act=zoom]').addEventListener('click', function () { fit([sess]); });
      el.querySelector('[data-act=remove]').addEventListener('click', function () {
        clearLayers(sess); sessions.splice(sessions.indexOf(sess), 1); renderList();
      });
      list.appendChild(el);
    });
  }

  function showErrors(errs) {
    var box = q('.svm-errors');
    box.innerHTML = errs.map(function (e) { return '<div>' + C.escapeHtml(e) + '</div>'; }).join('');
    box.style.display = errs.length ? 'block' : 'none';
  }

  /** Adds already-read files: [{name, text}]. Returns the number loaded. */
  function addTexts(files) {
    var errs = [], added = [];
    files.forEach(function (f) {
      try {
        var s = C.parseSession(f.text, f.name);
        if (f.label) s.fileName = f.label;
        var sess = { id: nextId++, s: s, stats: C.sessionStats(s), color: COLORS[(nextId - 2) % COLORS.length], visible: true, layers: [],
          nameStart: f.nameStart || null, server: !!f.server };
        if (!sess.stats.fixes) throw new Error('The file has no GPS fixes.');
        sessions.push(sess); added.push(sess);
      } catch (e) { errs.push(f.name + ': ' + e.message); }
    });
    showErrors(errs);
    readOpts();
    added.forEach(draw);
    renderList();
    if (added.length) fit(sessions);
    return added.length;
  }

  function readFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var out = [], left = files.length;
    files.forEach(function (file, i) {
      var r = new FileReader(); // local read only: nothing is sent anywhere
      r.onload = function () { out[i] = { name: file.name, text: String(r.result) }; if (--left === 0) addTexts(out); };
      r.onerror = function () { out[i] = { name: file.name, text: '' }; if (--left === 0) addTexts(out); };
      r.readAsText(file);
    });
  }

  // wiring
  var input = q('input[type=file]');
  input.addEventListener('change', function () { readFiles(input.files); input.value = ''; });
  Array.prototype.forEach.call(root.querySelectorAll('[data-opt]'), function (el) {
    el.addEventListener('change', redrawAll);
  });
  function clearAll() { sessions.forEach(clearLayers); sessions = []; showErrors([]); renderList(); }
  q('[data-act=clear]').addEventListener('click', clearAll);
  q('[data-act=fit]').addEventListener('click', function () { fit(sessions); });
  ['dragenter', 'dragover'].forEach(function (ev) {
    root.addEventListener(ev, function (e) { e.preventDefault(); root.classList.add('svm-dragging'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    root.addEventListener(ev, function (e) {
      e.preventDefault();
      if (ev === 'dragleave' && root.contains(e.relatedTarget)) return;
      root.classList.remove('svm-dragging');
    });
  });
  root.addEventListener('drop', function (e) { if (e.dataTransfer) readFiles(e.dataTransfer.files); });
  renderList();

  return { addTexts: addTexts, sessions: function () { return sessions; }, redraw: redrawAll, clear: clearAll, showErrors: showErrors,
    removeWhere: function (pred) {
      var gone = sessions.filter(pred);
      if (!gone.length) return;
      gone.forEach(clearLayers);
      sessions = sessions.filter(function (x) { return gone.indexOf(x) < 0; });
      showErrors([]); renderList();
    } };
}
/* ===== SVM UI END ===== */
