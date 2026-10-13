# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, grounds: the review sheets.   sheets.py <grounds-dir> <final-dir>
#   GROUNDS-COMPARE.jpg      three rows (the current punched gold, ground A, ground B), one column per character, large
#   GROUNDS-SLEEVE-SIZE.jpg  A and B at print size (744 x 1039 each = 63.5 x 88.9 mm at 297.6 px per inch), 10 mm bar
import sys
from PIL import Image, ImageDraw, ImageFont
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"; BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
O, FIN = sys.argv[1:3]; BG = (236, 232, 224); INK = (30, 30, 30)
f = lambda s, b=False: ImageFont.truetype(BOLD if b else FONT, s)
C = [("green", "green-woman", "The green woman"), ("garnet", "garnet-man", "The garnet man"), ("blue", "blue-man", "The blue man")]
ROWS = [("Current: punched gold, floral border", lambda t, n: f"{FIN}/two-seats-{n}.png"),
        ("A: the drafts' streaky worked leaf, plain moulding", lambda t, n: f"{O}/A-{t}.png"),
        ("B: dark tooled damask in the figure's colour, plain moulding", lambda t, n: f"{O}/B-{t}.png")]

w, h, pad, lab = 900, 1260, 40, 70
S = Image.new("RGB", (3 * w + 4 * pad, 3 * (h + lab) + pad + 60), BG); d = ImageDraw.Draw(S)
for j, (row, src) in enumerate(ROWS):
    y = pad + j * (h + lab)
    d.text((pad, y), row, fill=INK, font=f(36, True))
    for i, (t, n, title) in enumerate(C):
        x = pad + i * (w + pad)
        S.paste(Image.open(src(t, n)).convert("RGB").resize((w, h), Image.LANCZOS), (x, y + 52))
for i, (t, n, title) in enumerate(C):
    d.text((pad + i * (w + pad), 3 * (h + lab) + pad + 10), title, fill=INK, font=f(32, True))
S.save(f"{O}/GROUNDS-COMPARE.jpg", quality=90)

w, h = 744, 1039; mm = w / 63.5; pad = 30
S = Image.new("RGB", (3 * w + 4 * pad, 2 * (h + 60) + pad + 80), BG); d = ImageDraw.Draw(S)
for j, (g, gl) in enumerate((("A", "A, streaky leaf"), ("B", "B, damask"))):
    for i, (t, n, title) in enumerate(C):
        x, y = pad + i * (w + pad), pad + j * (h + 60)
        S.paste(Image.open(f"{O}/{g}-{t}.png").convert("RGB").resize((w, h), Image.LANCZOS), (x, y))
        d.text((x, y + h + 12), f"{title}, {gl}", fill=INK, font=f(24, True))
bx, by = pad, 2 * (h + 60) + pad + 30
d.rectangle([bx, by, bx + round(10 * mm), by + 10], fill=INK)
d.text((bx + round(10 * mm) + 14, by - 8), "10 mm (the card is 63.5 x 88.9 mm; at 297.6 px per inch this sheet is print size)", fill=INK, font=f(20))
S.save(f"{O}/GROUNDS-SLEEVE-SIZE.jpg", quality=92, dpi=(297.6, 297.6))
print("sheets in", O)
