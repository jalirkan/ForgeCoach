# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, final: the review sheets.   sheets.py <final-dir> <round9-dir>
#   CHARACTERS.jpg (the three side by side), FIXES-ZOOM.jpg (each fix, round 9 beside final, at 2x),
#   SLEEVE-SIZE.jpg (744 x 1039 each = print size at 297.6 px per inch, with a 10 mm bar),
#   CUT-SAFE.jpg (the 110 px keep-inside margin in blue, a 3 mm edge line in red)
import sys
from PIL import Image, ImageDraw, ImageFont
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"; BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
O, R9 = sys.argv[1:3]; BG = (236, 232, 224); INK = (30, 30, 30)
C = [("green-woman", "The green woman", "calm, composed"),
     ("garnet-man", "The garnet man", "anxious, worried"),
     ("blue-man", "The blue man", "guarded, intent")]
f = lambda s, b=False: ImageFont.truetype(BOLD if b else FONT, s)
fin = lambda n: Image.open(f"{O}/two-seats-{n}.png").convert("RGB")
r9 = lambda n: Image.open(f"{R9}/two-seats-{n}-props.png").convert("RGB")

w, h = 1000, 1400
S = Image.new("RGB", (3 * w + 4 * 40, h + 160), BG); d = ImageDraw.Draw(S)
for i, (n, t, e) in enumerate(C):
    x = 40 + i * (w + 40)
    S.paste(fin(n).resize((w, h), Image.LANCZOS), (x, 40))
    d.text((x, h + 56), t, fill=INK, font=f(38, True)); d.text((x, h + 104), e, fill=INK, font=f(30))
S.save(f"{O}/CHARACTERS.jpg", quality=90)

FIX = [  # (title, [(sitter, box)])
    ("1. The hem: where the hood's shoulder-cape meets the painted cloak",
     [("green-woman", (460, 525, 1060, 655)), ("garnet-man", (430, 525, 1080, 655)), ("blue-man", (460, 525, 1060, 655))]),
    ("2. The garnet man's tankard: cold and forgotten (a dull skin, no steam, a ring on the wood)",
     [("garnet-man", (420, 895, 620, 1045))]),
    ("3. The green woman's cup (the haze above the rim) and the blue man's knocked-over cup (the outline on its side)",
     [("green-woman", (920, 925, 1060, 1025)), ("blue-man", (410, 950, 530, 1020))]),
    ("4. The green woman's cloak: the drawn fold lines softened into painted folds",
     [("green-woman", (445, 640, 1065, 945))]),
    ("5. The last drawn outlines below the hem: the garnet man's sleeves and skirt, the blue man's forearms",
     [("garnet-man", (420, 740, 1090, 945)), ("blue-man", (450, 740, 1060, 945))]),
]
k = 2; pad = 30; secs = []
for title, items in FIX:
    blocks = []
    for n, b in items:
        bw, bh = (b[2] - b[0]) * k, (b[3] - b[1]) * k
        B = Image.new("RGB", (2 * bw + pad, bh + 40), BG); dd = ImageDraw.Draw(B)
        for j, (im, lab) in enumerate(((r9(n), "round 9"), (fin(n), "final"))):
            B.paste(im.crop(b).resize((bw, bh), Image.LANCZOS), (j * (bw + pad), 0))
            who = dict((c[0], c[1]) for c in C)[n]
            dd.text((j * (bw + pad), bh + 8), f"{who}: {lab} (2x)" if bw >= 420 else f"{who.split()[1]}: {lab}", fill=INK, font=f(20 if bw >= 420 else 17, True))
        blocks.append(B)
    if sum(b.width for b in blocks) + pad * (len(blocks) - 1) <= 2700 and len(blocks) > 1 and blocks[0].height < 500:
        W = sum(b.width for b in blocks) + pad * (len(blocks) - 1); H = max(b.height for b in blocks)
        row = Image.new("RGB", (W, H), BG); x = 0
        for b in blocks:
            row.paste(b, (x, 0)); x += b.width + pad
        blocks = [row]
    secs.append((title, blocks))
W = max(b.width for _, bl in secs for b in bl) + 2 * pad
H = sum(60 + sum(b.height + 20 for b in bl) for _, bl in secs) + pad
S = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(S); y = pad
for title, bl in secs:
    d.text((pad, y), title, fill=INK, font=f(28, True)); y += 50
    for b in bl:
        S.paste(b, (pad, y)); y += b.height + 20
    y += 10
S.save(f"{O}/FIXES-ZOOM.jpg", quality=90)

w, h = 744, 1039; mm = w / 63.5
S = Image.new("RGB", (3 * w + 4 * 30, h + 70 + 80), BG); d = ImageDraw.Draw(S)
for i, (n, t, e) in enumerate(C):
    x, y = 30 + i * (w + 30), 30
    S.paste(fin(n).resize((w, h), Image.LANCZOS), (x, y))
    d.text((x, y + h + 14), t, fill=INK, font=f(24, True))
bx, by = 30, h + 70 + 40
d.rectangle([bx, by, bx + round(10 * mm), by + 10], fill=INK)
d.text((bx + round(10 * mm) + 14, by - 8), "10 mm (the card is 63.5 x 88.9 mm; at 297.6 px per inch this sheet is print size)", fill=INK, font=f(20))
S.save(f"{O}/SLEEVE-SIZE.jpg", quality=92, dpi=(297.6, 297.6))

w, h = 750, 1050; s = w / 1500
S = Image.new("RGB", (3 * w + 4 * 30, h + 70 + 60), BG); d = ImageDraw.Draw(S)
for i, (n, t, e) in enumerate(C):
    x, y = 30 + i * (w + 30), 30
    im = fin(n).resize((w, h), Image.LANCZOS); dd = ImageDraw.Draw(im)
    for m, col in ((110, (40, 90, 220)), (71, (220, 40, 40))):
        dd.rectangle([m * s, m * s, w - 1 - m * s, h - 1 - m * s], outline=col, width=2)
    dd.line([0, h / 2, w, h / 2], fill=(40, 160, 90), width=1)
    S.paste(im, (x, y)); d.text((x, y + h + 14), t, fill=INK, font=f(24, True))
d.text((30, h + 100), "blue: the 110 px keep-inside margin   red: 3 mm from the edge   green: the centre line (the lamp sits on it)", fill=INK, font=f(20))
S.save(f"{O}/CUT-SAFE.jpg", quality=88)
print("sheets in", O)
