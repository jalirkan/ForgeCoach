# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, order 1, one pass: the GUIDE for the one painted pass over the whole figure.
#   guide.py pre      -> work/guide-pre.png, comp/pre-in.png               (run in two-seats-work/order1/onepass)
#   guide.py guide <prepass.png> -> work/guide.png, comp/guide-in.png, comp/guide-mask.png, work/guide-masks.npz
#
# Inputs: round 8's form (comp/r8.png, fc-lanes two-seats-r8 round8/two-seats-garnet-man.png) lifted off its punched
# gold by order-1/tools/lift.py (work/lift-garnet.npz: the figure premultiplied, P, and its matte, alpha); round 7's
# drawn torso mask (../../round7/comp/dm-garnet.png); Ground A2 (work/groundA2-top.png, groundA2.py).
#
# pre:   the figure is laid on Ground A2 with its shoulders made unequal: a smooth vertical displacement, zero on the
#        hood, the face and the cape (above y 530) and at the hem (below y 920), raises the viewer's left shoulder by
#        up to 16 px (x < 660, full from x 480) and drops the right one by up to 6 px (x > 840, full from x 1020). The
#        hands and the fan (x 600-900) are not moved. The crop CROP is written at PAINT px for the guide's own quick
#        img2img (strength 0.60): the drawn torso is turned into a soft painted body there.
# guide: that quick pass goes back in through the warped drawn torso mask only (the hood, cape and face stay round
#        8's pixels, which are the final's), feathered 2 px, and the GUIDE is the result: the starting point of the
#        one pass. Its inpaint mask is the warped figure grown by MARGIN px, less the table band (y >= 944) and the
#        props standing above it; it is also saved at paint size.
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates, gaussian_filter, binary_dilation, distance_transform_edt

SEAM, HW, TABLE = 1050, 1500, 944
CROP = (350, 180, 1150, 980)          # 800 x 800, painted at 1152 x 1152 (1.44x)
PAINT = 1152
MARGIN = 48
yy, xx = np.mgrid[0:SEAM, 0:HW].astype(np.float32)
def ss(a, b, v):                       # smoothstep from a (0) to b (1); a > b allowed
    t = np.clip((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
wy = ss(530, 600, yy) * (1 - ss(800, 920, yy))
dy = -16 * ss(660, 480, xx) * wy + 6 * ss(840, 1020, xx) * wy
def warp(a):
    if a.ndim == 3:
        return np.stack([warp(a[..., c]) for c in range(a.shape[2])], -1)
    return map_coordinates(a, [yy - dy, xx], order=1, mode="nearest")

Z = np.load("work/lift-garnet.npz")
P, alpha = Z["P"].astype(np.float32), Z["alpha"].astype(np.float32)
G = np.asarray(Image.open("work/groundA2-top.png").convert("RGB"), np.float32)
Pw, aw = warp(P), np.clip(warp(alpha), 0, 1)
aw[TABLE:] = 0; Pw[TABLE:] = 0
face = ((xx - 750) / 115) ** 2 + ((yy - 405) / 145) ** 2 < 1
dm = np.asarray(Image.open("../../round7/comp/dm-garnet.png").convert("L"), np.float32)[:SEAM] / 255
dm[face] = 0; dm[TABLE:] = 0
dmw = np.clip(warp(dm), 0, 1)
assert np.abs(dy[face]).max() == 0, "the face moved"

def lay(fig, a):
    o = G.copy(); o[:TABLE] = fig[:TABLE] + (1 - a[:TABLE, :, None]) * G[:TABLE]; return o
x0, y0, x1, y1 = CROP
def crop_out(img, path, mode="RGB"):
    im = Image.fromarray(np.round(np.clip(img, 0, 255)).astype(np.uint8)[y0:y1, x0:x1])
    im.resize((PAINT, PAINT), Image.LANCZOS if mode == "RGB" else Image.BILINEAR).save(path)

def pushpull(img, m):
    if min(m.shape) < 4:
        tot = (img * m[..., None]).sum((0, 1)) / max(m.sum(), 1e-6)
        return np.broadcast_to(tot, img.shape).copy()
    Hh, Ww = m.shape
    H2, W2 = (Hh + 1) // 2, (Ww + 1) // 2
    pm_ = np.zeros((H2 * 2, W2 * 2), np.float32); pm_[:Hh, :Ww] = m
    pi = np.zeros((H2 * 2, W2 * 2, 3), np.float32); pi[:Hh, :Ww] = img * m[..., None]
    sm_ = pm_.reshape(H2, 2, W2, 2).sum((1, 3)); si = pi.reshape(H2, 2, W2, 2, 3).sum((1, 3))
    low = pushpull(si / np.maximum(sm_, 1e-6)[..., None], (sm_ > 0).astype(np.float32))
    up = gaussian_filter(np.repeat(np.repeat(low, 2, 0), 2, 1)[:Hh, :Ww], (1, 1, 0))
    return img * m[..., None] + up * (1 - m[..., None])
def fix(img, region, bad, good):
    """fill the `bad` pixels of `region` from its `good` pixels (push-pull), grown 2 px, feathered 1.5 px"""
    hsv = np.asarray(Image.fromarray(np.round(np.clip(img, 0, 255)).astype(np.uint8)).convert("HSV"), np.float32) / 255
    L = img @ np.array([.2126, .7152, .0722], np.float32); S = hsv[..., 1]
    b = binary_dilation(region & bad(L, S), iterations=2) & region
    gd = region & good(L, S) & ~b
    ys, xs = np.nonzero(region); y0_, y1_, x0_, x1_ = ys.min() - 8, ys.max() + 9, xs.min() - 8, xs.max() + 9
    fill = img.copy()
    fill[y0_:y1_, x0_:x1_] = pushpull(img[y0_:y1_, x0_:x1_], gd[y0_:y1_, x0_:x1_].astype(np.float32))
    w = np.clip(gaussian_filter(b.astype(np.float32), 1.5) * 1.5, 0, 1) * binary_dilation(b, iterations=3)
    print("  fix:", int(b.sum()), "px filled")
    return img * (1 - w[..., None]) + fill * w[..., None]

def recolour(img, region, bad, good):
    """the `bad` pixels of `region` take the mean colour of its `good` ones, keeping their own light and dark
    (colour = good mean x L / mean L of the bad), grown 2 px, feathered 1.5 px: white page edges become dark card
    faces with their stripes"""
    hsv = np.asarray(Image.fromarray(np.round(np.clip(img, 0, 255)).astype(np.uint8)).convert("HSV"), np.float32) / 255
    L = img @ np.array([.2126, .7152, .0722], np.float32); S = hsv[..., 1]
    b = binary_dilation(region & bad(L, S), iterations=2) & region
    gd = region & good(L, S) & ~b
    fill = img[gd].mean(0)[None, None, :] * (L / L[b].mean())[..., None]
    w = np.clip(gaussian_filter(b.astype(np.float32), 1.5) * 1.5, 0, 1) * binary_dilation(b, iterations=3)
    print("  recolour:", int(b.sum()), "px")
    return img * (1 - w[..., None]) + fill * w[..., None]

stage = sys.argv[1]
pre = lay(Pw, aw)
if stage == "pre":
    Image.fromarray(np.round(np.clip(pre, 0, 255)).astype(np.uint8)).save("work/guide-pre.png")
    crop_out(pre, "comp/pre-in.png")
    print("pre ok; max shoulder shift", float(dy.min()), float(dy.max()))
elif stage == "guide":
    q = np.asarray(Image.open(sys.argv[2]).convert("RGB").resize((x1 - x0, y1 - y0), Image.LANCZOS), np.float32)
    full = pre.copy(); full[y0:y1, x0:x1] = q
    m = gaussian_filter(dmw, 2.0) * (dmw > 0.002)
    m[face] = 0; m[TABLE:] = 0
    g = pre * (1 - m[..., None]) + full * m[..., None]
    # two hand-blends on the guide (a starting point, not the card), after the first batch showed both carried
    # through every seed: (a) the quick pass painted the fan's lower-left cards as white page edges; those pixels
    # (bright, unsaturated, in the fan's lower left) take the dark card faces' mean colour (luma < 90, saturation
    # < 0.5) at their own relative lightness, so the page stripes become card stripes, feathered 1.5 px (a soft
    # push-pull fill was tried first, batch 2: the passes at 0.40-0.45 kept it as a brown smudge); (b) it painted the tankard as a lidded jug whose lid and knob
    # stand above the final's tankard; the final's tankard (round 8's prop mask grown 3 px) goes into the guide,
    # and the grey of the old lid round it (grey, within 40 px of it; and the lid's finial, x 490-531, y 896-922, wherever it
    # stands 8 levels off its 6 px surround) is filled with the robe
    # round it the same way. So the guide agrees with the props that are laid back after the pass.
    g = recolour(g, (yy > 740) & (yy < 870) & (xx > 590) & (xx < 740), lambda L, S: (L > 115) & (S < 0.32), lambda L, S: (L < 90) & (S < 0.5))
    pm = np.asarray(Image.open("../../round8/final/two-seats-garnet-man-propmask.png").convert("L"))[:SEAM] > 0
    pmd = binary_dilation(pm, iterations=3) & (yy < TABLE)
    U = np.asarray(Image.open("../work/final-unlifted-garnet.png").convert("RGB"), np.float32)[:SEAM]
    near = binary_dilation(pm, iterations=40) & ~pmd & (yy < TABLE) & (xx < 750)
    g = fix(g, near, lambda L, S: S < 0.35, lambda L, S: S > 0.45)
    knob = (yy >= 896) & (yy < 923) & (xx >= 490) & (xx < 532)          # the old lid's finial, above the rim
    g = fix(g, knob, lambda L, S: np.abs(L - gaussian_filter(L, 6)) > 8, lambda L, S: np.abs(L - gaussian_filter(L, 6)) <= 8)
    g[pmd] = U[pmd]
    Image.fromarray(np.round(np.clip(g, 0, 255)).astype(np.uint8)).save("work/guide.png")
    crop_out(g, "comp/guide-in.png")
    pm = np.asarray(Image.open("../../round8/final/two-seats-garnet-man-propmask.png").convert("L"))[:SEAM] > 0
    fig = aw > 0.5
    pmask = binary_dilation(fig, iterations=MARGIN) & (yy < TABLE) & ~binary_dilation(pm, iterations=4)
    crop_out(pmask.astype(np.float32) * 255, "comp/guide-mask.png", mode="L")
    np.savez_compressed("work/guide-masks.npz", aw=aw, dmw=dmw, pmask=pmask, dy=dy)
    print("guide ok; paint mask px", int(pmask.sum()), "figure px", int(fig.sum()))
