# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, order 1 revision: how much of round 8's drawn fold lines each robe candidate keeps, and how far its fills moved.
#   robe1.py <candidate.png>...      (run in two-seats-work/order1; torso coords, 1216 x 784)

import sys, json, numpy as np
from PIL import Image
from scipy.ndimage import median_filter, binary_dilation, uniform_filter, gaussian_filter
K = np.array([.2126, .7152, .0722], np.float32)
L = lambda f: np.asarray(Image.open(f).convert("RGB"), np.float32) @ K
src = L("comp/torso-in-garnet.png")
dm = np.asarray(Image.open("../round7/comp/dm-garnet.png").convert("L").crop((384, 480, 1128, 960)).resize((1216, 784), Image.BILINEAR)) > 250
hand = np.asarray(Image.open("../round7/comp/m-hand-garnet.png").convert("L").crop((384, 480, 1128, 960)).resize((1216, 784))) > 8
fan = np.asarray(Image.open("../round7/comp/m-fan-garnet.png").convert("L").crop((384, 480, 1128, 960)).resize((1216, 784))) > 8
cloth = dm & ~binary_dilation(hand | fan, iterations=6)
cloth[:120] = False                                   # below the cape
med = median_filter(src, 15)
line = cloth & (med - src > 18)                       # the drawn fold lines: darker than their 15 px median by 18+
fill = cloth & ~binary_dilation(line, iterations=4)
def depth(l): return float(np.median((median_filter(l, 15) - l)[line]))
s0 = depth(src)
res = {"line px": int(line.sum()), "src line depth": round(s0, 1)}
for f in sys.argv[1:]:
    l = L(f); b = l - gaussian_filter(l, 3)
    res[f] = {"line depth kept (%)": round(100 * depth(l) / s0, 1),
              "fill band-pass std (1-3px)": round(float(np.sqrt(uniform_filter(b * b, 16))[fill].mean()), 2),
              "fill mean |change| vs drawn": round(float(np.abs(l - src)[fill].mean()), 2)}
res["src fill band-pass"] = round(float(np.sqrt(uniform_filter((src - gaussian_filter(src, 3)) ** 2, 16))[fill].mean()), 2)
print(json.dumps(res, indent=1))
