# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, order 2 (the green woman): order 1's Ground A2 (order-1/one-pass/tools/groundA2.py), unchanged but for
# her draft's sample rects (grounds.py's green x ranges, top and bottom panels) and her rule colour (grounds.py's green).
# The Two Seats, order 1, one pass: Ground A rebuilt FINER and CALMER, with no figure on it.
#   groundA2.py <draft.png> <final-unlifted.png> <mockA.png> <outdir>      (run in two-seats-work/order2/onepass)
# writes <outdir>/groundA2-top.png (the top half, 1500 x 1050: field, frame, band with its lamp and props, all
# unlifted) and <outdir>/groundA2-report.json.
#
# It is grounds.py's Ground A (order-1/tools/grounds.py), with three changes and nothing else:
#  1. FINER: the draft's leaf is sampled at 0.6 of the sleeve scale (1500/1632 x 0.6), and every length in the
#     re-tiling goes with it (strips 30-66 px wide, 288-row runs blended over 48 rows, neighbours over 10 columns,
#     the detail taken over its own 24 px blur, not 40), so the streaks are 40% finer.
#  2. CALMER: the blue-grey flecks are halved before re-tiling. On each sample, a pixel's fleck excess is how much
#     bluer than gold it is against its own 24 px neighbourhood, e = (B - R) - blur(B - R); where e > 0 its
#     difference from the neighbourhood is scaled by 1 - FLECK * min(e / 20, 1), FLECK = 0.8 (which halves the
#     measured flecks; 0.5 left 0.68 of them). Four samples of the draft's leaf (its four field panels clear of the
#     rules), each also mirrored, so the finer knots repeat less. The report measures
#     the flecks on the finished field and on the mock the same way (mean positive e), and the streak width as the
#     lag where the horizontal autocorrelation of the high-passed luminance falls to 0.5.
#  3. NO FIGURE: the figure is laid later, by onepass.py, from the one painted pass.
# Kept exactly: the mean gold and its desaturation, the field's brightest-channel mean set to 160, the knee from
# 200 (no channel over 225), the lamp's glow and the vignette, the plain moulding, rule and fillet, and the table
# band (the final's own pixels, its lamp and props, run out under the rule). Symmetry is made by onepass.py, which
# turns the finished top half 180 degrees.
import sys, json
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, uniform_filter

draft, finp, mockp, od = sys.argv[1:5]
HW, HH, SEAM, TABLE = 1500, 2100, 1050, 944
BEV, RULE1, FIL1, SWITCH = 112, 124, 127, 118
FINE, FLECK = 0.6, 0.8
K = np.array([.2126, .7152, .0722], np.float32)
lum = lambda x: x @ K
C = np.asarray(Image.open(finp).convert("RGB"), np.float32)[:SEAM]
yy, xx = np.mgrid[0:SEAM, 0:HW].astype(np.float32)
rng = np.random.default_rng(7111)   # order 1 used 7112

d = Image.open(draft).convert("RGB")
sc = 1500 / 1632 * FINE
samples = []
for (x0, y0, x1, y1) in [(150, 150, 440, 950), (1192, 150, 1470, 950), (150, 1250, 440, 1950), (1192, 1250, 1470, 1950)]:   # draft 1 (green)
    s = np.asarray(d.crop((x0, y0, x1, y1)).resize((round((x1 - x0) * sc), round((y1 - y0) * sc)), Image.LANCZOS), np.float32)
    br = s[..., 2] - s[..., 0]
    e = br - gaussian_filter(br, 24 * FINE)               # the 24 px neighbourhood, at the sample's scale
    M = gaussian_filter(s, (24 * FINE, 24 * FINE, 0))
    k = 1 - FLECK * np.clip(e / 20, 0, 1)
    samples.append(M + (s - M) * k[..., None])
    samples.append(samples[-1][:, ::-1].copy())          # and its mirror image, so a knot does not repeat as often
mean_gold = np.concatenate([s.reshape(-1, 3) for s in samples]).mean(0)

def quilt(H, W):
    acc = np.zeros((H, W + 240, 3), np.float32); wsum = np.zeros((H, W + 240, 1), np.float32)
    x = 0
    while x < W + 60:
        s = samples[int(rng.integers(0, len(samples)))]
        SH, SW = s.shape[:2]
        w = int(rng.integers(30, 66)); sx = int(rng.integers(0, SW - w - 1))
        col = np.zeros((H, w, 3), np.float32); cw = np.zeros((H, 1, 1), np.float32)
        n = min(288, SH - 1)
        y = -int(rng.integers(0, 120))
        while y < H:
            sy = int(rng.integers(0, SH - n))
            seg = s[sy:sy + n, sx:sx + w]
            ramp = np.minimum(np.clip(np.arange(n) / 48, 0, 1), np.clip((n - 1 - np.arange(n)) / 48, 0, 1))[:, None, None]
            ya, yb = max(y, 0), min(y + n, H)
            col[ya:yb] += seg[ya - y:yb - y] * ramp[ya - y:yb - y]; cw[ya:yb] += ramp[ya - y:yb - y]
            y += n - 48
        col /= np.maximum(cw, 1e-3)
        hr = np.minimum(np.clip(np.arange(w) / 10, 0, 1), np.clip((w - 1 - np.arange(w)) / 10, 0, 1))[None, :, None] + 1e-3
        acc[:, x:x + w] += col * hr; wsum[:, x:x + w] += hr
        x += w - 10
    return (acc / np.maximum(wsum, 1e-3))[:, 30:30 + W]

T = quilt(HH, HW)
hf = T / np.maximum(gaussian_filter(T, (24, 24, 0)), 1)
hf = 1 + (hf - 1) * 0.85
inset_x = np.minimum(xx, HW - 1 - xx); inset_y = yy
side = inset_x < inset_y
flip = (xx >= HW / 2) & side & (inset_x < SWITCH)
hf_top = np.where(flip[..., None], hf[::-1, ::-1][:SEAM], hf[:SEAM])

def desat(c, k):
    y = lum(c)[..., None]
    return y + (c - y) * k
base = desat(mean_gold, 0.80); base = base * (160.0 / base.max())
r = np.hypot(xx - 750, yy - 1050)
glow = np.exp(-(r / 355.0) ** 2)
vign = 1 - 0.07 * ((xx - 750) / 750) ** 2 - 0.05 * ((yy - 1050) / 1050) ** 2
light = (1 + 0.30 * glow) * vign
def knee(v, k0=200.0, top=225.0):
    return np.where(v > k0, k0 + (top - k0) * np.tanh((v - k0) / (top - k0)), v)
gold = desat(hf_top * base, 0.92) * light[..., None]

tt = np.clip(np.minimum(inset_x, inset_y) / BEV, 0, 1)
profile = 0.86 + 0.20 * np.sin(np.pi * tt * 0.9)
facet = np.where(side, 0.94, 1.04)
mit = np.clip(1.3 - np.abs(inset_x - inset_y), 0, 1) * (np.minimum(inset_x, inset_y) < BEV)
bevel_col = gold / light[..., None] * (profile * facet * (1 - 0.22 * mit))[..., None] * (1 - 0.04 * ((yy - 1050) / 1050) ** 2)[..., None]
rule_col = np.array((30, 46, 40), np.float32)   # green's rule (grounds.py RULE_COL)
_unused = np.array((56, 30, 31), np.float32) * (0.92 + 0.08 * lum(hf_top))[..., None]
fil_col = gaussian_filter(gold, (3, 3, 0)) * 1.10
inset = np.minimum(inset_x, inset_y)
def ramp(v0, v1):
    return np.clip(np.minimum(inset - v0 + 0.5, v1 - inset + 0.5), 0, 1)
w_bev = ramp(-10, BEV); w_rule = ramp(BEV, RULE1); w_fil = ramp(RULE1, FIL1)

# the band's wood columns, found as lift.py finds them
row = lum(C[1000])
bx0 = 300
while row[bx0 - 1] < 100: bx0 -= 1
bx1 = 1200
while row[bx1] < 100: bx1 += 1
SH_, XF = 80, 20
def band_over(img):
    o = img.copy()
    B_ = C[TABLE:SEAM].copy()
    L0, R0 = bx0 + 8, bx1 - 8
    ext = np.zeros((SEAM - TABLE, HW, 3), np.float32)
    ext[:, L0 - SH_:L0 + XF] = B_[:, L0:L0 + SH_ + XF]
    ext[:, R0 - XF:R0 + SH_] = B_[:, R0 - XF - SH_:R0]
    w = np.zeros(HW, np.float32)
    w[:L0] = 1; w[L0:L0 + XF] = np.linspace(1, 0, XF)
    w[R0:] = 1; w[R0 - XF:R0] = np.linspace(0, 1, XF)
    band = B_ * (1 - w[None, :, None]) + ext * w[None, :, None]
    o[TABLE:SEAM, RULE1 - 2:HW - RULE1 + 2] = band[:, RULE1 - 2:HW - RULE1 + 2]
    return o

field_m = (yy < TABLE) & (inset >= FIL1)
fieldA = gold * (160.0 / gold.max(-1)[field_m].mean())
fieldA = knee(fieldA)
bevel_col = knee(bevel_col * 160.0 / bevel_col.max(-1)[(inset < BEV)].mean())
img = band_over(fieldA)
img = img * (1 - w_bev[..., None]) + bevel_col * w_bev[..., None]
img = img * (1 - w_rule[..., None]) + rule_col * w_rule[..., None]
img = img * (1 - w_fil[..., None]) + fil_col * w_fil[..., None]
top = np.round(np.clip(img, 0, 255)).astype(np.uint8)
Image.fromarray(top).save(f"{od}/groundA2-top.png")

# ---- measure, on the visible field of the mock (the figure excluded) and on the same region here
mock = np.asarray(Image.open(mockp).convert("RGB"), np.float32)[:SEAM]
reg = field_m & ((xx < 380) | (xx > 1120)) & (yy > 160)       # clear of the figure in both
def fleck(im):
    br = im[..., 2] - im[..., 0]
    e = br - gaussian_filter(br, 24)
    return float(np.maximum(e, 0)[reg].mean())
def streak(im):
    l = lum(im); h = l - gaussian_filter(l, 24)
    out = {}
    for ax, nm in ((1, "across (px)"), (0, "along (px)")):
        ac = []
        for lag in range(0, 80):
            a_ = np.roll(h, -lag, axis=ax)
            ac.append(float((h * a_)[reg].mean() / (h * h)[reg].mean()))
        i = next((i for i, v in enumerate(ac) if v < 0.5), 79)
        out[nm] = round(i - 1 + (ac[i - 1] - 0.5) / max(ac[i - 1] - ac[i], 1e-6), 2)   # interpolated
    return out
t32 = top.astype(np.float32)
rep = {"fleck_mean_positive_e": {"mock A": round(fleck(mock), 2), "A2": round(fleck(t32), 2)},
       "streak_autocorr_half_lag": {"mock A": streak(mock), "A2": streak(t32)},
       "field_brightest_channel_mean": {"mock A": round(float(mock.max(-1)[reg].mean()), 1), "A2": round(float(t32.max(-1)[reg].mean()), 1),
                                        "A2 whole field": round(float(t32.max(-1)[field_m].mean()), 1)},
       "field_channel_max": {"mock A": int(mock[reg].max()), "A2": int(t32[field_m].max())},
       "highpass_luma_std": {"mock A": round(float((lum(mock) - gaussian_filter(lum(mock), 24))[reg].std()), 2),
                             "A2": round(float((lum(t32) - gaussian_filter(lum(t32), 24))[reg].std()), 2)}}
def wavelength(im, ax):
    # the power-weighted mean wavelength (px) of the luminance across (ax 1) or along (ax 0) the streaks, over
    # wavelengths 2-24 px (the streaks and knots, not the light), in the two clear field panels (x 140-370 and 1130-1360, y 170-930)
    l = lum(im); out = []
    for x0 in (140, 1130):
        p_ = l[170:930, x0:x0 + 230]
        p_ = p_ - p_.mean(axis=ax, keepdims=True)
        F = np.abs(np.fft.rfft(p_, axis=ax)) ** 2
        f = np.fft.rfftfreq(p_.shape[ax])
        P = F.mean(axis=1 - ax)
        k = (f >= 1 / 24) & (f <= 0.5)
        out.append(float((P[k] / f[k]).sum() / P[k].sum()))
    return round(float(np.mean(out)), 2)
rep["mean_wavelength_px"] = {"mock A": {"across": wavelength(mock, 1), "along": wavelength(mock, 0)},
                             "A2": {"across": wavelength(t32, 1), "along": wavelength(t32, 0)}}
rep["fleck_ratio"] = round(rep["fleck_mean_positive_e"]["A2"] / rep["fleck_mean_positive_e"]["mock A"], 2)
json.dump(rep, open(f"{od}/groundA2-report.json", "w"), indent=1)
print(json.dumps(rep, indent=1))
