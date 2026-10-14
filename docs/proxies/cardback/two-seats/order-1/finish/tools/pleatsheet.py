# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, orders 1 and 2: append the "chest pleats" band to a CHECK.jpg, after the order's own sheet script
# (order-1/finish/tools/sheets3.py, order-2/tools/sheets.py check) has written it.
#   pleatsheet.py <CHECK.jpg> <before card.png> <after card.png> <x0,y0,x1,y1> <title>
# Before and after at 2x, nearest-neighbour as the sheets' other panels, with round 8's form (its print file) beside
# them at the same box and scale for reference.
import sys
from PIL import Image, ImageDraw, ImageFont
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
BG = (236, 232, 224); INK = (30, 30, 30)
chk, before, after, box, title = sys.argv[1], sys.argv[2], sys.argv[3], tuple(map(int, sys.argv[4].split(","))), sys.argv[5]
r8 = sys.argv[6] if len(sys.argv) > 6 else None
S0 = Image.open(chk).convert("RGB")
z = lambda p: Image.open(p).convert("RGB").crop(box).resize(((box[2] - box[0]) * 2, (box[3] - box[1]) * 2), Image.NEAREST)
tiles = [("before", z(before)), ("after", z(after))] + ([("round 8 (the lines' source)", z(r8))] if r8 else [])
pad, lab = 40, 56
w, h = tiles[0][1].size
H = S0.height + lab + 36 + h + 2 * pad
S = Image.new("RGB", (S0.width, H), BG); S.paste(S0, (0, 0)); d = ImageDraw.Draw(S)
y = S0.height
d.text((pad, y), title, fill=INK, font=ImageFont.truetype(FONT, 30)); y += lab
x = pad
for t, im in tiles:
    d.text((x, y), t, fill=INK, font=ImageFont.truetype(FONT, 24)); S.paste(im, (x, y + 36)); x += w + pad // 2
S.save(chk, quality=88)
print(chk, S.size)
