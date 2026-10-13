# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 9: cut the img2img guides from round 8 and write the paint specs.
#   prep9.py   (run in two-seats-work/round9)
# Guides: the torso box (x 384-1128, y 480-960) of the no-props round-8 render (round 7's drawing + round 8's
# grain, no props) at 1216x784; the two prop boxes (x 360-600 and 900-1140, y 880-1040) of round 8's final at
# 960x640 (4x). Specs: spec-torso-ds.json (DreamShaper XL), spec-torso-base.json (SDXL base).
import json
from PIL import Image
TAGS = {"green": "green-woman", "garnet": "garnet-man", "blue": "blue-man"}
TORSO = (384, 480, 1128, 960); TSZ = (1216, 784)
PROPB = {"L": (360, 880, 600, 1040), "R": (900, 880, 1140, 1040)}; PSZ = (960, 640)
WHO = {"green": "seated woman in a dark green woollen cloak",
       "garnet": "seated anxious older man in a garnet red woollen cloak",
       "blue": "seated guarded man in a dark blue woollen cloak"}
ITEMS = {"green": {"L": "two small neat stacks of gold coins", "R": "a small cream glazed cup full of dark wine on its saucer"},
         "garnet": {"L": "a pewter tankard, its cold drink with a pale skin on it", "R": "a crumpled white linen napkin and one gold coin lying flat"},
         "blue": {"L": "a small cream earthenware cup knocked over on its side, a little spill of wine from its mouth",
                  "R": "a half-eaten bun on a small pewter plate, two crumbs"}}
STYLE = ("15th-century Netherlandish panel painting, oil on panel, soft modelling, muted palette, matte, "
         "visible brushwork and craquelure")
NEG = ("vector, flat illustration, clip art, cartoon, comic, line art, outline, cel shading, photograph, photo, "
       "3D render, glossy, plastic, text, letters, numbers, pips, symbols, card faces, extra fingers, fused fingers, "
       "deformed hands, neon, blurry")
def torso_prompt(t):
    return (f"{STYLE}, a {WHO[t]}, the cloak's sleeves and chest with deep soft folds, two hands holding a small fan "
            f"of plain dark cards with gilt edges together at the centre of the chest, period portrait, tooled gold "
            f"ground, no photo, no modern illustration")
def prop_prop(t, s):
    return (f"{STYLE}, still-life detail on the edge of a dark walnut table: {ITEMS[t][s]}, small, with soft painted "
            f"shadows on the wood, period, no photo, no modern illustration")
for t, n in TAGS.items():
    Image.open(f"comp/np-{t}.png").convert("RGB").crop(TORSO).resize(TSZ, Image.LANCZOS).save(f"comp/torso-in-{t}.png")
    for s, b in PROPB.items():
        Image.open(f"../round8/final/two-seats-{n}.png").convert("RGB").crop(b).resize(PSZ, Image.LANCZOS).save(f"comp/prop-in-{t}-{s}.png")
def spec(model, out, seeds, name):
    jobs = [{"name": f"torso-{t}-{int(st*100)}", "src": f"comp/torso-in-{t}.png", "strength": st, "seeds": seeds,
             "prompt": torso_prompt(t), "negative": NEG} for t in TAGS for st in (0.45, 0.55, 0.62)]
    json.dump({"model": model, "out": out, "steps": 32, "cfg": 6.0, "jobs": jobs}, open(f"specs/{name}", "w"), indent=1)
spec("dreamshaper", "raw/torso-ds", [9101, 9102], "spec-torso-ds.json")
spec("base", "raw/torso-base", [9101], "spec-torso-base.json")
json.dump({"prompts": {t: torso_prompt(t) for t in TAGS}, "props": {f"{t}-{s}": prop_prop(t, s) for t in TAGS for s in PROPB},
           "negative": NEG}, open("specs/prompts.json", "w"), indent=1)
print("ok")
