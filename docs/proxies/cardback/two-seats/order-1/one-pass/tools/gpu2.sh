#!/bin/bash
# order 1, one pass: run paint2.py on a spec, on the shared GPU lock, niced.   gpu2.sh <spec.json>
cd /home/justin-a/scenery-packs/two-seats-work/order1/onepass
export HF_HOME=/home/justin-a/scenery-packs/hf-cache HF_HUB_OFFLINE=1
exec flock /home/justin-a/scenery-packs/logs/gpu.lock nice -n 15 /home/justin-a/scenery-packs/.venv-gen/bin/python "$(dirname "$(readlink -f "$0")")/paint2.py" "$1"
