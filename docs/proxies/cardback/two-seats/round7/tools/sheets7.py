# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 7: the review sheets.
#   sheets7.py <outdir> <round6-dir>
#   CHARACTERS.jpg (round 6's layout exactly), ROUND6-VS-ROUND7.jpg, HANDS-ZOOM.jpg (the hands, fan, arms and
#   chest at 2x, round 6 beside round 7), SLEEVE-SIZE.jpg (744x1039 each, print size at 297.6 px per inch, a 10 mm
#   bar), CUT-SAFE.jpg
import sys
from PIL import Image, ImageDraw, ImageFont
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"; BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
O, R6 = sys.argv[1:3]; BG = (236, 232, 224); INK = (30, 30, 30)
C = [("green-woman", "The green woman", "calm, composed"),
     ("garnet-man", "The garnet man", "anxious, worried"),
     ("blue-man", "The blue man", "guarded, intent")]
f = lambda s, b=False: ImageFont.truetype(BOLD if b else FONT, s)
img = lambda n: Image.open(f"{O}/two-seats-{n}.png").convert("RGB")
r6 = lambda n: Image.open(f"{R6}/two-seats-{n}.png").convert("RGB")

w, h = 1000, 1400
S = Image.new("RGB", (3 * w + 4 * 40, h + 160), BG); d = ImageDraw.Draw(S)
for i, (n, t, e) in enumerate(C):
    x = 40 + i * (w + 40)
    S.paste(img(n).resize((w, h), Image.LANCZOS), (x, 40))
    d.text((x, h + 56), t, fill=INK, font=f(38, True)); d.text((x, h + 104), e, fill=INK, font=f(30))
S.save(f"{O}/CHARACTERS.jpg", quality=90)

w, h = 700, 980
S = Image.new("RGB", (2 * w + 3 * 40, 3 * (h + 90) + 40), BG); d = ImageDraw.Draw(S)
for r, (n, t, e) in enumerate(C):
    y = 40 + r * (h + 90)
    for j, (im, lab) in enumerate(((r6(n), "round 6"), (img(n), "round 7"))):
        x = 40 + j * (w + 40)
        S.paste(im.resize((w, h), Image.LANCZOS), (x, y))
        d.text((x, y + h + 14), f"{t}: {lab}", fill=INK, font=f(24, True))
S.save(f"{O}/ROUND6-VS-ROUND7.jpg", quality=88)

# HANDS-ZOOM: the hands, the fan and the chest, x 420-1080, y 540-944 at 2x; round 6 left, round 7 right
box = (420, 540, 1080, 944); k = 2
bw, bh = (box[2] - box[0]) * k, (box[3] - box[1]) * k
S = Image.new("RGB", (2 * bw + 3 * 30, 3 * (bh + 60) + 30), BG); d = ImageDraw.Draw(S)
for r, (n, t, e) in enumerate(C):
    y = 30 + r * (bh + 60)
    for j, (im, lab) in enumerate(((r6(n), "round 6"), (img(n), "round 7"))):
        x = 30 + j * (bw + 30)
        S.paste(im.crop(box).resize((bw, bh), Image.LANCZOS), (x, y))
        d.text((x, y + bh + 12), f"{t}: {lab} (2x)", fill=INK, font=f(26, True))
S.save(f"{O}/HANDS-ZOOM.jpg", quality=90)

w, h = 744, 1039; mm = w / 63.5
S = Image.new("RGB", (3 * w + 4 * 30, h + 150), BG); d = ImageDraw.Draw(S)
for i, (n, t, e) in enumerate(C):
    x = 30 + i * (w + 30)
    S.paste(img(n).resize((w, h), Image.LANCZOS), (x, 30)); d.text((x, h + 44), t, fill=INK, font=f(24, True))
bx, by = 30, h + 100
d.rectangle([bx, by, bx + round(10 * mm), by + 10], fill=INK)
d.text((bx + round(10 * mm) + 14, by - 8), "10 mm (the card is 63.5 x 88.9 mm; at 297.6 px per inch this sheet is print size)", fill=INK, font=f(20))
S.save(f"{O}/SLEEVE-SIZE.jpg", quality=92, dpi=(297.6, 297.6))

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
