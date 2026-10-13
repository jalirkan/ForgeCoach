#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 4: the first drafts with their faces and hands repainted, nothing else.
#   build.sh crops   the 3.2x crops (patch.py) and the sharpened inits (prep.py)        -- CPU
#   build.sh paint   specs/r4a.json then specs/r4b.json under the GPU lock (gpu.sh)     -- GPU, ~27 min on the GTX 1080
#   build.sh final   fix.py + finish.py for the picks in picks.json, then sheets.py     -- CPU
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); OUT=$(dirname "$HERE")
D=$(cd "$OUT/../../direction" && pwd)
W=/home/justin-a/scenery-packs/two-seats-work/round4
P=/home/justin-a/scenery-packs/.venv-gen/bin/python
mkdir -p "$W"/{crops,raw,fixed,masks}
box() { $P -c "import json;print(*json.load(open('$HERE/regions.json'))['$1']['$2']['box'])"; }
case ${1:-final} in
  crops)
    for n in 1 2 3; do for r in face hands; do $P "$HERE/patch.py" crop "$D/two-seats-$n.png" $(box $n $r) 3.2 "$W/crops/$n-$r.png"; done; done
    for n in 1 2 3; do $P "$HERE/prep.py" "$W/crops/$n-hands.png" "$W/crops/$n-hands-sh.png"; done
    $P "$HERE/prep.py" "$W/crops/1-face.png" "$W/crops/1-face-sh.png"
    $P "$HERE/prep.py" "$W/crops/3-face.png" "$W/crops/3-face-sh.png" --blot 428 434 40 24 ;;
  paint)
    "$HERE/gpu.sh" "$HERE/specs/r4a.json"; "$HERE/gpu.sh" "$HERE/specs/r4b.json" ;;
  final)
    for n in 1 2 3; do
      read -r f h < <($P -c "import json;p=json.load(open('$HERE/picks.json'))['$n'];print(p['face'],p['hands'])")
      $P "$HERE/fix.py" "$D/two-seats-$n.png" $n "$W/raw/$f.png" "$W/raw/$h.png" "$W/fixed/two-seats-$n-fixed-full.png" --mask-dir "$W/masks"
      $P "$HERE/finish.py" "$W/fixed/two-seats-$n-fixed-full.png" "$D/two-seats-$n.png" "$OUT/two-seats-$n-fixed"
    done
    $P "$HERE/sheets.py" final "$D" "$OUT" "$W" ;;
esac
