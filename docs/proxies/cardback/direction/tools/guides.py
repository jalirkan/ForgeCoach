# SPDX-License-Identifier: GPL-3.0-or-later
# Layout guides for the proxy back, painted over with SDXL img2img.
# Binder and tiling guides are 832x1152 (whole card); the court guide is 1216x832 (one half).
import math, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1]
rng = np.random.default_rng(7)

def noise(w, h, amp, blur=1.2):
    n = rng.normal(0, 1, (h, w, 1)).repeat(3, 2)
    im = Image.fromarray(np.clip(128 + n * 40, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur))
    return (np.asarray(im).astype(np.float32) - 128) / 40 * amp

def textured(w, h, rgb, amp=10, blur=1.2):
    a = np.zeros((h, w, 3), np.float32) + np.array(rgb, np.float32)
    a += noise(w, h, amp, blur)
    return a

GOLD = (176, 138, 64)
GOLD_D = (120, 88, 38)

def to_img(a):
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))

def quad_mirror(im):
    w, h = im.size
    q = im.crop((0, 0, w // 2, h // 2))
    out = Image.new("RGB", (w, h))
    out.paste(q, (0, 0))
    out.paste(q.transpose(Image.FLIP_LEFT_RIGHT), (w // 2, 0))
    out.paste(q.transpose(Image.FLIP_TOP_BOTTOM), (0, h // 2))
    out.paste(q.transpose(Image.ROTATE_180), (w // 2, h // 2))
    return out

# ---------------------------------------------------------------- 1. binder
def binder(leather, name):
    W, H = 832, 1152
    im = to_img(textured(W, H, leather, amp=9, blur=0.9))
    d = ImageDraw.Draw(im)
    cx, cy = W / 2, H / 2
    # double ruled border inside the safe area (safe = 69 px here)
    for inset, wdt in ((84, 6), (100, 2), (150, 2)):
        d.rectangle([inset, inset, W - inset, H - inset], outline=GOLD, width=wdt)
    # corner strapwork: interlaced quarter-loops at each corner (drawn in one quadrant, mirrored)
    q = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    qd = ImageDraw.Draw(q)
    for r in (60, 84):
        qd.arc([100 - r, 100 - r, 100 + r, 100 + r], 0, 90, fill=GOLD + (255,), width=7)
        qd.arc([150 - r // 2, 150 - r // 2, 150 + r // 2 + 60, 150 + r // 2 + 60], 180, 270, fill=GOLD + (255,), width=6)
    # straps running from the corners toward the lozenge
    qd.line([(150, 150), (cx - 150, cy - 300)], fill=GOLD + (255,), width=5)
    qd.line([(165, 140), (cx - 140, cy - 310)], fill=GOLD_D + (255,), width=2)
    # fleurons in a lattice, quadrant only
    for y in range(200, int(cy), 92):
        for x in range(190, int(cx), 92):
            off = 46 if (y // 92) % 2 else 0
            px = x + off
            if abs(px - cx) / 230 + abs(y - cy) / 380 < 1.15:
                continue
            if px > cx - 20 or (y < 250 and px > cx - 190):
                continue
            qd.ellipse([px - 6, y - 10, px + 6, y + 10], fill=GOLD + (255,))
            qd.ellipse([px - 10, y - 6, px + 10, y + 6], fill=GOLD + (255,))
            qd.ellipse([px - 3, y - 3, px + 3, y + 3], fill=leather + (255,))
    im.paste(q, (0, 0), q)
    im = quad_mirror(im)
    d = ImageDraw.Draw(im)
    # the lozenge
    for k, wdt in ((1.0, 7), (0.93, 2), (0.80, 3)):
        a, b = 230 * k, 380 * k
        d.polygon([(cx, cy - b), (cx + a, cy), (cx, cy + b), (cx - a, cy)], outline=GOLD, width=wdt)
    # word panels: calm cartouches at top and bottom (head-to-tail), left plain leather
    for yy in (190, H - 190):
        d.rounded_rectangle([cx - 150, yy - 34, cx + 150, yy + 34], radius=14, outline=GOLD, width=3)
    # the emblem: a Necker cube (two offset squares joined at the corners). Unlike a shaded cube it
    # turns 180 degrees onto itself, so it cannot say which way up the card is.
    a = 58; v = (34, -34)
    A = [(cx - v[0]/2 + x, cy - v[1]/2 + y) for x, y in ((-a, -a), (a, -a), (a, a), (-a, a))]
    B = [(x + v[0], y + v[1]) for x, y in A]
    d.polygon(B, outline=GOLD, width=7)
    d.polygon(A, outline=GOLD, width=7)
    for p_, q_ in zip(A, B):
        d.line([p_, q_], fill=GOLD, width=7)
    # a small eight-point star at the heart (the coach's light)
    st = []
    for k in range(16):
        r = 22 if k % 2 == 0 else 8
        ang = math.radians(k * 22.5)
        st.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    d.polygon(st, fill=(206, 170, 96))
    im.save(f"{OUT}/{name}.png")

# ---------------------------------------------------------------- 2. tumbling blocks
def blocks(cols, name, size=58):
    W, H = 832, 1152
    light, mid, dark = cols
    cx, cy = W / 2, H / 2
    # rhombille tiling; the image centre sits on the centre of a light (top) rhombus,
    # which makes the coloured tiling exactly invariant under 180 degree rotation.
    s = size                       # hex circumradius
    hw = s * math.sqrt(3)          # hex width (pointy-top hexes)
    im = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(im)
    # hex centre such that its top rhombus centre is the image centre: top rhombus centre = hex centre - (0, s/2)
    ox, oy = cx, cy + s / 2
    for j in range(-14, 15):
        for i in range(-10, 11):
            hx = ox + i * hw + (j % 2) * hw / 2
            hy = oy + j * 1.5 * s
            P = [(hx + s * math.cos(math.radians(a)), hy + s * math.sin(math.radians(a))) for a in (-90, -30, 30, 90, 150, 210)]
            C = (hx, hy)
            d.polygon([P[0], P[1], C, P[5]], fill=light)
            d.polygon([P[1], P[2], P[3], C], fill=dark)
            d.polygon([P[3], P[4], P[5], C], fill=mid)
    a = np.asarray(im).astype(np.float32) + noise(W, H, 7, 0.8)
    im = to_img(a)
    d = ImageDraw.Draw(im)
    # the gilt reserve: a hexagon around the centre; inside it the same tiling in gold tones
    R = 150
    hexpts = [(cx + R * math.cos(math.radians(a)), cy + R * math.sin(math.radians(a))) for a in range(0, 360, 60)]
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).polygon(hexpts, fill=255)
    goldim = Image.new("RGB", (W, H))
    gd = ImageDraw.Draw(goldim)
    for j in range(-6, 7):
        for i in range(-5, 6):
            hx = ox + i * hw + (j % 2) * hw / 2
            hy = oy + j * 1.5 * s
            P = [(hx + s * math.cos(math.radians(a)), hy + s * math.sin(math.radians(a))) for a in (-90, -30, 30, 90, 150, 210)]
            C = (hx, hy)
            gd.polygon([P[0], P[1], C, P[5]], fill=(206, 170, 96))
            gd.polygon([P[1], P[2], P[3], C], fill=(112, 82, 36))
            gd.polygon([P[3], P[4], P[5], C], fill=(158, 122, 58))
    im.paste(goldim, (0, 0), mask)
    d.polygon(hexpts, outline=GOLD, width=6)
    # brass stringing: double line just inside the safe area
    for inset, wdt in ((80, 5), (94, 2)):
        d.rectangle([inset, inset, W - inset, H - inset], outline=GOLD, width=wdt)
    im.save(f"{OUT}/{name}.png")

# ---------------------------------------------------------------- 3. the two seats (one half)
def seat(cloak, lining, name):
    W, H = 1216, 832
    im = to_img(textured(W, H, (168, 130, 62), amp=12, blur=2.0))   # gold-leaf ground
    d = ImageDraw.Draw(im)
    cx = W / 2
    # tooled border band along the top and sides (top of this half = the card's outer edge)
    # body: cloak as a broad trapezoid / bell
    d.polygon([(cx - 330, H - 70), (cx - 210, 330), (cx - 90, 250), (cx + 90, 250), (cx + 210, 330), (cx + 330, H - 70)], fill=cloak)
    d.polygon([(cx - 70, 260), (cx + 70, 260), (cx + 40, H - 70), (cx - 40, H - 70)], fill=lining)
    # head and hood
    d.ellipse([cx - 120, 40, cx + 120, 300], fill=cloak)
    d.ellipse([cx - 70, 95, cx + 70, 265], fill=(214, 176, 140))
    # a fan of cards held at the chest (backs to us, plain)
    for k in range(-3, 4):
        ang = math.radians(k * 12)
        bx, by = cx, 640
        w2, h2 = 46, 150
        pts = []
        for (px, py) in ((-w2, -h2 * 2), (w2, -h2 * 2), (w2, 0), (-w2, 0)):
            rx = px * math.cos(ang) - py * math.sin(ang)
            ry = px * math.sin(ang) + py * math.cos(ang)
            pts.append((bx + rx, by + ry))
        d.polygon(pts, fill=(52, 66, 74), outline=(150, 116, 52))
    # hands under the fan
    d.ellipse([cx - 80, 600, cx + 10, 660], fill=(200, 160, 124))
    d.ellipse([cx - 10, 600, cx + 80, 660], fill=(200, 160, 124))
    # the table edge across the bottom
    d.rectangle([0, H - 80, W, H], fill=(70, 44, 30))
    d.rectangle([0, H - 84, W, H - 76], fill=(150, 116, 52))
    # the lamp: a glass orb centred on the bottom edge (half here, half in the rotated twin)
    d.ellipse([cx - 90, H - 90, cx + 90, H + 90], fill=(236, 206, 140))
    d.ellipse([cx - 60, H - 60, cx + 60, H + 60], fill=(250, 232, 180))
    # dark tooled border on outer three sides
    for inset, wdt in ((40, 10), (58, 3)):
        d.line([(inset, H), (inset, inset), (W - inset, inset), (W - inset, H)], fill=(40, 34, 30), width=wdt)
    im = im.filter(ImageFilter.GaussianBlur(1.0))
    im.save(f"{OUT}/{name}.png")

binder((30, 64, 46), "binder-green")
binder((26, 46, 70), "binder-blue")
binder((86, 26, 36), "binder-garnet")
blocks(((214, 196, 160), (74, 88, 80), (32, 30, 30)), "blocks-holly")
blocks(((206, 192, 166), (56, 70, 96), (30, 28, 34)), "blocks-indigo", size=50)
blocks(((198, 184, 150), (96, 70, 52), (30, 26, 26)), "blocks-warm", size=66)
seat((34, 78, 84), (130, 34, 40), "seat-teal")
seat((112, 30, 38), (34, 78, 84), "seat-garnet")
seat((40, 46, 82), (160, 120, 50), "seat-indigo")
print("ok")
