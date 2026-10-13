# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, order 1: the garnet man's torso rebuilt ONCE from one painted img2img pass, pasted into the final.
#   torso1.py <painted torso.png> <out.png> [--no-hem]      (run in two-seats-work/order1)
# Input card: the final BEFORE its black-point lift (fc-lanes two-seats-final, commit c9022be), top half; the lift is
# applied once, to the whole card, after the ground (lift1.py). Post-work, and nothing else:
#  1. The painted torso box (x 384-1128, y 480-960; painted at 1216 x 784) goes in through round 7's drawn mask
#     (dm-garnet, its own antialiased alpha) less round 6's face ellipse and every row from the moulding (y 944) down:
#     the torso below the hood's shoulder-cape hem, the arms, cuffs, hands and fan. The hood, the cape and the face
#     are not written (asserted byte-identical).
#  2. The props stay the final's painted props: the final's pixels inside round 8's prop mask (dilated 2 px,
#     feathered 1 px) are laid back over the torso where an upright prop stands in front of the cloak (y < 944).
#  3. The hem, only if a step shows: the low-frequency lightness (normalised gaussian, sigma 10 px) of the cape in a
#     12 px ring above the seam and of the painted cloth 4-14 px below it are compared; where the median step is over
#     4 levels the painted side's lightness is brought to the cape's at the seam, fading out by a cosine over 24 px
#     below it. Equal on all three channels (a lightness change, no hue). The cape is never written.
# NO blur, NO grain, NO texture matching, NO unifying pass.
import sys, json, argparse
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, binary_dilation, distance_transform_edt

ap = argparse.ArgumentParser(); ap.add_argument("torso"); ap.add_argument("out"); ap.add_argument("--no-hem", action="store_true")
a = ap.parse_args()
SEAM, HW, TABLE = 1050, 1500, 944
TORSO = (384, 480, 1128, 960)
U = np.asarray(Image.open("work/final-unlifted-garnet.png").convert("RGB"), np.float32)[:SEAM]
yy, xx = np.mgrid[0:SEAM, 0:HW]
face = ((xx - 750) / 115) ** 2 + ((yy - 405) / 145) ** 2 < 1
dm = np.asarray(Image.open("../round7/comp/dm-garnet.png").convert("L"), np.float32)[:SEAM] / 255
dm[face] = 0; dm[TABLE:] = 0
x0, y0, x1, y1 = TORSO
box = np.zeros((SEAM, HW), np.float32); box[y0:y1, x0:x1] = 1
p = np.asarray(Image.open(a.torso).convert("RGB").resize((x1 - x0, y1 - y0), Image.LANCZOS), np.float32)
full = U.copy(); full[y0:y1, x0:x1] = p
# where the painting pulled the cloak's silhouette in and painted gold ground inside the drawn mask (a few px along
# the outer sleeves), the final's own cloak pixels stay: gold-hued painted pixels within 30 px of the silhouette's
# outer edge (never the cards, which are far inside) are left out of the paste, grown 2 px and feathered 1.5 px.
hsv = np.asarray(Image.fromarray(np.clip(full, 0, 255).astype(np.uint8)).convert("HSV"), np.float32)
Hh, Ss, Vv = hsv[..., 0] * 360 / 255, hsv[..., 1] / 255, hsv[..., 2] / 255
gold = (Hh > 22) & (Hh < 70) & (Ss > 0.22) & (Vv > 0.42)
outer = distance_transform_edt(dm > 0.002) <= 30
excl = binary_dilation(gold & outer & (dm > 0.002), iterations=2) & outer
keep = 1 - np.clip(gaussian_filter(excl.astype(np.float32), 1.5) * 1.5, 0, 1) * outer
al = (dm * box * keep)[..., None]
h = U * (1 - al) + full * al
# 2. the final's props over the torso
pm = np.asarray(Image.open("../round8/final/two-seats-garnet-man-propmask.png").convert("L"))[:SEAM] > 0
pa = np.clip(gaussian_filter(binary_dilation(pm, iterations=2).astype(np.float32), 1.0) * 1.5, 0, 1)
pa *= binary_dilation(pm, iterations=3); pa[TABLE:] = 0
h = h * (1 - pa[..., None]) + U * pa[..., None]
# 3. the hem
fig6 = np.asarray(Image.open("../round6/comp/figm-garnet.png").convert("L"))[:SEAM] > 8
D = dm > 0.002
# the cape is the hood's cloth only: round 6's figure mask also covers slivers of gold ground beside round 7's
# narrower sleeves, so gold-hued pixels of the final are not cape
uh = np.asarray(Image.fromarray(U.astype(np.uint8)).convert("HSV"), np.float32)
ugold = (uh[..., 0] * 360 / 255 > 22) & (uh[..., 0] * 360 / 255 < 70) & (uh[..., 1] > 0.22 * 255) & (uh[..., 2] > 0.42 * 255)
cape = fig6 & ~D & ~face & (yy < TABLE) & ~binary_dilation(ugold, iterations=3)
dcape = distance_transform_edt(~cape)                    # px from the cape
dpaint = distance_transform_edt(~D)
L = h @ np.array([.2126, .7152, .0722], np.float32)
def nlp(m, s=10):
    return gaussian_filter(L * m, s) / np.maximum(gaussian_filter(m.astype(np.float32), s), 1e-4)
ringc = cape & (dpaint <= 12) & (yy > 480)
ringp = D & (dcape >= 4) & (dcape <= 14) & (dm > 0.99)
step = nlp(ringp) - nlp(ringc)                          # painted minus cape, low frequency
seam = D & (dcape <= 2) & (yy > 480)
rep = {"torso": a.torso, "edge_gold_left_out_px": int(excl.sum()), "hem_step_median": round(float(np.median(step[seam])), 2),
       "hem_step_p10_p90": [round(float(np.percentile(step[seam], 10)), 2), round(float(np.percentile(step[seam], 90)), 2)]}
HEM = 24
if not a.no_hem and abs(rep["hem_step_median"]) > 4:
    w = np.where(D & (dcape <= HEM), 0.5 * (1 + np.cos(np.pi * np.clip(dcape - 1, 0, HEM) / HEM)), 0) * dm
    h = h - (step * w)[..., None]
    rep["hem_blend"] = f"applied, {HEM} px cosine"
else:
    rep["hem_blend"] = "not applied"
h = np.where((al > 0) | (pa[..., None] > 0), h, U)
top = np.round(np.clip(h, 0, 255)).astype(np.uint8)
assert (top[face] == U[face].astype(np.uint8)).all() and (top[cape] == U[cape].astype(np.uint8)).all()
rep["written_px"] = int((top != U.astype(np.uint8)).any(-1).sum())
out = np.concatenate([top, top[::-1, ::-1]], 0)
Image.fromarray(out).save(a.out)
print(json.dumps(rep))
json.dump(rep, open(a.out.replace(".png", "-report.json"), "w"), indent=1)
