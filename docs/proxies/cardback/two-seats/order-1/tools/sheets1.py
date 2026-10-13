# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, order 1: CHECK.jpg and SLEEVE-SIZE.jpg.   sheets1.py <order-1 dir>
#   CHECK.jpg        this file at full size beside the previous final's figure (the grounds mock A: the final's own
#                    pixels on the same ground), then the hem and the hands at 2x, this file beside the previous one
#   SLEEVE-SIZE.jpg  true print size (744 x 1039 = 63.5 x 88.9 mm at 297.6 px per inch) with a 10 mm bar
import sys, os
from PIL import Image, ImageDraw, ImageFont
OD = sys.argv[1]
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"; BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
f = lambda s, b=False: ImageFont.truetype(BOLD if b else FONT, s)
BG = (236, 232, 224); INK = (30, 30, 30)
new = Image.open(f"{OD}/two-seats-garnet-man.png").convert("RGB")
old = Image.open("/home/justin-a/code/fc-lanes/two-seats-order1/docs/proxies/cardback/two-seats/grounds/A-garnet.png").convert("RGB")
pad, lab = 40, 60
HEM = (440, 500, 840, 720); HANDS = (560, 640, 860, 920)
z = lambda im, b: im.crop(b).resize(((b[2] - b[0]) * 2, (b[3] - b[1]) * 2), Image.NEAREST)
hw, hh = (HEM[2] - HEM[0]) * 2, (HEM[3] - HEM[1]) * 2
aw, ah = (HANDS[2] - HANDS[0]) * 2, (HANDS[3] - HANDS[1]) * 2
W = 2 * 1500 + 3 * pad
H = pad + lab + 2100 + pad + lab + hh + pad + lab + ah + pad
S = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(S)
y = pad
d.text((pad, y), "Order 1: the torso painted once (no blur, no grain)", fill=INK, font=f(36, True))
d.text((2 * pad + 1500, y), "Before: the previous final's torso (grounds mock A)", fill=INK, font=f(36, True))
y += lab; S.paste(new, (pad, y)); S.paste(old, (2 * pad + 1500, y)); y += 2100 + pad
d.text((pad, y), "The hem at 2x (x 440-840, y 500-720): order 1, then before", fill=INK, font=f(32, True)); y += lab
S.paste(z(new, HEM), (pad, y)); S.paste(z(old, HEM), (2 * pad + hw, y)); y += hh + pad
d.text((pad, y), "The hands and cards at 2x (x 560-860, y 640-920): order 1, then before", fill=INK, font=f(32, True)); y += lab
S.paste(z(new, HANDS), (pad, y)); S.paste(z(old, HANDS), (2 * pad + aw, y))
S.save(f"{OD}/CHECK.jpg", quality=88)
w, h = 744, 1039; mm = w / 63.5; pad = 40
S = Image.new("RGB", (2 * w + 3 * pad, h + 170), BG); d = ImageDraw.Draw(S)
S.paste(new.resize((w, h), Image.LANCZOS), (pad, pad)); S.paste(old.resize((w, h), Image.LANCZOS), (2 * pad + w, pad))
d.text((pad, pad + h + 10), "Order 1 (this file)", fill=INK, font=f(24, True))
d.text((2 * pad + w, pad + h + 10), "Before (grounds mock A)", fill=INK, font=f(24, True))
by = pad + h + 70
d.rectangle([pad, by, pad + round(10 * mm), by + 10], fill=INK)
d.text((pad + round(10 * mm) + 14, by - 8), "10 mm (the card is 63.5 x 88.9 mm; at 297.6 px per inch this sheet is print size)", fill=INK, font=f(20))
S.save(f"{OD}/SLEEVE-SIZE.jpg", quality=92, dpi=(297.6, 297.6))
print("sheets ok", os.path.getsize(f"{OD}/CHECK.jpg"), os.path.getsize(f"{OD}/SLEEVE-SIZE.jpg"))
