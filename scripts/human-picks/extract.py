# SPDX-License-Identifier: GPL-3.0-or-later
"""ForgeCoach — scripts/human-picks/extract.py

Reads 17Lands' public draft files (draft_data_public.<expansion>.<event>.csv.gz,
CC BY 4.0) as a stream and writes one compact NumPy file of picks:

    python3 -I scripts/human-picks/extract.py OUT.npz FILE.csv.gz [FILE.csv.gz ...]

Never decompresses to disk. Each CSV row is one pick: the pack's cards
(`pack_card_<name>` counts, the picked card included), the pick, the pool so
far (`pool_<name>` counts), pack/pick numbers (0-based), the drafter's rank
and win-rate bucket. The output holds, per pick, offsets into flat card-index
arrays for the pack and the pool, so the fitting script (fit.py) never reads
the CSV again. See docs/human-picks.md.
"""
import csv
import gzip
import sys
from array import array

import numpy as np


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    out, files = argv[0], argv[1:]
    names = None
    pack_cards, pool_cards = array('h'), array('h')
    pack_off, pool_off = array('q', [0]), array('q', [0])
    pick, packno, pickno, event, draft = array('h'), array('b'), array('b'), array('b'), array('i')
    winb, ngames = array('f'), array('f')
    rank = array('b')
    draft_ids, draft_index = [], {}
    rank_codes = {'': 0, 'bronze': 1, 'silver': 2, 'gold': 3, 'platinum': 4, 'diamond': 5, 'mythic': 6}
    events = []
    skipped = 0
    for ei, path in enumerate(files):
        with gzip.open(path, 'rt', newline='', encoding='utf-8') as f:
            r = csv.reader(f)
            h = next(r)
            col = {c: i for i, c in enumerate(h)}
            pc = [i for i, c in enumerate(h) if c.startswith('pack_card_')]
            pl = [i for i, c in enumerate(h) if c.startswith('pool_')]
            these = [h[i][len('pack_card_'):] for i in pc]
            if [h[i][len('pool_'):] for i in pl] != these:
                raise SystemExit(f'{path}: pack and pool columns differ')
            if names is None:
                names = these
            elif names != these:
                raise SystemExit(f'{path}: card columns differ from the first file')
            idx = {n: i for i, n in enumerate(names)}
            ev = path.split('.')[-3] if path.count('.') >= 3 else str(ei)
            events.append(ev)
            for row in r:
                p = idx.get(row[col['pick']])
                if p is None:
                    skipped += 1
                    continue
                for i_, i in enumerate(pc):
                    v = row[i]
                    if v != '0':
                        for _ in range(int(v)):
                            pack_cards.append(i_)
                for i_, i in enumerate(pl):
                    v = row[i]
                    if v != '0':
                        for _ in range(int(v)):
                            pool_cards.append(i_)
                pack_off.append(len(pack_cards))
                pool_off.append(len(pool_cards))
                pick.append(p)
                packno.append(int(row[col['pack_number']]))
                pickno.append(int(row[col['pick_number']]))
                event.append(ei)
                d = row[col['draft_id']]
                di = draft_index.get(d)
                if di is None:
                    di = draft_index[d] = len(draft_ids)
                    draft_ids.append(d)
                draft.append(di)
                rank.append(rank_codes.get(row[col['rank']].strip().lower(), 0))
                w = row[col['user_game_win_rate_bucket']]
                winb.append(float(w) if w else float('nan'))
                g = row[col['user_n_games_bucket']]
                ngames.append(float(g) if g else float('nan'))
        print(f'{path}: {len(pick)} picks so far', file=sys.stderr)
    np.savez_compressed(
        out,
        names=np.array(names), events=np.array(events), draft_ids=np.array(draft_ids),
        pack_cards=np.frombuffer(pack_cards, np.int16), pack_off=np.frombuffer(pack_off, np.int64),
        pool_cards=np.frombuffer(pool_cards, np.int16), pool_off=np.frombuffer(pool_off, np.int64),
        pick=np.frombuffer(pick, np.int16), packno=np.frombuffer(packno, np.int8),
        pickno=np.frombuffer(pickno, np.int8), event=np.frombuffer(event, np.int8),
        draft=np.frombuffer(draft, np.int32), rank=np.frombuffer(rank, np.int8),
        winb=np.frombuffer(winb, np.float32), ngames=np.frombuffer(ngames, np.float32),
    )
    print(f'{len(pick)} picks, {len(draft_ids)} drafts, {len(names)} cards, {skipped} rows with an unknown pick skipped', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
