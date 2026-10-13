# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 3: the hand of cards, laid into the painted half BEHIND the painting's own hands.
# The composition pass paints the person, the table, the lamp and the light, but will not paint a held hand
# of cards (it either drops them or paints card faces), so the cards are drawn here -- plain dark backs with a
# thin gilt edge, lit from below -- and the painting's own fingers are laid back over them by a skin mask; the
# hands-and-cards crop is then repainted at 2x (refine.py), which paints the grip and the cards into the picture.
# Usage: cards.py <half.png> <out.png> --pivot X,Y --n 6 --spread 52 --tilt -6 --len 330 [--hands x0,y0,x1,y1]
import argparse
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, binary_opening, binary_dilation
ap = argparse.ArgumentParser()
ap.add_argument("half"); ap.add_argument("out")
ap.add_argument("--pivot", required=True); ap.add_argument("--n", type=int, default=6)
ap.add_argument("--spread", type=float, default=50); ap.add_argument("--tilt", type=float, default=0)
ap.add_argument("--len", type=float, default=320); ap.add_argument("--hands", default=None)
ap.add_argument("--seed", type=int, default=1)
ap.add_argument("--nokeep", default=None, help="x0,y0,x1,y1: no painted pixel is laid back over the cards here (a gilt stick the skin test takes for a finger)")
ap.add_argument("--erase", default=None, help="x0,y0,x1,y1: paint out the painted card faces (bright, greyish) in this box first"); ap.add_argument("--mask-out", default=None)
a_ = ap.parse_args()
im = np.asarray(Image.open(a_.half).convert("RGB"), np.float32).copy()
H, W = im.shape[:2]
if a_.erase:   # the model's own card faces: fill them from the surrounding cloth (normalised blur), the repaint redraws the folds
    x0, y0, x1, y1 = map(int, a_.erase.split(","))
    mx, mn = im.max(-1), im.min(-1)
    face = (mx > 120) & ((mx - mn) < 0.45 * mx)
    face = (mx > 110) & ~((im[..., 0] > im[..., 1] + 8) & (im[..., 0] - im[..., 2] > 30)) | face
    box = np.zeros_like(face); box[y0:y1, x0:x1] = True
    hole = binary_dilation(face & box, iterations=4)
    keep = (~hole).astype(np.float32)
    num = gaussian_filter(im * keep[..., None], (24, 24, 0)); den = gaussian_filter(keep, 24)[..., None]
    fill = num / np.maximum(den, 1e-3)
    im = np.where(hole[..., None], fill, im)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
px, py = map(float, a_.pivot.split(","))
rng = np.random.default_rng(a_.seed)
L = a_.len; Wc = L * 63 / 88
cov = np.zeros((H, W), np.float32)
out = im.copy()
angs = np.linspace(-a_.spread / 2, a_.spread / 2, a_.n) + a_.tilt
for k, ang in enumerate(angs):
    ang = np.deg2rad(ang + rng.uniform(-2, 2)); sl = rng.uniform(-10, 14)        # a hand is never machine-cut
    u = (xx - px) * np.cos(ang) + (yy - py) * np.sin(ang)
    v = -(xx - px) * np.sin(ang) + (yy - py) * np.cos(ang)
    v0, v1 = -0.18 * L + sl, -L + sl * 0.4                                    # held near the bottom of the card
    cu = np.clip(np.minimum(Wc / 2 - np.abs(u), np.minimum(v0 - v, v - v1)), -1, 60)
    card = np.clip(cu + 0.5, 0, 1)                                             # antialiased edge
    edge = np.clip(1 - np.abs(cu - 4.5) / 2.2, 0, 1) * card                    # the thin gilt edge, inset 4 px
    rim = np.clip(1 - cu / 1.5, 0, 1) * card                                   # a dark outline so cards separate
    t = np.clip((v - v1) / (v0 - v1), 0, 1)                                    # 0 at the top, 1 at the grip
    light = 0.75 + 0.45 * t ** 1.5                                             # lamp below: brighter toward the grip
    base = np.array([44, 40, 54], np.float32)[None, None] * light[..., None]
    sheen = gaussian_filter(rng.normal(0, 1, (H // 8 + 1, W // 8 + 1)), 2).repeat(8, 0).repeat(8, 1)[:H, :W]
    base = base * (1 + 0.05 * sheen[..., None])
    col = base * (1 - edge[..., None]) + np.array([200, 162, 92], np.float32) * (0.7 + 0.4 * t[..., None]) * edge[..., None]
    col = col * (1 - 0.6 * rim[..., None])
    # each card shades the one behind it a little along its left edge
    shadow = np.clip(1 - np.abs(u + Wc / 2 + 6) / 10, 0, 1) * (v < v0) * (v > v1) * (1 - card)
    out = out * (1 - 0.25 * shadow[..., None])
    out = out * (1 - card[..., None]) + col * card[..., None]
    cov = np.maximum(cov, card)
if a_.hands:
    x0, y0, x1, y1 = map(int, a_.hands.split(","))
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    skin = (r > g + 8) & (g > b) & (r - b > 30) & (r > 105) & (r - b < 120) & (b > 0.45 * r)   # skin, not gilt
    box = np.zeros_like(skin); box[y0:y1, x0:x1] = True
    if a_.nokeep:
        q0, r0, q1, r1 = map(int, a_.nokeep.split(",")); box[r0:r1, q0:q1] = False
    skin = binary_opening(skin & box, iterations=2); skin = binary_dilation(skin, iterations=1)
    m = gaussian_filter(skin.astype(np.float32), 1.2)[..., None]
    out = out * (1 - m) + im * m
    cov = cov * (1 - m[..., 0])
Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(a_.out)
if a_.mask_out:
    Image.fromarray((np.clip(cov, 0, 1) * 255).astype(np.uint8)).save(a_.mask_out)
