#!/usr/bin/env python3
"""Verify a Deduko pack.

Usage: verify_cases.py <packDir> [--langs it,en] [--sample N] [--throttle R]
                       [--report <dir>] [--max-ms MS] [--scratch <dir>]
                       [--golden <file>]

Checks, for every case of <packDir>/pack.js:
  (b) shape = difficulty, valid solution, every clue well-formed and true, and a
      Python brute force (independent of the JS engine) finds exactly one
      solution, equal to the stored one;
  (c) in headless Chrome: engine.validateCase is null and engine.solve solves it
      by propagation only;
  (d) per language: the text file covers the case, the lexicon has the fields
      the language file declares, every clue renders and passes the text checks.
      Clue texts are dumped to <report>/clues-<pack>-<lang>.txt.
  (e) --sample N: per setting and supported difficulty, N generated puzzles
      (seeds 1..N) are timed in the page (and again under --throttle R) and get
      the same checks. The timing table goes to <report>/timing-<pack>.txt.
  (f) --golden FILE: each [{"lang", "clue", "text"}] entry of a listed language
      renders exactly to its text. Italian clues must not contain ' oppure '.
  (g) case codes: for every setting with a registered code and every supported
      difficulty, seeds 1..min(N,5), 99999 and 2147483646: the check digit
      matches a Python Damm implementation, decode round-trips, caseFromCode
      (twice) equals engine.generate, codeOf gives the code back, and the first
      seed passes the brute force. Single-digit substitutions, adjacent
      transpositions and out-of-range fields are rejected as 'invalid', other
      generator versions as 'version'.
Also checks that every language file has the same set of UI string keys.
Text checks are skipped for a pack without text files. Exit code 1 on failure.
"""
import argparse
import glob
import itertools
import json
import os
import re
import statistics
import sys
import tempfile

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)
from cdp import Chrome, file_url  # noqa: E402

APP = os.path.normpath(os.path.join(TOOLS, "..", "package", "app"))
HARNESS = os.path.join(TOOLS, "harness.html")
SHAPES = {1: (3, 4), 2: (3, 5), 3: (4, 4), 4: (4, 5), 5: (5, 5)}
ID_RX = re.compile(r"^[a-z0-9_]+$")
TERMS = {"is": "ab", "not": "ab", "or": "abc", "less": "ab", "pair": "abcd"}
STORY_MAX = 600


def read_wrapper(path, fn):
    with open(path, encoding="utf-8") as f:
        src = f.read()
    pre = "DEDUKO.%s(" % fn
    body = src.strip()
    if not body.startswith(pre) or not body.endswith(");"):
        raise ValueError("%s is not a DEDUKO.%s(<json>); wrapper" % (path, fn))
    return json.loads(body[len(pre):-2]), src


class Failures:
    def __init__(self):
        self.items = []

    def add(self, where, msg):
        self.items.append("%s: %s" % (where, msg))
        print("FAIL %s: %s" % (where, msg), flush=True)


# ---------------------------------------------------------------- Python model

class Model:
    """Independent Python reading of a case (no code shared with engine.js)."""

    def __init__(self, case):
        self.errors = []
        d = case.get("difficulty")
        if d not in SHAPES or isinstance(d, bool):
            self.errors.append("bad difficulty %r" % d)
            return
        self.k, self.n = SHAPES[d]
        cats = case.get("categories")
        if not isinstance(cats, list) or len(cats) != self.k:
            self.errors.append("expected %d categories" % self.k)
            return
        self.cats, self.cidx, self.iidx = [], {}, []
        for c, cat in enumerate(cats):
            cid, items = cat.get("id"), cat.get("items")
            if not isinstance(cid, str) or not ID_RX.match(cid) or cid in self.cidx:
                self.errors.append("bad category id %r" % cid)
                return
            if not isinstance(items, list) or len(items) != self.n or len(set(items)) != self.n \
                    or not all(isinstance(x, str) and ID_RX.match(x) for x in items):
                self.errors.append("category %s: need %d distinct valid items" % (cid, self.n))
                return
            if c == 0 and cat.get("ordered"):
                self.errors.append("suspect category is ordered")
                return
            self.cidx[cid] = c
            self.iidx.append({x: i for i, x in enumerate(items)})
            self.cats.append((cid, items, cat.get("ordered") is True))
        sol = case.get("solution")
        if not isinstance(sol, list) or len(sol) != self.n:
            self.errors.append("solution needs %d rows" % self.n)
            return
        # owner[c][i] = suspect owning item i of category c
        self.owner = [list(range(self.n))] + [[None] * self.n for _ in range(self.k - 1)]
        for p, row in enumerate(sol):
            if not isinstance(row, list) or len(row) != self.k or row[0] != self.cats[0][1][p]:
                self.errors.append("bad solution row %d" % p)
                return
            for c in range(1, self.k):
                i = self.iidx[c].get(row[c])
                if i is None or self.owner[c][i] is not None:
                    self.errors.append("solution row %d: bad or repeated item %r" % (p, row[c]))
                    return
                self.owner[c][i] = p

    def term(self, t):
        if not isinstance(t, str) or "." not in t:
            return None
        cid, key = t.split(".", 1)
        c = self.cidx.get(cid)
        if c is None or key not in self.iidx[c]:
            return None
        return (c, self.iidx[c][key])

    def compile_clue(self, cl):
        """Returns (type, terms, by) or raises ValueError."""
        if not isinstance(cl, dict) or cl.get("t") not in TERMS:
            raise ValueError("unknown clue %r" % (cl,))
        t = cl["t"]
        tm = []
        for name in TERMS[t]:
            x = self.term(cl.get(name))
            if x is None:
                raise ValueError("bad term %s=%r" % (name, cl.get(name)))
            tm.append(x)
        by = None
        if t in ("is", "not"):
            if tm[0][0] == tm[1][0]:
                raise ValueError("%s with both terms in one category" % t)
        elif t == "or":
            if tm[1][0] != tm[2][0] or tm[1] == tm[2] or tm[0][0] == tm[1][0]:
                raise ValueError("malformed or")
        elif t == "less":
            by = self.cidx.get(cl.get("by"))
            if by is None or not self.cats[by][2]:
                raise ValueError("less: by must be an ordered category")
            if tm[0][0] == by or tm[1][0] == by or tm[0] == tm[1]:
                raise ValueError("malformed less")
        else:
            if tm[0][0] != tm[1][0] or tm[0] == tm[1] or tm[2][0] != tm[3][0] or tm[2] == tm[3] \
                    or tm[0][0] == tm[2][0]:
                raise ValueError("malformed pair")
        return (t, tm, by)

    @staticmethod
    def holds(cc, owner):
        t, tm, by = cc
        s = [owner[c][i] for c, i in tm]
        if t == "is":
            return s[0] == s[1]
        if t == "not":
            return s[0] != s[1]
        if t == "or":
            return s[0] == s[1] or s[0] == s[2]
        if t == "pair":
            return (s[0] == s[2] and s[1] == s[3]) or (s[0] == s[3] and s[1] == s[2])
        if s[0] == s[1]:
            return False
        order = owner[by]
        return order.index(s[0]) < order.index(s[1])

    def brute(self, ccs, limit=2):
        """All solutions (up to limit). Categories are assigned in order; a
        clue is evaluated as soon as all its categories are assigned."""
        at = [[] for _ in range(self.k)]
        for cc in ccs:
            cats = [c for c, _ in cc[1]] + ([cc[2]] if cc[2] is not None else [])
            at[max(cats)].append(cc)
        owner = [list(range(self.n))] + [None] * (self.k - 1)
        sols = []
        perms = list(itertools.permutations(range(self.n)))

        def rec(c):
            if c == self.k:
                sols.append([list(x) for x in owner])
                return len(sols) >= limit
            for perm in perms:
                owner[c] = perm
                if all(self.holds(cc, owner) for cc in at[c]):
                    if rec(c + 1):
                        return True
            owner[c] = None
            return False

        rec(1)
        return sols


def check_case_python(case, where, fails):
    m = Model(case)
    if m.errors:
        for e in m.errors:
            fails.add(where, e)
        return None
    clues = case.get("clues")
    if not isinstance(clues, list):
        fails.add(where, "clues is not a list")
        return None
    ccs = []
    for q, cl in enumerate(clues):
        try:
            cc = m.compile_clue(cl)
        except ValueError as e:
            fails.add(where, "clue %d: %s" % (q, e))
            return None
        if not m.holds(cc, m.owner):
            fails.add(where, "clue %d is false in the stored solution" % q)
            return None
        ccs.append(cc)
    sols = m.brute(ccs, 2)
    if len(sols) != 1:
        fails.add(where, "brute force found %s solutions" % ("0" if not sols else "2 or more"))
        return None
    if sols[0] != m.owner:
        fails.add(where, "the unique solution differs from the stored one")
        return None
    return m


# ---------------------------------------------------------------- text checks

def has_field(v):
    if isinstance(v, str):
        return len(v) > 0
    return isinstance(v, dict) and isinstance(v.get("m"), str) and isinstance(v.get("f"), str) \
        and v["m"] != "" and v["f"] != ""


def lexicon_missing(lex, fields, categories):
    miss = []
    for c, cat in enumerate(categories):
        lc = lex.get(cat["id"])
        if not isinstance(lc, dict):
            miss.append(cat["id"])
            continue
        if not has_field(lc.get("name")):
            miss.append(cat["id"] + ".name")
        if cat.get("ordered"):
            miss += [cat["id"] + "." + f for f in fields["ordered"] if not has_field(lc.get(f))]
        fl = fields["suspect"] if c == 0 else fields["item"]
        items = lc.get("items") if isinstance(lc.get("items"), dict) else {}
        for key in cat["items"]:
            e = items.get(key)
            if not isinstance(e, dict):
                miss.append(cat["id"] + "." + key)
                continue
            miss += ["%s.%s.%s" % (cat["id"], key, f) for f in fl if not has_field(e.get(f))]
    return miss


def text_problems(s):
    if not isinstance(s, str) or not s:
        return "not rendered"
    probs = []
    if not s[0].isupper():
        probs.append("does not start uppercase")
    if not s.endswith("."):
        probs.append("does not end with '.'")
    for bad in ("undefined", "NaN", "{", "[", "  "):
        if bad in s:
            probs.append("contains %r" % bad)
    return "; ".join(probs)


# ---------------------------------------------------------------- case codes

# Own copy of the Damm table (rows = interim digit, columns = input digit).
DAMM = ["0317598642", "7092154863", "4206871359", "1750983426", "6123045978",
        "3674209581", "5869720134", "8945362017", "9438617205", "2581436790"]
SEED_MAX = 2147483646


def damm(digits):
    i = 0
    for ch in digits:
        i = int(DAMM[i][int(ch)])
    return i


def with_check(digits):
    return digits + str(damm(digits))


def fmt_code(digits):
    return digits[:3] + "-" + digits[3:]


def check_golden(ch, pid, langs, path, fails):
    with open(path, encoding="utf-8") as f:
        golden = json.load(f)
    ctx = {"categories": [{"id": "suspect", "items": []}]}
    n = ok = 0
    for e in golden:
        if e.get("lang") not in langs:
            continue
        n += 1
        got = json.loads(ch.eval("JSON.stringify(DEDUKO.renderClue(%s,%s,%s,%s))" % (
            json.dumps(pid), json.dumps(e["lang"]), json.dumps(ctx), json.dumps(e["clue"]))))
        if got != e["text"]:
            fails.add("golden %s %s" % (e["lang"], clue_form(e["clue"])),
                      "\n  expected: %s\n  got:      %s" % (e["text"], got))
        else:
            ok += 1
    print("golden: %d/%d sentences match (%s)" % (ok, n, os.path.basename(path)), flush=True)


def check_codes(ch, pid, settings, sample, fails):
    """Codes reproduce the same case; bad codes are rejected."""
    codes = json.loads(ch.eval("JSON.stringify(DEDUKO.codes)"))
    reproduced = rejected = 0
    probe = None
    for si, st in enumerate(settings):
        sid = st.get("id")
        s = st.get("code")
        if s is None or codes.get(str(s)) != {"pack": pid, "setting": sid}:
            continue
        for d in range(1, 6):
            if not ch.eval("DEDUKO.engine.supports(DEDUKO.packs[%s].settings[%d], %d)" % (json.dumps(pid), si, d)):
                continue
            seeds = list(range(1, min(max(sample, 1), 5) + 1)) + [99999, SEED_MAX]
            for seed in seeds:
                where = "%s/%s code d%d seed %d" % (pid, sid, d, seed)
                expect = fmt_code(with_check("1%d%d%d" % (s, d, seed)))
                r = json.loads(ch.eval(
                    "(function(){var E=DEDUKO.engine,c=E.code.encode(E.GEN_VERSION,%d,%d,%d);"
                    "var st=DEDUKO.packs[%s].settings[%d];var a=DEDUKO.caseFromCode(c),b=DEDUKO.caseFromCode(c);"
                    "return JSON.stringify({v:E.GEN_VERSION,c:c,dec:E.code.decode(c),"
                    "a:a.ok?JSON.stringify(a.cj):a.error,b:b.ok?JSON.stringify(b.cj):b.error,"
                    "ap:[a.pack,a.setting,a.d,a.seed],g:JSON.stringify(E.generate(st,%d,%d)),"
                    "of:a.ok?DEDUKO.codeOf(%s,a.cj):null});})()" % (
                        s, d, seed, json.dumps(pid), si, d, seed, json.dumps(pid))))
                if r["v"] != 1:
                    fails.add(where, "engine.GEN_VERSION is %r, expected 1" % r["v"])
                if r["c"] != expect:
                    fails.add(where, "encode gave %r, Python Damm expects %r" % (r["c"], expect))
                    continue
                dec = r["dec"]
                if not dec.get("ok") or [dec.get("v"), dec.get("s"), dec.get("d"), dec.get("seed")] != [1, s, d, seed]:
                    fails.add(where, "decode(%s) = %r" % (r["c"], dec))
                    continue
                if r["g"] == "null" or r["a"] != r["g"] or r["b"] != r["g"]:
                    fails.add(where, "caseFromCode(%s) does not reproduce engine.generate: %.80s / %.80s" % (
                        r["c"], r["a"], r["b"]))
                    continue
                if r["ap"] != [pid, sid, d, seed]:
                    fails.add(where, "caseFromCode returned %r" % (r["ap"],))
                if r["of"] != r["c"]:
                    fails.add(where, "codeOf gave %r, expected %r" % (r["of"], r["c"]))
                if seed == seeds[0]:
                    check_case_python(json.loads(r["a"]), where, fails)
                reproduced += 1
                if d == 3 and probe is None:
                    probe = (s, "1%d3" % s)

    if probe is None:
        print("codes: no setting with a registered code and d3: rejection checks skipped")
        return
    s, vsd = probe
    base = with_check(vsd + "48217")
    unknown_s = next((x for x in range(2, 10) if str(x) not in codes), None)

    def expect(code, err, what):
        nonlocal rejected
        r = json.loads(ch.eval("JSON.stringify([DEDUKO.engine.code.decode(%s),DEDUKO.caseFromCode(%s)])" % (
            json.dumps(code), json.dumps(code))))
        rejected += 1
        dec_err = None if r[0].get("ok") else r[0].get("error")
        reg_err = None if r[1].get("ok") else r[1].get("error")
        if reg_err != err or (dec_err is not None and dec_err != err):
            fails.add("code %s (%s)" % (code, what), "expected %s, got decode %r, caseFromCode %r" % (err, r[0], r[1]))

    for p in range(len(base)):
        for x in "0123456789":
            if x != base[p]:
                expect(fmt_code(base[:p] + x + base[p + 1:]), "invalid", "substitution at %d" % p)
    for p in range(len(base) - 1):
        if base[p] != base[p + 1]:
            expect(fmt_code(base[:p] + base[p + 1] + base[p] + base[p + 2:]), "invalid", "transposition at %d" % p)
    for v in [0] + list(range(2, 10)):
        expect(fmt_code(with_check("%d%s48217" % (v, vsd[1:]))), "version", "version %d" % v)
    expect("913-482175", "version", "plan example")
    if unknown_s is not None:
        expect(fmt_code(with_check("1%d348217" % unknown_s)), "invalid", "unregistered setting %d" % unknown_s)
    expect(fmt_code(with_check("10348217")), "invalid", "setting 0")
    for dd in (0, 6):
        expect(fmt_code(with_check("1%d%d48217" % (s, dd))), "invalid", "difficulty %d" % dd)
    expect(fmt_code(with_check(vsd + "0")), "invalid", "seed 0")
    expect(fmt_code(with_check(vsd + "048217")), "invalid", "leading-zero seed")
    expect(fmt_code(with_check(vsd + "2147483647")), "invalid", "seed 2147483647")
    expect(with_check(vsd), "invalid", "4 digits")
    expect(fmt_code(with_check(vsd + "12345678901")), "invalid", "15 digits")
    expect(base[:4] + "a" + base[5:], "invalid", "letters")
    expect("", "invalid", "empty")
    print("codes: %d codes reproduced, %d rejections checked (probe %s)" % (reproduced, rejected, fmt_code(base)),
          flush=True)


def clue_form(cl):
    keys = [k for k in ("a", "b", "c", "d") if k in cl]
    s = cl["t"] + " " + " ".join(cl[k] for k in keys)
    if "by" in cl:
        s += " by " + cl["by"]
    return s


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description="Verify a Deduko pack.")
    ap.add_argument("packdir")
    ap.add_argument("--langs", default=None)
    ap.add_argument("--sample", type=int, default=0)
    ap.add_argument("--throttle", type=float, default=0)
    ap.add_argument("--report", default=None)
    ap.add_argument("--max-ms", type=float, default=300)
    ap.add_argument("--scratch", default=None)
    ap.add_argument("--golden", default=None)
    a = ap.parse_args()
    fails = Failures()

    pack, _ = read_wrapper(os.path.join(a.packdir, "pack.js"), "addPack")
    pid = pack.get("id")
    texts = {}
    for p in sorted(glob.glob(os.path.join(a.packdir, "text.*.js"))):
        t, _ = read_wrapper(p, "addPackText")
        code = os.path.basename(p)[5:-3]
        if t.get("lang") != code or t.get("pack") != pid or t.get("format") != 1:
            fails.add(os.path.basename(p), "lang/pack/format fields do not match the file")
        texts[code] = t
    langs = [x for x in a.langs.split(",") if x] if a.langs else sorted(texts)
    do_text = bool(texts)
    if not do_text:
        print("pack %s has no text files: text checks skipped" % pid)
    if a.report:
        os.makedirs(a.report, exist_ok=True)
    scratch = a.scratch or os.environ.get("DEDUKO_SCRATCH") or \
        (os.path.dirname(os.path.abspath(a.report)) if a.report else os.path.join(tempfile.gettempdir(), "deduko-cdp"))

    cases = pack.get("cases") or []
    settings = pack.get("settings") or []
    diffs = [c.get("difficulty") for c in cases]
    if diffs != sorted(diffs):
        fails.add(pid, "cases are not in ascending difficulty: %s" % diffs)

    dumps = {lang: [] for lang in langs}
    timing_rows = []

    with Chrome(scratch) as ch:
        ch.navigate(file_url(HARNESS))
        lang_files = sorted(glob.glob(os.path.join(APP, "lang", "*.js")))
        for p in lang_files:
            with open(p, encoding="utf-8") as f:
                ch.eval(f.read())
        lang_info = json.loads(ch.eval(
            "JSON.stringify(DEDUKO.langOrder.map(function(c){var L=DEDUKO.langs[c];"
            "return {code:c,name:L.name,fields:L.fields,keys:Object.keys(L.strings).sort()};}))"))
        if len(lang_info) != len(lang_files):
            fails.add("lang", "%d language files but %d registered: %s" % (
                len(lang_files), len(lang_info), ch.eval("JSON.stringify(DEDUKO.messages)")))
        fields = {x["code"]: x["fields"] for x in lang_info}
        if lang_info:
            ref = lang_info[0]
            for x in lang_info[1:]:
                if x["keys"] != ref["keys"]:
                    fails.add("lang", "strings keys differ between %s and %s: %s" % (
                        ref["code"], x["code"], sorted(set(ref["keys"]) ^ set(x["keys"]))))
        print("languages: %s (%d string keys each)" % (
            ", ".join(x["code"] for x in lang_info), len(lang_info[0]["keys"]) if lang_info else 0))
        if do_text:
            for lang in langs:
                if lang not in fields:
                    fails.add(lang, "no lang/%s.js" % lang)
                if lang not in texts:
                    fails.add(lang, "no text.%s.js in %s" % (lang, a.packdir))
            langs = [x for x in langs if x in fields and x in texts]

        with open(os.path.join(a.packdir, "pack.js"), encoding="utf-8") as f:
            ch.eval(f.read())
        for code in sorted(texts):
            with open(os.path.join(a.packdir, "text.%s.js" % code), encoding="utf-8") as f:
                ch.eval(f.read())
        reg = json.loads(ch.eval("JSON.stringify(DEDUKO.packs[%s]?{c:DEDUKO.packs[%s].cases.length,"
                                 "s:DEDUKO.packs[%s].settings.length}:null)" % ((json.dumps(pid),) * 3)))
        msgs = json.loads(ch.eval("JSON.stringify(DEDUKO.messages)"))
        if reg is None:
            fails.add(pid, "registry rejected the pack: %s" % msgs)
            return finish(fails)
        if reg["c"] != len(cases) or reg["s"] != len(settings):
            fails.add(pid, "registry skipped cases/settings: %s" % msgs)
        if do_text:
            ntext = json.loads(ch.eval("JSON.stringify(Object.keys(DEDUKO.texts[%s]||{}))" % json.dumps(pid)))
            if sorted(ntext) != sorted(texts):
                fails.add(pid, "registry rejected text files: %s" % msgs)
        if a.golden:
            check_golden(ch, pid, langs, a.golden, fails)

        def js_check(case, where):
            r = json.loads(ch.eval(
                "JSON.stringify((function(c){var e=DEDUKO.engine,v=e.validateCase(c),s=null;"
                "if(!v)s=e.solve(e.compile(c)).solved;return {v:v,s:s};})(%s))" % json.dumps(case)))
            if r["v"] is not None:
                fails.add(where, "engine.validateCase: %s" % r["v"])
            elif not r["s"]:
                fails.add(where, "engine.solve does not solve it by propagation")

        def render_check(case, where, lang, header):
            lex = texts[lang].get("lexicon") or {}
            miss = lexicon_missing(lex, fields[lang], case["categories"])
            if miss:
                fails.add(where, "%s lexicon misses %s" % (lang, ", ".join(miss[:10])))
                return
            out = json.loads(ch.eval(
                "JSON.stringify((function(c){return c.clues.map(function(cl){"
                "return DEDUKO.renderClue(%s,%s,c,cl);});})(%s))" % (json.dumps(pid), json.dumps(lang), json.dumps(case))))
            dumps[lang].append(header)
            for q, s in enumerate(out):
                prob = text_problems(s)
                if lang == "it" and isinstance(s, str) and " oppure " in s:
                    prob = (prob + "; " if prob else "") + "contains ' oppure '"
                if prob:
                    fails.add(where, "%s clue %d (%s): %s -> %r" % (lang, q, clue_form(case["clues"][q]), prob, s))
                dumps[lang].append("  %2d. %s\n      [%s]" % (q + 1, s, clue_form(case["clues"][q])))

        # ---- fixed cases
        for case in cases:
            where = "%s/%s" % (pid, case.get("id"))
            m = check_case_python(case, where, fails)
            js_check(case, where)
            if m is not None:
                print("%s: d%d %dx%d, %d clues, unique (brute force), solved by engine" % (
                    where, case["difficulty"], m.k, m.n, len(case["clues"])), flush=True)
            if do_text:
                avail = json.loads(ch.eval("JSON.stringify(DEDUKO.available(%s,'case',%s))" % (
                    json.dumps(pid), json.dumps(case.get("id")))))
                for lang in langs:
                    entry = (texts[lang].get("cases") or {}).get(case.get("id"))
                    if not isinstance(entry, dict) or not isinstance(entry.get("title"), str) \
                            or not isinstance(entry.get("story"), str):
                        fails.add(where, "text.%s.js has no title/story" % lang)
                        continue
                    if len(entry["story"]) > STORY_MAX:
                        fails.add(where, "%s story has %d chars (max %d)" % (lang, len(entry["story"]), STORY_MAX))
                    if m is not None:
                        render_check(case, where, lang, "== %s d%d: %s" % (case["id"], case["difficulty"], entry["title"]))
                    if lang not in avail:
                        fails.add(where, "DEDUKO.available does not list %s" % lang)

        # ---- settings and samples
        for si, st in enumerate(settings):
            sid = st.get("id")
            if do_text:
                for lang in langs:
                    entry = (texts[lang].get("settings") or {}).get(sid)
                    if not isinstance(entry, dict) or not isinstance(entry.get("title"), str) \
                            or not isinstance(entry.get("story"), str):
                        fails.add("%s/%s" % (pid, sid), "text.%s.js has no setting title/story" % lang)
                    elif len(entry["story"]) > STORY_MAX:
                        fails.add("%s/%s" % (pid, sid), "%s setting story too long" % lang)
                    miss = lexicon_missing(texts[lang].get("lexicon") or {}, fields[lang], st["categories"])
                    if miss:
                        fails.add("%s/%s" % (pid, sid), "%s lexicon misses %s" % (lang, ", ".join(miss[:10])))
            if a.sample <= 0:
                continue
            for d in range(1, 6):
                if not ch.eval("DEDUKO.engine.supports(DEDUKO.packs[%s].settings[%d], %d)" % (json.dumps(pid), si, d)):
                    continue

                def run(seed):
                    return json.loads(ch.eval(
                        "(function(){var t0=Date.now();var c=DEDUKO.engine.generate(DEDUKO.packs[%s].settings[%d],%d,%d);"
                        "return JSON.stringify({ms:Date.now()-t0,c:c});})()" % (json.dumps(pid), si, d, seed)))

                seeds = list(range(1, a.sample + 1))
                plain = [run(s) for s in seeds]
                slow = []
                if a.throttle and a.throttle > 1:
                    ch.throttle(a.throttle)
                    try:
                        slow = [run(s) for s in seeds]
                    finally:
                        ch.throttle(1)
                nclues = []
                for i, s in enumerate(seeds):
                    case = plain[i]["c"]
                    where = "%s/%s d%d seed %d" % (pid, sid, d, s)
                    if case is None:
                        fails.add(where, "generate returned null")
                        continue
                    if slow and slow[i]["c"] != case:
                        fails.add(where, "throttled run generated a different case (not deterministic)")
                    nclues.append(len(case["clues"]))
                    m = check_case_python(case, where, fails)
                    js_check(case, where)
                    if do_text and m is not None:
                        for lang in langs:
                            render_check(case, where, lang, "== sample %s d%d seed %d" % (sid, d, s))
                ms = [x["ms"] for x in plain]
                row = {"setting": sid, "d": d, "shape": "%dx%d" % SHAPES[d], "n": len(seeds),
                       "ms": (min(ms), statistics.median(ms), max(ms)),
                       "clues": (min(nclues), statistics.median(nclues), max(nclues)) if nclues else (0, 0, 0)}
                if slow:
                    sm = [x["ms"] for x in slow]
                    row["slow"] = (min(sm), statistics.median(sm), max(sm))
                timing_rows.append(row)
                if max(ms) > a.max_ms:
                    fails.add("%s/%s d%d" % (pid, sid, d), "max generation time %d ms > %d ms" % (max(ms), a.max_ms))
                print("sample %s d%d: %d puzzles checked" % (sid, d, len(seeds)), flush=True)

        # ---- case codes
        check_codes(ch, pid, settings, a.sample, fails)

    if timing_rows:
        thr = "x%g" % a.throttle if a.throttle and a.throttle > 1 else "-"
        lines = ["Generation time per puzzle (ms, Date.now() in headless Chrome), seeds 1..%d" % a.sample,
                 "%-10s %-2s %-5s %4s  %-22s %-22s %s" % ("setting", "d", "grid", "N", "unthrottled min/med/max",
                                                       "throttled %s min/med/max" % thr, "clues min/med/max")]
        for r in timing_rows:
            fmt = lambda t: "%g / %g / %g" % t  # noqa: E731
            lines.append("%-10s %-2d %-5s %4d  %-22s %-22s %s" % (
                r["setting"], r["d"], r["shape"], r["n"], fmt(r["ms"]), fmt(r["slow"]) if "slow" in r else "-",
                fmt(r["clues"])))
        table = "\n".join(lines)
        print(table)
        if a.report:
            with open(os.path.join(a.report, "timing-%s.txt" % pid), "w", encoding="utf-8", newline="\n") as f:
                f.write(table + "\n")
    if a.report and do_text:
        for lang in langs:
            path = os.path.join(a.report, "clues-%s-%s.txt" % (pid, lang))
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                f.write("\n".join(dumps[lang]) + "\n")
            print("wrote " + path)
    return finish(fails)


def finish(fails):
    if fails.items:
        print("verify_cases: %d failure(s)" % len(fails.items))
        return 1
    print("verify_cases: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
