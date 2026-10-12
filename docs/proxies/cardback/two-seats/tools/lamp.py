# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats (sleeve): the lamp, the coach's light, on the seam.
#   lamp.py guide <half.png> <out.png>     the whole card's centre (both halves: the half and its 180-degree
#       twin), 360x360 sleeve px round the seam's centre, at 1024x1024, with a glass globe drawn over it: a lit
#       core, an amber glass body with a dark Fresnel rim and a bright edge, curved window reflections, a gilt
#       beaded band round its equator (on the seam) with a knop at each end, and a warm pool on the table.
#   lamp.py paste <half.png> <painted.png> <out.png>   the painted crop's TOP half back into the half; the
#       bottom half of the card is its rotation, so the lamp is 180-degree symmetric by construction.
import math, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter

HW, HH, SEAM, CXF = 1500, 1052, 1050, 750
R0 = 180                     # half the crop, sleeve px
LAMP_R = 88                  # the globe's radius, sleeve px
N = 1024; K = N / (2 * R0)
mode = sys.argv[1]


def full_centre(half):
    h = np.asarray(Image.open(half).convert("RGB").resize((HW, HH), Image.LANCZOS), np.float32)
    top = h[SEAM - R0:SEAM, CXF - R0:CXF + R0]
    return np.concatenate([top, top[::-1, ::-1]], 0)


if mode == "guide":
    half, out = sys.argv[2:4]
    c = full_centre(half)
    a = np.asarray(Image.fromarray(c.astype(np.uint8)).resize((N, N), Image.LANCZOS), np.float32)
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    cx = cy = N / 2
    R = LAMP_R * K
    d = np.hypot(xx - cx, yy - cy); r = d / R
    # the table under and round the globe: dark walnut (whatever was painted there), a warm pool of light on it
    tab = (np.abs(yy - cy) < 92 * K)[..., None].astype(np.float32)
    tab = gaussian_filter(tab, (6, 0, 0))
    a = a * (1 - tab * 0.8) + np.array([54, 34, 24]) * tab * 0.8
    pool = np.exp(-(np.hypot(xx - cx, (yy - cy) * 1.5) / (R * 2.0)) ** 2)
    a = a + (np.array([250, 188, 110]) - a) * (pool * 0.38 * (0.4 + 0.6 * tab[..., 0]))[..., None]
    inside = np.clip((1 - r) * R / 3, 0, 1)
    # the glass globe, lit from within: brightest at the heart (white-gold), deepening to amber and a dark
    # honey edge, a bright rim where the glass turns away, faint window reflections; it is the lightest thing
    # on the card, so it reads as a light and not as a brass ball
    behind = a.copy()
    c0, c1, c2 = np.array([255, 244, 214.]), np.array([246, 186, 96.]), np.array([168, 96, 40.])
    t1 = np.clip(r / 0.62, 0, 1)[..., None]; t2 = np.clip((r - 0.62) / 0.36, 0, 1)[..., None]
    body = np.where(r[..., None] < 0.62, c0 * (1 - t1 ** 1.6) + c1 * t1 ** 1.6, c1 * (1 - t2) + c2 * t2)
    body = body * 0.88 + behind * 0.12
    body = body + np.array([70, 60, 40]) * np.exp(-((r - 0.975) / 0.018) ** 2)[..., None]
    for (rr, w, a0, a1, st) in ((0.80, 0.03, 200, 250, 60), (0.70, 0.02, 206, 234, 40)):
        ang = (np.degrees(np.arctan2(yy - cy, xx - cx)) + 360) % 360
        band = gaussian_filter((np.exp(-((r - rr) / w) ** 2) * ((ang > a0) & (ang < a1))).astype(np.float32), 2)
        body = body + st * band[..., None]
    a = a * (1 - inside[..., None]) + body * inside[..., None]
    # its light on the room: a soft warm bloom round the globe
    bloom = np.exp(-((r - 1) / 0.45) ** 2) * (r > 1)
    a = a + (np.array([255, 210, 140]) - a) * (bloom * 0.45)[..., None]
    # the gilt band on the seam, beaded, with knops
    im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)); dr = ImageDraw.Draw(im)
    bh = 16 * K; bw = R * 1.02
    for i in range(int(bh)):
        t = i / bh; v = 0.58 + 0.6 * math.sin(t * math.pi) ** 0.8 - 0.15 * t
        col = tuple(int(min(255, c * v)) for c in (170, 128, 60))
        dr.line([(cx - bw, cy - bh / 2 + i), (cx + bw, cy - bh / 2 + i)], fill=col)
    for k in range(-12, 13):
        x = cx + k * (bw / 12.8)
        dr.ellipse([x - 2.2 * K, cy - 2.2 * K, x + 2.2 * K, cy + 2.2 * K], fill=(232, 198, 124))
    im.save(out)
elif mode == "paste":
    half, painted, out = sys.argv[2:5]
    h = np.asarray(Image.open(half).convert("RGB").resize((HW, HH), Image.LANCZOS), np.float32).copy()
    p = np.asarray(Image.open(painted).convert("RGB").resize((2 * R0, 2 * R0), Image.LANCZOS), np.float32)
    top = p[:R0 + 2]
    yy, xx = np.mgrid[0:R0 + 2, 0:2 * R0].astype(np.float32)
    d = np.hypot(xx - R0, (yy - R0) * 1.6)          # flattened: the table band, not the hands above it
    m = np.clip((R0 - 14 - d) / 46, 0, 1)[..., None]
    reg = h[SEAM - R0:SEAM + 2, CXF - R0:CXF + R0]
    h[SEAM - R0:SEAM + 2, CXF - R0:CXF + R0] = reg * (1 - m) + top * m
    Image.fromarray(np.clip(h, 0, 255).astype(np.uint8)).save(out)
print(mode, sys.argv[-1])
