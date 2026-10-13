# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, grounds: the final's figure and table band (lift.py) laid on two alternative grounds.
#   grounds.py <tag> <workdir> <draft.png> <outdir> [--halo LUMA]
# writes <outdir>/A-<tag>.png and B-<tag>.png (1500 x 2100, 600 dpi, exact 180-degree symmetry) and
#        <workdir>/report-<tag>.json (the luminance numbers).
#
# Both grounds share the frame: the first drafts' plain gilt moulding (a mitred bevel 0-112 px in the drafts' own
# streaky gold, top and bottom a touch lighter than the sides, a soft rounded profile, a thin mitre line), the
# drafts' dark rule at 112-124 px (in a near-black of the figure's own hue) and a narrow light fillet inside it.
# Round 2's floral border is gone; the table band runs out under the rule (its wood carried outward 80 px, so the
# grain runs on), and the field reaches the rule. The figure, the hands, the fan, the band, the lamp and the props are
# the final's own pixels, laid with the matte lift.py recovered.
#
# GROUND A, "the streaky worked leaf the drafts started with": the field and the moulding are the draft's own gold
# (direction/two-seats-<n>.png for this figure: its x 150-440 and the right-hand strip, y 150-950, clear of the frame,
# the rules, the figure and the band), scaled to sleeve pixels (1500/1632) and re-tiled from random vertical strips
# (round 2's streaky.py method: strips 50-110 px wide, each stacked from 480-row runs blended over 80 rows,
# neighbours blended over 16 columns), so no mirror or tile repeat shows. Its fine detail (the texture over its own
# 40 px blur, at 0.85 strength) is laid on the draft's mean gold, desaturated to 0.80 and set to a mean HSV value of
# ~160, under one light: the lamp's glow (+30% at the lamp, a 355 px gaussian, fitted to the glow on round 2's
# punched gold) and a soft 5-7% vignette. A soft knee from 200 keeps every channel at or below 225.
#
# GROUND B, "dark tooled damask per colour": a deep ground in the figure's own colour family, carrying round 2's
# punched diamond lattice (the crossings ground6.py measured, the same mesh, extended by its affine fit) as a lighter
# tone of the same hue: the lines +10 luminance, the four-petal punches at the crossings +14. A faint seeded grain
# (fine and mid, ~2 levels each) and a 3% mottle so nothing is a flat patch, the same lamp glow (x1.30 plus a little
# warm light) and vignette; a thin tooled-gold line (4 px of the frame's gold, punched every 9 px) 137-141 px in.
# --halo L lifts the ground round the figure by L luminance levels at the edge, falling off over ~40 px.
#
# Symmetry: everything is built in the top half and the bottom is that half turned 180 degrees (asserted). The
# texture is generated full height (2100 rows) and the right-hand moulding and rule of the top half take the bottom
# of it turned round, so the left and right mouldings run on unbroken through the seam (the band hides the seam
# everywhere else).
import sys, json, argparse
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, uniform_filter, map_coordinates, distance_transform_edt, binary_erosion

ap = argparse.ArgumentParser()
ap.add_argument("tag"); ap.add_argument("wd"); ap.add_argument("draft"); ap.add_argument("out")
ap.add_argument("--halo", type=float, default=0.0)
a = ap.parse_args()
t = a.tag
HW, HH, SEAM, TABLE = 1500, 2100, 1050, 944
BEV, RULE1, FIL1, SWITCH = 112, 124, 127, 118
K = np.array([.2126, .7152, .0722], np.float32)
lum = lambda x: x @ K
Z = np.load(f"{a.wd}/lift-{t}.npz")
C, P, alpha = Z["C"], Z["P"], Z["alpha"]
bx0, bx1 = (int(v) for v in Z["band"])
yy, xx = np.mgrid[0:SEAM, 0:HW].astype(np.float32)
SEED = {"green": 7101, "garnet": 7102, "blue": 7103}[t]
rng = np.random.default_rng(SEED)

# ---------- the draft's gold, re-tiled
RECTS = {"green": [(150, 150, 440, 950), (1192, 150, 1482, 950)],
         "garnet": [(150, 150, 425, 850), (1180, 150, 1470, 850)],     # draft 2 has inner rules at x 432-448, 1147-1164
         "blue": [(150, 150, 440, 950), (1192, 150, 1482, 950)]}[t]
d = Image.open(a.draft).convert("RGB")
sc = 1500 / 1632
samples = []
for (x0, y0, x1, y1) in RECTS:
    s = d.crop((x0, y0, x1, y1))
    samples.append(np.asarray(s.resize((round((x1 - x0) * sc), round((y1 - y0) * sc)), Image.LANCZOS), np.float32))
mean_gold = np.concatenate([s.reshape(-1, 3) for s in samples]).mean(0)

def quilt(H, W):
    acc = np.zeros((H, W + 240, 3), np.float32); wsum = np.zeros((H, W + 240, 1), np.float32)
    x = 0
    while x < W + 60:
        s = samples[int(rng.integers(0, len(samples)))]
        SH, SW = s.shape[:2]
        w = int(rng.integers(50, 110)); sx = int(rng.integers(0, SW - w - 1))
        col = np.zeros((H, w, 3), np.float32); cw = np.zeros((H, 1, 1), np.float32)
        n = min(480, SH - 1)
        y = -int(rng.integers(0, 200))
        while y < H:
            sy = int(rng.integers(0, SH - n))
            seg = s[sy:sy + n, sx:sx + w]
            ramp = np.minimum(np.clip(np.arange(n) / 80, 0, 1), np.clip((n - 1 - np.arange(n)) / 80, 0, 1))[:, None, None]
            ya, yb = max(y, 0), min(y + n, H)
            col[ya:yb] += seg[ya - y:yb - y] * ramp[ya - y:yb - y]; cw[ya:yb] += ramp[ya - y:yb - y]
            y += n - 80
        col /= np.maximum(cw, 1e-3)
        hr = np.minimum(np.clip(np.arange(w) / 16, 0, 1), np.clip((w - 1 - np.arange(w)) / 16, 0, 1))[None, :, None] + 1e-3
        acc[:, x:x + w] += col * hr; wsum[:, x:x + w] += hr
        x += w - 16
    return (acc / np.maximum(wsum, 1e-3))[:, 30:30 + W]

T = quilt(HH, HW)                                     # full height: the side mouldings run through the seam
hf = T / np.maximum(gaussian_filter(T, (40, 40, 0)), 1)
hf = 1 + (hf - 1) * 0.85
# the top half's view of the texture: the right-hand moulding and rule take the full texture turned 180 degrees
inset_x = np.minimum(xx, HW - 1 - xx); inset_y = yy
side = inset_x < inset_y
flip = (xx >= HW / 2) & side & (inset_x < SWITCH)
hf_top = np.where(flip[..., None], hf[::-1, ::-1][:SEAM], hf[:SEAM])

def desat(c, k):
    y = lum(c)[..., None]
    return y + (c - y) * k

base = desat(mean_gold, 0.80)
base = base * (160.0 / base.max())

# ---------- light: the lamp's glow and a soft vignette (the bottom seat gets the same, turned)
r = np.hypot(xx - 750, yy - 1050)
glow = np.exp(-(r / 355.0) ** 2)
vign = 1 - 0.07 * ((xx - 750) / 750) ** 2 - 0.05 * ((yy - 1050) / 1050) ** 2
light = (1 + 0.30 * glow) * vign

def knee(v, k0=200.0, top=225.0):
    return np.where(v > k0, k0 + (top - k0) * np.tanh((v - k0) / (top - k0)), v)

gold = desat(hf_top * base, 0.92) * light[..., None]

# ---------- the frame (shared): the bevel, the mitre, the rule, the fillet
tt = np.clip(np.minimum(inset_x, inset_y) / BEV, 0, 1)
profile = 0.86 + 0.20 * np.sin(np.pi * tt * 0.9)
facet = np.where(side, 0.94, 1.04)
mit = np.clip(1.3 - np.abs(inset_x - inset_y), 0, 1) * (np.minimum(inset_x, inset_y) < BEV)
bevel_col = gold / light[..., None] * (profile * facet * (1 - 0.22 * mit))[..., None] * (1 - 0.04 * ((yy - 1050) / 1050) ** 2)[..., None]
RULE_COL = {"green": (30, 46, 40), "garnet": (56, 30, 31), "blue": (30, 35, 56)}[t]
rule_col = np.array(RULE_COL, np.float32) * (0.92 + 0.08 * lum(hf_top))[..., None]
fil_col = gaussian_filter(gold, (3, 3, 0)) * 1.10
inset = np.minimum(inset_x, inset_y)
def ramp(v0, v1):     # 1 inside [v0, v1) of the inset, antialiased over a pixel
    return np.clip(np.minimum(inset - v0 + 0.5, v1 - inset + 0.5), 0, 1)
w_bev = ramp(-10, BEV); w_rule = ramp(BEV, RULE1); w_fil = ramp(RULE1, FIL1)

def frame_over(img):
    img = img * (1 - w_bev[..., None]) + bevel_col * w_bev[..., None]
    img = img * (1 - w_rule[..., None]) + rule_col * w_rule[..., None]
    img = img * (1 - w_fil[..., None]) + fil_col * w_fil[..., None]
    return img

# ---------- the table band: the final's pixels, run out to the rule. The last few columns at each end carry round
# 2's painted end (a dark edge and the fillet's light), so the wood from 8 px in is carried outward by 80 px (the
# grain runs along the band, so a shifted copy continues it) and cross-faded into the original over 20 px.
SH, XF = 80, 20
def band_over(img):
    o = img.copy()
    B_ = C[TABLE:SEAM].copy()
    L0, R0 = bx0 + 8, bx1 - 8                                  # the clean wood begins here
    ext = np.zeros((SEAM - TABLE, HW, 3), np.float32)
    ext[:, L0 - SH:L0 + XF] = B_[:, L0:L0 + SH + XF]           # shifted copy, left end
    ext[:, R0 - XF:R0 + SH] = B_[:, R0 - XF - SH:R0]           # shifted copy, right end
    w = np.zeros(HW, np.float32)
    w[:L0] = 1; w[L0:L0 + XF] = np.linspace(1, 0, XF)
    w[R0:] = 1; w[R0 - XF:R0] = np.linspace(0, 1, XF)
    band = B_ * (1 - w[None, :, None]) + ext * w[None, :, None]
    o[TABLE:SEAM, RULE1 - 2:HW - RULE1 + 2] = band[:, RULE1 - 2:HW - RULE1 + 2]
    return o

def figure_over(img):
    al = alpha[..., None]
    o = img.copy()
    o[:TABLE] = P[:TABLE] + (1 - al[:TABLE]) * img[:TABLE]
    return o

# ---------- GROUND A
fieldA = gold.copy()
# the field's mean HSV value set to ~160 over the visible ground, then the knee
vis = (alpha == 0) & (yy < TABLE) & (inset >= FIL1)
fieldA *= 160.0 / fieldA.max(-1)[vis].mean()
fieldA = knee(fieldA)
bevel_col = knee(bevel_col * 160.0 / bevel_col.max(-1)[(inset < BEV)].mean())
topA = frame_over(band_over(fieldA))
topA = figure_over(topA)

# ---------- GROUND B
BASE = {"green": (0x1d, 0x3b, 0x2c), "garnet": (0x4a, 0x14, 0x18), "blue": (0x14, 0x21, 0x3f)}[t]
bc = np.array(BASE, np.float32)
Lb = float(lum(bc))
# round 2's lattice: the measured crossing mesh, inverted at every pixel
Lz = np.load(f"{a.wd}/lattice-{t}.npz")
MX, MY, A6, par_bit, PQ = Lz["MX"], Lz["MY"], Lz["A"], int(Lz["par_bit"]), int(Lz["PQ"])
def fwd(p, q):
    i = p + PQ; j = q + PQ
    return (map_coordinates(MX, [i, j], order=1, mode="nearest"), map_coordinates(MY, [i, j], order=1, mode="nearest"))
Ainv = np.linalg.inv(np.array([[A6[1, 0], A6[2, 0]], [A6[1, 1], A6[2, 1]]]))
def inv(x, y):
    dx, dy = x - A6[0, 0], y - A6[0, 1]
    n = Ainv[0, 0] * dx + Ainv[0, 1] * dy; m = Ainv[1, 0] * dx + Ainv[1, 1] * dy
    p, q = (n + m - par_bit) / 2, (n - m + par_bit) / 2
    for _ in range(6):
        fx, fy = fwd(p, q); e = 1e-3
        fxp, fyp = fwd(p + e, q); fxq, fyq = fwd(p, q + e)
        a_, b_, c_, d_ = (fxp - fx) / e, (fxq - fx) / e, (fyp - fy) / e, (fyq - fy) / e
        det = a_ * d_ - b_ * c_; det = np.where(np.abs(det) < 1e-6, 1e-6, det)
        rx, ry = x - fx, y - fy
        p = p + (d_ * rx - b_ * ry) / det; q = q + (-c_ * rx + a_ * ry) / det
    return p, q
pp, qq = inv(xx.ravel().astype(np.float64), yy.ravel().astype(np.float64))
pp = pp.reshape(SEAM, HW); qq = qq.reshape(SEAM, HW)
gpy, gpx = np.gradient(pp); gqy, gqx = np.gradient(qq)
dp = np.abs(pp - np.round(pp)) / np.maximum(np.hypot(gpx, gpy), 1e-6)     # px to the nearest p line
dq = np.abs(qq - np.round(qq)) / np.maximum(np.hypot(gqx, gqy), 1e-6)
LW = 1.1                                                                  # half-width of a line, px
line = np.clip(LW + 0.5 - np.minimum(dp, dq), 0, 1)
cx, cy = fwd(np.round(pp), np.round(qq))
ox, oy = xx - cx, yy - cy
ros = np.zeros_like(xx)
for ux, uy in ((1, 0), (0, 1), (-1, 0), (0, -1)):
    al_ = ox * ux + oy * uy; ac_ = -ox * uy + oy * ux
    e = ((al_ - 5.0) / 3.6) ** 2 + (ac_ / 1.9) ** 2
    ros = np.maximum(ros, np.clip((1 - e) * 2.5, 0, 1))
ros = np.maximum(ros, np.clip((1.9 - np.hypot(ox, oy)) * 1.5, 0, 1))
delta = np.maximum(10.0 * line, 14.0 * ros)
# grain and mottle, seeded (the bottom seat is the top turned, so the grain is symmetric too)
g1 = gaussian_filter(rng.normal(0, 1, (SEAM, HW)), 0.7); g1 /= g1.std()
g2 = gaussian_filter(rng.normal(0, 1, (SEAM, HW)), 3.0); g2 /= g2.std()
mot = gaussian_filter(rng.normal(0, 1, (SEAM, HW)), 80); mot /= mot.std()
delta = delta + 2.0 * g1 + 1.8 * g2
if a.halo:
    dist = distance_transform_edt(alpha < 0.5)
    delta = delta + a.halo * np.exp(-dist / 40.0) * (yy < TABLE)
fieldB = bc * (1 + delta / Lb)[..., None] * (1 + 0.03 * mot)[..., None]
fieldB = fieldB * (1 + 0.30 * glow * 1.0)[..., None] * vign[..., None] + np.array([9, 6, 2], np.float32) * glow[..., None]
# the tooled-gold inner line: 4 px of the frame's gold, punched every 9 px
TL0, TL1 = 137, 141
w_tl = ramp(TL0, TL1)
s_along = np.where(side, yy, xx)
punch = np.hypot(np.mod(s_along, 9) - 4.5, inset - (TL0 + TL1 - 1) / 2) < 1.4
tl_col = knee(gold * 160.0 / gold.max(-1)[vis].mean() * 0.92) * np.where(punch, 0.55, 1.0)[..., None]
fieldB = fieldB * (1 - w_tl[..., None]) + tl_col * w_tl[..., None]
topB = frame_over(band_over(fieldB))
topB = figure_over(topB)

# ---------- save and measure
def save(top, path):
    top = np.round(np.clip(top, 0, 255))
    full = np.concatenate([top, top[::-1, ::-1]], 0).astype(np.uint8)
    assert np.array_equal(full, full[::-1, ::-1]), "not 180-degree symmetric"
    Image.fromarray(full).save(path, dpi=(600, 600))
    return full.astype(np.float32)

ground_top = (alpha == 0) & ((yy < TABLE) | (xx < RULE1) | (xx >= HW - RULE1))
field_top = ground_top & (inset >= FIL1) & (yy < TABLE)
both = lambda m: np.concatenate([m, m[::-1, ::-1]], 0)
rep = {"tag": t}
for name, top in (("A", topA), ("B", topB)):
    full = save(top, f"{a.out}/{name}-{t}.png")
    L = lum(full); V = full.max(-1)
    box = uniform_filter(L, 12)                              # 0.5 mm at 600 dpi
    G = both(ground_top); Fm = both(field_top)
    Ge = binary_erosion(G, iterations=6)                      # boxes wholly on the ground
    hsv = np.asarray(Image.fromarray(full.astype(np.uint8)).convert("HSV"), np.float32)
    sv = hsv[..., 1] * hsv[..., 2] / 255
    rep[name] = {
        "field_luma_mean": round(float(L[Fm].mean()), 1), "field_value_mean": round(float(V[Fm].mean()), 1),
        "field_luma_max": round(float(L[Fm].max()), 1), "field_channel_max": round(float(V[Fm].max()), 1),
        "field_channel_p99_5": round(float(np.percentile(V[Fm], 99.5)), 1),
        "ground_channel_max": round(float(V[G].max()), 1),
        "ground_darkest_0p5mm": round(float(box[Ge].min()), 1),
        "ground_darkest_0p5mm_p0_5": round(float(np.percentile(box[Ge], 0.5)), 1),
        "card_darkest_0p5mm": round(float(box.min()), 1),
        "card_darkest_0p5mm_p0_5": round(float(np.percentile(box, 0.5)), 1),
        "field_sat_x_value_p99_5": round(float(np.percentile(sv[Fm], 99.5)), 1),
        "faces_luma_p99": round(float(np.percentile(L[:SEAM][((xx - 750) / 115) ** 2 + ((yy - 405) / 145) ** 2 < 1], 99)), 1),
    }
    # the cloak's edge against the ground: a ring 3-8 px inside the figure vs 8-20 px outside, above y 900
    din = distance_transform_edt(alpha >= 0.5); dout = distance_transform_edt(alpha < 0.5)
    ring_in = (din >= 3) & (din <= 8) & (yy < 900) & (yy > 300)
    ring_out = (dout >= 8) & (dout <= 20) & (yy < 900) & (yy > 300) & (inset >= FIL1)
    top8 = full[:SEAM]
    rep[name]["edge_luma_in_out"] = [round(float(lum(top8[ring_in]).mean()), 1), round(float(lum(top8[ring_out]).mean()), 1)]
    rep[name]["edge_rgb_in_out"] = [top8[ring_in].mean(0).round(1).tolist(), top8[ring_out].mean(0).round(1).tolist()]
rep["halo"] = a.halo
json.dump(rep, open(f"{a.wd}/report-{t}.json", "w"), indent=1)
print(json.dumps(rep))
