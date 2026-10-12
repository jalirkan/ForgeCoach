# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 2: a natural hand of cards, drawn between the painted hands.
# Round 1's fan was seven cards 262 px long, splayed +-36 degrees: tablets, the owner said (a hand is ~115 px
# long there, and a real card is half a hand). This one is a hand a person actually holds: five to seven cards
# 130 px long (about 2.5x life against the hands, so they still read as cards at sleeve size), fanned 8-13
# degrees apart from a pivot in the left hand's grip, the fan tilted toward the right hand, whose fingers touch
# its edge; each card nudged along its length and its angle so they do not sit like a machine-cut fan. Plain dark backs, a thin gilt edge, a soft shadow on the card beneath, warmer toward the lamp.
# Each character holds their own hand:
#   green  - five cards, tidy and evenly closed (composed, ahead)
#   garnet - seven cards, uneven, one half drawn up out of the fan (he cannot decide)
#   blue   - six cards, held tight and narrow, tilted toward the body (guarded)
# Usage: fan.py <half.png> <hands-from.png> <green|garnet|blue> <out.png>
import math, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter, binary_closing, binary_fill_holes, binary_opening, binary_dilation

HW, HH, SEAM, CXF = 1500, 1052, 1050, 750
half, handsrc, ch, out = sys.argv[1:5]
F = {
    "green":  dict(px=712, py=888, L=130, tilt=6, ang=[-32, -16, 0, 16, 32], jit=[0, 1, -1, 0, 1], up=[0, 1, 2, 1, 0]),
    "garnet": dict(px=712, py=890, L=130, tilt=5, ang=[-34, -23, -12, -1, 10, 22, 33], jit=[1, -2, 1, 0, 2, -1, 1],
                   up=[0, 4, -2, 3, 24, 0, 3]),
    "blue":   dict(px=714, py=888, L=128, tilt=3, ang=[-20, -12, -4, 4, 12, 20], jit=[0, 1, 0, -1, 1, 0], up=[0, 2, 1, 2, 1, 0]),
}[ch]
PX, PY, L = F["px"], F["py"], F["L"]
W_ = L * 63 / 88; UNDER = 14
HAND_BOX = (590, 790, 940, 960)
SS = 3

h = np.asarray(Image.open(half).convert("RGB").resize((HW, HH), Image.LANCZOS), np.float32)
src = np.asarray(Image.open(handsrc).convert("RGB").resize((HW, HH), Image.LANCZOS), np.float32)
yy, xx = np.mgrid[0:HH, 0:HW].astype(np.float32)
lamp = np.exp(-(np.hypot(xx - CXF, yy - SEAM) / 330) ** 2)


def card_mask(ang, up, grow=0.0, rad=6.0):
    a = math.radians(ang); pts = []
    hw, top, bot = W_ / 2 + grow, -L + UNDER - grow - up, UNDER + grow - up
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
fanm = np.zeros((HH, HW), np.float32)
for ang0, j, up in zip(F["ang"], F["jit"], F["up"]):
    ang = ang0 + j + F["tilt"]
    mo = card_mask(ang, up); mi = card_mask(ang, up, grow=-2.2, rad=4.5)
    sh = gaussian_filter(np.roll(mo, (3, 4 if ang >= 0 else -4), (0, 1)), 5)
    a *= (1 - 0.5 * sh * (1 - mo))[..., None]
    along = np.clip((PY + UNDER - yy) / L, 0, 1)
    body = INK * (0.92 + 0.10 * tex + 0.9 * lamp - 0.10 * along)[..., None] + np.array([26, 16, 4]) * lamp[..., None]
    gilt = GILT * (0.78 + 0.5 * lamp + 0.08 * tex)[..., None]
    a = a * (1 - mo[..., None]) + gilt * mo[..., None]
    a = a * (1 - mi[..., None]) + body * mi[..., None]
    fanm = np.maximum(fanm, mo)

x0, y0, x1, y1 = HAND_BOX
hsv = np.asarray(Image.fromarray(src.astype(np.uint8)).convert("HSV"), np.float32) / 255
H_, S_, V_ = hsv[..., 0] * 360, hsv[..., 1], hsv[..., 2]
skin = (((H_ < 40) | (H_ > 345)) & (S_ > 0.06) & (S_ < 0.40) & (V_ > 0.55))
box = np.zeros_like(skin); box[y0:y1, x0:x1] = True
m = binary_dilation(binary_fill_holes(binary_closing(binary_opening(skin & box, iterations=2), iterations=4)), iterations=2)
mf = gaussian_filter(m.astype(np.float32), 1.6)[..., None]
a = a * (1 - mf) + src * mf
Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(out)
Image.fromarray((np.clip(np.maximum(fanm, mf[..., 0]), 0, 1) * 255).astype(np.uint8)).save(out[:-4] + "-fanmask.png")
print(out, "hand pixels", int(m.sum()))
