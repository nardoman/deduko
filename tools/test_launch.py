#!/usr/bin/env python3
"""Checks the built Deduko packages and runs launch.sh on the PC with Git sh.

Usage: test_launch.py [--scratch DIR]

Run after `build.py base`. It:
  1. extracts dist/deduko_<v>_manuale.zip into <scratch>/kindle-root (fresh) and
     checks its entries: documents/deduko_manuale.sh, the empty deduko/packs/
     folder and deduko/pkg/<every file of package/ except scriptlet/>, each
     byte-identical to its source; no CR in any .sh; the scriptlet is the
     header of package/scriptlet/deduko.sh plus build.MANUAL_BODY;
  2. runs `sh -n` on the extracted scriptlet and on the package .sh files;
  3. runs `sh launch.sh` from the extracted deduko/pkg and from package/ with
     DEDUKO_TARGET, DEDUKO_USB_PACKS, DEDUKO_KPM_PACKAGES set to scratch
     folders and DEDUKO_NO_LAUNCH=1, and checks the copied app and its
     generated/index.js;
  4. checks that the kpkg's manifest.json has the version of package/manifest.json.
The scratch folder is --scratch, else $DEDUKO_SCRATCH, else %TEMP%/deduko-launch.
Prints 'test_launch: OK' and exits 0, or prints the problems and exits 1.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)
import build  # noqa: E402

ROOT = os.path.dirname(TOOLS)
PKG = os.path.join(ROOT, "package")
DIST = os.path.join(ROOT, "dist")
SH = r"C:\Program Files\Git\bin\sh.exe"
PKG_SH = ["install.sh", "launch.sh", "uninstall.sh", "scriptlet/deduko.sh"]


def msys(path):
    """C:\\Users\\x -> /c/Users/x (Git sh path form)."""
    p = os.path.abspath(path).replace("\\", "/")
    if len(p) > 1 and p[1] == ":":
        p = "/" + p[0].lower() + p[2:]
    return p


def read(path):
    with open(path, "rb") as f:
        return f.read()


def check_zip(zpath, root, problems):
    shutil.rmtree(root, ignore_errors=True)
    os.makedirs(root)
    with zipfile.ZipFile(zpath) as z:
        names = z.namelist()
        z.extractall(root)
    expected = {build.MANUAL_SCRIPT: None, "deduko/packs/": None}
    for name, full in build.manual_pkg_files():
        expected[name] = full
    if len(names) != len(set(names)):
        problems.append("duplicate zip entries")
    got = set(names)
    for nm in sorted(set(expected) - got):
        problems.append("missing zip entry " + nm)
    for nm in sorted(got - set(expected)):
        problems.append("unexpected zip entry " + nm)
    for nm, src in sorted(expected.items()):
        if nm not in got:
            continue
        dst = os.path.join(root, *nm.rstrip("/").split("/"))
        if nm.endswith("/"):
            if not os.path.isdir(dst) or os.listdir(dst):
                problems.append(nm + " is not an empty folder")
            continue
        data = read(dst)
        if nm.endswith(".sh") and b"\r" in data:
            problems.append("CR in " + nm)
        if src is not None and data != read(src):
            problems.append(nm + " differs from " + src)
    script = os.path.join(root, "documents", "deduko_manuale.sh")
    if os.path.isfile(script):
        text = read(script).decode("utf-8")
        header = build.scriptlet_header()
        if not text.startswith(header):
            problems.append("scriptlet header differs from package/scriptlet/deduko.sh")
        elif text[len(header):] != build.MANUAL_BODY:
            problems.append("scriptlet body differs from build.MANUAL_BODY")
    return script


def sh_n(path, problems):
    r = subprocess.run([SH, "-n", msys(path)], capture_output=True, text=True)
    if r.returncode != 0:
        problems.append("sh -n %s: exit %d %s" % (path, r.returncode, (r.stderr or "").strip()))


def run_launch(pkg_dir, target, usb, nokpm, problems):
    shutil.rmtree(target, ignore_errors=True)
    os.makedirs(nokpm, exist_ok=True)
    env = dict(os.environ)
    env.update({"DEDUKO_TARGET": msys(target), "DEDUKO_USB_PACKS": msys(usb),
                "DEDUKO_KPM_PACKAGES": msys(nokpm), "DEDUKO_NO_LAUNCH": "1"})
    r = subprocess.run([SH, "launch.sh"], cwd=pkg_dir, env=env, capture_output=True, text=True)
    where = "launch.sh in " + pkg_dir
    if r.returncode != 0:
        problems.append("%s: exit %d\n%s%s" % (where, r.returncode, r.stdout, r.stderr))
        return
    if not os.path.isfile(os.path.join(target, "index.html")):
        problems.append(where + ": no index.html in the target")
    idx = os.path.join(target, "generated", "index.js")
    if not os.path.isfile(idx):
        problems.append(where + ": no generated/index.js")
        return
    text = read(idx).decode("utf-8")
    for s in ('"lang/en.js"', '"lang/it.js"', '"packs/core/"'):
        if s not in text:
            problems.append("%s: generated/index.js lacks %s" % (where, s))
    print("%s: exit 0, %s" % (where, text.strip()))


def main(argv):
    ap = argparse.ArgumentParser(description="Check the Deduko packages and run launch.sh")
    ap.add_argument("--scratch", default=None)
    args = ap.parse_args(argv)
    scratch = os.path.abspath(args.scratch or os.environ.get("DEDUKO_SCRATCH")
                              or os.path.join(tempfile.gettempdir(), "deduko-launch"))
    os.makedirs(scratch, exist_ok=True)
    problems = []
    manifest = json.loads(read(os.path.join(PKG, "manifest.json")).decode("utf-8"))
    zpath = os.path.join(DIST, build.manual_zip_name(manifest))
    kpkg = os.path.join(DIST, build.kpkg_name(manifest))
    for p in (zpath, kpkg):
        if not os.path.isfile(p):
            print("missing %s (run build.py base first)" % p)
            return 1
    if not os.path.isfile(SH):
        print("missing " + SH)
        return 1
    root = os.path.join(scratch, "kindle-root")
    script = check_zip(zpath, root, problems)
    print("zip %s checked" % os.path.basename(zpath))
    if os.path.isfile(script):
        sh_n(script, problems)
    for s in PKG_SH:
        sh_n(os.path.join(PKG, *s.split("/")), problems)
    print("sh -n done on %d scripts" % (len(PKG_SH) + 1))
    usb = os.path.join(root, "deduko", "packs")
    nokpm = os.path.join(scratch, "no-kpm")
    run_launch(os.path.join(root, "deduko", "pkg"), os.path.join(scratch, "target-zip"), usb, nokpm, problems)
    run_launch(PKG, os.path.join(scratch, "target-pkg"), usb, nokpm, problems)
    with tarfile.open(kpkg, "r:gz") as tf:
        m = None
        for mem in tf.getmembers():
            if mem.name in ("manifest.json", "./manifest.json"):
                m = json.loads(tf.extractfile(mem).read().decode("utf-8"))
        if m is None:
            problems.append("no manifest.json in " + kpkg)
        elif m.get("version") != manifest["version"]:
            problems.append("kpkg version %r != %r" % (m.get("version"), manifest["version"]))
        else:
            print("kpkg %s: version %s" % (os.path.basename(kpkg), m["version"]))
    if problems:
        print("\n".join(problems))
        print("test_launch: FAILED")
        return 1
    print("test_launch: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
