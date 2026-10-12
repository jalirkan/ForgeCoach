#!/bin/bash
# The Two Seats, round 2: from a character's unified half to its two finals (punched gold, streaky gold).
#   build.sh <green|garnet|blue>      (run from round2/, after the GPU rounds; see NOTES.md)
set -e
c=$1; P=${PY:-/home/justin-a/scenery-packs/.venv-gen/bin/python}
D=/home/justin-a/code/fc-lanes/proxyback/docs/proxies/cardback/direction
$P tools/finish.py merge comp/$c-keep.png comp/$c-tile-Lu.png comp/$c-tile-Ru.png comp/$c-u.png >/dev/null
$P tools/figmerge.py ../comp/c1-24-ut.png comp/$c-u.png guides/mask-fig8.png comp/$c-ut.png >/dev/null
$P tools/figmerge.py comp/$c-ut.png comp/$c-lit0.png guides/mask-strip.png comp/$c-ut2.png --feather 20 >/dev/null
$P tools/figmerge.py comp/$c-keep.png comp/$c-lit0.png guides/mask-strip.png comp/$c-keep2.png --feather 20 >/dev/null
if [ $c != garnet ]; then $P tools/edgefix.py comp/$c-ut2.png $c comp/$c-ut2.png >/dev/null; fi
$P tools/moulding.py comp/$c-ut2.png comp/$c-fin.png >/dev/null
$P tools/moulding.py comp/$c-keep2.png comp/$c-keepm.png >/dev/null
$P tools/compose.py .. comp/$c-fin.png out/$c-punched.png --gold 0 --keep comp/$c-keepm.png --jpeg
$P tools/figmask.py comp/$c-fin.png comp/$c-figmask.png >/dev/null
$P tools/streaky.py comp/$c-fin.png $D/two-seats-3.png comp/$c-figmask.png comp/$c-streaky.png >/dev/null
$P tools/compose.py .. comp/$c-streaky.png out/$c-streaky.png --gold 0 --keep comp/$c-keepm.png --jpeg
