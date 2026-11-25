#!/usr/bin/env python3
"""End-to-end UI test of the Deduko app in headless Chrome (tools/cdp.py).

Usage: e2e_ui.py [--shots DIR] [--scratch DIR]

Loads package/app/index.html at 600x800 and 1236x1648, in Italian and in
English, each with a fresh localStorage, and clicks through the real UI:
  A  home controls, the two tools, tap-to-erase, one-step Undo
  B  auto-exclude off/on in both band kinds, its single Undo entry, persistence
  C  error mode chosen on the intro: rejected wrong X and dot, counter, Undo
     not lowering it, reload, restart at the 5th error; free mode never counts
  D  case codes: shown in game and on the solved box, keypad entry gives the
     identical case (also across languages), invalid / unknown-version codes
  F  language switch, c5 staircase and clue pages, a generated d5 played to
     completion survives a reload
  E  1.0.0 saves (records without e/n) load and resume
  G  on every screenshot: no scroll overflow, no placeholder text, no
     DEDUKO.messages, no JS error, only file: resources
Screenshots: <shots>/<w>x<h>-<lang>-<screen>.png (old PNGs there are deleted).
Chrome profiles go to --scratch (default: $DEDUKO_SCRATCH or %TEMP%/deduko-e2e).
Prints 'e2e_ui: OK in <s> s' and exits 0, or prints the failure and exits 1.
"""
import argparse
import glob
import json
import os
import re
import sys
import tempfile
import time

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)
from cdp import Chrome, file_url  # noqa: E402

ROOT = os.path.dirname(TOOLS)
APP = os.path.join(ROOT, "package", "app", "index.html")
SIZES = [(600, 800), (1236, 1648)]
LANGS = ["it", "en"]
PFX = "deduko.v2."
OLD_GEN_CODE = "115-12345678907"
BAD_TEXT = re.compile(r"undefined|NaN|\{\w+\}|\[\w+\]")

HOOK = ("window.__errs=[];window.onerror=function(m,u,l){window.__errs.push(String(m)+' @'+u+':'+l);};true")

CHECK_G = r"""(function(){
  var de=document.documentElement,b=document.body,p=[],W=window.innerWidth,H=window.innerHeight,i,r,tx,m;
  if(de.scrollWidth>W||de.scrollHeight>H||b.scrollWidth>W||b.scrollHeight>H)
    p.push('overflow '+de.scrollWidth+'x'+de.scrollHeight+' / '+b.scrollWidth+'x'+b.scrollHeight+' > '+W+'x'+H);
  tx=b.innerText||'';
  m=tx.match(/undefined|NaN|\{\w+\}|\[\w+\]/);
  if(m)p.push('bad text: '+m[0]);
  if(!window.DEDUKO||DEDUKO.messages.length)p.push('messages: '+(window.DEDUKO?DEDUKO.messages.join(' | '):'no DEDUKO'));
  if(!window.__errs)p.push('no error hook');else if(window.__errs.length)p.push('errors: '+window.__errs.join(' | '));
  r=performance.getEntriesByType('resource');
  for(i=0;i<r.length;i++)if(r[i].name.indexOf('file:')!==0)p.push('resource '+r[i].name);
  return p;})()"""


class Fail(Exception):
    pass


def check(cond, msg):
    if not cond:
        raise Fail(msg)


def fmt(s, m):
    return re.sub(r"\{(\w+)\}", lambda x: str(m[x.group(1)]) if x.group(1) in m else x.group(0), s)


def default_scratch():
    return os.environ.get("DEDUKO_SCRATCH") or os.path.join(tempfile.gettempdir(), "deduko-e2e")


class Run:
    def __init__(self, c, w, h, lang, shots):
        self.c, self.w, self.h, self.lang, self.shots = c, w, h, lang, shots
        self.S = None
        self.where = "%dx%d %s" % (w, h, lang)

    # ---------- page helpers ----------
    def ev(self, expr):
        return self.c.eval(expr)

    def wait(self, expr, what, timeout=60):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.ev(expr):
                return
            time.sleep(0.05)
        raise Fail("timeout waiting for " + what)

    def hook(self):
        self.wait("!!(window.DEDUKO && document.getElementById('home'))", "home after load")
        self.ev(HOOK)

    def load_fresh(self):
        self.c.viewport(self.w, self.h)
        self.c.navigate(file_url(APP))
        self.ev("localStorage.clear();true")
        self.reload()

    def reload(self):
        self.c.reload()
        self.hook()

    def click(self, sel):
        self.c.click_css(sel)

    def exists(self, sel):
        return self.ev("!!document.querySelector(%s)" % json.dumps(sel))

    def text(self, sel):
        t = self.ev("(function(){var e=document.querySelector(%s);return e?e.textContent:null;})()" % json.dumps(sel))
        check(t is not None, "no element " + sel)
        return t

    def cls(self, sel):
        t = self.ev("(function(){var e=document.querySelector(%s);return e?e.className:null;})()" % json.dumps(sel))
        check(t is not None, "no element " + sel)
        return t

    def has_cls(self, sel, name):
        return name in self.cls(sel).split()

    def rec(self, key):
        v = self.ev("localStorage.getItem(%s)" % json.dumps(PFX + key))
        return None if v is None else json.loads(v)

    def item(self, key):
        return self.ev("localStorage.getItem(%s)" % json.dumps(PFX + key))

    def strings(self):
        self.S = self.ev("DEDUKO.langs[%s].strings" % json.dumps(self.lang))

    def g(self, name):
        p = self.ev(CHECK_G)
        exc = [e for e in self.c.events if e.get("method") == "Runtime.exceptionThrown"]
        if exc:
            p.append("exception: " + json.dumps(exc[0].get("params", {}).get("exceptionDetails", {}))[:300])
            self.c.events = [e for e in self.c.events if e.get("method") != "Runtime.exceptionThrown"]
        check(not p, "G on %s: %s" % (name, "; ".join(p)))

    def shot(self, name):
        self.g(name)
        self.c.screenshot(os.path.join(self.shots, "%dx%d-%s-%s.png" % (self.w, self.h, self.lang, name)))

    def set_lang(self, code):
        self.click("#btn-lang")
        self.wait("!!document.getElementById('langs')", "language screen")
        self.click("#lang-" + code)
        self.wait("!!document.getElementById('home')", "home after language")

    # ---------- game helpers ----------
    def mark(self, R, j):
        m = re.search(r"\bm([012])\b", self.cls("#cell-%d-%d" % (R, j)))
        check(m, "cell %d,%d has no mark class" % (R, j))
        return int(m.group(1))

    def tap(self, R, j):
        self.click("#cell-%d-%d" % (R, j))

    def tool(self, v):
        self.click("#tool-x" if v == 1 else "#tool-dot")

    def status(self):
        """'<#status-flash> <#status-msg>' when the flash line is shown, else #status-msg."""
        msg = self.text("#status-msg")
        if self.exists("#status-flash"):
            return self.text("#status-flash") + " " + msg
        return msg

    def case_of(self, cid):
        return self.ev("(function(){var c=DEDUKO.packs.core.cases,i;for(i=0;i<c.length;i++)if(c[i].id===%s)return c[i];return null;})()"
                       % json.dumps(cid))

    def open_case(self, cid):
        self.click("#case-core-" + cid)
        self.wait("!!document.getElementById('intro')", "intro of " + cid)

    def start(self):
        self.click("#btn-start")
        self.wait("!!document.getElementById('grid')", "game screen")

    def menu(self):
        self.click("#btn-menu")
        self.wait("!!document.getElementById('home')", "home")

    def gen(self, d):
        self.click("#gen-core-manor-%d" % d)
        self.wait("!!document.getElementById('intro')", "intro of a generated d%d" % d)

    def enter_code(self, code):
        self.click("#btn-code")
        self.wait("!!document.getElementById('code-screen')", "keypad")
        for ch in code:
            if ch.isdigit():
                self.click("#key-" + ch)

    def ok_code(self):
        self.click("#key-ok")
        self.wait("!!document.getElementById('intro') || (document.getElementById('code-msg') && "
                  "document.getElementById('code-msg').textContent !== '' && "
                  "document.getElementById('code-msg').textContent !== %s)" % json.dumps(self.S["generating"]),
                  "code result")


def shape(case):
    k = len(case["categories"])
    n = len(case["categories"][0]["items"])
    return k, n


def cells(case):
    k, n = shape(case)
    out = []
    for b in range(k - 1):
        for i in range(n):
            for j in range((k - 1 - b) * n):
                out.append((b * n + i, j))
    return out


def yes(case, R, j):
    k, n = shape(case)
    b = R // n
    rc = 0 if b == 0 else k - b
    cc = j // n + 1
    ir = case["categories"][rc]["items"][R % n]
    ic = case["categories"][cc]["items"][j % n]
    return any(row[rc] == ir and row[cc] == ic for row in case["solution"])


def mark_len(case):
    k, n = shape(case)
    return n * (k - 1) * n + n * n * (k - 1) * (k - 2) // 2


def canon(o):
    return json.dumps(o, sort_keys=True, ensure_ascii=False)


def marks_map(r, case):
    return {(R, j): r.mark(R, j) for (R, j) in cells(case)}


def solve(r, case, auto):
    """Plays a case to completion through cell taps (only dots when auto is on)."""
    for (R, j) in cells(case):
        y = yes(case, R, j)
        if auto and not y:
            continue
        if r.mark(R, j) != 0:
            continue
        r.tool(2 if y else 1)
        r.tap(R, j)
    r.wait("document.getElementById('solved').style.display === 'block'", "solved box")


# ---------- flows ----------

def flow_lang(r):
    """F: the language switch updates the home strings; ends in the run's language."""
    other = "en" if r.lang == "it" else "it"
    for code in (other, r.lang):
        r.set_lang(code)
        s = r.ev("DEDUKO.langs[%s].strings" % json.dumps(code))
        check(r.text("#btn-code") == s["codeButton"], "home #btn-code in %s" % code)
        check(r.text("#btn-lang") == s["language"] + ": " + r.ev("DEDUKO.langs[%s].name" % json.dumps(code)), "home #btn-lang in %s" % code)
        check(r.ev("document.querySelector('#home .sect').textContent") == s["cases"], "home section title in %s" % code)
    r.strings()
    check(r.item("lang") == r.lang, "language not stored")


def flow_a(r):
    S = r.S
    check(r.exists("#btn-code"), "home has no #btn-code")
    r.shot("home")
    r.open_case("c1")
    check(r.exists("#mode-free") and r.exists("#mode-errors"), "c1 intro has no mode buttons")
    check(r.has_cls("#mode-free", "sel") and not r.has_cls("#mode-errors", "sel"), "fresh intro does not pre-select free play")
    r.start()
    ids = r.ev("(function(){var a=document.querySelectorAll('[data-act=tool]'),o=[],i;for(i=0;i<a.length;i++)o.push(a[i].id);return o;})()")
    check(ids == ["tool-x", "tool-dot"], "tools are %r" % ids)
    check(not r.exists("#tool-erase"), "#tool-erase still present")
    check(r.exists("#btn-auto") and r.text("#btn-auto") == S["autoExclude"], "#btn-auto missing")
    check(r.status() == S["legend"], "free-mode status is not the legend")
    check(not r.exists("#game-code"), "fixed case shows a code")
    # tap-to-erase with X selected, on an X and on a dot
    r.tool(1)
    r.tap(0, 0)
    check(r.mark(0, 0) == 1, "X not placed")
    r.tap(0, 0)
    check(r.mark(0, 0) == 0, "tap on an X did not erase it")
    r.tool(2)
    r.tap(0, 1)
    check(r.mark(0, 1) == 2, "dot not placed")
    r.tool(1)
    r.tap(0, 1)
    check(r.mark(0, 1) == 0, "tap on a dot with X selected did not erase it")
    rec = r.rec("p.core.c1")
    check(len(rec["u"]) == 4, "expected 4 undo entries, got %d" % len(rec["u"]))
    check(rec["u"][-1] == ["m", 0, 1, 2], "erase undo entry is %r" % rec["u"][-1])
    r.click("#btn-undo")
    check(r.mark(0, 1) == 2 and r.mark(0, 0) == 0, "Undo did not restore exactly one step")
    check(len(r.rec("p.core.c1")["u"]) == 3, "Undo did not pop one entry")
    r.click("#btn-undo")
    r.click("#btn-undo")
    r.click("#btn-undo")
    case = r.case_of("c1")
    check(all(v == 0 for v in marks_map(r, case).values()), "c1 not empty after undoing everything")


def block_expect(case, R, j, before):
    k, n = shape(case)
    exp = {(R, j): 2}
    c0, r0 = (j // n) * n, (R // n) * n
    for x in range(c0, c0 + n):
        if x != j and before[(R, x)] == 0:
            exp[(R, x)] = 1
    for y in range(r0, r0 + n):
        if y != R and before[(y, j)] == 0:
            exp[(y, j)] = 1
    return exp


def flow_b(r):
    case = r.case_of("c1")
    k, n = shape(case)
    check(not r.has_cls("#btn-auto", "sel"), "auto is on by default")
    # off: a dot changes one cell
    before = marks_map(r, case)
    r.tool(2)
    r.tap(1, n + 1)
    after = marks_map(r, case)
    diff = [p for p in after if after[p] != before[p]]
    check(diff == [(1, n + 1)], "auto off: a dot changed %r" % diff)
    r.click("#btn-undo")
    # on
    r.click("#btn-auto")
    check(r.has_cls("#btn-auto", "sel"), "#btn-auto not selected after tap")
    check(r.item("auto") == "1", "auto not stored as '1'")
    for (R, j, pre) in ((1, n + 1, (2, n + 1)), (n + 1, 2, (n + 1, 0))):
        r.tool(1)
        r.tap(*pre)
        check(r.mark(*pre) == 1, "pre-existing X not placed")
        u0 = len(r.rec("p.core.c1")["u"])
        before = marks_map(r, case)
        r.tool(2)
        r.tap(R, j)
        after = marks_map(r, case)
        exp = block_expect(case, R, j, before)
        changed = {p: after[p] for p in after if after[p] != before[p]}
        check(changed == exp, "auto at %d,%d changed %r, expected %r" % (R, j, sorted(changed), sorted(exp)))
        check(after[pre] == 1, "pre-existing X changed")
        u = r.rec("p.core.c1")["u"]
        check(len(u) == u0 + 1, "auto dot made %d undo entries" % (len(u) - u0))
        e = u[-1]
        got = sorted((e[x], e[x + 1]) for x in range(1, len(e), 3))
        check(got == sorted(exp) and all(e[x + 2] == 0 for x in range(1, len(e), 3)), "auto undo entry %r" % e)
        check(tuple(pre) not in got, "pre-existing X in the undo entry")
        if R == 1:
            r.shot("game-auto")
        r.click("#btn-undo")
        back = marks_map(r, case)
        check(back == before, "one Undo did not restore every cell of the auto dot")
        r.click("#btn-undo")  # the pre-existing X
    check(all(v == 0 for v in marks_map(r, case).values()), "c1 not empty after the auto checks")
    # free mode never counts errors: an X on a yes cell is placed
    yj = [j for j in range((k - 1) * n) if yes(case, 0, j)][0]
    r.tool(1)
    r.tap(0, yj)
    check(r.mark(0, yj) == 1, "free mode rejected a wrong mark")
    rec = r.rec("p.core.c1")
    check(rec["e"] == 0 and rec["n"] == 0, "free mode counted an error: %r" % {"e": rec["e"], "n": rec["n"]})
    r.click("#btn-undo")
    # persistence
    r.reload()
    r.open_case("c1")
    r.start()
    check(r.has_cls("#btn-auto", "sel"), "auto not restored after reload")
    r.click("#btn-auto")
    check(r.item("auto") == "0", "auto off not stored as '0'")
    r.reload()
    r.open_case("c1")
    r.start()
    check(not r.has_cls("#btn-auto", "sel"), "auto off not restored after reload")
    r.menu()


def flow_c(r):
    S = r.S
    case = r.case_of("c2")
    k, n = shape(case)
    all_cells = cells(case)
    yes_cells = [p for p in all_cells if yes(case, *p)]
    no_cells = [p for p in all_cells if not yes(case, *p)]
    r.open_case("c2")
    check(r.exists("#mode-free") and r.exists("#mode-errors"), "c2 intro has no mode buttons")
    check(not r.exists("#intro-mode"), "fresh intro shows #intro-mode")
    r.click("#mode-errors")
    check(r.has_cls("#mode-errors", "sel") and not r.has_cls("#mode-free", "sel"), "mode button classes after tap")
    check(r.item("errmode") == "1", "errmode not stored")
    r.start()

    def counter(nn):
        return fmt(S["errorCount"], {"n": nn, "m": 5})

    check(r.status() == counter(0), "status is %r, expected the 0/5 counter" % r.status())
    # wrong X (on a yes cell)
    r.tool(1)
    r.tap(*yes_cells[0])
    check(r.mark(*yes_cells[0]) == 0, "wrong X was placed")
    rec = r.rec("p.core.c2")
    check(rec["n"] == 1 and rec["e"] == 1 and rec["u"] == [], "after a wrong X: %r" % {"n": rec["n"], "e": rec["e"], "u": rec["u"]})
    check(r.status() == S["wrongMark"] + " " + counter(1), "status after a wrong X: %r" % r.status())
    r.shot("game-wrong")
    # wrong dot (on a no cell)
    r.tool(2)
    r.tap(*no_cells[0])
    check(r.mark(*no_cells[0]) == 0, "wrong dot was placed")
    rec = r.rec("p.core.c2")
    check(rec["n"] == 2 and rec["u"] == [], "after a wrong dot: n=%r u=%r" % (rec["n"], rec["u"]))
    check(r.status() == S["wrongMark"] + " " + counter(2), "status after a wrong dot")
    # a correct mark, then Undo: the counter stays
    r.tool(1)
    r.tap(*no_cells[1])
    check(r.mark(*no_cells[1]) == 1, "correct X rejected")
    check(r.status() == counter(2), "status after a correct mark: %r" % r.status())
    r.click("#btn-undo")
    check(r.mark(*no_cells[1]) == 0, "Undo did not remove the correct X")
    rec = r.rec("p.core.c2")
    check(rec["n"] == 2 and r.status() == counter(2), "Undo changed the counter")
    # reload keeps the counter; the intro shows the mode as text
    r.reload()
    check(r.text("#case-core-c2 td.st") == S["statusInProgress"], "c2 with errors only is not 'in progress'")
    r.open_case("c2")
    check(not r.exists("#mode-free") and r.exists("#intro-mode"), "intro with progress still shows the mode buttons")
    exp = S["modeTitle"] + ": " + fmt(S["modeErrors"], {"m": 5}) + ", " + counter(2)
    check(r.text("#intro-mode") == exp, "#intro-mode is %r" % r.text("#intro-mode"))
    check(r.text("#btn-start") == S["resume"], "intro button is not Resume")
    r.start()
    check(r.status() == counter(2), "counter not restored after reload")
    # progress that the restart must clear
    r.click("#clue-0")
    r.tool(1)
    r.tap(*no_cells[2])
    r.tool(1)
    r.tap(*yes_cells[1])
    r.tap(*yes_cells[2])
    check(r.rec("p.core.c2")["n"] == 4, "4th error not counted")
    r.tap(*yes_cells[3])
    rec = r.rec("p.core.c2")
    check(rec["n"] == 0 and rec["e"] == 1 and rec["s"] == [] and rec["u"] == [] and set(rec["m"]) == {"0"},
          "after the 5th error: %r" % {k2: rec[k2] for k2 in ("n", "e", "s", "u")})
    check(all(v == 0 for v in marks_map(r, case).values()), "grid not cleared at the 5th error")
    check(r.status() == fmt(S["errorRestart"], {"m": 5}) + " " + counter(0), "status after restart: %r" % r.status())
    check(not r.has_cls("#clue-0", "struck"), "struck clue survived the restart")
    r.shot("game-restart")
    r.menu()


def flow_d(r, shared):
    S = r.S
    r.gen(3)
    rec = r.rec("gen.core.manor.3")
    cj = rec["case"]
    seed = cj["gen"]["seed"]
    check(127774 <= seed <= 999999, "new seed %r is not in 127774..999999" % seed)
    code = r.ev("DEDUKO.engine.code.encode(%d, DEDUKO.packs.core.settings[0].code, 3, %d)" % (cj["gen"]["engine"], seed))
    check(code and re.match(r"^113-\d+$", code), "encode gave %r" % code)
    check(r.has_cls("#mode-errors", "sel"), "errmode pref not pre-selected on a new case")
    r.click("#mode-free")
    check(r.item("errmode") == "0", "errmode not stored as '0'")
    r.start()
    check(r.text("#game-code") == fmt(S["codeLabel"], {"code": code}), "#game-code is %r" % r.text("#game-code"))
    r.shot("game-code")
    solve(r, cj, False)
    check(r.text("#solved-code") == fmt(S["codeLabel"], {"code": code}), "#solved-code is %r" % r.text("#solved-code"))
    r.shot("solved-code")
    case1 = canon(r.rec("gen.core.manor.3")["case"])
    check(r.rec("gen.core.manor.3")["done"] is True, "solved d3 not stored as done")
    r.click("#btn-solved-menu")
    r.wait("!!document.getElementById('home')", "home")
    # another d3 overwrites the slot
    for _ in range(5):
        r.gen(3)
        if r.rec("gen.core.manor.3")["case"]["gen"]["seed"] != seed:
            break
        r.click("#btn-back")
        time.sleep(0.01)
    check(r.rec("gen.core.manor.3")["case"]["gen"]["seed"] != seed, "second d3 has the same seed")
    r.click("#btn-back")
    r.wait("!!document.getElementById('home')", "home")
    # the first code on the keypad gives the same case
    r.enter_code(code + "5")
    check(r.text("#code-display") == code + "5", "display %r" % r.text("#code-display"))
    r.click("#key-del")
    check(r.text("#code-display") == code, "Del did not remove one digit: %r" % r.text("#code-display"))
    r.shot("keypad")
    r.ok_code()
    check(r.exists("#intro"), "code did not open the intro: %r" % r.ev("document.body.innerText"))
    rec = r.rec("gen.core.manor.3")
    check(canon(rec["case"]) == case1, "code gave a different case")
    check(set(rec["m"]) == {"0"} and rec["done"] is False, "code entry did not start a fresh game")
    check(r.text("#btn-start") == S["start"], "fresh code case shows Resume")
    if r.lang == "it":
        shared[(r.w, r.h)] = (code, case1)
    else:
        code_it, case_it = shared[(r.w, r.h)]
        r.click("#btn-back")
        r.wait("!!document.getElementById('home')", "home")
        r.enter_code(code_it)
        r.ok_code()
        check(r.exists("#intro"), "Italian code did not open in English")
        check(canon(r.rec("gen.core.manor.3")["case"]) == case_it, "the Italian code gave a different case in English")
    r.click("#btn-back")
    r.wait("!!document.getElementById('home')", "home")
    # a wrong check digit, then an unknown version
    digits = code.replace("-", "")
    bad = digits[:-1] + str((int(digits[-1]) + 1) % 10)
    r.enter_code(bad)
    r.ok_code()
    check(r.text("#code-msg") == S["codeInvalid"], "wrong check digit: %r" % r.text("#code-msg"))
    check(r.text("#code-display") == bad[:3] + "-" + bad[3:], "digits not kept after an error")
    r.shot("keypad-error")
    for _ in range(len(bad)):
        r.click("#key-del")
    check(r.ev("document.getElementById('code-display').textContent.replace(/\\s/g,'')") == "", "display not empty after Del")
    for ch in "913482175":
        r.click("#key-" + ch)
    r.ok_code()
    check(r.text("#code-msg") == S["codeVersion"], "unknown version: %r" % r.text("#code-msg"))
    r.click("#btn-back")
    r.wait("!!document.getElementById('home')", "home")


def flow_f(r):
    # c5 staircase and clue pages; the intro with the mode row
    case = r.case_of("c5")
    k, n = shape(case)
    r.open_case("c5")
    check(r.exists("#mode-free"), "c5 intro without mode buttons")
    r.shot("intro-mode")
    r.start()
    cnt = r.ev("document.querySelectorAll('#grid td.cell').length")
    check(cnt == mark_len(case), "c5 has %r cells, expected %d" % (cnt, mark_len(case)))
    for b in range(k - 1):
        row = r.ev("document.querySelectorAll('#grid tr')[%d].querySelectorAll('td.cell').length" % (2 + b * n))
        check(row == (k - 1 - b) * n, "c5 band %d row has %r cells" % (b, row))
    pages = r.ev("document.getElementById('clue-page').textContent")
    if not r.has_cls("#clue-next", "off"):
        r.click("#clue-next")
        check(r.ev("document.getElementById('clue-page').textContent") != pages, "clue pager did not move")
        r.click("#clue-prev")
    check(r.ev("document.getElementById('clue-page').textContent") == pages, "clue pager did not come back")
    r.menu()
    # a generated d5 played to completion (auto on: dots only) survives a reload
    r.gen(5)
    r.start()
    r.click("#btn-auto")
    cj = r.rec("gen.core.manor.5")["case"]
    solve(r, cj, True)
    r.click("#btn-solved-menu")
    r.wait("!!document.getElementById('home')", "home")
    r.reload()
    rec = r.rec("gen.core.manor.5")
    check(rec["done"] is True and canon(rec["case"]) == canon(cj), "solved d5 not kept after reload")
    check(not r.exists("#cont-core-manor-5"), "solved d5 still offers Continue")


def flow_e(r):
    S = r.S
    seed_js = r"""(function(){
      var pk=DEDUKO.packs.core,c1,i,ml,z,c1m,g,gm,P='deduko.v2.';
      for(i=0;i<pk.cases.length;i++)if(pk.cases[i].id==='c1')c1=pk.cases[i];
      function len(cj){var k=cj.categories.length,n=cj.categories[0].items.length;return n*(k-1)*n+n*n*(k-1)*(k-2)/2;}
      function zs(l){var a=[];for(var x=0;x<l;x++)a.push('0');return a;}
      localStorage.clear();
      localStorage.setItem(P+'lang',%s);
      c1m=zs(len(c1));c1m[0]='1';c1m[1]='2';
      localStorage.setItem(P+'p.core.c1',JSON.stringify({m:c1m.join(''),s:[0],u:[['m',0,0,0],['m',0,1,0]],done:false}));
      localStorage.setItem(P+'p.core.c2',JSON.stringify({m:zs(len(pk.cases[1])).join(''),s:[],u:[],done:true}));
      g=DEDUKO.engine.generate(pk.settings[0],5,1234567890);
      gm=zs(len(g));gm[2]='1';
      localStorage.setItem(P+'gen.core.manor.5',JSON.stringify({'case':g,m:gm.join(''),s:[1],u:[],done:false}));
      return JSON.stringify(g);})()""" % json.dumps(r.lang)
    gcase = r.ev(seed_js)
    r.reload()
    check(r.text("#case-core-c1 td.st") == S["statusInProgress"], "1.0.0 c1 not in progress")
    check(r.text("#case-core-c2 td.st") == S["statusSolved"], "1.0.0 c2 not solved")
    check(r.exists("#cont-core-manor-5"), "1.0.0 gen slot has no Continue")
    r.open_case("c1")
    check(r.text("#intro-mode") == S["modeTitle"] + ": " + S["modeFree"], "1.0.0 c1 mode text %r" % r.text("#intro-mode"))
    check(r.text("#btn-start") == S["resume"], "1.0.0 c1 not resumable")
    r.start()
    check(r.mark(0, 0) == 1 and r.mark(0, 1) == 2 and r.has_cls("#clue-0", "struck"), "1.0.0 c1 marks/struck not restored")
    check(r.status() == S["legend"], "1.0.0 c1 not in free play")
    r.click("#btn-undo")
    check(r.mark(0, 1) == 0 and r.mark(0, 0) == 1, "1.0.0 undo step 1")
    rec = r.rec("p.core.c1")
    check(all(x in rec for x in ("m", "s", "u", "done")) and rec["e"] == 0 and rec["n"] == 0 and rec["s"] == [0] and len(rec["u"]) == 1,
          "1.0.0 c1 record after a tap: %r" % rec)
    r.click("#btn-undo")
    check(r.mark(0, 0) == 0, "1.0.0 undo step 2")
    r.menu()
    r.click("#cont-core-manor-5")
    r.wait("!!document.getElementById('intro')", "intro of the 1.0.0 gen slot")
    r.start()
    check(r.mark(0, 2) == 1 and r.has_cls("#clue-1", "struck"), "1.0.0 gen slot marks not restored")
    check(r.text("#game-code") == fmt(S["codeLabel"], {"code": OLD_GEN_CODE}), "1.0.0 gen code %r" % r.text("#game-code"))
    r.shot("old-save-resume")
    r.menu()
    r.enter_code(OLD_GEN_CODE)
    r.ok_code()
    check(r.exists("#intro") and r.text("#btn-start") == S["resume"], "the 1.0.0 slot code did not resume")
    r.start()
    check(r.mark(0, 2) == 1, "code entry lost the 1.0.0 slot marks")
    check(canon(r.rec("gen.core.manor.5")["case"]) == canon(json.loads(gcase)), "1.0.0 slot case changed")
    r.menu()


def main():
    ap = argparse.ArgumentParser(description="End-to-end UI test of Deduko in headless Chrome.")
    ap.add_argument("--shots", default=None)
    ap.add_argument("--scratch", default=None)
    a = ap.parse_args()
    scratch = a.scratch or default_scratch()
    shots = a.shots or os.path.join(scratch, "screenshots")
    os.makedirs(shots, exist_ok=True)
    for p in glob.glob(os.path.join(shots, "*.png")):
        os.remove(p)
    t0 = time.time()
    shared = {}
    step = "start"
    try:
        with Chrome(scratch) as c:
            for (w, h) in SIZES:
                for lang in LANGS:
                    r = Run(c, w, h, lang, shots)
                    step = r.where + " setup"
                    r.load_fresh()
                    for name, fn in (("F language", flow_lang), ("A", flow_a), ("B", flow_b), ("C", flow_c),
                                     ("D", lambda x: flow_d(x, shared)), ("F", flow_f), ("E", flow_e)):
                        step = "%s flow %s" % (r.where, name)
                        fn(r)
                    print("%s: flows A-G OK" % r.where)
    except (Fail, RuntimeError) as e:
        print("e2e_ui: FAIL at %s: %s" % (step, e))
        return 1
    print("e2e_ui: OK in %d s (%d screenshots in %s)" % (time.time() - t0, len(glob.glob(os.path.join(shots, "*.png"))), shots))
    return 0


if __name__ == "__main__":
    sys.exit(main())
