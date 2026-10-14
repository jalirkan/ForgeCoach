# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, order 1, finish 2: the hands' skin brought to the face's (the owner: "fix the hands colour").
#   handskin.py <top.png> <out top.png> [std weight a,b (default 1)] (run in two-seats-work/order1/finish)
# A per-channel mean/std match in CIE Lab: the hands' LIT skin statistics (skinlib.masks) are matched to the face's,
# L, a and b each  x' = mu_face + (x - mu_hands) * k * sd_face / sd_hands + (1 - k) * (x - mu_hands)  -- k is the std
# weight, 1 for L. The transform is applied to every skin pixel of the hands (the shadows between the fingers too),
# with a soft alpha: inside finish 1's hands region, hue 12-50 deg (ramped 8-12 and 50-56), sat ramped 0.15-0.25 and
# value ramped 0.24-0.32 (so the near-black cards and the red robe are untouched), and only within 3 px of the lit
# skin opened by a 5 px square (so the cards' thin gilt edges and the sleeves' cuffs are untouched); softened by a
# 1 px gaussian.
# No shape change, no repaint: only the colour of pixels already skin.
import sys, json
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, binary_opening, binary_dilation
from skinlib import masks, stats, hsv, rgb2lab, lab2rgb
src, out = sys.argv[1:3]; k = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
top = np.asarray(Image.open(src).convert("RGB"))
face, hands, area = masks(top)
h, s, v = hsv(top)
ramp = lambda x, a, b: np.clip((x - a) / (b - a), 0, 1)
alpha = area * ramp(h, 8, 12) * (1 - ramp(h, 50, 56)) * ramp(s, .15, .25) * ramp(v, .24, .32)
near = binary_dilation(binary_opening(hands, np.ones((5, 5), bool)), iterations=3)
alpha = np.clip(gaussian_filter((alpha * near).astype(np.float64), 1.0), 0, 1) * area
Lab = rgb2lab(top); N = Lab.copy()
for c, kc in ((0, 1.0), (1, k), (2, k)):
    mf, sf = Lab[..., c][face].mean(), Lab[..., c][face].std()
    mh, sh = Lab[..., c][hands].mean(), Lab[..., c][hands].std()
    d = Lab[..., c] - mh
    N[..., c] = mf + d * (kc * sf / sh + (1 - kc))
rgb = lab2rgb(N)
res = top * (1 - alpha[..., None]) + rgb * alpha[..., None]
res = np.round(np.clip(res, 0, 255)).astype(np.uint8)
Image.fromarray(res).save(out)
print(json.dumps({"k": k, "changed px": int((res != top).any(-1).sum()), "before": {"face": stats(top, face), "hands": stats(top, hands)},
                  "after hands": stats(res, hands)}))
