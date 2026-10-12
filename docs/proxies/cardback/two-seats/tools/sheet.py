# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats (sleeve): the review sheets.
#   sheet.py contact <out.jpg> <label=img.png> ...      the candidates side by side, labelled
#   sheet.py zoom    <out.jpg> <label=img.png> ...      faces and hands at 100% (both seats: the top half and
#                                                       the turned bottom), one row per image
#   sheet.py margins <out.jpg> <img.png> ...            the keep-inside margin (110 px) and a 3 mm edge line
import sys
from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
mode, out = sys.argv[1], sys.argv[2]
items = [a.split("=", 1) if "=" in a else (a.rsplit("/", 1)[-1][:-4], a) for a in sys.argv[3:]]
BG = (236, 232, 224)


def font(sz, b=False):
    return ImageFont.truetype(BOLD if b else FONT, sz)


if mode == "contact":
    w, h = 600, 840
    cols = min(len(items), 3); rows = (len(items) + cols - 1) // cols
    S = Image.new("RGB", (cols * (w + 30) + 30, rows * (h + 80) + 30), BG); d = ImageDraw.Draw(S)
    for i, (lab, p) in enumerate(items):
        x = 30 + (i % cols) * (w + 30); y = 30 + (i // cols) * (h + 80)
        S.paste(Image.open(p).convert("RGB").resize((w, h), Image.LANCZOS), (x, y))
        d.text((x, y + h + 12), lab, fill=(30, 30, 30), font=font(26, True))
    S.save(out, quality=90)
elif mode == "zoom":
    # 100% crops at 600 dpi (one print pixel each): the face, the hands and fan's foot, the lamp. The other seat
    # is the same pixels turned (the art is exactly 180-degree symmetric), so one seat is shown.
    boxes = [("face", (600, 290, 900, 590)), ("hands", (540, 690, 960, 990)), ("lamp", (600, 900, 900, 1200))]
    cw = sum(b[1][2] - b[1][0] + 10 for b in boxes)
    rowh = 300 + 50
    S = Image.new("RGB", (300 + cw + 20, 70 + len(items) * rowh), BG); d = ImageDraw.Draw(S)
    d.text((30, 20), "Faces, hands and the lamp at 100% (600 dpi, one print pixel each); the other seat is these pixels turned 180 degrees",
           fill=(40, 40, 40), font=font(20))
    for i, (lab, p) in enumerate(items):
        bx = boxes
        if "|" in p:   # path|x0,y0,x1,y1;... : boxes of the same sizes placed elsewhere (another image's layout)
            p, spec = p.split("|")
            bx = [(n, tuple(int(v) for v in b.split(","))) for (n, _), b in zip(boxes, spec.split(";"))]
        im = Image.open(p).convert("RGB")
        y = 70 + i * rowh
        for j, line in enumerate(lab.split("/")):
            d.text((30, y + 110 + j * 30), line.strip(), fill=(30, 30, 30), font=font(22 if j else 24, j == 0))
        x = 300
        for name, (x0, y0, x1, y1) in bx:
            S.paste(im.crop((x0, y0, x1, y1)), (x, y)); x += x1 - x0 + 10
    S.save(out, quality=92)
elif mode == "margins":
    w, h = 600, 840
    S = Image.new("RGB", (len(items) * (w + 30) + 30, h + 150), BG); d = ImageDraw.Draw(S)
    k = w / 1500
    for i, (lab, p) in enumerate(items):
        x = 30 + i * (w + 30); y = 30
        S.paste(Image.open(p).convert("RGB").resize((w, h), Image.LANCZOS), (x, y))
        e = 71 * k; m = 110 * k
        d.rectangle([x + e, y + e, x + w - e, y + h - e], outline=(200, 30, 30), width=2)
        d.rectangle([x + m, y + m, x + w - m, y + h - m], outline=(30, 80, 220), width=2)
        d.text((x, y + h + 10), lab, fill=(30, 30, 30), font=font(22, True))
    d.text((30, h + 75), "red: 3 mm (71 px) in from the image edge, a guess at the trim and edge wrap (Sleeve Crafter does not document it)",
           fill=(160, 20, 20), font=font(18))
    d.text((30, h + 100), "blue: 110 px keep-inside margin; every figure, hand and the lamp sits inside it", fill=(20, 60, 190), font=font(18))
    S.save(out, quality=90)
print(out)
