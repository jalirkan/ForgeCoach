# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 9: put the painted torso (and, for version A, the painted props) into round 8's card.
#   compose9.py <tag> <torso.png> <out-prefix> [--hands hands.png] [--prop-L p.png] [--prop-R p.png]
#               [--blur S] [--grain GF GM] [--fit]
# Works on the top half (1500 x 1050); the bottom seat is the top half turned 180 degrees.
#  - The torso mask is round 7's drawn mask (dm-<tag>) less round 6's face ellipse and every row from the moulding
#    (y 944) down: the torso below the hood's shoulder-cape hem, the arms, cuffs, hands and fan. Inside it the
#    painted torso box (x 384-1128, y 480-960) is laid with dm's own antialiased alpha.
#  - --hands: a painted 2x hands-and-fan box (HANDS, below) laid inside the torso mask with a 10 px feather.
#  - The face-matching pass: inside the painted region only, a gaussian blur of S px and an even luminance grain:
#    GF levels of a fine grain (sigma 0.6) and GM of a brush streak down the folds (sigma 2.6 px along y, 1.4 across), seed 9109. --fit searches S, GF and GM for the closest match of the
#    fine and mid band-pass numbers to the painted hood's, and prints the table.
#  - Version B (no props): the table band is round 2's pixels (== round 8's outside its props).
#  - Version A (props): the painted prop boxes (x 360-600 / 900-1140, y 880-1040) laid inside round 8's prop mask
#    (the props' bodies, and their painted shadows laid as a shade on round 2's band; see below), over version B.
# Faces, hoods, the gold, the border, the lamp and the band outside the props are asserted byte-identical.
import sys, argparse, json
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, uniform_filter, binary_erosion, binary_dilation

ap = argparse.ArgumentParser()
ap.add_argument("tag"); ap.add_argument("torso"); ap.add_argument("out")
ap.add_argument("--hands"); ap.add_argument("--prop-L"); ap.add_argument("--prop-R")
ap.add_argument("--blur", type=float, default=0.0); ap.add_argument("--grain", type=float, nargs=2, default=(0.0, 0.0))
ap.add_argument("--fit", action="store_true")
a = ap.parse_args()
NAMES = {"green": "green-woman", "garnet": "garnet-man", "blue": "blue-man"}
R2 = {"green": "two-seats-green-woman", "garnet": "two-seats-garnet-man", "blue": "two-seats-blue-figure"}
REPO = "/home/justin-a/code/fc-lanes/two-seats-r9/docs/proxies/cardback/two-seats"
HW, SEAM, TABLE = 1500, 1050, 944
TORSO = (384, 480, 1128, 960)
HANDS = {"green": (560, 640, 944, 936), "garnet": (560, 640, 944, 936), "blue": (560, 640, 944, 936)}
PROPB = {"L": (360, 880, 600, 1040), "R": (900, 880, 1140, 1040)}
t, n = a.tag, NAMES[a.tag]
L = lambda p: np.asarray(Image.open(p).convert("RGB"), np.float32)
r8 = L(f"../round8/final/two-seats-{n}.png")
guide = L(f"comp/np-{t}.png")[:SEAM]
r2 = L(f"{REPO}/round2/{R2[t]}.png")
yy, xx = np.mgrid[0:SEAM, 0:HW]
face = ((xx - 750) / 115) ** 2 + ((yy - 405) / 145) ** 2 < 1
dm = np.asarray(Image.open(f"../round7/comp/dm-{t}.png").convert("L"), np.float32)[:SEAM] / 255
dm[face] = 0; dm[TABLE:] = 0
D = dm > 0.002
fig6 = np.asarray(Image.open(f"../round6/comp/figm-{t}.png").convert("L"))[:SEAM] > 8
pm8 = np.asarray(Image.open(f"../round8/final/two-seats-{n}-propmask.png").convert("L"), np.float32)[:SEAM] / 255

def lay_box(img, src, box, alpha):
    x0, y0, x1, y1 = box
    p = np.asarray(Image.open(src).convert("RGB").resize((x1 - x0, y1 - y0), Image.LANCZOS), np.float32)
    full = img.copy(); full[y0:y1, x0:x1] = p
    al = alpha[..., None]
    return img * (1 - al) + full * al

def boxmask(box, feather=0):
    m = np.zeros((SEAM, HW), np.float32); x0, y0, x1, y1 = box; m[y0:y1, x0:x1] = 1
    if feather:
        yy_, xx_ = np.mgrid[0:y1 - y0, 0:x1 - x0].astype(np.float32)
        m[y0:y1, x0:x1] = np.clip(np.minimum.reduce([xx_, yy_, x1 - x0 - 1 - xx_, y1 - y0 - 1 - yy_]) / feather, 0, 1)
    return m

# ---- version B: the painted torso
h = lay_box(guide, a.torso, TORSO, dm * boxmask(TORSO))
if a.hands:
    h = lay_box(h, a.hands, HANDS[t], dm * boxmask(HANDS[t], 10))

# ---- the texture numbers (measure8's: band-pass luminance std, median over 16 px windows, flat parts only)
hood = fig6 & ~D & ~(((xx - 750) / 115) ** 2 + ((yy - 405) / 145) ** 2 < 1.3) & (yy < 940)
BANDS = {"fine": (0, 1), "mid": (1, 3), "coarse": (3, 8)}
def lum(x): return 0.2126 * x[..., 0] + 0.7152 * x[..., 1] + 0.0722 * x[..., 2]
def flatmask(img, region):
    gm = np.hypot(*np.gradient(gaussian_filter(lum(img), 1.5)))
    return binary_erosion(region, iterations=6) & (gm < 4)
def measure(img, region, m=None):
    l = lum(img)
    if m is None:
        m = flatmask(img, region)        # measure8's rule; the painted region's mask is fixed before the pass
    r = {}
    for k, (s0, s1) in BANDS.items():
        b = (gaussian_filter(l, s0) if s0 else l) - gaussian_filter(l, s1)
        r[k] = float(np.median(np.sqrt(uniform_filter(b * b, 16))[m]))
    return r
rng = np.random.default_rng(9109)
def unit(s):
    q = gaussian_filter(rng.normal(0, 1, (SEAM, HW)), s); return q / q.std()
# a painted tooth rather than a paper one: a fine grain, a brush streak running down the folds (sigma 3.5 px along
# y, 0.9 px across) and a broader mottle, each at unit deviation, mixed and renormalised
TF = unit(0.6)                                      # the fine grain
TM = unit((2.6, 1.4))                               # the brush streak, down the folds
# the hands and the cards take the blur and the fine grain only, never the streak (it read as sandpaper on them)
HF = np.maximum(np.asarray(Image.open(f"../round7/comp/m-hand-{t}.png").convert("L"), np.float32)[:SEAM],
                np.asarray(Image.open(f"../round7/comp/m-fan-{t}.png").convert("L"), np.float32)[:SEAM]) / 255
HF = np.clip(gaussian_filter(binary_dilation(HF > 0.03, iterations=3).astype(np.float32), 1.5), 0, 1)
def finish(img, region, blur, gf, gm=None):
    if gm is None:
        gf, gm = gf if isinstance(gf, tuple) else (gf, gf)
    out = img.copy()
    if blur > 0:
        out = np.stack([gaussian_filter(img[..., c], blur) for c in range(3)], -1)
    out = out + (gf * TF + gm * TM * (1 - HF))[..., None]
    w = region[..., None]
    return img * (1 - w) + out * w

PAINT = dm.copy()                                  # where the face-matching pass applies (soft at dm's edge)
H_hood = measure(h, hood)
FM = flatmask(h, D & (yy < 940))          # the flat parts, chosen before any grain (grain must not move them)
before = measure(h, None, FM)
blur, grain = a.blur, tuple(a.grain)
if a.fit:
    best = None
    for b_ in (0.0, 0.35, 0.6, 0.8):
        for gf in (0.0, 0.5, 1.0, 1.5, 2.0):
            for gm in (0.0, 0.5, 1.0, 1.5, 2.0, 2.5):     # capped: above 2.5 the cloth reads as fur
                m_ = measure(finish(h, PAINT, b_, gf, gm), None, FM)
                err = abs(np.log(m_["fine"] / H_hood["fine"])) + abs(np.log(m_["mid"] / H_hood["mid"]))
                if best is None or err < best[0]:
                    best = (err, b_, (gf, gm))
    _, blur, grain = best
grain = grain if isinstance(grain, tuple) else (grain, grain)
h = finish(h, PAINT, blur, *grain)
after = measure(h, None, FM)
l = lum(h)
h = h + (np.clip(22.6 - l, 0, None) * D)[..., None]            # no painted pixel darker than 22
h = np.where(D[..., None], h, guide)
hB = h.copy()

# ---- version A: the painted props over B
pmask = binary_dilation(pm8 > 0.002, iterations=2).astype(np.float32)
pmask = np.maximum(gaussian_filter(pmask, 1.5), pm8) * binary_dilation(pm8 > 0.002, iterations=4)
hA = None
if a.prop_L or a.prop_R:
    hA = hB.copy()
    # the robe under an upright prop is the painted torso; the props are laid over it
    # Two parts, so the painted wood never shows as a patch: (1) the props' BODIES are the painted layer, inside
    # round 8's body mask (its prop mask less its flat shadows) dilated 2 px and feathered; (2) the SHADOWS are
    # the painted layer's own darkening of the wood, measured against the card and laid on round 2's band as a
    # multiplicative shade (never lighter, at most 60% dark), inside the prop mask dilated 6 px and feathered, so
    # round 2's grain runs through them. Before either, the painted layer's tone is matched to the card in a 14 px
    # ring outside the mask (the difference spread inward by a normalised gaussian, sigma 10 px).
    r8t = r8[:SEAM]; r2t = r2[:SEAM]
    with np.errstate(divide="ignore", invalid="ignore"):
        rat = np.where(r2t > 8, r8t / np.maximum(r2t, 1), 0)
    flat_shadow = (rat.std(-1) < 0.025) & (rat.mean(-1) < 0.999) & (rat.mean(-1) > 0.55) & (yy >= 957)
    bodym = (pm8 > 0.002) & ~flat_shadow
    bodym = binary_dilation(bodym, iterations=1) & (pm8 > 0.002)
    BA = np.clip(gaussian_filter(binary_dilation(bodym, iterations=2).astype(np.float32), 1.0) * 1.6, 0, 1)
    BA = BA * binary_dilation(bodym, iterations=4)
    SA = np.clip(gaussian_filter(binary_dilation(pm8 > 0.002, iterations=6).astype(np.float32), 3.0) * 1.4, 0, 1)
    ring = binary_dilation(pm8 > 0.002, iterations=16) & ~binary_dilation(pm8 > 0.002, iterations=4)
    play = hB.copy(); shade = np.ones((SEAM, HW), np.float32)
    for s, src in (("L", a.prop_L), ("R", a.prop_R)):
        if src:
            x0, y0, x1, y1 = PROPB[s]
            p = np.asarray(Image.open(src).convert("RGB").resize((x1 - x0, y1 - y0), Image.LANCZOS), np.float32)
            w = ring[y0:y1, x0:x1].astype(np.float32)
            diff = hB[y0:y1, x0:x1] - p
            den = gaussian_filter(w, 10) + 1e-6
            p = p + np.stack([gaussian_filter(diff[..., c] * w, 10) / den for c in range(3)], -1)
            play[y0:y1, x0:x1] = p
            sh = gaussian_filter(lum(p), 1.5) / np.maximum(gaussian_filter(lum(hB[y0:y1, x0:x1]), 1.5), 1)
            shade[y0:y1, x0:x1] = np.clip(sh, 0.4, 1.0)
    shade = 1 - (1 - shade) * SA * (yy >= 950)
    hA = hB * shade[..., None]
    hA = hA * (1 - BA[..., None]) + play * BA[..., None]
    pmask = np.maximum(SA * (yy >= 950), BA)
    PM = pmask > 0
    hA = finish(hA, BA, blur, *grain)       # the same face-matching pass on the props' bodies
    la = lum(hA)
    hA = hA + (np.clip(22.6 - la, 0, None) * PM)[..., None]
    hA = np.where(PM[..., None], hA, hB)

def save(top, path):
    top = np.round(np.clip(top, 0, 255))
    full = np.concatenate([top, top[::-1, ::-1]], 0).astype(np.uint8)
    assert np.array_equal(full, full[::-1, ::-1])
    im = Image.fromarray(full); im.save(path + ".png", dpi=(600, 600))
    im.save(path + ".jpg", quality=95, dpi=(600, 600), subsampling=0)
    return full.astype(np.float32)

def both(m): m = m[:SEAM]; return np.concatenate([m, m[::-1, ::-1]], 0)
inner = np.zeros((SEAM, HW), bool); inner[210:, 222:1278] = True
fy, fx = np.mgrid[0:2100, 0:HW]
lamp = ((fx - 750) ** 2 + (fy - 1050) ** 2) < 160 ** 2
report = {"tag": t, "blur": blur, "grain": grain, "hood": H_hood, "painted_before": before, "painted_after": after, "checks": {}}
for ver, top in (("noprops", hB), ("props", hA)):
    if top is None:
        continue
    full = save(top, f"{a.out}-{ver}")
    same8 = np.abs(full - r8).max(-1) == 0
    same2 = np.abs(full - r2).max(-1) == 0
    PMb = both(pmask > 0) if ver == "props" else np.zeros((2100, HW), bool)
    fig7 = fig6.copy(); fig7[TABLE:] = False
    reg = {
        "faces": (both(face), same8),
        "hoods and shoulder capes": (both(fig7 & ~D & ~face) & ~PMb, same8),
        "gold field outside the figure": (both(inner & ~binary_dilation(fig7 | D, iterations=12) & (yy < TABLE)) & ~PMb, same8),
        "border and frame": (both(~inner & (yy < TABLE)), same8),
        "lamp and glow": (lamp & ~both(D) & ~PMb, same8),
        "table band outside the props (vs round 2)": (both(yy >= TABLE) & ~PMb & ~lamp, same2),
        "painted region (changed on purpose)": (both(D), same8),
    }
    la = lum(full); big = gaussian_filter(la, 12)
    hsv = np.asarray(Image.fromarray(full.astype(np.uint8)).convert("HSV"), np.float32)
    c = {k: float(s[m].mean()) for k, (m, s) in reg.items()}
    c["dark0.5"] = float(np.percentile(big, 0.5)); c["min_lum_painted"] = float(la[both(D) | PMb].min())
    c["sat99.5"] = float(np.percentile(hsv[..., 1] * (hsv[..., 2] / 255), 99.5))
    c["all_vs_r8"] = float(same8.mean())
    report["checks"][ver] = c
print(json.dumps(report, indent=1))
json.dump(report, open(a.out + "-report.json", "w"), indent=1)
