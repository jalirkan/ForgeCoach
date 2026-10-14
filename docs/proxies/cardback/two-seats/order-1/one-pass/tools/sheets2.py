# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, order 1, one pass: the owner's sheets.   (run in two-seats-work/order1/onepass)
#   sheets2.py candidates <likeness.json> <verdicts.json> <outdir> <card.png>...
#       CANDIDATES.jpg: the guide, order 1 as it is, and every seed, each at the figure's print size (1:1, the
#       800 x 800 px around him), with its face and its hands at 1.5x beneath, and its strength, seed and likeness
#   sheets2.py top3 <outdir> <card.png> <card.png> <card.png>
#       CHARACTERS-TOP3.jpg: the three as full cards, then each one's face, hands and cards, and the tankard at 200%
#       SLEEVE-SIZE-TOP3.jpg: the three and order 1 as it is at print size (63.5 x 88.9 mm at 297.6 px per inch)
import sys, os, json
from PIL import Image, ImageDraw, ImageFont
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"; BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
f = lambda s, b=False: ImageFont.truetype(BOLD if b else FONT, s)
BG = (236, 232, 224); INK = (30, 30, 30)
ORDER1 = "/home/justin-a/code/fc-lanes/two-seats-order1/docs/proxies/cardback/two-seats/order-1/two-seats-garnet-man.png"
CROP = (350, 180, 1150, 980); FACE = (640, 265, 860, 545); HANDS = (590, 640, 910, 900); PROP = (440, 860, 600, 1000)
def name(p): return os.path.basename(p).replace(".png", "")
def label(n):
    n = n.replace("two-seats-garnet-man-", "")
    if n.startswith("ds-") or n.startswith("base-"):
        m, s, seed = n.split("-")
        return f"{'DreamShaper XL' if m == 'ds' else 'SDXL base'}  {int(s) / 100:.2f}  seed {seed[1:]}"
    return n
def z(im, b, k): return im.crop(b).resize((round((b[2] - b[0]) * k), round((b[3] - b[1]) * k)), Image.LANCZOS)

mode = sys.argv[1]
if mode == "candidates":
    lk, vd, od = json.load(open(sys.argv[2])), json.load(open(sys.argv[3])), sys.argv[4]
    cards = [("work/guide.png", "The guide (before the pass)"), (ORDER1, "Order 1 as it is (the collage)")]
    cards += [(p, label(name(p))) for p in sys.argv[5:]]
    pad, cw, lab = 30, 800, 96
    ch = lab + 800 + 10 + 420
    cols = 4; rows = (len(cards) + cols - 1) // cols
    S = Image.new("RGB", (pad + cols * (cw + pad), pad + rows * (ch + pad) + 60), BG); d = ImageDraw.Draw(S)
    d.text((pad, 14), "One pass over the whole figure: every seed at print size (1:1), face and hands at 1.5x.  SSIM vs the draft's face: whole face / half size / eyes.",
           fill=INK, font=f(26, True))
    for i, (p, t) in enumerate(cards):
        im = Image.open(p).convert("RGB")
        x, y = pad + (i % cols) * (cw + pad), 60 + pad + (i // cols) * (ch + pad)
        d.text((x, y), t, fill=INK, font=f(28, True))
        k = lk.get(p) or lk.get(os.path.abspath(p)) or {}
        sub = f"SSIM {k.get('ssim', '-')} / {k.get('ssim_2x', '-')} / eyes {k.get('ssim_eyes', '-')}" if k else ""
        v = vd.get(name(p), "")
        d.text((x, y + 36), sub, fill=INK, font=f(22)); d.text((x, y + 64), v, fill=(120, 30, 30), font=f(22, True))
        S.paste(im.crop(CROP), (x, y + lab))
        S.paste(z(im, FACE, 1.5), (x, y + lab + 810)); S.paste(z(im, HANDS, 1.3), (x + 340, y + lab + 810))
    S.save(f"{od}/CANDIDATES.jpg", quality=88)
    print("CANDIDATES.jpg", S.size, os.path.getsize(f"{od}/CANDIDATES.jpg"))
elif mode == "top3":
    od, cards = sys.argv[2], sys.argv[3:6]
    ims = [Image.open(p).convert("RGB") for p in cards]
    pad, lab = 40, 60
    zh = (FACE[3] - FACE[1]) * 2 + pad + (PROP[3] - PROP[1]) * 2
    W = 3 * 1500 + 4 * pad
    H = pad + lab + 2100 + pad + lab + zh + pad
    S = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(S)
    for i, (p, im) in enumerate(zip(cards, ims)):
        x = pad + i * (1500 + pad)
        d.text((x, pad), f"{i + 1}. {label(name(p))}", fill=INK, font=f(40, True))
        S.paste(im, (x, pad + lab))
        y = pad + lab + 2100 + pad
        d.text((x, y), "at 200%: the face, the hands and cards; the tankard", fill=INK, font=f(30, True))
        y += lab
        fz, hz, pz = z(im, FACE, 2), z(im, HANDS, 2), z(im, PROP, 2)
        S.paste(fz, (x, y)); S.paste(hz, (x + fz.size[0] + 20, y)); S.paste(pz, (x, y + fz.size[1] + pad))
    S.save(f"{od}/CHARACTERS-TOP3.jpg", quality=88)
    w, h = 744, 1039; mm = w / 63.5; pad = 40
    S = Image.new("RGB", (4 * w + 5 * pad, h + 170), BG); d = ImageDraw.Draw(S)
    for i, (t, im) in enumerate([(f"{i + 1}. {label(name(p))}", im) for i, (p, im) in enumerate(zip(cards, ims))]
                                + [("Order 1 as it is", Image.open(ORDER1).convert("RGB"))]):
        S.paste(im.resize((w, h), Image.LANCZOS), (pad + i * (w + pad), pad))
        d.text((pad + i * (w + pad), pad + h + 10), t, fill=INK, font=f(22, True))
    by = pad + h + 70
    d.rectangle([pad, by, pad + round(10 * mm), by + 10], fill=INK)
    d.text((pad + round(10 * mm) + 14, by - 8), "10 mm (the card is 63.5 x 88.9 mm; at 297.6 px per inch this sheet is print size)", fill=INK, font=f(20))
    S.save(f"{od}/SLEEVE-SIZE-TOP3.jpg", quality=92, dpi=(297.6, 297.6))
    print("top3 sheets ok")
