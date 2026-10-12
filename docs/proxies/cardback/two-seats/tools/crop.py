# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats (sleeve): cut a region of the painted half out at high resolution for a repaint, and paste the
# repainted region back with a feathered mask. Coordinates are sleeve pixels of the half (1500x1052).
#   crop.py cut   <half.png> <region> <out.png>
#   crop.py paste <half.png> <painted.png> <region> <out.png> [--mask ellipse|box|<mask.png>] [--feather 18]
#                 [--clip <mask.png>]   (the paste is also limited to a guide mask, dilated by --grow px)
# Regions (x0, y0, x1, y1, work w, work h): the face at 3.2x, the hands and fan at 2.17x, the lamp at 2.85x.
import argparse, json
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, binary_dilation

REGIONS = {
    "face": (590, 302, 910, 622, 1024, 1024),
    "hands": (470, 580, 1030, 963, 1216, 832),
    "fan": (470, 560, 1030, 960, 1120, 800),
    "hand": (590, 730, 930, 962, 1024, 696),        # the two hands alone, at 3x
    # the lamp is painted whole on the full card (both halves), centred on the seam (y = 1050)
    "lamp": (570, 870, 930, 1230, 1024, 1024),
}
HW, HH = 1500, 1052

ap = argparse.ArgumentParser()
ap.add_argument("mode"); ap.add_argument("files", nargs="+")
ap.add_argument("--mask", default="ellipse"); ap.add_argument("--feather", type=float, default=18)
ap.add_argument("--clip", default=None); ap.add_argument("--grow", type=int, default=14)
a = ap.parse_args()


def load_half(p, size=(HW, HH)):
    im = Image.open(p).convert("RGB")
    return im if im.size == size else im.resize(size, Image.LANCZOS)


if a.mode == "cut":
    src, reg, out = a.files
    x0, y0, x1, y1, w, h = REGIONS[reg]
    im = Image.open(src).convert("RGB")
    if im.size[1] < 2000:
        im = load_half(src)
    im.crop((x0, y0, x1, y1)).resize((w, h), Image.LANCZOS).save(out)
elif a.mode == "paste":
    src, painted, reg, out = a.files
    x0, y0, x1, y1, w, h = REGIONS[reg]
    full = Image.open(src).convert("RGB")
    if full.size[1] < 2000:
        full = load_half(src)
    base = np.asarray(full, np.float32).copy()
    p = np.asarray(Image.open(painted).convert("RGB").resize((x1 - x0, y1 - y0), Image.LANCZOS), np.float32)
    H_, W_ = y1 - y0, x1 - x0
    yy, xx = np.mgrid[0:H_, 0:W_].astype(np.float32)
    f = a.feather
    if a.mask == "ellipse":
        r = np.hypot((xx - W_ / 2) / (W_ / 2 - f), (yy - H_ / 2) / (H_ / 2 - f))
        m = np.clip((1.0 - r) * (min(W_, H_) / 2 - f) / f + 0.5, 0, 1)
    elif a.mask == "box":
        d = np.minimum.reduce([xx, yy, W_ - 1 - xx, H_ - 1 - yy])
        m = np.clip(d / f, 0, 1)
    else:
        mm = np.asarray(Image.open(a.mask).convert("L"), np.float32)[y0:y1, x0:x1] / 255
        m = gaussian_filter(mm, f / 2)
    if a.clip:
        c = np.asarray(Image.open(a.clip).convert("L"), np.float32)[y0:y1, x0:x1] / 255 > 0.05
        c = gaussian_filter(binary_dilation(c, iterations=a.grow).astype(np.float32), f / 3)
        m = m * c
    m = m[..., None]
    base[y0:y1, x0:x1] = base[y0:y1, x0:x1] * (1 - m) + p * m
    Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).save(out)
print(a.mode, a.files[-1])
