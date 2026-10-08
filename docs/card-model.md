# A card model and human synergy pairs: pre-registered tests

<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

Status: **pre-registered 2026-10-08, before any model was fitted or any
outcome-based number below was computed.** Known before writing this: the
inputs' shapes and counts (cards per cube, lab games per card, how many
Vintage and Synergy cards have human rows and how they split over colour,
type and mana value; how many card pairs co-occur in 17Lands decks how
often). No win rate, correlation, bias, pair effect or model output had been
computed by the code below. The results sections at the end are filled in
after the runs and change nothing above them.

Background: `docs/human-blend.md`. In short: the cube lab's (Forge-vs-Forge)
card win rates agree with 17Lands human GIH WR at about rho 0.48 on Vintage,
worse for 5+ drops, colourless and noncreature cards (part 2 B); 17Lands
numbers are blended into the card value for Vintage's 131 nonland cards and
Synergy's 59 (parts 1–2); a flat per-colour offset taken from Forge's own
deck win rates made things worse (part 3), because most of the lab's colour
gap is shared with humans.

---

# Part A2: a hierarchical card-quality model

## Question

Can one model that knows *where* Forge's lab misjudges cards — learned per
group of cards from the cards that have both a lab and a human number, with
shrinkage — give better card values for the cards that have **no** human
number (Vintage's nonland cards without a human row, Synergy's other
cards, and every card of the other six cubes), with honest intervals for thin cubes such as Evan's (about 530 lab
games per card)?

## The model (fixed in advance)

Plain words first. Every nonland card in every cube with a lab meta has one
hidden number, its **quality** q: how much better or worse than average a
human player does when it is in hand, in win-rate units. We never see q. We
see up to two noisy measurements of it:

- the **human** measurement, 17Lands' GIH win rate, where the card has a
  usable row (Vintage, Synergy); and
- the **lab** measurement, the card's Forge-vs-Forge win rate in its cube's
  meta, which is stretched or squeezed (a scale λ), shifted by a **bias** that
  depends on what kind of card it is, and noisier than its game count alone
  says (cards' rates are mostly their decks' rates).

The biases are what part 3 tried to fix by hand. Here they are learned from
the cards that have both measurements, one bias per colour, per card type,
per mana-value band and per combination of the three, each pulled toward 0
by an amount the data choose (a group with few cards gets a bias near 0, so
a flat shift can only appear where the data back it). A card with no human
number then gets: its group's typical quality (its cube's level, its colour,
type and mana-value group in that cube, and the no-meta prior's opinion),
corrected by what its lab number says once the group's bias is taken out —
weighted by how noisy each is. The less a card has been played, the more it
leans on its group.

Formally, for card i of cube c (nonland, as `docs/human-blend.md`; "colour"
is W, U, B, R, G, multicolour or colourless by Scryfall `colors`; "type" is
creature or not by the type line; "band" is mana value ≤ 2, 3–4 or 5+ — the
lab-trust bands of part 2 B):

    quality      q_i = α_c + β·z_i + g_col[c, col_i] + g_type[c, type_i] + g_mv[c, band_i] + η_i
    human        y_i = p_i − avg = q_i + κ_c + ε_i,       ε_i ~ N(0, p_i(1 − p_i)/n_i + σ_t,c²)
    lab          r_i − 0.5 = λ·q_i + b_col[col_i] + b_type[type_i] + b_mv[band_i] + b_cell[col_i, type_i, band_i] + e_i,
                                                          e_i ~ N(0, 0.375/g_i + σ_l²)

- `z_i = (cardPrior − 50)/10`, today's no-meta prior (score.ts), so the
  group mean includes everything the prior knows.
- `p_i`, `n_i`: the card's GIH win rate and games in hand in the human file;
  `avg` the file's pooled GIH rate; a human row is used under today's rule
  (≥ 500 games in hand, 0 < p < 1, nonland).
- Vintage is the human data's own environment: κ = 0, σ_t = 0. Synergy's
  human numbers come from another cube (part 2): κ_syn (the level offset, so
  the human data only order the shared cards, as part 2's anchor) and
  σ_t,syn (extra transfer noise) are estimated.
- `r_i`, `g_i`: the card's raw lab win rate (wins / games, as `metaValue`)
  and lab games; 0.375 = 0.25 × the lab's design effect 1.5 (score.ts
  `META_STRENGTH`). Only cards with at least one lab game have a lab
  measurement.
- Random effects: η_i ~ N(0, τ²); every g in a block ~ N(0, σ_g,block²) for
  the blocks col, type, mv (per cube, shared variance across cubes); every b
  in a block ~ N(0, σ_b,block²) for col, type, mv, cell. **The lab biases b
  are shared by all cubes** (they are Forge's, not a cube's); the group
  effects g on quality are per cube.
- Weak priors on the levels: α_c, κ_syn ~ N(0, 0.1²), β ~ N(0, 0.05²).
- Each cube's card is its own unit (a card in two cubes is two q's; no
  information passes between cubes except through the shared biases and the
  hyperparameters).
- **Fit.** All of it is linear and Gaussian given the eleven hyperparameters
  (λ, σ_l, τ, σ_t,syn, σ_g ×3, σ_b ×4). They are estimated by maximising the
  marginal likelihood (empirical Bayes, type-II maximum likelihood; L-BFGS-B
  on log scales, λ unconstrained, from fixed starting values); the card
  effects η are integrated out exactly card by card, the ~170 group and level
  effects jointly. Given the hyperparameters, each card's posterior mean and
  SD of q are exact. Not propagated: the hyperparameters' own uncertainty, so
  intervals are somewhat too narrow where they matter most (said on screen as
  "about"). Written in numpy/scipy (no PyMC/numpyro here); no sampling.
- **On the value scale:** value = 50 + 250 · 0.8 · q̂, the human blend's
  scale (`HUMAN_DISCOUNT`), clamped to 5–98; the 95% interval is
  q̂ ± 1.96·sd on the same scale. Lands are not in the model.

## The test (fixed in advance)

**Data.** The shipped lab metas of all eight cubes; the tests' Scryfall
snapshots (`src/cube/testdata/scryfall-<id>.json`) for colour, type and mana
value; `cardPrior`, `labValue` and `cardValue` from score.ts (exported by
`npm run card-model -- export`); 17Lands' Powered Cube files as in
human-blend.md (dataset updated 2025-11-23, 294,975 games) split into the
same halves, FNV-1a-32(draft_id) & 1, by the existing generator
(`npm run human-cards -- --half 0|1 --out DIR`).

**Directions.** A → B = half 0 → half 1, and half 1 → half 0. Human data
from half A are the model's input; half B's GIH win rate is the target.

**Card folds.** K = 5: a card's fold is FNV-1a-32(its cube name) mod 5. For
each direction and each fold k the model is **fitted afresh** (hyperparameters
included) with every card's half-A human row **except** those of fold k's
cards (hidden in both Vintage and Synergy); the fold-k cards are predicted
from everything else. Each target card thus gets one held-out prediction per
direction.

**Targets.** Vintage: nonland cards with a usable row in half B and lab
games (part 1 had 131). Synergy: the same for its shared cards (59 in
part 2).

**Scores.**

1. **model** — the held-out posterior mean, as a predicted GIH rate:
   avg_A + q̂ (+ κ̂ for Synergy).
2. **today** — `cardValue` for that card with its human row hidden. For a
   card without a human row today's `cardValue` *is* `labValue` (score.ts),
   so today and `labValue` are the same score on these cards; both names are
   reported, one number.

**Metrics.** Spearman rho with the target (average ranks), and RMSE in win
rate. today is on the value scale, so for RMSE it is mapped to a rate by an
ordinary least-squares line fitted, in each fold, on the **training** cards
(their half-A rate against their today value; the line is generous to today,
since it is fitted to the very scale it is scored on). The model's prediction
is used as it is.

**Differences and intervals.** Δrho = rho(model) − rho(today);
ΔRMSE = RMSE(today) − RMSE(model) (positive: the model is better). Paired
bootstrap over target cards, 10,000 resamples, numpy PCG64 seed 20261006,
2.5th–97.5th percentiles.

**Guard (human data visible).** With every half-A human row visible (no
folds), predict half B for the Vintage targets: the model against today's
`cardValue` built with half A's file (the shipped blend). Δrho with the same
bootstrap.

## Rule

**Pass** only if all of these hold:

1. **Vintage, held out:** in **both** directions, the lower end of Δrho's
   95% interval is above 0 **and** the lower end of ΔRMSE's is above 0.
2. **Synergy, held out (not worse):** averaged over the two directions,
   Δrho ≥ 0 and ΔRMSE ≥ 0 (point estimates; intervals reported).
3. **Guard:** in both directions the lower end of the visible-data Δrho
   interval is above −0.03 (the model must not be materially worse than
   today's blend where human data exist).

**If it passes:** the model is refitted on the full human files and all
eight cubes, and its posterior mean on the value scale becomes `cardValue`
for every nonland card of every cube with a meta (`public/cubes/<cube>.model.json`,
written by the fit script; lands keep today's value). Its 95% interval is
shown where lab numbers show, in the existing lab-trust label's place. The
Forge AI drafter's ratings (`labValue`, `labOnly`) are untouched, and a test
says so.

**If it fails:** nothing ships; this part and its results are what merges.

## Reported, not used for the decision

- The learned lab biases b with 95% intervals (full-data fit): which groups
  Forge's lab misjudges most, and in which direction.
- The hyperparameters (λ, σ_l, τ, the σ's), and per cube the median width of
  the cards' 95% intervals (Evan's against the 180-card cubes).
- Held-out rho of the model with the biases switched off (all σ_b fixed at 0)
  — how much of any gain is the biases rather than the pooling and prior.

---

# Part D2: synergy pairs from human decks

## Question

Which pairs of cards win more for human players **together** than each does
alone, reliably enough to show in pick advice and the deck assistant?

## Data (fixed in advance)

The same two 17Lands Powered Cube files, streamed once
(`scripts/card-model/decks.py`) into a compact table of games: won, on the
play, the player's 17Lands win-rate bucket and games bucket, the deck's
nonbasic cards (a card is in the deck when `deck_<name>` > 0) and its five
basic-land counts, the half of its draft (as above) and a cluster id: the
games of one draft played with the same deck. 294,975 games, 540 nonbasic
cards, 68,849 clusters. The model is fitted at cluster level: a cluster is one
deck with k games and w wins (decks, player and covariates are constant in
it; "on the play" becomes the cluster's share of games on the play).

## The model (fixed in advance)

1. **Each card alone.** A logistic regression of wins on: an intercept, the
   player's win-rate bucket and games bucket (one level each, an empty bucket
   its own level), the share on the play, the five basic counts, and one
   indicator per nonbasic card; binomial in k games per cluster; an L2 penalty
   of 1 (in log-odds², i.e. a N(0, 1) prior) on the card coefficients only;
   fitted by Newton's method. Fitted separately in each half.
2. **Each pair together.** For a pair (a, b), the interaction is the extra
   log-odds of a deck holding both, beyond the two cards' own effects and
   the covariates. Each candidate pair is tested on its own against the
   fitted main-effects model by the **efficient score test**: score
   U = Σ x_a x_b (w − k·p̂) over clusters, information
   I = Σ x_a x_b k·p̂(1−p̂) − v′M⁻¹v (the part of the pair's information not
   explained by the main-effects design; M the fitted model's penalised
   information, v the pair's cross-information with it), one-step estimate
   θ̂ = U / I, z = U / √(φ·I), two-sided p from the normal. φ is the
   Pearson dispersion of the main-effects fit (sum of squared Pearson
   residuals over clusters minus parameters), so overdispersion within decks
   — the same player, sideboarding — widens the tests. Effects in win-rate
   points: θ̂ · p̄(1 − p̄), p̄ the mean fitted rate of the pair's decks.
3. **Candidates (minimum counts).** In the half being tested, the pair is in
   at least **1,000 games together**, and each card is in at least 1,000
   games without the other.

## Multiple comparisons and replication (fixed in advance)

- **Discovery** in half A: Benjamini–Hochberg at **FDR 10%** over all
  candidate pairs of half A.
- **Replication** in half B, for the pairs discovered in A: the same score
  test fitted on half B only (its own main effects); a discovered pair
  **replicates** when its half-B effect has the **same sign** and the
  one-sided p-values (in that sign's direction) pass Benjamini–Hochberg at
  **5%** over the discovered set.
- Both directions are run (A = half 0, then A = half 1). A pair is
  **replicated** when it replicates in at least one direction.
- **Reported:** per direction, the number of candidates, discoveries and
  replications; the share of discoveries with the same sign in half B (50%
  expected by chance); the Pearson and Spearman correlation of θ̂ between the
  halves over all pairs that are candidates in both halves, and over the
  discoveries. Pair tests share cards, so these correlations' intervals are
  not computed; they describe, they do not decide.

## Rule

**Ship only replicated pairs with a positive effect**, and only in cubes
holding both cards (names matched as `normName`): a
`public/cubes/<cube>.synergy.json` (17Lands credited, CC BY 4.0) per cube
with at least one such pair. The effect shown is the **replication half's**
estimate (the mean of the two when the pair replicates in both directions),
not the discovery half's, which is biased upward by selection. Pick advice
and the deck assistant show a short line where both cards meet — "Humans win
more with X + Y (17Lands)" — in the human-data blue. A pair from Arena's
Powered Cube is a pair in that cube; in another cube the line says so.
Replicated pairs with a **negative** effect are reported here, not shipped.

**If nothing replicates:** nothing ships; this part and its results are what
merges.
