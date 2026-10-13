# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 4: review sheets.
#   sheets.py cands <work> <n> <face|hands> <out.jpg>         the draft's crop beside every candidate repaint
#   sheets.py final <draft-dir> <round4-dir> <work>           BEFORE-AFTER.jpg, FACES-BEFORE-AFTER.jpg, SLEEVE-SIZE.jpg
import glob, json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__))
F = lambda s: ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", s)
BG = (236, 232, 222); INK = (30, 28, 26)
def label(im, txt, size=28):
    c = Image.new("RGB", (im.width, im.height + size + 16), BG); c.paste(im, (0, size + 16))
    ImageDraw.Draw(c).text((6, 6), txt, fill=INK, font=F(size)); return c
def row(ims, gap=16):
    W = sum(i.width for i in ims) + gap * (len(ims) + 1); H = max(i.height for i in ims) + 2 * gap
    c = Image.new("RGB", (W, H), BG); x = gap
    for i in ims: c.paste(i, (x, gap)); x += i.width + gap
    return c
def col(ims, gap=16):
    W = max(i.width for i in ims) + 2 * gap; H = sum(i.height for i in ims) + gap * (len(ims) + 1)
    c = Image.new("RGB", (W, H), BG); y = gap
    for i in ims: c.paste(i, ((W - i.width) // 2, y)); y += i.height + gap
    return c
def crop57(path):   # the same cover crop finish.py makes, without the symmetry rebuild
    im = Image.open(path).convert("RGB"); W, H = im.size; cw = round(H * 5 / 7); x0 = (W - cw) // 2
    return im.crop((x0, 0, x0 + cw, H)).resize((1500, 2100), Image.LANCZOS)
if sys.argv[1] == "cands":
    work, n, kind, out = sys.argv[2:6]
    o = Image.open(f"{work}/crops/{n}-{kind}.png"); s = 0.6
    tiles = [label(o.resize((int(o.width * s), int(o.height * s))), "draft (3.2x)", 22)]
    for p in sorted(glob.glob(f"{work}/raw/{n}-{kind}-*-s*.png")):
        t = Image.open(p); tiles.append(label(t.resize((int(t.width * s), int(t.height * s))), os.path.basename(p)[:-4], 22))
    rows = [row(tiles[i:i + 4]) for i in range(0, len(tiles), 4)]
    col(rows).save(out, quality=88)
else:
    D, OUT, work = sys.argv[2:5]
    R = json.load(open(os.path.join(HERE, "regions.json")))
    names = {"1": "two-seats-1 (green woman)", "2": "two-seats-2 (red hooded man)", "3": "two-seats-3 (blue figure)"}
    # BEFORE-AFTER: the draft (same 5:7 crop) beside the fixed final, large
    rows = []
    for n in "123":
        b = crop57(f"{D}/two-seats-{n}.png").resize((1050, 1470), Image.LANCZOS)
        a = Image.open(f"{OUT}/two-seats-{n}-fixed.png").convert("RGB").resize((1050, 1470), Image.LANCZOS)
        rows.append(row([label(b, f"{names[n]} - first draft, as it was", 30), label(a, f"{names[n]} - fixed (faces and hands only)", 30)]))
    col(rows).save(f"{OUT}/BEFORE-AFTER.jpg", quality=90)
    # FACES-BEFORE-AFTER: face and hands, 3x, before and after (top seat; the bottom seat is the same pixels turned)
    rows = []
    for n in "123":
        b = Image.open(f"{D}/two-seats-{n}.png").convert("RGB"); a = Image.open(f"{work}/fixed/two-seats-{n}-fixed-full.png").convert("RGB")
        cells = []
        for kind in ("face", "hands"):
            x0, y0, x1, y1 = R[n][kind]["box"]
            for im, tag in ((b, "before"), (a, "after")):
                c = im.crop((x0, y0, x1, y1)); c = c.resize((c.width * 3, c.height * 3), Image.LANCZOS)
                if kind == "hands": c = c.resize((int(c.width * 0.75), int(c.height * 0.75)), Image.LANCZOS)
                cells.append(label(c, f"{n} {kind} {tag}", 26))
        rows.append(row(cells[:2] + cells[2:]))
    col(rows).save(f"{OUT}/FACES-BEFORE-AFTER.jpg", quality=90)
    # SLEEVE-SIZE: true print size at 300 ppi (63.0 x 88.0 mm = 744 x 1039), with a 10 mm bar
    cards = [Image.open(f"{OUT}/two-seats-{n}-fixed.png").convert("RGB").resize((744, 1039), Image.LANCZOS) for n in "123"]
    sheet = row(cards, 40)
    c = Image.new("RGB", (sheet.width, sheet.height + 110), BG); c.paste(sheet, (0, 0)); d = ImageDraw.Draw(c)
    bar = round(10 / 25.4 * 300); y = sheet.height + 30
    d.rectangle((40, y, 40 + bar, y + 14), fill=INK)
    d.text((40 + bar + 20, y - 8), "10 mm at 300 ppi - view at 100% on a ~300 ppi screen, or print at 300 dpi: each card is 63 x 88 mm, the size under a Dragon Shield standard sleeve", fill=INK, font=F(22))
    c.save(f"{OUT}/SLEEVE-SIZE.jpg", quality=92, dpi=(300, 300))
    print("sheets written")
