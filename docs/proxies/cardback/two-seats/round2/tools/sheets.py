# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 2: the review sheets.
#   sheets.py <outdir>     CHARACTERS.jpg, FACES.jpg, GOLD-COMPARE.jpg, CUT-SAFE.jpg from the finals in <outdir>
import sys
from PIL import Image, ImageDraw, ImageFont
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"; BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
O = sys.argv[1]; BG = (236, 232, 224); INK = (30, 30, 30)
C = [("green-woman", "The green woman", "composed, faintly pleased"),
     ("garnet-man", "The garnet man", "anxious, worried"),
     ("blue-figure", "The blue figure", "guarded, intent, a sidelong look")]
f = lambda s, b=False: ImageFont.truetype(BOLD if b else FONT, s)
img = lambda n: Image.open(f"{O}/two-seats-{n}.png").convert("RGB")

# CHARACTERS: the three finals (punched gold) side by side, large
w, h = 1000, 1400
S = Image.new("RGB", (3 * w + 4 * 40, h + 160), BG); d = ImageDraw.Draw(S)
for i, (n, t, e) in enumerate(C):
    x = 40 + i * (w + 40)
    S.paste(img(n).resize((w, h), Image.LANCZOS), (x, 40))
    d.text((x, h + 56), t, fill=INK, font=f(38, True)); d.text((x, h + 104), e, fill=INK, font=f(30))
S.save(f"{O}/CHARACTERS.jpg", quality=90)

# FACES: each face cropped from the final at 3x (each print pixel 3 px), side by side
box = (630, 350, 870, 610); k = 3
fw, fh = (box[2] - box[0]) * k, (box[3] - box[1]) * k
S = Image.new("RGB", (3 * fw + 4 * 30, fh + 150), BG); d = ImageDraw.Draw(S)
for i, (n, t, e) in enumerate(C):
    x = 30 + i * (fw + 30)
    S.paste(img(n).crop(box).resize((fw, fh), Image.LANCZOS), (x, 30))
    d.text((x, fh + 46), t, fill=INK, font=f(32, True)); d.text((x, fh + 92), e, fill=INK, font=f(26))
S.save(f"{O}/FACES.jpg", quality=92)

# GOLD-COMPARE: per character, the punched diamond gold (primary) beside the streaky worked leaf
w, h = 700, 980
S = Image.new("RGB", (2 * w + 3 * 40, 3 * (h + 90) + 40), BG); d = ImageDraw.Draw(S)
for r, (n, t, e) in enumerate(C):
    y = 40 + r * (h + 90)
    for j, (suf, lab) in enumerate((("", "punched diamond gold (primary)"), ("-streaky", "streaky worked leaf (comparison)"))):
        x = 40 + j * (w + 40)
        S.paste(Image.open(f"{O}/two-seats-{n}{suf}.png").convert("RGB").resize((w, h), Image.LANCZOS), (x, y))
        d.text((x, y + h + 14), f"{t}: {lab}", fill=INK, font=f(24, True))
S.save(f"{O}/GOLD-COMPARE.jpg", quality=88)

# CUT-SAFE: the 110 px keep-inside margin (blue) and a 3 mm edge line (red, 71 px at 600 dpi)
w, h = 750, 1050; s = w / 1500
S = Image.new("RGB", (3 * w + 4 * 30, h + 90), BG); d = ImageDraw.Draw(S)
for i, (n, t, e) in enumerate(C):
    x = 30 + i * (w + 30)
    im = img(n).resize((w, h), Image.LANCZOS); dd = ImageDraw.Draw(im)
    for m, col in ((110, (40, 90, 220)), (71, (220, 40, 40))):
        dd.rectangle([m * s, m * s, w - 1 - m * s, h - 1 - m * s], outline=col, width=2)
    S.paste(im, (x, 30)); d.text((x, h + 44), t, fill=INK, font=f(26, True))
S.save(f"{O}/CUT-SAFE.jpg", quality=88)
print("sheets in", O)
