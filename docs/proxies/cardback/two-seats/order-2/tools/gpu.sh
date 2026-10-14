#!/bin/bash
# order 2: run order 1's one-pass/tools/paint2.py on a spec, on the shared GPU lock, niced.   gpu.sh <dir> <spec.json>
cd "$1"
export HF_HOME=/home/justin-a/scenery-packs/hf-cache HF_HUB_OFFLINE=1
T="$(dirname "$(readlink -f "$0")")"
exec flock /home/justin-a/scenery-packs/logs/gpu.lock nice -n 15 /home/justin-a/scenery-packs/.venv-gen/bin/python "$T/../../order-1/one-pass/tools/paint2.py" "$2"
