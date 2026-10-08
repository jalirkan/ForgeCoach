# SPDX-License-Identifier: GPL-3.0-or-later
"""ForgeCoach — scripts/card-model/decks.py

docs/card-model.md part D2, step 1: one streaming pass over 17Lands' public
Powered Cube game data (`game_data_public.Cube_-_Powered.*.csv.gz`, never
decompressed to disk) into a compact `.npz` of what the pair model needs:

  per game  — won (0/1), on_play (0/1), the player's 17Lands win-rate bucket
              and games bucket (as strings, coded), the half of its draft
              (FNV-1a-32(draft_id) & 1, exactly as scripts/human-cards/stats.ts),
              a cluster id (the draft id and the deck: games of one draft with
              the same 40 cards), and the deck's nonbasic cards (deck_<name> > 0)
              as a CSR list of card indices;
  per card  — the 17Lands card name.

Basic lands are left out of the card list and kept as five counts per game.
No draft id, rank or player field leaves this file; the npz holds only the
coded columns above. Rows whose `won` is not True/False are skipped (counted).

  python -I decks.py OUT.npz game_data_public.Cube_-_Powered.PremierDraft.csv.gz …
"""
import csv
import gzip
import sys

import numpy as np

BASICS = ("Plains", "Island", "Swamp", "Mountain", "Forest")


def fnv1a32(s: str) -> int:
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    out, files = argv[0], argv[1:]
    csv.field_size_limit(1 << 24)
    names = None
    won, onplay, wrb, ngb, half, clus, basics = [], [], [], [], [], [], []
    indptr, idx = [0], []
    wr_codes, ng_codes, clus_codes = {}, {}, {}
    bad = 0
    for path in files:
        with gzip.open(path, "rt", newline="", encoding="utf-8") as f:
            r = csv.reader(f)
            h = next(r)
            deck_cols = [(i, c[5:]) for i, c in enumerate(h) if c.startswith("deck_")]
            file_names = [n for _, n in deck_cols if n not in BASICS]
            if names is None:
                names = file_names
                pos = {n: k for k, n in enumerate(names)}
            else:
                for n in file_names:
                    if n not in pos:
                        pos[n] = len(names)
                        names.append(n)
            col = {c: i for i, c in enumerate(h)}
            cols = [(i, pos[n]) for i, n in deck_cols if n not in BASICS]
            bcols = [col["deck_" + b] if ("deck_" + b) in col else None for b in BASICS]
            iw, ip, iwr, ing, idr = col["won"], col["on_play"], col["user_game_win_rate_bucket"], col["user_n_games_bucket"], col["draft_id"]
            for row in r:
                w = row[iw]
                if w not in ("True", "False"):
                    bad += 1
                    continue
                cards = [k for i, k in cols if row[i] not in ("", "0")]
                cards.sort()
                did = row[idr]
                key = (did, tuple(cards))
                clus.append(clus_codes.setdefault(key, len(clus_codes)))
                won.append(w == "True")
                onplay.append(row[ip] == "True")
                wrb.append(wr_codes.setdefault(row[iwr], len(wr_codes)))
                ngb.append(ng_codes.setdefault(row[ing], len(ng_codes)))
                half.append((fnv1a32(did) & 1) if did else -1)
                basics.append([int(row[i]) if i is not None and row[i] else 0 for i in bcols])
                idx.extend(cards)
                indptr.append(len(idx))
    np.savez_compressed(
        out,
        names=np.array(names, dtype=object),
        won=np.array(won, dtype=np.int8),
        onplay=np.array(onplay, dtype=np.int8),
        wrb=np.array(wrb, dtype=np.int16),
        wrb_labels=np.array(sorted(wr_codes, key=wr_codes.get), dtype=object),
        ngb=np.array(ngb, dtype=np.int16),
        ngb_labels=np.array(sorted(ng_codes, key=ng_codes.get), dtype=object),
        half=np.array(half, dtype=np.int8),
        cluster=np.array(clus, dtype=np.int32),
        basics=np.array(basics, dtype=np.int8),
        indptr=np.array(indptr, dtype=np.int64),
        idx=np.array(idx, dtype=np.int16),
    )
    print(f"{len(won)} games, {bad} rows skipped, {len(names)} nonbasic cards, {len(clus_codes)} draft-deck clusters")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
