# SPDX-License-Identifier: GPL-3.0-or-later
# skinmeasure.py <top.png> [maskview.png]: the face's and the hands' skin statistics (skinlib.masks), as JSON.
import sys, json
import numpy as np
from PIL import Image
from skinlib import masks, stats
top = np.asarray(Image.open(sys.argv[1]).convert("RGB"))
f, hd, _ = masks(top)
print(json.dumps({"face": stats(top, f), "hands": stats(top, hd)}, indent=1))
if len(sys.argv) > 2:
    v = top.copy(); v[f] = (0, 255, 0); v[hd] = (0, 160, 255)
    Image.fromarray(v).crop((600, 300, 900, 940)).resize((600, 1280), Image.NEAREST).save(sys.argv[2])
