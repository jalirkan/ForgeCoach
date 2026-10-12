# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats (sleeve): the code-drawn guide for ONE half (the top seat), at the final scale, plus its masks.
# The sleeve art is 1500x2100 (5:7 at 600 dpi, Dragon Shield's Sleeve Crafter, Standard); the half is 1500x1052
# and the seam is y = 1050, where the table band and the lamp sit. The other half is this one turned 180 degrees
# (compose.py). Shapes are written in a DESIGN space (1632 wide, seam at y = 1110: the direction's geometry) and
# mapped onto the sleeve uniformly (x * K, y * K + DY); the gold ground is drawn in sleeve pixels directly.
# Every figure, hand and the lamp sits inside the central ~85% (110 px margin on every side).
# Usage: guide.py <workdir>       writes <workdir>/guides/{gold-full,half-garnet,...}.png and masks
import math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy.ndimage import gaussian_filter

WD = sys.argv[1] if len(sys.argv) > 1 else "."
G = os.path.join(WD, "guides"); os.makedirs(G, exist_ok=True)
FW, FH = 1500, 2100
HW, HH = 1500, 1052          # the half: rows 0..1051, the seam at y = 1050
SEAM = 1050
CXF = FW / 2
DSEAM = 1110                 # design space: 1632 wide, seam at 1110
K = FW / 1632; DY = SEAM - DSEAM * K
CX = 816                     # the design axis
SS = 2                       # supersampling for the drawn shapes
FRAME_OUT, FRAME_IN, FRAME_IN2 = 122, 182, 192   # incised frame lines (px from the sleeve's edge)
MARGIN = 110                 # nothing that matters outside this
rng = np.random.default_rng(7)


def blur(a, s):
    if s <= 0:
        return a.astype(np.float32)
    if a.ndim == 2:
        return gaussian_filter(a.astype(np.float32), s)
    return np.stack([blur(a[..., i], s) for i in range(a.shape[-1])], -1)


def lowfreq(w, h, sigma, seed):
    r = np.random.default_rng(seed).normal(0, 1, (h // 8 + 2, w // 8 + 2)).astype(np.float32)
    r = np.asarray(Image.fromarray(r).resize((w + 16, h + 16), Image.BICUBIC), np.float32)[:h, :w]
    r = blur(r, sigma / 8 * 8 / 4)
    return r / (r.std() + 1e-6)


# ------------------------------------------------------------------ the tooled gold ground (whole card)
def gold_full():
    """Burnished gold leaf on a whole card, laid in leaves, tooled (incised frame, punched rosettes, a lozenge
    diaper with a punch at every crossing), lit by an emboss of the tooling's height map. Built for the top
    half and turned for the bottom, so the ground is exactly 180-degree symmetric."""
    W, H = FW, SEAM + 40
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    base = np.array([176, 136, 66], np.float32)
    burn = lowfreq(W, H, 180, 11) * 0.06 + lowfreq(W, H, 40, 12) * 0.025
    # leaves: 136 px squares, grid centred on the card's axis, each its own tone, hairline seams
    L = 126
    lx = np.floor((xx - CXF) / L); ly = np.floor(yy / L)
    tone = np.random.default_rng(3).normal(0, 0.022, (40, 40)).astype(np.float32)
    leaf = tone[(ly.astype(int) % 40), (lx.astype(int) % 40)]
    sx = np.abs(((xx - CXF) / L) - np.round((xx - CXF) / L)) * L; sy = np.abs((yy / L) - np.round(yy / L)) * L
    seam = np.clip(1.6 - np.minimum(sx, sy), 0, 1) * 0.05
    grain = np.random.default_rng(5).normal(0, 1, (H, W)).astype(np.float32)
    grain = blur(grain, 0.8) * 0.018
    # tooling height map (0 = leaf surface, negative = pressed in)
    hm = Image.new("L", (W * SS, H * SS), 0); d = ImageDraw.Draw(hm)
    def S(*v): return [c * SS for c in v]
    def rect_line(inset, w):
        d.rectangle(S(inset, inset, W - inset, H + 60), outline=255, width=w * SS)
    rect_line(FRAME_OUT, 4); rect_line(FRAME_IN, 4); rect_line(FRAME_IN2, 2)
    def punch(x, y, r):
        d.ellipse(S(x - r, y - r, x + r, y + r), fill=255)
    def rosette(x, y):
        punch(x, y, 5)
        for k in range(8):
            t = k * math.pi / 4; punch(x + 13 * math.cos(t), y + 13 * math.sin(t), 3.2)
    mid = (FRAME_OUT + FRAME_IN) / 2
    step = 60
    n = int((W - 2 * mid) // step)
    off = (W - 2 * mid - n * step) / 2
    for i in range(n + 1):                           # top band
        x = mid + off + i * step; rosette(x, mid)
        if i < n: punch(x + step / 2, mid, 3.5)
    ys = np.arange(mid + step, H + 40, step)
    for y in ys:                                     # side bands, continued past the seam (turned later)
        for x in (mid, W - mid):
            rosette(x, y); punch(x, y - step / 2, 3.5)
    # outer bleed band: a single row of small punches between the cut and the frame (decorative, may be trimmed)
    for i in range(int((W - 2 * 70) // 32) + 1):
        punch(70 + i * 32, 70, 2.6)
    for y in np.arange(70 + 32, H + 40, 32):
        punch(70, y, 2.6); punch(W - 70, y, 2.6)
    hm_frame = np.asarray(hm.resize((W, H), Image.LANCZOS), np.float32) / 255
    # the lozenge diaper inside the frame (its own map: shallower than the frame's tooling)
    hm = Image.new("L", (W * SS, H * SS), 0); d = ImageDraw.Draw(hm)
    P = 96
    inner = (FRAME_IN2 + 8, W - FRAME_IN2 - 8)
    for k in range(-30, 40):
        x0 = CXF + k * P
        d.line(S(x0, 0, x0 + 2 * H, 2 * H), fill=170, width=2 * SS)
        d.line(S(x0, 0, x0 - 2 * H, 2 * H), fill=170, width=2 * SS)
    for j in range(0, 40):
        for k in range(-20, 20):
            x = CXF + k * P + (j % 2) * P / 2; y = j * P / 2
            for t in range(4):
                a = t * math.pi / 2; punch(x + 7 * math.cos(a), y + 7 * math.sin(a), 2.8)
    hm_diaper = np.asarray(hm.resize((W, H), Image.LANCZOS), np.float32) / 255
    inside = blur(((xx > inner[0]) & (xx < inner[1]) & (yy > inner[0])).astype(np.float32), 1.5)
    hm = np.maximum(hm_frame, hm_diaper * inside * 0.6)
    h = blur(hm, 1.2)
    gy, gx = np.gradient(h)
    shade = (gx * 0.85 + gy * 0.5) * 3.2            # light from the upper left, off the diaper's 45-degree lines
    ao = blur(hm, 2.5) * 0.16
    f = 1 + burn + leaf - seam + grain - ao + shade
    a = base[None, None] * f[..., None]
    # warm the highlights, cool the shadows a touch (gold reads as gold, not as yellow paint)
    hi = np.clip(f - 1, 0, None)[..., None]; lo = np.clip(1 - f, 0, None)[..., None]
    a = a + hi * np.array([30, 26, 12]) - lo * np.array([0, 8, 14])
    top = np.clip(a[:SEAM], 0, 255)
    full = np.zeros((FH, FW, 3), np.float32)
    full[:SEAM] = top
    full[SEAM:] = top[::-1, ::-1][: FH - SEAM]
    # blend 40 px across the seam (only the frame's side bands cross it; the table hides the middle)
    ext = np.clip(a[SEAM - 20: SEAM + 20], 0, 255)
    rot = full[::-1, ::-1][SEAM - 20: SEAM + 20]
    w = np.linspace(0, 1, 40)[:, None, None]
    full[SEAM - 20: SEAM + 20] = ext * (1 - w) + rot * w
    return full


# ------------------------------------------------------------------ the figure, the table and the lamp
ROBES = {  # cloak, (fold shadow is derived); the trim is dark sable fur in every colourway
    "garnet": (120, 32, 40),
    "green": (36, 86, 58),
    "blue": (38, 56, 112),
}
FUR = np.array([66, 50, 40], np.float32)
SKIN = np.array([224, 182, 148], np.float32)
HAIR = np.array([74, 50, 36], np.float32)
CARD = np.array([34, 40, 54], np.float32)
GILT = np.array([196, 156, 80], np.float32)
WOOD = np.array([62, 40, 28], np.float32)
LAMP = (CX, DSEAM + 1)
LAMP_R = 112
TABLE_TOP = 992          # the gilt moulding's upper edge (the half's table runs from here to the seam)


def T(*v):
    """design (x, y, x, y, ...) -> supersampled sleeve pixels"""
    return [(c * K + (DY if i % 2 else 0)) * SS for i, c in enumerate(v)]


def mask_from(draw_fn, W=HW, H=HH):
    m = Image.new("L", (W * SS, H * SS), 0); draw_fn(ImageDraw.Draw(m), T)
    return np.asarray(m.resize((W, H), Image.LANCZOS), np.float32) / 255


def smooth_poly(pts, n=24):
    """Catmull-Rom through pts (closed)."""
    P = np.array(pts, np.float32); out = []
    for i in range(len(P)):
        p0, p1, p2, p3 = P[i - 1], P[i], P[(i + 1) % len(P)], P[(i + 2) % len(P)]
        for t in np.linspace(0, 1, n, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    return [tuple(p) for p in out]


def poly_mask(pts):
    return mask_from(lambda d, S: d.polygon(S(*[c for p in pts for c in p]), fill=255))


def ell_mask(cx, cy, rx, ry):
    return mask_from(lambda d, S: d.ellipse(S(cx - rx, cy - ry, cx + rx, cy + ry), fill=255))


def capsule_mask(p, q, r):
    def f(d, S):
        d.line(S(*p, *q), fill=255, width=int(2 * r * SS * K)); d.ellipse(S(p[0] - r, p[1] - r, p[0] + r, p[1] + r), fill=255)
        d.ellipse(S(q[0] - r, q[1] - r, q[0] + r, q[1] + r), fill=255)
    return mask_from(f)


def over(a, col, m):
    m = m[..., None]; return a * (1 - m) + col * m


YF, XF = np.mgrid[0:HH, 0:HW].astype(np.float32)     # sleeve pixels
xx, yy = XF / K, (YF - DY) / K                          # the same pixels in design units
lamp_d = np.hypot(xx - LAMP[0], yy - LAMP[1])
GLOW = np.exp(-(lamp_d / 430) ** 2)                 # the lamp's light, used for every surface it reaches
GLOW_NEAR = np.exp(-(lamp_d / 210) ** 2)

# silhouettes
CLOAK = smooth_poly([(816, 250), (880, 270), (960, 360), (990, 520), (1010, 640), (1130, 700), (1250, 790),
                     (1300, 900), (1316, 1010), (316, 1010), (332, 900), (382, 790), (502, 700), (622, 640),
                     (642, 520), (672, 360), (752, 270)])
m_cloak = poly_mask(CLOAK)
m_open = ell_mask(816, 470, 116, 160)                      # the hood's opening (dark inside)
m_trim = np.clip(ell_mask(816, 468, 134, 176) - m_open, 0, 1)   # sable fur round the opening
m_face = mask_from(lambda d, S: d.polygon(S(*[c for p in smooth_poly([(816, 372), (872, 392), (894, 452), (886, 520),
                                                                       (858, 568), (816, 588), (774, 568), (746, 520),
                                                                       (738, 452), (760, 392)], 10) for c in p]), fill=255))
m_neck = poly_mask([(782, 560), (850, 560), (858, 640), (774, 640)]) * m_open
m_hair = np.clip(mask_from(lambda d, S: d.polygon(S(*[c for p in smooth_poly([(816, 362), (880, 384), (906, 450), (900, 540),
                                                                                (884, 560), (874, 470), (850, 420), (816, 410),
                                                                                (782, 420), (758, 470), (748, 560), (732, 540),
                                                                                (726, 450), (752, 384)], 10) for c in p]), fill=255))
                 * m_open, 0, 1)
FAN_PIVOT = (816, 948); CARD_L, CARD_W, CARD_UNDER = 300, 214, 44
FAN_ANG = [-36, -24, -12, 0, 12, 24, 36]


def card_pts(ang, grow=0):
    a = math.radians(ang); px, py = FAN_PIVOT; pts = []
    for (u, v) in ((-CARD_W / 2 - grow, -CARD_L + CARD_UNDER - grow), (CARD_W / 2 + grow, -CARD_L + CARD_UNDER - grow),
                   (CARD_W / 2 + grow, CARD_UNDER + grow), (-CARD_W / 2 - grow, CARD_UNDER + grow)):
        pts.append((px + u * math.cos(a) - v * math.sin(a), py + u * math.sin(a) + v * math.cos(a)))
    return pts


def round_rect_pts(ang, rad=14, grow=0):
    a = math.radians(ang); px, py = FAN_PIVOT
    hw, top, bot = CARD_W / 2 + grow, -CARD_L + CARD_UNDER - grow, CARD_UNDER + grow
    pts = []
    for (cx_, cy_, a0) in ((hw - rad, top + rad, -90), (hw - rad, bot - rad, 0), (-hw + rad, bot - rad, 90), (-hw + rad, top + rad, 180)):
        for t in np.linspace(0, 90, 6):
            r_ = math.radians(a0 + t); u, v = cx_ + rad * math.cos(r_), cy_ + rad * math.sin(r_)
            pts.append((px + u * math.cos(a) - v * math.sin(a), py + u * math.sin(a) + v * math.cos(a)))
    return pts


m_cards = [poly_mask(round_rect_pts(a)) for a in FAN_ANG]
m_cards_in = [poly_mask(round_rect_pts(a, rad=10, grow=-6)) for a in FAN_ANG]
m_fan = np.clip(sum(m_cards), 0, 1)

# hands: the viewer's left hand grips the fan's base (fingers wrapped round its front), the right hand's
# fingertips spread the fan from its right side
LH_BACK = smooth_poly([(676, 960), (700, 902), (752, 878), (790, 884), (800, 930), (770, 972), (716, 990)], 8)
LH_FINGERS = [((770, 888), (842, 872), 13.5), ((774, 914), (848, 902), 14.0), ((772, 940), (842, 932), 13.5),
              ((764, 962), (826, 960), 12.0)]
RH_BACK = smooth_poly([(968, 948), (944, 892), (902, 862), (870, 872), (868, 912), (900, 948), (940, 972)], 8)
RH_FINGERS = [((884, 868), (858, 806), 12.5), ((902, 872), (892, 800), 13.0), ((918, 880), (920, 812), 12.5),
              ((930, 892), (948, 838), 11.0)]
m_lh = np.clip(poly_mask(LH_BACK) + sum(capsule_mask(p, q, r) for p, q, r in LH_FINGERS), 0, 1)
m_rh = np.clip(poly_mask(RH_BACK) + sum(capsule_mask(p, q, r) for p, q, r in RH_FINGERS), 0, 1)
SLEEVE_L = smooth_poly([(420, 870), (560, 860), (690, 900), (708, 990), (600, 1004), (440, 1004)], 8)
SLEEVE_R = smooth_poly([(1212, 870), (1072, 846), (950, 880), (960, 990), (1032, 1004), (1192, 1004)], 8)
m_sleeves = np.clip(poly_mask(SLEEVE_L) + poly_mask(SLEEVE_R), 0, 1)
m_cuffs = np.clip(poly_mask([(660, 896), (704, 902), (722, 994), (676, 998)]) +
                  poly_mask([(970, 880), (936, 884), (944, 990), (990, 996)]), 0, 1)
INSIDE_X = ((XF > FRAME_IN2) & (XF < FW - FRAME_IN2)).astype(np.float32)
m_table = (yy >= TABLE_TOP).astype(np.float32) * INSIDE_X
m_lamp = ell_mask(LAMP[0], LAMP[1], LAMP_R, LAMP_R)
m_band = np.clip(mask_from(lambda d, S: d.rectangle(S(LAMP[0] - LAMP_R - 22, DSEAM - 9, LAMP[0] + LAMP_R + 22, DSEAM + 12), fill=255)), 0, 1)


def figure(a, robe):
    C = np.array(robe, np.float32)
    # cloak: folds (long vertical sines whose phase drifts), darker at the silhouette, the lamp from below
    # drapery: folds fanning down from the neck (ridges, not sines), wavering; concentric folds round the hood's
    # opening; vertical brush streaks so the model reads cloth, not a flat cut-out
    ang = np.arctan2(xx - 816, yy - 540)
    wav = lowfreq(HW, HH, 60, 31) * 0.35
    ridge = 1 - np.abs(np.sin(ang * 13 + wav))
    ridge2 = 1 - np.abs(np.sin(ang * 29 + wav * 1.7 + 1.3))
    fold = (ridge ** 2.2 * 0.75 + ridge2 ** 3 * 0.35 - 0.35) * np.clip((yy - 600) / 220, 0, 1)
    ho = np.hypot((xx - 816) / 134, (yy - 468) / 176)
    hood_f = (1 - np.abs(np.sin(ho * 9.5 + wav))) ** 2 * np.clip((1.75 - ho) / 0.6, 0, 1) * (ho > 1)
    streak = gaussian_filter(np.random.default_rng(41).normal(0, 1, (HH, HW)).astype(np.float32), (10, 1.3))
    streak = streak / (streak.std() + 1e-6)
    edge = blur(m_cloak, 26)
    hood_shape = np.clip(1 - np.hypot((xx - 816) / 190, (yy - 450) / 230), 0, 1)
    f = (0.70 + 0.34 * fold + 0.22 * hood_f + 0.22 * edge + 0.14 * hood_shape + 0.04 * streak
         + 0.55 * GLOW * np.clip((yy - 700) / 300, 0, 1))
    cloak = C * f[..., None] + np.array([46, 30, 8]) * (GLOW * 0.6)[..., None]
    a = over(a, cloak, m_cloak)
    # the hood's opening: shadow, the fur rim, hair, face, neck
    inside = np.array([40, 30, 28], np.float32) * (1 + 0.6 * GLOW_NEAR[..., None]) + np.array([36, 20, 8]) * GLOW[..., None]
    a = over(a, inside, m_open)
    furf = 0.8 + 0.35 * np.clip(blur(np.random.default_rng(9).normal(0, 1, (HH, HW)).astype(np.float32), 1.6) * 3, -1, 1)
    a = over(a, FUR * furf[..., None] * (1 + 0.5 * GLOW[..., None]), m_trim)
    a = over(a, SKIN * 0.7, m_neck)
    # face: modelled with a soft light from below-front (the lamp), shadow under the hood's brim
    fy = (yy - 372) / 216; fx = (xx - 816) / 80
    mod = 0.86 + 0.12 * np.clip(1 - fx ** 2, 0, 1) - 0.16 * np.clip(0.35 - fy, 0, 1) + 0.10 * GLOW
    face = SKIN * mod[..., None]
    for s in (-1, 1):                               # warm cheeks
        face += (np.exp(-(((xx - 816 - s * 44) / 24) ** 2 + ((yy - 520) / 18) ** 2)) * 18)[..., None] * np.array([1.0, 0.2, 0.15])
    a = over(a, face, m_face)
    a = over(a, HAIR * (0.85 + 0.2 * GLOW[..., None]), m_hair * (1 - m_face * 0.0))
    feat = Image.new("RGBA", (HW * SS, HH * SS), (0, 0, 0, 0)); d = ImageDraw.Draw(feat)
    S = T
    for s in (-1, 1):
        ex = 816 + s * 34
        d.arc(S(ex - 24, 434, ex + 24, 466), 200 if s < 0 else 210, 330 if s < 0 else 340, fill=(92, 62, 46, 230), width=4 * SS)   # brow
        d.chord(S(ex - 19, 468, ex + 19, 496), 180, 360, fill=(206, 160, 130, 255))                                                      # lid
        d.arc(S(ex - 19, 468, ex + 19, 496), 190, 350, fill=(64, 40, 32, 255), width=3 * SS)                                              # lash line
        d.arc(S(ex - 15, 476, ex + 15, 492), 20, 160, fill=(150, 112, 92, 200), width=2 * SS)                                             # lower lid
    d.line(S(818, 480, 812, 532), fill=(176, 126, 100, 200), width=4 * SS)                                                                # nose
    d.arc(S(798, 524, 834, 544), 20, 160, fill=(150, 98, 80, 220), width=4 * SS)
    d.chord(S(796, 552, 836, 570), 0, 180, fill=(186, 104, 94, 255)); d.chord(S(800, 548, 832, 562), 180, 360, fill=(170, 92, 86, 255))
    d.line(S(798, 558, 834, 558), fill=(120, 64, 60, 255), width=2 * SS)
    feat = feat.resize((HW, HH), Image.LANCZOS)
    fa = np.asarray(feat, np.float32); al = fa[..., 3:] / 255
    a = a * (1 - al) + fa[..., :3] * al
    # sleeves, fur cuffs
    sl = C * (0.76 + 0.5 * GLOW + 0.25 * fold + 0.04 * streak)[..., None]
    a = over(a, sl, m_sleeves)
    a = over(a, FUR * (0.9 + 0.6 * GLOW)[..., None], m_cuffs)
    # the fan: each card dark, warmer and lighter toward the lamp, a gilt edge, a soft shadow on the card behind
    for i, (mc, mi) in enumerate(zip(m_cards, m_cards_in)):
        sh = np.roll(blur(mc, 7), (6, -6 if FAN_ANG[i] < 0 else 6), (0, 1))
        a = a * (1 - 0.45 * sh[..., None] * (1 - mc[..., None]))
        body = CARD * (0.9 + 1.1 * GLOW + 0.06 * np.sin((xx + yy) / 9))[..., None] + np.array([30, 18, 4]) * GLOW_NEAR[..., None]
        a = over(a, GILT * (0.75 + 0.6 * GLOW)[..., None], mc)
        a = over(a, body, mi)
    # hands: skin modelled from below, knuckle creases, the finger bands separated by thin shadows
    for mh, fingers, back in ((m_lh, LH_FINGERS, LH_BACK), (m_rh, RH_FINGERS, RH_BACK)):
        sh = np.roll(blur(mh, 6), (8, 0), (0, 1))
        a = a * (1 - 0.35 * sh[..., None] * (1 - mh[..., None]))
        hand = SKIN * (0.74 + 0.5 * GLOW)[..., None] + np.array([24, 10, 0]) * GLOW_NEAR[..., None]
        a = over(a, hand, poly_mask(back))
        for (p, q, r) in fingers:
            mf = capsule_mask(p, q, r)
            # cylinder shading across the finger
            px_, py_ = q[0] - p[0], q[1] - p[1]; ln = math.hypot(px_, py_)
            nx, ny = -py_ / ln, px_ / ln
            t = ((xx - p[0]) * nx + (yy - p[1]) * ny) / r
            cyl = np.clip(1 - 0.35 * t ** 2 + 0.18 * t * np.sign(ny), 0.4, 1.2)
            fing = SKIN * (0.72 + 0.45 * GLOW)[..., None] * cyl[..., None]
            ring = np.clip(capsule_mask(p, q, r + 1.6) - mf, 0, 1)
            a = a * (1 - 0.55 * ring[..., None])
            a = over(a, fing, mf)
    return a


def table_and_lamp(a):
    # the table: dark walnut with a long grain, a gilt moulding along its edge, the lamp's pool of light on it
    gr = blur(np.random.default_rng(21).normal(0, 1, (HH, HW)).astype(np.float32), 0)
    grain = np.asarray(Image.fromarray(gr).resize((HW // 40, HH), Image.BILINEAR).resize((HW, HH), Image.BICUBIC), np.float32)
    wood = WOOD * (0.92 + 0.1 * grain + 1.4 * GLOW)[..., None] + np.array([40, 22, 6]) * GLOW_NEAR[..., None]
    a = over(a, wood, m_table)
    my = np.clip((yy - TABLE_TOP) / 20, 0, 1)
    prof = 0.65 + 0.55 * np.clip(np.sin(my * math.pi), 0, 1) ** 0.6 - 0.25 * my
    m_mould = ((yy >= TABLE_TOP) & (yy < TABLE_TOP + 20)).astype(np.float32) * INSIDE_X
    a = over(a, GILT * (prof * (0.9 + 0.5 * GLOW))[..., None], m_mould)
    shadow = ((yy >= TABLE_TOP + 20) & (yy < TABLE_TOP + 30)).astype(np.float32) * INSIDE_X
    a = a * (1 - 0.35 * blur(shadow, 3)[..., None])
    # the lamp: a glass globe with a flame at its heart; a gilt band round its equator (the seam), small gilt
    # knops left and right on the band. Spherical shading: a bright core, a darker glass body, a Fresnel rim.
    r = lamp_d / LAMP_R
    inside = np.clip(1 - r, 0, 1)
    core = np.exp(-(r / 0.32) ** 2)
    body = np.array([214, 168, 96], np.float32) * (0.55 + 0.55 * inside ** 0.6)[..., None]
    body = body + np.array([40, 46, 50]) * (np.exp(-((r - 0.93) / 0.07) ** 2))[..., None]   # rim
    body = body * (1 - core[..., None]) + np.array([255, 244, 212]) * core[..., None]
    spec = np.exp(-(((xx - (LAMP[0] - 44)) / 22) ** 2 + ((yy - (LAMP[1] - 58)) / 14) ** 2))
    body = body + np.array([60, 60, 56]) * spec[..., None]
    a = over(a, body, m_lamp)
    bandp = np.clip((yy - (DSEAM - 9)) / 21, 0, 1)
    band = GILT * (0.7 + 0.6 * np.sin(bandp * math.pi))[..., None]
    a = over(a, band, m_band)
    for s in (-1, 1):
        mk = ell_mask(LAMP[0] + s * (LAMP_R + 30), DSEAM + 1, 14, 14)
        kn = GILT * (0.8 + 0.5 * np.clip(1 - np.hypot(xx - (LAMP[0] + s * (LAMP_R + 30) - 4), yy - (DSEAM - 4)) / 14, 0, 1))[..., None]
        a = over(a, kn, mk)
    return a


def light(a, amount=1.0):
    """The lamp's light on everything: a warm screen near the lamp, falling off with distance."""
    g = GLOW[..., None] * amount
    warm = np.array([255, 214, 150], np.float32)
    return a + (warm - a) * g * 0.16


if __name__ == "__main__":
    gold = gold_full()
    Image.fromarray(np.clip(gold, 0, 255).astype(np.uint8)).save(os.path.join(G, "gold-full.png"))
    half_gold = gold[:HH]
    gl = light(half_gold.copy(), 0.8)
    for name, robe in ROBES.items():
        a = figure(gl.copy(), robe)
        a = table_and_lamp(a)
        Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(os.path.join(G, f"half-{name}.png"))
    def sv(m, n): Image.fromarray((np.clip(m, 0, 1) * 255).astype(np.uint8)).save(os.path.join(G, f"mask-{n}.png"))
    sv(np.clip(m_cloak + m_fan + m_lh + m_rh + m_sleeves, 0, 1), "figure")
    sv(np.clip(m_cloak + m_sleeves - m_open - m_trim - m_cuffs - m_fan - m_lh - m_rh, 0, 1), "robe")
    sv(m_fan, "fan"); sv(np.clip(m_lh + m_rh, 0, 1), "hands"); sv(m_lamp, "lamp"); sv(m_table, "table")
    sv(np.clip(m_face + m_hair, 0, 1), "face")
    print("guides written to", G)
