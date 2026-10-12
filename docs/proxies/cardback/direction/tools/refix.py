# SPDX-License-Identifier: GPL-3.0-or-later
# Binder: mirror the raw on both axes, redraw the Necker cube + star over the centre, save as a guide
# for a light integration pass. Usage: refix.py <raw png> <out guide png>
import math, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
src, dst = sys.argv[1:3]
a = np.asarray(Image.open(src).convert("RGB"))
h, w = a.shape[:2]; q = a[: h // 2, : w // 2]
top = np.concatenate([q, q[:, ::-1]], 1); a = np.concatenate([top, top[::-1]], 0)
im = Image.fromarray(a); cx, cy = w / 2, h / 2
# sample the leather colour just outside the emblem to clear a calm field for it
ring = np.asarray(im, np.float32)[int(cy - 95):int(cy + 95), int(cx - 95):int(cx + 95)]
leather = tuple(int(v) for v in np.median(ring.reshape(-1, 3), 0) * 0.92)
lay = Image.new("RGBA", (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
d.ellipse([cx - 92, cy - 92, cx + 92, cy + 92], fill=leather + (235,))
G = (184, 146, 70, 255)
a_ = 44; v = (26, -26)
A = [(cx - v[0] / 2 + x, cy - v[1] / 2 + y) for x, y in ((-a_, -a_), (a_, -a_), (a_, a_), (-a_, a_))]
B = [(x + v[0], y + v[1]) for x, y in A]
d.polygon(B, outline=G, width=6); d.polygon(A, outline=G, width=6)
for p_, q_ in zip(A, B): d.line([p_, q_], fill=G, width=6)
st = [(cx + (17 if k % 2 == 0 else 6.5) * math.cos(math.pi * k / 8), cy + (17 if k % 2 == 0 else 6.5) * math.sin(math.pi * k / 8)) for k in range(16)]
d.polygon(st, fill=(214, 178, 100, 255))
lay = lay.filter(ImageFilter.GaussianBlur(0.8))
im.paste(lay, (0, 0), lay)
im.save(dst)
