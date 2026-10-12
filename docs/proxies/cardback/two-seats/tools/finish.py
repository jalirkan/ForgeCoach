# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats (sleeve): the finishing steps on the painted half (1500x1052, seam at y = 1050).
#   finish.py light   <half> <out> [--amount 1.0]      the lamp's light: a warm radial light from the seam's
#                     centre, strongest on what faces down toward it (hands, the fan's foot, chin, cuffs)
#   finish.py split   <half> <outprefix>               two overlapping 1024x1056 tiles for the unifying pass
#   finish.py merge   <half> <tileL> <tileR> <out> [--keep face.png,...]   tiles back, feathered across the overlap
#   finish.py table   <half> <out>                     the model painted a pale slab in the table's middle where
#                     the lamp goes; the board below the moulding is redrawn as even walnut with the lamp's pool
#   finish.py tablecut <half> <out>  /  tablepaste <half> <painted> <out>
#                     the table band of the whole card (both halves, y 900..1200, x 200..1300) at 1408x384 for
#                     a repaint; only the painted board above the seam comes back (the lamp left as it was)
#   finish.py recolour <half> <out> <green|blue> [--robe robe-mask.png]     the garnet robe turned to another
#                     colourway by hue, the face, hands, fan, gold and fur untouched
import argparse, colorsys
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

HW, HH, SEAM, CXF = 1500, 1052, 1050, 750
TW = 1024; XR = HW - TW            # left tile x 0..1024, right tile x 476..1500
ap = argparse.ArgumentParser()
ap.add_argument("mode"); ap.add_argument("files", nargs="+")
ap.add_argument("--amount", type=float, default=1.0)
ap.add_argument("--robe", default=None)
a = ap.parse_args()


def load(p, size=(HW, HH)):
    im = Image.open(p).convert("RGB")
    return np.asarray(im if im.size == size else im.resize(size, Image.LANCZOS), np.float32)


def save(arr, p):
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(p)


yy, xx = np.mgrid[0:HH, 0:HW].astype(np.float32)
if a.mode == "light":
    src, out = a.files
    h = load(src)
    d = np.hypot(xx - CXF, (yy - SEAM) * 1.1)
    L = np.exp(-(d / 300) ** 2) * 0.75 + np.exp(-(d / 620) ** 2) * 0.25          # 1 at the lamp
    # undersides catch it more: where the image darkens downward (a lower edge), from a blurred derivative
    lum = gaussian_filter(h.mean(-1), 2.0)
    under = np.clip(-np.gradient(lum, axis=0) / 10, 0, 1) * np.exp(-(d / 420) ** 2)
    L = (L + 0.35 * under) * a.amount
    lit = h * (1 + L[..., None] * np.array([0.42, 0.28, 0.10])) + L[..., None] * np.array([22, 13, 3])
    # what the lamp does not reach falls away a little, so the light has a source
    lit *= (0.92 + 0.08 * np.exp(-(d / 760) ** 2))[..., None]
    save(lit, out)
elif a.mode == "split":
    src, pre = a.files
    h = Image.fromarray(load(src).astype(np.uint8))
    h.crop((0, 0, TW, HH)).resize((1024, 1056), Image.LANCZOS).save(pre + "-L.png")
    h.crop((XR, 0, HW, HH)).resize((1024, 1056), Image.LANCZOS).save(pre + "-R.png")
elif a.mode == "merge":
    src, tl, tr, out = a.files[:4]
    h = load(src)
    L = np.asarray(Image.open(tl).convert("RGB").resize((TW, HH), Image.LANCZOS), np.float32)
    R = np.asarray(Image.open(tr).convert("RGB").resize((TW, HH), Image.LANCZOS), np.float32)
    acc = np.zeros_like(h); ws = np.zeros(h.shape[:2] + (1,), np.float32)
    x = np.arange(TW, dtype=np.float32)
    wl = np.clip((TW - x) / 260, 0, 1)[None, :, None]; wr = np.clip(x / 260, 0, 1)[None, :, None]
    acc[:, :TW] += L * wl; ws[:, :TW] += wl
    acc[:, XR:] += R * wr; ws[:, XR:] += wr
    m = acc / np.maximum(ws, 1e-6)
    save(m, out)
elif a.mode == "table":
    # the table top below the gilt moulding, redrawn as one even walnut board lit by the lamp: the model's
    # table had a pale stepped slab in the middle; this is what the lamp sits on, and what the unifying pass
    # then paints over at low strength
    src, out = a.files
    h = load(src)
    y0, x0, x1 = 956, 200, 1300
    ys, xs = np.mgrid[y0:HH, x0:x1].astype(np.float32)
    rng = np.random.default_rng(17)
    g = rng.normal(0, 1, (HH - y0, (x1 - x0) // 24 + 2)).astype(np.float32)
    g = np.asarray(Image.fromarray(g).resize((x1 - x0, HH - y0), Image.BICUBIC), np.float32)
    g = gaussian_filter(g, (0.8, 3)) + 0.5 * gaussian_filter(rng.normal(0, 1, g.shape).astype(np.float32), (0.6, 14))
    wood = np.array([66, 42, 30], np.float32) * (1 + 0.07 * g)[..., None]
    d = np.hypot((xs - CXF) / 340, (ys - SEAM) / 150)
    pool = np.exp(-d ** 2)
    wood = wood + (np.array([214, 150, 84]) - wood) * (pool * 0.55)[..., None]
    wood *= (0.82 + 0.18 * np.clip((ys - y0) / 14, 0, 1))[..., None]          # the moulding's shadow on the board
    w = np.minimum(np.clip((xs - x0) / 10, 0, 1), np.clip((x1 - 1 - xs) / 10, 0, 1))[..., None]
    h[y0:, x0:x1] = h[y0:, x0:x1] * (1 - w) + wood * w
    save(h, out)
elif a.mode in ("tablecut", "tablepaste"):
    TX0, TX1, TY0 = 200, 1300, 900
    h = load(a.files[0])
    if a.mode == "tablecut":
        top = h[TY0:SEAM, TX0:TX1]
        band = np.concatenate([top, top[::-1, ::-1]], 0)
        Image.fromarray(np.clip(band, 0, 255).astype(np.uint8)).resize((1408, 384), Image.LANCZOS).save(a.files[1])
    else:
        p = np.asarray(Image.open(a.files[1]).convert("RGB").resize((TX1 - TX0, 2 * (SEAM - TY0)), Image.LANCZOS), np.float32)
        p = p[:SEAM - TY0]
        ys, xs = np.mgrid[TY0:SEAM, TX0:TX1].astype(np.float32)
        m = np.clip((ys - 958) / 6, 0, 1)                                   # the board only, below the moulding
        m *= np.minimum(np.clip((xs - TX0) / 12, 0, 1), np.clip((TX1 - 1 - xs) / 12, 0, 1))
        lampd = np.hypot((xs - CXF) / 128, (ys - SEAM) / 118)
        m *= np.clip(lampd - 1, 0, 1) ** 0.7 * np.clip((lampd - 0.95) / 0.1, 0, 1)   # not the lamp
        m = m[..., None]
        h[TY0:SEAM, TX0:TX1] = h[TY0:SEAM, TX0:TX1] * (1 - m) + p * m
        save(h, a.files[2])
elif a.mode == "recolour":
    src, out, col = a.files
    h = load(src)
    hsv = np.asarray(Image.fromarray(h.astype(np.uint8)).convert("HSV"), np.float32)
    H_, S_, V_ = hsv[..., 0] * 360 / 255, hsv[..., 1] / 255, hsv[..., 2] / 255
    red = ((H_ > 330) | (H_ < 22)) & (S_ > 0.38) & (V_ > 0.12)
    m = red.astype(np.float32)
    if a.robe:
        m *= np.asarray(Image.open(a.robe).convert("L").resize((HW, HH)), np.float32) / 255
    else:   # the figure's region: inside the painted frame, above the table, the face and hair left alone
        region = (xx > 225) & (xx < 1275) & (yy > 220) & (yy < 948)
        face = ((xx - 750) / 98) ** 2 + ((yy - 448) / 142) ** 2 < 1
        m *= (region & ~face).astype(np.float32)
    m = gaussian_filter(m, 1.2)[..., None]
    # target hue and how to scale saturation/value for each colourway (tuned so the three read as equals)
    tgt = {"green": (152, 0.66, 0.78), "blue": (224, 0.60, 0.76)}[col]
    hn = np.full_like(H_, tgt[0] / 360)
    # keep each pixel's own hue offset from garnet (shading variety), shifted to the target
    off = ((H_ + 180) % 360 - 180 - (-6)) / 360 * 0.6
    hn = (hn + off) % 1.0
    s2 = np.clip(S_ * tgt[1], 0, 1); v2 = np.clip(V_ * tgt[2], 0, 1)
    hsv2 = np.stack([hn * 255, s2 * 255, v2 * 255], -1).astype(np.uint8)
    rgb2 = np.asarray(Image.fromarray(hsv2, "HSV").convert("RGB"), np.float32)
    save(h * (1 - m) + rgb2 * m, out)
print(a.mode, a.files[-1] if a.mode != "split" else a.files[1] + "-L/R")
