# SPDX-License-Identifier: GPL-3.0-or-later
import json, sys
NEG_BASE = ("text, letters, words, writing, typography, title, caption, signature, artist signature, watermark, logo, "
            "numbers, monogram, initials, calligraphy, script, inscription, label, stamp mark, "
            "blurry, lowres, jpeg artifacts, neon, oversaturated, 3d render, plastic, cgi")
P = {
 "binder": ("17th century a l'eventail bookbinding cover, {c} morocco leather, fine pebbled grain, "
            "hand tooled gold leaf, gilt fan-shaped corner pieces, central gilt fan rosette, semé of small gilt stars, "
            "gilt roll border, worn gilding, museum archive photograph, flat lay, even diffuse light, highly detailed",
            NEG_BASE + ", clock, dial, numerals, brown leather, oval, book edges, pages, spine, hands, table, room, perspective, shadow of book"),
 "blocks": ("antique marquetry panel, tumbling blocks pattern of inlaid wood veneers, {c}, "
            "rich figured wood grain in every lozenge, a gilt brass inlay hexagon of cubes in the centre, "
            "thin brass stringing border, french polished, museum furniture detail photograph, flat lay, even diffuse light, highly detailed",
            NEG_BASE + ", warped geometry, curved lines, perspective, room, furniture legs, shadow"),
 "seat":   ("early renaissance egg tempera panel, half-length portrait of a hooded card player facing the viewer, "
            "gentle face, kind eyes, holding a fan of plain cards, {c}, "
            "punched gold leaf ground, glowing glass lamp on a wooden table edge, fine brushwork, crackled varnish",
            NEG_BASE + ", card faces, symbols on cards, pips, tarot title, banner, scroll, deformed hands, extra fingers, "
                       "distorted face, cross-eyed, halo text, modern, photo, 3d"),
}
C = {
 "binder2-green": "deep bottle green", "binder2-blue": "deep midnight blue", "binder2-garnet": "deep garnet red",
 "blocks2-holly": "ebony, smoky green-grey sycamore and pale holly",
 "blocks2-indigo": "ebony, indigo dyed sycamore and pale holly",
 "blocks2-garnet": "ebony, red dyed pearwood and pale holly",
 "seat2-teal": "teal hooded cloak with crimson lining",
 "seat2-garnet": "garnet red hooded cloak with teal lining",
 "seat2-indigo": "indigo hooded cloak with ochre lining",
 "binder-green": "deep bottle green", "binder-blue": "deep midnight blue", "binder-garnet": "deep garnet red",
 "blocks-holly": "ebony, smoky green-grey sycamore and pale holly",
 "blocks-indigo": "ebony, indigo dyed sycamore and pale holly",
 "blocks-warm": "ebony, walnut and pale holly",
 "seat-teal": "teal hooded cloak with crimson lining",
 "seat-garnet": "garnet red hooded cloak with teal lining",
 "seat-indigo": "indigo hooded cloak with ochre lining",
}
S = {"binder": 0.62, "blocks": 0.46, "seat": 0.80}
round_ = sys.argv[1]; seeds = [int(x) for x in sys.argv[2].split(",")]; names = sys.argv[3].split(",")
strength_over = float(sys.argv[4]) if len(sys.argv) > 4 else None
jobs = []
for n in names:
    kind = n.split("-")[0].rstrip("0123456789")
    p, neg = P[kind]
    for sd in seeds:
        jobs.append(dict(name=f"{n}-s{sd}", guide=f"guides/{n}.png", prompt=p.format(c=C[n]), negative=neg,
                         seed=sd, strength=strength_over or S[kind]))
json.dump(dict(model="dreamshaper", out=f"raw/{round_}", steps=32, cfg=6.0, jobs=jobs), open(f"raw/spec-{round_}.json", "w"), indent=1)
print(len(jobs), "jobs")
