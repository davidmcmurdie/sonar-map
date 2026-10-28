/* ===== SVM ACSO server loader (acsodiveteam.org /profiler_test/sonar.html#YYYY-MM-DD) =====
 * Reads the date from the URL hash, gets the session list from lister.php, and loads every
 * "<date> <time> Sonar.json" file for that date from /dbase/DiveProfiles/ (read-only GETs).
 */
var SVMServerList = {
  /** '#2026-09-29' -> '2026-09-29'. Also accepts a longer prefix such as '#2026-09-29 13:36'. */
  hashDate: function (hash) {
    var h = String(hash || '').replace(/^#/, '');
    try { h = decodeURIComponent(h); } catch (e) { /* keep as is */ }
    h = h.trim();
    return /^\d{4}-\d{2}-\d{2}/.test(h) ? h : null;
  },
  isSonar: function (name) { return / Sonar\.json$/i.test(String(name)); },
  /** Sonar sessions only, oldest first by the time in the name. */
  sonarFiles: function (names, prefix) {
    var C = SVMCore;
    return (Array.isArray(names) ? names : []).filter(function (n) {
      return typeof n === 'string' && SVMServerList.isSonar(n) && (!prefix || n.indexOf(prefix) === 0) && C.parseServerName(n);
    }).sort(function (a, b) {
      var A = C.parseServerName(a), B = C.parseServerName(b);
      return A.date < B.date ? -1 : A.date > B.date ? 1 : A.minutes - B.minutes || (a < b ? -1 : 1);
    });
  },
  /** {date: count} over all sonar sessions, newest date first. */
  dates: function (names) {
    var out = {}, order = [];
    SVMServerList.sonarFiles(names).forEach(function (n) {
      var d = SVMCore.parseServerName(n).date;
      if (!out[d]) { out[d] = 0; order.push(d); }
      out[d]++;
    });
    order.sort().reverse();
    return order.map(function (d) { return { date: d, count: out[d] }; });
  }
};

function SVMServerLoader(root, app, cfg) {
  'use strict';
  var C = SVMCore;
  var q = function (s) { return root.querySelector(s); };
  var sel = q('[data-act=date]'), status = q('.svm-server-status');
  var names = null, loading = 0;
  function setStatus(t) { status.textContent = t; }

  function fillDates() {
    var list = SVMServerList.dates(names), cur = SVMServerList.hashDate(location.hash);
    var curDay = cur ? cur.slice(0, 10) : '';
    var html = '<option value="">Choose a date…</option>';
    if (curDay && !list.some(function (d) { return d.date === curDay; })) html += '<option value="' + C.escapeHtml(curDay) + '">' + C.escapeHtml(curDay) + ' (no sonar sessions)</option>';
    html += list.map(function (d) {
      return '<option value="' + C.escapeHtml(d.date) + '">' + C.escapeHtml(d.date) + ' (' + d.count + (d.count === 1 ? ' session' : ' sessions') + ')</option>';
    }).join('');
    sel.innerHTML = html;
    sel.value = curDay;
  }

  function loadDate() {
    var prefix = SVMServerList.hashDate(location.hash);
    if (names) fillDates();
    // Sessions from the server are replaced when the date changes; files opened from this device stay.
    app.removeWhere(function (x) { return x.server; });
    if (!prefix) { setStatus(names ? 'Choose a date to load its sonar sessions from the server.' : ''); return; }
    if (!names) return; // list still loading; called again when it arrives
    var files = SVMServerList.sonarFiles(names, prefix);
    if (!files.length) { setStatus('No sonar sessions on the server for ' + prefix + '.'); return; }
    var token = ++loading;
    setStatus('Loading ' + files.length + (files.length === 1 ? ' session' : ' sessions') + ' for ' + prefix + '…');
    Promise.all(files.map(function (n) {
      return fetch(cfg.filesBase + encodeURIComponent(n), { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      }).then(function (t) { return { name: n, text: t }; }, function (e) { return { name: n, error: e.message }; });
    })).then(function (res) {
      if (token !== loading) return; // a newer date was chosen meanwhile
      var ok = res.filter(function (r) { return !r.error; }).map(function (r) {
        var p = C.parseServerName(r.name);
        return { name: r.name, text: r.text, label: p.label, nameStart: p.date + ' ' + p.time, server: true };
      });
      var n = app.addTexts(ok);
      var errs = res.filter(function (r) { return r.error; }).map(function (r) { return r.name + ': could not load (' + r.error + ')'; });
      if (errs.length) app.showErrors(errs.concat(Array.prototype.map.call(root.querySelectorAll('.svm-errors div'), function (d) { return d.textContent; })));
      setStatus(prefix + ': ' + n + ' of ' + files.length + (files.length === 1 ? ' session' : ' sessions') + ' shown.');
    });
  }

  sel.addEventListener('change', function () { if (sel.value) location.hash = sel.value; });
  window.addEventListener('hashchange', loadDate);
  setStatus('Getting the session list…');
  fetch(cfg.lister, { cache: 'no-cache' }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function (list) {
    names = Array.isArray(list) ? list : [];
    fillDates();
    loadDate();
  }).catch(function (e) {
    sel.innerHTML = '<option value="">(session list not available)</option>';
    setStatus('Could not get the session list from the server (' + e.message + '). You can still open session files from this device.');
  });
  return { reload: loadDate };
}
/* ===== SVM ACSO server loader END ===== */
