# SPDX-License-Identifier: GPL-3.0-or-later
# Two Seats: paste the guide's card fan + hands and the round lamp back over a painted half (the model
# kept turning the fan into candles and folding fans), plus any extra rectangles to clear. Usage:
# seatfix.py raw guide out [x0,y0,x1,y1 ...]
import math, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
src, guide, dst = sys.argv[1:4]; extra = sys.argv[4:]
W, H = 1216, 832; cx = W / 2; FS = 0.84
T = lambda x, y: (cx - W * FS / 2 + x * FS, (H - 70) - (H - 70) * FS + y * FS)   # guides4's figure transform
m = Image.new("L", (W, H), 0); d = ImageDraw.Draw(m)
for k in range(-3, 4):
    ang = math.radians(k * 12); bx, by = cx, 650
    pts = [T(bx + px * math.cos(ang) - py * math.sin(ang), by + px * math.sin(ang) + py * math.cos(ang))
           for (px, py) in ((-50, -306), (50, -306), (50, 6), (-50, 6))]
    d.polygon(pts, fill=255)
x0, y0 = T(cx - 84, 604); x1, y1 = T(cx + 84, 674); d.ellipse([x0, y0, x1, y1], fill=255)
d.ellipse([cx - 104, H - 104, cx + 104, H + 104], fill=255)                      # the lamp
for e in extra:
    d.rectangle([int(v) for v in e.split(",")], fill=255)
m = np.asarray(m.filter(ImageFilter.GaussianBlur(4)), np.float32)[..., None] / 255
a = np.asarray(Image.open(src).convert("RGB"), np.float32)
g = np.asarray(Image.open(guide).convert("RGB"), np.float32)
Image.fromarray((a * (1 - m) + g * m).astype(np.uint8)).save(dst)
