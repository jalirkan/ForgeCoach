# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 6: paste the torso pass back in two parts, each only where it is meant to act.
#   armpaste.py <half.png> <arm-tile.png> <chest-tile.png> <arm.png> <chest.png> <fan.png> x0 y0 x1 y1 <out.png>
# - the sleeves (fix 1, the 0.40 tile): the drawn sleeve mask grown 6 px and feathered 4 px, so the sleeve's edge
#   feathers into the cloak;
# - the cloak front (fix 2, the 0.35 tile): the closed front less the fan, the hands and the sleeves, feathered 4 px.
# The fan and the hands (round 2's pixels) are held out of both, so the cards keep their own pixels.
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, binary_dilation
half, at, ct, armp, chp, fanp = sys.argv[1:7]; x0, y0, x1, y1 = map(int, sys.argv[7:11]); out = sys.argv[11]
h = np.asarray(Image.open(half).convert("RGB"), np.float32).copy()
L = lambda p: np.asarray(Image.open(p).convert("L"), np.float32) / 255
arm, chest, fan = L(armp), L(chp), L(fanp)
am = gaussian_filter(binary_dilation(arm > 0.3, iterations=6).astype(np.float32), 4)
cm = gaussian_filter(chest, 4)
keep = gaussian_filter(binary_dilation(fan > 0.3, iterations=1).astype(np.float32), 0.8)
am = am * (1 - keep); cm = cm * (1 - keep) * (1 - am)
am[943:] = 0; cm[943:] = 0
W_, H_ = x1 - x0, y1 - y0
for tile, m in ((at, am), (ct, cm)):
    p = np.asarray(Image.open(tile).convert("RGB").resize((W_, H_), Image.LANCZOS), np.float32)
    mm = m[y0:y1, x0:x1, None]
    h[y0:y1, x0:x1] = h[y0:y1, x0:x1] * (1 - mm) + p * mm
Image.fromarray(np.clip(h, 0, 255).astype(np.uint8)).save(out)
Image.fromarray((np.maximum(am, cm) * 255).astype(np.uint8)).save(out[:-4] + "-mask.png")
print(out)
