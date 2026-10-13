# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 7: the last step. Round 6's final, with the drawn torso laid in only where it was drawn.
#   final7.py <r6-final.png> <new-half.png> <comp-dir> <tag> <r6-comp-dir> <out.png>
# Inside the drawn region (dm-<tag>, the hem down to the moulding, inside the silhouette, plus the fan and the
# hands) the new half; everywhere else round 6's final byte for byte. Forced to round 6 on each face (round 6's
# ellipse) and on every row from the moulding's top (y 944) down. Both seats: the top half turned 180 degrees,
# symmetry asserted. Prints the identical-pixel shares, region by region, and the darks and saturation checks.
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, binary_dilation
r6p, halfp, cd, tag, r6cd, out = sys.argv[1:7]
SEAM = 1050
r6 = np.asarray(Image.open(r6p).convert("RGB"), np.float32)
new = np.asarray(Image.open(halfp).convert("RGB"), np.float32)[:SEAM]
M = (np.asarray(Image.open(f"{cd}/dm-{tag}.png").convert("L"), np.float32) / 255)[:SEAM]
M = (M > 0.002).astype(np.float32)          # the drawn half already blends its own edges with round 6's pixels
yy, xx = np.mgrid[0:SEAM, 0:1500]
face = ((xx - 750) / 115) ** 2 + ((yy - 405) / 145) ** 2 < 1
M[face] = 0
M[944:] = 0
top = np.round(r6[:SEAM] * (1 - M[..., None]) + new * M[..., None])
full = np.concatenate([top, top[::-1, ::-1]], 0)
assert np.array_equal(full, full[::-1, ::-1]), "not 180-degree symmetric"
im = Image.fromarray(np.clip(full, 0, 255).astype(np.uint8))
im.save(out, dpi=(600, 600))
im.save(out[:-4] + ".jpg", quality=95, dpi=(600, 600), subsampling=0)
a = np.asarray(im, np.float32)
same = np.abs(a - r6).max(-1) == 0
# the regions, on the top half, mirrored for the bottom seat
def both(m):
    m = m[:SEAM]
    return np.concatenate([m, m[::-1, ::-1]], 0)
fig6 = (np.asarray(Image.open(f"{r6cd}/figm-{tag}.png").convert("L"))[:SEAM] > 8)
fig6[944:] = False
inner = np.zeros((SEAM, 1500), bool); inner[210:, 222:1278] = True     # the gold field (round 6's FX/FY box)
drawn = M > 0
reg = {
    "faces (ellipse)": both(face),
    "cloaks' bodies outside the drawn torso (hood, shoulder cape)": both(fig6 & ~drawn & ~face),
    "gold field outside the figure": both(inner & ~binary_dilation(fig6, iterations=3) & (yy < 944)),
    "border and frame (outside the gold field, above the moulding)": both(~inner & (yy < 944)),
    "table band, lamp, glow (y 944 to the turned moulding)": np.concatenate([np.zeros((944, 1500), bool), np.ones((2100 - 2 * 944, 1500), bool), np.zeros((944, 1500), bool)], 0),
}
lum = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
big = gaussian_filter(lum, 12)
hsv = np.asarray(im.convert("HSV"), np.float32)
sat = float(np.percentile(hsv[..., 1] * (hsv[..., 2] / 255), 99.5))
dmin = float(lum[both(drawn)].min())
print(f"{out}: identical to round 6 {same.mean():.2%}; dark 0.5% {np.percentile(big, 0.5):.1f}; drawn-px min lum {dmin:.1f}; sat99.5 {sat:.0f}; symmetric yes")
for k, m in reg.items():
    print(f"   {k}: {same[m].mean():.2%} identical ({m.sum()} px)")
