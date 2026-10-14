# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, order 1, finish: the fan of cards toward near-black warm grey, a value/hue shift confined to the
# card mask (fix 5). No painting here; the fan's foot is repainted afterwards by the hands inpaint.
#   cards.py <in top.png> <out top.png>          (run in two-seats-work/order1/finish)
# Card mask: inside the fan's box (x 615-885, y 660-845), pixels that are neither the robe's red (R > 1.5 G and
# R > 1.5 B) nor skin (Y > 85, R > 1.3 B, G < 0.86 R) -- the worn brown patches on the backs are neither; every connected piece of 150 px or more, holes filled.
# Shift: luma Y -> 14 + 0.45 Y below Y 110, eased back to Y itself by Y 165 (the gilt and cream edges keep their
# light), then the colour is that luma times a warm grey (1.10, 0.99, 0.88); the light edges (the same ease) take
# 0.88 of their luma as a dull gilt (1.22, 0.98, 0.62). A 1 px soft edge on the mask.
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import binary_fill_holes, binary_opening, label, gaussian_filter
src, out = sys.argv[1:3]
a = np.asarray(Image.open(src).convert("RGB"), np.float32)
x0, y0, x1, y1 = 615, 660, 885, 845
c = a[y0:y1, x0:x1]
R, G, B = c[..., 0], c[..., 1], c[..., 2]
Y = c @ np.array([.2126, .7152, .0722], np.float32)
robe = (R > 1.5 * G) & (R > 1.5 * B)
skin = (Y > 85) & (R > 1.3 * B) & (G < 0.86 * R)
m = ~robe & ~skin
m = binary_opening(m, iterations=1)
lab, n = label(m); sz = np.bincount(lab.ravel()); sz[0] = 0
m = binary_fill_holes(np.isin(lab, np.nonzero(sz >= 150)[0]))
t = np.clip((Y - 110) / 55, 0, 1); t = t * t * (3 - 2 * t)
Yn = (14 + 0.45 * Y) * (1 - t) + Y * t
warm = np.array([1.10, 0.99, 0.88], np.float32)
gold = np.array([1.22, 0.98, 0.62], np.float32)
new = (Yn * (1 - t))[..., None] * warm + (0.88 * Y * t)[..., None] * gold
w = np.clip(gaussian_filter(m.astype(np.float32), 0.7), 0, 1) * m.max()
w = np.maximum(w, m)  # inside the mask fully; the soft part only outside it
c2 = c * (1 - w[..., None]) + new * w[..., None]
o = a.copy(); o[y0:y1, x0:x1] = c2
Image.fromarray(np.round(np.clip(o, 0, 255)).astype(np.uint8)).save(out)
Image.fromarray((m * 255).astype(np.uint8)).save(out.replace(".png", "-cardmask.png"))
print("card px", int(m.sum()))
