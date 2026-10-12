# SPDX-License-Identifier: GPL-3.0-or-later
# Two Seats guide v2: shaded figure, a face with features, tooled gold ground, lamp glow.
import math, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
sys.argv = [sys.argv[0], "guides"]
exec(open("tools/guides.py").read().split("# ---------------------------------------------------------------- 1. binder")[0])
W, H = 1216, 832; cx = W / 2

def seat2(cloak, lining, name, seed=0):
    a = textured(W, H, (164, 126, 60), amp=14, blur=2.5)
    # lamp glow on the ground, centred on the seam point
    yy, xx = np.mgrid[0:H, 0:W]
    dist = np.hypot(xx - cx, yy - H)
    a += (np.clip(1 - dist / 520, 0, 1) ** 2 * 50)[..., None] * np.array([1.0, 0.85, 0.5])
    im = to_img(a); d = ImageDraw.Draw(im)
    # punched diaper on the gold: small rosettes of dots
    for j, y in enumerate(range(110, H - 100, 64)):
        for x in range(90 + (j % 2) * 40, W - 60, 80):
            for k in range(6):
                t = k * math.pi / 3
                d.ellipse([x + 7 * math.cos(t) - 2, y + 7 * math.sin(t) - 2, x + 7 * math.cos(t) + 2, y + 7 * math.sin(t) + 2], fill=(126, 92, 40))
    ground = im
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    C = np.array(cloak, float); L = np.array(lining, float)
    def sh(c, f): return tuple(int(v) for v in np.clip(c * f, 0, 255))
    # cloak with folds
    body = [(cx - 340, H - 70), (cx - 220, 330), (cx - 95, 255), (cx + 95, 255), (cx + 220, 330), (cx + 340, H - 70)]
    d.polygon(body, fill=sh(C, 1.0))
    for k, f in ((-260, 0.7), (-180, 0.8), (-120, 0.75), (120, 0.75), (180, 0.8), (260, 0.7)):
        d.polygon([(cx + k * 0.55, 330), (cx + k * 0.55 + 14 * np.sign(k), 330), (cx + k + 22 * np.sign(k), H - 70), (cx + k, H - 70)], fill=sh(C, f))
    d.polygon([(cx - 330, H - 70), (cx - 215, 330), (cx - 190, 330), (cx - 290, H - 70)], fill=sh(C, 1.25))
    d.polygon([(cx + 330, H - 70), (cx + 215, 330), (cx + 190, 330), (cx + 290, H - 70)], fill=sh(C, 1.25))
    d.polygon([(cx - 70, 262), (cx + 70, 262), (cx + 44, H - 70), (cx - 44, H - 70)], fill=sh(L, 1.0))
    d.line([(cx - 70, 262), (cx - 44, H - 70)], fill=(176, 138, 64), width=5)
    d.line([(cx + 70, 262), (cx + 44, H - 70)], fill=(176, 138, 64), width=5)
    # hood, shadowed inside
    d.ellipse([cx - 125, 40, cx + 125, 310], fill=sh(C, 1.1))
    d.ellipse([cx - 92, 78, cx + 92, 290], fill=sh(C, 0.55))
    # face: oval, hair, features
    d.ellipse([cx - 64, 100, cx + 64, 262], fill=(212, 172, 136))
    d.pieslice([cx - 70, 90, cx + 70, 200], 180, 360, fill=(70, 46, 32))
    for s in (-1, 1):
        ex = cx + s * 27
        d.ellipse([ex - 11, 178, ex + 11, 188], fill=(240, 226, 210))
        d.ellipse([ex - 5, 178, ex + 5, 188], fill=(46, 34, 28))
        d.line([(ex - 15, 166), (ex + 14, 164)], fill=(80, 54, 38), width=4)
    d.line([(cx, 190), (cx - 6, 220), (cx + 4, 224)], fill=(170, 120, 92), width=3)
    d.line([(cx - 16, 240), (cx + 16, 240)], fill=(150, 72, 66), width=5)
    d.ellipse([cx - 52, 205, cx - 30, 225], fill=(222, 156, 130)); d.ellipse([cx + 30, 205, cx + 52, 225], fill=(222, 156, 130))
    # fan of cards: dark backs with a gilt edge and a dot
    for k in range(-3, 4):
        ang = math.radians(k * 12); bx, by = cx, 650
        pts = []
        for (px, py) in ((-44, -300), (44, -300), (44, 0), (-44, 0)):
            pts.append((bx + px * math.cos(ang) - py * math.sin(ang), by + px * math.sin(ang) + py * math.cos(ang)))
        d.polygon(pts, fill=(44, 52, 62), outline=(176, 138, 64), width=3)
        mx = bx - (-200) * math.sin(ang); my = by + (-200) * math.cos(ang)
        d.ellipse([mx - 6, my - 6, mx + 6, my + 6], fill=(176, 138, 64))
    # hands holding the fan
    d.ellipse([cx - 78, 610, cx + 4, 668], fill=(204, 162, 126)); d.ellipse([cx - 4, 610, cx + 78, 668], fill=(204, 162, 126))
    for k in range(4):
        d.line([(cx - 70 + k * 18, 620), (cx - 64 + k * 18, 660)], fill=(170, 124, 94), width=2)
        d.line([(cx + 12 + k * 18, 620), (cx + 18 + k * 18, 660)], fill=(170, 124, 94), width=2)
    FS = 0.84
    fig = im.resize((round(W * FS), round(H * FS)), Image.LANCZOS)
    ground.paste(fig, (round(cx - W * FS / 2), round((H - 70) - (H - 70) * FS)), fig)
    im = ground; d = ImageDraw.Draw(im)
    # table edge: wood with a gilt moulding
    d.rectangle([0, H - 80, W, H], fill=(66, 40, 28))
    for y in range(H - 74, H, 9):
        d.line([(0, y), (W, y + 3)], fill=(80, 50, 34), width=2)
    d.rectangle([0, H - 86, W, H - 76], fill=(170, 132, 60))
    # the lamp: glass orb, flame core
    for r, col in ((96, (226, 190, 120)), (80, (240, 214, 150)), (52, (252, 236, 190)), (24, (255, 246, 220))):
        d.ellipse([cx - r, H - r, cx + r, H + r], fill=col)
    # tooled border on three sides
    for inset, wdt, col in ((96, 12, (44, 36, 30)), (116, 3, (120, 88, 38))):
        d.line([(inset, H), (inset, inset), (W - inset, inset), (W - inset, H)], fill=col, width=wdt)
    im = im.filter(ImageFilter.GaussianBlur(1.4))
    im.save(f"guides/{name}.png")

seat2((34, 80, 86), (128, 34, 42), "seat2-teal")
seat2((110, 30, 40), (34, 80, 86), "seat2-garnet")
seat2((40, 48, 88), (150, 112, 46), "seat2-indigo")
