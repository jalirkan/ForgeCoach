#!/bin/bash
# The Two Seats, order 1: one painted torso -> the card on Ground A -> the print files.
#   build1.sh <painted torso.png> <outdir>      (run in /home/justin-a/scenery-packs/two-seats-work/order1)
set -e
T=$(dirname "$(readlink -f "$0")"); PY=/home/justin-a/scenery-packs/.venv/bin/python
DR=$T/../../../direction/two-seats-2.png
$PY $T/torso1.py "$1" work/card.png
$PY $T/lift.py garnet work/card.png work | tee work/log-lift.txt
$PY $T/grounds.py garnet work "$DR" work > work/log-grounds.txt
$PY $T/lift1.py work/A-garnet.png "$2"
