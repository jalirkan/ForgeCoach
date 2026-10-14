#!/bin/bash
# order 1, finish: run one-pass/tools/paint2.py on a spec, on the shared GPU lock, niced.   gpu3.sh <spec.json>
cd /home/justin-a/scenery-packs/two-seats-work/order1/finish
export HF_HOME=/home/justin-a/scenery-packs/hf-cache HF_HUB_OFFLINE=1
T="$(dirname "$(readlink -f "$0")")"
exec flock /home/justin-a/scenery-packs/logs/gpu.lock nice -n 15 /home/justin-a/scenery-packs/.venv-gen/bin/python "$T/../../one-pass/tools/paint2.py" "$1"
