#!/bin/bash
cd /home/justin-a/scenery-packs/two-seats-work/order1
export HF_HOME=/home/justin-a/scenery-packs/hf-cache HF_HUB_OFFLINE=1
exec flock /home/justin-a/scenery-packs/logs/gpu.lock nice -n 15 /home/justin-a/scenery-packs/.venv-gen/bin/python specs/paint.py "$1"
