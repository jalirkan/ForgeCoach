# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 3: from the chosen composition seeds to the repair spec, and back.
#   refine.py prep  picks.json   -> the face and hand crops of each half (picks' "src", 1500x1050, cards laid in),
#                                   and specs/r3.json (face at ~3.3x, the hand of cards at ~2x)
#   refine.py merge picks.json   -> <W>/half/<c>-fixed.png (each repaint pasted back, feathered)
# picks.json: {"green": {"src": "<W>/half/green-cards.png", "face": [x0,y0,x1,y1], "hands": [x0,y0,x1,y1],
#              "face_seeds": [..], "hand_seeds": [..]}, ...}  (boxes in the 1500x1050 half)
import json, os, subprocess, sys
from PIL import Image
W = "/home/justin-a/scenery-packs/two-seats-work/round3"
HERE = os.path.dirname(os.path.abspath(__file__)); PY = sys.executable
op, picks = sys.argv[1], json.load(open(sys.argv[2]))
FACE = {"green": "close-up of a calm young woman's face, auburn hair, a faint pleased knowing smile, eyes soft, "
                 "the face of someone winning at cards, lit warmly from below by lamplight, Hans Memling oil painting, fine glazes",
        "garnet": "close-up of a careworn old man's face, grey hair, lined forehead, brows knit and raised at the inner ends, "
                  "worried anxious mouth, looking across the table, lit warmly from below by lamplight, Hans Memling oil painting",
        "blue": "close-up of a wary young man's face, dark hair with a fringe, narrowed eyes glancing sideways, guarded, intent, "
                "unreadable, lit warmly from below by lamplight, Hans Memling oil painting, fine glazes"}
HANDS = ("two hands holding a fanned hand of playing cards, the plain dark backs of the cards toward the viewer, "
         "each card back plain dark with a thin gold edge, natural fingers, lit warmly from below by an oil lamp, Hans Memling oil painting")
NEG = "text, letters, numbers, pips, card faces, symbols, pattern on cards, extra fingers, fused fingers, deformed, cartoon, photo, neon, blurry"
os.makedirs(f"{W}/half", exist_ok=True); os.makedirs(f"{W}/crops", exist_ok=True)
if op == "prep":
    jobs = []
    for c, p in picks.items():
        for part, sc, st, prm, seeds in (("face", 3.3, p.get("face_strength", 0.42), FACE[c], p.get("face_seeds", [501])),
                                         ("hands", 2.0, p.get("hand_strength", 0.48), HANDS, p.get("hand_seeds", [601]))):
            x0, y0, x1, y1 = p[part]
            s = min(sc, 1100 / max(x1 - x0, y1 - y0))
            subprocess.run([PY, f"{HERE}/patch.py", "crop", p["src"], str(x0), str(y0), str(x1), str(y1), str(s),
                            f"{W}/crops/{c}-{part}.png"], check=True)
            jobs.append(dict(name=f"{c}-{part}", src=f"{W}/crops/{c}-{part}.png", strength=st, seeds=seeds, prompt=prm, negative=NEG))
    json.dump(dict(model="dreamshaper", out=f"{W}/repaint", steps=26, cfg=5.5, jobs=jobs), open(f"{HERE}/specs/r3.json", "w"), indent=1)
    print(len(jobs), "jobs")
else:
    for c, p in picks.items():
        cur = p["src"]
        for part in ("hands", "face"):
            seed = p[f"{part}_pick"]
            t = f"{W}/repaint/{c}-{part}-s{seed}.png"
            x0, y0, x1, y1 = p[part]
            out = f"{W}/half/{c}-fixed.png"
            subprocess.run([PY, f"{HERE}/patch.py", "paste", cur, str(x0), str(y0), str(x1), str(y1), t, out,
                            "22" if part == "hands" else "26", "ellipse" if part == "face" else "rect"], check=True)
            cur = out
        print(c, "->", cur)
