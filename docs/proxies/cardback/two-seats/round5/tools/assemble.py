# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 5: a round-4 court-card figure, cut out flat as it is, set into round 2's half, holding round
# 2's small fan in round 2's hands.
#   assemble.py <r2-workdir> <r4-final.png> <cut-mask.png> <r2 char: green|garnet|blue> <outdir> <tag>
# writes <outdir>/ground-<tag>.png  round 2's finished half (comp/<c>-fin.png) with its own figure taken out of the
#                                   gold: each hole pixel copied from the same gold a whole number of lattice periods
#                                   (96 px) away, upward first, then outward, never from the border or another hole,
#                                   keeping its fine texture and taking the low-frequency light of where it lands
#        <outdir>/a-<tag>.png       the assembled half
#        <outdir>/figm-<tag>.png    the new figure's silhouette (figure, fan and hands), 0/255
#        <outdir>/skin-<tag>.png    the hands' skin, for the hand pass's paste, 0/255
# The figure: the round-4 top seat scaled 0.9 about its table line (y 950 -> round 2's moulding, y 944). Its wide
# open fan, its clasped hands and the lamp's neck that rose into it are taken out and the cloak closed over the
# chest from its own sides (reflection-tiled cloth, so its folds carry on). Round 2's hands and fan (cards from
# comp/<c>-b-fanmask.png, hands by skin colour) are scaled 1.2 about the table edge and laid on top.
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import (gaussian_filter, map_coordinates, binary_dilation, binary_erosion, binary_closing,
                           binary_opening, binary_fill_holes, label)

r2, r4, cutp, ch, od, tag = sys.argv[1:7]
HW, HH, TABLE = 1500, 1052, 944
yy, xx = np.mgrid[0:HH, 0:HW].astype(np.float32)
iy, ix = yy.astype(int), xx.astype(int)
rgb = lambda p: np.asarray(Image.open(p).convert("RGB"), np.float32)
fin = rgb(f"{r2}/comp/{ch}-fin.png")
final2 = rgb(f"{r2}/out/{ch}-punched.png")[:HH]

# ---- 1. the ground
oldm = (np.asarray(Image.open(f"{r2}/comp/{ch}-figmask.png").convert("L")) > 127) | \
       (np.asarray(Image.open(f"{r2}/guides/mask-fig8.png").convert("L")) > 127)
# the hole: round 2's figure grown 24 px (its painted shadow on the gold goes too), and anything near it that is
# not gold (round 1's red rim along the green and blue outlines)
hsvf = np.asarray(Image.fromarray(fin.astype(np.uint8)).convert("HSV"), np.float32) / 255
goldlike = (hsvf[..., 0] * 360 > 22) & (hsvf[..., 0] * 360 < 60) & (hsvf[..., 1] > 0.25) & (hsvf[..., 2] > 0.38)
near = binary_dilation(oldm, iterations=60)
hole = (binary_dilation(oldm, iterations=24) | binary_dilation(near & ~goldlike & ~binary_dilation(~near, iterations=1), iterations=3)) & (yy < TABLE)
hole &= (xx > 205) & (xx < 1295) & (yy > 195)
P = 96
FX0, FX1, FY0, FY1 = 240, 1260, 205, 940
srcy, srcx = iy.copy(), ix.copy()
filled = ~hole
side = np.where(xx < 750, -1, 1)
cands = [(-j, 0) for j in range(1, 9)] + [(-j, k) for k in range(1, 6) for j in range(0, 9)]
for dj, dk in cands:
    sy_ = iy + dj * P; sx_ = ix + side * dk * P
    ok = (sx_ >= FX0) & (sx_ < FX1) & (sy_ >= FY0) & (sy_ < FY1)
    sxc, syc = np.clip(sx_, 0, HW - 1), np.clip(sy_, 0, HH - 1)
    take = ~filled & ok & ~hole[syc, sxc]
    srcy[take], srcx[take] = syc[take], sxc[take]
    filled |= take
g = fin[srcy, srcx]
w = (~hole).astype(np.float32)
# normalized convolution summed over three scales: the nearest ground dominates where there is any, and the
# estimate has no seam where one scale hands over to the next
num = sum(gaussian_filter(fin * w[..., None], (sg, sg, 0)) for sg in (30, 90, 200))
den = sum(gaussian_filter(w, sg) for sg in (30, 90, 200))
lo = num / np.maximum(den, 1e-6)[..., None]
corr = np.where(hole[..., None], g - lo[srcy, srcx] + lo, fin)
mh = gaussian_filter(hole.astype(np.float32), 5)[..., None]
ground = np.clip(fin * (1 - mh) + corr * mh, 0, 255)
Image.fromarray(ground.astype(np.uint8)).save(f"{od}/ground-{tag}.png")

# ---- 2. the figure, flat, scaled 0.9 about its table line
S, OA, NA = 0.9, (750.0, 950.0), (750.0, 944.0)
d4 = rgb(r4)[:HH]
cut = np.zeros((HH, HW), np.float32); _c = np.asarray(Image.open(cutp).convert("L"), np.float32) / 255; cut[:_c.shape[0]] = _c
# the draft's fan, its clasped hands and the lamp's neck, taken out of the figure
hsv = np.asarray(Image.fromarray(d4.astype(np.uint8)).convert("HSV"), np.float32) / 255
Hd, Sd, Vd = hsv[..., 0] * 360, hsv[..., 1], hsv[..., 2]
# the drafts' fan is a sector: apex (750, 870) just above the hands, radius ~345, +-42 deg (measured on all three)
ang = np.degrees(np.arctan2(xx - 750, 870 - yy)); rad = np.hypot(xx - 750, yy - 870)
fan = (rad < 372) & (np.abs(ang) < 49) & (yy < 880)
hands = (xx > 620) & (xx < 900) & (yy > 790) & (yy < 952)
remove = (fan | hands) & (cut > 0.5)
# draft 2's frame has two thin dark vertical rules (x ~390 and ~1070) that touch the cloak's foot: not figure
rules = ((np.abs(xx - 390) < 16) | (np.abs(xx - 1070) < 16)) & (Vd < 0.32) & ~(((Hd < 20) | (Hd > 330)) & (Sd > 0.45))
# close the cloak over the chest. Its light and colour: a push-pull fill from the cloth round the hole (each level
# a mask-weighted halving, then filled upward). Its folds: the cloth's own fine detail, taken column for column
# from a fixed strip beside the fan (x 440-520 on the left, 980-1060 on the right), reflection-tiled inward, so a
# fold runs straight down through the hole as it does on either side of it.
inside = (cut > 0.5) & ~remove
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
if tag == "garnet":
    # where a rule crosses the cloak's foot the cloth is closed over it (each gap filled from the cloth either
    # side); the rule's bits outside the cloak go with every piece but the largest
    rl = binary_dilation(rules, iterations=2) & (cut > 0.5)
    keep = (cut > 0.5) & ~rl
    lab, k = label(keep)
    if k > 1:
        sz = np.bincount(lab.ravel()); sz[0] = 0
        keep = lab == sz.argmax()
    closed = binary_closing(keep, structure=np.ones((1, 41), bool)) & (cut > 0.5)
    gap = closed & ~keep
    d4 = np.where(gap[..., None], pushpull(d4, keep.astype(np.float32)), d4)
    cut = closed.astype(np.float32)
    remove &= cut > 0.5
    inside = (cut > 0.5) & ~remove
lowf = pushpull(gaussian_filter(d4, (3, 3, 0)), inside.astype(np.float32))
lowf = gaussian_filter(lowf, (6, 6, 0))
hp = gaussian_filter(d4, (2, 2, 0)) - gaussian_filter(d4, (14, 14, 0))
def tri(d, n):
    t = np.mod(d, 2 * n); return np.where(t >= n, 2 * n - 1 - t, t)
xs_l = (520 - tri(np.abs(xx - 520), 80)).astype(int)
xs_r = (980 + tri(np.abs(xx - 980), 80)).astype(int)
xsrc = np.where(xx < 750, xs_l, xs_r)
# the folds as straight vertical ones: the strip's fine detail averaged down its rows (y 600-860, cloth only) is a
# profile across the folds; laid down the hole column for column, so the closed front hangs in straight folds
ins_e = binary_erosion(inside, iterations=6)
band = (yy > 600) & (yy < 860) & ins_e
prof = (hp * band[..., None]).sum(0) / np.maximum(band.sum(0), 1)[:, None]
prof = prof * (band.sum(0) > 20)[:, None]
prof = gaussian_filter(prof, (1.5, 0))
top = np.argmax(remove, 0).astype(np.float32)          # the hole's first row, per column
fade = np.clip((yy - top[None, :]) / 60, 0, 1)
fill = lowf + 1.3 * prof[xsrc] * fade[..., None]
# the two fronts meet a little off centre, with a soft dark fold
fill = fill * (1 - 0.28 * np.exp(-((xx - 748 - 6 * np.sin(yy / 90)) / 4.0) ** 2))[..., None]
sm = np.maximum(gaussian_filter(remove.astype(np.float32), 5) * 2 - 1, 0)
sm = np.clip(sm + remove, 0, 1)
sm = gaussian_filter(np.where(remove, 1.0, gaussian_filter(remove.astype(np.float32), 6) * 1.6).clip(0, 1), 1.5)[..., None]
fig4 = d4 * (1 - sm) + fill * sm

def warp(img, s, oa, na):
    sx = (xx - na[0]) / s + oa[0]; sy = (yy - na[1]) / s + oa[1]
    if img.ndim == 2:
        return map_coordinates(img, [sy, sx], order=1, mode="constant")
    return np.stack([map_coordinates(img[..., c], [sy, sx], order=3, mode="nearest") for c in range(img.shape[2])], -1)

figs = warp(fig4, S, OA, NA)
figm = np.clip(warp(cut, S, OA, NA), 0, 1)
figm[TABLE:] = 0
fa = gaussian_filter(figm, 0.8)[..., None]
h = ground * (1 - fa) + figs * fa

# ---- 3. round 2's hands and fan, scaled 1.2 about the table edge
HS, HOA, HNA = 1.2, (765.0, 941.0), (750.0, 936.0)
fanm = np.asarray(Image.open(f"{r2}/comp/{ch}-b-fanmask.png").convert("L"), np.float32) / 255
hs2 = np.asarray(Image.fromarray(final2.astype(np.uint8)).convert("HSV"), np.float32) / 255
H2, S2, V2 = hs2[..., 0] * 360, hs2[..., 1], hs2[..., 2]
skin = (((H2 < 40) | (H2 > 345)) & (S2 > 0.06) & (S2 < 0.45) & (V2 > 0.45))
bx = np.zeros_like(skin); bx[780:942, 540:990] = True
sk = binary_dilation(binary_fill_holes(binary_closing(binary_opening(skin & bx, iterations=1), iterations=4)), iterations=2)
ho = np.maximum(fanm > 0.5, sk).astype(np.float32)
ho[941:] = 0
hp = warp(final2, HS, HOA, HNA)
ha = np.clip(warp(ho, HS, HOA, HNA), 0, 1)
ha[TABLE - 1:] = 0
ha = gaussian_filter(ha, 0.8)
skn = np.clip(warp(sk.astype(np.float32), HS, HOA, HNA), 0, 1) > 0.5
# where the hands come out of the cloak: a soft shadow of the opening round each hand, on the cloth only
sh = gaussian_filter(binary_dilation(skn, iterations=9).astype(np.float32), 6) * (1 - ha) * (figm > 0.5)
h = h * (1 - 0.45 * sh)[..., None]
h = h * (1 - ha[..., None]) + hp * ha[..., None]

Image.fromarray(np.clip(h, 0, 255).astype(np.uint8)).save(f"{od}/a-{tag}.png")
Image.fromarray((np.maximum(figm, ha) * 255).astype(np.uint8)).save(f"{od}/figm-{tag}.png")
Image.fromarray((skn * 255).astype(np.uint8)).save(f"{od}/skin-{tag}.png")
ys = np.nonzero(figm.max(1) > 0.5)[0]
print(tag, "figure rows", ys.min(), ys.max(), "height", ys.max() - ys.min() + 1, f"= {(ys.max() - ys.min() + 1) / 1050:.0%} of the half")
# the closed cloak front (the code-filled cloth), in the half's coordinates, for the unifying pass's paste
fl = np.clip(warp(remove.astype(np.float32), S, OA, NA), 0, 1) * (1 - ha)
Image.fromarray((fl * 255).astype(np.uint8)).save(f"{od}/fill-{tag}.png")
# the hole in round 2's gold, for the last step (tools/r2pixels.py)
Image.fromarray((hole * 255).astype(np.uint8)).save(f"{od}/hole-{tag}.png")
