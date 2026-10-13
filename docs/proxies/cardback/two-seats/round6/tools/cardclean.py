# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 6 (fix 3): the fan's cards stay plain. Round 2's card backs carry a few stray specks (a
# brown dot on the front card, seen at 100%); inside each card back (the dark backs, 5 px in from the gilt edge)
# any pixel that differs from a 21 px median of the back by more than 10 levels takes the median.
#   cardclean.py <half.png> <fan.png> <out.png>
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import median_filter, binary_erosion, binary_dilation
half, fanp, out = sys.argv[1:4]
h = np.asarray(Image.open(half).convert("RGB"), np.float32).copy()
fan = np.asarray(Image.open(fanp).convert("L")) > 127
v = h.max(-1); s = (h.max(-1) - h.min(-1)) / np.maximum(h.max(-1), 1)
back = fan & (v < 120) & (s < 0.35)
back = binary_erosion(back, iterations=5)
med = np.stack([median_filter(h[..., c], size=21) for c in range(3)], -1)
bad = back & (np.abs(h - med).max(-1) > 10)
bad = binary_dilation(bad, iterations=1) & back
h[bad] = med[bad]
Image.fromarray(np.clip(h, 0, 255).astype(np.uint8)).save(out)
print(out, "specks cleaned:", int(bad.sum()), "px")
