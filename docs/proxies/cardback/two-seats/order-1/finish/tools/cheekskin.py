# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, order 1, finish 2: the cool grey left on his cheek by the draft's blue-green smear, warmed toward the
# cheek's own skin (the owner: "fix ... the cheek").   cheekskin.py <top.png> <out top.png>  (in two-seats-work/order1/finish)
# Lightness is kept, so every form, line and shadow of the face stays the pick's; only the chroma moves. The face's
# skin (hue 12-50 deg, sat >= 0.12, L* >= 22, inside the face oval, eyes, brows, mouth and the patch excluded) gives
# a* and b* as a quadratic in L*. Inside the drawn patch (PATCH: the cheek from the nose to the face's right edge, the
# right eye excluded, feathered 1.5 px) a pixel whose b* falls short of that prediction by more than 3 is pulled toward
# the predicted (a*, b*) at its own L*, fully at a shortfall of 13. Pixels darker than L* 22 (the hood's black at the
# face's edge) are left.
import sys, json
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
from skinlib import hsv, rgb2lab, lab2rgb, drawn, FACE
PATCH = {"poly": [[[748, 390], [790, 393], [806, 380], [812, 382], [811, 420], [806, 446], [802, 462], [794, 486], [752, 486], [743, 456], [745, 420]]],
         "minus_ellipse": [[755, 366, 808, 403]]}
src, out = sys.argv[1:3]
top = np.asarray(Image.open(src).convert("RGB"))
Lab = rgb2lab(top); L, A, B = Lab[..., 0], Lab[..., 1], Lab[..., 2]
h, s, v = hsv(top)
patch = drawn(PATCH)
ref = drawn(FACE) & ~patch & (h >= 12) & (h <= 50) & (s >= .12) & (L >= 22)
pa = np.polyfit(L[ref], A[ref], 2); pb = np.polyfit(L[ref], B[ref], 2)
ta, tb = np.polyval(pa, L), np.polyval(pb, L)
short = tb - B
w = np.clip((short - 3) / 10, 0, 1) * (L >= 22)
feather = gaussian_filter(patch.astype(np.float64), 1.5)
w = np.clip(gaussian_filter(w * patch, 1.0), 0, 1) * np.clip(feather * 1.0, 0, 1)
N = Lab.copy(); N[..., 1] = A + (ta - A) * w; N[..., 2] = B + (tb - B) * w
res = np.round(np.clip(top * (1 - (w > 0)[..., None]) + lab2rgb(N) * (w > 0)[..., None], 0, 255)).astype(np.uint8)
Image.fromarray(res).save(out)
P = patch & (L >= 22)
q = lambda im: {k: round(float(x[P].mean()), 2) for k, x in zip("Lab", np.moveaxis(rgb2lab(im), -1, 0))}
print(json.dumps({"changed px": int((res != top).any(-1).sum()), "patch px": int(P.sum()), "patch before": q(top), "patch after": q(res),
                  "max weight": round(float(w.max()), 2), "fit b(L)": [round(float(c), 4) for c in pb]}))
