# SPDX-License-Identifier: GPL-3.0-or-later
# Binder guide v2: a l'eventail binding (fan corner pieces, fan rosette, roll border, semé of stars).
import math, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
sys.argv = [sys.argv[0], "guides"]
exec(open("tools/guides.py").read().split("# ---------------------------------------------------------------- 1. binder")[0])

def star(d, x, y, r, col, n=8, inner=0.38):
    pts = [(x + (r if k % 2 == 0 else r * inner) * math.cos(math.pi * k / n), y + (r if k % 2 == 0 else r * inner) * math.sin(math.pi * k / n)) for k in range(2 * n)]
    d.polygon(pts, fill=col)

def fan(d, x, y, r0, r1, a0, a1, n, col, dark):
    for k in range(n):
        t0 = a0 + (a1 - a0) * k / n; t1 = a0 + (a1 - a0) * (k + 1) / n
        tm = (t0 + t1) / 2
        poly = [(x + r0 * math.cos(math.radians(t0)), y + r0 * math.sin(math.radians(t0)))]
        for t in np.linspace(t0, t1, 6):
            poly.append((x + r1 * math.cos(math.radians(t)), y + r1 * math.sin(math.radians(t))))
        poly.append((x + r0 * math.cos(math.radians(t1)), y + r0 * math.sin(math.radians(t1))))
        d.polygon(poly, outline=col, width=3)
        # a leaf tool inside each blade
        lx = x + (r0 + r1) / 2 * math.cos(math.radians(tm)); ly = y + (r0 + r1) / 2 * math.sin(math.radians(tm))
        d.ellipse([lx - 5, ly - 5, lx + 5, ly + 5], fill=col)
        for t in np.linspace(t0, t1, 6):
            px = x + (r1 + 9) * math.cos(math.radians(t)); py = y + (r1 + 9) * math.sin(math.radians(t))
            d.ellipse([px - 2.5, py - 2.5, px + 2.5, py + 2.5], fill=col)
    d.arc([x - r0, y - r0, x + r0, y + r0], a0, a1, fill=col, width=4)

def binder2(leather, name):
    W, H = 832, 1152; cx, cy = W / 2, H / 2
    im = to_img(textured(W, H, leather, amp=9, blur=0.9))
    q = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(q)
    G = GOLD + (255,)
    # outer roll border band: two rules with a row of small lozenge tools between
    d.rectangle([84, 84, W, H], outline=G, width=6)
    d.rectangle([118, 118, W, H], outline=G, width=3)
    for x in range(110, int(cx) + 20, 22):
        d.polygon([(x, 92), (x + 9, 101), (x, 110), (x - 9, 101)], fill=G)
    for y in range(110, int(cy) + 20, 22):
        d.polygon([(92, y), (101, y - 9), (110, y), (101, y + 9)], fill=G)
    # inner panel rule
    d.rectangle([150, 150, W, H], outline=G, width=2)
    # fan corner piece
    fan(d, 150, 150, 26, 120, 0, 90, 7, G, None)
    # semé of small stars in a diamond lattice, kept off the fan, the word panel and the rosette
    for j, y in enumerate(range(200, int(cy) + 1, 46)):
        for x in range(190 + (j % 2) * 33, int(cx) + 1, 66):
            if math.hypot(x - 150, y - 150) < 150: continue
            if abs(x - cx) < 150 and abs(y - 205) < 50: continue
            if math.hypot(x - cx, y - cy) < 225: continue
            star(d, x, y, 8, G)
    im.paste(q, (0, 0), q)
    im = quad_mirror(im)
    d = ImageDraw.Draw(im)
    # word panels (calm, head-to-tail)
    for yy in (205, H - 205):
        d.rounded_rectangle([cx - 128, yy - 34, cx + 128, yy + 34], radius=16, outline=GOLD, width=3)
    # central fan rosette: sixteen blades around a ring, the Necker cube in the middle
    fan(d, cx, cy, 120, 200, 0, 360, 16, GOLD, None)
    d.ellipse([cx - 112, cy - 112, cx + 112, cy + 112], outline=GOLD, width=3)
    a = 48; v = (28, -28)
    A = [(cx - v[0] / 2 + x, cy - v[1] / 2 + y) for x, y in ((-a, -a), (a, -a), (a, a), (-a, a))]
    B = [(x + v[0], y + v[1]) for x, y in A]
    d.polygon(B, outline=GOLD, width=6); d.polygon(A, outline=GOLD, width=6)
    for p_, q_ in zip(A, B): d.line([p_, q_], fill=GOLD, width=6)
    star(d, cx, cy, 18, (206, 170, 96))
    im.save(f"guides/{name}.png")

binder2((30, 62, 46), "binder2-green")
binder2((26, 44, 72), "binder2-blue")
binder2((92, 24, 38), "binder2-garnet")
import numpy as np
for n in ("binder2-green",):
    a = np.asarray(Image.open(f"guides/{n}.png"), float); print(n, "rot180 diff", np.abs(a - a[::-1, ::-1]).mean())
