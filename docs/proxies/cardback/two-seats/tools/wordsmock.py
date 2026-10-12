# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats (sleeve): a MOCK of where words would go, for the owner to accept or strike. Not the art: the
# words are meant to be set in SVG at print time, never painted. One short line on the table's board, split by
# the lamp, on each seat's side of the table, reading toward that seat; the top seat's line is the bottom one
# turned 180 degrees, so the symmetry holds.
# Usage: wordsmock.py <art.png> <out.jpg> "<left words>" "<right words>"
import sys
from PIL import Image, ImageDraw, ImageFont

art, out, left, right = sys.argv[1:5]
FONT = "/usr/share/fonts/opentype/urw-base35/C059-Roman.otf"
im = Image.open(art).convert("RGB")
W, H = im.size
lay = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
f = ImageFont.truetype(FONT, 34)
Y = 1098                                   # the board between the lamp's seam and the bottom seat's moulding
GOLD = (214, 178, 104, 255)


def spaced(text, cx):
    widths = [d.textlength(c, font=f) for c in text]
    track = 7
    total = sum(widths) + track * (len(text) - 1)
    x = cx - total / 2
    for c, w in zip(text, widths):
        d.text((x, Y), c, font=f, fill=GOLD, anchor="lm"); x += w + track


spaced(left, 470)
spaced(right, 1030)
both = Image.alpha_composite(lay, lay.rotate(180))
res = Image.alpha_composite(im.convert("RGBA"), both).convert("RGB")
d2 = ImageDraw.Draw(res)
res.save(out, quality=92)
print(out)
