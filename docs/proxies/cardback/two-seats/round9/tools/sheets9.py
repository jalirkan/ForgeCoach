# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 9: the review sheets.
#   sheets9.py <outdir> <round8-dir>
#   CHARACTERS-PROPS.jpg / CHARACTERS-NOPROPS.jpg (round 8's CHARACTERS layout), ROUND8-VS-ROUND9.jpg (round 8, then
#   round 9 with and without props), HANDS-ZOOM.jpg (the hands and fan, x 600-900, y 660-920 at 2x, round 8 beside
#   round 9), HEM-ZOOM.jpg (x 440-840, y 500-720 at 2x, round 8 beside round 9), PROPS-ZOOM.jpg (x 340-1160,
#   y 896-1040 at 2x, round 8 above round 9), SLEEVE-SIZE.jpg (744x1039 each, print size at 297.6 px per inch, a
#   10 mm bar), CUT-SAFE.jpg (the 110 px keep-inside margin in blue, a 3 mm edge line in red)
import sys
from PIL import Image, ImageDraw, ImageFont
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"; BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
O, R8 = sys.argv[1:3]; BG = (236, 232, 224); INK = (30, 30, 30)
C = [("green-woman", "The green woman", "calm, composed"),
     ("garnet-man", "The garnet man", "anxious, worried"),
     ("blue-man", "The blue man", "guarded, intent")]
f = lambda s, b=False: ImageFont.truetype(BOLD if b else FONT, s)
img = lambda n, v: Image.open(f"{O}/two-seats-{n}-{v}.png").convert("RGB")
r8 = lambda n: Image.open(f"{R8}/two-seats-{n}.png").convert("RGB")

w, h = 1000, 1400
for v, V in (("props", "PROPS"), ("noprops", "NOPROPS")):
    S = Image.new("RGB", (3 * w + 4 * 40, h + 160), BG); d = ImageDraw.Draw(S)
    for i, (n, t, e) in enumerate(C):
        x = 40 + i * (w + 40)
        S.paste(img(n, v).resize((w, h), Image.LANCZOS), (x, 40))
        d.text((x, h + 56), t, fill=INK, font=f(38, True)); d.text((x, h + 104), e, fill=INK, font=f(30))
    S.save(f"{O}/CHARACTERS-{V}.jpg", quality=90)

w, h = 600, 840
S = Image.new("RGB", (3 * w + 4 * 40, 3 * (h + 80) + 40), BG); d = ImageDraw.Draw(S)
for r, (n, t, e) in enumerate(C):
    y = 40 + r * (h + 80)
    for j, (im, lab) in enumerate(((r8(n), "round 8"), (img(n, "props"), "round 9, props"), (img(n, "noprops"), "round 9, no props"))):
        x = 40 + j * (w + 40)
        S.paste(im.resize((w, h), Image.LANCZOS), (x, y))
        d.text((x, y + h + 12), f"{t}: {lab}", fill=INK, font=f(22, True))
S.save(f"{O}/ROUND8-VS-ROUND9.jpg", quality=88)

def zoom(name, box, k, label, vertical=False):
    bw, bh = (box[2] - box[0]) * k, (box[3] - box[1]) * k
    if vertical:
        S = Image.new("RGB", (bw + 60, 3 * 2 * (bh + 50) + 30), BG)
    else:
        S = Image.new("RGB", (2 * bw + 3 * 30, 3 * (bh + 60) + 30), BG)
    d = ImageDraw.Draw(S)
    for r, (n, t, e) in enumerate(C):
        for j, (im, lab) in enumerate(((r8(n), "round 8"), (img(n, "props"), "round 9"))):
            if vertical:
                x, y = 30, 30 + (2 * r + j) * (bh + 50)
            else:
                x, y = 30 + j * (bw + 30), 30 + r * (bh + 60)
            S.paste(im.crop(box).resize((bw, bh), Image.LANCZOS), (x, y))
            d.text((x, y + bh + 10), f"{t}: {lab}, {label} ({k}x)", fill=INK, font=f(21, True))
    S.save(f"{O}/{name}", quality=92)
zoom("HANDS-ZOOM.jpg", (600, 660, 900, 920), 2, "hands and fan")
zoom("HEM-ZOOM.jpg", (440, 500, 840, 720), 2, "the hem")
zoom("PROPS-ZOOM.jpg", (340, 896, 1160, 1040), 2, "the props", vertical=True)

w, h = 744, 1039; mm = w / 63.5
S = Image.new("RGB", (3 * w + 4 * 30, 2 * (h + 70) + 80), BG); d = ImageDraw.Draw(S)
for r, v in enumerate(("props", "noprops")):
    for i, (n, t, e) in enumerate(C):
        x, y = 30 + i * (w + 30), 30 + r * (h + 70)
        S.paste(img(n, v).resize((w, h), Image.LANCZOS), (x, y))
        d.text((x, y + h + 14), f"{t}, {'props' if v == 'props' else 'no props'}", fill=INK, font=f(24, True))
bx, by = 30, 2 * (h + 70) + 40
d.rectangle([bx, by, bx + round(10 * mm), by + 10], fill=INK)
d.text((bx + round(10 * mm) + 14, by - 8), "10 mm (the card is 63.5 x 88.9 mm; at 297.6 px per inch this sheet is print size)", fill=INK, font=f(20))
S.save(f"{O}/SLEEVE-SIZE.jpg", quality=92, dpi=(297.6, 297.6))

w, h = 750, 1050; s = w / 1500
S = Image.new("RGB", (3 * w + 4 * 30, 2 * (h + 70) + 30), BG); d = ImageDraw.Draw(S)
for r, v in enumerate(("props", "noprops")):
    for i, (n, t, e) in enumerate(C):
        x, y = 30 + i * (w + 30), 30 + r * (h + 70)
        im = img(n, v).resize((w, h), Image.LANCZOS); dd = ImageDraw.Draw(im)
        for m, col in ((110, (40, 90, 220)), (71, (220, 40, 40))):
            dd.rectangle([m * s, m * s, w - 1 - m * s, h - 1 - m * s], outline=col, width=2)
        S.paste(im, (x, y)); d.text((x, y + h + 14), f"{t}, {'props' if v == 'props' else 'no props'}", fill=INK, font=f(24, True))
S.save(f"{O}/CUT-SAFE.jpg", quality=88)
print("sheets in", O)
