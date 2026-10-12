# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats (sleeve): the fan of cards, drawn between the painted hands.
# At strength 0.68 the model paints good hands but will not paint a fan of plain card backs (it paints a book,
# or real playing cards with pips). So this keeps the painting's hands, draws the fan in code BEHIND them (plain
# dark backs, a thin gilt edge, a soft shadow on the card beneath, warmer toward the lamp), and lays the painted
# hands back on top (a skin-and-cuff mask from the painting). A repaint of the crop at ~0.42 then unifies it.
# Usage: fan.py <half.png> <hands-from.png> <out.png> [pivot_x pivot_y length]
import math, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter, binary_closing, binary_fill_holes, binary_opening, binary_dilation

HW, HH, SEAM, CXF = 1500, 1052, 1050, 750
half, handsrc, out = sys.argv[1:4]
PX, PY, L = (float(v) for v in sys.argv[4:7]) if len(sys.argv) > 6 else (757.0, 880.0, 262.0)
W_ = L * 63 / 88; UNDER = 30
ANG = [-36, -24, -12, 0, 12, 24, 36]
HAND_BOX = (590, 790, 940, 960)
SS = 3

h = np.asarray(Image.open(half).convert("RGB").resize((HW, HH), Image.LANCZOS), np.float32)
src = np.asarray(Image.open(handsrc).convert("RGB").resize((HW, HH), Image.LANCZOS), np.float32)
yy, xx = np.mgrid[0:HH, 0:HW].astype(np.float32)
lamp = np.exp(-(np.hypot(xx - CXF, yy - SEAM) / 330) ** 2)


def card_mask(ang, grow=0.0, rad=9.0):
    a = math.radians(ang); pts = []
    hw, top, bot = W_ / 2 + grow, -L + UNDER - grow, UNDER + grow
    for (cx_, cy_, a0) in ((hw - rad, top + rad, -90), (hw - rad, bot - rad, 0), (-hw + rad, bot - rad, 90), (-hw + rad, top + rad, 180)):
        for t in np.linspace(0, 90, 7):
            r_ = math.radians(a0 + t); u, v = cx_ + rad * math.cos(r_), cy_ + rad * math.sin(r_)
            pts.append(((PX + u * math.cos(a) - v * math.sin(a)) * SS, (PY + u * math.sin(a) + v * math.cos(a)) * SS))
    m = Image.new("L", (HW * SS, HH * SS), 0); ImageDraw.Draw(m).polygon(pts, fill=255)
    return np.asarray(m.resize((HW, HH), Image.LANCZOS), np.float32) / 255


rng = np.random.default_rng(5)
tex = gaussian_filter(rng.normal(0, 1, (HH, HW)).astype(np.float32), 1.4)
INK = np.array([30, 37, 52], np.float32)
GILT = np.array([192, 150, 76], np.float32)
a = h.copy()
for ang in ANG:
    mo = card_mask(ang); mi = card_mask(ang, grow=-3.2, rad=7)
    sh = gaussian_filter(np.roll(mo, (3, 4 if ang >= 0 else -4), (0, 1)), 5)
    a *= (1 - 0.5 * sh * (1 - mo))[..., None]
    along = np.clip((PY + UNDER - yy) / L, 0, 1)                     # 0 at the foot, 1 at the top
    body = INK * (0.92 + 0.10 * tex + 0.9 * lamp - 0.10 * along)[..., None] + np.array([26, 16, 4]) * lamp[..., None]
    gilt = GILT * (0.78 + 0.5 * lamp + 0.08 * tex)[..., None]
    a = a * (1 - mo[..., None]) + gilt * mo[..., None]
    a = a * (1 - mi[..., None]) + body * mi[..., None]

# the painted hands, on top: skin (and the pale cuff) inside the hand box, cleaned up
x0, y0, x1, y1 = HAND_BOX
hsv = np.asarray(Image.fromarray(src.astype(np.uint8)).convert("HSV"), np.float32) / 255
H_, S_, V_ = hsv[..., 0] * 360, hsv[..., 1], hsv[..., 2]
skin = (((H_ < 40) | (H_ > 345)) & (S_ > 0.06) & (S_ < 0.36) & (V_ > 0.58))   # not the book: it is more saturated
box = np.zeros_like(skin); box[y0:y1, x0:x1] = True
m = skin & box
m = binary_opening(m, iterations=2)
m = binary_closing(m, iterations=4)
m = binary_fill_holes(m)
m = binary_dilation(m, iterations=2)
mf = gaussian_filter(m.astype(np.float32), 1.6)[..., None]
a = a * (1 - mf) + src * mf
Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(out)
Image.fromarray((mf[..., 0] * 255).astype(np.uint8)).save(out[:-4] + "-handmask.png")
print(out, "hand pixels", int(m.sum()))
