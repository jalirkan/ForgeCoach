# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 2: the guide for one character's body pass, built on round 1's pre-light half (c1-h).
#   prep.py <r1-half.png> <draft.png> <green|garnet|blue> <out.png>
# - the round-1 fan of seven big cards is taken out: the cloak's opening is redrawn as the character's own
#   gown or doublet, with the fur lining continued up to the neck (the new, smaller fan is drawn later by fan.py)
# - the cloak is turned to the character's colour (garnet stays garnet)
# - the first draft's face and hair (direction/two-seats-N.png) are scaled to round 1's head and laid into the
#   hood, their skin pulled toward round 1's warm tones
# - round 1's painted hands stay where they were
import sys
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter

HW, HH = 1500, 1052
src, draft, ch, out = sys.argv[1:5]
h = np.asarray(Image.open(src).convert("RGB"), np.float32).copy()
yy, xx = np.mgrid[0:HH, 0:HW].astype(np.float32)
rng = np.random.default_rng(7)

C = {   # cloak target (hue deg, sat scale, val scale); gown colour; the draft's eye y, chin y, face centre x
    "green":  dict(cloak=(158, 0.70, 0.80), gown=(118, 46, 58), eye=355, chin=475, cx=816, rx=92, ry=74, fy=508),
    "garnet": dict(cloak=None,              gown=(52, 40, 36),  eye=348, chin=480, cx=816, rx=64, ry=96, fy=488),
    "blue":   dict(cloak=(222, 0.62, 0.74), gown=(150, 108, 52), eye=342, chin=455, cx=811, rx=76, ry=87, fy=497),
}[ch]

# 1. the cloak's colour (round 1's recolour: the red of the figure, the face left alone)
hsv = np.asarray(Image.fromarray(h.astype(np.uint8)).convert("HSV"), np.float32)
H_, S_, V_ = hsv[..., 0] * 360 / 255, hsv[..., 1] / 255, hsv[..., 2] / 255
if C["cloak"]:
    red = ((H_ > 330) | (H_ < 22)) & (S_ > 0.38) & (V_ > 0.12)
    region = (xx > 225) & (xx < 1275) & (yy > 220) & (yy < 948)
    face = ((xx - 750) / 98) ** 2 + ((yy - 448) / 142) ** 2 < 1
    m = gaussian_filter((red & region & ~face).astype(np.float32), 1.2)[..., None]
    tg, ss, vs = C["cloak"]
    off = ((H_ + 180) % 360 - 180 + 6) / 360 * 0.6
    hn = (tg / 360 + off) % 1.0
    hsv2 = np.stack([hn * 255, np.clip(S_ * ss, 0, 1) * 255, np.clip(V_ * vs, 0, 1) * 255], -1).astype(np.uint8)
    rgb2 = np.asarray(Image.fromarray(hsv2, "HSV").convert("RGB"), np.float32)
    h = h * (1 - m) + rgb2 * m

# 2. the opening of the cloak, neck to table: the gown (bodice and two sleeves running to round 1's hands),
#    with folds, and the fur lining along both edges of the cloak
SS = 3
def poly(pts):
    mk = Image.new("L", (HW * SS, HH * SS), 0); ImageDraw.Draw(mk).polygon([(x * SS, y * SS) for x, y in pts], fill=255)
    return np.asarray(mk.resize((HW, HH), Image.LANCZOS), np.float32) / 255
op = [(712, 585), (788, 585), (968, 760), (1030, 960), (470, 960), (532, 760)]
om = poly(op)
folds = gaussian_filter(rng.normal(0, 1, (HH, HW // 18 + 2)).astype(np.float32), (0, 0.8))
folds = np.asarray(Image.fromarray(folds).resize((HW, HH), Image.BICUBIC), np.float32)
folds = gaussian_filter(folds, (8, 3))
side = np.clip(np.abs(xx - 750) / 260, 0, 1)
G = np.array(C["gown"], np.float32)
gown = G * (1.0 + 0.16 * folds - 0.30 * side ** 2 + 0.08 * np.clip((yy - 600) / 300, 0, 1))[..., None]
gown += gaussian_filter(rng.normal(0, 3, (HH, HW)), 0.8)[..., None]
h = h * (1 - om[..., None]) + gown * om[..., None]
# the sleeves: forearms from under the cloak to the wrists of round 1's hands, lit on top, shadowed beneath
for pts, ax in (([(505, 790), (585, 765), (690, 860), (660, 925), (600, 935), (490, 905)], (1, 0.55)),
                ([(995, 790), (915, 765), (820, 862), (850, 935), (905, 945), (1012, 905)], (-1, 0.55))):
    sm = poly(pts)
    top = np.clip(1 - (yy - 770) / 160, 0, 1)
    sl = G * (0.78 + 0.32 * top + 0.12 * folds)[..., None]
    h = h * (1 - sm[..., None]) + sl * sm[..., None]
    edge = gaussian_filter(sm, 6) * (1 - sm)
    h *= (1 - 0.45 * edge)[..., None]
for (xa, ya), (xb, yb) in (((712, 585), (532, 760)), ((532, 760), (470, 960)), ((788, 585), (968, 760)), ((968, 760), (1030, 960))):
    fm = Image.new("L", (HW, HH), 0)
    ImageDraw.Draw(fm).line([(xa, ya), (xb, yb)], fill=255, width=26)
    fm = gaussian_filter(np.asarray(fm, np.float32) / 255, 3) * om
    fur = np.array([128, 94, 62], np.float32) * (1 + 0.18 * gaussian_filter(rng.normal(0, 1, (HH, HW)), (2.5, 0.8)))[..., None]
    h = h * (1 - fm[..., None]) + fur * fm[..., None]
# a linen neckline at the top of the opening
nk = np.exp(-(((xx - 750) / 46) ** 2 + ((yy - 596) / 9) ** 2))
h = h + (np.array([226, 214, 192]) - h) * (0.85 * nk)[..., None]
# round 1's painted hands back on top (skin and the pale cuff, by colour, inside the hands' box)
r1h = np.asarray(Image.open(src).convert("RGB"), np.float32)
hs = np.asarray(Image.fromarray(r1h.astype(np.uint8)).convert("HSV"), np.float32) / 255
Hh, Sh, Vh = hs[..., 0] * 360, hs[..., 1], hs[..., 2]
from scipy.ndimage import binary_opening, binary_closing, binary_fill_holes, binary_dilation
sk_ = (((Hh < 40) | (Hh > 345)) & (Sh > 0.06) & (Sh < 0.40) & (Vh > 0.55))
bx = np.zeros_like(sk_); bx[790:960, 590:940] = True
hm = binary_dilation(binary_fill_holes(binary_closing(binary_opening(sk_ & bx, iterations=2), iterations=4)), iterations=2)
hm = gaussian_filter(hm.astype(np.float32), 1.6)[..., None]
h = h * (1 - hm) + r1h * hm
Image.fromarray((hm[..., 0] * 255).astype(np.uint8)).save(out[:-4] + "-handmask.png")

# the hood's opening emptied to its dark lining where the character's hair is not round 1's auburn
if ch != "green":
    hd = ((xx - 752) / 112) ** 2 + ((yy - 452) / 142) ** 2
    hd = gaussian_filter((hd < 1).astype(np.float32), 5) * np.clip((566 - yy) / 24, 0, 1)   # round 1's neck stays
    h = h * (1 - hd[..., None]) + np.array([24, 21, 24], np.float32) * hd[..., None]
    # the character's own hair round the face: short and grey-brown for the man, dark to the jaw for the blue
    hc, hr = (np.array([62, 52, 46], np.float32), (70, 92, 482)) if ch == "garnet" else (np.array([52, 36, 27], np.float32), (90, 108, 478))
    hm2 = ((xx - 750) / hr[0]) ** 2 + ((yy - hr[2]) / hr[1]) ** 2 < 1
    hm2 = gaussian_filter((hm2 & (yy < 555)).astype(np.float32), 4)
    strands = 1 + 0.2 * gaussian_filter(rng.normal(0, 1, (HH, HW)), (5, 1))
    h = h * (1 - hm2[..., None]) + (hc * strands[..., None]) * hm2[..., None]

# 3. the draft's face and hair, scaled to round 1's head (eyes at y 477, chin at y 567, centre x 750)
d = Image.open(draft).convert("RGB")
s = 90 / (C["chin"] - C["eye"])
dd = np.asarray(d.resize((round(d.size[0] * s), round(d.size[1] * s)), Image.LANCZOS), np.float32)
ox = round(750 - C["cx"] * s); oy = round(477 - C["eye"] * s)
fy0, fy1, fx0, fx1 = 330, 610, 640, 860
patch = dd[fy0 - oy:fy1 - oy, fx0 - ox:fx1 - ox]
pyy, pxx = np.mgrid[fy0:fy1, fx0:fx1].astype(np.float32)
# skin toward round 1's: match mean and spread over the face's skin (an ellipse round nose and cheeks)
sk = ((pxx - 750) / 48) ** 2 + ((pyy - 505) / 52) ** 2 < 1
r1 = h[fy0:fy1, fx0:fx1]
r1s = np.asarray(Image.open(src).convert("RGB"), np.float32)[fy0:fy1, fx0:fx1]
mu_p, sd_p = patch[sk].mean(0), patch[sk].std(0); mu_r, sd_r = r1s[sk].mean(0), r1s[sk].std(0)
matched = (patch - mu_p) / np.maximum(sd_p, 1) * (0.5 * sd_p + 0.5 * sd_r) + (0.35 * mu_p + 0.65 * mu_r)
fm = ((pxx - 750) / C['rx']) ** 2 + ((pyy - C['fy']) / C['ry']) ** 2
fm = np.clip((1 - fm) * 6, 0, 1)
fm = gaussian_filter(fm, 4)[..., None]
h[fy0:fy1, fx0:fx1] = r1 * (1 - fm) + matched * fm
Image.fromarray(np.clip(h, 0, 255).astype(np.uint8)).save(out)
print(out)
