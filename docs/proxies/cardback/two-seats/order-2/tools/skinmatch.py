# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, order 2 (the green woman), finish: her hands' skin matched to her face's, by the numbers.
#   skinmatch.py <top.png> <out top.png> [--k K]      (run in two-seats-work/order2/finish; prints JSON)
# Skin: hue below 34 degrees or above 340, HSV saturation 0.08-0.45, luma > 70 (cards.py's test; the lips, the cards'
# gilt and the cloak fail it). Her face is a pale ivory whose saturation runs below 0.08, so the FACE's test lets the
# saturation go down to 0.02 and the hue up to 45 (the ivory), luma > 90 (no hair, no hood): with cards.py's test alone
# the sample was 3,083 px, mostly the cheeks' blush, and the hands came out pink and flat.
# Face skin: inside the face ellipse (centre 750, 405; radii 100 x 130), eroded 3 px. Hand skin: inside regions.json
# "hands" polygon, eroded 1 px.
# Transfer: in CIE Lab (skimage), each hand-skin pixel's L, a, b moved by the mean/std transfer
#   v' = (v - mean_hand) * std_face / std_hand + mean_face,
# blended at K (default 1.0, the whole transfer); its weight is the skin mask feathered by a 1 px gaussian, so no edge.
# Nothing outside the hand-skin mask changes. No painting here: a colour move on the painted hands only.
import sys, json, os
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import binary_erosion, gaussian_filter
from skimage.color import rgb2lab, lab2rgb
src, out = sys.argv[1:3]
K = float(sys.argv[sys.argv.index("--k") + 1]) if "--k" in sys.argv else 1.0
REG = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "regions.json")))
a = np.asarray(Image.open(src).convert("RGB"), np.float32)
H_, W_ = a.shape[:2]
hsv = np.asarray(Image.fromarray(a.astype(np.uint8)).convert("HSV"), np.float32)
Hh, S = hsv[..., 0] * 360 / 255, hsv[..., 1] / 255
Y = a @ np.array([.2126, .7152, .0722], np.float32)
skin = ((Hh < 34) | (Hh > 340)) & (S > 0.08) & (S < 0.45) & (Y > 70)
yy, xx = np.mgrid[0:H_, 0:W_]
fskin = ((Hh < 45) | (Hh > 340)) & (S > 0.02) & (S < 0.45) & (Y > 90)
face = binary_erosion((((xx - 750) / 100) ** 2 + ((yy - 405) / 130) ** 2 < 1) & fskin, iterations=3)
pm = Image.new("L", (W_, H_), 0); ImageDraw.Draw(pm).polygon([tuple(p) for p in REG["hands"]["poly"][0]], fill=255)
hand = binary_erosion((np.asarray(pm) > 0) & skin, iterations=1)
lab = rgb2lab(a / 255)
mf, sf = lab[face].mean(0), lab[face].std(0)
mh, sh = lab[hand].mean(0), lab[hand].std(0)
new = (lab - mh) * (sf / sh) + mf
w = np.clip(gaussian_filter(hand.astype(np.float32), 1.0), 0, 1) * ((np.asarray(pm) > 0)) * K
lab2 = lab * (1 - w[..., None]) + new * w[..., None]
o = np.clip(lab2rgb(lab2) * 255, 0, 255)
o = np.where(w[..., None] > 0, o, a)
Image.fromarray(np.round(o).astype(np.uint8)).save(out)
after = rgb2lab(np.round(o) / 255)[hand]
print(json.dumps({"face px": int(face.sum()), "hand px": int(hand.sum()), "k": K,
                  "face Lab mean/std": [np.round(mf, 2).tolist(), np.round(sf, 2).tolist()],
                  "hands before": [np.round(mh, 2).tolist(), np.round(sh, 2).tolist()],
                  "hands after": [np.round(after.mean(0), 2).tolist(), np.round(after.std(0), 2).tolist()]}, indent=1))
