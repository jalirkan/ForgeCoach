# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 3: round 2's expression nudge (../../round2/tools/expr.py on its branch), re-measured for
# round 3's blue face tile (repaint/blue-face-s522.png, 1024 px): a sum of small gaussian displacements, each
# (centre x, y, sigma x, y, shift dx, dy), sampled backwards, then repainted at 0.34. The irises slide to the
# viewer's right inside the eyes (a sidelong glance across the table) and the upper lids come down a little.
#   expr.py <in.png> <out.png>
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates
WARPS = [(320, 500, 15, 12, 14, 0), (585, 490, 15, 12, 14, 0),
         (322, 478, 32, 6, 0, 4), (585, 468, 32, 6, 0, 4)]
a = np.asarray(Image.open(sys.argv[1]).convert("RGB"), np.float32)
H, W = a.shape[:2]
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
dx = np.zeros_like(xx); dy = np.zeros_like(yy)
for cx, cy, sx, sy, mx, my in WARPS:
    g = np.exp(-(((xx - cx) / sx) ** 2 + ((yy - cy) / sy) ** 2) / 2)
    dx += mx * g; dy += my * g
out = np.stack([map_coordinates(a[..., c], [yy - dy, xx - dx], order=3, mode="nearest") for c in range(3)], -1)
Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(sys.argv[2])
