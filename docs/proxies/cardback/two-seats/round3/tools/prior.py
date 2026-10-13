# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 3: a soft colour prior for the composition pass (1216x848, the half's 1.43:1).
# Not a template to paint over: it is blurred to low frequency and the model repaints it at strength 0.9,
# so all it fixes is WHERE things go -- the lamp's glow centred on the bottom edge (the seam), a dark table
# band along the bottom, a figure-sized mass in the character's colours filling the height, a pale head near
# the top, a dark hand of cards at mid-height, and gold behind.
# Usage: prior.py <character> <out.png>
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
C = {"green":  dict(cloak=(38, 78, 52),  gown=(150, 70, 80), hair=(120, 55, 30)),
     "garnet": dict(cloak=(110, 28, 34), gown=(55, 35, 28),  hair=(105, 95, 85)),
     "blue":   dict(cloak=(30, 42, 85),  gown=(30, 30, 40),  hair=(35, 25, 20))}[sys.argv[1]]
W, H = 1216, 848
rng = np.random.default_rng(7)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
img = np.zeros((H, W, 3), np.float32) + np.array([176, 136, 62], np.float32)
img += gaussian_filter(rng.normal(0, 18, (H, W)), (6, 1))[..., None]
def put(mask, col, a=1.0):
    global img
    m = gaussian_filter(mask.astype(np.float32), 6)[..., None] * a
    img = img * (1 - m) + np.array(col, np.float32) * m
cx = W / 2
# shoulders and torso: a broad trapezoid from just under the chin to the table
sh = (yy > 300) & (np.abs(xx - cx) < 170 + (yy - 300) * 1.0) & (np.abs(xx - cx) < 400)
put(sh, C["cloak"])
put((yy > 315) & (np.abs(xx - cx) < 110 + (yy - 315) * 0.35), C["gown"])
# hair and head, head near the top
put(((xx - cx) / 100) ** 2 + ((yy - 205) / 118) ** 2 < 1, C["hair"])
put(((xx - cx) / 74) ** 2 + ((yy - 220) / 92) ** 2 < 1, (205, 160, 125))
put((np.abs(xx - cx) < 40) & (yy > 295) & (yy < 330), (190, 145, 112))
# the hand of cards, large, at mid-height, held a little to one side, and the two hands
# forearms in the sleeve colour, from the elbows up to the hands
for ex, hx in ((cx - 300, cx - 70), (cx + 300, cx + 120)):
    t = np.clip((yy - 560) / 120, 0, 1); mx_ = hx + (ex - hx) * t
    put((np.abs(xx - mx_) < 55) & (yy > 520) & (yy < 690), C["gown"])
# six cards, LARGE, fanned from a pivot in the left hand's grip: dark backs, a light gilt edge each
px, py = cx - 60, 600
for k, a in enumerate(np.linspace(-0.55, 0.45, 6)):
    u = (xx - px) * np.cos(a) + (yy - py) * np.sin(a)        # across the card
    v = -(xx - px) * np.sin(a) + (yy - py) * np.cos(a)       # along it (negative = up)
    card = (np.abs(u) < 62) & (v < -20) & (v > -250)
    edge = card & ~((np.abs(u) < 56) & (v < -26) & (v > -244))
    img[card] = np.array([46, 40, 52], np.float32); img[edge] = np.array([200, 165, 95], np.float32)
put(((xx - (cx - 70)) / 62) ** 2 + ((yy - 585) / 48) ** 2 < 1, (215, 168, 130))
put(((xx - (cx + 110)) / 55) ** 2 + ((yy - 470) / 42) ** 2 < 1, (215, 168, 130))
# the table: a dark wood band along the bottom, its near edge slightly in perspective
put(yy > 690 + np.abs(xx - cx) * 0.02, (78, 48, 28))
# the lamp's glow: centred on the bottom edge (the seam), lighting face, chest and hands from below
d = np.hypot(xx - cx, (yy - H) * 1.0)
glow = np.exp(-(d / 330) ** 2)[..., None]
img = img * (0.62 + 0.58 * glow) + np.array([255, 190, 110], np.float32) * glow * 0.25
put(np.hypot(xx - cx, yy - H) < 78, (255, 228, 160))
put(np.hypot(xx - cx, yy - H) < 50, (255, 248, 220))
# a thin dark border on the three outer sides (the seam side has none)
b = (xx < 34) | (xx > W - 35) | (yy < 34)
img[b] = img[b] * 0.35 + np.array([70, 25, 20], np.float32) * 0.65
img = gaussian_filter(img, (1.5, 1.5, 0))
Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(sys.argv[2])
