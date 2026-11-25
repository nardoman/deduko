#!/usr/bin/env python3
"""Deduko build tool.

Usage:
  build.py index                      write package/app/generated/index.js from the files present
  build.py base [--report DIR]        index + checks, then pack package/ into dist/deduko_<v>_kindleany.kpkg
                                      and write the manual-install zip dist/deduko_<v>_manuale.zip
  build.py pack <packDir> <outDir>    pack a case pack folder as the KPM package deduko-pack-<id>
                [--author NAME] [--scratch DIR]

The manual zip is extracted into the Kindle root (the folder that contains
documents/): documents/deduko_manuale.sh is the package scriptlet header plus
MANUAL_BODY (runs /mnt/us/deduko/pkg/launch.sh, output in /mnt/us/deduko/debug.log),
deduko/pkg/ holds every file of package/ except scriptlet/, deduko/packs/ is empty.

Temporary files and the kpkg listing go to --scratch / --report, else
$DEDUKO_SCRATCH (listing in its reports/ subfolder), else the temp dir.
"""
import argparse
import builtins
import glob
import json
import os
import runpy
import shutil
import subprocess
import tarfile
import tempfile
import uuid
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG = os.path.join(ROOT, "package")
APP = os.path.join(PKG, "app")
DIST = os.path.join(ROOT, "dist")
TOOLS = os.path.join(ROOT, "tools")
KPM_HELPER = os.path.join(TOOLS, "vendor", "kpm-helper.py")
ES5CHECK = os.path.join(TOOLS, "es5check.py")

REQUIRED_MEMBERS = ["manifest.json", "install.sh", "launch.sh", "uninstall.sh", "scriptlet/deduko.sh",
                    "app/index.html", "app/config.xml", "app/js/engine.js", "app/lang/it.js",
                    "app/lang/en.js", "app/packs/core/pack.js"]
FORBIDDEN_PREFIXES = ["tools/", "content/"]
PACK_PREFIX = "DEDUKO.addPack("
TEXT_PREFIX = "DEDUKO.addPackText("
SUFFIX = ");\n"

DIR_RX = re.compile(r"^[A-Za-z0-9_-]+$")
FILE_RX = re.compile(r"^[A-Za-z0-9._-]+$")


def build_index(app_dir=APP):
    """Returns the DEDUKO_INDEX object for app_dir: lang/*.js and, for every
    packs/<dir>/ containing pack.js, pack.js plus its text.*.js files."""
    langs = []
    lang_dir = os.path.join(app_dir, "lang")
    if os.path.isdir(lang_dir):
        for nm in sorted(os.listdir(lang_dir)):
            if nm.endswith(".js") and FILE_RX.match(nm) and os.path.isfile(os.path.join(lang_dir, nm)):
                langs.append("lang/" + nm)
    packs = []
    packs_dir = os.path.join(app_dir, "packs")
    if os.path.isdir(packs_dir):
        for d in sorted(os.listdir(packs_dir)):
            full = os.path.join(packs_dir, d)
            if not (DIR_RX.match(d) and os.path.isdir(full) and os.path.isfile(os.path.join(full, "pack.js"))):
                continue
            texts = sorted(nm for nm in os.listdir(full)
                           if nm.startswith("text.") and nm.endswith(".js") and FILE_RX.match(nm)
                           and os.path.isfile(os.path.join(full, nm)))
            packs.append({"dir": "packs/" + d + "/", "files": ["pack.js"] + texts})
    return {"langs": langs, "packs": packs}


def cmd_index(_args):
    index = build_index()
    out_dir = os.path.join(APP, "generated")
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "index.js")
    text = "window.DEDUKO_INDEX = " + json.dumps(index, ensure_ascii=False) + ";\n"
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    print("wrote %s" % path)
    print(text.strip())
    return 0


def default_scratch():
    return os.environ.get("DEDUKO_SCRATCH") or os.path.join(tempfile.gettempdir(), "deduko-build")


def read_wrapper(path, prefix):
    """Parses a data file DEDUKO.addPack(<json>);\\n (or addPackText) and returns the JSON."""
    with open(path, encoding="utf-8", newline="") as f:
        text = f.read()
    if not (text.startswith(prefix) and text.endswith(SUFFIX)):
        raise ValueError("%s: not of the form %s<json>%s" % (path, prefix, SUFFIX.strip()))
    return json.loads(text[len(prefix):-len(SUFFIX)])


def kpm_pack(pkg_dir, out_dir):
    """Runs the vendored kpm-helper `package pack <pkg_dir> <out_dir>` in-process.
    kpm-helper opens manifest.json in text mode, which writes CRLF on Windows;
    `open` is replaced in its globals so it writes LF exactly as on Linux. The
    vendored file itself is unchanged."""
    def lf_open(file, mode="r", *a, **kw):
        if "b" not in mode:
            kw.setdefault("encoding", "utf-8")
            if "w" in mode or "a" in mode:
                kw.setdefault("newline", "\n")
        return builtins.open(file, mode, *a, **kw)
    os.makedirs(out_dir, exist_ok=True)
    saved = sys.argv
    sys.argv = [KPM_HELPER, "package", "pack", pkg_dir, out_dir]
    try:
        runpy.run_path(KPM_HELPER, init_globals={"open": lf_open}, run_name="__main__")
    finally:
        sys.argv = saved


def kpkg_name(manifest):
    return "%s_%s_kindleany.kpkg" % (manifest["id"], ".".join(str(v) for v in manifest["version"]))


SCRIPTLET = os.path.join(PKG, "scriptlet", "deduko.sh")
HEADER_END = "# DontUseFBInk"
MANUAL_SCRIPT = "documents/deduko_manuale.sh"
MANUAL_BODY = """LOG="/mnt/us/deduko/debug.log"
mkdir -p /mnt/us/deduko/packs
{
    echo "=== Deduko manual launch $(date) ==="
    echo "user: $(id)"
    echo "sqlite3: $(command -v sqlite3)"
    echo "lipc-set-prop: $(command -v lipc-set-prop)"
    sh /mnt/us/deduko/pkg/launch.sh
    echo "launch.sh exit code: $?"
} > "$LOG" 2>&1
"""
MANUAL_REQUIRED = [MANUAL_SCRIPT, "deduko/packs/", "deduko/pkg/launch.sh", "deduko/pkg/manifest.json",
                   "deduko/pkg/app/index.html"]


def manual_zip_name(manifest):
    return "%s_%s_manuale.zip" % (manifest["id"], ".".join(str(v) for v in manifest["version"]))


def scriptlet_header():
    """The lines of package/scriptlet/deduko.sh up to and including '# DontUseFBInk' (LF)."""
    with open(SCRIPTLET, encoding="utf-8", newline="") as f:
        lines = f.read().split("\n")
    for i, ln in enumerate(lines):
        if ln == HEADER_END:
            return "\n".join(lines[:i + 1]) + "\n"
    raise ValueError("%s: no '%s' line" % (SCRIPTLET, HEADER_END))


def manual_pkg_files():
    """(zip name, path) for every file under package/ except scriptlet/, sorted."""
    out = []
    for dirpath, dirnames, filenames in os.walk(PKG):
        dirnames[:] = [d for d in dirnames if d != "__pycache__"]
        for nm in filenames:
            full = os.path.join(dirpath, nm)
            rel = os.path.relpath(full, PKG).replace(os.sep, "/")
            if rel.startswith("scriptlet/"):
                continue
            out.append(("deduko/pkg/" + rel, full))
    return sorted(out)


def build_manual_zip(manifest):
    """Writes dist/<id>_<version>_manuale.zip and returns its path; raises ValueError
    when the read-back finds a missing entry or a CR in a .sh entry."""
    out = os.path.join(DIST, manual_zip_name(manifest))
    tmp = out + ".tmp"
    script = scriptlet_header() + MANUAL_BODY
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(MANUAL_SCRIPT, script.encode("utf-8"))
        d = zipfile.ZipInfo("deduko/packs/")
        d.external_attr = (0o40775 << 16) | 0x10
        z.writestr(d, b"")
        for name, full in manual_pkg_files():
            z.write(full, name)
    problems = []
    with zipfile.ZipFile(tmp) as z:
        names = z.namelist()
        for req in MANUAL_REQUIRED:
            if req not in names:
                problems.append("missing zip entry " + req)
        for nm in names:
            if nm.endswith(".sh") and b"\r" in z.read(nm):
                problems.append("CR in zip entry " + nm)
    if problems:
        os.remove(tmp)
        raise ValueError("; ".join(problems))
    os.replace(tmp, out)
    return out


def sh_has_cr(paths):
    bad = []
    for p in paths:
        with open(p, "rb") as f:
            if b"\r" in f.read():
                bad.append(p)
    return bad


def cmd_base(args):
    if cmd_index(args) != 0:
        return 1
    shs = glob.glob(os.path.join(PKG, "**", "*.sh"), recursive=True)
    bad = sh_has_cr(shs)
    if bad:
        print("CR found in: " + ", ".join(bad))
        return 1
    print("no CR in %d .sh files" % len(shs))
    r = subprocess.call([sys.executable, "-B", ES5CHECK, APP])
    if r != 0:
        print("es5check failed")
        return 1
    n = 0
    for pack_dir in sorted(glob.glob(os.path.join(APP, "packs", "*"))):
        if not os.path.isdir(pack_dir):
            continue
        try:
            read_wrapper(os.path.join(pack_dir, "pack.js"), PACK_PREFIX)
            n += 1
            for t in sorted(glob.glob(os.path.join(pack_dir, "text.*.js"))):
                read_wrapper(t, TEXT_PREFIX)
                n += 1
        except (OSError, ValueError) as e:
            print("data file error: %s" % e)
            return 1
    print("parsed %d pack/text data files" % n)
    manifest_path = os.path.join(PKG, "manifest.json")
    with open(manifest_path, "rb") as f:
        before = f.read()
    manifest = json.loads(before.decode("utf-8"))
    kpm_pack(PKG, DIST)
    with open(manifest_path, "rb") as f:
        after = f.read()
    if after != before:
        with open(manifest_path, "wb") as f:
            f.write(before)
        print("manifest.json was rewritten by kpm-helper with different bytes (restored); "
              "make it identical to kpm-helper's output")
        return 1
    print("manifest.json unchanged by kpm-helper")
    kpkg = os.path.join(DIST, kpkg_name(manifest))
    if not os.path.isfile(kpkg):
        print("missing " + kpkg)
        return 1
    problems = []
    lines = []
    with tarfile.open(kpkg, "r:gz") as tf:
        members = tf.getmembers()
        names = [m.name for m in members]
        for m in members:
            lines.append("%s %10d %s" % ("d" if m.isdir() else "-", m.size, m.name))
            if m.isfile() and m.name.endswith(".sh") and b"\r" in tf.extractfile(m).read():
                problems.append("CR in member " + m.name)
    for req in REQUIRED_MEMBERS:
        if req not in names:
            problems.append("missing member " + req)
    for nm in names:
        for pre in FORBIDDEN_PREFIXES:
            if nm == pre.rstrip("/") or nm.startswith(pre):
                problems.append("forbidden member " + nm)
        if "__pycache__" in nm:
            problems.append("forbidden member " + nm)
    report = args.report or os.path.join(default_scratch(), "reports")
    os.makedirs(report, exist_ok=True)
    listing = os.path.join(report, "kpkg-listing.txt")
    with open(listing, "w", encoding="utf-8", newline="\n") as f:
        f.write(os.path.basename(kpkg) + " (%d bytes, %d members)\n" % (os.path.getsize(kpkg), len(names)))
        f.write("\n".join(lines) + "\n")
    print("listing (%d members) written to %s" % (len(names), listing))
    if problems:
        print("\n".join(problems))
        return 1
    print("OK %s (%d bytes)" % (kpkg, os.path.getsize(kpkg)))
    try:
        zpath = build_manual_zip(manifest)
    except (OSError, ValueError) as e:
        print("manual zip error: %s" % e)
        return 1
    with zipfile.ZipFile(zpath) as z:
        n_entries = len(z.namelist())
    print("OK %s (%d bytes, %d entries)" % (zpath, os.path.getsize(zpath), n_entries))
    return 0


PACK_INSTALL = """#!/bin/sh
echo "Deduko case pack %(id)s installed. Launch Deduko to play it."
exit 0
"""
PACK_UNINSTALL = """#!/bin/sh
echo "Deduko case pack %(id)s removed."
exit 0
"""
PACK_LAUNCH = """#!/bin/sh
exec /var/local/kmc/bin/kpm launch deduko
"""


def cmd_pack(args):
    src = os.path.abspath(args.packdir)
    try:
        pack = read_wrapper(os.path.join(src, "pack.js"), PACK_PREFIX)
    except (OSError, ValueError) as e:
        print("pack.js: %s" % e)
        return 1
    pid = pack.get("id")
    if not isinstance(pid, str) or not re.match(r"^[a-z0-9_-]+$", pid):
        print("pack.js: invalid pack id %r" % (pid,))
        return 1
    version = pack.get("version") or [1, 0, 0]
    texts = sorted(nm for nm in os.listdir(src)
                   if nm.startswith("text.") and nm.endswith(".js") and FILE_RX.match(nm))
    name = pid
    for t in texts:
        try:
            j = read_wrapper(os.path.join(src, t), TEXT_PREFIX)
        except (OSError, ValueError) as e:
            print("%s: %s" % (t, e))
            return 1
        if j.get("lang") == "en" and j.get("name"):
            name = j["name"]
    manifest = {"manifest_version": 2, "id": "deduko-pack-" + pid, "name": "Deduko pack: " + name,
                "author": args.author, "description": "Case pack '%s' for Deduko" % pid,
                "version": version, "dependencies": [{"id": "deduko", "min": [1, 0, 0]}],
                "supported_platforms": None}
    stage = os.path.join(args.scratch or default_scratch(), "stage-" + uuid.uuid4().hex)
    try:
        content = os.path.join(stage, "deduko-pack", pid)
        os.makedirs(content)
        for nm in ["pack.js"] + texts:
            shutil.copyfile(os.path.join(src, nm), os.path.join(content, nm))
        for nm, body in (("install.sh", PACK_INSTALL), ("uninstall.sh", PACK_UNINSTALL),
                         ("launch.sh", PACK_LAUNCH)):
            with open(os.path.join(stage, nm), "w", encoding="utf-8", newline="\n") as f:
                f.write(body % {"id": pid})
        with open(os.path.join(stage, "manifest.json"), "w", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(manifest, indent=2))
        kpm_pack(stage, os.path.abspath(args.outdir))
    finally:
        shutil.rmtree(stage, ignore_errors=True)
    out = os.path.join(os.path.abspath(args.outdir), kpkg_name(manifest))
    if not os.path.isfile(out):
        print("missing " + out)
        return 1
    print("OK %s (%d bytes)" % (out, os.path.getsize(out)))
    return 0


def main(argv):
    ap = argparse.ArgumentParser(description="Deduko build tool")
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("index", help="write package/app/generated/index.js")
    b = sub.add_parser("base", help="check and pack the Deduko package into dist/")
    b.add_argument("--report", default=None, help="folder for kpkg-listing.txt")
    p = sub.add_parser("pack", help="pack a case pack folder as a KPM package")
    p.add_argument("packdir")
    p.add_argument("outdir")
    p.add_argument("--author", default="nardoman")
    p.add_argument("--scratch", default=None)
    args = ap.parse_args(argv)
    if args.cmd == "index":
        return cmd_index(args)
    if args.cmd == "base":
        return cmd_base(args)
    if args.cmd == "pack":
        return cmd_pack(args)
    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
