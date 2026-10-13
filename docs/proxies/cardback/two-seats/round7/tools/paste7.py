# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 7: lay a light model pass (the torso tile) back onto the drawn half, part by part, each
# part from the tile the round chose for it (or none: the drawn pixels stay). The fan's cards are never pasted
# (they stay drawn, so they stay plain); each part's mask is the drawn part's own, feathered 1.5 px and kept
# inside the drawn region, so nothing above the hem or outside the silhouette changes.
#   paste7.py <drawn-half.png> <comp-dir> <tag> x0 y0 x1 y1 <out.png> front=<tile|-> arm=<tile|-> hand=<tile|->
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, binary_dilation
half, cd, tag = sys.argv[1:4]; x0, y0, x1, y1 = map(int, sys.argv[4:8]); out = sys.argv[8]
pick = dict(a.split("=", 1) for a in sys.argv[9:])
h = np.asarray(Image.open(half).convert("RGB"), np.float32).copy()
L = lambda n: np.asarray(Image.open(f"{cd}/{n}-{tag}.png").convert("L"), np.float32) / 255
nm, fan, hand = L("dm"), L("m-fan"), L("m-hand")
keep_fan = gaussian_filter(binary_dilation(fan > 0.3, iterations=1).astype(np.float32), 0.8)
masks = {"front": L("m-front") * (1 - keep_fan) * (1 - hand),
         "arm": L("m-arm") * (1 - keep_fan) * (1 - hand),
         "hand": hand}
for part in ("front", "arm", "hand"):
    t = pick.get(part, "-")
    if t == "-":
        continue
    m = np.minimum(gaussian_filter(masks[part], 1.5), nm)
    m[943:] = 0
    p = np.asarray(Image.open(t).convert("RGB").resize((x1 - x0, y1 - y0), Image.LANCZOS), np.float32)
    mm = m[y0:y1, x0:x1, None]
    h[y0:y1, x0:x1] = h[y0:y1, x0:x1] * (1 - mm) + p * mm
    print(tag, part, "<-", t)
Image.fromarray(np.clip(h, 0, 255).astype(np.uint8)).save(out)
