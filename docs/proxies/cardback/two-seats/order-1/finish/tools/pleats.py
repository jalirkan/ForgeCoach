# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, orders 1 and 2: the chest pleats. The one pass and its finish had painted round 8's drawn vertical
# fold lines on the chest away; the owner wanted them kept ("Didn't I ask you to protect the lines on the chest?").
# One inpaint over the chest region only, from a guide that carries round 8's lines, on the UNLIFTED top half.
#   pleats.py guide <fig>                         -> work/pleats-guide-top.png, comp/pleats-src.png, comp/pleats-mask.png,
#                                                    work/pleats-alpha.npy, work/pleats-guide-view.png
#   pleats.py paste <fig> <painted.png> <out top.png>
# Run in the figure's working folder (pleats.json "dir"). <fig> is "garnet" (order 1) or "green" (order 2).
#
# The region (pleats.json "poly", card px): between the hood's hem and the forearms, the width of the torso. Inside
# it, the fan and the hands are PROTECTED: every pixel within the fan's box that is not robe-coloured (hue and
# saturation in pleats.json), holes filled, grown 3 px. Nothing outside region - protected can change.
# The guide: round 8's form as the one pass's guide had it (../onepass/work/guide-pre.png: round 8's figure, warped
# for the shoulders, on Ground A2). Its luma, over everything but its own fan and hands (found as above, after an
# opening of 3 px so the thin drawn lines stay cloth), is blurred mostly along the vertical (sigma y 4, x 0.6) and
# divided by its broad local mean (sigma 14): that ratio is the pleat layer, round 8's lines and its darker and lighter
# panels, at the pleats' own directions and spacing. Two layers multiply the current painting, inside the region only:
# the ratio at "opacity", and bands drawn from it (see pleat_layer) at "band_opacity" (pleats.json: 0.50 / 0.50 for
# him, whose red is dark, 0.45 / 0.45 for her).
# The paste: alpha 1 deep inside the region, ramping to 0 over 14 px towards the region's outline (into the robe
# round it) and over 5 px towards the protected fan and hands; 0 everywhere else, so every other pixel is the
# current top's own byte.
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter, binary_fill_holes, binary_dilation, binary_opening, distance_transform_edt, label

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = json.load(open(os.path.join(HERE, "pleats.json")))
SEAM, FEATHER, FANFEATHER = 1050, 14, 5

def ss(t):
    t = np.clip(t, 0, 1); return t * t * (3 - 2 * t)

def hsv(a):
    h = np.asarray(Image.fromarray(a.astype(np.uint8)).convert("HSV"), np.float32)
    return h[..., 0] * 360 / 255, h[..., 1] / 255, h[..., 2] / 255

def robe(a, c):
    H, S, V = hsv(a)
    hue = np.zeros(H.shape, bool)
    for lo, hi in c["robe_hue"]:
        hue |= (H >= lo) & (H <= hi)
    return hue & (S >= c["robe_sat"]) & (V > 0.08)

def fanhands(a, c, opening=0):
    x0, y0, x1, y1 = c["fan_box"]
    fb = np.zeros(a.shape[:2], bool); fb[y0:y1, x0:x1] = True
    nr = fb & ~robe(a, c)
    if opening:                               # round 8's drawn lines are dark and thin: they are cloth, not fan
        nr = binary_opening(nr, iterations=opening)
    nr = binary_fill_holes(nr)
    lab, n = label(nr); sizes = np.bincount(lab.ravel()); sizes[0] = 0
    return (sizes >= 400)[lab]                # the fan and the hands; a stray dark fold pixel is not protected

def masks(c, top):
    reg = Image.new("L", (1500, SEAM), 0); ImageDraw.Draw(reg).polygon([tuple(p) for p in c["poly"]], fill=255)
    reg = np.asarray(reg) > 0
    nr = fanhands(top, c)
    prot = binary_dilation(nr, iterations=3)
    allowed = reg & ~prot
    d_out = distance_transform_edt(reg)
    d_fan = distance_transform_edt(~prot)
    alpha = np.minimum(ss(d_out / FEATHER), ss(d_fan / FANFEATHER)) * allowed
    return reg, prot, alpha.astype(np.float32)

def pleat_layer(c, top_shape):
    R = np.asarray(Image.open(c["r8"]).convert("RGB"))[:SEAM]
    L = R.astype(np.float32) @ np.array([.2126, .7152, .0722], np.float32)
    w = (~binary_dilation(fanhands(R, c, opening=3), iterations=3)).astype(np.float32)
    sv = (4, 0.6)
    num, den = gaussian_filter(L * w, sv), gaussian_filter(w, sv)
    Lv = num / np.maximum(den, 1e-4)
    bn, bd = gaussian_filter(L * w, 14), gaussian_filter(w, 14)
    Lb = bn / np.maximum(bd, 1e-4)
    conf = np.clip(den / 0.6, 0, 1) * np.clip(bd / 0.5, 0, 1)
    ratio = 1 + conf * (Lv / np.maximum(Lb, 1) - 1)
    ratio = np.clip(ratio, 0.35, 1.6)
    # the bands: where round 8 drew a line (its ratio under 0.85, full at 0.6), a band of the cloth's own deep shadow
    # (x band_dark: 0.35 on her teal, 0.2 on his darker red), widened to ~6 px; beside it, 6 px to the viewer's left, a softer band of lit cloth (x 1.35), the fold's
    # ridge. Both at "band_opacity".
    m = np.clip((0.85 - ratio) / 0.25, 0, 1) * (w > 0)
    dark = gaussian_filter(m, (2.0, 1.4)); dark = np.clip(dark / max(np.percentile(dark[dark > 0.05], 95), 1e-3), 0, 1)
    light = np.roll(gaussian_filter(m, (2.0, 2.5)), -6, axis=1); light = np.clip(light / max(np.percentile(light[light > 0.05], 95), 1e-3), 0, 1) * (1 - dark)
    return ratio, dark, light

cmd, fig = sys.argv[1:3]
c = CFG[fig]
top = np.asarray(Image.open(c["top"]).convert("RGB"))
assert top.shape == (SEAM, 1500, 3)
bx0, by0, bx1, by1 = c["box"]; s = c["scale"]
W, H = round((bx1 - bx0) * s), round((by1 - by0) * s)
assert W % 8 == 0 and H % 8 == 0
reg, prot, alpha = masks(c, top)
if cmd == "guide":
    ratio, dark, light = pleat_layer(c, top.shape)
    k, kb = c["opacity"], c["band_opacity"]
    f = (1 + k * (ratio - 1)) * (1 + kb * ((c["band_dark"] - 1) * dark + (1.35 - 1) * light))
    g = top.astype(np.float32) * f[..., None]
    g = np.where((reg & ~prot)[..., None], g, top.astype(np.float32))
    g = np.round(np.clip(g, 0, 255)).astype(np.uint8)
    os.makedirs("comp", exist_ok=True)
    Image.fromarray(g).save("work/pleats-guide-top.png")
    np.save("work/pleats-alpha.npy", alpha)
    Image.fromarray(g[by0:by1, bx0:bx1]).resize((W, H), Image.LANCZOS).save("comp/pleats-src.png")
    # the inpaint mask: where the paste may land (alpha > 0), grown 6 px, never into the protected fan and hands
    im = binary_dilation(alpha > 0, iterations=6) & ~binary_dilation(prot, iterations=0) & reg
    Image.fromarray((im[by0:by1, bx0:bx1] * 255).astype(np.uint8)).resize((W, H), Image.NEAREST).save("comp/pleats-mask.png")
    v = g.copy(); v[prot] = (v[prot] * 0.5 + np.array([0, 160, 255]) * 0.5).astype(np.uint8)
    Image.fromarray(v[by0:by1, bx0:bx1]).resize((W, H), Image.LANCZOS).save("work/pleats-guide-view.png")
    print(fig, "region px", int(reg.sum()), "protected px", int((prot & reg).sum()), "alpha>0 px", int((alpha > 0).sum()))
elif cmd == "paste":
    painted, out = sys.argv[3:5]
    q = np.asarray(Image.open(painted).convert("RGB").resize((bx1 - bx0, by1 - by0), Image.LANCZOS), np.float32)
    a = alpha[by0:by1, bx0:bx1, None]
    n = top.astype(np.float32).copy()
    n[by0:by1, bx0:bx1] = n[by0:by1, bx0:bx1] * (1 - a) + q * a
    n = np.round(np.clip(n, 0, 255)).astype(np.uint8)
    assert np.array_equal(n[alpha == 0], top[alpha == 0])
    Image.fromarray(n).save(out)
    print(out, "changed px", int((n != top).any(-1).sum()), "of alpha>0", int((alpha > 0).sum()))
