# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 7: the torso drawn in code, in the drafts' flat court-card line style, on round 6's half.
#   draw7.py <r6-final.png> <r6-comp-dir> <tag: green|garnet|blue> <out-dir> [--hand-scale s] [--debug]
# Below the shoulder-cape's hem (an arc under the chin, from one side of the silhouette to the other) everything
# is drawn new, in flat fills with bold dark lines:
#   - the robe's front: two flat tones of the cloak's colour, bold vertical fold lines splaying from the hem down,
#     a flat shadow strip beside each fold and under the hem (fix 4);
#   - the arms: one shape per side, shoulder to wrist, its outer edge the silhouette itself, its inner edge the
#     robe's; the cloak's flat fill, a second flat tone down the inner side, a bold outline, an elbow fold and a
#     darker cuff at the wrist (fix 3);
#   - the fan: six plain dark cards with a gilt edge, centred on the chest, pivoting about one point between the
#     hands, a +-22.5 degree spread (fix 2);
#   - the hands: both at the fan's foot, meeting at the centre, each a simple outlined shape (the back of the
#     hand, a thumb, three lines for the fingers), one flat skin tone and one flat shade (fix 1).
# Everything above the hem, and everything outside the silhouette, is round 6's pixels. The face's ellipse (as
# final6.py drew it) lies above the hem everywhere.
# Writes <out>/d-<tag>.png (the half) and <out>/dm-<tag>.png (where it is new), plus masks for the paste steps:
#   <out>/m-<part>-<tag>.png for part in front, arm, fan, hand.
import sys
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter, distance_transform_edt, binary_closing, binary_opening, label

r6p, cd, tag, od = sys.argv[1:5]
HSCALE = float(sys.argv[sys.argv.index("--hand-scale") + 1]) if "--hand-scale" in sys.argv else 1.0
HW, HH, TABLE, SEAM = 1500, 1052, 944, 1050
CX = 750.0
SS = 4
yy, xx = np.mgrid[0:HH, 0:HW].astype(np.float32)
r6 = np.asarray(Image.open(r6p).convert("RGB"), np.float32)
half = np.zeros((HH, HW, 3), np.float32); half[:SEAM] = r6[:SEAM]; half[SEAM:] = r6[SEAM:HH]
L = lambda n: np.asarray(Image.open(f"{cd}/{n}-{tag}.png").convert("L"), np.float32)[:HH] / 255
figm = L("figm") > 0.5
figm[TABLE:] = False
r6arm = L("arm") > 0.3

# ---- the palette (measured on round 6's final: the draft's cloth, the face, round 2's cards)
PAL = {
    #          front base        front shade      arm base          skin
    "green":  ((14, 76, 67),     (8, 54, 48),     (18, 104, 92),    (195, 160, 136)),
    "garnet": ((84, 28, 24),     (60, 21, 18),    (112, 38, 31),    (180, 133, 72)),
    "blue":   ((29, 46, 64),     (22, 34, 49),    (42, 65, 92),     (204, 163, 137)),
}[tag]
FRONT, SHADE, ARM, FACE = (np.array(c, np.float32) for c in PAL)
SKIN = 0.5 * FACE + 0.5 * np.array([234, 200, 170], np.float32)   # the drafts' hands: a light flat peach
SKIN_SH = SKIN * np.array([0.86, 0.80, 0.78])
LINE = np.maximum(SHADE * 0.45 + np.array([18, 15, 15]), 22)      # the bold line: near-black, the cloak's hue
HLINE = np.array([88, 52, 40], np.float32)                         # the hands' line: a dark warm brown
CARD = np.array([76, 75, 81], np.float32)                          # round 2's card back
GILT = np.array([226, 180, 118], np.float32)                       # its gilt edge
CEDGE = np.array([40, 36, 38], np.float32)

def canvas():
    im = Image.new("L", (HW * SS, HH * SS), 0)
    return im, ImageDraw.Draw(im)
def done(im):
    return np.asarray(im.resize((HW, HH), Image.LANCZOS), np.float32) / 255
def P(pts):
    return [(float(x) * SS, float(y) * SS) for x, y in pts]
def bez(*c, n=40):
    """a cubic (or quadratic) Bezier through control points, as a point list"""
    t = np.linspace(0, 1, n)[:, None]
    c = [np.array(p, np.float64) for p in c]
    if len(c) == 3:
        return list((1 - t) ** 2 * c[0] + 2 * (1 - t) * t * c[1] + t ** 2 * c[2])
    return list((1 - t) ** 3 * c[0] + 3 * (1 - t) ** 2 * t * c[1] + 3 * (1 - t) * t ** 2 * c[2] + t ** 3 * c[3])
def stroke(pts, w):
    im, dr = canvas()
    pts = P(pts)
    dr.line(pts, fill=255, width=int(round(w * SS)), joint="curve")
    r = w * SS / 2
    for x, y in (pts[0], pts[-1]):
        dr.ellipse((x - r, y - r, x + r, y + r), fill=255)
    return done(im)
def poly(pts):
    im, dr = canvas(); dr.polygon(P(pts), fill=255); return done(im)
def inner_stroke(m, w, up=3):
    """a line of width w inside the shape m (a float mask), along its whole boundary; measured at 3x, so it is
    antialiased rather than stepped"""
    from scipy.ndimage import zoom
    mu = zoom(m, up, order=1)
    d = distance_transform_edt(mu > 0.5) / up
    a = np.clip(d * up, 0, 1) * np.clip(w + 0.5 - d, 0, 1)
    return a.reshape(m.shape[0], up, m.shape[1], up).mean((1, 3))
def lay(img, col, a):
    a = np.clip(a, 0, 1)[..., None]
    return img * (1 - a) + np.asarray(col, np.float32) * a

# ---- the silhouette's edges, row by row (smoothed)
rows = np.arange(HH)
Ledge = np.full(HH, np.nan); Redge = np.full(HH, np.nan)
for y in range(400, TABLE):
    xs = np.nonzero(figm[y])[0]
    if len(xs):
        Ledge[y], Redge[y] = xs.min(), xs.max()
# below the hem the silhouette is redrawn smooth (a gaussian along the rows, sigma 7): round 6's cut-out edge has
# notches (the garnet man's left side), and the arm's bold outline would trace them
from scipy.ndimage import gaussian_filter1d
from scipy.ndimage import maximum_filter1d
def smooth_edge(e, sg):
    """the outer envelope: a running max over +-7 rows (so a notch is bridged, not traced), then smoothed"""
    e = e.copy(); ok = ~np.isnan(e)
    e[~ok] = np.interp(rows[~ok], rows[ok], e[ok])
    o = sg * (e - CX)
    o = maximum_filter1d(o, 15, mode="nearest")
    o = gaussian_filter1d(o, 6, mode="nearest")
    return CX + sg * o
Lsm, Rsm = smooth_edge(Ledge, -1) - 0.5, smooth_edge(Redge, 1) + 0.5
figS = np.clip(xx - Lsm[:, None] + 0.5, 0, 1) * np.clip(Rsm[:, None] - xx + 0.5, 0, 1)
figS[TABLE:] = 0; figS[:400] = 0
def edge(side, y):
    y = int(np.clip(y, 400, TABLE - 1))
    return float((Lsm if side < 0 else Rsm)[y])

# ---- the hem: an arc under the chin (round 6's chest sector, lowered 14 px so it clears the face's ellipse)
CX, CY, RAD = 750.0, 872.0, 335.0
dx = np.clip(np.abs(xx - CX), 0, RAD - 1e-3)
def hem(x):
    x = np.asarray(x, np.float64)
    a = CY - np.sqrt(np.clip(RAD ** 2 - (x - CX) ** 2, 0, None))
    e = 405 + 145 * np.sqrt(np.clip(1 - ((x - 750) / 115) ** 2, 0, None)) + 3
    e = np.where(np.abs(x - 750) < 115, e, 0)
    return (a + e) / 2 + np.sqrt(((a - e) / 2) ** 2 + 6.0 ** 2)   # a smooth max: no kink where they meet
yarc = hem(xx)
belowf = np.clip(yy - yarc + 0.5, 0, 1) * figS                # the new region, soft at the silhouette
below = belowf > 0.5
face = ((xx - 750) / 115) ** 2 + ((yy - 405) / 145) ** 2 < 1
assert not (below & face).any(), "the hem cuts the face's ellipse"
def arc_y(x):
    return float(hem(x))

# ---- the arms: one shape per side, shoulder to wrist. Each starts at the hem where it meets the silhouette (its
# outer line is the silhouette's there), runs down inside the cape (which flares away from it below) to the elbow,
# and bends in along the forearm to a cuff at the wrist; below the forearm, the robe again.
WX, WY = 100.0, 874.0             # each wrist: 100 px either side of the centre line, at y 874
CUFF = 26.0                        # the cuff's length along the forearm
arms, cuffs, armsh, armln = [], [], [], []
for sg in (-1, 1):
    X = lambda d: CX + sg * d                                    # d: the distance out from the centre line
    dsil = lambda y: abs(edge(sg, y) - CX)
    y_h = next(y for y in range(560, 800) if arc_y(edge(sg, y)) <= y)   # where the hem meets the silhouette
    def d_out(y):
        t = np.clip((y - y_h) / (860 - y_h), 0, 1) ** 0.8
        return dsil(y) + 2 - 36 * t                              # on the silhouette at the hem, then away
    wx, wy = X(WX), WY
    dI = 150.0                                                   # the upper arm's inner side
    crook = (X(dI + 4), 830.0)                                   # the inside of the elbow
    dE = d_out(860)
    inner = bez((X(dI), arc_y(X(dI)) - 30), (X(dI - 4), 700), (X(dI - 2), 780), crook)
    fore_top = bez(crook, (X(dI - 10), 838), (X(WX + 40), wy - 36), (X(WX + CUFF), wy - 33))
    cuff_end = [(X(WX), wy - 32), (X(WX - 1), wy + 32)]
    fore_bot = bez((X(WX + CUFF), wy + 33), (X(WX + 70), wy + 40), (X(170), 921), (X(205), 920))
    elbow = bez((X(205), 920), (X(dE - 14), 921), (X(dE + 2), 905), (X(dE), 860))
    outer = [(X(d_out(y)), y) for y in np.arange(856, y_h - 34, -4)]
    shape = poly(inner + fore_top + cuff_end + fore_bot + elbow + outer)
    shape *= belowf
    arms.append(shape)
    # the cuff: the forearm's last CUFF px, a little wider than the arm, its own outline
    cuffpoly = [(X(WX + CUFF), wy - 37), (X(WX - 1), wy - 36), (X(WX - 3), wy + 36), (X(WX + CUFF), wy + 38)]
    cuffs.append(poly(cuffpoly))
    # the second flat tone: a strip down the inner side of the upper arm, and along the forearm's underside
    pa = np.array(inner)
    sh_ = poly([tuple(p) for p in pa] + [(p[0] + sg * 20, p[1]) for p in pa[::-1]])
    pb = np.array(fore_bot)
    sh_ = np.maximum(sh_, poly([tuple(p) for p in pb] + [(p[0], p[1] - 15) for p in pb[::-1]]))
    armsh.append(sh_ * shape)
    # the arm's own lines: a drape line down the upper arm, and an elbow fold (two short strokes at the bend)
    dm = (dI + d_out(700)) / 2
    ln = stroke(bez((X(dm - 6), arc_y(X(dm - 6)) + 4), (X(dm), 700), (X(dm + 8), 770), (X(dm + 4), 812)), 3.4)
    ln = np.maximum(ln, stroke(bez((X(dI + 6), 836), (X(dI + 30), 850), (X(dI + 58), 852)), 3.2))
    ln = np.maximum(ln, stroke(bez((X(dI + 16), 868), (X(dI + 44), 880), (X(dI + 72), 880)), 3.0))
    armln.append(ln * shape)
arm = np.maximum(*arms); cuff = np.maximum(*cuffs) * below

# ---- the front: everything below the hem that is not an arm
front = belowf * (1 - arm)

# its folds: bold lines from the hem down, splaying a little, irregular as the drafts' cloth is: some run the
# whole way, some start lower; a flat shadow strip beside each, toward the centre
fold_ln = np.zeros((HH, HW), np.float32); fold_sh = np.zeros((HH, HW), np.float32)
FOLDS = [  # (x at the hem, x at the table, start below the hem, wobble, shadow width at the foot)
    (4, 10, 0, 5, 0), (-44, -82, 0, -6, 17), (40, 70, 26, 4, 14), (-88, -150, 40, 5, 20), (82, 142, 0, -5, 19),
    (-126, -214, 0, -4, 15), (124, 208, 48, 6, 22), (-20, -40, 120, 3, 10), (60, 104, 150, -3, 0)]
for xt, xb, y_in, wob, shw in FOLDS:
    y0 = arc_y(CX + xt) + 2 + y_in
    pts = bez((CX + xt, y0), (CX + xt + (xb - xt) * 0.3 + wob, y0 + (TABLE - y0) * 0.33),
              (CX + xt + (xb - xt) * 0.7 - wob, y0 + (TABLE - y0) * 0.66), (CX + xb, TABLE + 4))
    w = np.linspace(3.9, 3.1, len(pts))
    fold_ln = np.maximum(fold_ln, stroke(pts, 3.7))
    if not shw:
        continue
    s_ = -np.sign(xt)
    pa = np.array(pts); n = len(pa)
    ww = np.linspace(4, shw, n) * np.clip(np.linspace(0, 6, n), 0, 1)
    other = pa + np.stack([s_ * ww, np.zeros(n)], 1)
    fold_sh = np.maximum(fold_sh, poly([tuple(p) for p in pa] + [tuple(p) for p in other[::-1]]))
# the hem's own shadow: a flat band under it
hem_sh = (yy >= yarc) & (yy < yarc + 13)
hem_ln = np.clip(np.minimum(yy - yarc + 1.0, yarc + 4.6 - yy), 0, 1)

# ---- the fan: six plain cards, pivoting about one point between the hands
FP = np.array([750.0, 850.0]); CW, CHt, PIV, RR = 134.0, 188.0, 164.0, 12.0
fan_layers = []
for ang in np.linspace(-25, 25, 6):
    a = np.radians(ang); R = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
    def rr(inset):
        # a rounded rectangle, local to the card (pivot at the origin, the card's top at -PIV)
        x0, x1, y0, y1 = -CW / 2 + inset, CW / 2 - inset, -PIV + inset, CHt - PIV - inset
        r = max(RR - inset, 2)
        pts = []
        for cx_, cy_, a0 in ((x1 - r, y0 + r, -90), (x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180)):
            for t in np.linspace(a0, a0 + 90, 8):
                pts.append((cx_ + r * np.cos(np.radians(t)), cy_ + r * np.sin(np.radians(t))))
        pts = np.array(pts) @ R.T + FP
        return poly([tuple(p) for p in pts])
    fan_layers.append((rr(0), rr(1.6), rr(4.6)))
fanm = np.zeros((HH, HW), np.float32)
for o, _, _ in fan_layers:
    fanm = np.maximum(fanm, o)

# ---- the hands: at the fan's foot, meeting at the centre, as the drafts hold theirs
def hand(sg, rot, lift):
    """one hand, local frame: the wrist at the origin, +x toward the centre line, y down. The back of the hand,
    widening from the wrist to the knuckles; the thumb over the top, against the cards; the fingers curled round
    the fan's foot, their tips rounded, three lines between them; a flat shade along the underside."""
    s = HSCALE
    top = bez((-8, -21), (14, -24), (34, -28), (52, -30))
    thumb = bez((24, -26), (34, -40), (58, -48), (74, -47)) + bez((74, -47), (86, -46), (84, -34), (70, -33))
    fing = bez((52, -30), (78, -32), (98, -26), (101, -10)) + bez((101, -10), (104, 4), (98, 18), (86, 22))
    bot = bez((86, 22), (66, 27), (36, 28), (14, 25)) + [(-8, 23)]
    outline = top + fing + bot
    th = [(24, -26)] + thumb + [(52, -30), (40, -28)]
    shade = bez((86, 22), (66, 27), (36, 28), (14, 25)) + bez((14, 18), (36, 20), (66, 19), (86, 14)) + bez((86, 14), (95, 9), (99, 0), (100, -6))
    fingers = [bez((99, y), (88, y + 1.5), (74, y + 2), n=12) for y in (-15, -4, 7)]
    a = np.radians(rot)
    R = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
    W = np.array([CX + sg * WX, WY - lift])
    def g(pts):
        p = np.array(pts, np.float64) * s
        p = p @ R.T
        p[:, 0] *= -sg                                           # +x points to the centre line
        return [tuple(q) for q in p + W]
    body = poly(g(outline)); thm = poly(g(th)); sh = poly(g(shade)) * body
    body = np.maximum(body, thm)
    ln = inner_stroke(body, 3.2)
    ln = np.maximum(ln, stroke(g(bez((36, -29), (50, -32), (64, -33), n=8)), 2.4))   # where the thumb lies on the hand
    for f in fingers:
        ln = np.maximum(ln, stroke(g(f), 2.3) * body)
    return body, thm, sh, ln
hands = [hand(-1, -14.0, 0), hand(1, -10.0, 4)]
handm = np.maximum(hands[0][0], hands[1][0])

# ---- lay it down
h = half.copy()
h = lay(h, FRONT, front)
h = lay(h, SHADE, front * np.maximum(fold_sh, hem_sh))
h = lay(h, LINE, front * fold_ln)
for i in range(2):
    h = lay(h, ARM, arms[i])
    h = lay(h, FRONT, armsh[i])
    h = lay(h, LINE, armln[i])
    h = lay(h, LINE, inner_stroke(arms[i], 4.2))
h = lay(h, LINE, hem_ln * belowf)
h = lay(h, LINE, inner_stroke(belowf, 3.8))
for o, gi, bk in fan_layers:
    h = lay(h, CEDGE, o); h = lay(h, GILT, gi); h = lay(h, CARD, bk)
for i, (body, th, sh, ln) in enumerate(hands):
    h = lay(h, SKIN, body)
    h = lay(h, SKIN_SH, sh)
    h = lay(h, HLINE, ln)
# the cuffs over the wrists
h = lay(h, SHADE * 0.92, cuff)
h = lay(h, LINE, inner_stroke(cuff, 3.6))
# a fine grain, as the drafts' print has, on the new parts only
new = np.clip(np.maximum.reduce([belowf, fanm, handm, cuff]), 0, 1)
rng = np.random.default_rng(7)
grain = gaussian_filter(rng.normal(0, 1, (HH, HW)), 0.7) * 3.2
h = h + (grain * new)[..., None]
# the darks: no new pixel's luminance under 22
lum = 0.2126 * h[..., 0] + 0.7152 * h[..., 1] + 0.0722 * h[..., 2]
lift = np.clip(22 - lum, 0, None)[..., None] * new[..., None]
h = h + lift
# the new parts over round 6 (the hem's line and the silhouette are hard; the outer edge keeps round 6's feather)
nm = np.maximum.reduce([belowf, fanm, handm, cuff])
nm[TABLE:] = 0
out = half * (1 - nm[..., None]) + h * nm[..., None]
Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(f"{od}/d-{tag}.png")
Image.fromarray((nm * 255).astype(np.uint8)).save(f"{od}/dm-{tag}.png")
for n, m in (("front", front), ("arm", np.maximum(arm, cuff)), ("fan", fanm), ("hand", handm)):
    Image.fromarray((np.clip(m, 0, 1) * 255).astype(np.uint8)).save(f"{od}/m-{n}-{tag}.png")
print(tag, "new px", int((nm > 0.01).sum()), "fan/arm overlap at cuffs", float((fanm * cuff).sum()))
