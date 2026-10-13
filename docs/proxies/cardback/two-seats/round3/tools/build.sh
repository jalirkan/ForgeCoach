#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# The Two Seats, round 3: the unified half -> the final, for one character.
#   build.sh <green|garnet|blue>
# 1. the unifying pass (0.22, unify/unify-<c>-s701.png) back to 1500x1050;
# 2. the face and the hand of cards taken back from the pre-unify half (the pass softens them), feathered;
# 3. (blue only) deflame.py takes the tall painted flame off the seam;
# 4. compose3.py: the lamp on the seam, the seam, the border, chroma cap, dark floor, exact symmetry.
set -euo pipefail
c=$1
W=/home/justin-a/scenery-packs/two-seats-work/round3
HERE=$(cd "$(dirname "$0")" && pwd); OUT=$(dirname "$HERE")
P=/home/justin-a/scenery-packs/.venv-gen/bin/python
case $c in
  green)  name=green-woman; border=24,46,32; lampx=750; core=0; soften=0 ;;
  garnet) name=garnet-man;  border=58,20,22; lampx=725; core=60; soften=120 ;;
  blue)   name=blue-man;    border=20,26,52; lampx=750; core=62; soften=110 ;;
esac
read -r fx0 fy0 fx1 fy1 hx0 hy0 hx1 hy1 < <($P -c "import json;p=json.load(open('$HERE/picks.json'))['$c'];print(*p['face'],*p['hands'])")
$P -c "from PIL import Image; Image.open('$W/unify/unify-$c-s701.png').convert('RGB').resize((1500,1050), Image.LANCZOS).save('$W/half/$c-u.png')"
$P -c "from PIL import Image; im=Image.open('$W/half/$c-clean.png'); im.crop(($fx0,$fy0,$fx1,$fy1)).save('$W/half/$c-kf.png'); im.crop(($hx0,$hy0,$hx1,$hy1)).save('$W/half/$c-kh.png')"
$P "$HERE/patch.py" paste "$W/half/$c-u.png" $hx0 $hy0 $hx1 $hy1 "$W/half/$c-kh.png" "$W/half/$c-final-half.png" 30 rect
$P "$HERE/patch.py" paste "$W/half/$c-final-half.png" $fx0 $fy0 $fx1 $fy1 "$W/half/$c-kf.png" "$W/half/$c-final-half.png" 34 ellipse
if [ "$c" = blue ]; then $P "$HERE/deflame.py" "$W/half/$c-final-half.png" "$W/half/$c-final-half.png" 640 880 876; fi
$P "$HERE/compose3.py" "$W/half/$c-final-half.png" "$OUT/two-seats-$name.png" --border $border --lamp-x $lampx --core $core --soften $soften --jpeg
