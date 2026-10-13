# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 4: put a repainted face tile and a repainted hands tile back into a FIRST DRAFT, and nothing else.
#   fix.py <draft.png> <n> <face-tile.png> <hands-tile.png> <out.png> [--mask-dir DIR]
# The draft is exactly 180-degree symmetric (its bottom half is the top half turned), so the patches go on the top
# half and the bottom half is rebuilt as the top half rotated: everything outside the two patches is the draft's
# own pixels, byte for byte, top and bottom.
#   face:  the tile, resized back to its box, pasted through a feathered ellipse inscribed in "keep".
#   hands: the tile pasted only where either the draft or the tile is skin (hue 0-35 deg, saturation 0.04-0.62 (the pale cuffs and knuckle lights count),
#          not dark), dilated and feathered, inside "keep" -- so the card fan, its gold edges and the lamp's neck
#          keep their own pixels.
#   Both: the tile's mean brightness inside the mask is shifted back to the draft's (hue is left to the repaint,
#         because the sallow green cast on face 2 was one of the faults),
#         and no pasted pixel is more chromatic than the most chromatic pixel the draft had in that box.
import json, os, sys
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, binary_dilation, binary_opening
HERE = os.path.dirname(os.path.abspath(__file__))
src, n, ftile, htile, out = sys.argv[1:6]
mdir = sys.argv[sys.argv.index("--mask-dir") + 1] if "--mask-dir" in sys.argv else None
R = json.load(open(os.path.join(HERE, "regions.json")))[n]
a = np.asarray(Image.open(src).convert("RGB"), np.float32)
H, W = a.shape[:2]; assert (H, W) == (2220, 1632)
d = a.copy()

def chroma(x):
    return x.max(-1) - x.min(-1)

def skin(x):
    r, g, b = x[..., 0], x[..., 1], x[..., 2]
    mx, mn = x.max(-1), x.min(-1); s = (mx - mn) / np.maximum(mx, 1)
    hue = np.where(mx == r, 60 * ((g - b) / np.maximum(mx - mn, 1)), 999)
    return (hue >= -5) & (hue <= 35) & (s > 0.04) & (s < 0.62) & (mx > 120)

def paste(kind, tile_path):
    x0, y0, x1, y1 = R[kind]["box"]; k0, l0, k1, l1 = R[kind]["keep"]
    t = np.asarray(Image.open(tile_path).convert("RGB").resize((x1 - x0, y1 - y0), Image.LANCZOS), np.float32)
    o = a[y0:y1, x0:x1]
    h, w = o.shape[:2]; yy, xx = np.mgrid[0:h, 0:w]
    kx0, ky0, kx1, ky1 = k0 - x0, l0 - y0, k1 - x0, l1 - y0
    if kind == "face":
        cx, cy, rx, ry = (kx0 + kx1) / 2, (ky0 + ky1) / 2, (kx1 - kx0) / 2, (ky1 - ky0) / 2
        m = ((((xx - cx) / (rx - 10)) ** 2 + ((yy - cy) / (ry - 10)) ** 2) < 1).astype(np.float32)
        m = gaussian_filter(m, 9)
    else:
        rect = np.zeros((h, w), bool); rect[ky0:ky1, kx0:kx1] = True
        sk = binary_opening(skin(o) | skin(t), iterations=1)
        sk = binary_dilation(sk, iterations=5) & rect
        m = gaussian_filter(sk.astype(np.float32), 3) * gaussian_filter(rect.astype(np.float32), 6)
    mm = m[..., None]
    wsum = m.sum()
    lum = lambda x: x @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    shift = float(((lum(o) - lum(t)) * m).sum() / max(wsum, 1))   # the draft's own brightness, not the model's
    t = t + shift
    cap = np.percentile(chroma(o), 99.9)                       # no pixel more chromatic than the draft's own
    c = chroma(t); grey = t.mean(-1, keepdims=True)
    f = np.where(c > cap, cap / np.maximum(c, 1), 1)[..., None]
    t = grey + (t - grey) * f
    d[y0:y1, x0:x1] = o * (1 - mm) + t * mm
    if mdir:
        Image.fromarray((m * 255).astype(np.uint8)).save(os.path.join(mdir, f"{n}-{kind}-mask.png"))
    print(f"{kind}: box {R[kind]['box']} brightness shift {shift:+.1f} chroma cap {cap:.0f}")

paste("face", ftile)
paste("hands", htile)
top = d[:H // 2]
d[H // 2:] = top[::-1, ::-1]
d = np.clip(np.round(d), 0, 255).astype(np.uint8)
ch = np.abs(d.astype(int) - a.astype(int)).max(-1) > 0
ys, xs = np.nonzero(ch[:H // 2])
print(f"changed pixels: {ch.sum()} ({ch.mean() * 100:.2f}% of the card); top-half bbox x {xs.min()}-{xs.max()} y {ys.min()}-{ys.max()}")
Image.fromarray(d).save(out, dpi=(600, 600))
