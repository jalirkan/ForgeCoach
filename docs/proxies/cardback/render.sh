#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Renders vintage-cube-back.html to vintage-cube-back.png: 1632x2220 at 600 dpi
# (2.72 x 3.70 in, a poker card plus MPC's 1/8 in bleed). Needs Chromium and Python's Pillow.
set -e
cd "$(dirname "$0")"
CHROME=${CHROME:-/opt/pw-browsers/chromium-1194/chrome-linux/chrome}
"$CHROME" --headless=new --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=816,1300 --screenshot=full.png "file://$PWD/vintage-cube-back.html"
python3 -c "from PIL import Image; Image.open('full.png').crop((0,0,1632,2220)).convert('RGB').save('vintage-cube-back.png', dpi=(600,600))"
rm full.png
