# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 5: cut a round-4 court-card figure (its hooded cloak and face) out of its own gold.
#   cutout.py <round4-final.png> <1|2|3> <out-mask.png> <look.jpg>
# OpenCV's GrabCut on the top seat, seeded: the gold (hue 18-50 deg, saturated, light) outside the cloak's reach
# is certain background, the face and the cloak's core are certain figure, the rest is probable. Above the
# drafts' table (y 950 of 1050) only; the mask is the largest component, holes filled, edge eased 1 px.
import sys
import numpy as np
import cv2
from PIL import Image
from scipy.ndimage import binary_fill_holes, label, binary_erosion, gaussian_filter, binary_opening

src, n, out, look = sys.argv[1:5]
a = np.asarray(Image.open(src).convert("RGB"))[:1050]
H, W = a.shape[:2]
yy, xx = np.mgrid[0:H, 0:W]
hsv = np.asarray(Image.fromarray(a).convert("HSV"), np.float32)
Hd, S, V = hsv[..., 0] * 360 / 255, hsv[..., 1] / 255, hsv[..., 2] / 255
gold = (Hd > 18) & (Hd < 52) & (S > 0.35) & (V > 0.42)
gm = cv2.GC_PR_BGD * np.ones((H, W), np.uint8)
reach = (np.abs(xx - 750) < 420) & (yy > 120) & (yy < 955)
gm[~reach] = cv2.GC_BGD
gm[reach & ~gold] = cv2.GC_PR_FGD
# certain figure: the face and hood round it, and the cloak's core above the table
core = (((xx - 750) / 95) ** 2 + ((yy - 340) / 130) ** 2 < 1) | ((np.abs(xx - 750) < 140) & (yy > 480) & (yy < 940)) \
    | ((np.abs(xx - 750) < 230) & (yy > 640) & (yy < 940))
gm[core] = cv2.GC_FGD
# certain gold: the field well outside the cloak
far = (np.abs(xx - 750) > 380) | ((np.abs(xx - 750) > 190) & (yy < 330))
gm[reach & gold & far] = cv2.GC_BGD
bg = np.zeros((1, 65), np.float64); fg = np.zeros((1, 65), np.float64)
img = cv2.cvtColor(a, cv2.COLOR_RGB2BGR)
cv2.grabCut(img, gm, None, bg, fg, 6, cv2.GC_INIT_WITH_MASK)
m = (gm == cv2.GC_FGD) | (gm == cv2.GC_PR_FGD)
m &= yy < 952
m = binary_opening(m, iterations=2)
m = binary_opening(m, structure=np.ones((1, 19), bool))   # the frame's thin vertical rules (draft 2) go
lab, k = label(m)
if k > 1:
    sizes = np.bincount(lab.ravel()); sizes[0] = 0
    m = lab == sizes.argmax()
m = binary_fill_holes(m)
m = binary_erosion(m, iterations=1)
Image.fromarray((m * 255).astype(np.uint8)).save(out)
v = a.astype(np.float32) * 0.35 + a.astype(np.float32) * 0.65 * m[..., None]
v[m ^ binary_erosion(m, iterations=2)] = (255, 0, 255)
Image.fromarray(v.astype(np.uint8)[:, 250:1250]).resize((500, 525)).save(look)
print(n, int(m.sum()))
