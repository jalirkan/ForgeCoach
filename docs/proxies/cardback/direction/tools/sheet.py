# SPDX-License-Identifier: GPL-3.0-or-later
# Contact sheets: the bare backs (labels under each, nothing drawn on the art) and a guides sheet
# with the 75 px cut line and the 135 px safe line drawn on copies. Usage: sheet.py <dir> <names,...>
import sys
from PIL import Image, ImageDraw, ImageFont

d, names = sys.argv[1], sys.argv[2].split(",")
TW, TH = 544, 740           # one third of 1632x2220
PAD, LAB = 28, 46
cols = 3; rows = (len(names) + cols - 1) // cols
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 22)
except OSError:
    font = ImageFont.load_default()

def sheet(lines, out):
    S = Image.new("RGB", (cols * TW + (cols + 1) * PAD, rows * (TH + LAB) + (rows + 1) * PAD), (236, 233, 226))
    dr = ImageDraw.Draw(S)
    for i, n in enumerate(names):
        im = Image.open(f"{d}/{n}.png").convert("RGB")
        if lines:
            im = im.copy(); g = ImageDraw.Draw(im)
            g.rectangle([75, 75, 1632 - 76, 2220 - 76], outline=(255, 64, 64), width=5)      # cut
            g.rectangle([135, 135, 1632 - 136, 2220 - 136], outline=(64, 200, 255), width=5)  # safe
        t = im.resize((TW, TH), Image.LANCZOS)
        x = PAD + (i % cols) * (TW + PAD); y = PAD + (i // cols) * (TH + LAB + PAD)
        S.paste(t, (x, y))
        dr.text((x, y + TH + 10), n, fill=(40, 40, 40), font=font)
    if lines:
        dr.text((PAD, S.height - PAD + 2), "", fill=(0, 0, 0))
    S.save(out, quality=90)

sheet(False, f"{d}/CONTACT-SHEET.jpg")
sheet(True, f"{d}/CONTACT-SHEET-cut-safe.jpg")
print("sheets written")
