#!/usr/bin/env python3
"""Draw the Deduko icon and embed it in the scriptlet.

Usage: make_icon.py

Writes package/app/icon.png, the library cover (600x800, 16 grey levels: the
title, five difficulty balls, a 4x4 grid with marks and a magnifier), copies it
to docs/images/cover.png for the README, and rewrites the "# Icon:" line of
package/scriptlet/deduko.sh with its base64 data URL. Requires Pillow and the
Georgia Bold font (Windows). The output is deterministic.
"""
import base64
import io
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON = os.path.join(ROOT, "package", "app", "icon.png")
SCRIPTLET = os.path.join(ROOT, "package", "scriptlet", "deduko.sh")
SIZE = 64


W, H = 600, 800          # library cover, portrait like a book
SS = 3                   # drawn 3x larger, then downscaled for smooth edges
FONT = r"C:\Windows\Fonts\georgiab.ttf"
GREYS = 16               # e-ink shows 16 grey levels


def draw_cover():
    from PIL import ImageFont
    w, h = W * SS, H * SS
    img = Image.new("L", (w, h), 255)
    d = ImageDraw.Draw(img)
    s = lambda v: int(round(v * SS))
    # double frame
    d.rectangle([s(18), s(18), w - s(18), h - s(18)], outline=0, width=s(6))
    d.rectangle([s(32), s(32), w - s(32), h - s(32)], outline=0, width=s(2))
    # title
    font = ImageFont.truetype(FONT, s(112))
    title = "Deduko"
    tb = d.textbbox((0, 0), title, font=font)
    tw = tb[2] - tb[0]
    d.text(((w - tw) // 2 - tb[0], s(78) - tb[1]), title, font=font, fill=0)
    # five difficulty balls under the title
    r, gap, by = s(11), s(36), s(240)
    bx0 = w // 2 - 2 * gap
    for k in range(5):
        cx = bx0 + k * gap
        d.ellipse([cx - r, by - r, cx + r, by + r], fill=0)
    d.line([(s(120), s(285)), (w - s(120), s(285))], fill=0, width=s(2))
    # 4x4 grid with a few marks
    n, cell = 4, s(84)
    gx, gy = (w - n * cell) // 2 - s(40), s(340)
    for i in range(n + 1):
        lw = s(6) if i in (0, n) else s(3)
        d.line([(gx + i * cell, gy), (gx + i * cell, gy + n * cell)], fill=0, width=lw)
        d.line([(gx, gy + i * cell), (gx + n * cell, gy + i * cell)], fill=0, width=lw)
    def dot(i, j):
        cx, cy, rr = gx + i * cell + cell // 2, gy + j * cell + cell // 2, s(17)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=0)
    def cross(i, j):
        m = s(24)
        ax, ay = gx + i * cell + m, gy + j * cell + m
        bx, by2 = gx + (i + 1) * cell - m, gy + (j + 1) * cell - m
        d.line([(ax, ay), (bx, by2)], fill=0, width=s(7))
        d.line([(bx, ay), (ax, by2)], fill=0, width=s(7))
    dot(0, 0); cross(1, 0); cross(2, 0); cross(3, 0)
    cross(0, 1); dot(2, 1)
    cross(0, 2); cross(2, 2)
    cross(0, 3)
    # magnifier over the bottom right of the grid
    mx, my, mr = gx + s(262), gy + s(262), s(92)
    d.ellipse([mx - mr, my - mr, mx + mr, my + mr], fill=0)
    inner = mr - s(16)
    d.ellipse([mx - inner, my - inner, mx + inner, my + inner], fill=228)
    hx0, hy0 = mx + int(mr * 0.68), my + int(mr * 0.68)
    d.line([(hx0, hy0), (hx0 + s(75), hy0 + s(75))], fill=0, width=s(30))
    d.line([(mx - s(40), my - s(40)), (mx - s(18), my - s(56))], fill=255, width=s(8))
    img = img.resize((W, H), Image.LANCZOS)
    step = 255.0 / (GREYS - 1)
    return img.point(lambda v: int(round(round(v / step) * step)))


def draw():
    img = Image.new("L", (SIZE, SIZE), 255)
    d = ImageDraw.Draw(img)
    # 3x3 grid, top left
    x0, y0, cell = 4, 4, 12
    for i in range(4):
        w = 3 if i in (0, 3) else 2
        d.line([(x0 + i * cell, y0), (x0 + i * cell, y0 + 3 * cell)], fill=0, width=w)
        d.line([(x0, y0 + i * cell), (x0 + 3 * cell, y0 + i * cell)], fill=0, width=w)
    # a "yes" dot and two "no" crosses
    cx, cy = x0 + cell // 2, y0 + cell // 2
    d.ellipse([cx - 3, cy - 3, cx + 3, cy + 3], fill=0)
    for (i, j) in ((1, 0), (0, 1)):
        ax, ay = x0 + i * cell + 3, y0 + j * cell + 3
        d.line([(ax, ay), (ax + 6, ay + 6)], fill=0, width=2)
        d.line([(ax + 6, ay), (ax, ay + 6)], fill=0, width=2)
    # magnifier, bottom right
    mx, my, r = 38, 38, 13
    d.ellipse([mx - r - 2, my - r - 2, mx + r + 2, my + r + 2], fill=0)
    d.ellipse([mx - r + 2, my - r + 2, mx + r - 2, my + r - 2], fill=255)
    d.line([(mx + 10, my + 10), (60, 60)], fill=0, width=7)
    return img.point(lambda v: 0 if v < 128 else 255).convert("1")


DOC_COVER = os.path.join(ROOT, "docs", "images", "cover.png")


def main():
    img = draw_cover()
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    data = buf.getvalue()
    os.makedirs(os.path.dirname(ICON), exist_ok=True)
    with open(ICON, "wb") as f:
        f.write(data)
    os.makedirs(os.path.dirname(DOC_COVER), exist_ok=True)
    with open(DOC_COVER, "wb") as f:
        f.write(data)
    b64 = base64.b64encode(data).decode("ascii")
    with open(SCRIPTLET, encoding="utf-8", newline="") as f:
        lines = f.read().split("\n")
    found = False
    for i, line in enumerate(lines):
        if line.startswith("# Icon:"):
            lines[i] = "# Icon: data:image/png;base64," + b64
            found = True
    if not found:
        print("no '# Icon:' line in " + SCRIPTLET)
        return 1
    with open(SCRIPTLET, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))
    print("wrote %s (%d bytes) and the icon line of %s" % (ICON, len(data), SCRIPTLET))
    return 0


if __name__ == "__main__":
    sys.exit(main())
