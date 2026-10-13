# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, order 1: CHECK.jpg and SLEEVE-SIZE.jpg.   sheets1.py <order-1 dir>   (run in two-seats-work/order1)
#   CHECK.jpg        three columns at full size: order 1 as it was (rev/work/order1-prev.png, commit 666a71f), this
#                    revision, round 8's form (round8/final); then, at 2x, this revision's hands beside the face
#                    (the match), with order 1's old hands for reference; then the robe's fold lines at 2x, all three
#   SLEEVE-SIZE.jpg  true print size (744 x 1039 = 63.5 x 88.9 mm at 297.6 px per inch) with a 10 mm bar
import sys, os
from PIL import Image, ImageDraw, ImageFont
OD = sys.argv[1]
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"; BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
f = lambda s, b=False: ImageFont.truetype(BOLD if b else FONT, s)
BG = (236, 232, 224); INK = (30, 30, 30)
new = Image.open(f"{OD}/two-seats-garnet-man.png").convert("RGB")
prev = Image.open("rev/work/order1-prev.png").convert("RGB")
r8 = Image.open("../round8/final/two-seats-garnet-man.png").convert("RGB")
pad, lab = 40, 60
HANDS = (600, 760, 900, 930); FACE = (620, 250, 880, 560); ROBE = (440, 560, 740, 800)
z = lambda im, b: im.crop(b).resize(((b[2] - b[0]) * 2, (b[3] - b[1]) * 2), Image.NEAREST)
aw, ah = (HANDS[2] - HANDS[0]) * 2, (HANDS[3] - HANDS[1]) * 2
fw, fh = (FACE[2] - FACE[0]) * 2, (FACE[3] - FACE[1]) * 2
rw, rh = (ROBE[2] - ROBE[0]) * 2, (ROBE[3] - ROBE[1]) * 2
W = 3 * 1500 + 4 * pad
H = pad + lab + 2100 + pad + lab + max(ah, fh) + pad + lab + rh + pad
S = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(S)
y = pad
for i, (t, im) in enumerate((("Order 1 as it was (666a71f)", prev), ("This revision", new), ("Round 8's form", r8))):
    d.text((pad + i * (1500 + pad), y), t, fill=INK, font=f(36, True)); S.paste(im, (pad + i * (1500 + pad), y + lab))
y += lab + 2100 + pad
d.text((pad, y), f"At 2x: this revision's hands {HANDS}, the face {FACE} (unchanged), order 1's old hands", fill=INK, font=f(32, True)); y += lab
S.paste(z(new, HANDS), (pad, y)); S.paste(z(new, FACE), (2 * pad + aw, y)); S.paste(z(prev, HANDS), (3 * pad + aw + fw, y))
y += max(ah, fh) + pad
d.text((pad, y), f"The robe's fold lines at 2x {ROBE}: order 1 as it was, this revision, round 8's form", fill=INK, font=f(32, True)); y += lab
for i, im in enumerate((prev, new, r8)):
    S.paste(z(im, ROBE), (pad + i * (rw + pad), y))
S.save(f"{OD}/CHECK.jpg", quality=88)
w, h = 744, 1039; mm = w / 63.5; pad = 40
S = Image.new("RGB", (2 * w + 3 * pad, h + 170), BG); d = ImageDraw.Draw(S)
S.paste(new.resize((w, h), Image.LANCZOS), (pad, pad)); S.paste(prev.resize((w, h), Image.LANCZOS), (2 * pad + w, pad))
d.text((pad, pad + h + 10), "Order 1, revised (this file)", fill=INK, font=f(24, True))
d.text((2 * pad + w, pad + h + 10), "Order 1 as it was", fill=INK, font=f(24, True))
by = pad + h + 70
d.rectangle([pad, by, pad + round(10 * mm), by + 10], fill=INK)
d.text((pad + round(10 * mm) + 14, by - 8), "10 mm (the card is 63.5 x 88.9 mm; at 297.6 px per inch this sheet is print size)", fill=INK, font=f(20))
S.save(f"{OD}/SLEEVE-SIZE.jpg", quality=92, dpi=(297.6, 297.6))
print("sheets ok", os.path.getsize(f"{OD}/CHECK.jpg"), os.path.getsize(f"{OD}/SLEEVE-SIZE.jpg"))
