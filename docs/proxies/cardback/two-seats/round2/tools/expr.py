# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 2: nudge an expression on a 1024 face tile before a low-strength repaint.
# A sum of small gaussian displacements (each: centre x y, sigma x y, shift dx dy in px), sampled backwards, so a
# feature at the centre moves by (dx, dy) and its surroundings follow smoothly. Used for: mouth corners lifted
# (a faint smile), one corner lifted (a held-back half smile), irises slid inside the eye (a sidelong glance),
# upper lids lowered a few px (relaxed or narrowed eyes).
#   expr.py <in.png> <out.png> <char>
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates

W = {
    # composed, faintly pleased: both corners up and out, the cheeks lifted a touch, the upper lids eased down
    "green": [(457, 747, 14, 10, -4, -9), (570, 746, 14, 10, 4, -9),
              (445, 690, 34, 26, 0, -3), (585, 690, 34, 26, 0, -3),
              (422, 541, 24, 6, 0, 3), (600, 539, 24, 6, 0, 3)],
    # guarded, intent: the irises slid toward the viewer's right (a sidelong glance across the table), the upper
    # lids lowered (narrowed, watchful), the viewer's-right corner of the mouth lifted (a held-back half smile)
    "blue": [(435, 558, 15, 12, 13, 0), (610, 558, 15, 12, 13, 0),
             (437, 545, 30, 6, 0, 4), (607, 545, 30, 6, 0, 4),
             (575, 745, 13, 10, 2, -5)],
}
src, out, ch = sys.argv[1:4]
a = np.asarray(Image.open(src).convert("RGB"), np.float32)
H, Wd = a.shape[:2]
yy, xx = np.mgrid[0:H, 0:Wd].astype(np.float32)
DX = np.zeros_like(xx); DY = np.zeros_like(yy)
for cx, cy, sx, sy, dx, dy in W[ch]:
    g = np.exp(-0.5 * (((xx - cx) / sx) ** 2 + ((yy - cy) / sy) ** 2))
    DX += dx * g; DY += dy * g
o = np.stack([map_coordinates(a[..., k], [yy - DY, xx - DX], order=3, mode="nearest") for k in range(3)], -1)
Image.fromarray(np.clip(o, 0, 255).astype(np.uint8)).save(out)
print(out)
