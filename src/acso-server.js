/* ===== SVM ACSO server loader (acsodiveteam.org /profiler_test/sonar.html) =====
 * Normal view:  sonar.html#YYYY-MM-DD  -> date picker; that day's "<date> <time> Sonar.json" files via lister.php.
 * Shared view:  sonar.html?share=2026-09-29_13:36,2026-10-21_12:08  (or ?share=2026-09-29 for a whole day)
 *               also accepted: sonar.html?share#<list>  and  sonar.html#<list>&share
 *   Only the listed sessions are fetched (directly, no lister.php). A bare date needs lister.php, and then only
 *   that date's sonar files are used. No date picker, no file opening, hash changes are ignored.
 *   This is a display restriction only: lister.php and /dbase/DiveProfiles/ stay publicly readable.
 * All requests are read-only GETs.
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
  },
  /** Raw time part of a server file name: '2026-09-29 13:36 Sonar.json' -> '13:36'. */
  rawTime: function (name) {
    var m = /^\d{4}-\d{2}-\d{2} (\S+) Sonar\.json$/i.exec(String(name));
    return m ? m[1] : null;
  },
  /** One share token for a server file: '2026-09-29 13:36 Sonar.json' -> '2026-09-29_13:36'. */
  shareToken: function (name) {
    var t = SVMServerList.rawTime(name);
    return t ? String(name).slice(0, 10) + '_' + t : null;
  },
  /**
   * Shared-view request from location.search / location.hash, or null for the normal view.
   * Returns { items: [{date, time|null, file|null}], bad: [tokens not understood] }.
   * Tokens: 2026-09-29 (whole day) or 2026-09-29_13:36 (one session; '_', ' ', '+', 'T' or '@' between
   * date and time; time 13:36, 13.36, 1336 or 8:11B). Separated by commas, semicolons or spaces after a comma.
   */
  parseShare: function (search, hash) {
    function dec(s) { s = String(s || '').replace(/\+/g, ' '); try { return decodeURIComponent(s); } catch (e) { return s; } }
    var list = null, flag = false;
    String(search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
      var i = kv.indexOf('='), k = dec(i < 0 ? kv : kv.slice(0, i)).trim().toLowerCase();
      if (k === 'share') { flag = true; if (i >= 0 && dec(kv.slice(i + 1)).trim()) list = dec(kv.slice(i + 1)); }
    });
    var h = dec(String(hash || '').replace(/^#/, ''));
    var hashParts = h.split('&').map(function (x) { return x.trim(); }).filter(Boolean);
    if (hashParts.some(function (x) { return x.toLowerCase() === 'share'; })) flag = true;
    if (!flag) return null;
    if (list === null) list = hashParts.filter(function (x) { return x.toLowerCase() !== 'share'; }).join(',');
    var items = [], bad = [], seen = {};
    list.split(/[,;]/).map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (tok) {
      var m = /^(\d{4}-\d{2}-\d{2})(?:[_ +T@]+([0-9][0-9.:]*[A-Za-z]?))?$/.exec(tok);
      if (!m) { bad.push(tok); return; }
      var it, t = m[2];
      if (t === undefined) it = { date: m[1], time: null, file: null };
      else {
        // Times with a colon are used exactly as written (file names are like 13:36 or 8:11B);
        // 1336 / 13.36 are typing variants of 13:36.
        if (t.indexOf(':') < 0) {
          var mm = /^(\d{1,2})\.?(\d{2})([A-Za-z]?)$/.exec(t);
          if (!mm) { bad.push(tok); return; }
          t = parseInt(mm[1], 10) + ':' + mm[2] + mm[3];
        }
        it = { date: m[1], time: t, file: m[1] + ' ' + t + ' Sonar.json' };
      }
      var key = it.file || it.date;
      if (!seen[key]) { seen[key] = 1; items.push(it); }
    });
    return { items: items, bad: bad };
  }
};

function SVMServerLoader(root, app, cfg) {
  'use strict';
  var C = SVMCore, L = SVMServerList;
  var q = function (s) { return root.querySelector(s); };
  var sel = q('[data-act=date]'), status = q('.svm-server-status');
  var share = L.parseShare(location.search, location.hash);
  function setStatus(t) { status.textContent = t; }
  function fetchText(name) {
    return fetch(cfg.filesBase + encodeURIComponent(name), { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(r.status === 404 ? 'not found' : 'HTTP ' + r.status);
      return r.text();
    }).then(function (t) { return { name: name, text: t }; }, function (e) { return { name: name, error: e.message }; });
  }
  function toEntry(r) {
    var p = C.parseServerName(r.name);
    return { name: r.name, text: r.text, label: p ? p.label : r.name, nameStart: p ? p.date + ' ' + p.time : null, server: true };
  }

  /* ---------------- shared view ---------------- */
  if (share) {
    root.classList.add('svm-shared');
    document.documentElement.classList.add('svm-shared-page');
    var h1 = document.querySelector('.page-header h1'), sub = document.querySelector('.page-header p');
    var title = cfg.sharedTitle || 'Sonar Search Record';
    var days = share.items.map(function (i) { return i.date; }).filter(function (d, i, a) { return a.indexOf(d) === i; }).sort();
    if (h1) h1.textContent = title;
    if (sub) sub.textContent = days.length ? (days.length === 1 ? 'Search on ' : 'Searches on ') + days.join(', ') : '';
    document.title = title + (days.length ? ' – ' + days.join(', ') : '');
    if (!share.items.length) { setStatus('This link does not name any sessions.'); return { shared: true }; }
    var direct = share.items.filter(function (i) { return i.file; }).map(function (i) { return i.file; });
    var wholeDays = share.items.filter(function (i) { return !i.file; }).map(function (i) { return i.date; });
    setStatus('Loading…');
    // Only when the link names a whole day do we need the list, and then only that day's sonar files are used.
    var listP = wholeDays.length ? fetch(cfg.lister, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
    }).then(function (names) {
      var out = [];
      wholeDays.forEach(function (d) { L.sonarFiles(names, d + ' ').forEach(function (n) { if (n.slice(0, 10) === d) out.push(n); }); });
      return out;
    }).catch(function () { return []; }) : Promise.resolve([]);
    listP.then(function (fromDays) {
      var files = direct.concat(fromDays.filter(function (n) { return direct.indexOf(n) < 0; }));
      files = L.sonarFiles(files);
      return Promise.all(files.map(fetchText)).then(function (res) {
        var ok = res.filter(function (r) { return !r.error; }).map(toEntry);
        var n = app.addTexts(ok);
        var errs = res.filter(function (r) { return r.error; }).map(function (r) {
          var p = C.parseServerName(r.name); return 'Session ' + (p ? p.date + ' ' + p.time : r.name) + ': ' + r.error + '.';
        });
        if (share.bad.length) errs.push('Not understood in the link: ' + share.bad.join(', '));
        var prev = Array.prototype.map.call(root.querySelectorAll('.svm-errors div'), function (d) { return d.textContent; });
        if (errs.length) app.showErrors(errs.concat(prev));
        setStatus(n === 1 ? '1 sonar session.' : n + ' sonar sessions.');
      });
    });
    return { shared: true };
  }

  /* ---------------- normal view ---------------- */
  var names = null, loading = 0;
  function fillDates() {
    var list = L.dates(names), cur = L.hashDate(location.hash);
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
    var prefix = L.hashDate(location.hash);
    if (names) fillDates();
    // Sessions from the server are replaced when the date changes; files opened from this device stay.
    app.removeWhere(function (x) { return x.server; });
    if (!prefix) { setStatus(names ? 'Choose a date to load its sonar sessions from the server.' : ''); return; }
    if (!names) return; // list still loading; called again when it arrives
    var files = L.sonarFiles(names, prefix);
    if (!files.length) { setStatus('No sonar sessions on the server for ' + prefix + '.'); return; }
    var token = ++loading;
    setStatus('Loading ' + files.length + (files.length === 1 ? ' session' : ' sessions') + ' for ' + prefix + '…');
    Promise.all(files.map(fetchText)).then(function (res) {
      if (token !== loading) return; // a newer date was chosen meanwhile
      var n = app.addTexts(res.filter(function (r) { return !r.error; }).map(toEntry));
      var errs = res.filter(function (r) { return r.error; }).map(function (r) { return r.name + ': could not load (' + r.error + ')'; });
      if (errs.length) app.showErrors(errs.concat(Array.prototype.map.call(root.querySelectorAll('.svm-errors div'), function (d) { return d.textContent; })));
      setStatus(prefix + ': ' + n + ' of ' + files.length + (files.length === 1 ? ' session' : ' sessions') + ' shown.');
    });
  }

  /* Share link: the server sessions currently ticked "Show" (any date loaded so far is replaced on date change,
     so this is the current date's ticked sessions). Files opened from this device cannot be shared. */
  var shareBtn = q('[data-act=share]'), shareBox = q('.svm-share'), shareOut = q('.svm-share input'), shareMsg = q('.svm-share-msg');
  function shareUrl() {
    var toks = app.sessions().filter(function (x) { return x.server && x.visible && x.serverName; })
      .map(function (x) { return L.shareToken(x.serverName); }).filter(Boolean);
    if (!toks.length) return null;
    return location.origin + location.pathname + '?share=' + toks.join(',');
  }
  function updateShareBtn() {
    var u = shareUrl();
    shareBtn.disabled = !u;
    shareBtn.title = u ? 'Copies a link that shows only the ticked sessions, with no date picker' : 'Load a date first (only sessions from the server can be shared)';
    if (shareBox.style.display !== 'none' && u && shareOut.value !== u) { shareOut.value = u; shareMsg.textContent = 'Selection changed – press Copy share link again.'; }
  }
  function copyText(t) {
    // navigator.clipboard needs https; this site is http, so fall back to execCommand on the selected field.
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return false; });
    shareOut.focus(); shareOut.select();
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    return Promise.resolve(ok);
  }
  shareBtn.addEventListener('click', function () {
    var u = shareUrl(); if (!u) return;
    shareBox.style.display = 'flex'; shareOut.value = u;
    var n = u.split('=')[1].split(',').length;
    copyText(u).then(function (ok) {
      shareMsg.textContent = (ok ? 'Copied. ' : 'Select the link and copy it. ') + 'It shows ' + (n === 1 ? 'this 1 session' : 'these ' + n + ' sessions') + ' only. Untick "Show" on a session to leave it out.';
      shareOut.select();
    });
  });
  q('[data-act=share-open]').addEventListener('click', function () { if (shareOut.value) window.open(shareOut.value, '_blank'); });
  app.onChange(updateShareBtn);
  updateShareBtn();

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
  return { reload: loadDate, shared: false };
}
/* ===== SVM ACSO server loader END ===== */
