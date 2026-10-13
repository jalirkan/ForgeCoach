# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 5: paste the light unifying pass (0.18) back only where it is meant to act: a band along the
# figure's outline (10 px out, 8 px in), so the cut-out sits on the gold, and the code-closed cloak front. The
# face, the hands, the cards and the rest of the round-4 figure keep their own pixels.
#   unipaste.py <half.png> <unified-tile.png> <figm.png> <fill.png> x0 y0 x1 y1 <out.png>
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, binary_dilation, binary_erosion

half, tile, figp, fillp = sys.argv[1:5]; x0, y0, x1, y1 = map(int, sys.argv[5:9]); out = sys.argv[9]
h = np.asarray(Image.open(half).convert("RGB"), np.float32).copy()
fm = np.asarray(Image.open(figp).convert("L")) > 127
fl = np.asarray(Image.open(fillp).convert("L"), np.float32) / 255
band = binary_dilation(fm, iterations=10) & ~binary_erosion(fm, iterations=8)
band[944:] = False
m = np.maximum(gaussian_filter(band.astype(np.float32), 3), gaussian_filter(fl, 3))
m[943:] = 0
p = np.asarray(Image.open(tile).convert("RGB").resize((x1 - x0, y1 - y0), Image.LANCZOS), np.float32)
mm = m[y0:y1, x0:x1, None]
h[y0:y1, x0:x1] = h[y0:y1, x0:x1] * (1 - mm) + p * mm
Image.fromarray(np.clip(h, 0, 255).astype(np.uint8)).save(out)
print(out)
