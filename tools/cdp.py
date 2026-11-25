"""Minimal headless Chrome driver over the DevTools protocol (CDP).

    with Chrome(scratch_dir) as c:
        c.navigate("file:///.../harness.html")
        print(c.eval("typeof DEDUKO.engine.solve"))

Each run uses a fresh profile <scratch_dir>/chrome-<uuid>, removed on exit.
Requires websocket-client.
"""
import base64
import json
import os
import shutil
import socket
import subprocess
import time
import urllib.request
import uuid

import websocket

CHROME = os.environ.get("DEDUKO_CHROME", r"C:\Program Files\Google\Chrome\Application\chrome.exe")


def file_url(path):
    return "file:///" + os.path.abspath(path).replace("\\", "/")


class Chrome:
    def __init__(self, scratch_dir, timeout=600):
        self.scratch_dir = scratch_dir
        self.timeout = timeout
        self.proc = None
        self.ws = None
        self.profile = None
        self._id = 0
        self.events = []

    # ---- lifecycle ----
    def __enter__(self):
        os.makedirs(self.scratch_dir, exist_ok=True)
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        self.profile = os.path.join(self.scratch_dir, "chrome-" + uuid.uuid4().hex)
        args = [CHROME, "--headless=new", "--disable-gpu", "--no-first-run",
                "--no-default-browser-check", "--allow-file-access-from-files",
                "--remote-allow-origins=*", "--remote-debugging-port=%d" % port,
                "--user-data-dir=" + self.profile, "about:blank"]
        self.proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            ws_url = None
            deadline = time.time() + 30
            while time.time() < deadline and ws_url is None:
                try:
                    with urllib.request.urlopen("http://127.0.0.1:%d/json" % port, timeout=2) as r:
                        targets = json.loads(r.read().decode("utf-8"))
                    for t in targets:
                        if t.get("type") == "page" and t.get("webSocketDebuggerUrl"):
                            ws_url = t["webSocketDebuggerUrl"]
                            break
                except Exception:
                    pass
                if ws_url is None:
                    time.sleep(0.2)
            if ws_url is None:
                raise RuntimeError("Chrome DevTools endpoint not reachable")
            self.ws = websocket.create_connection(ws_url, timeout=self.timeout, suppress_origin=True,
                                                  enable_multithread=False)
            self.send("Page.enable")
            self.send("Runtime.enable")
        except Exception:
            self.__exit__(None, None, None)
            raise
        return self

    def __exit__(self, *exc):
        try:
            if self.ws:
                self.ws.close()
        except Exception:
            pass
        try:
            if self.proc and self.proc.poll() is None:
                self.proc.terminate()
                try:
                    self.proc.wait(10)
                except Exception:
                    self.proc.kill()
                    self.proc.wait(10)
        except Exception:
            pass
        if self.profile:
            for _ in range(20):
                try:
                    shutil.rmtree(self.profile)
                except FileNotFoundError:
                    break
                except Exception:
                    time.sleep(0.5)
                    continue
                break
        return False

    # ---- protocol ----
    def send(self, method, params=None):
        self._id += 1
        mid = self._id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError("%s: %s" % (method, msg["error"]))
                return msg.get("result", {})
            if "method" in msg:
                self.events.append(msg)

    def wait_event(self, name, timeout=60):
        deadline = time.time() + timeout
        while True:
            for i, e in enumerate(self.events):
                if e.get("method") == name:
                    del self.events[:i + 1]
                    return e
            if time.time() > deadline:
                raise RuntimeError("timeout waiting for " + name)
            msg = json.loads(self.ws.recv())
            if "method" in msg:
                self.events.append(msg)

    # ---- helpers ----
    def navigate(self, url):
        self.events = []
        self.send("Page.navigate", {"url": url})
        self.wait_event("Page.loadEventFired")

    def reload(self):
        self.events = []
        self.send("Page.reload", {"ignoreCache": True})
        self.wait_event("Page.loadEventFired")

    def eval(self, expr):
        r = self.send("Runtime.evaluate", {"expression": expr, "returnByValue": True})
        if "exceptionDetails" in r:
            d = r["exceptionDetails"]
            desc = (d.get("exception") or {}).get("description") or d.get("text")
            raise RuntimeError("JS exception: %s" % desc)
        return r.get("result", {}).get("value")

    def viewport(self, w, h):
        self.send("Emulation.setDeviceMetricsOverride",
                  {"width": int(w), "height": int(h), "deviceScaleFactor": 1, "mobile": False})

    def throttle(self, rate):
        self.send("Emulation.setCPUThrottlingRate", {"rate": rate})

    def click(self, x, y):
        for t in ("mouseMoved", "mousePressed", "mouseReleased"):
            p = {"type": t, "x": x, "y": y}
            if t != "mouseMoved":
                p.update({"button": "left", "clickCount": 1})
            self.send("Input.dispatchMouseEvent", p)

    def click_css(self, sel):
        r = self.eval("(function(){var e=document.querySelector(%s);if(!e)return null;"
                      "var r=e.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];})()"
                      % json.dumps(sel))
        if r is None:
            raise RuntimeError("no element for " + sel)
        self.click(r[0], r[1])

    def screenshot(self, path):
        r = self.send("Page.captureScreenshot", {"format": "png"})
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "wb") as f:
            f.write(base64.b64decode(r["data"]))
