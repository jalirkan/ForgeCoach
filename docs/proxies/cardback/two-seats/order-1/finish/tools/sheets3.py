# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, order 1, finish: CHECK.jpg and SLEEVE-SIZE.jpg.   sheets3.py <order-1 dir>   (run in two-seats-work/order1/finish)
#   CHECK.jpg        three cards at full size: the finished card, the raw one-pass pick (DreamShaper 0.40 s9702,
#                    one-pass/two-seats-garnet-man-ds-40-s9702.png) and the previous order-1 file (63ae528); then every
#                    fix at 2x, before (the raw pick) and after (the finished card), nearest-neighbour so no pixel is
#                    smoothed by the sheet
#   SLEEVE-SIZE.jpg  true print size (744 x 1039 = 63.5 x 88.9 mm at 297.6 px per inch) with a 10 mm bar
import sys, os
from PIL import Image, ImageDraw, ImageFont
OD = sys.argv[1]
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"; BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
f = lambda s, b=False: ImageFont.truetype(BOLD if b else FONT, s)
BG = (236, 232, 224); INK = (30, 30, 30)
new = Image.open(f"{OD}/two-seats-garnet-man.png").convert("RGB")
raw = Image.open(f"{OD}/one-pass/two-seats-garnet-man-ds-40-s9702.png").convert("RGB")
prev = Image.open("work/prev-order1.png").convert("RGB")
FIX = [("1. Hands (DS 0.58 s9803 of 10)", (630, 765, 875, 915)),
       ("5. Cards (value/hue shift in the card mask; foot repainted with the hands)", (610, 650, 890, 845)),
       ("2. Tankard (DS 0.50 s9811 of 4)", (425, 895, 585, 1030)),
       ("2. Napkin and coin (DS 0.55 s9821 of 3)", (915, 945, 1115, 1035)),
       ("3. Lamp (DS 0.50 s9831 of 3, globe only; the top half turned)", (630, 945, 870, 1155)),
       ("4. Robe's left edge (layout guide, DS 0.56 s9841 of 4)", (400, 700, 560, 950)),
       ("7. Cheek (DS 0.46 s9851 of 4)", (700, 360, 860, 510)),
       ("7. Collar strap (DS 0.42 s9861, collar only)", (790, 460, 910, 560))]
pad, lab = 40, 56
z = lambda im, b: im.crop(b).resize(((b[2] - b[0]) * 2, (b[3] - b[1]) * 2), Image.NEAREST)
W = 3 * 1500 + 4 * pad
rows = []; x = pad; row = []; rh = 0
for t, b in FIX:
    w = max((b[2] - b[0]) * 4 + pad // 2, int(f(24, True).getlength(t + ": before | after, 2x")))
    if x + w > W and row: rows.append((row, rh)); row = []; x = pad; rh = 0
    row.append((t, b, x)); x += w + pad; rh = max(rh, (b[3] - b[1]) * 2)
rows.append((row, rh))
H = pad + lab + 2100 + pad + sum(lab + r + pad for _, r in rows) + pad
S = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(S)
y = pad
for i, (t, im) in enumerate((("Finished (this file)", new), ("The pick as painted: DreamShaper 0.40, seed 9702", raw), ("Order 1 before this (63ae528)", prev))):
    d.text((pad + i * (1500 + pad), y), t, fill=INK, font=f(36, True)); S.paste(im, (pad + i * (1500 + pad), y + lab))
y += lab + 2100 + pad
for row, rh in rows:
    for t, b, x in row:
        d.text((x, y), t + ": before | after, 2x", fill=INK, font=f(24, True))
        S.paste(z(raw, b), (x, y + lab)); S.paste(z(new, b), (x + (b[2] - b[0]) * 2 + pad // 2, y + lab))
    y += lab + rh + pad
S.save(f"{OD}/CHECK.jpg", quality=88)
w, h = 744, 1039; mm = w / 63.5; pad = 40
S = Image.new("RGB", (3 * w + 4 * pad, h + 170), BG); d = ImageDraw.Draw(S)
for i, (t, im) in enumerate((("Finished (this file)", new), ("The pick as painted (s9702)", raw), ("Order 1 before this", prev))):
    S.paste(im.resize((w, h), Image.LANCZOS), (pad + i * (w + pad), pad))
    d.text((pad + i * (w + pad), pad + h + 10), t, fill=INK, font=f(24, True))
by = pad + h + 70
d.rectangle([pad, by, pad + round(10 * mm), by + 10], fill=INK)
d.text((pad + round(10 * mm) + 14, by - 8), "10 mm (the card is 63.5 x 88.9 mm; at 297.6 px per inch this sheet is print size)", fill=INK, font=f(20))
S.save(f"{OD}/SLEEVE-SIZE.jpg", quality=92, dpi=(297.6, 297.6))
print("sheets ok", os.path.getsize(f"{OD}/CHECK.jpg"), os.path.getsize(f"{OD}/SLEEVE-SIZE.jpg"))
