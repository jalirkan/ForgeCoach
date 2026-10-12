# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 2: cut any box of the half (1500x1052) at a working size, and paste a repainted box back.
#   region.py cut   <half> x0 y0 x1 y1 W H <out>
#   region.py paste <half> <painted> x0 y0 x1 y1 <out> [--mask m.png] [--feather 16] [--box]
#     the paste is limited to <mask> (a full-half greyscale mask, blurred by --feather) and to a feathered box
import argparse
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
ap = argparse.ArgumentParser(); ap.add_argument("mode"); ap.add_argument("args", nargs="+")
ap.add_argument("--mask"); ap.add_argument("--feather", type=float, default=16)
a = ap.parse_args()
if a.mode == "cut":
    src, x0, y0, x1, y1, W, H, out = a.args
    Image.open(src).convert("RGB").crop(tuple(map(int, (x0, y0, x1, y1)))).resize((int(W), int(H)), Image.LANCZOS).save(out)
else:
    src, painted, x0, y0, x1, y1, out = a.args
    x0, y0, x1, y1 = map(int, (x0, y0, x1, y1))
    base = np.asarray(Image.open(src).convert("RGB"), np.float32).copy()
    p = np.asarray(Image.open(painted).convert("RGB").resize((x1 - x0, y1 - y0), Image.LANCZOS), np.float32)
    H_, W_ = y1 - y0, x1 - x0
    yy, xx = np.mgrid[0:H_, 0:W_].astype(np.float32)
    f = a.feather
    m = np.clip(np.minimum.reduce([xx, yy, W_ - 1 - xx, H_ - 1 - yy]) / f, 0, 1)
    if a.mask:
        mm = np.asarray(Image.open(a.mask).convert("L"), np.float32)[y0:y1, x0:x1] / 255
        m = m * gaussian_filter(mm, f / 3)
    m = m[..., None]
    base[y0:y1, x0:x1] = base[y0:y1, x0:x1] * (1 - m) + p * m
    Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).save(out)
print(a.mode, a.args[-1])
