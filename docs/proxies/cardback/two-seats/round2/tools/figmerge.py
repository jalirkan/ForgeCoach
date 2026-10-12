# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 2: lay a character's figure (from a working half) into round 1's finished half, so the
# gold ground, the floral band, the table and the lamp are round 1's own pixels, untouched.
#   figmerge.py <round1-half.png> <figure-half.png> <mask.png> <out.png> [--feather 10]
import argparse
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
ap = argparse.ArgumentParser(); ap.add_argument("base"); ap.add_argument("fig"); ap.add_argument("mask"); ap.add_argument("out")
ap.add_argument("--feather", type=float, default=10)
a = ap.parse_args()
b = np.asarray(Image.open(a.base).convert("RGB"), np.float32)
f = np.asarray(Image.open(a.fig).convert("RGB"), np.float32)
m = gaussian_filter(np.asarray(Image.open(a.mask).convert("L"), np.float32) / 255, a.feather / 2)[..., None]
Image.fromarray(np.clip(b * (1 - m) + f * m, 0, 255).astype(np.uint8)).save(a.out)
print(a.out)
