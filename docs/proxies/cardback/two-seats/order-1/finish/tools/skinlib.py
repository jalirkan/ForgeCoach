# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, order 1, finish 2: colour helpers (sRGB <-> CIE Lab D65, HSV) and the two skin masks, numpy only.
import json, os
import numpy as np
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__))
REG = json.load(open(os.path.join(HERE, "regions.json")))
M = np.array([[.4124564, .3575761, .1804375], [.2126729, .7151522, .0721750], [.0193339, .1191920, .9503041]])
WP = np.array([.95047, 1.0, 1.08883])

def rgb2lab(rgb):  # uint8/float 0..255 -> Lab
    c = np.asarray(rgb, np.float64) / 255
    c = np.where(c <= .04045, c / 12.92, ((c + .055) / 1.055) ** 2.4)
    x = c @ M.T / WP
    f = np.where(x > (6 / 29) ** 3, np.cbrt(x), x / (3 * (6 / 29) ** 2) + 4 / 29)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)

def lab2rgb(lab):  # -> float 0..255 (unclipped)
    fy = (lab[..., 0] + 16) / 116; fx = fy + lab[..., 1] / 500; fz = fy - lab[..., 2] / 200
    f = np.stack([fx, fy, fz], -1)
    x = np.where(f > 6 / 29, f ** 3, 3 * (6 / 29) ** 2 * (f - 4 / 29)) * WP
    c = x @ np.linalg.inv(M).T
    c = np.where(c <= .0031308, 12.92 * c, 1.055 * np.clip(c, 0, None) ** (1 / 2.4) - .055)
    return c * 255

def hsv(rgb):  # -> h degrees, s, v (0..1)
    c = np.asarray(rgb, np.float64) / 255
    mx = c.max(-1); mn = c.min(-1); d = mx - mn
    s = np.where(mx > 0, d / np.maximum(mx, 1e-9), 0)
    r, g, b = c[..., 0], c[..., 1], c[..., 2]
    h = np.where(mx == r, (g - b) / np.maximum(d, 1e-9) % 6, np.where(mx == g, (b - r) / np.maximum(d, 1e-9) + 2, (r - g) / np.maximum(d, 1e-9) + 4)) * 60
    return np.where(d > 0, h, 0), s, mx

def drawn(shapes, H=1050, W=1500):
    im = Image.new("L", (W, H), 0); d = ImageDraw.Draw(im)
    for p in shapes.get("poly", []): d.polygon([tuple(q) for q in p], fill=255)
    for e in shapes.get("ellipse", []): d.ellipse(e, fill=255)
    for e in shapes.get("minus_ellipse", []): d.ellipse(e, fill=0)
    for e in shapes.get("minus", []): d.rectangle(e, fill=0)
    return np.asarray(im) > 0

# Where skin is measured. FACE: an inner oval of the face, both eyes and the brows cut out (boxes), the mouth line too.
# HANDS: the hands region of finish 1 (regions.json "hands"). Skin inside either: hue 12-50 deg, s 0.12-0.80, and
# "lit" = v >= 0.42 (the shadow excluded), so the statistics compare skin with skin.
FACE = {"ellipse": [[700, 330, 812, 478]], "minus": [[703, 368, 750, 402], [757, 368, 806, 402], [728, 455, 790, 466]]}
def masks(top):
    h, s, v = hsv(top)
    skinhue = (h >= 12) & (h <= 50) & (s >= .12) & (s <= .80)
    face = drawn(FACE) & skinhue & (v >= .42)
    hands_area = drawn(REG["hands"])
    hands = hands_area & skinhue & (v >= .42)
    return face, hands, hands_area

def stats(top, m):
    h, s, v = hsv(top); L = rgb2lab(top)
    q = lambda a: [round(float(x), 3) for x in (a[m].mean(), a[m].std(), *np.percentile(a[m], [10, 50, 90]))]
    return {"px": int(m.sum()), "hue mean/std/p10/p50/p90": q(h), "sat": q(s), "val": q(v),
            "L": q(L[..., 0]), "a": q(L[..., 1]), "b": q(L[..., 2])}
