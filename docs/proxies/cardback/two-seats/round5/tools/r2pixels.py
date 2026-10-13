# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 5: the last step. Everywhere outside the new figure and the gold that round 2's figure left
# (the hole, the figure's silhouette and its unifying band, grown 14 px and feathered), the final takes round 2's
# own final pixels back, so the floral band, the outer gold edge, the table, the lamp and its glow are round 2's
# pixel for pixel (compose.py's re-sharpening, and round 2's own face-and-hands blend into the moulding, would
# otherwise differ by a few levels). Both seats: the mask is turned with the half, so 180-degree symmetry holds.
#   r2pixels.py <mine.png> <round2-final.png> <hole.png> <figm.png> <out.png> [<mine-unsharpened.png>]
# With the last argument, the figure itself (its silhouette, feathered) comes from the unsharpened compose: the
# round-4 drafts were already sharpened in round 4, and a second unsharp mask hardens their faces.
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import binary_dilation, binary_erosion, gaussian_filter
mine, r2, holep, figp, out = sys.argv[1:6]
a = np.asarray(Image.open(mine).convert("RGB"), np.float32)
b = np.asarray(Image.open(r2).convert("RGB"), np.float32)
H = np.asarray(Image.open(holep).convert("L")) > 127
F = np.asarray(Image.open(figp).convert("L")) > 127
m = binary_dilation(H | F, iterations=14)[:1050]
m[944:] = False                               # the moulding, the table and the lamp: round 2's, always
m = np.maximum(gaussian_filter(m.astype(np.float32), 3), binary_dilation(H | F, iterations=8)[:1050])
m[944:] = 0                                   # a hard edge at the moulding's top, where the figure stops
full = np.concatenate([m, m[::-1, ::-1]], 0)[..., None]
if len(sys.argv) > 6:
    u = np.asarray(Image.open(sys.argv[6]).convert("RGB"), np.float32)
    fz = gaussian_filter(binary_erosion(F, iterations=3)[:1050].astype(np.float32), 2)
    fz = np.concatenate([fz, fz[::-1, ::-1]], 0)[..., None]
    a = a * (1 - fz) + u * fz
o = np.round(b * (1 - full) + a * full)
assert np.array_equal(o, o[::-1, ::-1]), "not 180-degree symmetric"
im = Image.fromarray(o.astype(np.uint8))
im.save(out, dpi=(600, 600))
im.save(out[:-4] + ".jpg", quality=95, dpi=(600, 600), subsampling=0)
same = (np.abs(o - b).max(-1) == 0).mean()
print(out, f"identical to round 2's final: {same:.1%} of pixels")
