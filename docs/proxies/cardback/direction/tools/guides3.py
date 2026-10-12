# SPDX-License-Identifier: GPL-3.0-or-later
# Tumbling-blocks guide v2: each face family carries veneer grain in its own direction.
import math, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
sys.argv = [sys.argv[0], "guides"]
exec(open("tools/guides.py").read().split("# ---------------------------------------------------------------- 1. binder")[0])
W, H = 832, 1152; cx, cy = W / 2, H / 2

def grain(angle, seed):
    r = np.random.default_rng(seed)
    S = 1600
    a = r.normal(0, 1, (S, S // 26))                      # streaks along x
    im = Image.fromarray(np.clip(128 + a * 40, 0, 255).astype(np.uint8)).resize((S, S), Image.BICUBIC)
    b = np.asarray(im, np.float32)
    fig = np.sin(np.linspace(0, 40, S)[:, None] + 3 * (b / 128 - 1)) * 0.5        # figure: wavy bands
    g = (b - 128) / 40 * 0.6 + fig + r.normal(0, 0.25, (S, S))
    im = Image.fromarray(np.clip(128 + g * 30, 0, 255).astype(np.uint8)).rotate(angle, Image.BICUBIC)
    o = (S - W) // 2, (S - H) // 2
    return (np.asarray(im.crop((o[0], o[1], o[0] + W, o[1] + H)), np.float32) - 128) / 30

def tiling_masks(s, ox, oy, region=None):
    hw = s * math.sqrt(3)
    ms = [Image.new("L", (W, H), 0) for _ in range(3)]
    ds = [ImageDraw.Draw(m) for m in ms]
    for j in range(-16, 17):
        for i in range(-10, 11):
            hx = ox + i * hw + (j % 2) * hw / 2; hy = oy + j * 1.5 * s
            P = [(hx + s * math.cos(math.radians(a)), hy + s * math.sin(math.radians(a))) for a in (-90, -30, 30, 90, 150, 210)]
            C = (hx, hy)
            ds[0].polygon([P[0], P[1], C, P[5]], fill=255)
            ds[1].polygon([P[3], P[4], P[5], C], fill=255)
            ds[2].polygon([P[1], P[2], P[3], C], fill=255)
            for k, poly in enumerate(([P[0], P[1], C, P[5]], [P[3], P[4], P[5], C], [P[1], P[2], P[3], C])):
                ds[k].line(poly + [poly[0]], fill=0, width=2)     # hairline joints between veneers
    return [np.asarray(m, np.float32)[..., None] / 255 for m in ms]

def blocks2(cols, gold, name, size=58, seed=1):
    light, mid, dark = [np.array(c, np.float32) for c in cols]
    ox, oy = cx, cy + size / 2
    masks = tiling_masks(size, ox, oy)
    grains = [grain(0, seed), grain(60, seed + 1), grain(-60, seed + 2)]   # top: horizontal; sides: along their long axis
    a = np.zeros((H, W, 3), np.float32) + np.array((24, 22, 20), np.float32)  # the dark joints
    for m, g, c, amp in zip(masks, grains, (light, mid, dark), (16, 14, 9)):
        a = a * (1 - m) + (c + g[..., None] * amp) * m
    # gilt reserve
    R = 150
    hexpts = [(cx + R * math.cos(math.radians(t)), cy + R * math.sin(math.radians(t))) for t in range(0, 360, 60)]
    hm = Image.new("L", (W, H), 0); ImageDraw.Draw(hm).polygon(hexpts, fill=255)
    hm = np.asarray(hm, np.float32)[..., None] / 255
    ga = np.zeros_like(a) + 30
    for m, c in zip(masks, gold):
        ga = ga * (1 - m) + (np.array(c, np.float32) + noise(W, H, 6, 0.8)) * m
    a = a * (1 - hm) + ga * hm
    im = to_img(a); d = ImageDraw.Draw(im)
    d.polygon(hexpts, outline=(150, 112, 48), width=7)
    d.polygon(hexpts, outline=(196, 160, 90), width=2)
    for inset, wdt in ((80, 5), (94, 2)):
        d.rectangle([inset, inset, W - inset, H - inset], outline=(170, 132, 62), width=wdt)
    im = im.filter(ImageFilter.GaussianBlur(0.6))
    im.save(f"guides/{name}.png")
    arr = np.asarray(im, np.float32); print(name, "rot180 geometry diff", np.abs(arr - arr[::-1, ::-1]).mean())

GOLD3 = ((200, 164, 92), (150, 114, 54), (108, 80, 36))
blocks2(((196, 180, 146), (70, 86, 78), (40, 34, 32)), GOLD3, "blocks2-holly", seed=11)
blocks2(((192, 178, 150), (58, 70, 98), (40, 34, 38)), GOLD3, "blocks2-indigo", size=52, seed=21)
blocks2(((190, 174, 140), (112, 52, 50), (40, 32, 30)), GOLD3, "blocks2-garnet", size=64, seed=31)
