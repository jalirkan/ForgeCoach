# A pick model from human drafts: pre-registered test

<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

Status: **pre-registered 2026-10-08, before any model was fitted.** The
results section at the end is filled in after the run and does not change
anything above it. Before this document was committed, only the data's shape
was looked at (the counts under *Data*); no model was fitted, no baseline was
scored and no accuracy of any kind was computed.

## Question

ForgeCoach's pick advice (grid, Winston, and the Draft vs AI pick screen)
ranks cards by a card value (`cube/score.ts` `cardValue`: the cube lab's
Forge-vs-Forge win rate, a card-text prior and, where 17Lands has them, human
*game* results) plus colour fit and synergy (`cube/pick.ts` `pickValue`).
None of it has ever looked at what strong human drafters actually *pick*.

17Lands publishes every pick of its users' Powered Cube drafts on Arena. Can
a small, explainable model fitted to those picks predict human picks, on
drafts it never saw, better than ForgeCoach's current advice does? If it can,
ship it as a labelled "what humans take" signal beside the lab number.

## Data

17Lands' public draft data for Arena's Powered Cube (CC BY 4.0,
<https://www.17lands.com/public_datasets>), files last modified 2025-12-01:

| file | size | sha256 |
|---|---|---|
| `draft_data_public.Cube_-_Powered.PremierDraft.csv.gz` | 92,791,954 B | `eac816bfc246d3b7dfb666bcdb84dc0e81b563508b8f8ed1dee948fc80ce8956` |
| `draft_data_public.Cube_-_Powered.TradDraft.csv.gz` | 8,715,202 B | `95564bef8848e3ed1c507a2c9c503b8003d76eeafa923990bd887bf18d2fbe5a` |

Downloaded locally, never committed. One row is one pick: the cards in the pack
(the taken card included), the taken card, the pool so far, pack and pick
number, the drafter's rank and win-rate bucket. 545 card columns. Together:
2,316,631 picks from 52,652 drafts (41 rows with an empty pick dropped).
Every draft starts at pack 1 **pick 2**: the first pick of the draft is not in
the files, so no model here learns from first picks.

Card facts (colours, mana value, land, colours a land makes) come from
Scryfall through the app's own `cube/facts.ts`; 7 of the 545 cards are
Arena-only or not found by name and get no facts (their context features are 0).

## Split (fixed now)

By draft, never by pick, so a drafter's picks in one draft are never on both
sides: fold = FNV-1a-32(`draft_id`, UTF-8) mod 5.

- **test** (fold 0): 10,666 drafts, 469,262 picks. **Not touched while
  fitting or choosing anything.** Used once, for the numbers below.
- **validation** (fold 1): 10,542 drafts. Used only to choose the ridge
  strength λ and to fit the baselines' temperatures (below).
- **train** (folds 2–4): 31,444 drafts, 1,383,523 picks.

A pick counts (for fitting and for scoring) only when its choice set has at
least 2 cards: the last pick of a pack is forced and says nothing.

## Models

Each is a **conditional logit** (the Bradley–Terry / Luce choice model, one
choice from a set): every card on offer gets a utility *u*, and the chance
the drafter takes card *i* is exp(*u_i*) / Σ exp(*u_j*) over the cards on offer.
Fitted by maximum likelihood (L-BFGS) with a ridge penalty λ/2 · Σ s² on the
card strengths only.

**(a) Card strength.** *u_i* = *s*[card *i*]. One number per card (545), the
"how much humans want this card" in log-odds units. λ is chosen from
{1, 10, 100} by the mean validation log-loss.

**(b) Card strength plus the drafter's pool.** With *t* = min(1, pool size / 44)
(how far into the draft: 0 at the start, 1 by the last pick):

*u_i* = *s*[card *i*] · (1 + γ·*t*) + β · *x_i*

γ lets card strength matter more or less as the draft goes on. *x_i* are 11
features of card *i* against the pool, each simple enough to state in a line
(the pool's colour shares count each coloured nonland card once, split evenly
over its colours):

| feature | meaning |
|---|---|
| `fit`, `fit·t` | for a coloured nonland card, the smallest pool share among its colours (0–1) |
| `off`, `off·t` | how many of its colours are under 15% of the pool (once the pool has 3+ coloured nonland cards) |
| `gold·t` | it has 2+ colours |
| `colourless·t` | a colourless nonland card |
| `land·t` | a land |
| `dual`, `dual·t` | a land making both of the pool's top two colours |
| `curve`, `curve·t` | for a nonland card, the pool's share of nonland cards at the same mana value (≤1, 2, 3, 4, 5, 6+) |

That is 545 strengths plus 12 shared coefficients. The colour and curve
coefficients are what a reader can check against intuition ("humans move
in after about N picks"). (b) uses the same λ as (a); γ and β are not penalised.

**(c) A boosted or neural ranker** is not run in this round. If (b)'s gain
over (a) on validation is large, a ranker on the same features is a follow-up
job (on the lab PC, not here); this document would get a part 2.

## Metrics

On held-out (test) picks, per pick:

- **top-1**: the model's highest-utility card is the one taken. Ties count
  fractionally (*k* cards tied at the top with the taken one → 1/*k*).
- **top-3**: the taken card is among the model's three highest (ties likewise:
  the chance under a random tie-break).
- **log-loss**: −log of the probability the model gave the taken card.

Means over picks. **Intervals:** a bootstrap over **drafts** (a draft's picks
are not independent): 2,000 resamples of the test drafts with replacement,
NumPy PCG64 seed 20261008, 2.5th–97.5th percentiles. A comparison of two
models is **paired**: both are scored on the same resampled drafts and the
interval is of the difference.

## Where the models are compared

**Full packs** (all test picks, the real 540-card packs): (a), (b) and a
uniform guess. The baselines cannot score most of these cards, so they are
not compared here.

**A cube's packs** (one table per cube with 30+ overlap cards: Vintage 152,
Omega 105, Modern-Era 100, Evybaby 91, Synergy 79, Fair Fight 47, Peasant 42;
Pauper's 21 are too few). Each test pick's pack is cut to the cards that are
also in that cube (matched by `cube/human.ts` `normName`); the pick counts
only if the taken card is one of them and at least 2 remain. The human chose
from the whole pack, so the question is: among these cube cards, which did
they take? The logit models answer it by renormalising over the cut set
(exactly what a logit says the choice among a subset is). Counts in the test
fold: Vintage 99,733 picks (10,665 drafts, median 3 cards to choose from),
Omega 62,067, Modern-Era 55,704, Evybaby 54,511, Synergy 42,834, Fair Fight
17,370, Peasant 15,145. Both models (and the pickValue baseline) still see the
drafter's **whole** real pool.

## Baselines (scored on a cube's packs)

1. **`gihWR`** — 17Lands' games-in-hand win rate from the cube's shipped
   `.human.json` (Vintage, Synergy only); a cube card without a row gets the
   file's average.
2. **`cardValue`** — `cube/score.ts` `cardValue` as shipped for that cube (its
   document, the tests' Scryfall snapshot, its shipped meta and human file).
3. **`pickValue`** — the pick advice's own number, `cube/pick.ts`
   `pickValue(card, pool)`: card value plus synergy plus colour fit for the
   drafter's real pool. Pool cards outside the cube are given their Scryfall
   facts (and the no-meta value 40), so the advice sees the drafter's colours.
   **This is ForgeCoach's current advice ranking.**
4. **`aiRating`** — the Draft vs AI drafter's card rating (`draft/cards.ts`
   `ratingOf`: lab value, no human data).

A baseline is a ranking, not a probability, so for log-loss each gets
softmax(*T* · score) with one temperature *T* fitted by maximum likelihood on
the validation fold (pickValue: on 20,000 validation picks drawn with the
seed). Top-1 and top-3 do not depend on *T*.

## Ship rule (fixed now)

Per cube, **ship that cube's `<file>.picks.json` only if, on its packs,**

- there are at least 2,000 test picks, and
- the 95% interval of top-1(b) − top-1(`cardValue`) lies above 0, **and**
- the 95% interval of top-1(b) − top-1(`pickValue`) lies above 0.

Otherwise that cube gets nothing, and if no cube passes, this document and
the scripts are what merges. Top-1 is the decision metric because the advice
names one card (or line); top-3 and log-loss are reported beside it.

What shipping means: the file holds the per-card strengths *s* and (b)'s γ,
β. The pick screens show it **as a signal next to the lab number, in the
human-data blue**, labelled plainly ("Humans take this early"), credited to
17Lands. It does **not** change `pickValue`, the advice's ranking, or the
card value: a gain on Arena booster picks says nothing yet about
whether a different ranking wins more grid drafts (see *Transfer*). The Forge
AI drafter (`draft/pick.ts`) stays unchanged; whether the human model makes a
better Draft vs AI opponent is a separate test for later, with its own
pre-registration.

## Transfer to Justin's cubes (pre-registered; what can and cannot be checked)

Justin's cubes are 180-card, two-player, mostly **grid** drafts (take a row or
column of three from nine). The data is 8-player, 15-card-pack booster drafts
of a 540-card cube on Arena. There are **no human grid picks** anywhere to
test against, so transfer cannot be measured directly. What can be checked:

- **T1. Does the big cube distort the overlap cards' order?** On Vintage,
  fit model (a) a second time using only the train picks cut to Vintage's
  overlap cards (as if the 388 other cards did not exist), and compare it with
  the full-pack (a) on the Vintage test packs: top-1 and log-loss difference
  with paired intervals, and the Spearman correlation of the two strength
  vectors. If the full-pack fit is as good as the overlap-only fit, strengths
  learned among 540 cards order the overlap cards as well as strengths learned
  among those cards alone — the property a smaller cube needs. Reported, not a
  gate.
- **T2. Small choice sets.** The cube tables already are small choice sets
  (median 2–3 cards, like a grid line's best card against the others).
  Reported per choice-set size (2–3, 4–6, 7–9, 10–15) and per draft stage
  (*t* < 0.34, 0.34–0.67, later) for every model.
- **By drafter skill** (17Lands' win-rate bucket: under 50%, 50–60%, 60%+),
  for (a) and (b) on full packs. Reported only.

What **cannot** be checked here, and so the screen does not claim it:

- choosing a **line** of three (the grid's real decision), and the
  two-player denial the advice already models;
- the 180-card cubes' different neighbours and colour balance (a card's
  strength is relative to the 540-card cube's alternatives);
- Winston's take-or-pass and its hidden piles;
- paper players versus Arena players (17Lands users skew enfranchised).

## Reproduce

```bash
# data (~100 MB), outside the repository
curl -O https://17lands-public.s3.amazonaws.com/analysis_data/draft_data/draft_data_public.Cube_-_Powered.PremierDraft.csv.gz
curl -O https://17lands-public.s3.amazonaws.com/analysis_data/draft_data/draft_data_public.Cube_-_Powered.TradDraft.csv.gz
# Python 3 with numpy and scipy; npm ci done
python3 -I scripts/human-picks/extract.py OUT/picks.npz draft_data_public.Cube_-_Powered.*.csv.gz   # ~4 min
python3 -I -c "import numpy,json,sys; json.dump([str(n) for n in numpy.load(sys.argv[1])['names']], open(sys.argv[2],'w'))" OUT/picks.npz OUT/names.json
python3 -I scripts/human-picks/cardinfo.py OUT/picks.npz OUT/scryfall-arena.json
npm run human-picks -- facts OUT/scryfall-arena.json OUT/names.json OUT/facts.json
python3 -I scripts/human-picks/fit.py describe OUT/picks.npz OUT/facts.json
python3 -I scripts/human-picks/fit.py run OUT/picks.npz OUT/facts.json OUT/names.json OUT/scryfall-arena.json OUT/work [--ship public/cubes]
```

## Results

(Filled in after the run.)
