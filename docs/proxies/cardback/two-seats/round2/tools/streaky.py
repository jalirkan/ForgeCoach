# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 2: the comparison variant on the first drafts' streaky worked-leaf gold.
# The punched lozenge diaper (and the plain bevel to the edge) is replaced by the gold of the first draft
# direction/two-seats-3.png (vertical worked strokes, x 140-470, y 150-760 of that 1632x2220 image, re-tiled
# from random strips), keeping the painting's own light: the texture's fine detail is laid over the half's low-frequency colour,
# so the lamp's glow, the bevel's shading and the mitres survive. The figure, the table, the lamp and the floral
# border band are untouched.
#   streaky.py <half.png> <draft.png> <figure-mask.png> <out.png>
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, binary_dilation

HW, HH = 1500, 1052
half, draft, figm, out = sys.argv[1:5]
h = np.asarray(Image.open(half).convert("RGB"), np.float32)
d = np.asarray(Image.open(draft).convert("RGB"), np.float32)
s = d[150:760, 140:470] * 1.0
# scale the draft's gold to sleeve px (the draft is 1632 wide, the sleeve 1500)
s = np.asarray(Image.fromarray(s.astype(np.uint8)).resize((round(330 * 1500 / 1632), round(610 * 1500 / 1632)), Image.LANCZOS), np.float32)
# tiled without mirror patterns: vertical strips of random width from random places in the swatch, each strip
# stacked from two random runs blended over 80 rows, neighbouring strips blended over 16 columns
rng = np.random.default_rng(11)
SH, SW = s.shape[:2]
acc = np.zeros((HH, HW + 120, 3), np.float32); wsum = np.zeros((HH, HW + 120, 1), np.float32)
x = 0
while x < HW + 60:
    w = int(rng.integers(50, 110)); sx = int(rng.integers(0, SW - w - 1))
    col = np.zeros((HH, w, 3), np.float32); cw = np.zeros((HH, 1, 1), np.float32)
    y = -int(rng.integers(0, 200))
    while y < HH:
        sy = int(rng.integers(0, SH - 480)); n = 480
        seg = s[sy:sy + n, sx:sx + w]
        ramp = np.minimum(np.clip(np.arange(n) / 80, 0, 1), np.clip((n - 1 - np.arange(n)) / 80, 0, 1))[:, None, None]
        y0, y1 = max(y, 0), min(y + n, HH)
        col[y0:y1] += seg[y0 - y:y1 - y] * ramp[y0 - y:y1 - y]; cw[y0:y1] += ramp[y0 - y:y1 - y]
        y += n - 80
    col /= np.maximum(cw, 1e-3)
    hr = np.minimum(np.clip(np.arange(w) / 16, 0, 1), np.clip((w - 1 - np.arange(w)) / 16, 0, 1))[None, :, None] + 1e-3
    acc[:, x:x + w] += col * hr; wsum[:, x:x + w] += hr
    x += w - 16
tex = (acc / np.maximum(wsum, 1e-3))[:, 30:30 + HW]
hf = tex / np.maximum(gaussian_filter(tex, (24, 24, 0)), 1)
hf = 1 + (hf - 1) * 0.8

yy, xx = np.mgrid[0:HH, 0:HW].astype(np.float32)
inset = np.minimum.reduce([xx, yy, HW - 1 - xx, np.full_like(xx, 1e9)])
field = inset > 190
bevel = inset < 112
lf = np.where(field[..., None], gaussian_filter(h, (22, 22, 0)), gaussian_filter(h, (4, 4, 0)))
g = lf * hf
fig = np.asarray(Image.open(figm).convert("L"), np.float32) > 20
G = "/home/justin-a/scenery-packs/two-seats-work/guides/"
tab = np.asarray(Image.open(G + "mask-table.png").convert("L"), np.float32) > 20
lamp = np.asarray(Image.open(G + "mask-lamp.png").convert("L"), np.float32) > 20
keep = binary_dilation(fig | tab | lamp, iterations=1)
m = ((field | bevel) & ~keep).astype(np.float32)
m[(yy > 944) & (xx > 190) & (xx < 1310)] *= 0   # the table and the seam rows stay as painted; the frame beside them does not
m = gaussian_filter(m, 3)[..., None]
o = h * (1 - m) + g * m
Image.fromarray(np.clip(o, 0, 255).astype(np.uint8)).save(out)
print(out)
