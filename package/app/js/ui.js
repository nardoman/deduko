/*
 * Deduko UI: home, language, intro and game screens. ES5 only (Kindle
 * Mesquite, WebKit 533): DOM through getElementById/innerHTML, one click
 * handler with data-act delegation, no scrolling (rows and clues are
 * paginated). Every visible word comes from the language strings.
 */
(function (root) {
  var D = root.DEDUKO = root.DEDUKO || {};
  var doc = root.document;
  var PFX = 'deduko.v2.';  /* v2: staircase grid and undo history (v1 saves are not read) */
  var UNDO_MAX = 50;       /* undo entries kept per game */
  var TOOL_IDS = { 1: 'x', 2: 'dot' };  /* tool value = the mark it writes */
  var tool = 1;            /* selected tool: 1 = X, 2 = dot (tapping a mark erases it) */
  var autoOn = false;      /* auto-exclude: a dot puts X on the rest of its row and column in the block */
  var ERR_MAX = 5;         /* error mode: the case restarts at this many wrong marks */
  var codeDigits = '';     /* digits typed on the code keypad */
  var lang = null;      /* current language code */
  var S = {};           /* current strings */
  var L = null;         /* current layout */
  var screen = null;    /* name of the current screen */
  var back = null;      /* function that re-renders the screen before the language screen */
  var homePage = 0;
  var cur = null;       /* current intro/game target */
  var resetArmed = false, resetTimer = null;

  function own(o, k) { return o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k); }
  function isArray(x) { return Object.prototype.toString.call(x) === '[object Array]'; }
  function isObj(x) { return x !== null && typeof x === 'object' && !isArray(x); }
  function $(id) { return doc.getElementById(id); }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmt(s, map) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return own(map, k) ? String(map[k]) : m; });
  }

  /* ---------- storage (localStorage, every access guarded) ---------- */

  function getItem(k) {
    try { return root.localStorage ? root.localStorage.getItem(PFX + k) : null; } catch (e) { return null; }
  }
  function setItem(k, v) {
    try { if (root.localStorage) root.localStorage.setItem(PFX + k, v); } catch (e) { D.log('storage write failed: ' + e); }
  }
  function getJson(k) {
    var v = getItem(k);
    if (v === null || v === undefined) return null;
    try { return JSON.parse(v); } catch (e) { return null; }
  }
  function setJson(k, o) { setItem(k, JSON.stringify(o)); }

  /* ---------- language ---------- */

  function pickLang() {
    var st = getItem('lang'), nl = '';
    if (st && own(D.langs, st)) return st;
    try { nl = String((root.navigator && (root.navigator.language || root.navigator.userLanguage)) || ''); } catch (e) {}
    nl = nl.toLowerCase().split('-')[0].split('_')[0];
    if (nl && own(D.langs, nl)) return nl;
    if (own(D.langs, 'en')) return 'en';
    return D.langOrder.length ? D.langOrder[0] : null;
  }

  function setLang(code) {
    lang = code;
    S = code && own(D.langs, code) ? D.langs[code].strings : {};
    try { doc.documentElement.setAttribute('lang', code || ''); } catch (e) {}
  }

  /* ---------- layout ---------- */

  function layout() {
    var W = root.innerWidth || doc.documentElement.clientWidth;
    var H = root.innerHeight || doc.documentElement.clientHeight;
    var B = Math.round(Math.min(W, H) / 36);
    if (B < 14) B = 14;
    if (B > 40) B = 40;
    var m = Math.round(B * 0.6);
    return { W: W, H: H, B: B, m: m, inner: W - 2 * m, labelCol: Math.round(W * 0.2) };
  }

  function show(html) {
    var app = $('app');
    L = L || layout();
    app.style.fontSize = L.B + 'px';
    app.style.padding = L.m + 'px';
    app.style.width = L.inner + 'px';
    app.innerHTML = html;
  }

  function measurer() {
    var ms = $('measure');
    ms.style.fontSize = L.B + 'px';
    return ms;
  }

  /* Heights of HTML items rendered at the given width (each wrapped in div.mi). */
  function measureHeights(items, width) {
    var ms = measurer(), h = [], out = [], i;
    ms.style.width = width + 'px';
    for (i = 0; i < items.length; i++) h.push('<div class="mi">' + items[i] + '</div>');
    ms.innerHTML = h.join('');
    for (i = 0; i < items.length; i++) out.push($('measure').childNodes[i].offsetHeight);
    ms.innerHTML = '';
    return out;
  }

  /* Widths of plain texts rendered with the given inline style. */
  function measureWidths(texts, style) {
    var ms = measurer(), h = [], out = [], i, kids;
    ms.style.width = '10000px';
    for (i = 0; i < texts.length; i++) h.push('<div><span style="white-space:nowrap;' + style + '">' + esc(texts[i]) + '</span></div>');
    ms.innerHTML = h.join('');
    kids = ms.getElementsByTagName('span');
    for (i = 0; i < kids.length; i++) out.push(kids[i].offsetWidth);
    ms.innerHTML = '';
    return out;
  }

  function paginate(heights, avail) {
    var pages = [], pg = [], used = 0, i;
    for (i = 0; i < heights.length; i++) {
      if (pg.length && used + heights[i] > avail) { pages.push(pg); pg = []; used = 0; }
      pg.push(i);
      used += heights[i];
    }
    if (pg.length || !pages.length) pages.push(pg);
    return pages;
  }

  function topOf(el) { return el.getBoundingClientRect().top; }

  /* ---------- small renderers ---------- */

  function ball(on) {
    var size = Math.round(L.B * 0.55), r = Math.round(size / 2) + 2;
    return '<span class="ball' + (on ? ' on' : '') + '" style="width:' + size + 'px;height:' + size +
      'px;-webkit-border-radius:' + r + 'px;border-radius:' + r + 'px"></span>';
  }

  /* d filled balls out of 5, or only the d filled balls. */
  function balls(d, filledOnly) {
    var h = '', i, max = filledOnly ? d : 5;
    for (i = 1; i <= max; i++) h += ball(i <= d);
    return h;
  }

  function tags(codes) {
    var h = '', i;
    for (i = 0; i < codes.length; i++) h += '<span class="tag">' + esc(codes[i].toUpperCase()) + '</span>';
    return h;
  }

  function btn(id, act, label, extra, attrs) {
    return '<div class="btn' + (extra ? ' ' + extra : '') + '"' + (id ? ' id="' + id + '"' : '') +
      ' data-act="' + act + '"' + (attrs || '') + '>' + esc(label) + '</div>';
  }

  function pager(prefix, page, count) {
    var vis = count > 1 ? '' : ' style="visibility:hidden"';
    return '<span' + vis + '>' +
      btn(prefix + '-prev', prefix.charAt(0) + 'prev', S.prevPage, page > 0 ? '' : 'off') +
      '<span class="pg" id="' + prefix + '-page">' + esc(fmt(S.pageOf, { n: page + 1, m: count })) + '</span>' +
      btn(prefix + '-next', prefix.charAt(0) + 'next', S.nextPage, page < count - 1 ? '' : 'off') + '</span>';
  }

  function attr(name, v) { return ' data-' + name + '="' + esc(v) + '"'; }

  /* ---------- data helpers ---------- */

  function findById(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function textFor(pid, code) { return D.text(pid, code); }

  function packName(pid) {
    var t = textFor(pid, lang), i;
    if (t) return t.name;
    for (i = 0; i < D.langOrder.length; i++) { t = textFor(pid, D.langOrder[i]); if (t) return t.name; }
    return pid;
  }

  function sortedCases(pack) {
    var a = [], i;
    for (i = 0; i < pack.cases.length; i++) a.push({ c: pack.cases[i], i: i });
    a.sort(function (x, y) { return x.c.difficulty - y.c.difficulty || x.i - y.i; });
    for (i = 0; i < a.length; i++) a[i] = a[i].c;
    return a;
  }

  function hasProgress(p) {
    return p.done || p.s.length > 0 || p.n > 0 || p.m.join('').replace(/0/g, '') !== '';
  }

  function errModePref() { return getItem('errmode') === '1' ? 1 : 0; }

  function zeros(len) {
    var a = [], i;
    for (i = 0; i < len; i++) a.push('0');
    return a;
  }

  /* ---------- staircase grid geometry ----------
     Columns: the items of categories 1 .. k-1 (column j = (c - 1) * n + item).
     Row bands: band 0 = the suspects (all column blocks), then band b >= 1 =
     category k - b, with blocks only for the column categories 1 .. k-b-1.
     Grid row R = b * n + item. Marks: the suspect band first (R * nv + j, the
     layout engine.checkGrid reads), then each lower band block by block. */

  function bandCat(cp, b) { return b === 0 ? 0 : cp.k - b; }
  function bandBlocks(cp, b) { return b === 0 ? cp.k - 1 : cp.k - 1 - b; }
  function markLen(cp) { return cp.n * cp.nv + cp.n * cp.n * (cp.k - 1) * (cp.k - 2) / 2; }

  /* Mark index of grid cell (R, j), or -1 when the cell does not exist. */
  function markIndex(cp, R, j) {
    var n = cp.n, b = Math.floor(R / n), c = Math.floor(j / n), off, x;
    if (R < 0 || j < 0 || j >= cp.nv || b > cp.k - 2 || Math.floor(R) !== R || Math.floor(j) !== j) return -1;
    if (b === 0) return R * cp.nv + j;
    if (c >= bandBlocks(cp, b)) return -1;
    off = n * cp.nv;
    for (x = 1; x < b; x++) off += n * n * bandBlocks(cp, x);
    return off + c * n * n + (R % n) * n + (j % n);
  }

  function isInt(x) { return typeof x === 'number' && Math.floor(x) === x; }

  /* An undo entry is ['m', R, j, oldMark, ...] (cells an action changed) or
     ['s', q] (a clue strike toggle). Returns true when e is well formed. */
  function validUndo(t, e) {
    var x;
    if (!isArray(e)) return false;
    if (e[0] === 's') return e.length === 2 && isInt(e[1]) && e[1] >= 0 && e[1] < t.cj.clues.length;
    if (e[0] !== 'm' || e.length < 4 || (e.length - 1) % 3 !== 0) return false;
    for (x = 1; x < e.length; x += 3) {
      if (!isInt(e[x]) || !isInt(e[x + 1]) || markIndex(t.cp, e[x], e[x + 1]) < 0) return false;
      if (e[x + 2] !== 0 && e[x + 2] !== 1 && e[x + 2] !== 2) return false;
    }
    return true;
  }

  /* Reads progress for a target, sanitised against its compiled case. */
  function loadProgress(t) {
    var o = getJson(t.key), len = markLen(t.cp), m, s = [], u = [], seen = {}, i, q;
    m = o && typeof o.m === 'string' && o.m.length === len && /^[012]*$/.test(o.m) ? o.m.split('') : zeros(len);
    if (o && isArray(o.s)) {
      for (i = 0; i < o.s.length; i++) {
        q = o.s[i];
        if (typeof q === 'number' && q >= 0 && q < t.cj.clues.length && Math.floor(q) === q && !own(seen, String(q))) {
          seen[String(q)] = true;
          s.push(q);
        }
      }
    }
    if (o && isArray(o.u)) {
      for (i = 0; i < o.u.length; i++) if (validUndo(t, o.u[i])) u.push(o.u[i]);
      if (u.length > UNDO_MAX) u = u.slice(u.length - UNDO_MAX);
    }
    /* e (mode) and n (error count) are 1.1.0 fields: a 1.0.0 record is a free-play game */
    return {
      m: m, s: s, u: u, done: !!(o && o.done === true),
      e: o && o.e === 1 ? 1 : 0,
      n: o && isInt(o.n) && o.n >= 0 && o.n < ERR_MAX ? o.n : 0
    };
  }

  function saveProgress(t) {
    var o = { m: t.marks.join(''), s: t.struck, u: t.undo, done: t.done, e: t.mode, n: t.errors };
    if (t.kind === 'gen') o = { 'case': t.cj, m: o.m, s: o.s, u: o.u, done: o.done, e: o.e, n: o.n };
    setJson(t.key, o);
  }

  function caseTarget(pid, cj) {
    return { kind: 'case', pack: pid, cj: cj, cp: D.engine.compile(cj), key: 'p.' + pid + '.' + cj.id };
  }

  function genKey(pid, sid, d) { return 'gen.' + pid + '.' + sid + '.' + d; }

  /* The stored generated case for a slot, or null when absent or invalid. */
  function genSlot(pid, setting, d) {
    var o = getJson(genKey(pid, setting.id, d));
    if (!isObj(o) || !isObj(o['case'])) return null;
    if (D.engine.validateCase(o['case']) !== null || o['case'].difficulty !== d) return null;
    return o;
  }

  function genTarget(pid, setting, d, cj) {
    return { kind: 'gen', pack: pid, cj: cj, cp: D.engine.compile(cj), key: genKey(pid, setting.id, d), setting: setting };
  }

  function targetTitle(t) {
    var tx = textFor(t.pack, lang), seed;
    if (t.kind === 'gen') {
      seed = t.cj.gen && typeof t.cj.gen.seed === 'number' ? t.cj.gen.seed : 0;
      return fmt(S.randomTitle, { setting: tx && own(tx.settings, t.setting.id) ? tx.settings[t.setting.id].title : t.setting.id, n: seed % 10000 });
    }
    return tx && own(tx.cases, t.cj.id) ? tx.cases[t.cj.id].title : t.cj.id;
  }

  function targetStory(t) {
    var tx = textFor(t.pack, lang), e = null;
    if (tx) e = t.kind === 'gen' ? (own(tx.settings, t.setting.id) ? tx.settings[t.setting.id] : null) : (own(tx.cases, t.cj.id) ? tx.cases[t.cj.id] : null);
    return e && typeof e.story === 'string' ? e.story : '';
  }

  /* ---------- home ---------- */

  function homeItems() {
    var items = [], anyAvail = false, p, pid, pack, cases, i, c, langs, ok, title, tx, prog, status, st, d, slot, setting;
    var settingsAvail = [];
    /* fixed column widths, identical in every row, so balls, tags and status line up */
    var colW = {
      bb: ' style="width:' + (5 * (Math.round(L.B * 0.55) + 6) + 8) + 'px"',
      lt: ' style="width:' + (D.langOrder.length * (Math.round(L.B * 1.5) + 6) + 6) + 'px"',
      st: ' style="width:' + Math.round(L.inner * 0.2) + 'px"'
    };
    items.push('<div class="sect">' + esc(S.cases) + '</div>');
    for (p = 0; p < D.packOrder.length; p++) {
      pid = D.packOrder[p];
      pack = D.packs[pid];
      cases = sortedCases(pack);
      if (cases.length) items.push('<div class="packh">' + esc(packName(pid)) + '</div>');
      for (i = 0; i < cases.length; i++) {
        c = cases[i];
        langs = D.available(pid, 'case', c.id);
        ok = langs.indexOf(lang) >= 0;
        if (ok) anyAvail = true;
        tx = textFor(pid, ok ? lang : langs[0]);
        title = tx && own(tx.cases, c.id) ? tx.cases[c.id].title : c.id;
        if (!ok) {
          status = fmt(S.notAvailable, { langs: langs.length ? langs.join(', ').toUpperCase() : '-' });
        } else {
          prog = getJson('p.' + pid + '.' + c.id);
          st = 'statusNew';
          if (isObj(prog) && prog.done === true) st = 'statusSolved';
          else if (isObj(prog) && ((typeof prog.m === 'string' && /[12]/.test(prog.m)) || (isArray(prog.s) && prog.s.length) ||
            (isInt(prog.n) && prog.n > 0))) st = 'statusInProgress';
          status = S[st];
        }
        items.push('<div class="row case-row' + (ok ? '' : ' dim') + '"' + (ok ? ' data-act="case"' : '') +
          attr('pack', pid) + attr('case', c.id) + ' id="case-' + esc(pid) + '-' + esc(c.id) + '">' +
          '<table class="rt"><tr><td class="tt">' + esc(title) + '</td><td class="bb"' + colW.bb + '>' + balls(c.difficulty) +
          '</td><td class="lt"' + colW.lt + '>' + tags(langs) + '</td><td class="st"' + colW.st + '>' + esc(status) + '</td></tr></table></div>');
      }
      for (i = 0; i < pack.settings.length; i++) {
        if (D.available(pid, 'setting', pack.settings[i].id).indexOf(lang) >= 0) settingsAvail.push({ pid: pid, s: pack.settings[i] });
      }
    }
    if (!anyAvail) items.push('<div class="note">' + esc(S.noCases) + '</div>');
    if (settingsAvail.length) {
      items.push('<div class="sect">' + esc(S.newCase) + '</div>');
      for (i = 0; i < settingsAvail.length; i++) {
        pid = settingsAvail[i].pid;
        setting = settingsAvail[i].s;
        tx = textFor(pid, lang);
        var row1 = '', row2 = '';
        for (d = 1; d <= 5; d++) {
          if (!D.engine.supports(setting, d)) continue;
          row1 += '<td><div class="btn gen-btn" data-act="gen"' + attr('pack', pid) + attr('setting', setting.id) + attr('d', d) +
            ' id="gen-' + esc(pid) + '-' + esc(setting.id) + '-' + d + '">' + balls(d, true) + '</div></td>';
          slot = genSlot(pid, setting, d);
          row2 += '<td>' + (slot && !slot.done ? btn('cont-' + pid + '-' + setting.id + '-' + d, 'cont', S.continueCase, 'small gen-cont',
            attr('pack', pid) + attr('setting', setting.id) + attr('d', d)) : '') + '</td>';
        }
        items.push('<div class="setb"><div class="sett">' + esc(tx.settings[setting.id].title) + '</div>' +
          '<table class="gt"><tr>' + row1 + '</tr><tr>' + row2 + '</tr></table></div>');
      }
    }
    return items;
  }

  var homeCache = null;

  function renderHome() {
    screen = 'home';
    cur = null;
    L = layout();
    var items = homeItems();
    show('<div id="home"><div class="apptitle">' + esc(S.appTitle) + '</div><div id="home-list"></div>' +
      '<table class="bar" id="home-foot"><tr><td class="l">' +
      btn('btn-lang', 'lang', S.language + ': ' + D.langs[lang].name) +
      '</td><td class="c">' + btn('btn-code', 'code', S.codeButton) +
      '</td><td class="r" id="home-pager">' + pager('home', 0, 2) + '</td></tr></table></div>');
    var list = $('home-list'), foot = $('home-foot');
    var avail = L.H - L.m - topOf(list) - foot.offsetHeight - 4;
    var pages = paginate(measureHeights(items, list.offsetWidth), avail);
    if (homePage >= pages.length) homePage = pages.length - 1;
    if (homePage < 0) homePage = 0;
    homeCache = { items: items, pages: pages };
    fillHome();
  }

  function fillHome() {
    var h = [], pg = homeCache.pages[homePage], i;
    for (i = 0; i < pg.length; i++) h.push('<div class="mi">' + homeCache.items[pg[i]] + '</div>');
    $('home-list').innerHTML = h.join('');
    $('home-pager').innerHTML = pager('home', homePage, homeCache.pages.length);
  }

  /* ---------- language ---------- */

  function renderLanguage() {
    screen = 'language';
    L = layout();
    var h = '<div id="langs"><div class="apptitle">' + esc(S.appTitle) + '</div><div class="sect">' + esc(S.chooseLanguage) + '</div>', i, code;
    for (i = 0; i < D.langOrder.length; i++) {
      code = D.langOrder[i];
      h += '<div class="lang-row' + (code === lang ? ' sel' : '') + '" data-act="setlang"' + attr('lang', code) + ' id="lang-' + esc(code) + '">' +
        ball(code === lang) + ' ' + esc(D.langs[code].name) + '</div>';
    }
    h += '<table class="bar"><tr><td class="l" style="padding-top:' + L.B + 'px">' + btn('btn-back', 'back', S.back) + '</td></tr></table></div>';
    show(h);
  }

  /* ---------- message screen (generation) ---------- */

  function renderMessage(id, msg, withBack) {
    screen = 'message';
    L = layout();
    show('<div id="' + id + '"><div class="apptitle">' + esc(S.appTitle) + '</div><div class="center">' + esc(msg) + '</div>' +
      (withBack ? '<table class="bar"><tr><td class="l">' + btn('btn-back', 'back', S.back) + '</td></tr></table>' : '') + '</div>');
  }

  /* ---------- code keypad ---------- */

  function codeShown(d) { return d.length > 3 ? d.slice(0, 3) + '-' + d.slice(3) : d; }

  function renderCode() {
    screen = 'code';
    L = layout();
    var kw = Math.floor(L.inner / 3), kh = Math.min(Math.round(kw * 0.6), Math.floor(L.H * 0.11));
    var kf = Math.round(kh * 0.4), df = Math.round(L.B * 1.6), rows = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['del', '0', 'ok']];
    var h = '<div id="code-screen"><div class="apptitle">' + esc(S.appTitle) + '</div><div class="sect">' + esc(S.enterCode) + '</div>' +
      '<div id="code-display" style="font-size:' + df + 'px;height:' + Math.round(df * 1.4) + 'px;line-height:' + Math.round(df * 1.4) + 'px">' +
      (codeDigits ? esc(codeShown(codeDigits)) : '&nbsp;') + '</div><div id="code-msg"></div><table class="keys" id="keys">', r, c, k;
    for (r = 0; r < rows.length; r++) {
      h += '<tr>';
      for (c = 0; c < 3; c++) {
        k = rows[r][c];
        h += '<td class="key" id="key-' + k + '" data-act="key" data-k="' + k + '" style="height:' + kh + 'px;font-size:' +
          (k === 'del' || k === 'ok' ? Math.round(kf * 0.75) : kf) + 'px">' +
          esc(k === 'del' ? S.keyDel : k === 'ok' ? S.keyOk : k) + '</td>';
      }
      h += '</tr>';
    }
    h += '</table><table class="bar"><tr><td class="l">' + btn('btn-back', 'back', S.back) + '</td></tr></table></div>';
    show(h);
  }

  function codeMsg(s) {
    var el = $('code-msg');
    if (el) el.innerHTML = s ? esc(s) : '';
  }

  function tapKey(k) {
    var el;
    if (k === 'ok') { codeOk(); return; }
    if (k === 'del') codeDigits = codeDigits.slice(0, -1);
    else if (/^[0-9]$/.test(k) && codeDigits.length < 14) codeDigits += k;
    el = $('code-display');
    if (el) el.innerHTML = codeDigits ? esc(codeShown(codeDigits)) : '&nbsp;';
    codeMsg('');
  }

  /* Opens the case of the typed code: resumes its slot when it holds the same
     unsolved case, otherwise generates it into the slot (like "New case"). */
  function codeOk() {
    var digits = codeDigits;
    codeMsg(S.generating);
    setTimeout(function () {
      var r = D.caseFromCode(digits), pack, setting, langs, slot, t;
      if (screen !== 'code') return;
      if (!r.ok) { codeMsg(r.error === 'version' ? S.codeVersion : S.codeInvalid); return; }
      pack = D.packs[r.pack];
      setting = findById(pack.settings, r.setting);
      langs = D.available(r.pack, 'setting', r.setting);
      if (langs.indexOf(lang) < 0) {
        codeMsg(fmt(S.notAvailable, { langs: langs.length ? langs.join(', ').toUpperCase() : '-' }));
        return;
      }
      slot = genSlot(r.pack, setting, r.d);
      if (slot && slot.done !== true && isObj(slot['case'].gen) && slot['case'].gen.seed === r.seed) {
        openIntro(genTarget(r.pack, setting, r.d, slot['case']));
        return;
      }
      t = genTarget(r.pack, setting, r.d, r.cj);
      t.marks = zeros(markLen(t.cp));
      t.struck = [];
      t.undo = [];
      t.done = false;
      t.mode = errModePref();
      t.errors = 0;
      saveProgress(t);
      openIntro(t);
    }, 50);
  }

  /* ---------- intro ---------- */

  function openIntro(t) {
    var p = loadProgress(t);
    t.marks = p.m;
    t.struck = p.s;
    t.undo = p.u;
    t.done = p.done;
    t.errors = p.n;
    /* the mode is chosen on the intro while there is no progress; the last choice is pre-selected */
    t.mode = hasProgress(p) ? p.e : errModePref();
    t.flash = null;
    t.code = D.codeOf(t.pack, t.cj);
    t.cluePage = 0;
    cur = t;
    renderIntro();
  }

  function modeBtnClass(t, v) { return 'btn mode' + (t.mode === v ? ' sel' : ''); }

  function renderIntro() {
    screen = 'intro';
    L = layout();
    var t = cur, prog = hasProgress({ m: t.marks, s: t.struck, done: t.done, n: t.errors }), mode;
    if (prog) {
      mode = '<div id="intro-mode">' + esc(S.modeTitle + ': ' + (t.mode === 1 ?
        fmt(S.modeErrors, { m: ERR_MAX }) + ', ' + fmt(S.errorCount, { n: t.errors, m: ERR_MAX }) : S.modeFree)) + '</div>';
    } else {
      mode = '<div class="sect">' + esc(S.modeTitle) + '</div><div class="modes">' +
        '<div class="' + modeBtnClass(t, 0) + '" id="mode-free" data-act="mode" data-mode="0">' + esc(S.modeFree) + '</div>' +
        '<div class="' + modeBtnClass(t, 1) + '" id="mode-errors" data-act="mode" data-mode="1">' + esc(fmt(S.modeErrors, { m: ERR_MAX })) + '</div></div>';
    }
    show('<div id="intro"><div class="h1" id="intro-title">' + esc(targetTitle(t)) + '</div><div>' + balls(t.cj.difficulty) + '</div>' +
      '<div class="sect">' + esc(S.story) + '</div><div class="story" id="intro-story">' + esc(targetStory(t)) + '</div>' + mode +
      '<table class="bar"><tr><td class="l">' + btn('btn-back', 'back', S.back) + '</td><td class="r">' +
      btn('btn-start', 'start', prog ? S.resume : S.start, 'big') +
      '</td></tr></table></div>');
  }

  function setMode(v) {
    var t = cur, a = $('mode-free'), b = $('mode-errors');
    if ((v !== 0 && v !== 1) || !a || !b) return;
    t.mode = v;
    setItem('errmode', v === 1 ? '1' : '0');
    a.className = modeBtnClass(t, 0);
    b.className = modeBtnClass(t, 1);
  }

  /* ---------- game ---------- */

  function cellClass(R, j, n, mark) {
    return 'cell m' + mark + (j % n === 0 ? ' bl' : '') + (R >= n && R % n === 0 ? ' bt' : '');
  }

  function paintCell(t, R, j) {
    var td = $('cell-' + R + '-' + j);
    if (td) td.className = cellClass(R, j, t.cp.n, t.marks[markIndex(t.cp, R, j)]);
  }

  function toolsHtml(t) {
    var ds = Math.round(L.B * 0.5), dr = Math.round(ds / 2) + 1, h = '', v, inner;
    for (v = 1; v <= 2; v++) {
      if (v === 1) inner = 'X';
      else inner = '<span class="tdot" style="width:' + ds + 'px;height:' + ds + 'px;-webkit-border-radius:' + dr + 'px;border-radius:' + dr + 'px"></span>';
      h += '<div class="btn tool' + (tool === v ? ' sel' : '') + '" id="tool-' + TOOL_IDS[v] + '" data-act="tool" data-tool="' + v + '">' + inner + '</div>';
    }
    h += '<div class="' + autoClass() + '" id="btn-auto" data-act="auto">' + esc(S.autoExclude) + '</div>';
    return h + '<div class="btn undo' + (undoable(t) ? '' : ' off') + '" id="btn-undo" data-act="undo">' + esc(S.undo) + '</div>';
  }

  function autoClass() { return 'btn tool auto' + (autoOn ? ' sel' : ''); }

  function toggleAuto() {
    var el = $('btn-auto');
    autoOn = !autoOn;
    setItem('auto', autoOn ? '1' : '0');
    if (el) el.className = autoClass();
  }

  function undoable(t) { return !t.done && t.undo.length > 0; }

  function setUndoBtn() {
    var el = $('btn-undo');
    if (el) el.className = 'btn undo' + (undoable(cur) ? '' : ' off');
  }

  /* {code, flash, text, warn}: code = the case code line (generated cases) or
     null; flash = the error-mode message of the last tap or null. */
  function statusText(t) {
    var code = t.code ? fmt(S.codeLabel, { code: t.code }) : null, fl;
    if (t.done) return { code: code, flash: null, text: S.solvedTitle, warn: true };
    if (D.engine.checkGrid(t.cp, t.marks.join('')) === 'wrong') return { code: code, flash: null, text: S.wrongGrid, warn: true };
    if (t.mode === 1) {
      fl = t.flash === 'wrong' ? S.wrongMark : t.flash === 'restart' ? fmt(S.errorRestart, { m: ERR_MAX }) : null;
      return { code: code, flash: fl, text: fmt(S.errorCount, { n: t.errors, m: ERR_MAX }), warn: false };
    }
    return { code: code, flash: null, text: S.legend, warn: false };
  }

  function statusHtml(st) {
    return (st.code !== null ? '<div id="game-code">' + esc(st.code) + '</div>' : '') +
      (st.flash !== null ? '<div id="status-flash">' + esc(st.flash) + '</div>' : '') +
      '<div id="status-msg">' + esc(st.text) + '</div>';
  }

  function renderGame() {
    screen = 'game';
    L = layout();
    var t = cur, cp = t.cp, k = cp.k, n = cp.n, cols = cp.nv, cj = t.cj, tx = textFor(t.pack, lang);
    var lex = tx ? tx.lexicon : {}, labelCol = L.labelCol, c, i, r, j, h, b, R, x;
    var rows = cols;  /* the staircase has (k - 1) * n rows, as many as columns */
    var cell = Math.floor((L.inner - labelCol - (cols + 3 * (k - 1) + 8)) / cols);
    var capH = Math.min(Math.round(L.H * 0.06), Math.floor(L.H * 0.55 / rows));
    if (cell > capH) cell = capH;
    var rf = Math.min(Math.round(L.B * 0.85), Math.floor(cell * 0.7));
    var lh = Math.round(rf * 1.2);
    var hf = Math.round(L.B * 0.8);
    var shorts = [], names = [];
    function catName(ci) {
      var lc = lex[cj.categories[ci].id];
      return lc && lc.name ? lc.name : cj.categories[ci].id;
    }
    function itemShort(ci, ii) {
      var lc = lex[cj.categories[ci].id], e = lc && lc.items ? lc.items[cj.categories[ci].items[ii]] : null;
      return e && e.short ? e.short : cj.categories[ci].items[ii];
    }
    for (c = 1; c < k; c++) {
      names.push(catName(c));
      for (i = 0; i < n; i++) shorts.push(itemShort(c, i));
    }
    var widths = measureWidths(shorts, 'font-weight:bold;font-size:' + rf + 'px'), maxW = 0;
    for (i = 0; i < widths.length; i++) if (widths[i] > maxW) maxW = widths[i];
    var hh = maxW + 14;

    /* left side: a narrow column with the rotated band name, then the item labels */
    var bandH = n * cell, bandNames = [], bandW, bf0 = Math.min(hf, Math.max(9, Math.floor(cell * 0.8))), bf = bf0;
    for (b = 0; b < k - 1; b++) bandNames.push(catName(bandCat(cp, b)));
    bandW = measureWidths(bandNames, 'font-weight:bold;font-size:' + bf0 + 'px');
    maxW = 0;
    for (b = 0; b < bandW.length; b++) if (bandW[b] > maxW) maxW = bandW[b];
    if (maxW > bandH - 8) bf = Math.max(8, Math.floor(bf0 * (bandH - 8) / maxW));
    var blh = Math.round(bf * 1.2), bw = blh + 4;
    var lf = Math.min(Math.round(L.B * 0.9), Math.max(10, Math.floor(cell * 0.75)));
    var rowLabels = [];
    for (b = 0; b < k - 1; b++) for (i = 0; i < n; i++) rowLabels.push(itemShort(bandCat(cp, b), i));
    var lw = measureWidths(rowLabels, 'font-weight:bold;font-size:' + lf + 'px'), lblW = labelCol - bw - 4 - Math.round(lf * 0.4);
    maxW = 0;
    for (i = 0; i < lw.length; i++) if (lw[i] > maxW) maxW = lw[i];
    if (maxW > lblW) lf = Math.max(8, Math.floor(lf * lblW / maxW));

    h = '<table class="bar" id="topbar"><tr><td class="l">' + btn('btn-menu', 'menu', S.menu) + '</td><td class="c" id="tools">' +
      toolsHtml(t) + '</td><td class="r">' + btn('btn-reset', 'reset', S.reset) + '</td></tr></table>';
    h += '<table class="grid" id="grid"><tr><th class="corner" colspan="2" rowspan="2" style="font-size:' + hf + 'px">' +
      '<div id="game-title" style="width:' + (labelCol - 10) + 'px">' + esc(targetTitle(t)) + '</div></th>';
    for (c = 1; c < k; c++) h += '<th class="cat bl" colspan="' + n + '" style="font-size:' + hf + 'px">' + esc(names[c - 1]) + '</th>';
    h += '</tr><tr>';
    for (j = 0; j < cols; j++) {
      h += '<th class="rh' + (j % n === 0 ? ' bl' : '') + '"><div class="rw" style="width:' + cell + 'px;height:' + hh + 'px">' +
        '<span class="rot" style="font-size:' + rf + 'px;line-height:' + lh + 'px;left:' + Math.floor((cell - lh) / 2) + 'px;top:' + (hh - 6) + 'px">' +
        esc(shorts[j]) + '</span></div></th>';
    }
    h += '</tr>';
    var xs = Math.round(cell * 0.65), ds = Math.round(cell * 0.45), dr = Math.round(ds / 2) + 1;
    for (b = 0; b < k - 1; b++) {
      var blocks = bandBlocks(cp, b), bwid = Math.ceil(bandW[b] * bf / bf0);
      for (i = 0; i < n; i++) {
        R = b * n + i;
        x = b > 0 && i === 0 ? ' bt' : '';
        h += '<tr>';
        if (i === 0) {
          h += '<th class="band' + x + '" rowspan="' + n + '" style="width:' + bw + 'px"><div class="rw" style="width:' + bw + 'px;height:' + bandH + 'px">' +
            '<span class="rot" style="font-size:' + bf + 'px;line-height:' + blh + 'px;left:' + Math.floor((bw - blh) / 2) + 'px;top:' +
            Math.floor((bandH + bwid) / 2) + 'px">' + esc(bandNames[b]) + '</span></div></th>';
        }
        h += '<th class="lbl' + x + '" style="font-size:' + lf + 'px;height:' + cell + 'px;width:' + lblW + 'px">' + esc(rowLabels[R]) + '</th>';
        for (j = 0; j < blocks * n; j++) {
          h += '<td id="cell-' + R + '-' + j + '" class="' + cellClass(R, j, n, t.marks[markIndex(cp, R, j)]) + '" data-act="cell" data-r="' + R + '" data-j="' + j +
            '" style="width:' + cell + 'px;height:' + cell + 'px"><span class="x" style="font-size:' + xs + 'px">X</span>' +
            '<span class="dot" style="width:' + ds + 'px;height:' + ds + 'px;-webkit-border-radius:' + dr + 'px;border-radius:' + dr + 'px"></span></td>';
        }
        if (i === 0 && blocks < k - 1) {
          h += '<td class="void bl bt" rowspan="' + n + '" colspan="' + ((k - 1 - blocks) * n) + '">';
          /* the status line sits in the empty corner of the last band, so the clue panel keeps the space */
          if (b === k - 2) {
            var st = statusText(t), sf = Math.round(L.B * 0.8), pad = Math.round(sf * 0.5);
            h += '<div id="status" class="status' + (st.warn ? ' warn' : '') + '" style="font-size:' + sf + 'px;padding:' + pad + 'px;width:' +
              ((k - 1 - blocks) * n * (cell + 1) - 2 * pad - 4) + 'px;height:' + (n * (cell + 1) - 2 * pad - 4) + 'px">' + statusHtml(st) + '</div>';
          }
          h += '</td>';
        }
        h += '</tr>';
      }
    }
    h += '</table>';
    h += '<table class="bar sb" id="clue-bar"><tr><td class="l sbl">' + esc(S.clues) + '</td><td class="r" id="clue-pager">' + pager('clue', 0, 2) + '</td></tr></table>';
    h += '<div id="clues"></div>';
    h += '<div id="solved" class="overlay" style="display:none;width:' + L.W + 'px;height:' + L.H + 'px"><div class="obox" id="solved-box" style="width:' +
      Math.round(L.W * 0.7) + 'px"><div class="h1">' + esc(S.solvedTitle) + '</div><div class="msg">' +
      esc(S.solvedMsg) + '</div>' + (t.code ? '<div class="msg" id="solved-code">' + esc(fmt(S.codeLabel, { code: t.code })) + '</div>' : '') +
      btn('btn-solved-menu', 'menu', S.menu, 'big') + '</div></div>';
    resetArmed = false;
    show(h);

    /* clue pages, measured at the panel's width */
    var texts = [], items = [];
    for (i = 0; i < cj.clues.length; i++) {
      var s = D.renderClue(t.pack, lang, cj, cj.clues[i]);
      texts.push(s === null ? '' : s);
      items.push(clueHtml(i, texts[i], false));
    }
    var panel = $('clues');
    var avail = L.H - L.m - topOf(panel) - 2;
    t.clueTexts = texts;
    t.cluePages = paginate(measureHeights(items, panel.offsetWidth), avail);
    if (t.cluePage >= t.cluePages.length) t.cluePage = t.cluePages.length - 1;
    if (t.cluePage < 0) t.cluePage = 0;
    fillClues();
  }

  function isStruck(t, q) { return t.struck.indexOf(q) >= 0; }

  function clueHtml(q, text, struck) {
    return '<div class="clue' + (struck ? ' struck' : '') + '" id="clue-' + q + '" data-act="clue" data-q="' + q + '">' +
      '<span class="cn">' + (q + 1) + '.</span> <span class="ct">' + esc(text) + '</span></div>';
  }

  function fillClues() {
    var t = cur, pg = t.cluePages[t.cluePage], h = [], i;
    for (i = 0; i < pg.length; i++) h.push('<div class="mi">' + clueHtml(pg[i], t.clueTexts[pg[i]], isStruck(t, pg[i])) + '</div>');
    $('clues').innerHTML = h.join('');
    $('clue-pager').innerHTML = pager('clue', t.cluePage, t.cluePages.length);
  }

  function setStatus() {
    var st = statusText(cur), el = $('status');
    el.className = 'status' + (st.warn ? ' warn' : '');
    el.innerHTML = statusHtml(st);
  }

  /* Shows the solved box over the clue panel, so the finished grid stays visible. */
  function showSolved() {
    var ov = $('solved'), box = $('solved-box'), top;
    ov.style.display = 'block';
    top = Math.round(topOf($('clue-bar')));
    if (top + box.offsetHeight > L.H - L.m) top = Math.max(0, L.H - L.m - box.offsetHeight);
    box.style.marginTop = top + 'px';
  }

  function pushUndo(t, e) {
    t.undo.push(e);
    if (t.undo.length > UNDO_MAX) t.undo.shift();
  }

  /* Saves and refreshes the status after the marks changed; detects the solution. */
  function afterMarks(t) {
    if (D.engine.checkGrid(t.cp, t.marks.join('')) === 'solved') {
      t.done = true;
      saveProgress(t);
      setStatus();
      setUndoBtn();
      showSolved();
      return;
    }
    saveProgress(t);
    setStatus();
    setUndoBtn();
  }

  /* True when the answer of cell (R, j) is yes (the row item and the column
     item belong to the same suspect). */
  function isYes(cp, R, j) {
    var n = cp.n, b = Math.floor(R / n);
    if (b === 0) return cp.sol[j] === R;
    return cp.sol[(cp.k - b - 1) * n + (R % n)] === cp.sol[j];
  }

  /* Error mode: the 5th wrong mark clears the case (the mode stays). */
  function restartAfterErrors(t) {
    t.marks = zeros(markLen(t.cp));
    t.struck = [];
    t.undo = [];
    t.errors = 0;
    t.done = false;
    t.cluePage = 0;
    t.flash = 'restart';
    saveProgress(t);
    renderGame();
  }

  /* A tap on a mark erases it; a tap on an empty cell writes the selected
     tool's mark (in error mode a wrong mark is rejected and counted). With
     auto-exclude, a dot also puts X on the empty cells of its row and column
     inside the block. Each tap is one undo entry with every cell it changed. */
  function tapCell(R, j) {
    var t = cur, cp = t.cp, idx = markIndex(cp, R, j), old, e, n, x, ix;
    if (t.done || idx < 0) return;
    old = t.marks[idx];
    t.flash = null;
    if (old !== '0') {
      t.marks[idx] = '0';
      paintCell(t, R, j);
      pushUndo(t, ['m', R, j, parseInt(old, 10)]);
      afterMarks(t);
      return;
    }
    if (t.mode === 1 && (tool === 1) === isYes(cp, R, j)) {
      t.errors++;
      if (t.errors >= ERR_MAX) { restartAfterErrors(t); return; }
      t.flash = 'wrong';
      saveProgress(t);
      setStatus();
      return;
    }
    t.marks[idx] = String(tool);
    paintCell(t, R, j);
    e = ['m', R, j, 0];
    if (tool === 2 && autoOn) {
      n = cp.n;
      for (x = Math.floor(j / n) * n; x < Math.floor(j / n) * n + n; x++) {
        ix = markIndex(cp, R, x);
        if (x !== j && ix >= 0 && t.marks[ix] === '0') { t.marks[ix] = '1'; paintCell(t, R, x); e.push(R, x, 0); }
      }
      for (x = Math.floor(R / n) * n; x < Math.floor(R / n) * n + n; x++) {
        ix = markIndex(cp, x, j);
        if (x !== R && ix >= 0 && t.marks[ix] === '0') { t.marks[ix] = '1'; paintCell(t, x, j); e.push(x, j, 0); }
      }
    }
    pushUndo(t, e);
    afterMarks(t);
  }

  function toggleStrike(t, q) {
    var at = t.struck.indexOf(q), el;
    if (at >= 0) t.struck.splice(at, 1);
    else t.struck.push(q);
    el = $('clue-' + q);
    if (el) el.className = 'clue' + (at >= 0 ? '' : ' struck');
  }

  function tapClue(q) {
    var t = cur;
    if (q < 0 || q >= t.cj.clues.length) return;
    toggleStrike(t, q);
    if (!t.done) pushUndo(t, ['s', q]);
    saveProgress(t);
    setUndoBtn();
  }

  /* Reverts the last action: every cell it changed, or its strike toggle. */
  function tapUndo() {
    var t = cur, e, x, R, j;
    if (!undoable(t)) return;
    e = t.undo.pop();
    t.flash = null;
    if (e[0] === 's') {
      toggleStrike(t, e[1]);
      saveProgress(t);
      setUndoBtn();
      return;
    }
    for (x = e.length - 3; x >= 1; x -= 3) {
      R = e[x];
      j = e[x + 1];
      t.marks[markIndex(t.cp, R, j)] = String(e[x + 2]);
      paintCell(t, R, j);
    }
    afterMarks(t);
  }

  function selectTool(v) {
    var x, el;
    if (v !== 1 && v !== 2) return;
    tool = v;
    for (x = 1; x <= 2; x++) {
      el = $('tool-' + TOOL_IDS[x]);
      if (el) el.className = 'btn tool' + (x === v ? ' sel' : '');
    }
  }

  function tapReset() {
    var t = cur, el = $('btn-reset');
    if (!resetArmed) {
      resetArmed = true;
      if (el) el.innerHTML = esc(S.resetConfirm);
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(function () {
        resetArmed = false;
        var b = $('btn-reset');
        if (b && screen === 'game') b.innerHTML = esc(S.reset);
      }, 4000);
      return;
    }
    resetArmed = false;
    if (resetTimer) clearTimeout(resetTimer);
    t.marks = zeros(markLen(t.cp));
    t.struck = [];
    t.undo = [];
    t.done = false;
    t.errors = 0;
    t.flash = null;
    t.cluePage = 0;
    saveProgress(t);
    renderGame();
  }

  /* ---------- generation ---------- */

  function startGen(pid, sid, d) {
    var pack = own(D.packs, pid) ? D.packs[pid] : null, setting = pack ? findById(pack.settings, sid) : null;
    if (!setting || !D.engine.supports(setting, d)) return;
    renderMessage('generating', S.generating, false);
    setTimeout(function () {
      /* 6-digit seeds from 127774 up: smaller seeds keep the first random draw
         below 0.78 (seed * 16807 < 2^31 - 1) and skew the category choice. */
      var seed = Date.now() % 872226 + 127774, cj = null, t;
      try { cj = D.engine.generate(setting, d, seed); } catch (e) { D.log('generate failed: ' + e); cj = null; }
      if (!cj || D.engine.validateCase(cj) !== null) {
        renderMessage('genfail', S.generateFailed, true);
        return;
      }
      t = genTarget(pid, setting, d, cj);
      t.marks = zeros(markLen(t.cp));
      t.struck = [];
      t.undo = [];
      t.done = false;
      t.mode = errModePref();
      t.errors = 0;
      saveProgress(t);
      openIntro(t);
    }, 50);
  }

  function continueGen(pid, sid, d) {
    var pack = own(D.packs, pid) ? D.packs[pid] : null, setting = pack ? findById(pack.settings, sid) : null, slot;
    if (!setting) return;
    slot = genSlot(pid, setting, d);
    if (!slot) return;
    openIntro(genTarget(pid, setting, d, slot['case']));
  }

  /* ---------- events ---------- */

  function num(el, name) { return parseInt(el.getAttribute('data-' + name), 10); }

  function onClick(ev) {
    ev = ev || root.event;
    var el = ev.target || ev.srcElement, act, pack, c;
    while (el && (el.nodeType !== 1 || !el.getAttribute('data-act'))) {
      el = el.parentNode;
      if (el === doc || el === null) return;
    }
    if (!el) return;
    act = el.getAttribute('data-act');
    switch (act) {
      case 'case':
        pack = D.packs[el.getAttribute('data-pack')];
        c = pack ? findById(pack.cases, el.getAttribute('data-case')) : null;
        if (c && D.available(pack.id, 'case', c.id).indexOf(lang) >= 0) openIntro(caseTarget(pack.id, c));
        break;
      case 'gen':
        startGen(el.getAttribute('data-pack'), el.getAttribute('data-setting'), num(el, 'd'));
        break;
      case 'cont':
        continueGen(el.getAttribute('data-pack'), el.getAttribute('data-setting'), num(el, 'd'));
        break;
      case 'hprev':
        if (homePage > 0) { homePage--; fillHome(); }
        break;
      case 'hnext':
        if (homeCache && homePage < homeCache.pages.length - 1) { homePage++; fillHome(); }
        break;
      case 'lang':
        back = renderHome;
        renderLanguage();
        break;
      case 'setlang':
        c = el.getAttribute('data-lang');
        if (own(D.langs, c)) {
          setLang(c);
          setItem('lang', c);
        }
        (back || renderHome)();
        break;
      case 'back':
        if (screen === 'language') (back || renderHome)();
        else renderHome();
        break;
      case 'start':
        if (cur) renderGame();
        break;
      case 'menu':
        renderHome();
        break;
      case 'reset':
        if (cur && screen === 'game') tapReset();
        break;
      case 'cell':
        if (cur && screen === 'game') tapCell(num(el, 'r'), num(el, 'j'));
        break;
      case 'clue':
        if (cur && screen === 'game') tapClue(num(el, 'q'));
        break;
      case 'tool':
        if (cur && screen === 'game') selectTool(num(el, 'tool'));
        break;
      case 'undo':
        if (cur && screen === 'game') tapUndo();
        break;
      case 'auto':
        if (cur && screen === 'game') toggleAuto();
        break;
      case 'mode':
        if (cur && screen === 'intro') setMode(num(el, 'mode'));
        break;
      case 'code':
        codeDigits = '';
        renderCode();
        break;
      case 'key':
        if (screen === 'code') tapKey(el.getAttribute('data-k'));
        break;
      case 'cprev':
        if (cur && cur.cluePage > 0) { cur.cluePage--; fillClues(); }
        break;
      case 'cnext':
        if (cur && cur.cluePage < cur.cluePages.length - 1) { cur.cluePage++; fillClues(); }
        break;
    }
  }

  function start() {
    doc.onclick = onClick;
    autoOn = getItem('auto') === '1';
    setLang(pickLang());
    L = layout();
    if (!lang) {
      show('<div class="apptitle">Deduko</div>');
      return;
    }
    renderHome();
  }

  D.ui = { start: start };
})(this);
