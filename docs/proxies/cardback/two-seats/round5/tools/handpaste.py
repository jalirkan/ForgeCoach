# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 5: paste the hand pass back, on the skin only (round 4's rule: where either the input tile
# or the repaint is skin, dilated 4 px and feathered), so the cards, their gilt edges and the cloak keep their own
# pixels. Then, for the blue man, round 2's ochre cuff under his right hand is turned to the dark blue of his
# cloak (a sleeve inside the cloak), so it does not read as an object of its own.
#   handpaste.py <half.png> <painted-tile.png> <tile-in.png> x0 y0 x1 y1 <out.png> [--cuff]
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, binary_dilation, binary_opening

half, painted, tin = sys.argv[1:4]; x0, y0, x1, y1 = map(int, sys.argv[4:8]); out = sys.argv[8]
h = np.asarray(Image.open(half).convert("RGB"), np.float32).copy()
W_, H_ = x1 - x0, y1 - y0
p = Image.open(painted).convert("RGB").resize((W_, H_), Image.LANCZOS)
q = Image.open(tin).convert("RGB").resize((W_, H_), Image.LANCZOS)
def skin(im):
    a = np.asarray(im.convert("HSV"), np.float32) / 255
    H, S, V = a[..., 0] * 360, a[..., 1], a[..., 2]
    return ((H < 42) | (H > 340)) & (S > 0.05) & (S < 0.48) & (V > 0.42)
m = binary_opening(skin(p) | skin(q), iterations=1)
m = binary_dilation(m, iterations=4)
m = gaussian_filter(m.astype(np.float32), 2.0)
yy, xx = np.mgrid[0:H_, 0:W_]
m *= np.clip(np.minimum.reduce([xx, yy, W_ - 1 - xx, H_ - 1 - yy]) / 10, 0, 1)
m = m[..., None]
pa = np.asarray(p, np.float32)
h[y0:y1, x0:x1] = h[y0:y1, x0:x1] * (1 - m) + pa * m
if "--cuff" in sys.argv:
    a = np.asarray(Image.fromarray(h.astype(np.uint8)).convert("HSV"), np.float32) / 255
    H, S, V = a[..., 0] * 360, a[..., 1], a[..., 2]
    box = np.zeros(H.shape, bool); box[860:944, 860:960] = True
    oc = box & (H > 24) & (H < 52) & (S > 0.42) & (V > 0.35)
    oc = gaussian_filter(binary_dilation(oc, iterations=1).astype(np.float32), 1.0)[..., None]
    lum = h.mean(-1, keepdims=True) / 255
    umber = np.array([30, 38, 62], np.float32) * (0.6 + 0.8 * lum)
    h = h * (1 - oc) + umber * oc
Image.fromarray(np.clip(h, 0, 255).astype(np.uint8)).save(out)
print(out)
