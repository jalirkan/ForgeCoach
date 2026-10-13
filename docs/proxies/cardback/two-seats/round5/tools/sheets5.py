# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 5: the review sheets.
#   sheets5.py <outdir> <round2-dir> <round4-dir>
#   CHARACTERS.jpg (round 2's layout exactly), ROUND4-VS-ROUND5.jpg, ROUND2-VS-ROUND5.jpg, FACES.jpg (3x), SLEEVE-SIZE.jpg (744x1039 each,
#   the true print size at 600 dpi shown at 297.6 px per inch, with a 10 mm bar), CUT-SAFE.jpg
import sys
from PIL import Image, ImageDraw, ImageFont
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"; BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
O, R2, R4 = sys.argv[1:4]; BG = (236, 232, 224); INK = (30, 30, 30)
C = [("green-woman", "green-woman", 1, "The green woman", "calm, composed"),
     ("garnet-man", "garnet-man", 2, "The garnet man", "anxious, worried"),
     ("blue-man", "blue-figure", 3, "The blue man", "guarded, intent")]
f = lambda s, b=False: ImageFont.truetype(BOLD if b else FONT, s)
img = lambda n: Image.open(f"{O}/two-seats-{n}.png").convert("RGB")
r2 = lambda n: Image.open(f"{R2}/two-seats-{n}.png").convert("RGB")

# CHARACTERS: as round 2's sheet, so the two can be laid side by side
w, h = 1000, 1400
S = Image.new("RGB", (3 * w + 4 * 40, h + 160), BG); d = ImageDraw.Draw(S)
for i, (n, _, _k, t, e) in enumerate(C):
    x = 40 + i * (w + 40)
    S.paste(img(n).resize((w, h), Image.LANCZOS), (x, 40))
    d.text((x, h + 56), t, fill=INK, font=f(38, True)); d.text((x, h + 104), e, fill=INK, font=f(30))
S.save(f"{O}/CHARACTERS.jpg", quality=90)

# ROUND4-VS-ROUND5 and ROUND2-VS-ROUND5: per character, the earlier round's final beside round 5's
r4 = lambda k: Image.open(f"{R4}/two-seats-{k}-fixed.png").convert("RGB")
for name, src, lab0 in (("ROUND4-VS-ROUND5", lambda n2, k: r4(k), "round 4 (the draft figure, its own setting)"),
                        ("ROUND2-VS-ROUND5", lambda n2, k: r2(n2), "round 2")):
    w, h = 700, 980
    S = Image.new("RGB", (2 * w + 3 * 40, 3 * (h + 90) + 40), BG); d = ImageDraw.Draw(S)
    for r, (n, n2, k, t, e) in enumerate(C):
        y = 40 + r * (h + 90)
        for j, (im, lab) in enumerate(((src(n2, k), lab0), (img(n), "round 5"))):
            x = 40 + j * (w + 40)
            S.paste(im.resize((w, h), Image.LANCZOS), (x, y))
            d.text((x, y + h + 14), f"{t}: {lab}", fill=INK, font=f(24, True))
    S.save(f"{O}/{name}.jpg", quality=88)

# FACES: each face from the final at 3x (each print pixel 3 px)
box = (600, 260, 900, 540); k = 3
fw, fh = (box[2] - box[0]) * k, (box[3] - box[1]) * k
S = Image.new("RGB", (3 * fw + 4 * 30, fh + 150), BG); d = ImageDraw.Draw(S)
for i, (n, _, _k, t, e) in enumerate(C):
    x = 30 + i * (fw + 30)
    S.paste(img(n).crop(box).resize((fw, fh), Image.LANCZOS), (x, 30))
    d.text((x, fh + 46), t, fill=INK, font=f(32, True)); d.text((x, fh + 92), e, fill=INK, font=f(26))
S.save(f"{O}/FACES.jpg", quality=92)

# SLEEVE-SIZE: 63.5 x 88.9 mm each at 297.6 px per inch (744 x 1039), a 10 mm bar (117 px)
w, h = 744, 1039; mm = w / 63.5
S = Image.new("RGB", (3 * w + 4 * 30, h + 150), BG); d = ImageDraw.Draw(S)
for i, (n, _, _k, t, e) in enumerate(C):
    x = 30 + i * (w + 30)
    S.paste(img(n).resize((w, h), Image.LANCZOS), (x, 30)); d.text((x, h + 44), t, fill=INK, font=f(24, True))
bx, by = 30, h + 100
d.rectangle([bx, by, bx + round(10 * mm), by + 10], fill=INK)
d.text((bx + round(10 * mm) + 14, by - 8), "10 mm (the card is 63.5 x 88.9 mm; at 297.6 px per inch this sheet is print size)", fill=INK, font=f(20))
S.save(f"{O}/SLEEVE-SIZE.jpg", quality=92, dpi=(297.6, 297.6))

# CUT-SAFE: the 110 px keep-inside margin (blue) and a 3 mm edge line (red, 71 px at 600 dpi)
w, h = 750, 1050; s = w / 1500
S = Image.new("RGB", (3 * w + 4 * 30, h + 90), BG); d = ImageDraw.Draw(S)
for i, (n, _, _k, t, e) in enumerate(C):
    x = 30 + i * (w + 30)
    im = img(n).resize((w, h), Image.LANCZOS); dd = ImageDraw.Draw(im)
    for m, col in ((110, (40, 90, 220)), (71, (220, 40, 40))):
        dd.rectangle([m * s, m * s, w - 1 - m * s, h - 1 - m * s], outline=col, width=2)
    S.paste(im, (x, 30)); d.text((x, h + 44), t, fill=INK, font=f(26, True))
S.save(f"{O}/CUT-SAFE.jpg", quality=88)
print("sheets in", O)
