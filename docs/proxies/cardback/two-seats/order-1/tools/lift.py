# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, grounds: lift the final's figure (hood, face, cloak, hands, fan) and its table band (wood, lamp,
# props) off the punched-gold ground, as a straight alpha matte, so they can be laid on another ground unrepainted.
#   lift.py <tag> <final.png> <workdir>      (reads <workdir>/ground6-<tag>.npy from ground6.py)
# writes <workdir>/lift-<tag>.npz: C (the final's top half), B (the bare ground under it), P (the premultiplied
#   figure), alpha (the figure's matte, rows above the table), band (x0, x1: the table band's wood columns), and
#   <workdir>/lift-check-<tag>.png (the figure on flat magenta).
# How:
#  1. d = the largest channel difference between the final and the rebuilt bare ground. Away from the figure it is
#     a mean 0.2 levels; the figure differs by tens. d > 12 above the table's moulding (y < 944), opened, the
#     pieces under 400 px dropped, holes filled = the figure's core (the face and the cards' gilt edges are
#     gold-coloured, so the filled silhouette, not d, decides inside).
#  2. The edge (core eroded 2 px to core grown 5 px) is unmixed: F = the figure's colour pushed outward from its
#     eroded core (push-pull fill), alpha = (C - B).(F - B) / |F - B|^2, clipped to [0, 1]. The final was laid
#     with a 3 px feather, so this recovers that feather and takes the gold's share out of every edge pixel.
#     Where |F - B| < 30 (no contrast to unmix), the blurred core stands in.
#  3. The premultiplied figure P = C - (1 - alpha) B (zero where alpha = 0) is saved, and a new ground G goes
#     under as  out = P + (1 - alpha) G, the exact inverse of the original lay (C = alpha F + (1 - alpha) B): no
#     gold fringe survives, and where alpha = 1 the figure's pixels are the final's, untouched.
# Rows 944 to the seam (the moulding, the wood, the lamp and the props) are the final's own pixels between the
# band's end fillets; the border beyond them is not part of the lift.
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import (gaussian_filter, binary_dilation, binary_erosion, binary_opening, binary_fill_holes,
                           label)

tag, finp, wd = sys.argv[1:4]
SEAM, TABLE, HW = 1050, 944, 1500
C = np.asarray(Image.open(finp).convert("RGB"), np.float32)[:SEAM]
B = np.load(f"{wd}/ground6-{tag}.npy")[:SEAM].astype(np.float32)
yy, xx = np.mgrid[0:SEAM, 0:HW]
d = np.abs(C - B).max(-1)
inner = (xx > 200) & (xx < 1300) & (yy > 200)
raw = (d > 12) & (yy < TABLE) & inner
raw = binary_opening(raw, iterations=1)
lab, n = label(raw)
sz = np.bincount(lab.ravel()); sz[0] = 0
core = np.isin(lab, np.nonzero(sz >= 400)[0])
core = binary_fill_holes(core)
# gold that is not the ground: the final's retouching filled the cloak's lifted outline from the pixels beside it,
# and at a few places (the shoulder points) that was the gold, so a few small gold blots differ from the bare ground
# by more than 12 and would ride along as figure. Gold-coloured pixels reachable from outside the figure through
# gold-coloured pixels are ground, not figure (the cards' gilt edges and the faces are enclosed, so they stay).
hsv = np.asarray(Image.fromarray(np.clip(C, 0, 255).astype(np.uint8)).convert("HSV"), np.float32) / 255
Hd, Sd, Vd = hsv[..., 0] * 360, hsv[..., 1], hsv[..., 2]
cosCB = (C * B).sum(-1) / np.maximum(np.linalg.norm(C, axis=-1) * np.linalg.norm(B, axis=-1), 1e-6)
goldlike = (Hd > 28) & (Hd < 62) & (Sd > 0.30) & (Vd > 0.30) & (cosCB > 0.993)   # gold of the ground's own hue
reach, _ = label(goldlike | ~core)
outl = np.unique(reach[~core & (yy < TABLE)]); outl = outl[outl > 0]
blots = core & goldlike & np.isin(reach, outl)
blotlike = binary_dilation(blots, iterations=1) & goldlike
core = binary_fill_holes(binary_opening(core & ~blots, iterations=1))
lab, n = label(core); sz = np.bincount(lab.ravel()); sz[0] = 0; core = lab == sz.argmax()
print(tag, f"gold blots taken back to ground: {blots.sum()} px")
print(tag, f"core pieces kept: {(sz >= 400).sum()}, core px {core.sum()}")

def pushpull(img, m):
    if min(m.shape) < 4:
        tot = (img * m[..., None]).sum((0, 1)) / max(m.sum(), 1e-6)
        return np.broadcast_to(tot, img.shape).copy()
    Hh, Ww = m.shape
    H2, W2 = (Hh + 1) // 2, (Ww + 1) // 2
    pm = np.zeros((H2 * 2, W2 * 2), np.float32); pm[:Hh, :Ww] = m
    pi = np.zeros((H2 * 2, W2 * 2, 3), np.float32); pi[:Hh, :Ww] = img * m[..., None]
    sm_ = pm.reshape(H2, 2, W2, 2).sum((1, 3)); si = pi.reshape(H2, 2, W2, 2, 3).sum((1, 3))
    low = pushpull(si / np.maximum(sm_, 1e-6)[..., None], (sm_ > 0).astype(np.float32))
    up = np.repeat(np.repeat(low, 2, 0), 2, 1)[:Hh, :Ww]
    up = gaussian_filter(up, (1, 1, 0))
    return img * m[..., None] + up * (1 - m[..., None])

inside = binary_erosion(core, iterations=3)
F = pushpull(gaussian_filter(C, (1.2, 1.2, 0)), inside.astype(np.float32))
edge = binary_dilation(core, iterations=5) & ~binary_erosion(core, iterations=2) & (yy < TABLE)
FB = F - B
den = (FB * FB).sum(-1)
a_un = np.clip(((C - B) * FB).sum(-1) / np.maximum(den, 1e-6), 0, 1)
a_bl = np.clip(gaussian_filter(core.astype(np.float32), 1.0), 0, 1)
a_edge = np.where(den > 30 ** 2, a_un, a_bl)
alpha = np.where(binary_erosion(core, iterations=2), 1.0, 0.0).astype(np.float32)
alpha[edge] = a_edge[edge]
alpha[edge & blotlike] = 0
# the hem sits on the moulding: the rows just above it (936-943) keep the figure's columns of row 935, so no ground
# line opens between the cloak and the table
hem = alpha[935] > 0.5
for y in range(936, TABLE):
    alpha[y, hem] = np.maximum(alpha[y, hem], alpha[935, hem])
alpha[yy >= TABLE] = 0
# the band: its wood runs between the end fillets of round 2's floral band; found on row 1000 by walking out
# from x 300 and x 1200 (clear of the lamp and the props) while the row stays darker than 100 (wood ~57, fillet ~180)
row = (0.2126 * C[1000, :, 0] + 0.7152 * C[1000, :, 1] + 0.0722 * C[1000, :, 2])
x0 = 300
while row[x0 - 1] < 100: x0 -= 1
x1 = 1200
while row[x1] < 100: x1 += 1
print(tag, f"band wood columns {x0}..{x1 - 1}; edge px {edge.sum()}, alpha in (0,1): {((alpha > 0) & (alpha < 1)).sum()}")
# check: residual of the lay model outside the figure (should be ~0) and the matte
outside = inner & (yy < TABLE) & ~binary_dilation(core, iterations=6)
print(tag, f"bare ground vs final outside the figure: mean |d| {d[outside].mean():.2f}, p99.9 {np.percentile(d[outside], 99.9):.1f}")
# reconstruction check on the edge: alpha F + (1 - alpha) B vs C
rec = alpha[..., None] * F + (1 - alpha[..., None]) * B
e = np.abs(rec - C).max(-1)[edge & (alpha > 0)]
print(tag, f"edge re-lay error: median {np.median(e):.1f}, p90 {np.percentile(e, 90):.1f}")
P = np.where(alpha[..., None] > 0, C - (1 - alpha[..., None]) * B, 0)
np.savez_compressed(f"{wd}/lift-{tag}.npz", C=C, B=B, P=P, alpha=alpha, band=np.array([x0, x1]))
# a check image: the figure on flat magenta
chk = P + (1 - alpha[..., None]) * np.array([200, 0, 200], np.float32)
chk[yy >= TABLE] = C[yy >= TABLE]
Image.fromarray(np.clip(chk, 0, 255).astype(np.uint8)).save(f"{wd}/lift-check-{tag}.png")
