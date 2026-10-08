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

## Results (run 2026-10-08)

Run as in *Reproduce*; the log is reproduced below in tables. 739 s on one CPU
core (most of it fitting (b)).

**Changes to the code after the pre-registration commit, all before any
result was computed, all numerical only** (each its own commit): the L-BFGS
stopping rule (the first setting stopped a fit after 9 iterations, the second
never stopped the joint fit; now a relative change of 1e-9), and fitting (b)
in two stages on standardised features (the optimum is the same; coefficients
are reported in raw units). After the run, the shipped files gained each
card's colours as the model saw them (below), with no change to any number.

### Choosing λ (validation)

Mean validation log-loss of (a): λ = 100: 1.6797, λ = 10: 1.6762, **λ = 1: 1.6761**
(chosen; the data are large enough that the penalty barely matters).

### The fitted context coefficients (b)

γ = −0.40: a card's strength counts fully at the start of the draft and 0.6×
by the end. β, in log-odds per unit of the feature:

| feature | start of draft (t = 0) | end (t = 1) |
|---|---|---|
| colour fit (smallest pool share of the card's colours, 0–1) | +1.94 | +4.68 |
| each of the card's colours under 15% of the pool | −1.08 | −1.42 |
| gold card | 0 | +1.05 |
| colourless nonland | 0 | +0.78 |
| land | 0 | +0.76 |
| a dual in the pool's two colours | +1.83 | +2.13 |
| curve (share of the pool at the card's mana value) | +0.08 | −0.04 |

The card strengths *s* have a standard deviation of 1.72 log-odds.

### Held-out drafts, full packs (10,665 drafts, 437,265 picks)

| model | top-1 | top-3 | log-loss |
|---|---|---|---|
| uniform guess | 16.8% | 46.7% | 1.975 |
| (a) card strength | 36.4% [36.2, 36.6] | 72.1% [71.9, 72.3] | 1.675 [1.671, 1.679] |
| (b) + pool context | **49.1%** [48.9, 49.3] | **82.9%** [82.8, 83.1] | **1.373** [1.368, 1.377] |
| (b) − (a) | +12.7 pts [+12.5, +12.9] | +10.9 pts [+10.7, +11.0] | −0.303 [−0.307, −0.299] |

### Each cube's packs: the ship test

Top-1 on held-out picks with the pack cut to the cube's cards (95% draft
bootstrap intervals). `cardValue` and `aiRating` are the same number in cubes
with no human file (both are then the lab value), so they tie there by
construction.

| cube (overlap, test picks) | (a) | **(b)** | cardValue | **pickValue** | aiRating | gihWR | (b) − cardValue | (b) − pickValue | ship |
|---|---|---|---|---|---|---|---|---|---|
| Vintage (152, 99,733) | 61.2% | **73.0%** | 46.2% | 56.3% | 34.6% | 48.6% | +26.8 [+26.3, +27.2] | +16.6 [+16.3, +17.0] | yes |
| Omega (105, 62,067) | 64.2% | **76.1%** | 37.7% | 50.1% | 37.7% | — | +38.4 [+37.9, +38.9] | +25.9 [+25.4, +26.4] | yes |
| Modern-Era (100, 55,704) | 62.2% | **77.0%** | 31.9% | 43.3% | 31.9% | — | +45.1 [+44.6, +45.8] | +33.7 [+33.2, +34.3] | yes |
| Evybaby (91, 54,511) | 64.4% | **75.7%** | 36.5% | 50.3% | 36.5% | — | +39.2 [+38.6, +39.7] | +25.4 [+24.9, +25.9] | yes |
| Synergy (79, 42,834) | 64.9% | **76.0%** | 44.7% | 53.7% | 40.1% | 49.7% | +31.3 [+30.6, +31.9] | +22.4 [+21.8, +23.0] | yes |
| Fair Fight (47, 17,370) | 69.2% | **82.4%** | 39.6% | 58.5% | 39.6% | — | +42.9 [+41.9, +43.8] | +24.0 [+23.1, +24.8] | yes |
| Peasant (42, 15,145) | 70.6% | **82.8%** | 42.7% | 52.8% | 42.7% | — | +40.1 [+39.0, +41.1] | +29.9 [+28.9, +30.9] | yes |

Log-loss on Vintage's packs: (b) 0.649 [0.644, 0.654], (a) 0.879, pickValue
0.974, gihWR 1.080, cardValue 1.114, aiRating 1.168 (each baseline at its
validation temperature). Top-3: (b) 98.0%, pickValue 93.3%, cardValue 90.2%
(with a median of 3 cards to choose from, top-3 is nearly always right, so
top-1 is the informative one). The other cubes rank the same way on every metric.

**Decision: ship all seven** (`public/cubes/<file>.picks.json`). Every
interval is far from 0; the smallest margin is Vintage's +16.6 points over
the pick advice.

### Transfer (Vintage)

- **T1.** (a) fitted on full 540-card packs vs (a) fitted only on choice sets
  cut to Vintage's 152 cards, both scored on Vintage's test packs: top-1 61.2%
  vs 61.1%, difference +0.1 pts [−0.0, +0.2]; log-loss 0.879 vs 0.878
  (+0.001 [+0.001, +0.001]). The two strength vectors correlate at Spearman
  0.997. So the big cube's other 388 cards do not distort how humans order
  the overlap cards: strengths learned among 540 cards order them as well as
  strengths learned among those cards alone (to 0.1 point of accuracy).
- **T2.** By choice-set size and by draft stage (top-1 on Vintage's packs),
  (b) leads every baseline in every bin; see `results.json`.
- **By drafter skill** (full packs, top-1 of (b)): under 50% win rate 46.8%,
  50–60% 49.5%, 60%+ 51.2%. Stronger drafters are more predictable, and the
  model fits them best.

What this does **not** show, as said above: that a grid **line** chosen by
human pick strength is better, that two-player denial, Winston's piles or
paper players behave the same, or that the picks it predicts **win**. It
predicts what Arena's players take. Those are different questions: the
cards 17Lands' own win rates like and humans take late (below) are exactly
where the two part.

### What the human picks say (descriptive, not tested)

1. **Humans draft blue and black, and leave green and white aggro.** Mean pick
   strength of mono-coloured nonland cards over the whole Arena cube: blue
   +0.44, red +0.03, white −0.01, black −0.04, green −1.01 (gold +0.84,
   colourless +0.56: Moxen, Sol Ring and flexible cards). In Vintage's
   nonland cards, the picks rank blue and black cards in the top half, while
   ForgeCoach's card value ranks white and red there (mean rank percentile,
   lower = earlier: white 0.52 by humans vs 0.27 by card value, black 0.42 vs
   0.66). The cards humans take far earlier than our value says are black and
   blue power — Toxic Deluge (#36 by humans, #119 by value), Thoughtseize (#21
   vs #96), Demonic Tutor (#17 vs #72), Balance, Griselbrand, Dark Ritual — and
   the ones we rate high and humans take late are white and red aggro:
   Thraben Inspector (#91 vs #17), Goblin Rabblemaster, Lingering Souls,
   Flickerwisp, Monastery Swiftspear. The second group are cards with good
   17Lands win rates, which is why card value (it blends them in) likes
   them: humans under-draft cheap aggressive cards relative to how they win.
   In Modern-Era the disagreement is total (Spearman −0.34 between pick
   strength and card value): the lab's favourites are green (Eternal Witness,
   Tarmogoyf, Bloodbraid Elf), which humans take last. This is also a note
   for J111: the Forge AI over-drafts blue, and so do humans.
2. **Colour commitment roughly doubles in weight over the draft, while raw
   card strength fades.** A card fully in the colours of a two-colour pool
   (fit ≈ 0.5) gains about +1.0 log-odds at the start and +2.3 by the end,
   while strength drops to 0.6×. With strengths spread at 1.7 log-odds (one
   standard deviation), being on colour at the end is worth more than a card
   one standard deviation stronger, which is what the advice's colour fit
   already assumes; the pool features alone add 12.7 points of top-1 over
   strength alone. Each off-colour colour costs about −1.1 to −1.4 log-odds,
   and a dual in your colours is worth +1.8 to +2.1. Curve barely matters.
3. **The Power is the Power.** The model's top ten are Black Lotus, the five
   Moxen, Time Walk, Sol Ring, Ancestral Recall and Mana Crypt, then new
   cards (Minsc & Boo, Tamiyo, Broadside Bombardiers, Ajani, Comet). The
   files' first pick is missing from the data (*Data*), so these strengths
   come from the picks after it.

### What shipped

- `public/cubes/<file>.picks.json` (schema 1) for Vintage, Omega, Modern-Era,
  Evybaby, Synergy, Fair Fight and Peasant: the per-card strength, how often
  the card was seen and taken in the data, its colours as the model saw them
  (Scryfall's: the Vintage document files the colourless Moxen under their
  colours, and Fair Fight and Evybaby one colourless card each), γ, β and the
  feature constants, and the held-out top-1 of the model, cardValue and
  pickValue.
- `src/cube/humanPicks.ts`: the parser, the same features and utility as
  fit.py (checked against fit.py's own features and probabilities on 30 held-out
  picks, `src/cube/testdata/human-picks-golden.json`), and the words.
- On screen, in the human-data blue: each card's "Humans take this early /
  mid-pack / late · #k of N by human picks" in the pick screen's numbers
  panel, and under the grid, Winston and booster advice "Of these, humans with
  your pool would most often take X (p%), then Y". The credit names 17Lands,
  links the dataset and licence, and says what the model is not. The advice's
  ranking, the card value and the Forge AI drafter are unchanged.

### Follow-ups (not done here)

- **Draft vs AI opponent:** whether the human pick model makes a better Forge
  AI drafter needs its own pre-registered test (and mtg-table parity).
- **(c)** a boosted ranker on the same features: (b) gains 12.7 points over
  (a), so pool context clearly matters; a richer ranker might find more
  (synergy pairs, pick-order effects). It belongs on the lab PC.
- **Advice ranking:** using the strengths inside `pickValue` would need a test
  of what wins, not of what humans pick.
