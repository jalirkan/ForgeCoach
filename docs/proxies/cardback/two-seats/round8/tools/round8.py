# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 8: one surface, and the deadpan details.
#   round8.py <r7-final.png> <r7-comp-dir> <r6-comp-dir> <tag: green|garnet|blue> <out.png> [--no-props] [--no-grain]
# Works on the top half (1500 x 1050) of round 7's final; the bottom seat is that half turned 180 degrees.
#   1. The props: two or three small, flat-drawn period objects on the table band's near edge, in the court-card
#      line style (one flat tone, one flat shade, a dark warm outline), each with a flat cast shadow on the band
#      thrown away from the lamp. Drawn at 4x and reduced.
#   2. One surface: over the DRAWN regions only (round 7's torso, arms, hands, fan, chest: dm-<tag>, less the face
#      ellipse and every row from the moulding down; plus the props' bodies) the outlines are softened by a
#      gaussian of sigma SOFT px and a seeded paper tooth is added: luminance noise, two scales mixed, std TOOTH
#      levels. Nothing outside those regions changes.
# Faces, hoods, the gold, the border and the lamp are round 7's pixels byte for byte; the script asserts it.
import sys
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter, binary_dilation, distance_transform_edt, zoom

r7p, cd7, cd6, tag, out = sys.argv[1:6]
PROPS = "--no-props" not in sys.argv
GRAIN = "--no-grain" not in sys.argv
SOFT, TOOTH, SEED = 0.75, 2.6, 8101
HW, SEAM, TABLE = 1500, 1050, 944
r7 = np.asarray(Image.open(r7p).convert("RGB"), np.float32)
half = r7[:SEAM].copy()
yy, xx = np.mgrid[0:SEAM, 0:HW]
face = ((xx - 750) / 115) ** 2 + ((yy - 405) / 145) ** 2 < 1
D = (np.asarray(Image.open(f"{cd7}/dm-{tag}.png").convert("L"), np.float32)[:SEAM] / 255) > 0.002
D[face] = False
D[TABLE:] = False

# ---------------------------------------------------------------- the props
# a local canvas over the band's top half and the robe's foot, at 4x
RX0, RY0, RW, RH, SS = 330, 860, 840, 190, 4
def cv():
    im = Image.new("L", (RW * SS, RH * SS), 0); return im, ImageDraw.Draw(im)
def fin(im):
    a = np.zeros((SEAM, HW), np.float32)
    a[RY0:RY0 + RH, RX0:RX0 + RW] = np.asarray(im.resize((RW, RH), Image.LANCZOS), np.float32) / 255
    return a
def P(pts): return [((x - RX0) * SS, (y - RY0) * SS) for x, y in pts]
def poly(pts):
    im, d = cv(); d.polygon(P(pts), fill=255); return fin(im)
def ell(cx, cy, rx, ry):
    im, d = cv(); d.ellipse(((cx - rx - RX0) * SS, (cy - ry - RY0) * SS, (cx + rx - RX0) * SS, (cy + ry - RY0) * SS), fill=255)
    return fin(im)
def stroke(pts, w):
    im, d = cv(); p = P(pts); d.line(p, fill=255, width=int(round(w * SS)), joint="curve")
    r = w * SS / 2
    for x, y in (p[0], p[-1]):
        d.ellipse((x - r, y - r, x + r, y + r), fill=255)
    return fin(im)
def bez(*c, n=24):
    t = np.linspace(0, 1, n)[:, None]; c = [np.array(q, np.float64) for q in c]
    if len(c) == 3:
        return [tuple(q) for q in (1 - t) ** 2 * c[0] + 2 * (1 - t) * t * c[1] + t ** 2 * c[2]]
    return [tuple(q) for q in (1 - t) ** 3 * c[0] + 3 * (1 - t) ** 2 * t * c[1] + 3 * (1 - t) * t ** 2 * c[2] + t ** 3 * c[3]]
def edge(m, w, up=3):
    """a line of width w inside shape m, along its whole boundary (antialiased)"""
    mu = zoom(m, up, order=1)
    d = distance_transform_edt(mu > 0.5) / up
    a = np.clip(d * up, 0, 1) * np.clip(w + 0.5 - d, 0, 1)
    return a.reshape(m.shape[0], up, m.shape[1], up).mean((1, 3))
def ellpts(cx, cy, rx, ry, a0=0, a1=360, n=36):
    t = np.radians(np.linspace(a0, a1, n)); return [(cx + rx * np.cos(q), cy + ry * np.sin(q)) for q in t]

C = lambda *v: np.array(v, np.float32)
OUT = C(50, 34, 28)                       # the props' line: a dark warm brown, darker than the hands' line
LW = 2.6
GILT, GILT_SH = C(222, 178, 114), C(168, 122, 64)
CREAM, CREAM_SH = C(204, 190, 158), C(164, 150, 122)
PEW, PEW_SH, PEW_HI = C(146, 145, 139), C(106, 106, 103), C(184, 183, 175)
LINEN, LINEN_SH = C(212, 202, 182), C(172, 162, 144)
WINE, WINE_HI = C(72, 40, 34), C(124, 78, 66)
SPILL, SPILL_HI = C(96, 50, 40), C(176, 120, 100)
COLD, SKINF = C(104, 84, 64), C(146, 126, 98)
CRUST, CRUST_SH, CRUMB = C(190, 132, 70), C(146, 92, 46), C(230, 202, 156)

layers = []          # (colour, alpha) laid in order
lines = []           # outline alphas, laid after each object's fills (kept per object, below)
shadow = np.zeros((SEAM, HW), np.float32)
body = np.zeros((SEAM, HW), np.float32)
def obj(fills, outline_shapes, extra_lines=()):
    """one object: fills [(colour, alpha)], an outline round each listed shape, extra interior strokes"""
    global body
    ln = np.zeros((SEAM, HW), np.float32)
    for s in outline_shapes:
        ln = np.maximum(ln, edge(s, LW))
        body = np.maximum(body, s)
    for e in extra_lines:
        ln = np.maximum(ln, e)
    layers.append((fills, ln))
def cast(xc, base, w, h):
    """a flat cast shadow on the band, thrown away from the lamp (x 750) and a little toward the viewer"""
    global shadow
    s = np.sign(xc - 750)
    shadow = np.maximum(shadow, ell(xc + s * 0.30 * h, base + 1.5, w / 2 + 0.30 * h, 4.5 + 0.05 * h))

def coin_stack(x, base, n, rx=13.0, ry=4.2, t=4.4, jitter=None):
    jitter = jitter or [0] * n
    shapes, fills, ex = [], [], []
    for i in range(n):
        cx = x + jitter[i]; yb = base - i * t
        side = poly(ellpts(cx, yb, rx, ry, 0, 180) + ellpts(cx, yb - t, rx, ry, 180, 0))
        top = ell(cx, yb - t, rx, ry)
        shapes.append(np.maximum(side, top))
        fills += [(GILT_SH, side), (GILT, top)]
        ex.append(stroke(ellpts(cx, yb - t, rx, ry, 0, 180, 18), 1.5))       # each coin's rim
    m = np.maximum.reduce(shapes)
    obj(fills, [m], ex)
    cast(x, base, 2 * rx, n * t + 2 * ry)

def cup(x, base, h=64, rt=23.0, rb=17.0, glaze=CREAM, glaze_sh=CREAM_SH, liquid=WINE, hi=WINE_HI, skin=None, saucer=False, handle=0):
    shapes, fills, ex = [], [], []
    if saucer:
        sc = poly(ellpts(x, base, 36, 7.5, 0, 180) + ellpts(x, base - 4, 36, 7.5, 180, 0))
        sc = np.maximum(sc, ell(x, base - 4, 36, 7.5))
        fills += [(glaze_sh, sc), (glaze, ell(x, base - 5, 33, 6))]
        shapes.append(sc); base = base - 5
    yt = base - h
    bodyp = ellpts(x, base, rb, 4.5, 0, 180) + [(x - rb, base), (x - rt, yt)] + ellpts(x, yt, rt, 6.5, 180, 360) + [(x + rt, yt), (x + rb, base)]
    b = poly(bodyp)
    rim = ell(x, yt, rt, 6.5)
    cupm = np.maximum(b, rim)
    if handle:
        hx = x + handle * (rt + rb) / 2
        ho = bez((hx, yt + 8), (hx + handle * 20, yt + 4), (hx + handle * 20, yt + h * 0.75), (hx - handle * 2, yt + h * 0.8))
        hi_ = bez((hx - handle * 1, yt + h * 0.62), (hx + handle * 11, yt + h * 0.6), (hx + handle * 12, yt + 16), (hx, yt + 16))
        hdl = poly(ho + hi_)
        fills.append((glaze_sh, hdl)); shapes.append(hdl)
    shade = poly([(x + rt * 0.35, yt + 2), (x + rt, yt), (x + rb, base), (x + rb * 0.45, base + 3)]) * b
    band = poly([(x - rt * 0.98, yt + 14), (x + rt * 0.98, yt + 14), (x + rt * 0.96, yt + 19), (x - rt * 0.96, yt + 19)]) * b
    liq = ell(x, yt + 0.8, rt - 3.5, 4.6)
    fills += [(glaze, b), (glaze_sh, shade), (glaze_sh * 0.92, band), (glaze, rim), (liquid, liq)]
    if skin is not None:
        fills.append((skin, np.clip(ell(x + 2, yt + 1.2, rt - 8, 2.6) - ell(x + 2.5, yt + 1.2, rt - 10.5, 1.6), 0, 1)))
    else:
        fills.append((hi, ell(x - rt * 0.45, yt + 0.4, 4.5, 1.4)))
    ex.append(stroke(ellpts(x, yt, rt - 3.2, 5.0, 0, 360, 40), 1.6))       # the rim's inner line
    shapes.append(cupm)
    obj(fills, shapes, ex)
    cast(x, base, 2 * rb + (40 if saucer else 0), h)

def tankard(x, base, h=70, r=22.0, liquid=COLD, skin=SKINF, handle=-1):
    yt = base - h
    b = poly(ellpts(x, base, r + 1.5, 4.5, 0, 180) + [(x - r - 1.5, base), (x - r, yt)] + ellpts(x, yt, r, 6.0, 180, 360) + [(x + r, yt), (x + r + 1.5, base)])
    rim = ell(x, yt, r, 6.0)
    hx = x + handle * r
    hout = bez((hx, yt + 10), (hx + handle * 26, yt + 8), (hx + handle * 24, yt + 46), (hx, yt + 50))
    hin = bez((hx, yt + 41), (hx + handle * 14, yt + 40), (hx + handle * 15, yt + 18), (hx, yt + 18))
    hdl = poly(hout + hin)
    foot = poly([(x - r - 3.5, base - 7), (x + r + 3.5, base - 7)] + ellpts(x, base, r + 3.5, 4.8, 0, 180))
    shade = poly([(x - handle * r * 0.30, yt + 2), (x - handle * r, yt), (x - handle * (r + 1.5), base), (x - handle * r * 0.4, base + 3)]) * b
    hi = poly([(x + handle * r * 0.48, yt + 8), (x + handle * r * 0.30, yt + 8), (x + handle * r * 0.32, base - 10), (x + handle * r * 0.50, base - 10)]) * b
    liq = ell(x, yt + 0.8, r - 3.2, 4.2)
    sk = np.clip(ell(x + 3, yt + 1.4, r - 7, 2.6) - ell(x + 4, yt + 1.6, r - 10, 1.5), 0, 1)
    fills = [(PEW_SH, hdl), (PEW, b), (PEW_SH, shade), (PEW_HI, hi), (PEW_SH, foot), (PEW, rim), (liquid, liq), (skin, sk)]
    ex = [stroke(ellpts(x, yt, r - 2.8, 4.8, 0, 360, 40), 1.6), stroke([(x - r - 2, base - 7), (x + r + 2, base - 7)], 1.6)]
    obj(fills, [np.maximum.reduce([b, rim, hdl, foot])], ex)
    cast(x, base, 2 * r + 20, h)

def lone_coin(x, base, rx=13.0, ry=4.2, t=4.0):
    coin_stack(x, base, 1, rx, ry, t)

def napkin(x, base):
    """a crumpled linen napkin: an irregular lump with a few creases"""
    o = [(x - 28, base - 2), (x - 31, base - 12), (x - 22, base - 19), (x - 24, base - 27), (x - 11, base - 33),
         (x - 2, base - 28), (x + 8, base - 35), (x + 19, base - 29), (x + 17, base - 21), (x + 29, base - 16),
         (x + 31, base - 6), (x + 24, base + 1), (x + 4, base + 3), (x - 12, base + 2)]
    m = poly(o)
    sh = poly([(x + 2, base - 27), (x + 8, base - 35), (x + 19, base - 29), (x + 17, base - 21), (x + 29, base - 16),
               (x + 31, base - 6), (x + 24, base + 1), (x + 9, base + 2), (x + 6, base - 12)]) * m
    sh2 = poly([(x - 31, base - 12), (x - 22, base - 19), (x - 14, base - 10), (x - 18, base + 1), (x - 28, base - 2)]) * m
    ex = [stroke(bez((x - 11, base - 31), (x - 9, base - 20), (x - 14, base - 10)), 1.7),
          stroke(bez((x + 6, base - 12), (x + 12, base - 17), (x + 16, base - 21)), 1.7),
          stroke(bez((x - 2, base - 26), (x + 1, base - 16), (x - 3, base - 4)), 1.5),
          stroke(bez((x + 12, base - 4), (x + 18, base - 8), (x + 27, base - 10)), 1.5)]
    obj([(LINEN, m), (LINEN_SH, np.maximum(sh, sh2))], [m], [e * m for e in ex])
    cast(x, base, 62, 34)

def pastry_plate(x, base):
    """a small pewter plate with half a bun on it: a domed bun with a bite out of its outer side, the crumb showing,
    and two crumbs on the plate"""
    pl = np.maximum(poly(ellpts(x, base, 40, 8.5, 0, 180) + ellpts(x, base - 4, 40, 8.5, 180, 0)), ell(x, base - 4, 40, 8.5))
    well = ell(x, base - 4.5, 29, 5.6)
    s = 1 if x > 750 else -1                       # the bite faces away from the lamp
    bx, by = x - 3 * s, base - 6
    bun = poly(ellpts(bx, by, 25, 4.5, 0, 180) + ellpts(bx, by, 25, 23, 180, 360))
    bite = np.maximum(ell(bx + s * 25, by - 10, 13, 13), ell(bx + s * 18, by - 21, 9, 8))
    bunm = np.clip(bun - bite, 0, 1)
    crumb = np.clip(binary_dilation(bite > 0.5, iterations=3).astype(np.float32) * bun - bite, 0, 1) * bunm
    bun_sh = poly([(bx - s * 4, by - 23), (bx - s * 26, by - 6), (bx - s * 25, by + 5), (bx - s * 4, by + 5)]) * bunm
    glaze_hi = stroke(bez((bx - s * 15, by - 15), (bx - s * 6, by - 21), (bx + s * 4, by - 21)), 2.2) * bunm
    c1, c2 = ell(x + s * 32, base - 5, 2.6, 1.6), ell(x + s * 27, base - 2.5, 1.8, 1.2)
    ex = [stroke(ellpts(x, base - 4.5, 29, 5.6, 0, 180, 24), 1.5),
          stroke(bez((bx + s * 12, by - 3), (bx + s * 14, by - 9), (bx + s * 11, by - 14)), 1.3) * bunm]
    obj([(PEW, pl), (PEW_SH, well)], [pl], ex)
    obj([(CRUST, bunm), (CRUST_SH, bun_sh), (CRUMB, crumb), (C(214, 166, 100), glaze_hi), (CRUMB, c1), (CRUMB, c2)], [bunm, c1, c2])
    cast(x, base, 84, 30)

def tipped_cup(x, base, length=58, r=19.0):
    """an earthenware cup lying on its side, its mouth toward the outer edge, a small flat spill from the mouth"""
    s = -1 if x < 750 else 1                       # the mouth faces away from the lamp
    cy = base - r
    mx = x + s * length / 2; fx = x - s * length / 2      # the mouth's and the foot's centres
    spill = poly([(mx + s * 2, base - 3), (mx + s * 14, base - 6), (mx + s * 34, base - 4), (mx + s * 52, base - 5),
                  (mx + s * 66, base - 1), (mx + s * 58, base + 4), (mx + s * 40, base + 5), (mx + s * 22, base + 7),
                  (mx + s * 4, base + 4)])
    sp_hi = stroke(bez((mx + s * 20, base - 1), (mx + s * 34, base - 2), (mx + s * 46, base - 1)), 1.6)
    bodyp = [(fx, cy - r * 0.86), (mx, cy - r)] + ellpts(mx, cy, 7.5, r, -90, -90 + s * 180) + [(mx, cy + r), (fx, cy + r * 0.86)] + ellpts(fx, cy, 6.5, r * 0.86, 90, 90 + s * 180)
    b = poly(bodyp)
    mouth = ell(mx, cy, 7.5, r)
    inside = ell(mx + s * 0.8, cy + 0.5, 5.2, r - 3.2)
    shade = poly([(fx, cy + r * 0.3), (mx, cy + r * 0.35), (mx, cy + r), (fx, cy + r * 0.86)]) * b
    band = poly([(mx - s * 15, cy - r), (mx - s * 20, cy - r * 0.95), (mx - s * 20, cy + r * 0.95), (mx - s * 15, cy + r)]) * b
    obj([(SPILL, spill), (SPILL_HI, sp_hi * spill)], [spill])
    obj([(CREAM, b), (CREAM_SH, shade), (CREAM_SH * 0.92, band), (CREAM, mouth), (C(66, 46, 38), inside)], [np.maximum(b, mouth)])
    cast(x, base, length + 10, 2 * r)

BASE = 1000
if PROPS:
    if tag == "green":       # winning: two neat stacks of coins; a full cup on its saucer, untouched
        coin_stack(492, BASE + 2, 7)
        coin_stack(525, BASE + 4, 4)
        cup(980, BASE + 4, h=38, rt=23.0, rb=14.0, saucer=True, handle=1)
    elif tag == "garnet":    # losing: a cold tankard with a skin on it, one lone coin, a crumpled napkin
        tankard(520, BASE + 2, handle=-1)
        napkin(972, BASE + 4)
        lone_coin(1078, BASE + 8)
    elif tag == "blue":      # distracted: the cup knocked over, a pastry abandoned half eaten
        tipped_cup(478, BASE + 4)
        pastry_plate(1000, BASE + 6)

h = half.copy()
# the shadows: a flat darkening of the band (never on the robe: only from the moulding's foot down)
shadow[:957] = 0
shadow = np.clip(shadow - body, 0, 1)
h = h * (1 - 0.40 * shadow[..., None])
def lay(img, col, a):
    a = np.clip(a, 0, 1)[..., None]; return img * (1 - a) + np.asarray(col, np.float32) * a
for fills, ln in layers:
    for col, a in fills:
        h = lay(h, col, a)
    h = lay(h, OUT, ln)

# ---------------------------------------------------------------- one surface
W = D | (body > 0.002)                     # the drawn regions: round 7's drawing, and the props' bodies
if GRAIN:
    soft = np.stack([gaussian_filter(h[..., c], SOFT) for c in range(3)], -1)
    rng = np.random.default_rng(SEED)
    def unit(s):
        n = gaussian_filter(rng.normal(0, 1, (SEAM, HW)), s); return n / n.std()
    tooth = 0.30 * unit(0.6) + 0.60 * unit(1.6) + 0.75 * unit(4.0)   # three scales: the fine tooth, the grain, the paper's pull
    tooth = TOOTH * tooth / tooth.std()
    g = soft + tooth[..., None]
    h = np.where(W[..., None], g, h)
lum = 0.2126 * h[..., 0] + 0.7152 * h[..., 1] + 0.0722 * h[..., 2]
h = h + (np.clip(22.6 - lum, 0, None) * W)[..., None]          # no drawn pixel darker than 22
h = np.where(W[..., None] | (shadow > 0)[..., None], h, half)
top = np.round(np.clip(h, 0, 255))
full = np.concatenate([top, top[::-1, ::-1]], 0)
assert np.array_equal(full, full[::-1, ::-1]), "not 180-degree symmetric"
im = Image.fromarray(full.astype(np.uint8))
im.save(out, dpi=(600, 600))
im.save(out[:-4] + ".jpg", quality=95, dpi=(600, 600), subsampling=0)
Image.fromarray((np.clip(np.maximum(body, shadow), 0, 1) * 255).astype(np.uint8)).save(out[:-4] + "-propmask.png")

# ---------------------------------------------------------------- checks against round 7
a = np.asarray(im, np.float32)
same = np.abs(a - r7).max(-1) == 0
def both(m): m = m[:SEAM]; return np.concatenate([m, m[::-1, ::-1]], 0)
fig6 = np.asarray(Image.open(f"{cd6}/figm-{tag}.png").convert("L"))[:SEAM] > 8
fig6[TABLE:] = False
inner = np.zeros((SEAM, HW), bool); inner[210:, 222:1278] = True
prop = (body > 0) | (shadow > 0)
fullyy, fullxx = np.mgrid[0:2100, 0:HW]
lamp = ((fullxx - 750) ** 2 + (fullyy - 1050) ** 2) < 160 ** 2
reg = {
    "faces (round 6's face ellipse)": both(face),
    "hoods and shoulder capes (the figure outside round 7's drawing)": both(fig6 & ~D & ~face & ~prop),
    "gold field outside the figure": both(inner & ~binary_dilation(fig6 | D, iterations=12) & (yy < TABLE) & ~prop),
    "border and frame (outside the gold field, above the moulding)": both(~inner & (yy < TABLE)),
    "lamp and its glow (a 160 px disc, less round 7's drawing)": lamp & ~both(D),
    "table band outside the props and their shadows": both((yy >= TABLE) & ~prop) & ~lamp,
    "round 7's drawing (expected to change)": both(D),
}
lumA = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
big = gaussian_filter(lumA, 12)
hsv = np.asarray(im.convert("HSV"), np.float32)
sat = float(np.percentile(hsv[..., 1] * (hsv[..., 2] / 255), 99.5))
pb = both(body > 0.5)
ys = np.nonzero(pb.any(1))[0]
print(f"{out}: identical to round 7 {same.mean():.2%}; dark 0.5% {np.percentile(big, 0.5):.1f}; "
      f"drawn min lum {lumA[both(W)].min():.1f}; sat99.5 {sat:.0f}; symmetric yes")
for k, m in reg.items():
    print(f"   {k}: {same[m].mean():.3%} identical ({m.sum()} px)")
# the props' heights (top half), one by one
from scipy.ndimage import label as lab
L_, n_ = lab(body[:SEAM] > 0.5)
for i in range(1, n_ + 1):
    yx = np.nonzero(L_ == i)
    if len(yx[0]) > 30:
        print(f"   prop at x {yx[1].min()}-{yx[1].max()}, y {yx[0].min()}-{yx[0].max()}: {yx[0].max() - yx[0].min() + 1} px tall")
