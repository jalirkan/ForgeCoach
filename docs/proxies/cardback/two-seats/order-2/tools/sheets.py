# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, order 2 (the green woman): the owner's sheets (order 1's sheets2.py and finish/tools/sheets3.py, for her).
#   sheets.py candidates <likeness.json> <verdicts.json> <outdir> <card.png>...   (run in two-seats-work/order2/onepass)
#       CANDIDATES.jpg: the guide, the previous final, and every seed at the figure's print size (1:1, the 800 x 800 px
#       around her), with her face at 1.5x and her hands and cards at 1.3x beneath, and its strength, seed, likeness, verdict
#   sheets.py check <order-2 dir> <raw pick.png> <fixes.json>                        (run in two-seats-work/order2/finish)
#       CHECK.jpg: the finished card, the raw pick and the previous final side by side; every fix at 2x, before (the raw
#       pick) and after (the finished card), nearest-neighbour; the hands beside the face at 2x
#       SLEEVE-SIZE.jpg: her print file and the garnet man's current print file at true size, with a 10 mm bar
import sys, os, json
from PIL import Image, ImageDraw, ImageFont
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"; BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
f = lambda s, b=False: ImageFont.truetype(BOLD if b else FONT, s)
BG = (236, 232, 224); INK = (30, 30, 30)
TS = "/home/justin-a/code/fc-lanes/two-seats-order1/docs/proxies/cardback/two-seats"
PREV = f"{TS}/final/two-seats-green-woman.png"            # the previous final (fc-lanes two-seats-final 479e5f6)
GARNET = f"{TS}/order-1/two-seats-garnet-man.png"
CROP = (350, 180, 1150, 980); FACE = (640, 265, 860, 545); HANDS = (590, 640, 910, 900)
def name(p): return os.path.basename(p).replace(".png", "")
def label(n):
    if n.startswith("ds-"):
        _, s, seed = n.split("-"); return f"DreamShaper XL  {int(s) / 100:.2f}  seed {seed[1:]}"
    return n
def z(im, b, k, rs=Image.LANCZOS): return im.crop(b).resize((round((b[2] - b[0]) * k), round((b[3] - b[1]) * k)), rs)
mode = sys.argv[1]
if mode == "candidates":
    lk, vd, od = json.load(open(sys.argv[2])), json.load(open(sys.argv[3])), sys.argv[4]
    cards = [("work/guide.png", "The guide (before the pass)"), (PREV, "The previous final (479e5f6)")]
    cards += [(p, label(name(p))) for p in sys.argv[5:]]
    pad, cw, lab = 30, 800, 96
    ch = lab + 800 + 10 + 420
    cols = 5; rows = (len(cards) + cols - 1) // cols
    S = Image.new("RGB", (pad + cols * (cw + pad), pad + rows * (ch + pad) + 60), BG); d = ImageDraw.Draw(S)
    d.text((pad, 14), "The green woman, one pass over the whole figure: every seed at print size (1:1), face at 1.5x, hands at 1.3x.  SSIM vs the draft's face: whole face / half size / eyes.",
           fill=INK, font=f(26, True))
    for i, (p, t) in enumerate(cards):
        im = Image.open(p).convert("RGB")
        x, y = pad + (i % cols) * (cw + pad), 60 + pad + (i // cols) * (ch + pad)
        d.text((x, y), t, fill=INK, font=f(28, True))
        k = lk.get(p) or {}
        sub = f"SSIM {k.get('ssim', '-')} / {k.get('ssim_2x', '-')} / eyes {k.get('ssim_eyes', '-')}" if k else ""
        d.text((x, y + 36), sub, fill=INK, font=f(22)); d.text((x, y + 64), vd.get(name(p), ""), fill=(120, 30, 30), font=f(20, True))
        S.paste(im.crop(CROP), (x, y + lab))
        S.paste(z(im, FACE, 1.5), (x, y + lab + 810)); S.paste(z(im, HANDS, 1.3), (x + 340, y + lab + 810))
    S.save(f"{od}/CANDIDATES.jpg", quality=88)
    print("CANDIDATES.jpg", S.size, os.path.getsize(f"{od}/CANDIDATES.jpg"))
elif mode == "check":
    od, rawp, FIX = sys.argv[2], sys.argv[3], json.load(open(sys.argv[4]))
    new = Image.open(f"{od}/two-seats-green-woman.png").convert("RGB"); raw = Image.open(rawp).convert("RGB")
    prev = Image.open(PREV).convert("RGB")
    pad, lab = 40, 56
    W = 3 * 1500 + 4 * pad
    rows = []; x = pad; row = []; rh = 0
    for t, b in FIX:
        w = max((b[2] - b[0]) * 4 + pad // 2, int(f(24, True).getlength(t + ": before | after, 2x")))
        if x + w > W and row: rows.append((row, rh)); row = []; x = pad; rh = 0
        row.append((t, b, x)); x += w + pad; rh = max(rh, (b[3] - b[1]) * 2)
    rows.append((row, rh))
    hf = (FACE[3] - FACE[1]) * 2
    H = pad + lab + 2100 + pad + sum(lab + r + pad for _, r in rows) + lab + hf + 2 * pad
    S = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(S)
    y = pad
    for i, (t, im) in enumerate((("Finished (this file)", new), (f"The pick as painted: {label(name(rawp).replace('two-seats-green-woman-', ''))}", raw), ("The previous final (479e5f6)", prev))):
        d.text((pad + i * (1500 + pad), y), t, fill=INK, font=f(36, True)); S.paste(im, (pad + i * (1500 + pad), y + lab))
    y += lab + 2100 + pad
    for row, rh in rows:
        for t, b, x in row:
            d.text((x, y), t + ": before | after, 2x", fill=INK, font=f(24, True))
            S.paste(z(raw, b, 2, Image.NEAREST), (x, y + lab)); S.paste(z(new, b, 2, Image.NEAREST), (x + (b[2] - b[0]) * 2 + pad // 2, y + lab))
        y += lab + rh + pad
    d.text((pad, y), "The hands beside the face, finished, 2x (the skin should read as one person's)", fill=INK, font=f(24, True))
    fz = z(new, FACE, 2, Image.NEAREST); S.paste(fz, (pad, y + lab))
    HB = (630, 760, 880, 920); S.paste(z(new, HB, 2, Image.NEAREST), (pad + fz.size[0] + pad, y + lab))
    S.save(f"{od}/CHECK.jpg", quality=88)
    w, h = 744, 1039; mm = w / 63.5; pad = 40
    S = Image.new("RGB", (2 * w + 3 * pad, h + 170), BG); d = ImageDraw.Draw(S)
    for i, (t, im) in enumerate((("The green woman (order 2, this file)", new), ("The garnet man (order 1's print file)", Image.open(GARNET).convert("RGB")))):
        S.paste(im.resize((w, h), Image.LANCZOS), (pad + i * (w + pad), pad))
        d.text((pad + i * (w + pad), pad + h + 10), t, fill=INK, font=f(22, True))
    by = pad + h + 70
    d.rectangle([pad, by, pad + round(10 * mm), by + 10], fill=INK)
    d.text((pad, by + 22), "10 mm. The card is 63.5 x 88.9 mm; at 297.6 px per inch this sheet is print size.", fill=INK, font=f(20))
    S.save(f"{od}/SLEEVE-SIZE.jpg", quality=92, dpi=(297.6, 297.6))
    print("sheets ok", os.path.getsize(f"{od}/CHECK.jpg"), os.path.getsize(f"{od}/SLEEVE-SIZE.jpg"))
