# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 4 (copied from round 3): crop a region of a half for a high-resolution repaint, and paste the repaint back.
#   patch.py crop  <half.png> x0 y0 x1 y1 <scale> <out.png>     (the crop resized by scale, to multiples of 8)
#   patch.py paste <half.png> x0 y0 x1 y1 <tile.png> <out.png> [feather] [ellipse]
# Coordinates are in the half's own pixels. The paste is feathered so the repaint has no edge.
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
op, src = sys.argv[1], sys.argv[2]
x0, y0, x1, y1 = map(int, sys.argv[3:7])
im = Image.open(src).convert("RGB")
if op == "crop":
    s = float(sys.argv[7]); w, h = x1 - x0, y1 - y0
    W, H = int(round(w * s / 8)) * 8, int(round(h * s / 8)) * 8
    im.crop((x0, y0, x1, y1)).resize((W, H), Image.LANCZOS).save(sys.argv[8]); print(W, H)
else:
    tile = Image.open(sys.argv[7]).convert("RGB").resize((x1 - x0, y1 - y0), Image.LANCZOS)
    fe = float(sys.argv[9]) if len(sys.argv) > 9 else 18
    ell = len(sys.argv) > 10 and sys.argv[10] == "ellipse"
    a = np.asarray(im, np.float32).copy(); t = np.asarray(tile, np.float32)
    h, w = t.shape[:2]
    if ell:
        yy, xx = np.mgrid[0:h, 0:w]; m = ((((xx - w / 2) / (w / 2 - fe)) ** 2 + ((yy - h / 2) / (h / 2 - fe)) ** 2) < 1).astype(np.float32)
    else:
        m = np.zeros((h, w), np.float32); m[int(fe):h - int(fe), int(fe):w - int(fe)] = 1
    m = gaussian_filter(m, fe / 2)[..., None]
    a[y0:y1, x0:x1] = a[y0:y1, x0:x1] * (1 - m) + t * m
    Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(sys.argv[8])
