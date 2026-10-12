# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 2: paint out a stray stroke (a segment, width px) by diffusing its surroundings into it.
#   patch.py <in> <out> x0 y0 x1 y1 width
import sys
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import uniform_filter
src, out = sys.argv[1:3]; x0, y0, x1, y1, w = map(float, sys.argv[3:8])
a = np.asarray(Image.open(src).convert("RGB"), np.float32).copy()
m = Image.new("L", (a.shape[1], a.shape[0]), 0); ImageDraw.Draw(m).line([(x0, y0), (x1, y1)], fill=255, width=int(w))
m = np.asarray(m) > 0
from scipy.ndimage import binary_dilation
ring = binary_dilation(m, iterations=2) & ~m
a[m] = a[ring].mean(0)
for _ in range(400):
    f = uniform_filter(a, (3, 3, 1)); a[m] = f[m]
Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(out)
print(out)
