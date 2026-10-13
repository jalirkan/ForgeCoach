# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, grounds: the bare punched-gold ground under the final's figure, rebuilt.
# This is round 6's assemble6.py, step 1 ("the gold", fix 5), unchanged in what it computes: round 2's punched half
# with round 2's figure hole refilled cell by cell through the measured diamond lattice. The final's gold field is
# round 6's (100% identical through rounds 7-9 and the final, per their checks), so this is the exact ground the
# final's figure was laid on: away from the figure it matches the final to a mean 0.2 levels (lift.py checks it).
# It also saves the measured lattice (crossing mesh MX/MY, the affine fit A) for ground B's damask.
#   ground6.py <round2-workdir> <char: green|garnet|blue> <round5-hole.png> <outdir> <tag>
import sys
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import (gaussian_filter, map_coordinates, binary_dilation, binary_erosion, binary_closing,
                           binary_opening, binary_fill_holes, label, maximum_filter)

r2, ch, holep, od, tag = sys.argv[1:6]
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
np.save(f"{od}/ground6-{tag}.npy", ground)
np.savez(f"{od}/lattice-{tag}.npz", MX=MX, MY=MY, A=A, par_bit=par_bit, PQ=PQ, P=P)
print(tag, "ground and lattice saved in", od)
