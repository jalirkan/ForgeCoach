# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 6: the last step. Round 5's final, with the five fixes laid in only where they act.
#   final6.py <r5-final.png> <half.png> <tag> <comp-dir> <out.png>
# The change mask is the union of: the sleeves (grown 8 px), the cloak front (6 px), round 6's and round 5's fan
# and hands (6 px), the green blob and the blue cuff, the outline band (10 px out, 8 px in) and the refilled gold
# (round 5's hole) outside the figure's interior; feathered 3 px, and zero on each face (an ellipse round it) and
# on every row from the moulding's top (y 944) down. Inside it, the new half (chroma capped as compose.py does);
# outside it, round 5's final byte for byte. Both seats: the top half turned 180 degrees, symmetry asserted.
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, binary_dilation, binary_erosion
r5p, halfp, tag, cd, out = sys.argv[1:6]
SEAM = 1050
r5 = np.asarray(Image.open(r5p).convert("RGB"), np.float32)
new = np.asarray(Image.open(halfp).convert("RGB"), np.float32)[:SEAM]
CMAX = 140.0
mx, mn = new.max(-1, keepdims=True), new.min(-1, keepdims=True); ch = mx - mn
target = np.where(ch > CMAX, CMAX + (ch - CMAX) * 0.35, ch)
grey = new.mean(-1, keepdims=True)
new = grey + (new - grey) * np.where(ch > 0, target / np.maximum(ch, 1e-6), 1.0)
L = lambda n: (np.asarray(Image.open(f"{cd}/{n}-{tag}.png").convert("L"), np.float32) / 255)[:SEAM] > 0.3
fig = L("figm"); hole = L("gold")
M = binary_dilation(L("arm"), iterations=8) | binary_dilation(L("chest"), iterations=6) \
    | binary_dilation(L("fan"), iterations=6) | binary_dilation(L("old"), iterations=6) \
    | (binary_dilation(fig, iterations=10) & ~binary_erosion(fig, iterations=8)) \
    | (binary_dilation(hole, iterations=4) & ~binary_erosion(fig, iterations=12))
M = np.maximum(gaussian_filter(M.astype(np.float32), 3), M)
yy, xx = np.mgrid[0:SEAM, 0:1500]
face = ((xx - 750) / 115) ** 2 + ((yy - 405) / 145) ** 2 < 1
M[face] = 0
M[944:] = 0
top = np.round(r5[:SEAM] * (1 - M[..., None]) + new * M[..., None])
full = np.concatenate([top, top[::-1, ::-1]], 0)
assert np.array_equal(full, full[::-1, ::-1]), "not 180-degree symmetric"
im = Image.fromarray(np.clip(full, 0, 255).astype(np.uint8))
im.save(out, dpi=(600, 600))
im.save(out[:-4] + ".jpg", quality=95, dpi=(600, 600), subsampling=0)
a = np.asarray(im, np.float32)
same = (np.abs(a - r5).max(-1) == 0).mean()
lum = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
big = gaussian_filter(lum, 12)
hsv = np.asarray(im.convert("HSV"), np.float32)
sat = float(np.percentile(hsv[..., 1] * (hsv[..., 2] / 255), 99.5))
print(f"{out}: unchanged vs round 5 {same:.1%}; dark 0.5% {np.percentile(big, 0.5):.1f}; sat99.5 {sat:.0f}; symmetric yes")
Image.fromarray((M * 255).astype(np.uint8)).save(f"{cd}/changemask-{tag}.png")
