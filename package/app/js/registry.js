/*
 * Deduko registry: languages, packs and pack texts, plus the sequential
 * script loader driven by window.DEDUKO_INDEX. ES5 only.
 * Invalid input is logged and skipped, never thrown.
 */
(function (root) {
  var D = root.DEDUKO = root.DEDUKO || {};
  var ID_RX = /^[a-z0-9_]+$/;
  var PACK_RX = /^[a-z0-9_-]+$/;
  var LANG_RX = /^[a-z]{2,3}(-[a-z0-9]+)?$/;

  D.langs = {};
  D.langOrder = [];
  D.packs = {};
  D.packOrder = [];
  D.texts = {};
  D.messages = [];
  /* Setting code (1-9, the S digit of a case code) -> {pack, setting} ids. */
  D.codes = {};

  function own(o, k) { return o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k); }
  function isArray(x) { return Object.prototype.toString.call(x) === '[object Array]'; }
  function isObj(x) { return x !== null && typeof x === 'object' && !isArray(x); }

  function log(msg) {
    D.messages.push(msg);
    try { if (root.console && root.console.log) root.console.log('DEDUKO: ' + msg); } catch (e) {}
  }
  D.log = log;

  function strList(a) {
    if (!isArray(a)) return false;
    for (var i = 0; i < a.length; i++) if (typeof a[i] !== 'string') return false;
    return true;
  }

  D.addLanguage = function (def) {
    try {
      if (!isObj(def) || typeof def.code !== 'string' || !LANG_RX.test(def.code)) { log('language rejected: bad code'); return false; }
      if (typeof def.name !== 'string' || !def.name) { log('language ' + def.code + ' rejected: no name'); return false; }
      if (!isObj(def.strings)) { log('language ' + def.code + ' rejected: no strings'); return false; }
      if (typeof def.renderClue !== 'function') { log('language ' + def.code + ' rejected: no renderClue'); return false; }
      var f = def.fields;
      if (!isObj(f) || !strList(f.suspect) || !strList(f.item) || !strList(f.ordered)) { log('language ' + def.code + ' rejected: bad fields'); return false; }
      if (own(D.langs, def.code)) { log('language ' + def.code + ' already loaded, ignored'); return false; }
      D.langs[def.code] = def;
      D.langOrder.push(def.code);
      return true;
    } catch (e) {
      log('language rejected: ' + e);
      return false;
    }
  };

  function validateSetting(s) {
    var c, i, ids = {}, keys;
    if (!isObj(s) || typeof s.id !== 'string' || !ID_RX.test(s.id)) return 'bad setting id';
    if (!isArray(s.categories) || s.categories.length < 3) return 'setting ' + s.id + ' needs at least 3 categories';
    for (c = 0; c < s.categories.length; c++) {
      var cat = s.categories[c];
      if (!isObj(cat) || typeof cat.id !== 'string' || !ID_RX.test(cat.id) || own(ids, cat.id)) return 'setting ' + s.id + ': bad category ' + c;
      ids[cat.id] = true;
      if (cat.ordered !== undefined && typeof cat.ordered !== 'boolean') return 'setting ' + s.id + ': bad ordered flag';
      if (c === 0 && cat.ordered) return 'setting ' + s.id + ': suspect category cannot be ordered';
      if (!isArray(cat.items)) return 'setting ' + s.id + ': bad items';
      keys = {};
      for (i = 0; i < cat.items.length; i++) {
        if (typeof cat.items[i] !== 'string' || !ID_RX.test(cat.items[i]) || own(keys, cat.items[i])) return 'setting ' + s.id + ': bad item ' + cat.items[i];
        keys[cat.items[i]] = true;
      }
    }
    for (var d = 1; d <= 5; d++) if (D.engine.supports(s, d)) return null;
    return 'setting ' + s.id + ' supports no difficulty';
  }

  /* Registers the optional setting code; a bad or duplicate code is logged
     and dropped from the stored copy, the setting stays playable. */
  function acceptCode(pid, s) {
    if (!own(s, 'code')) return s;
    var x = s.code, k, copy;
    if (typeof x === 'number' && x === Math.floor(x) && x >= 1 && x <= 9 && !own(D.codes, String(x))) {
      D.codes[x] = { pack: pid, setting: s.id };
      return s;
    }
    log('pack ' + pid + ': setting ' + s.id + ': code ' + x + ' ignored');
    copy = {};
    for (k in s) if (own(s, k) && k !== 'code') copy[k] = s[k];
    return copy;
  }

  D.addPack = function (json) {
    try {
      if (!D.engine) { log('pack rejected: engine not loaded'); return false; }
      if (!isObj(json) || json.format !== 1) { log('pack rejected: bad format'); return false; }
      if (typeof json.id !== 'string' || !PACK_RX.test(json.id)) { log('pack rejected: bad id'); return false; }
      if (own(D.packs, json.id)) { log('pack ' + json.id + ' already registered, ignored'); return false; }
      var pack = { id: json.id, version: isArray(json.version) ? json.version : [0, 0, 0], cases: [], settings: [] };
      var seen = {}, q, err;
      var cases = isArray(json.cases) ? json.cases : [];
      for (q = 0; q < cases.length; q++) {
        err = D.engine.validateCase(cases[q]);
        if (!err && own(seen, cases[q].id)) err = 'duplicate case id';
        if (err) { log('pack ' + json.id + ': case ' + q + ' skipped: ' + err); continue; }
        seen[cases[q].id] = true;
        pack.cases.push(cases[q]);
      }
      var settings = isArray(json.settings) ? json.settings : [];
      seen = {};
      for (q = 0; q < settings.length; q++) {
        err = validateSetting(settings[q]);
        if (!err && own(seen, settings[q].id)) err = 'duplicate setting id';
        if (err) { log('pack ' + json.id + ': setting ' + q + ' skipped: ' + err); continue; }
        seen[settings[q].id] = true;
        pack.settings.push(acceptCode(json.id, settings[q]));
      }
      D.packs[json.id] = pack;
      D.packOrder.push(json.id);
      return true;
    } catch (e) {
      log('pack rejected: ' + e);
      return false;
    }
  };

  D.addPackText = function (json) {
    try {
      if (!isObj(json) || json.format !== 1) { log('pack text rejected: bad format'); return false; }
      if (typeof json.pack !== 'string' || !own(D.packs, json.pack)) { log('pack text rejected: unknown pack ' + json.pack); return false; }
      if (typeof json.lang !== 'string' || !LANG_RX.test(json.lang)) { log('pack text rejected: bad lang'); return false; }
      if (!isObj(json.lexicon)) { log('pack text ' + json.pack + '/' + json.lang + ' rejected: no lexicon'); return false; }
      if (!own(D.texts, json.pack)) D.texts[json.pack] = {};
      if (own(D.texts[json.pack], json.lang)) { log('pack text ' + json.pack + '/' + json.lang + ' already loaded, ignored'); return false; }
      D.texts[json.pack][json.lang] = {
        name: typeof json.name === 'string' ? json.name : json.pack,
        lexicon: json.lexicon,
        cases: isObj(json.cases) ? json.cases : {},
        settings: isObj(json.settings) ? json.settings : {}
      };
      return true;
    } catch (e) {
      log('pack text rejected: ' + e);
      return false;
    }
  };

  D.text = function (packId, lang) {
    return own(D.texts, packId) && own(D.texts[packId], lang) ? D.texts[packId][lang] : null;
  };

  function hasField(v) {
    if (typeof v === 'string') return v.length > 0;
    return isObj(v) && typeof v.m === 'string' && typeof v.f === 'string' && v.m.length > 0 && v.f.length > 0;
  }

  /* Returns the list of missing lexicon entries/fields (empty when covered). */
  D.missingLexicon = function (text, lang, categories) {
    var miss = [], L = D.langs[lang], c, i, x;
    if (!text || !L) return ['no text or language'];
    for (c = 0; c < categories.length; c++) {
      var cat = categories[c], lc = own(text.lexicon, cat.id) ? text.lexicon[cat.id] : null;
      if (!isObj(lc)) { miss.push(cat.id); continue; }
      if (!hasField(lc.name)) miss.push(cat.id + '.name');
      if (cat.ordered === true) {
        for (x = 0; x < L.fields.ordered.length; x++) if (!hasField(lc[L.fields.ordered[x]])) miss.push(cat.id + '.' + L.fields.ordered[x]);
      }
      var fields = c === 0 ? L.fields.suspect : L.fields.item;
      for (i = 0; i < cat.items.length; i++) {
        var e = own(lc.items, cat.items[i]) ? lc.items[cat.items[i]] : null;
        if (!isObj(e)) { miss.push(cat.id + '.' + cat.items[i]); continue; }
        for (x = 0; x < fields.length; x++) if (!hasField(e[fields[x]])) miss.push(cat.id + '.' + cat.items[i] + '.' + fields[x]);
      }
    }
    return miss;
  };

  function findById(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* kind: "case" or "setting". Returns the language codes it is playable in. */
  D.available = function (packId, kind, id) {
    var out = [], pack = own(D.packs, packId) ? D.packs[packId] : null, obj, i, code, text, entry;
    if (!pack) return out;
    obj = findById(kind === 'setting' ? pack.settings : pack.cases, id);
    if (!obj) return out;
    for (i = 0; i < D.langOrder.length; i++) {
      code = D.langOrder[i];
      text = D.text(packId, code);
      if (!text) continue;
      entry = kind === 'setting' ? (own(text.settings, id) ? text.settings[id] : null) : (own(text.cases, id) ? text.cases[id] : null);
      if (!isObj(entry) || typeof entry.title !== 'string') continue;
      if (D.missingLexicon(text, code, obj.categories).length === 0) out.push(code);
    }
    return out;
  };

  /* ---------- case codes ---------- */

  /* {pack, setting} ids for a setting code, or null. */
  D.settingByCode = function (s) {
    var k = String(s);
    if (!own(D.codes, k)) return null;
    return { pack: D.codes[k].pack, setting: D.codes[k].setting };
  };

  /* Case code of a generated case, or null (fixed case, uncoded setting). */
  D.codeOf = function (packId, caseJson) {
    var gen = isObj(caseJson) ? caseJson.gen : null, pack, st, m;
    if (!isObj(gen) || !own(gen, 'engine') || !own(gen, 'seed') || !own(gen, 'setting')) return null;
    pack = own(D.packs, packId) ? D.packs[packId] : null;
    st = pack ? findById(pack.settings, gen.setting) : null;
    if (!st || !own(st, 'code')) return null;
    m = D.settingByCode(st.code);
    if (!m || m.pack !== packId || m.setting !== st.id) return null;
    return D.engine.code.encode(gen.engine, st.code, caseJson.difficulty, gen.seed);
  };

  /* {ok:true, pack, setting, d, seed, cj} or {ok:false, error:'invalid'|'version'}. */
  D.caseFromCode = function (str) {
    var bad = { ok: false, error: 'invalid' }, r, m, pack, st, cj;
    try {
      r = D.engine.code.decode(str);
      if (!r.ok) return r;
      m = D.settingByCode(r.s);
      if (!m) return bad;
      pack = own(D.packs, m.pack) ? D.packs[m.pack] : null;
      st = pack ? findById(pack.settings, m.setting) : null;
      if (!st || !D.engine.supports(st, r.d)) return bad;
      cj = D.engine.generate(st, r.d, r.seed);
      if (!cj || D.engine.validateCase(cj) !== null) return bad;
      return { ok: true, pack: m.pack, setting: m.setting, d: r.d, seed: r.seed, cj: cj };
    } catch (e) {
      log('caseFromCode failed: ' + e);
      return bad;
    }
  };

  /* Shared head of two predicates: the longest common prefix of whole words,
     minus trailing words found in stop. {head, a, b} (a, b = remainders) or
     null when there is no head or it would take all of p or q. */
  function factor(p, q, stop) {
    if (typeof p !== 'string' || typeof q !== 'string') return null;
    var wp = p.split(' '), wq = q.split(' '), n = 0, i, st = {};
    if (isArray(stop)) for (i = 0; i < stop.length; i++) st[stop[i]] = true;
    while (n < wp.length && n < wq.length && wp[n] === wq[n]) n++;
    while (n > 0 && own(st, wp[n - 1])) n--;
    if (n === 0 || n >= wp.length || n >= wq.length) return null;
    return { head: wp.slice(0, n).join(' '), a: wp.slice(n).join(' '), b: wq.slice(n).join(' ') };
  }

  /* Context handed to a language's renderClue. */
  D.clueContext = function (packId, lang, caseJson) {
    var text = D.text(packId, lang), lex = text ? text.lexicon : {};
    var suspectCat = caseJson.categories[0].id;
    return {
      lang: lang,
      suspectCat: suspectCat,
      term: function (t) {
        var dot = t.indexOf('.'), cat = t.substring(0, dot), key = t.substring(dot + 1);
        var lc = own(lex, cat) ? lex[cat] : null;
        var e = lc && own(lc.items, key) ? lc.items[key] : null;
        return { term: t, cat: cat, key: key, suspect: cat === suspectCat, e: e, c: lc, g: e && e.g === 'f' ? 'f' : 'm' };
      },
      category: function (id) { return own(lex, id) ? lex[id] : null; },
      pick: function (v, g) {
        if (typeof v === 'string') return v;
        if (isObj(v)) return typeof v[g] === 'string' ? v[g] : v.m;
        return undefined;
      },
      factor: factor
    };
  };

  /* Renders one clue; returns null when the language cannot render it. */
  D.renderClue = function (packId, lang, caseJson, clue) {
    var L = own(D.langs, lang) ? D.langs[lang] : null;
    if (!L) return null;
    try {
      var s = L.renderClue(clue, D.clueContext(packId, lang, caseJson));
      return typeof s === 'string' ? s : null;
    } catch (e) {
      log('renderClue ' + lang + ' failed: ' + e);
      return null;
    }
  };

  function loadScript(src, cb) {
    var head = document.getElementsByTagName('head')[0] || document.documentElement;
    var s = document.createElement('script'), fired = false, timer = null;
    function fin(ok) {
      if (fired) return;
      fired = true;
      if (timer) clearTimeout(timer);
      s.onload = null;
      s.onerror = null;
      if (!ok) log('could not load ' + src);
      cb(ok);
    }
    s.onload = function () { fin(true); };
    s.onerror = function () { fin(false); };
    timer = setTimeout(function () { fin(false); }, 3000);
    s.type = 'text/javascript';
    s.charset = 'utf-8';
    s.src = src;
    head.appendChild(s);
  }

  /* Loads index.langs, then each pack dir (pack.js first, then its text
     files; the texts are skipped when pack.js registered nothing). */
  D.load = function (index, done) {
    var steps = [], i, j;
    index = isObj(index) ? index : {};
    var langs = isArray(index.langs) ? index.langs : [];
    var packs = isArray(index.packs) ? index.packs : [];
    for (i = 0; i < langs.length; i++) if (typeof langs[i] === 'string') steps.push({ src: langs[i], group: -1 });
    for (i = 0; i < packs.length; i++) {
      var p = packs[i];
      if (!isObj(p) || typeof p.dir !== 'string' || !strList(p.files)) continue;
      var hasPack = false;
      for (j = 0; j < p.files.length; j++) if (p.files[j] === 'pack.js') hasPack = true;
      if (!hasPack) { log('pack dir ' + p.dir + ' has no pack.js, skipped'); continue; }
      steps.push({ src: p.dir + 'pack.js', group: i, first: true, dir: p.dir });
      for (j = 0; j < p.files.length; j++) if (p.files[j] !== 'pack.js') steps.push({ src: p.dir + p.files[j], group: i });
    }
    var groupOk = {}, pos = 0;
    function next() {
      while (pos < steps.length && steps[pos].group >= 0 && !steps[pos].first && !groupOk[steps[pos].group]) pos++;
      if (pos >= steps.length) {
        try { if (done) done(); } catch (e) { log('load callback failed: ' + e); }
        return;
      }
      var st = steps[pos++], before = D.packOrder.length;
      loadScript(st.src, function () {
        if (st.first) {
          groupOk[st.group] = D.packOrder.length > before;
          if (groupOk[st.group]) D.packs[D.packOrder[D.packOrder.length - 1]].dir = st.dir;
        }
        setTimeout(next, 0);
      });
    }
    next();
  };
})(this);
