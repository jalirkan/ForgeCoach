# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 6 (fix 4): paste the light unifying pass (0.18) back on a band along the figure's outline
# only (10 px out, 8 px in, feathered 3 px), so the cut-out (already laid with a 3 px feather) sits on the gold
# without a sticker edge. The faces, the hands, the cards and the rest of the figure keep their own pixels.
#   unipaste6.py <half.png> <unified-tile.png> <figm.png> x0 y0 x1 y1 <out.png>
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, binary_dilation, binary_erosion
half, tile, figp = sys.argv[1:4]; x0, y0, x1, y1 = map(int, sys.argv[4:8]); out = sys.argv[8]
h = np.asarray(Image.open(half).convert("RGB"), np.float32).copy()
fm = np.asarray(Image.open(figp).convert("L")) > 127
band = binary_dilation(fm, iterations=10) & ~binary_erosion(fm, iterations=8)
band[944:] = False
m = gaussian_filter(band.astype(np.float32), 3)
m[943:] = 0
p = np.asarray(Image.open(tile).convert("RGB").resize((x1 - x0, y1 - y0), Image.LANCZOS), np.float32)
mm = m[y0:y1, x0:x1, None]
h[y0:y1, x0:x1] = h[y0:y1, x0:x1] * (1 - mm) + p * mm
Image.fromarray(np.clip(h, 0, 255).astype(np.uint8)).save(out)
Image.fromarray((m * 255).astype(np.uint8)).save(out[:-4] + "-band.png")
print(out)
