#!/usr/bin/env python3
"""ES5 checker for the Deduko Mesquite app (WebKit 533).

Usage: es5check.py <path> [<path> ...]

Parses every .js file under the given paths (and the inline <script> blocks
of .html files) with pyjsparser, an ES5 parser, then walks the AST and fails
on constructs or APIs that the Kindle browser does not support.
Prints file:line for each failure and exits 1 if there is any.
"""
import os
import re
import sys

import pyjsparser

BAD_MEMBERS = set("bind classList includes startsWith endsWith repeat padStart "
                  "find findIndex assign from".split())
BAD_IDENTS = set("Promise Map Set WeakMap Symbol requestAnimationFrame fetch".split())

SCRIPT_RX = re.compile(r"<script\b([^>]*)>(.*?)</script>", re.S | re.I)
ERR_LINE_RX = re.compile(r"Line (\d+)")


def walk(node, found):
    """Collect (kind, token) pairs for denied constructs."""
    if isinstance(node, list):
        for x in node:
            walk(x, found)
        return
    if not isinstance(node, dict):
        return
    t = node.get("type")
    if t == "VariableDeclaration" and node.get("kind") != "var":
        found.add(("decl", node.get("kind")))
    if t == "MemberExpression":
        prop = node.get("property") or {}
        walk(node.get("object"), found)
        if not node.get("computed") and prop.get("type") == "Identifier":
            if prop.get("name") in BAD_MEMBERS:
                found.add(("member", prop.get("name")))
        else:
            walk(prop, found)
        return
    if t == "Property":
        key = node.get("key") or {}
        if node.get("computed"):
            walk(key, found)
        walk(node.get("value"), found)
        return
    if t == "Identifier" and node.get("name") in BAD_IDENTS:
        found.add(("ident", node.get("name")))
    for k, v in node.items():
        if k in ("type", "range", "loc"):
            continue
        if isinstance(v, (dict, list)):
            walk(v, found)


def token_lines(src, kind, tok):
    if kind == "decl":
        rx = re.compile(r"\b%s\b" % re.escape(tok))
    elif kind == "member":
        rx = re.compile(r"\.\s*%s\b" % re.escape(tok))
    else:
        rx = re.compile(r"\b%s\b" % re.escape(tok))
    lines = []
    for i, line in enumerate(src.split("\n"), 1):
        if rx.search(line):
            lines.append(i)
    return lines or [0]


def check_source(src, label, line_offset, errors):
    """Parse src; on syntax errors blank the bad line and retry so that every
    problem in the file is reported, not only the first one."""
    work = src.split("\n")
    for _ in range(50):
        text = "\n".join(work)
        try:
            ast = pyjsparser.parse(text)
        except Exception as e:  # pyjsparser raises JsSyntaxError
            msg = str(e)
            m = ERR_LINE_RX.search(msg)
            ln = int(m.group(1)) if m else 0
            errors.append("%s:%d: syntax error (not ES5): %s" % (label, ln + line_offset, msg))
            if not m or ln < 1 or ln > len(work) or not work[ln - 1].strip():
                return
            work[ln - 1] = ""
            continue
        found = set()
        walk(ast, found)
        for kind, tok in sorted(found):
            what = {"decl": "'%s' declaration" % tok,
                    "member": "'.%s' (not in WebKit 533)" % tok,
                    "ident": "'%s' (not in WebKit 533)" % tok}[kind]
            for ln in token_lines(text, kind, tok):
                errors.append("%s:%d: %s" % (label, ln + line_offset, what))
        return


def check_file(path, errors):
    with open(path, encoding="utf-8") as f:
        src = f.read()
    if path.lower().endswith(".js"):
        check_source(src, path, 0, errors)
        return 1
    n = 0
    for m in SCRIPT_RX.finditer(src):
        attrs, body = m.group(1), m.group(2)
        if re.search(r"\bsrc\s*=", attrs, re.I) or not body.strip():
            continue
        offset = src.count("\n", 0, m.start(2))
        check_source(body, path, offset, errors)
        n += 1
    return n


def main(argv):
    if not argv:
        print(__doc__.strip())
        return 2
    files = []
    for p in argv:
        if os.path.isdir(p):
            for root, dirs, names in os.walk(p):
                dirs.sort()
                for nm in sorted(names):
                    if nm.lower().endswith((".js", ".html", ".htm")):
                        files.append(os.path.join(root, nm))
        elif os.path.isfile(p):
            files.append(p)
        else:
            print("%s: no such file or directory" % p)
            return 1
    errors = []
    for f in files:
        check_file(f, errors)
    for e in errors:
        print(e)
    print("es5check: %d file(s), %d problem(s)" % (len(files), len(errors)))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
