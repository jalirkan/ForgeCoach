# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, order 1: the checks on the print file.   check1.py <order-1 dir>   (run in two-seats-work/order1)
# Writes work/check1.json and prints it.
import sys, os, json
import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter, gaussian_filter, binary_erosion, median_filter
OD = sys.argv[1]
REPO = "/home/justin-a/code/fc-lanes/two-seats-order1/docs/proxies/cardback/two-seats"
SEAM, HW, TABLE = 1050, 1500, 944
K = np.array([.2126, .7152, .0722], np.float32)
lum = lambda x: x.astype(np.float32) @ K
N = np.asarray(Image.open(f"{OD}/two-seats-garnet-man.png").convert("RGB"))
FIN = np.asarray(Image.open("work/final-lifted-garnet.png").convert("RGB"))          # the final, after its lift
MOCK = np.asarray(Image.open(f"{REPO}/grounds/A-garnet.png").convert("RGB"))
Z = np.load("work/lift-garnet.npz"); alpha = Z["alpha"]
yy, xx = np.mgrid[0:SEAM, 0:HW]
both = lambda m: np.concatenate([m, m[::-1, ::-1]], 0)
face = ((xx - 750) / 115) ** 2 + ((yy - 405) / 145) ** 2 < 1
dm = np.asarray(Image.open("../round7/comp/dm-garnet.png").convert("L"))[:SEAM] > 0
dm[face] = False; dm[TABLE:] = False
fig6 = np.asarray(Image.open("../round6/comp/figm-garnet.png").convert("L"))[:SEAM] > 8
hood = fig6 & ~dm & ~face & (yy < TABLE)
hand = np.asarray(Image.open("../round7/comp/m-hand-garnet.png").convert("L"))[:SEAM] > 8
fan = np.asarray(Image.open("../round7/comp/m-fan-garnet.png").convert("L"))[:SEAM] > 8
pm = np.asarray(Image.open("../round8/final/two-seats-garnet-man-propmask.png").convert("L"))[:SEAM] > 0
c = {}
c["size"] = list(N.shape[:2][::-1]); c["dpi"] = Image.open(f"{OD}/two-seats-garnet-man.png").info.get("dpi")
c["symmetry_180_exact"] = bool(np.array_equal(N, N[::-1, ::-1]))
A1 = alpha >= 1
same_fin = (N[:SEAM] == FIN[:SEAM]).all(-1)
c["face ellipse, figure pixels (alpha 1), identical to the final (%)"] = round(float(same_fin[face & A1].mean()) * 100, 4)
c["face ellipse, figure pixels (alpha 1) px"] = int((face & A1).sum())
c["hood and cape (alpha 1) identical to the final (%)"] = round(float(same_fin[hood & A1].mean()) * 100, 4)
c["hood and cape incl. matted edge identical to the grounds mock A (%)"] = round(float((N[:SEAM] == MOCK[:SEAM]).all(-1)[hood].mean()) * 100, 4)
c["props above the moulding (alpha 1) identical to the final (%)"] = round(float(same_fin[pm & A1 & (yy < TABLE)].mean()) * 100, 4)
c["band rows 944-1049 between x 230-1270 identical to the final (%)"] = round(float(same_fin[TABLE:, 230:1270].mean()) * 100, 4)
c["torso region (dm) changed from the final (%)"] = round(float((~same_fin)[dm].mean()) * 100, 2)
mock_same = (N == MOCK).all(-1)
c["whole card identical to the grounds mock A (%)"] = round(float(mock_same.mean()) * 100, 2)
L = lum(N); box = uniform_filter(L, 12)                            # 0.5 mm at 600 dpi = 11.8 px
c["darkest 0.5 mm area, whole card"] = round(float(box[6:-6, 6:-6].min()), 1)
c["darkest 0.5 mm area, 0.5th pct"] = round(float(np.percentile(box, 0.5)), 1)
c["darkest 0.5 mm area, painted torso"] = round(float(box[:SEAM][binary_erosion(dm, iterations=6)].min()), 1)
c["darkest single pixel (luma)"] = round(float(L.min()), 1)
c["0.5 mm blur (gaussian sigma 5.9 px), min"] = round(float(gaussian_filter(L, 5.9).min()), 1)
hsv = np.asarray(Image.fromarray(N).convert("HSV"), np.float32); sv = hsv[..., 1] * hsv[..., 2] / 255
c["saturation x value, 99.5th pct (whole card)"] = round(float(np.percentile(sv, 99.5)), 1)
c["saturation x value, 99.5th pct (painted torso)"] = round(float(np.percentile(sv[:SEAM][dm], 99.5)), 1)
c["saturation x value, max (painted torso)"] = round(float(sv[:SEAM][dm].max()), 1)
# the ground: the field (visible ground inside the fillet, above the band) and the whole ground incl. the frame
inset = np.minimum(np.minimum(xx, HW - 1 - xx), yy)
field = (alpha == 0) & (yy < TABLE) & (inset >= 127)
ground = (alpha == 0) & ((yy < TABLE) | (xx < 124) | (xx >= HW - 124))
V = N.max(-1)
c["field: brightest-channel mean"] = round(float(V[:SEAM][field].mean()), 1)
c["field: brightest channel max / 99.5th pct"] = [int(V[:SEAM][field].max()), round(float(np.percentile(V[:SEAM][field], 99.5)), 1)]
c["ground incl. frame: channel max"] = int(V[:SEAM][ground].max())
c["faces luma 99th pct"] = round(float(np.percentile(L[:SEAM][face], 99)), 1)
# crispness: band-pass luminance std (measure8's numbers), median over 16 px windows, flat parts only
def measure(img, region):
    l = lum(img)
    gm = np.hypot(*np.gradient(gaussian_filter(l, 1.5)))
    m = binary_erosion(region, iterations=6) & (gm[:SEAM] < 4 if gm.shape[0] > SEAM else gm < 4)
    r = {}
    for k, (s0, s1) in {"fine": (0, 1), "mid": (1, 3), "coarse": (3, 8)}.items():
        b = (gaussian_filter(l, s0) if s0 else l) - gaussian_filter(l, s1)
        r[k] = round(float(np.median(np.sqrt(uniform_filter(b * b, 16))[m])), 2)
    return r
hood_m = hood & ~(((xx - 750) / 115) ** 2 + ((yy - 405) / 145) ** 2 < 1.3) & (yy < 940)
cloth = dm & ~binary_erosion(hand | fan, iterations=-1) & ~(hand | fan)
c["texture: hood (unchanged)"] = measure(N[:SEAM], hood_m)
c["texture: painted torso cloth, this file"] = measure(N[:SEAM], cloth)
c["texture: torso cloth, the previous final"] = measure(FIN[:SEAM], cloth)
# edge sharpness: the luma gradient magnitude (no blur), its 50th / 90th / 99th percentiles, over the cloth and over
# the hands; the hood for reference (all unchanged pixels there)
def grad(img, m):
    g = np.hypot(*np.gradient(lum(img))); return [round(float(v), 2) for v in np.percentile(g[m], [50, 90, 99])]
hands_m = hand & dm
c["gradient p50/p90/p99: hood"] = grad(N[:SEAM], hood_m)
c["gradient p50/p90/p99: torso cloth, this file / before"] = [grad(N[:SEAM], cloth), grad(FIN[:SEAM], cloth)]
c["gradient p50/p90/p99: hands, this file / before"] = [grad(N[:SEAM], hands_m), grad(FIN[:SEAM], hands_m)]
# the cards: on the dark card faces (the 15 x 15 median under 100, inside the fan, 3 px clear of any lighter
# pixel), a speck brighter than its 9 x 9 median by more than 30 levels; a pip or a letter would be a cluster of them
from scipy.ndimage import label as _label, binary_dilation as _bd
Lt = L[:SEAM]
dark = fan & (median_filter(Lt, 15) < 100)
dark = binary_erosion(dark, iterations=3)
spk = dark & (Lt - median_filter(Lt, 9) > 30)
lab_, n_ = _label(_bd(spk, iterations=1))
c["cards: dark card-face px checked"] = int(dark.sum())
c["cards: bright specks on the faces (clusters, px)"] = [int(n_), int(spk.sum())]
c["png bytes"] = os.path.getsize(f"{OD}/two-seats-garnet-man.png"); c["jpg bytes"] = os.path.getsize(f"{OD}/two-seats-garnet-man.jpg")
ji = Image.open(f"{OD}/two-seats-garnet-man.jpg"); c["jpg dpi"] = ji.info.get("dpi"); c["jpg size"] = list(ji.size)
# margins (nearest edge of the top seat; the bottom seat is the same turned)
mg = {}
ys, xs = np.nonzero(alpha > 0.5)
mg["figure: hood top"] = int(ys.min()); mg["figure: left / right side"] = [int(xs.min()), int(HW - 1 - xs.max())]
for k, m in (("hands", hand), ("fan of cards", fan)):
    ys, xs = np.nonzero(m); mg[k + " (left, top, right)"] = [int(xs.min()), int(ys.min()), int(HW - 1 - xs.max())]
ys, xs = np.nonzero(pm[:, :750]); mg["tankard and its ring (left prop), from the left edge"] = int(xs.min())
ys, xs = np.nonzero(pm[:, 750:]); mg["napkin and coin (right prop), from the right edge"] = int(HW - 1 - (xs.max() + 750))
mg["lamp and glow (160 px disc on the centre line)"] = 590
mg["band wood (runs under the rule)"] = 124
mg["moulding bevel / dark rule / fillet"] = "0-112 / 112-124 / 124-127"
c["margins px"] = mg
json.dump(c, open("work/check1.json", "w"), indent=1)
print(json.dumps(c, indent=1))
