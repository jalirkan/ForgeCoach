# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, final: hand retouching in code over round 9's props finals (no model).
#   retouch.py <tag> <out.png>      (run in two-seats-work/final; writes the TOP half, 1500 x 1050, as float-safe PNG)
# A. the drawn lines below the hem (round 8's drawing, kept as dark lines by round 9's 0.55 paint) are lifted out and
#    replaced by a soft painted fold: the line's own darkness, spread by a gaussian and laid as a shade
# B. the hem: the cloak's tone is brought to the cape's across the seam and the cape's texture continued into the cloak
# The cape, hood and face are never written. Props, hands and fan are untouched here (see props.py).
import sys, json, numpy as np
from PIL import Image
from scipy.ndimage import (gaussian_filter, grey_closing, binary_dilation, binary_erosion, distance_transform_edt)
t, OUT = sys.argv[1], sys.argv[2]
P = json.load(open("tools/params.json"))[t]
N = {"green": "green-woman", "garnet": "garnet-man", "blue": "blue-man"}[t]
R9 = "/home/justin-a/code/fc-lanes/two-seats-r9/docs/proxies/cardback/two-seats/round9"
SEAM, HW, TABLE = 1050, 1500, 944
L = lambda p: np.asarray(Image.open(p).convert("RGB"), np.float32)
img = L(f"{R9}/two-seats-{N}-props.png")[:SEAM]
def lum(x): return x @ np.array([.2126, .7152, .0722], np.float32)
yy, xx = np.mgrid[0:SEAM, 0:HW]
face = ((xx - 750) / 115) ** 2 + ((yy - 405) / 145) ** 2 < 1.3
dm = np.asarray(Image.open(f"../round7/comp/dm-{t}.png").convert("L"), np.float32)[:SEAM] / 255
dm[((xx - 750) / 115) ** 2 + ((yy - 405) / 145) ** 2 < 1] = 0; dm[TABLE:] = 0
D = dm > 0.002
fig6 = np.asarray(Image.open(f"../round6/comp/figm-{t}.png").convert("L"))[:SEAM] > 8
HFm = np.maximum(np.asarray(Image.open(f"../round7/comp/m-hand-{t}.png").convert("L"))[:SEAM],
                 np.asarray(Image.open(f"../round7/comp/m-fan-{t}.png").convert("L"))[:SEAM]) > 8
HFd = binary_dilation(HFm, iterations=4)
pm8 = np.asarray(Image.open(f"../round8/final/two-seats-{N}-propmask.png").convert("L"))[:SEAM] > 0
PRd = binary_dilation(pm8, iterations=1)
nearPR = np.clip((distance_transform_edt(~pm8) - 1.5) / 3, 0, 1)   # lines fade out over 3 px at a prop
W = D & ~HFd & ~PRd                                   # where lines are lifted
# the fan's and hands' own cast shadow is painting, not drawing: lines fade out within 12 px of them
nearHF = np.clip((distance_transform_edt(~HFm) - 6) / 8, 0, 1)
from scipy.ndimage import binary_opening
C = binary_opening(fig6 & ~D, iterations=4) & ~face & (yy < 940)   # the cape and hood (no edge slivers): read, never written

def normconv(x, w, s):
    den = gaussian_filter(w.astype(np.float32), s) + 1e-6
    return np.stack([gaussian_filter(x[..., c] * w, s) / den for c in range(3)], -1)

out = img.copy()
# ---- A. the lines
lb = gaussian_filter(lum(img), 0.7)
r = P["close_r"]; fy, fx = np.mgrid[-r:r + 1, -r:r + 1]
d = grey_closing(lb, footprint=fx ** 2 + fy ** 2 <= r * r) - lb
M = np.clip((d - P["line_lo"]) / (P["line_hi"] - P["line_lo"]), 0, 1) * W * nearHF * nearPR
# and the light rims round 8 drew on the sleeve openings: thin LIGHT lines (luminance less its grey opening)
from scipy.ndimage import grey_opening
rb = P["bright_r"]; gy, gx = np.mgrid[-rb:rb + 1, -rb:rb + 1]
d2 = lb - grey_opening(lb, footprint=gx ** 2 + gy ** 2 <= rb * rb)
M2 = np.clip((d2 - P["bright_lo"]) / (P["bright_hi"] - P["bright_lo"]), 0, 1) * W * np.clip((distance_transform_edt(~HFm) - 4) / 3, 0, 1)
Mall = np.maximum(M, M2)
Ms = np.clip(np.maximum(Mall, gaussian_filter(Mall, 1.2) * 1.6), 0, 1) * W
INT = (dm > 0.95) & ~HFd & ~binary_dilation(pm8, iterations=3)
nb = normconv(img, (1 - Ms) * INT, P["nb_sigma"])     # the cloth beside the line (inside the silhouette only)
den = gaussian_filter(((1 - Ms) * INT).astype(np.float32), P["nb_sigma"])
Ms = Ms * np.clip(den / 0.25, 0, 1)                   # no fill where there is too little cloth beside it to borrow
img1 = img * (1 - Ms[..., None]) + nb * Ms[..., None]      # the texture is read from the cloth with the lines already out
hf = img1 - np.stack([gaussian_filter(img1[..., c], P["donor_sigma"]) for c in range(3)], -1)
best = None; donor = np.zeros_like(img)
for oy, ox in ((0, 7), (0, -7), (7, 0), (-7, 0), (0, 11), (0, -11), (0, 15), (0, -15), (12, 0), (-12, 0)):   # texture from beside the line
    mm = np.roll(Ms + (~INT) * 10.0, (oy, ox), (0, 1)); hh = np.roll(hf, (oy, ox), (0, 1))
    if best is None:
        best = mm.copy(); donor = hh.copy()
    else:
        b = mm < best; best = np.where(b, mm, best); donor = np.where(b[..., None], hh, donor)
# the texture is laid as a luminance ratio (the cloth's own hue kept), clipped so no stray dark can come across
tex = np.clip(lum(donor), -P["donor_clip"], P["donor_clip"]) * (best < 0.5)
fill = nb * (1 + tex / np.maximum(lum(nb), 10))[..., None]
out = out * (1 - Ms[..., None]) + fill * Ms[..., None]
# the fold: the line's own darkness, spread and laid as a soft shade (a painted fold, not a drawn one)
dist_out = distance_transform_edt(D)                  # distance from the silhouette / any edge of the region
edge_w = np.clip((dist_out - 3) / 10, 0, 1)           # no shade on the silhouette: the outline goes, no rim is drawn
shade = gaussian_filter(d * M, P["fold_sigma"]) * P["fold_k"] * edge_w * np.clip((distance_transform_edt(~pm8) - 3) / 12, 0, 1)
out = out * (1 - np.clip(shade / np.maximum(lum(nb), 8), 0, 0.45) * W)[..., None]

# ---- B. the hem (cloak side only)
lc = lum(img)
cm = img[(dm > 0.95) & ~HFd].mean(0); cm = cm / np.linalg.norm(cm)
cosv = (img @ cm) / (np.linalg.norm(img, axis=-1) + 1e-3)
Cuse = C & (cosv > P["cape_cos"]) & (img.max(-1) > 30)   # the cape's cloth (the cloak's own hue), not the neck-cloth
Cuse = binary_opening(Cuse, iterations=2)
dist, (iy, ix) = distance_transform_edt(~Cuse, return_indices=True)
dark = C & ~Cuse
ddark = distance_transform_edt(~dark) if dark.any() else np.full_like(dist, 1e9)
near = np.clip((ddark - dist) / 6, 0, 1)              # 0 where the nearest thing is the neck-cloth (a neckline stays)
cb = Cuse & (distance_transform_edt(~D) <= 28)
db = D & ~HFd & (dist <= 46)
capeLP = normconv(img, cb, P["hem_lp"]); cloakLP = normconv(out, db, P["hem_lp"])
WL, WT = P["hem_tone"], P["hem_tex"]
ramp = lambda x, w: 0.5 * (1 + np.cos(np.pi * np.clip(x / w, 0, 1)))
wl = ramp(dist, WL) * near * (D & ~HFd); wt = ramp(dist, WT) * near * (D & ~HFd)
wl = gaussian_filter(wl, 1.5) * D; wt = gaussian_filter(wt, 1.5) * D
delta = capeLP[iy, ix] - cloakLP
out = out + delta * wl[..., None]
# texture: the cape's high frequency, mirrored across the seam
ry = np.clip(2 * iy - yy, 0, SEAM - 1); rx = np.clip(2 * ix - xx, 0, HW - 1)
okm = Cuse[ry, rx]
ry = np.where(okm, ry, iy); rx = np.where(okm, rx, ix)
hfi = img - np.stack([gaussian_filter(img[..., c], P["hem_hf"]) for c in range(3)], -1)
hfo = out - np.stack([gaussian_filter(out[..., c], P["hem_hf"]) for c in range(3)], -1)
out = out + (hfi[ry, rx] - hfo) * wt[..., None]

# despeckle what was written: a pixel more than 9 levels off its 5 x 5 median takes the median
from scipy.ndimage import median_filter
wr = np.maximum(Ms, np.maximum(wl, wt)) > 0.02
med = np.stack([median_filter(out[..., c], size=5) for c in range(3)], -1)
spk = wr & (np.abs(lum(out) - lum(med)) > 9) & ~binary_dilation(HFm | pm8, iterations=2)
out[spk] = med[spk]
out = out + (np.clip(22.6 - lum(out), 0, None) * D)[..., None]       # no painted pixel darker than 22
out = np.where(D[..., None], out, img)
np.save(OUT.replace(".png", ".npy"), out); np.save(OUT.replace(".png", "-ms.npy"), np.maximum(Ms, np.maximum(wl, wt)).astype(np.float32))
Image.fromarray(np.round(np.clip(out, 0, 255)).astype(np.uint8)).save(OUT)
dbg = {"specks": int(spk.sum()), "lines_lifted_px": int((M > 0.5).sum()), "light_lines_px": int((M2 > 0.5).sum()), "hem_band_px": int((wl > 0.05).sum())}
print(t, dbg)
