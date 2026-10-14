# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, order 1, one pass: ONE painted pass of the whole figure -> the full card on Ground A2.
# FINISH: a copy of one-pass/tools/onepass.py that also saves the UNLIFTED top half (<out>-unlifted-top.png) before
# the lift; the card it writes is byte-identical to one-pass/two-seats-garnet-man-ds-40-s9702.png (checked).
#   onepass.py <painted crop.png> <out.png> [--jpg]      (run in two-seats-work/order1/onepass)
# The post-work, and all of it:
#  1. The painted crop (CROP, painted at 1152 px) goes back to its 800 x 800 px on the guide's top half.
#  2. Matte: where the pass was allowed to paint (the figure grown 48 px, work/guide-masks.npz pmask), a pixel is
#     figure by how far the painting is from Ground A2 there, on both lightly smoothed (gaussian 1.5 px): the max
#     channel difference, 0 at 22 levels and below, 1 at 52 and above; forced to 1 deep inside the figure (the
#     warped figure eroded 24 px); the largest connected piece, holes filled; its edge antialiased (gaussian 0.8 px).
#     The domain also takes the 6 px ring round the tankard, which the pass was kept off (step 3).
#     So the ground stays Ground A2's own leaf, and the man's outline is the outline the painting gave him.
#  3. The props that stand above the moulding (the tankard) are the final's painted props, laid back over the robe
#     through round 8's prop mask (dilated 2 px, feathered 1 px), as order 1 did. The band (y >= 944) is Ground A2's,
#     which is the final's band and props.
#  4. The final's black-point lift, once, to the whole card: + 24 (1 - L/56)^2 below L 56 (order-1/tools/lift1.py).
#  5. The bottom seat is the top half turned 180 degrees (asserted).
# NO blur of the painting, NO grain, NO outline work, NO hand repaint.
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, binary_dilation, binary_erosion, binary_fill_holes, label

SEAM, HW, TABLE = 1050, 1500, 944
CROP = (350, 180, 1150, 980)
src, out = sys.argv[1:3]
G = np.asarray(Image.open("work/groundA2-top.png").convert("RGB"), np.float32)
guide = np.asarray(Image.open("work/guide.png").convert("RGB"), np.float32)
U = np.asarray(Image.open("../work/final-unlifted-garnet.png").convert("RGB"), np.float32)[:SEAM]
M = np.load("work/guide-masks.npz"); aw, pmask = M["aw"], M["pmask"]
x0, y0, x1, y1 = CROP
q = np.asarray(Image.open(src).convert("RGB").resize((x1 - x0, y1 - y0), Image.LANCZOS), np.float32)
Pf = guide.copy(); Pf[y0:y1, x0:x1] = q
pm = np.asarray(Image.open("../../round8/final/two-seats-garnet-man-propmask.png").convert("L"))[:SEAM] > 0
yy = np.mgrid[0:SEAM, 0:HW][0]
dom = pmask | (binary_dilation(pm, iterations=6) & (yy < TABLE))   # the pass's region plus the ring it was not let
# paint round the tankard (the guide's own cloak there, through the VAE); without it Ground A2 showed as a gold ring
d = np.abs(gaussian_filter(Pf, (1.5, 1.5, 0)) - gaussian_filter(G, (1.5, 1.5, 0))).max(-1)
m = np.clip((d - 22) / 30, 0, 1) * dom
deep = binary_erosion(aw > 0.5, iterations=24)
m[deep] = 1
core = m > 0.5
lab, n = label(core); sz = np.bincount(lab.ravel()); sz[0] = 0
core = binary_fill_holes(lab == sz.argmax())
m = np.where(core, np.maximum(m, binary_erosion(core, iterations=2)), m * binary_dilation(core, iterations=2))
m = np.clip(gaussian_filter(m, 0.8), 0, 1) * dom
m[TABLE:] = 0
top = G * (1 - m[..., None]) + Pf * m[..., None]
pa = np.clip(gaussian_filter(binary_dilation(pm, iterations=2).astype(np.float32), 1.0) * 1.5, 0, 1)
pa *= binary_dilation(pm, iterations=3); pa[TABLE:] = 0
top = top * (1 - pa[..., None]) + U * pa[..., None]
top = np.round(np.clip(top, 0, 255))
np.save(out.replace(".png", "-unlifted-top.npy"), top.astype(np.uint8)); Image.fromarray(top.astype(np.uint8)).save(out.replace(".png","-unlifted-top.png"))
L = top @ np.array([.2126, .7152, .0722], np.float32)
dd = np.where(L < 56, 24 * (1 - L / 56) ** 2, 0)
top = np.clip(top + dd[..., None], 0, 255).astype(np.uint8)
full = np.concatenate([top, top[::-1, ::-1]], 0)
assert full.shape == (2100, 1500, 3) and np.array_equal(full, full[::-1, ::-1]), "not 180-degree symmetric"
im = Image.fromarray(full)
im.save(out, dpi=(600, 600))
if "--jpg" in sys.argv:
    im.save(out.replace(".png", ".jpg"), quality=95, dpi=(600, 600), subsampling=0)
np.save(out.replace(".png", "-matte.npy"), m.astype(np.float16))
print(out, "matte px", int((m > 0.5).sum()), "of the paint mask", int(pmask.sum()))
