# SPDX-License-Identifier: GPL-3.0-or-later
"""ForgeCoach — scripts/human-picks/cardinfo.py

Fetches Scryfall's card objects for every card column of a 17Lands draft file
(the Arena cube's ~540 cards), for fit.py's colour, mana-value and land
features and for the TypeScript baselines' card facts:

    python3 -I scripts/human-picks/cardinfo.py PICKS.npz OUT.json

Uses Scryfall's /cards/collection (75 names a request, 100 ms apart). OUT is a
JSON array of Scryfall card objects, the shape of src/cube/testdata/scryfall-*.json.
Names Scryfall does not find are printed and left out.
"""
import json
import sys
import time
import urllib.request

import numpy as np


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 2
    names = [str(n) for n in np.load(argv[0])['names']]
    out, missing = [], []
    for i in range(0, len(names), 75):
        chunk = names[i:i + 75]
        body = json.dumps({'identifiers': [{'name': n} for n in chunk]}).encode()
        req = urllib.request.Request('https://api.scryfall.com/cards/collection', data=body, headers={
            'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'ForgeCoach-human-picks/1.0'})
        with urllib.request.urlopen(req, timeout=60) as r:
            d = json.load(r)
        out.extend(d.get('data', []))
        missing.extend(x.get('name', '?') for x in d.get('not_found', []))
        time.sleep(0.1)
    with open(argv[1], 'w', encoding='utf-8') as f:
        json.dump(out, f)
    print(f'{len(out)} cards, {len(missing)} not found: {missing}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
