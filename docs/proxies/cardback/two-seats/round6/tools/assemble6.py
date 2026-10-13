# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 6: round 5's half (round-4 figure in round 2's setting), with five fixes laid in as guides
# for the GPU passes.
#   assemble6.py <r2-workdir> <r4-final.png> <cut-mask.png> <r2 char: green|garnet|blue> <r5-hole.png> <outdir> <tag>
# writes <outdir>/a-<tag>.png     the assembled half (1500x1052)
#        <outdir>/figm-<tag>.png  the new figure's silhouette (figure, sleeves, fan and hands)
#        <outdir>/skin-<tag>.png  the hands' skin (the hand pass's paste)
#        <outdir>/arm-<tag>.png   the drawn sleeves (the arm pass's paste)
#        <outdir>/chest-<tag>.png the closed cloak front, less what the fan, hands and sleeves cover (the chest pass's paste)
#        <outdir>/fan-<tag>.png   the fan and the hands (round 2's pixels at 1.5x)
#        <outdir>/gold-<tag>.png  the refilled gold (round 5's hole)
#        <outdir>/lattice-<tag>.jpg  a check: the crossings found (green), interpolated (magenta)
# Fix 5, the gold: round 2's painted lattice is not exactly 96 px (the affine fit gives ~97) and each crossing sits
# a few px off its ideal place, so round 5's whole-period copy drifted. Here every crossing of the diamond lattice
# is located (measured on round 2's final where the gold is clear, interpolated where round 2's figure stood) and
# each hole pixel is copied from the same place in a clear diamond cell, through the cells' bilinear maps, so the
# refilled diamonds meet the measured ones corner to corner. The low-frequency light is the landing place's, as in
# round 5.
# Fix 2, the chest: round 5's closed front (a blurred push-pull fill) gets a guide of vertical folds in the cloak's
# own palette: dark fold lines, a shadow side and a lit side, as the draft's cloth folds are drawn.
# Fix 3: round 2's fan and hands at 1.5x (round 5's 1.2x times 1.25), about the same table point.
# Fix 1, the arms: a sleeve per hand, in the cloak's colour, from the cloak's side to the wrist, a darker cuff,
#   a bold dark outline and two elbow creases.
# Fix 4: the figure is laid on the gold with a 3 px feather (round 5: 0.8 px).
import sys
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import (gaussian_filter, map_coordinates, binary_dilation, binary_erosion, binary_closing,
                           binary_opening, binary_fill_holes, label, maximum_filter)

r2, r4, cutp, ch, holep, od, tag = sys.argv[1:8]
HW, HH, TABLE = 1500, 1052, 944
yy, xx = np.mgrid[0:HH, 0:HW].astype(np.float32)
iy, ix = yy.astype(int), xx.astype(int)
rgb = lambda p: np.asarray(Image.open(p).convert("RGB"), np.float32)
final2 = rgb(f"{r2}/out/{ch}-punched.png")[:HH]
hole = np.zeros((HH, HW), bool); _h = np.asarray(Image.open(holep).convert("L")) > 127; hole[:_h.shape[0]] = _h[:HH]

# ---- 1. the gold (fix 5)
d = final2[..., 2] - final2[..., 0]                      # the punches are grey-blue on the gold: B-R peaks
s = gaussian_filter(d, 2.5) - gaussian_filter(d, 14)
FX0, FX1, FY0, FY1 = 222, 1278, 210, 936
clear = ~binary_dilation(hole, iterations=10) & (xx > FX0) & (xx < FX1) & (yy > FY0) & (yy < FY1)
# a first lattice: peaks, indexed on a 48.5 px half-period grid, an affine fit, then each crossing searched for
# round its predicted place (+-14 px) and kept if its peak is clear
pk = (s == maximum_filter(s, 25)) & (s > 25) & clear
py, px = np.nonzero(pk)
pts = np.stack([px, py], 1).astype(np.float64)
best = None
for P in np.arange(94, 100, 0.25):
    hP = P / 2
    for ox in np.arange(0, hP, 1.0):
        for oy in np.arange(0, hP, 1.0):
            n = (pts[:, 0] - ox) / hP; m = (pts[:, 1] - oy) / hP
            rn, rm = np.round(n), np.round(m)
            par = ((rn + rm) % 2 == 0).mean()
            sc = np.mean(np.minimum(np.hypot(n - rn, m - rm) * hP, 12)) + 12 * (1 - max(par, 1 - par))
            if best is None or sc < best[0]:
                best = (sc, P, ox, oy, par)
_, P, ox, oy, par = best
hP = P / 2
n0 = np.round((pts[:, 0] - ox) / hP); m0 = np.round((pts[:, 1] - oy) / hP)
par_bit = int(np.round(np.mean((n0 + m0) % 2)))           # the parity the crossings take
F = np.stack([np.ones_like(n0), n0, m0], 1)
A = np.linalg.lstsq(F, pts, rcond=None)[0]               # (n, m) -> (x, y)
# the crossings as a (p, q) quad mesh: n = p + q, m = p - q + par_bit
PQ = 40
pp, qq = np.mgrid[-PQ:PQ, -PQ:PQ]
nn, mm = pp + qq, pp - qq + par_bit
X = A[0, 0] + A[1, 0] * nn + A[2, 0] * mm
Y = A[0, 1] + A[1, 1] * nn + A[2, 1] * mm
meas = np.zeros(X.shape, bool)
MX, MY = X.copy(), Y.copy()
for i in range(X.shape[0]):
    for j in range(X.shape[1]):
        x0, y0 = X[i, j], Y[i, j]
        if not (FX0 + 14 < x0 < FX1 - 14 and FY0 + 14 < y0 < FY1 - 14):
            continue
        xa, xb, ya, yb = int(x0 - 14), int(x0 + 15), int(y0 - 14), int(y0 + 15)
        if not clear[ya:yb, xa:xb].all():
            continue
        w = s[ya:yb, xa:xb]
        k = np.unravel_index(np.argmax(w), w.shape)
        if w[k] > 18:
            MX[i, j], MY[i, j] = xa + k[1], ya + k[0]; meas[i, j] = True
# the unmeasured crossings: the affine place plus the measured ones' offsets, gaussian-weighted (sigma 1.6 cells)
rx, ry = (MX - X) * meas, (MY - Y) * meas
wsum = gaussian_filter(meas.astype(np.float64), 1.6, mode="constant")
ix_ = gaussian_filter(rx, 1.6, mode="constant") / np.maximum(wsum, 1e-6)
iy_ = gaussian_filter(ry, 1.6, mode="constant") / np.maximum(wsum, 1e-6)
ix_[wsum < 1e-3] = 0; iy_[wsum < 1e-3] = 0
MX = np.where(meas, MX, X + ix_); MY = np.where(meas, MY, Y + iy_)
print(tag, f"lattice: period {P:.2f} px (fit {2*np.hypot(*A[1]):.2f}), {meas.sum()} crossings measured")
def fwd(p, q):
    """continuous (p, q) -> (x, y) through the quad mesh (bilinear in each cell)"""
    i = p + PQ; j = q + PQ
    return (map_coordinates(MX, [i, j], order=1, mode="nearest"), map_coordinates(MY, [i, j], order=1, mode="nearest"))
# the inverse at every pixel: the affine inverse, then Newton steps on the mesh map
Ainv = np.linalg.inv(np.array([[A[1, 0], A[2, 0]], [A[1, 1], A[2, 1]]]))
def inv(x, y):
    dx, dy = x - A[0, 0], y - A[0, 1]
    n = Ainv[0, 0] * dx + Ainv[0, 1] * dy; m = Ainv[1, 0] * dx + Ainv[1, 1] * dy
    p, q = (n + m - par_bit) / 2, (n - m + par_bit) / 2
    for _ in range(6):
        fx, fy = fwd(p, q); e = 1e-3
        fxp, fyp = fwd(p + e, q); fxq, fyq = fwd(p, q + e)
        a, b, c, dd = (fxp - fx) / e, (fxq - fx) / e, (fyp - fy) / e, (fyq - fy) / e
        det = a * dd - b * c; det = np.where(np.abs(det) < 1e-6, 1e-6, det)
        rxe, rye = x - fx, y - fy
        p = p + (dd * rxe - b * rye) / det; q = q + (-c * rxe + a * rye) / det
    return p, q
hy, hx = np.nonzero(hole)
hp_, hq_ = inv(hx.astype(np.float64), hy.astype(np.float64))
# a source cell for each hole pixel: whole cells away, upward first (one period up is dp -1, dq +1), then outward
side = np.where(hx < 750, -1, 1)
cands = []
for j in range(1, 9):
    cands.append((-j, j, 0))
for k in range(1, 6):
    for j in range(0, 9):
        cands.append((-j, j, k))
sx = np.zeros(len(hx)); sy = np.zeros(len(hx)); done = np.zeros(len(hx), bool)
for dpj, dqj, k in cands:
    dp = dpj + side * k; dq = dqj + side * k             # k periods sideways is dn = 2k: dp = dq = k
    fx, fy = fwd(hp_ + dp, hq_ + dq)
    ok = (fx > FX0) & (fx < FX1 - 1) & (fy > FY0) & (fy < FY1 - 1)
    fxi, fyi = np.clip(fx, 0, HW - 1).astype(int), np.clip(fy, 0, HH - 1).astype(int)
    ok &= ~binary_dilation(hole, iterations=3)[fyi, fxi]
    take = ok & ~done
    sx[take], sy[take] = fx[take], fy[take]; done |= take
print(tag, f"hole pixels sourced: {done.mean():.2%}")
g = np.stack([map_coordinates(final2[..., c], [sy, sx], order=1, mode="nearest") for c in range(3)], -1)
w = (~hole).astype(np.float32)
num = sum(gaussian_filter(final2 * w[..., None], (sg, sg, 0)) for sg in (30, 90, 200))
den = sum(gaussian_filter(w, sg) for sg in (30, 90, 200))
lo = num / np.maximum(den, 1e-6)[..., None]
lo_src = np.stack([map_coordinates(lo[..., c], [sy, sx], order=1) for c in range(3)], -1)
ground = final2.copy()
ground[hy, hx] = np.clip(g - lo_src + lo[hy, hx], 0, 255)
Image.fromarray((hole * 255).astype(np.uint8)).save(f"{od}/gold-{tag}.png")
# the check
v = ground.copy()
for i in range(MX.shape[0]):
    for j in range(MX.shape[1]):
        x0, y0 = int(round(MX[i, j])), int(round(MY[i, j]))
        if 4 <= x0 < HW - 4 and 4 <= y0 < HH - 4:
            v[y0 - 2:y0 + 3, x0 - 2:x0 + 3] = (0, 220, 0) if meas[i, j] else (255, 0, 255)
Image.fromarray(v.astype(np.uint8)[150:1000, 150:1350]).save(f"{od}/lattice-{tag}.jpg", quality=88)

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
# fix 2: the closed front's folds as a guide. Round 5 laid a blurred profile down the hole; here the front gets
# drawn vertical folds in the cloak's palette: a dark fold line, a shadow on one side and light on the other,
# each fold gently wavering, fading in below the hole's top as round 5's did.
top = np.argmax(remove, 0).astype(np.float32)
fade = np.clip((yy - top[None, :]) / 60, 0, 1)
fold = np.zeros((HH, HW), np.float32)
for k, x0 in enumerate([748, 690, 806, 628, 868, 566, 930, 506, 990]):
    xc = x0 + 5 * np.sin(yy / 85 + k * 1.7) + (x0 - 748) * 0.10 * (yy - 600) / 300   # folds splay a little
    dx_ = xx - xc
    sgn = -1 if x0 >= 748 else 1                                                          # shadow toward the centre
    fold -= 0.42 * np.exp(-(dx_ / 2.6) ** 2)                                              # the fold line
    fold -= 0.16 * np.exp(-np.clip(sgn * dx_, 0, None) / 14) * (sgn * dx_ > 0)            # its shadow side
    fold += 0.10 * np.exp(-((dx_ + sgn * 12) / 7) ** 2)                                   # its lit edge
fill = lowf * (1 + fold * fade)[..., None]
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
fl = np.clip(warp(remove.astype(np.float32), S, OA, NA), 0, 1)
# the cloak's colour: the median of the figure's cloth below the face
body = (figm > 0.9) & (yy > 600) & (yy < 900) & (fl < 0.1)
cloak = np.median(figs[body], 0)

# ---- 3. round 2's hands and fan at 1.5x (fix 3: round 5's 1.2 x 1.25)
HS, HOA, HNA = 1.5, (765.0, 941.0), (750.0, 936.0)
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
# the cards alone (round 2's fan mask holds the hands too): its dark backs, grown over their gilt edges
cards = binary_dilation((fanm > 0.5) & ~sk & (V2 < 0.45), iterations=4) & (fanm > 0.5)
fanw = np.clip(warp(cards.astype(np.float32), HS, HOA, HNA), 0, 1) > 0.5

# ---- 4. the sleeves (fix 1): from the cloak's side, forward to each wrist
lab_, k_ = label(skn)
sizes = np.bincount(lab_.ravel()); sizes[0] = 0
comps = [i for i in np.argsort(sizes)[::-1][:2] if sizes[i] > 400]
arm = np.zeros((HH, HW), np.float32); cuff = np.zeros((HH, HW), np.float32); line = np.zeros((HH, HW), np.float32)
arm_sh = np.zeros((HH, HW), np.float32)
crease = np.zeros((HH, HW), np.float32)
SSA = 4
for ci in comps:
    cy_, cx_ = np.nonzero(lab_ == ci)
    left = cx_.mean() < 750
    sc = (-cx_ if left else cx_) + 0.8 * cy_
    sel = sc >= np.percentile(sc, 93)
    W = np.array([cx_[sel].mean(), cy_[sel].mean()])            # the wrist: the hand's outer lower end
    sg = -1 if left else 1
    E = np.array([W[0] + sg * 125, W[1] - 95])                   # where the sleeve comes from under the cloak
    C = np.array([W[0] + sg * 80, W[1] - 12])                    # the forearm comes forward and in to the wrist
    t = np.linspace(0, 1, 60)[:, None]
    pts_ = (1 - t) ** 2 * E + 2 * (1 - t) * t * C + t ** 2 * W
    tan = np.gradient(pts_, axis=0); tan /= np.linalg.norm(tan, axis=1, keepdims=True)
    nrm = np.stack([-tan[:, 1], tan[:, 0]], 1)
    wid = (46 - 10 * t[:, 0])[:, None]                            # half-width: 46 where it emerges, 36 at the cuff
    pe = pts_ - tan * 30                                          # carried 30 px further in under the cloak
    pts_ = np.concatenate([pe[:1] - tan[:1] * 0, pts_])
    tan = np.concatenate([tan[:1], tan]); nrm = np.concatenate([nrm[:1], nrm]); wid = np.concatenate([wid[:1], wid])
    t = np.concatenate([t[:1], t])
    poly = np.concatenate([pts_ + nrm * wid, (pts_ - nrm * wid)[::-1]])
    im = Image.new("L", (HW * SSA, HH * SSA), 0); dr = ImageDraw.Draw(im)
    dr.polygon([tuple(v * SSA) for v in poly], fill=255)
    a_ = np.asarray(im.resize((HW, HH), Image.LANCZOS), np.float32) / 255
    arm = np.maximum(arm, a_)
    # the outline down the two long sides only (the sleeve's upper end goes in under the cloak, in shadow)
    im = Image.new("L", (HW * SSA, HH * SSA), 0); dr = ImageDraw.Draw(im)
    for sgn_ in (1, -1):
        dr.line([tuple((v * SSA)) for v in (pts_ + sgn_ * nrm * wid)], fill=255, width=4 * SSA)
    line = np.maximum(line, np.asarray(im.resize((HW, HH), Image.LANCZOS), np.float32) / 255)
    # the shadow where it comes out of the cloak: a gradient over the first 45 px
    dist = np.hypot(xx - E[0], yy - E[1])
    cuff_sh = np.clip(1 - dist / 70, 0, 1) * a_
    arm_sh = np.maximum(arm_sh, cuff_sh)
    # the cuff: the last 16% of the sleeve, a little wider
    k0 = int(0.84 * len(t))
    cp = np.concatenate([pts_[k0:] + nrm[k0:] * (wid[k0:] + 3), (pts_[k0:] - nrm[k0:] * (wid[k0:] + 3))[::-1]])
    im = Image.new("L", (HW * SSA, HH * SSA), 0); dr = ImageDraw.Draw(im); dr.polygon([tuple(v * SSA) for v in cp], fill=255)
    cuff = np.maximum(cuff, np.asarray(im.resize((HW, HH), Image.LANCZOS), np.float32) / 255)
    # two creases across the bend
    im = Image.new("L", (HW * SSA, HH * SSA), 0); dr = ImageDraw.Draw(im)
    for tt, off in ((0.40, 0.3), (0.62, -0.2)):
        kk = int(tt * len(t)); c0 = pts_[kk]; n_ = nrm[kk]; ta = tan[kk]
        a0 = c0 + n_ * wid[kk] * 0.8 - ta * 8; a1 = c0 + ta * 6 + n_ * off * 10; a2 = c0 - n_ * wid[kk] * 0.8 - ta * 5
        dr.line([tuple(a0 * SSA), tuple(a1 * SSA), tuple(a2 * SSA)], fill=255, width=3 * SSA)
    crease = np.maximum(crease, np.asarray(im.resize((HW, HH), Image.LANCZOS), np.float32) / 255 * a_)
line = gaussian_filter(line, 0.7)
# the cuff's own edge line
cl = np.clip(binary_dilation(cuff > 0.5, iterations=1).astype(np.float32) - binary_erosion(cuff > 0.5, iterations=1), 0, 1)
line = np.maximum(line, gaussian_filter(cl, 0.7) * 0.8)
# the sleeve, lit from the lamp below: the cloak's colour a little in shadow, its outer edge darker
grad = np.clip((yy - 700) / 240, 0, 1)
sleeve = cloak[None, None] * (0.80 + 0.14 * grad)[..., None]
sleeve = sleeve * (1 - 0.34 * cuff)[..., None]
sleeve = sleeve * (1 - 0.5 * arm_sh)[..., None]                 # the cuff: a darker band of the same cloth
sleeve = sleeve * (1 - 0.45 * crease)[..., None]
sleeve = sleeve * (1 - 0.62 * line)[..., None]                 # the woodcut outline
amask = np.clip(arm, 0, 1) * (figm > 0.5)   # inside the cloak's silhouette only
amask[TABLE - 1:] = 0

# ---- 5. lay it together: ground, figure (3 px feather, fix 4), sleeves, the opening's shadow, hands and fan
fa = gaussian_filter(figm, 1.4)[..., None]
h = ground * (1 - fa) + figs * fa
if tag == "green":
    # the draft's dark sleeve cuff beside her left hand (a dark blob in round 5) goes: the sleeve covers what is
    # left of it, and any of it outside the sleeve takes the cloak's colour
    hsv_ = np.asarray(Image.fromarray(np.clip(h, 0, 255).astype(np.uint8)).convert("HSV"), np.float32) / 255
    blob = (xx > 860) & (xx < 1000) & (yy > 780) & (yy < 940) & (hsv_[..., 2] < 0.30) & (figm > 0.5)
    blob = gaussian_filter(binary_dilation(binary_closing(blob, iterations=3), iterations=3).astype(np.float32), 2)[..., None]
    h = h * (1 - blob) + (cloak * 0.82)[None, None] * blob
am = amask[..., None]
h = h * (1 - am) + sleeve * am
sh = gaussian_filter(binary_dilation(skn, iterations=9).astype(np.float32), 6) * (1 - ha) * (figm > 0.5) * (1 - 0.6 * amask)
h = h * (1 - 0.35 * sh)[..., None]
h = h * (1 - ha[..., None]) + hp * ha[..., None]
if tag == "blue":
    # round 2's ochre cuff under his left hand: the sleeve's dark blue (round 5's --cuff, at the new scale)
    a = np.asarray(Image.fromarray(np.clip(h, 0, 255).astype(np.uint8)).convert("HSV"), np.float32) / 255
    box = np.zeros((HH, HW), bool); box[820:944, 870:1030] = True
    oc = box & (a[..., 0] * 360 > 18) & (a[..., 0] * 360 < 56) & (a[..., 1] > 0.30) & (a[..., 2] > 0.30) & ~fanw & ~skn
    oc = gaussian_filter(binary_dilation(oc, iterations=1).astype(np.float32), 1.0)[..., None]
    h = h * (1 - oc) + (cloak * 0.62)[None, None] * oc
    amask = np.maximum(amask, gaussian_filter(oc[..., 0], 2) * 1.5).clip(0, 1)

Image.fromarray(np.clip(h, 0, 255).astype(np.uint8)).save(f"{od}/a-{tag}.png")
# round 5's fan and hands (1.2x), and the green blob / blue cuff, for the final's change mask
ha12 = np.clip(warp(ho, 1.2, HOA, HNA), 0, 1); ha12[TABLE - 1:] = 0
extra = np.maximum(ha12, blob[..., 0] if tag == "green" else 0)
if tag == "blue":
    extra = np.maximum(extra, oc[..., 0])
Image.fromarray((extra * 255).clip(0, 255).astype(np.uint8)).save(f"{od}/old-{tag}.png")
full = np.maximum(np.maximum(figm, ha), amask)
Image.fromarray((full * 255).astype(np.uint8)).save(f"{od}/figm-{tag}.png")
Image.fromarray((skn * 255).astype(np.uint8)).save(f"{od}/skin-{tag}.png")
Image.fromarray((amask * 255).clip(0, 255).astype(np.uint8)).save(f"{od}/arm-{tag}.png")
Image.fromarray((ha * 255).clip(0, 255).astype(np.uint8)).save(f"{od}/fan-{tag}.png")
chest = fl * (1 - ha) * (1 - amask)
Image.fromarray((chest * 255).clip(0, 255).astype(np.uint8)).save(f"{od}/chest-{tag}.png")
print(tag, "cloak", cloak.round(), "sleeves", len(comps))
