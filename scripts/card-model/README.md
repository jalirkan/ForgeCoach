# scripts/card-model

<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

The fitting scripts for `docs/card-model.md`: part A2 (a hierarchical
card-quality model from lab and human numbers) and part D2 (card pairs that
win more together for 17Lands' players). Both pre-registered tests failed
their ship rules (see the doc's results), so nothing these scripts write is
shipped. They stay here so the runs can be repeated.

| File | What it does |
|---|---|
| `export.ts` + `run.mjs` | `npm run card-model -- export OUT.json [HALVES_DIR]`: per cube with a lab meta, every card's facts (Scryfall test snapshot), `cardPrior`, lab games and wins, `labValue`, `cardValue`, and its 17Lands counts in the shipped human file and in each half. The only TypeScript step: the model sees exactly what score.ts sees. |
| `fit.py` | A2. `test FEATURES.json` runs the pre-registered held-out test (2 directions × 5 card folds, the guard, and the biases-off variant; prints the table and writes `FEATURES.test-result.json`). `report FEATURES.json` prints the full-data fit's hyperparameters, learned lab biases and interval widths. `ship FEATURES.json OUT_DIR DATE` would write `<cube>.model.json` per cube (not used: the test failed). |
| `decks.py` | D2, step 1: streams 17Lands' `game_data_public.Cube_-_Powered.*.csv.gz` (never decompressed to disk) into a ~3 MB `.npz`: per game won, on the play, the player's buckets, the draft's half, a draft × deck cluster id and the deck's nonbasic cards. No draft id or player field is kept. |
| `synergy.py` | D2. `test DECKS.npz RESULT.json`: per half the main-effects logistic model and every candidate pair's efficient score test, discovery (BH 10%) and replication (BH 5%) both ways. `ship RESULT.json FEATURES.json OUT_DIR DATE` writes `<cube>.synergy.json` for cubes holding both cards of a replicated positive pair (none today). |

## Running

Python 3 with numpy and scipy only (no PyMC or numpyro: A2 is Gaussian given
its hyperparameters, so it is solved exactly and the hyperparameters are
fitted by type-II maximum likelihood; D2 is a Newton fit plus closed-form
score tests). Run with `-I`, outside the data folder:

```bash
H=…/halves  # npm run human-cards -- --updated 2025-11-23 --half 0|1 --out $H <the two csv.gz>
npm run card-model -- export /tmp/features.json $H
python3 -I scripts/card-model/fit.py test /tmp/features.json          # ~5 min, one BLAS thread
python3 -I scripts/card-model/decks.py /tmp/decks.npz <the two csv.gz>   # ~40 s
python3 -I scripts/card-model/synergy.py test /tmp/decks.npz /tmp/synergy.json   # ~40 s
```

The scripts pin BLAS to one thread: the matrices are small (160 effects in
A2, about 600 columns in D2), and on a shared machine threads only fight.
Every random number comes from a fixed seed (bootstrap: numpy PCG64, seed
20261006); card folds and halves are FNV-1a-32 hashes of the card name and
draft id, as in `scripts/human-cards/`.
