# SPDX-License-Identifier: GPL-3.0-or-later
"""The review sheets: EMBLEM-OPTIONS.jpg, CONTACT-SHEET.jpg (with the fanned hand),
FANNED-HAND.jpg and CUT-SAFE.jpg. The labels are on the sheets only; the backs carry no words.

    python sheets.py options      # renders the four emblem options (green) and the sheet
    python sheets.py contact      # from the three finals
"""
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

import lattice as G
import render

HERE = Path(__file__).resolve().parent
OUT = HERE.parent
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONTB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
BG = (236, 233, 226)
INK = (34, 32, 30)
CW = ("green", "blue", "garnet")


def font(sz, bold=False):
    return ImageFont.truetype(FONTB if bold else FONT, sz)


def final(cw):
    return Image.open(OUT / f"tumbling-blocks-{cw}.png").convert("RGB")


def trimmed(im, radius=71):
    """The card as cut: the bleed trimmed at the cut line, corners rounded (1/8 in)."""
    c = im.crop((G.CUT, G.CUT, G.W - G.CUT, G.H - G.CUT))
    m = Image.new("L", c.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, c.width - 1, c.height - 1], radius=radius, fill=255)
    c = c.convert("RGBA"); c.putalpha(m)
    return c


OPTIONS = [
    ("A", "hex2", "solid", "Solid gold hexagon",
     "12 rhombi; its six sides are lattice edges.\nThree gold cubes, flat inlay."),
    ("B", "hex2", "outline", "Brass outline, wood kept",
     "The same hexagon, drawn in brass\nstringing; the three woods stay."),
    ("C", "ring", "raised", "Gold hexagram, raised",
     "A larger cluster: 30 rhombi, a six-\npointed star of cubes, bevelled."),
    ("D", "hex2", "haloed", "Raised hexagon in a brass star",
     "Hexagon A, bevelled, set in the\nstar of C drawn in brass. Chosen."),
]


def options_sheet():
    lat = G.Lattice()
    tw, th = 420, 571                 # full-card thumbnail
    zw = 420                          # centre zoom
    pad, top = 30, 120
    W = pad + len(OPTIONS) * (tw + pad)
    H = top + th + 20 + zw + 150
    sheet = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(sheet)
    d.text((pad, 28), "Tumbling Blocks: the gold emblem, four treatments (green reference)", font=font(34, True), fill=INK)
    d.text((pad, 74), "Every option sits on the same lattice: cube 197.45 px wide (8.4 mm), card centre on a lattice vertex, "
           "so each is exactly 180-degree symmetric and identical in all three colourways.", font=font(19), fill=INK)
    for i, (tag, cl, tr, title, note) in enumerate(OPTIONS):
        rgb, _ = render.symmetrise(render.colourise(render.build(cl, tr, lat=lat), "green"))
        im = Image.fromarray(rgb)
        x = pad + i * (tw + pad)
        sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, top))
        z = im.crop((G.OX - 440, G.OY - 440, G.OX + 440, G.OY + 440)).resize((zw, zw), Image.LANCZOS)
        sheet.paste(z, (x, top + th + 20))
        y = top + th + 20 + zw + 14
        chosen = tag == "D"
        d.text((x, y), f"{tag}  {title}", font=font(22, True), fill=(120, 70, 20) if chosen else INK)
        d.multiline_text((x, y + 34), note, font=font(17), fill=INK, spacing=4)
        if chosen:
            d.rectangle([x - 8, top - 8, x + tw + 8, y + 104], outline=(150, 112, 48), width=4)
    sheet.save(OUT / "EMBLEM-OPTIONS.jpg", quality=90)


def fan(cards, size=(1800, 1150), bg=(58, 52, 46)):
    """The backs as a drawn hand: trimmed, rounded, fanned about a pivot below, each with a shadow."""
    W, H = size
    canvas = Image.new("RGBA", (W, H), bg + (255,))
    # a faint table grain so the hand sits on something
    rng = np.random.default_rng(3)
    n = rng.normal(0, 1, (H // 6, W // 60)).astype(np.float32)
    tex = np.asarray(Image.fromarray(((n - n.min()) / (np.ptp(n) + 1e-9) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC), np.float32)
    base = np.asarray(canvas, np.float32)
    base[..., :3] += ((tex - 128) / 128 * 6)[..., None]
    canvas = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), "RGBA")
    scale = 0.36
    k = len(cards)
    spread = 9.0
    pivot = (W / 2, H + 120)
    for i, im in enumerate(cards):
        c = trimmed(im)
        c = c.resize((round(c.width * scale), round(c.height * scale)), Image.LANCZOS)
        ang = (i - (k - 1) / 2) * spread
        # place the card so its bottom centre sits on a circle about the pivot
        R = 120 + c.height * 0.80
        cx = pivot[0] + R * math.sin(math.radians(ang))
        cy = pivot[1] - R * math.cos(math.radians(ang))
        rc = c.rotate(-ang, resample=Image.BICUBIC, expand=True)
        sh = Image.new("RGBA", rc.size, (0, 0, 0, 0))
        sh.putalpha(rc.getchannel("A").point(lambda v: int(v * 0.55)))
        sh = sh.filter(ImageFilter.GaussianBlur(14))
        x, y = int(cx - rc.width / 2), int(cy - rc.height / 2)
        canvas.alpha_composite(sh, (x + 10, y + 16))
        canvas.alpha_composite(rc, (x, y))
    return canvas.convert("RGB")


def contact():
    ims = [final(cw) for cw in CW]
    tw, th = 600, 816
    pad, top = 40, 110
    hand = fan([ims[i % 3] for i in range(7)])
    W = pad + 3 * (tw + pad)
    hh = round(hand.height * (W - 2 * pad) / hand.width)
    H = top + th + 70 + 60 + hh + pad
    sheet = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(sheet)
    d.text((pad, 30), "Tumbling Blocks: the three backs, one lattice", font=font(36, True), fill=INK)
    for i, (cw, im) in enumerate(zip(CW, ims)):
        x = pad + i * (tw + pad)
        sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, top))
        d.text((x, top + th + 14), f"tumbling-blocks-{cw}.png", font=font(22), fill=INK)
    y = top + th + 70
    d.text((pad, y), "As a drawn hand, alternating green, blue, garnet (trimmed at the cut line, rounded corners):", font=font(22), fill=INK)
    sheet.paste(hand.resize((W - 2 * pad, hh), Image.LANCZOS), (pad, y + 44))
    sheet.save(OUT / "CONTACT-SHEET.jpg", quality=90)
    hand.save(OUT / "FANNED-HAND.jpg", quality=90)


def cut_safe():
    tw, th = 600, 816
    pad, top = 40, 110
    W = pad + 3 * (tw + pad)
    H = top + th + 120
    sheet = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(sheet)
    d.text((pad, 30), "Cut line (red, 75 px in) and safe line (blue, 135 px in), at 600 dpi", font=font(32, True), fill=INK)
    for i, cw in enumerate(CW):
        im = final(cw)
        dd = ImageDraw.Draw(im)
        dd.rectangle([G.CUT, G.CUT, G.W - G.CUT - 1, G.H - G.CUT - 1], outline=(230, 30, 30), width=5)
        dd.rectangle([G.SAFE, G.SAFE, G.W - G.SAFE - 1, G.H - G.SAFE - 1], outline=(30, 110, 240), width=5)
        x = pad + i * (tw + pad)
        sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, top))
        d.text((x, top + th + 14), cw, font=font(22), fill=INK)
    fr = render.PARAMS["frame"]
    xi = G.OX - fr["x_cubes"] * G.HW; yi = G.OY - fr["y_rows"] * G.ROW
    d.text((pad, top + th + 52), f"Brass frame (thick line) at x = {xi:.1f} px and y = {yi:.1f} px from the bleed edge: "
           f"{xi - G.CUT:.0f} px / {yi - G.CUT:.0f} px inside the cut, {xi - G.SAFE:.0f} / {yi - G.SAFE:.0f} px inside the safe line.",
           font=font(19), fill=INK)
    sheet.save(OUT / "CUT-SAFE.jpg", quality=90)


if __name__ == "__main__":
    what = sys.argv[1]
    if what == "options":
        options_sheet()
    elif what == "contact":
        contact(); cut_safe()
