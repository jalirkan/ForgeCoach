# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 3: the review sheets.
#   sheets.py seeds <out.jpg> <label=img> ...         a labelled grid of composition seeds (3 across)
#   sheets.py finals <dir>                             CHARACTERS.jpg, FACES.jpg (needs faces.json), SLEEVE-SIZE.jpg
import json, os, sys
from PIL import Image, ImageDraw, ImageFont
def font(s):
    for f in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        if os.path.exists(f): return ImageFont.truetype(f, s)
    return ImageFont.load_default()
BG = (236, 232, 225); INK = (30, 30, 30)
NAMES = [("green-woman", "The green woman", "composed, faintly pleased"),
         ("garnet-man", "The garnet man", "older, careworn, worried"),
         ("blue-man", "The blue man", "young, guarded, a sidelong look")]
if sys.argv[1] == "seeds":
    items = [a.split("=", 1) for a in sys.argv[3:]]
    tw, th = 608, 424; cols = 4; rows = (len(items) + cols - 1) // cols
    c = Image.new("RGB", (cols * (tw + 16) + 16, rows * (th + 44) + 16), BG); d = ImageDraw.Draw(c)
    for i, (lab, p) in enumerate(items):
        x, y = 16 + (i % cols) * (tw + 16), 16 + (i // cols) * (th + 44)
        c.paste(Image.open(p).convert("RGB").resize((tw, th), Image.LANCZOS), (x, y))
        d.text((x, y + th + 6), lab, fill=INK, font=font(22))
    c.save(sys.argv[2], quality=90)
else:
    D = sys.argv[2]
    fin = [Image.open(os.path.join(D, f"two-seats-{n}.png")).convert("RGB") for n, _, _ in NAMES]
    # CHARACTERS: three side by side, large
    w, h = 1000, 1400; c = Image.new("RGB", (3 * w + 4 * 40, h + 150), BG); d = ImageDraw.Draw(c)
    for i, (im, (_, t, s)) in enumerate(zip(fin, NAMES)):
        x = 40 + i * (w + 40); c.paste(im.resize((w, h), Image.LANCZOS), (x, 40))
        d.text((x, h + 55), t, fill=INK, font=font(38)); d.text((x, h + 102), s, fill=INK, font=font(28))
    c.save(os.path.join(D, "CHARACTERS.jpg"), quality=92)
    # FACES: each face cut from the final at 3x (each print pixel is 3 px)
    fj = json.load(open(os.path.join(D, "tools", "faces.json")))
    tiles = []
    for (n, t, s), im in zip(NAMES, fin):
        x0, y0, x1, y1 = fj[n]
        tiles.append((im.crop((x0, y0, x1, y1)).resize(((x1 - x0) * 3, (y1 - y0) * 3), Image.LANCZOS), t, s))
    W = sum(t[0].width for t in tiles) + 40 * 4; H = max(t[0].height for t in tiles) + 150
    c = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(c); x = 40
    for im, t, s in tiles:
        c.paste(im, (x, 40)); d.text((x, im.height + 55), t, fill=INK, font=font(34)); d.text((x, im.height + 98), s, fill=INK, font=font(26)); x += im.width + 40
    c.save(os.path.join(D, "FACES.jpg"), quality=92)
    # SLEEVE-SIZE: true print size on a 300 dpi canvas (63 x 88 mm = 744 x 1039 px), with a 10 mm scale bar
    pw, ph, mm10 = 744, 1039, round(10 / 25.4 * 300)
    c = Image.new("RGB", (3 * pw + 4 * 60 + mm10 + 60, ph + 200), BG); d = ImageDraw.Draw(c)
    for i, (im, (_, t, _s)) in enumerate(zip(fin, NAMES)):
        x = 60 + i * (pw + 60); c.paste(im.resize((pw, ph), Image.LANCZOS), (x, 60))
        d.text((x, ph + 75), t, fill=INK, font=font(26))
    bx = 60 + 3 * (pw + 60); by = 60 + ph - 20
    d.rectangle((bx, by, bx + mm10, by + 12), fill=INK)
    for k in range(11):
        d.line((bx + k * mm10 / 10, by - (10 if k in (0, 5, 10) else 5), bx + k * mm10 / 10, by), fill=INK, width=2)
    d.text((bx, by + 20), "10 mm", fill=INK, font=font(24))
    d.text((60, ph + 120), "Printed at 300 dpi on this canvas, each panel is 63 x 88 mm: print at 100 % or view at the size of a real card.", fill=INK, font=font(24))
    c.save(os.path.join(D, "SLEEVE-SIZE.jpg"), quality=92, dpi=(300, 300))
    print("sheets written")
