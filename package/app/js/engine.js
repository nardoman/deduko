/*
 * Deduko engine: case validation, propagation solver and generator.
 * ES5 only (Kindle Mesquite, WebKit 533), no DOM access.
 *
 * Internal form: the "variables" are the non-suspect items. Variable
 * j = (c - 1) * n + i is item i of category c (c >= 1); its domain is a
 * bitmask over the n suspects that may still own it. Suspect terms are
 * constants.
 */
(function (root) {
  var DEDUKO = root.DEDUKO = root.DEDUKO || {};

  var SHAPES = {
    1: { k: 3, n: 4 },
    2: { k: 3, n: 5 },
    3: { k: 4, n: 4 },
    4: { k: 4, n: 5 },
    5: { k: 5, n: 5 }
  };
  var ID_RX = /^[a-z0-9_]+$/;
  var CLUE_TERMS = {
    is: ['a', 'b'],
    not: ['a', 'b'],
    or: ['a', 'b', 'c'],
    less: ['a', 'b'],
    pair: ['a', 'b', 'c', 'd']
  };
  var WEIGHTS = [['not', 4], ['or', 2], ['less', 2], ['pair', 1], ['is', 1]];
  var POOL_SIZE = 60;
  var MAX_POOLS = 20;
  /* Generator version written into cj.gen.engine and into case codes. */
  var GEN_VERSION = 1;
  var GEN_VERSIONS = { 1: true };
  var SEED_MAX = 2147483646;
  /* Damm check digit table (rows = interim digit, columns = input digit). */
  var DAMM = ['0317598642', '7092154863', '4206871359', '1750983426', '6123045978',
    '3674209581', '5869720134', '8945362017', '9438617205', '2581436790'];

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isArray(x) { return Object.prototype.toString.call(x) === '[object Array]'; }
  function isObj(x) { return x !== null && typeof x === 'object' && !isArray(x); }
  function bitIndex(b) { var v = 0; while (b > 1) { b = b >>> 1; v++; } return v; }
  function isSingle(d) { return d !== 0 && (d & (d - 1)) === 0; }
  function numeric(a, b) { return a - b; }

  /* Park-Miller minimal standard generator; products stay below 2^53. */
  function rng(seed) {
    var M = 2147483647;
    var s = Math.floor(Number(seed));
    if (s !== s || !isFinite(s)) s = 1;
    s = s % M;
    if (s <= 0) s += M - 1;
    if (s <= 0) s = 1;
    var r = {
      next: function () {
        s = (s * 16807) % M;
        return (s - 1) / (M - 1);
      },
      int: function (n) { return Math.floor(r.next() * n); }
    };
    return r;
  }

  function shuffle(a, r) {
    var i, j, t;
    for (i = a.length - 1; i > 0; i--) {
      j = r.int(i + 1);
      t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------- compilation and validation ---------- */

  function buildBase(cj) {
    var c, i, p;
    if (!isObj(cj)) return 'case is not an object';
    if (typeof cj.id !== 'string' || !ID_RX.test(cj.id)) return 'bad case id';
    if (typeof cj.difficulty !== 'number' || !own(SHAPES, String(cj.difficulty))) return 'bad difficulty';
    var shape = SHAPES[cj.difficulty], k = shape.k, n = shape.n, cats = cj.categories;
    if (!isArray(cats) || cats.length !== k) return 'difficulty ' + cj.difficulty + ' needs ' + k + ' categories';
    var cp = {
      id: cj.id, difficulty: cj.difficulty, k: k, n: n, nv: (k - 1) * n, full: (1 << n) - 1,
      cats: [], catIndex: {}, sol: [], inv: [], clues: []
    };
    for (c = 0; c < k; c++) {
      var cat = cats[c];
      if (!isObj(cat) || typeof cat.id !== 'string' || !ID_RX.test(cat.id)) return 'bad category at index ' + c;
      if (own(cp.catIndex, cat.id)) return 'duplicate category ' + cat.id;
      if (!isArray(cat.items) || cat.items.length !== n) return 'category ' + cat.id + ' needs ' + n + ' items';
      if (cat.ordered !== undefined && typeof cat.ordered !== 'boolean') return 'category ' + cat.id + ': ordered must be boolean';
      if (c === 0 && cat.ordered) return 'the suspect category cannot be ordered';
      var index = {};
      for (i = 0; i < n; i++) {
        var key = cat.items[i];
        if (typeof key !== 'string' || !ID_RX.test(key) || own(index, key)) return 'bad item ' + cat.id + '.' + key;
        index[key] = i;
      }
      cp.catIndex[cat.id] = c;
      cp.cats.push({ id: cat.id, items: cat.items.slice(0), ordered: cat.ordered === true, index: index });
      cp.inv.push([]);
    }
    var sol = cj.solution;
    if (!isArray(sol) || sol.length !== n) return 'solution needs ' + n + ' rows';
    for (i = 0; i < cp.nv; i++) cp.sol.push(-1);
    for (p = 0; p < n; p++) {
      var row = sol[p];
      if (!isArray(row) || row.length !== k) return 'bad solution row ' + p;
      if (row[0] !== cp.cats[0].items[p]) return 'solution row ' + p + ' must start with ' + cp.cats[0].items[p];
      cp.inv[0][p] = p;
      for (c = 1; c < k; c++) {
        var ci = cp.cats[c];
        if (typeof row[c] !== 'string' || !own(ci.index, row[c])) return 'bad solution item ' + row[c];
        var it = ci.index[row[c]], j = (c - 1) * n + it;
        if (cp.sol[j] !== -1) return 'solution is not a permutation in ' + ci.id;
        cp.sol[j] = p;
        cp.inv[c][p] = it;
      }
    }
    return cp;
  }

  function parseTerm(cp, s) {
    if (typeof s !== 'string') return null;
    var dot = s.indexOf('.');
    if (dot < 1) return null;
    var cid = s.substring(0, dot), key = s.substring(dot + 1);
    if (!own(cp.catIndex, cid)) return null;
    var c = cp.catIndex[cid];
    if (!own(cp.cats[c].index, key)) return null;
    var i = cp.cats[c].index[key];
    return { c: c, i: i, v: c > 0 ? (c - 1) * cp.n + i : -1 };
  }

  function addVar(cc, v, c) {
    for (var x = 0; x < cc.vars.length; x++) if (cc.vars[x] === v) return x;
    cc.vars.push(v);
    cc.vcat.push(c);
    return cc.vars.length - 1;
  }

  function termPos(cc, tm) { return tm.c === 0 ? -(tm.i + 1) : addVar(cc, tm.v, tm.c); }

  /* Throws a string on a malformed clue. */
  function compileClue(cp, cl) {
    if (!isObj(cl)) throw 'clue is not an object';
    if (typeof cl.t !== 'string' || !own(CLUE_TERMS, cl.t)) throw 'unknown clue type ' + cl.t;
    var names = CLUE_TERMS[cl.t], T = {}, x, i;
    for (x = 0; x < names.length; x++) {
      T[names[x]] = parseTerm(cp, cl[names[x]]);
      if (!T[names[x]]) throw 'bad term ' + names[x] + '=' + cl[names[x]];
    }
    var cc = { t: cl.t, k: cp.k, vars: [], vcat: [], pa: 0, pb: 0, pc: 0, pd: 0, byPos: null };
    var by = -1;
    if (cl.t === 'is' || cl.t === 'not') {
      if (T.a.c === T.b.c) throw cl.t + ': terms in the same category';
    } else if (cl.t === 'or') {
      if (T.b.c !== T.c.c || T.b.i === T.c.i) throw 'or: b and c must be distinct items of one category';
      if (T.a.c === T.b.c) throw 'or: a must be in another category';
    } else if (cl.t === 'less') {
      if (typeof cl.by !== 'string' || !own(cp.catIndex, cl.by)) throw 'less: bad by';
      by = cp.catIndex[cl.by];
      if (!cp.cats[by].ordered) throw 'less: by is not ordered';
      if (T.a.c === by || T.b.c === by) throw 'less: terms in the by category';
      if (T.a.c === T.b.c && T.a.i === T.b.i) throw 'less: same term twice';
    } else {
      if (T.a.c !== T.b.c || T.a.i === T.b.i) throw 'pair: a and b must be distinct items of one category';
      if (T.c.c !== T.d.c || T.c.i === T.d.i) throw 'pair: c and d must be distinct items of one category';
      if (T.a.c === T.c.c) throw 'pair: both pairs in the same category';
    }
    cc.pa = termPos(cc, T.a);
    cc.pb = termPos(cc, T.b);
    if (T.c) cc.pc = termPos(cc, T.c);
    if (T.d) cc.pd = termPos(cc, T.d);
    if (by >= 0) {
      cc.byPos = [];
      for (i = 0; i < cp.n; i++) cc.byPos.push(addVar(cc, (by - 1) * cp.n + i, by));
    }
    return cc;
  }

  function val(p, vals) { return p < 0 ? -p - 1 : vals[p]; }

  function check(cc, vals) {
    var A = val(cc.pa, vals), B = val(cc.pb, vals), C, D;
    switch (cc.t) {
      case 'is': return A === B;
      case 'not': return A !== B;
      case 'or':
        C = val(cc.pc, vals);
        return A === B || A === C;
      case 'pair':
        C = val(cc.pc, vals);
        D = val(cc.pd, vals);
        return (A === C && B === D) || (A === D && B === C);
      case 'less':
        if (A === B) return false;
        var ra = -1, rb = -1, i, o;
        for (i = 0; i < cc.byPos.length; i++) {
          o = vals[cc.byPos[i]];
          if (o === A) ra = i;
          else if (o === B) rb = i;
        }
        return ra >= 0 && rb >= 0 && ra < rb;
    }
    return false;
  }

  function valsFor(cc, assignment) {
    var vals = [];
    for (var x = 0; x < cc.vars.length; x++) vals.push(assignment[cc.vars[x]]);
    return vals;
  }

  /* Returns the compiled case or an error string. */
  function build(cj) {
    var cp = buildBase(cj), q, cc;
    if (typeof cp === 'string') return cp;
    if (!isArray(cj.clues)) return 'clues must be an array';
    for (q = 0; q < cj.clues.length; q++) {
      try {
        cc = compileClue(cp, cj.clues[q]);
      } catch (e) {
        return 'clue ' + q + ': ' + (e && e.message ? e.message : e);
      }
      if (!check(cc, valsFor(cc, cp.sol))) return 'clue ' + q + ' is false in the solution';
      cp.clues.push(cc);
    }
    return cp;
  }

  function validateCase(cj) {
    var r = build(cj);
    return typeof r === 'string' ? r : null;
  }

  function compile(cj) {
    var r = build(cj);
    if (typeof r === 'string') throw new Error('invalid case: ' + r);
    return r;
  }

  /* ---------- propagation solver ---------- */

  function fullDomains(cp) {
    var d = [];
    for (var j = 0; j < cp.nv; j++) d.push(cp.full);
    return d;
  }

  function allSingle(dom) {
    for (var j = 0; j < dom.length; j++) if (!isSingle(dom[j])) return false;
    return true;
  }

  function sameDomains(a, b) {
    for (var j = 0; j < a.length; j++) if (a[j] !== b[j]) return false;
    return true;
  }

  /* Naked and hidden singles in every category; false on contradiction. */
  function singles(cp, dom, stamp, st) {
    var n = cp.n, k = cp.k, c, j, j2, p, base, d, bit, cnt, at, changed = true;
    while (changed) {
      changed = false;
      for (c = 1; c < k; c++) {
        base = (c - 1) * n;
        for (j = base; j < base + n; j++) {
          d = dom[j];
          if (d === 0) return false;
          if ((d & (d - 1)) === 0) {
            for (j2 = base; j2 < base + n; j2++) {
              if (j2 !== j && (dom[j2] & d) !== 0) {
                dom[j2] &= ~d;
                stamp[j2] = ++st.tick;
                changed = true;
                if (dom[j2] === 0) return false;
              }
            }
          }
        }
        for (p = 0; p < n; p++) {
          bit = 1 << p; cnt = 0; at = -1;
          for (j = base; j < base + n; j++) if ((dom[j] & bit) !== 0) { cnt++; at = j; }
          if (cnt === 0) return false;
          if (cnt === 1 && dom[at] !== bit) {
            dom[at] = bit;
            stamp[at] = ++st.tick;
            changed = true;
          }
        }
      }
    }
    return true;
  }

  /* Generalized arc consistency for one clue, by enumeration of its
     variables with all-different among variables of the same category. */
  function gac(cc, dom, stamp, st) {
    var vars = cc.vars, vcat = cc.vcat, m = vars.length, x;
    var dm = [], sup = [], vals = [], used = [], complete = false;
    for (x = 0; x < m; x++) { dm.push(dom[vars[x]]); sup.push(0); vals.push(-1); }
    for (x = 0; x < cc.k; x++) used.push(0);
    function rec(x) {
      if (x === m) {
        if (check(cc, vals)) {
          var all = true;
          for (var y = 0; y < m; y++) {
            sup[y] |= 1 << vals[y];
            if (sup[y] !== dm[y]) all = false;
          }
          if (all) complete = true;
        }
        return;
      }
      var c = vcat[x], avail = dm[x] & ~used[c], b;
      while (avail !== 0 && !complete) {
        b = avail & -avail;
        avail ^= b;
        vals[x] = bitIndex(b);
        used[c] |= b;
        rec(x + 1);
        used[c] ^= b;
      }
    }
    rec(0);
    for (x = 0; x < m; x++) {
      var nd = dm[x] & sup[x];
      if (nd !== dm[x]) {
        dom[vars[x]] = nd;
        stamp[vars[x]] = ++st.tick;
        if (nd === 0) return false;
      }
    }
    return true;
  }

  /* Propagates to a fixpoint. Clues with index < firstNew are assumed to be
     already consistent with dom. Returns false on contradiction. */
  function propagate(cp, dom, clues, firstNew) {
    var stamp = [], last = [], st = { tick: 0 }, i, q, again, cc, vs, stale, before;
    for (i = 0; i < cp.nv; i++) stamp.push(0);
    for (q = 0; q < clues.length; q++) last.push(q < firstNew ? 0 : -1);
    do {
      if (!singles(cp, dom, stamp, st)) return false;
      again = false;
      for (q = 0; q < clues.length; q++) {
        cc = clues[q];
        vs = cc.vars;
        stale = false;
        for (i = 0; i < vs.length; i++) if (stamp[vs[i]] > last[q]) { stale = true; break; }
        if (!stale) continue;
        before = st.tick;
        if (!gac(cc, dom, stamp, st)) return false;
        last[q] = st.tick;
        if (st.tick !== before) again = true;
      }
    } while (again);
    return true;
  }

  function solve(cp) {
    var dom = fullDomains(cp);
    var ok = propagate(cp, dom, cp.clues, 0);
    return { solved: ok && allSingle(dom), contradiction: !ok, domains: dom };
  }

  /* ---------- generator ---------- */

  function termOf(cp, p, c) { return cp.cats[c].id + '.' + cp.cats[c].items[cp.inv[c][p]]; }
  function otherInt(r, n, not) { var x = r.int(n - 1); return x >= not ? x + 1 : x; }

  function orderedCats(cp) {
    var out = [];
    for (var c = 1; c < cp.k; c++) if (cp.cats[c].ordered) out.push(c);
    return out;
  }

  function pickType(r, hasOrdered) {
    var total = 0, i, x;
    for (i = 0; i < WEIGHTS.length; i++) if (hasOrdered || WEIGHTS[i][0] !== 'less') total += WEIGHTS[i][1];
    x = r.int(total);
    for (i = 0; i < WEIGHTS.length; i++) {
      if (!hasOrdered && WEIGHTS[i][0] === 'less') continue;
      if (x < WEIGHTS[i][1]) return WEIGHTS[i][0];
      x -= WEIGHTS[i][1];
    }
    return 'not';
  }

  /* A random clue of the given type that is true in the solution. */
  function candidate(cp, r, type, ordered) {
    var k = cp.k, n = cp.n, p = r.int(n), q = otherInt(r, n, p), A, B, t, x, y, c;
    if (type === 'not') {
      A = r.int(k); B = otherInt(r, k, A);
      return { t: 'not', a: termOf(cp, p, A), b: termOf(cp, q, B) };
    }
    if (type === 'is') {
      A = r.int(k); B = otherInt(r, k, A);
      return { t: 'is', a: termOf(cp, p, A), b: termOf(cp, p, B) };
    }
    if (type === 'or') {
      A = r.int(k); B = otherInt(r, k, A);
      x = termOf(cp, p, B); y = termOf(cp, q, B);
      if (r.int(2) === 1) { t = x; x = y; y = t; }
      return { t: 'or', a: termOf(cp, p, A), b: x, c: y };
    }
    if (type === 'pair') {
      A = r.int(k); B = otherInt(r, k, A);
      x = termOf(cp, p, B); y = termOf(cp, q, B);
      if (r.int(2) === 1) { t = x; x = y; y = t; }
      return { t: 'pair', a: termOf(cp, p, A), b: termOf(cp, q, A), c: x, d: y };
    }
    var by = ordered[r.int(ordered.length)], others = [];
    if (cp.inv[by][p] > cp.inv[by][q]) { t = p; p = q; q = t; }
    for (c = 0; c < k; c++) if (c !== by) others.push(c);
    A = others[r.int(others.length)];
    B = others[r.int(others.length)];
    return { t: 'less', a: termOf(cp, p, A), b: termOf(cp, q, B), by: cp.cats[by].id };
  }

  function copyCategories(categories) {
    var out = [];
    for (var c = 0; c < categories.length; c++) {
      var cat = { id: categories[c].id };
      if (categories[c].ordered === true) cat.ordered = true;
      cat.items = categories[c].items.slice(0);
      out.push(cat);
    }
    return out;
  }

  function genCore(categories, d, r, id, gen) {
    var shape = SHAPES[d], k = shape.k, n = shape.n, c, i, p, q;
    var perms = [null];
    for (c = 1; c < k; c++) {
      var perm = [];
      for (i = 0; i < n; i++) perm.push(i);
      perms.push(shuffle(perm, r));
    }
    var solution = [];
    for (p = 0; p < n; p++) {
      var row = [categories[0].items[p]];
      for (c = 1; c < k; c++) row.push(categories[c].items[perms[c][p]]);
      solution.push(row);
    }
    var cj = { id: id, difficulty: d, categories: copyCategories(categories), solution: solution, clues: [], gen: gen };
    var cp = build(cj);
    if (typeof cp === 'string') return null;
    var ordered = orderedCats(cp), dom = fullDomains(cp), chosen = [], chosenJson = [];
    var isCount = 0, solved = false, attempt, pool, cl, cc, trial;
    for (attempt = 0; attempt < MAX_POOLS && !solved; attempt++) {
      pool = [];
      for (q = 0; q < POOL_SIZE; q++) pool.push(candidate(cp, r, pickType(r, ordered.length > 0), ordered));
      for (q = 0; q < pool.length && !solved; q++) {
        cl = pool[q];
        if (cl.t === 'is' && isCount >= n - 2) continue;
        cc = compileClue(cp, cl);
        trial = dom.slice(0);
        chosen.push(cc);
        if (!propagate(cp, trial, chosen, chosen.length - 1) || sameDomains(trial, dom)) {
          chosen.pop();
          continue;
        }
        dom = trial;
        chosenJson.push(cl);
        if (cl.t === 'is') isCount++;
        solved = allSingle(dom);
      }
    }
    if (!solved) return null;
    var order = [], keep = [], sub, dm;
    for (q = 0; q < chosen.length; q++) { order.push(q); keep.push(true); }
    shuffle(order, r);
    for (i = 0; i < order.length; i++) {
      keep[order[i]] = false;
      sub = [];
      for (q = 0; q < chosen.length; q++) if (keep[q]) sub.push(chosen[q]);
      dm = fullDomains(cp);
      if (!(propagate(cp, dm, sub, 0) && allSingle(dm))) keep[order[i]] = true;
    }
    var clues = [];
    for (q = 0; q < chosen.length; q++) if (keep[q]) clues.push(chosenJson[q]);
    cj.clues = shuffle(clues, r);
    return cj;
  }

  function shapeOk(categories, d) {
    if (!own(SHAPES, String(d)) || !isArray(categories)) return false;
    var shape = SHAPES[d];
    if (categories.length !== shape.k) return false;
    for (var c = 0; c < categories.length; c++) {
      if (!isObj(categories[c]) || !isArray(categories[c].items) || categories[c].items.length !== shape.n) return false;
    }
    return true;
  }

  function generateFixed(categories, d, seed) {
    if (!shapeOk(categories, d)) return null;
    seed = Math.floor(Number(seed));
    return genCore(categories, d, rng(seed), 'g' + seed, { engine: GEN_VERSION, seed: seed });
  }

  function supports(setting, d) {
    if (!isObj(setting) || !isArray(setting.categories) || !own(SHAPES, String(d))) return false;
    var shape = SHAPES[d], cats = setting.categories;
    if (cats.length < shape.k) return false;
    for (var c = 0; c < cats.length; c++) {
      if (!isObj(cats[c]) || !isArray(cats[c].items) || cats[c].items.length < shape.n) return false;
    }
    return true;
  }

  function pickItems(cat, n, r) {
    var idx = [], i, out = [];
    for (i = 0; i < cat.items.length; i++) idx.push(i);
    idx = shuffle(idx, r).slice(0, n).sort(numeric);
    for (i = 0; i < idx.length; i++) out.push(cat.items[idx[i]]);
    var res = { id: cat.id };
    if (cat.ordered === true) res.ordered = true;
    res.items = out;
    return res;
  }

  function generate(setting, d, seed) {
    if (!supports(setting, d)) return null;
    seed = Math.floor(Number(seed));
    var r = rng(seed), shape = SHAPES[d], sc = setting.categories, idx = [], c, cats;
    for (c = 1; c < sc.length; c++) idx.push(c);
    idx = shuffle(idx, r).slice(0, shape.k - 1).sort(numeric);
    cats = [pickItems(sc[0], shape.n, r)];
    for (c = 0; c < idx.length; c++) cats.push(pickItems(sc[idx[c]], shape.n, r));
    return genCore(cats, d, r, 'g' + seed, { engine: GEN_VERSION, seed: seed, setting: setting.id });
  }

  /* ---------- case codes ---------- */

  /* Interim Damm digit after a string of decimal digits (0 = valid code). */
  function damm(digits) {
    var i = 0, x;
    digits = String(digits);
    for (x = 0; x < digits.length; x++) i = DAMM[i].charCodeAt(digits.charCodeAt(x) - 48) - 48;
    return i;
  }

  function intIn(x, lo, hi) {
    return typeof x === 'number' && x === Math.floor(x) && x >= lo && x <= hi;
  }

  /* "VSD-<seed><C>", or null when a field is out of range. */
  function encodeCode(v, s, d, seed) {
    if (!intIn(v, 1, 9) || !intIn(s, 1, 9) || !intIn(d, 1, 5) || !intIn(seed, 1, SEED_MAX)) return null;
    var digits = '' + v + s + d + seed;
    return digits.substring(0, 3) + '-' + digits.substring(3) + damm(digits);
  }

  /* {ok:true, v, s, d, seed} or {ok:false, error:'invalid'|'version'}. */
  function decodeCode(str) {
    var bad = { ok: false, error: 'invalid' };
    if (typeof str !== 'string') return bad;
    var digits = str.replace(/[\- ]/g, '');
    if (!/^[0-9]{5,14}$/.test(digits)) return bad;
    if (damm(digits) !== 0) return bad;
    var v = digits.charCodeAt(0) - 48;
    if (!own(GEN_VERSIONS, String(v))) return { ok: false, error: 'version' };
    var s = digits.charCodeAt(1) - 48, d = digits.charCodeAt(2) - 48;
    var sd = digits.substring(3, digits.length - 1);
    if (s < 1 || d < 1 || d > 5 || sd.charAt(0) === '0') return bad;
    var seed = parseInt(sd, 10);
    if (!intIn(seed, 1, SEED_MAX)) return bad;
    return { ok: true, v: v, s: s, d: d, seed: seed };
  }

  /* ---------- grid check and clue evaluation ---------- */

  function checkGrid(cp, marks) {
    var n = cp.n, nv = cp.nv, k = cp.k, r, c, j, cnt;
    function yes(row, col) {
      var m = typeof marks === 'string' ? marks.charAt(row * nv + col) : marks[row * nv + col];
      return m === '2' || m === 2;
    }
    for (r = 0; r < n; r++) {
      for (c = 1; c < k; c++) {
        cnt = 0;
        for (j = (c - 1) * n; j < c * n; j++) if (yes(r, j)) cnt++;
        if (cnt !== 1) return 'incomplete';
      }
    }
    for (j = 0; j < nv; j++) {
      cnt = 0;
      for (r = 0; r < n; r++) if (yes(r, j)) cnt++;
      if (cnt !== 1) return 'incomplete';
    }
    for (j = 0; j < nv; j++) if (!yes(cp.sol[j], j)) return 'wrong';
    return 'solved';
  }

  /* assignment[j] = suspect index owning variable j. */
  function evalClue(cp, q, assignment) {
    var cc = cp.clues[q];
    return check(cc, valsFor(cc, assignment));
  }

  DEDUKO.engine = {
    SHAPES: SHAPES,
    rng: rng,
    validateCase: validateCase,
    compile: compile,
    solve: solve,
    generate: generate,
    generateFixed: generateFixed,
    supports: supports,
    checkGrid: checkGrid,
    evalClue: evalClue,
    GEN_VERSION: GEN_VERSION,
    GEN_VERSIONS: GEN_VERSIONS,
    code: { damm: damm, encode: encodeCode, decode: decodeCode }
  };
})(this);
