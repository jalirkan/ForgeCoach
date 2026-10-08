# Human data in the card value: pre-registered test

<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

Status: **pre-registered 2026-10-06, before any result was computed.** The
results section at the end is filled in after the run and does not change
anything above it.

## Question

Should the deck assistant's card value (`src/cube/score.ts` `cardValue`, used
by the builder, swaps, pick advice and the Draft vs AI pick helper) mix in the
17Lands human numbers (`public/cubes/vintage-cube-180.human.json`, #80) where
they exist, or stay as it is (lab win rate blended with the no-meta prior)?

Background: the lab's (Forge-AI) numbers correlate only weakly with human GIH
WR (meta win rates rho 0.50, M0 power 0.29); the human data's split-half
reliability is 0.94. That says human numbers are stable; it does not yet say a
blend ranks cards better for a human than today's value does. This test asks
that, on data the blend did not see.

## The blend (fixed in advance)

For a card with prior `P` (`cardPrior`), lab value `L` from `g` lab games
(`metaValue`, today's formula: value = (K·P + g·L)/(K + g), K = 80) and human
counts `n` games in hand, `k` of them won:

    p   = k / n                                   card's GIH win rate
    avg = gih.wins / gih.games                    the format's pooled GIH WR (same file)
    D   = 0.8                                     Arena-vs-paper discount, fixed
    h   = 50 + 250 · D · (p − avg)                human value, on the value scale
    H   = 0.375 · n / (D² · p(1−p))               human precision, in lab-game units
    value = (K·P + g·L + H·h) / (K + g + H)       clamped to 5–98, rounded to 0.1

`H` puts the human estimate's binomial variance, D²·p(1−p)/n in rate units, on
the same footing as the lab's games (per-game variance 0.25 × design effect
1.5 = 0.375, as `META_STRENGTH` in score.ts). So human data leads wherever it
exists (n ≈ 1,000–20,000 gives H in the thousands against K + g ≈ 100–300);
the discount pulls human values toward the middle by a fifth. A card with no
human row (fewer than 500 games in hand, or not in 17Lands' cube), and every
other cube, keeps today's value exactly. Nothing about this formula — D, the
precision rule, the 500-game threshold — is chosen or changed after seeing the
results.

## The test

**Data.** 17Lands' public game data for "Cube - Powered":
`game_data_public.Cube_-_Powered.PremierDraft.csv.gz` and
`…TradDraft.csv.gz`, the same files as #80 (dataset updated 2025-11-23),
downloaded locally and kept out of git.

**Halves.** Each game goes to half `FNV-1a-32(draft_id) & 1` (the 32-bit FNV-1a
hash of the `draft_id` string's UTF-8 bytes), so a draft's games all land in one
half. Rows with an empty `draft_id` go to neither half (counted and reported).
Each half's counts are built by the existing generator with a new `--half 0|1`
option (`scripts/human-cards/`), producing a file in the shipped schema.

**Folds.** Fold 1: A = half 0, B = half 1. Fold 2: A = half 1, B = half 0.

**Target.** For each fold, half B's GIH WR (k/n) for every Vintage cube card
that is not a land (neither the document nor Scryfall calls it one) and has at
least 500 games in hand in half B.

**Scores compared.** On the same target cards:

1. **today** — `cardValue` as shipped (Vintage cube document, the test
   Scryfall snapshot `src/cube/testdata/scryfall-vintage.json`, the shipped
   `vintage-cube-180.meta.json`), which uses no human data;
2. **blend** — the formula above with half A's file (its own `avg`; cards
   under 500 games in hand in A keep today's value).

**Statistic.** Spearman rank correlation with the target (average ranks for
ties), rho(blend) − rho(today).

**Interval.** Paired bootstrap over target cards: 10,000 resamples with
replacement (mulberry32, seed 20261006), both rhos computed on the same
resample, 2.5th and 97.5th percentiles of the difference.

**Rule.** Adopt the blend **only if the lower end of the 95% interval of
rho(blend) − rho(today) is above 0 in both folds.** Otherwise the human data
stays display only, and this document plus its results are what merges.

## Reported but not used for the decision

So the discount and precision rule are not tuned on half B, these are shown
for information only, with the same folds and targets:

- the blend with D = 0.6 and D = 1.0;
- an equal-weight blend (H = K + g: half human, half today's value);
- human only (h from half A; ranks as half A's GIH WR);
- the lab value alone and the prior alone (where the lab has games).

## Does it hurt the Forge AI's drafting?

The AI drafter (`src/draft/` `pick.ts`, `draft.ts`, `weights.ts`) is mtg-table's
cube-lab AI and must stay in parity with it; its card ratings
(`draft/cards.ts` `ratingOf`) read `cardValue` today. If the blend is adopted,
the AI keeps today's value (the lab formula, no human data) and a test checks
that every AI rating and a seeded AI draft are identical with and without the
human file. The AI's drafting is therefore unchanged by construction; this
test does not measure whether human data would make the AI draft better.

## Results (run 2026-10-06)

Reproduce: download the two files, then

```bash
npm run human-cards -- --updated 2025-11-23 --half 0 --out OUT game_data_public.Cube_-_Powered.*.csv.gz
npm run human-cards -- --updated 2025-11-23 --half 1 --out OUT game_data_public.Cube_-_Powered.*.csv.gz
npm run human-blend -- OUT/vintage-cube-180.human.half0.json OUT/vintage-cube-180.human.half1.json
```

The halves: 147,565 and 147,410 games (294,975 in all, as the shipped file; no
row lacked a draft id). In each fold 131 nonland Vintage cards have 500+ games
in hand in half B, and all 131 have 500+ in half A too.

| Fold | A → B | rho(today, B) | rho(blend, B) | difference | 95% interval |
|---|---|---|---|---|---|
| 1 | half 0 → half 1 | 0.462 | 0.908 | +0.446 | [+0.328, +0.574] |
| 2 | half 1 → half 0 | 0.461 | 0.908 | +0.447 | [+0.332, +0.571] |

**Decision: adopt.** The lower end of the interval is above 0 in both folds.

For information only (not used for the decision; fold 1, fold 2 alike within
0.01): the blend with D = 0.6 ranks at 0.915, with D = 1.0 at 0.899; the
equal-weight blend at 0.74–0.75; human only (half A's GIH WR) at 0.920, the
split-half reliability on these cards; the lab value alone at 0.46–0.48; the
prior alone at 0.26–0.29. So the discount barely matters for ranking, the
precision weights matter a lot (half-and-half loses a third of the gain), and
the prior and lab pull the blend slightly below human data alone. None of
these was used to change the formula.

What this does and does not show:

- It shows the blend predicts how Arena's human players do with a card in
  data it did not see far better than today's value. It does not show that
  paper-cube decks built with it win more: the target is Arena's Powered Cube
  population, and the ×0.8 discount is a guess at the Arena-to-paper gap, not
  a measurement.
- A correction to the text above: the lab's game counts are larger than the
  "K + g ≈ 100–300" estimated there (median 1,418 lab games for the cards with
  human rows), so human data gets 66–100% of the weight (median 91%), not
  nearly all of it. The formula is unchanged.
- Lands: the test only covered nonland cards, so the shipped blend applies
  only to them; lands keep today's value (the formula is otherwise as written).
- What changes for the user (Vintage only): 131 nonland cards' values are blended, moving by 6.8
  points on average (from −28 to +17); the other 49 Vintage cards and every
  other cube keep today's values. The Draft vs AI opponent's ratings, picks
  and deck are unchanged (a test drafts every format with and without the
  human file).

---

# Part 2: the human data in more cubes, and how far to trust the lab

Status: **pre-registered 2026-10-08, before any result below was computed.**
Nothing in this part's sections up to "Results (part 2)" changes after the run.
Coverage counts (how many cards of each cube are in 17Lands' data) were known
before, from the research notes; no correlation, value or interval for any
cube other than Vintage had been computed with the decision code.

## A. Should Modern-Era, Omega and Synergy blend the overlap cards?

### Question

17Lands' Powered Cube data also holds about 100 Modern-Era, 105 Omega and 79
Synergy cards (55–58% and 44% of each cube). Should those cubes' card values
mix in the overlap cards' human numbers, as Vintage's do? The cubes differ
from Arena's Powered Cube in card pool and power level, so a card's human
rate there is a rate **in another environment**. Two things must hold for the
blend to help, and they need different evidence:

1. **Ranking.** Among the overlap cards, does the blend order cards more like
   human players' results than today's value does? This is answerable with a
   held-out half of the human data, as in part 1.
2. **Transfer.** Does a card's Powered-Cube rank say anything about how it does
   in *this* cube at all? No human games of these cubes exist here (Justin's,
   Evan's and the friend-table recordings are too few). The only signal from
   inside the cube that is independent of 17Lands is the cube lab's own meta:
   Forge-vs-Forge drafts of this very cube. Forge is a weak pilot (part 1: the
   lab agrees with humans at about 0.46 on Vintage), so this is a low bar: it
   asks only that the two sources share *some* ordering, not that Forge is
   right. A cube without a lab meta (Omega) cannot show transfer and so cannot
   pass. This is stated now, before the run.

Why not the other way round, with the cube's meta as the target for the
ranking question? Because today's value for Modern-Era and Synergy is built
from that meta, so it would win against itself by construction; the meta is
kept out of the ranking target and used only for the transfer check, where
neither score is built from it.

### The blend for a cube of another environment (fixed in advance)

The ranking test above can only see the order **within** the overlap cards.
It cannot see whether the overlap cards as a group are better or worse than
the cube's other cards: the human rates are relative to the Powered Cube's
average, where a fair three-drop sits among Moxen. So for these cubes the
human part is anchored to the cube's own scale and only reorders the overlap
cards among themselves:

    O    = the cube's nonland cards with a human row (500+ games in hand, 0 < p < 1)
    p̄    = Σ_O wins in hand / Σ_O games in hand       the overlap cards' pooled GIH WR
    L̄    = mean over O of today's value (labValue)   their level on the cube's own scale
    h    = L̄ + 250 · D · (p − p̄)                    instead of 50 + 250 · D · (p − avg)
    H, D = 0.8, K = 80 and the blend: as in part 1

The human file says which anchor it uses (`"anchor": "cube"`; Vintage's file
has none and keeps part 1's formula unchanged). Lands keep today's value.

### Data, halves, folds

The same two files as part 1 (`game_data_public.Cube_-_Powered.PremierDraft`
and `.TradDraft.csv.gz`, dataset updated 2025-11-23; checked by their game
count, 294,975), the same halves (FNV-1a-32(draft_id) & 1) and the same two
folds (A = half 0 → B = half 1, and back).

### Condition 1: ranking (per cube, per fold)

- **Target:** half B's GIH WR for every nonland card of the cube (neither the
  document nor Scryfall calls it a land) with 500+ games in hand in half B.
- **today:** `cardValue` with the cube's document, its test Scryfall snapshot
  (`src/cube/testdata/scryfall-<id>.json`) and its shipped meta (Modern-Era,
  Synergy; Omega has none), no human data.
- **blend:** the anchored formula with half A's file.
- **Statistic and interval:** rho(blend, target) − rho(today, target), Spearman
  with average ranks; paired bootstrap over target cards, 10,000 resamples,
  mulberry32 seed 20261006, 2.5th–97.5th percentiles.
- **Passes when** there are at least 30 target cards and the lower end is above
  0 in **both** folds.

### Condition 2: transfer (per cube)

- **Cards:** the cube's nonland cards with 500+ games in hand in the full file
  and at least one lab game in the cube's shipped meta.
- **Statistic:** Spearman rho between the lab's win rate for the card in this
  cube (`wins / games`, what the Lab numbers panel shows) and its full-file
  human GIH WR; bootstrap over cards, 10,000 resamples, seed 20261006, 95%
  percentile interval.
- **Passes when** there are at least 30 such cards and the lower end is above 0.
  A cube with no shipped meta fails.

### Rule

Per cube: **adopt only if both conditions pass.** Adopting means the generator
writes `<file>.human.json` for that cube (its per-cube coverage gate replaces
MIN_COVERAGE 0.75 for that cube only), the card value blends it with the
anchored formula, the human lines show on the pick screen and card sheet, and
the screen says how many of the cube's cards have human numbers and that they
come from a different cube. **Otherwise the cube gets no human file at all**
(not even display-only): the brief lowers the coverage gate only on a pass, and
a Powered-Cube win rate shown beside an Omega card without evidence that it
transfers would read as more than it is. Fair Fight, Peasant and Pauper (47,
42 and 21 overlap cards) are not tested and get nothing.

### Reported, not used for the decision

- The unanchored blend (part 1's formula, 50 + 250·D·(p − avg)).
- Human only (half A's GIH WR) and the split-half reliability on the targets.
- The mean change of the overlap cards' values, blend − today, with the full
  file (anchored, and unanchored): how far the unanchored formula would have
  moved the group as a whole.
- Condition 2 for Vintage, as a reference for the same environment.

## B. A reliability label for the lab's numbers

### Question

How well does the lab's (Forge's) number for a card agree with human results,
by kind of card, so the draft hints and card sheet can say how far to trust it?

### Method (fixed in advance)

- **Data:** the Vintage cube only, where the lab and the humans draft the same
  cards in the same kind of environment, so a disagreement is the lab's and not
  a transfer gap: the shipped `vintage-cube-180.meta.json` and the shipped,
  full `vintage-cube-180.human.json`, nonland cards with a human row and at
  least one lab game.
- **Statistic:** Spearman rho between the lab's win rate (`wins / games`) and
  the human GIH WR within each band; bootstrap over cards (10,000 resamples,
  seed 20261006), 95% percentile interval.
- **Bands:** all; creature / noncreature (Scryfall type line); mana value ≤ 2,
  3–4, 5+ (Scryfall `cmc`); colourless (no colours). A band is used only with
  **at least 20 cards**; a smaller one is reported and not used.
- **Level** from the interval: **fair** when the lower end is at least 0.3;
  **rough** when the lower end is above 0 but under 0.3; **shaky** when the
  interval reaches 0 or below.
- **A card's label** is the weakest level among the used bands it belongs to
  (its type band, its mana-value band, colourless if it has no colour), naming
  that band; ties go to the mana-value band, then colourless, then type.
  Lands get no label. The label is shown wherever a lab number or a lab-based
  value is shown for a card whose value does not use human data, and in the
  Lab numbers panel for every nonland card with lab numbers.
- **Reported, not used:** the same bands pooled over Modern-Era, Synergy and
  Pauper (overlap cards, each against its own meta), where a disagreement mixes
  the lab's error with the transfer gap.

The numbers are committed as a table in `src/cube/labTrust.ts`, regenerated by
`npm run human-blend -- agree`; the page computes nothing about them.

## Results (part 2, run 2026-10-08)

Reproduce (the two files as in part 1; DIR is any scratch folder):

```bash
npm run human-cards -- --updated 2025-11-23 --out DIR game_data_public.Cube_-_Powered.*.csv.gz
npm run human-cards -- --updated 2025-11-23 --half 0 --out DIR game_data_public.Cube_-_Powered.*.csv.gz
npm run human-cards -- --updated 2025-11-23 --half 1 --out DIR game_data_public.Cube_-_Powered.*.csv.gz
npm run human-blend -- --cube synergy DIR      # likewise modern-era, omega
npm run human-blend -- agree DIR
```

The data checked out: 294,975 games, halves of 147,565 and 147,410, no row
without a draft id, and the regenerated Vintage file is identical to the
shipped one (cards and pooled counts). Part 1's Vintage run reproduces
exactly (0.462 → 0.908 and 0.461 → 0.908).

### A. Per cube

| Cube | Targets | Fold 1: today → blend, difference [95%] | Fold 2: today → blend, difference [95%] | Condition 2: lab vs humans, rho [95%] | Decision |
|---|---|---|---|---|---|
| Modern-Era | 90 | 0.051 → 0.633, +0.582 [+0.411, +0.750] | 0.071 → 0.673, +0.602 [+0.416, +0.786] | n 90, +0.048 [−0.167, +0.270]: **fails** | **skip** |
| Omega | 85 | 0.226 → 0.888, +0.663 [+0.440, +0.887] | 0.187 → 0.890, +0.704 [+0.499, +0.916] | no lab meta: **fails** (as stated in advance) | **skip** |
| Synergy | 59 | 0.498 → 0.834, +0.337 [+0.164, +0.542] | 0.413 → 0.743, +0.329 [+0.139, +0.544] | n 59, +0.451 [+0.195, +0.662]: holds | **adopt** |
| *Vintage (reference)* | | | | *n 131, +0.477 [+0.340, +0.599]* | |

Condition 1 holds everywhere, as expected: half of the human data predicts
the other half far better than a Forge-based value does. The decisions turn
on condition 2. Modern-Era's own lab ranks the shared cards with no relation
to how Arena's humans rank them (+0.05); whether that is Forge or the
environment, nothing inside the cube backs the transfer, so it gets no file.
Omega has no lab meta, so nothing could. Synergy's lab agrees with the
Powered-Cube humans about as well as Vintage's own lab does (0.45 against
0.48), so the shared cards' human order carries over at least as far as
Forge's view of them does.

For information only (not used):

- Unanchored blend (part 1's formula): Modern-Era 0.615 / 0.654, Omega 0.885 /
  0.891, Synergy 0.835 / 0.744 — the anchor barely changes the order within the
  shared cards, as intended; what it changes is the group's level. With the
  full file, the unanchored formula would have moved Omega's 85 shared cards
  down by 11.9 points on average (the Powered Cube's fair cards sit below its
  average); anchored, the mean change is −1.6. Synergy: −1.3 unanchored,
  −1.5 anchored.
- Human only (half A's GIH WR), i.e. the split-half reliability on the
  targets: Modern-Era 0.894, Omega 0.888, Synergy 0.881.
- What changes for Synergy: 59 nonland cards' values move, by 13.3 points on
  average (−30.7 to +29.5); the other 121 cards and the Draft vs AI drafter are
  unchanged (tests).

**Decision: Synergy ships `synergy-cube-180.human.json` (79 of 180 cards, 20
of them lands that show human numbers but keep today's value) with the
anchored blend; its coverage gate is 0.4 (`COVERAGE_BY_CUBE`). Modern-Era and
Omega get nothing. Vintage is unchanged.**

### B. Lab agreement by band (Vintage, 131 nonland cards)

| Band | Cards | rho | 95% interval | Level |
|---|---|---|---|---|
| all | 131 | 0.477 | [0.340, 0.599] | fair |
| creatures | 57 | 0.583 | [0.394, 0.719] | fair |
| noncreature spells | 74 | 0.364 | [0.139, 0.558] | rough |
| mana value ≤ 2 | 66 | 0.539 | [0.328, 0.705] | fair |
| mana value 3–4 | 46 | 0.562 | [0.305, 0.746] | fair |
| mana value 5+ | 19 | 0.204 | [−0.321, 0.642] | under 20 cards |
| colourless | 12 | −0.084 | [−0.591, 0.507] | under 20 cards |

**Deviation, decided after seeing the counts.** The pre-registration said a
band under 20 cards "is not used". Applied literally, a six-drop creature
would then take the creature band's "fair" and an artifact its mana-value
band's — more trust than the data supports, since those are exactly the bands
that could not be measured. Instead a card in an under-minimum band is
labelled **untested** for it ("Lab number: untested for 5+ drops"), the lowest
level. The change can only lower a label, never raise one; nothing else in
the method changed. (By the interval alone both bands would read "shaky".)

So the labels say: a fair guide for creatures and for cards costing up to 4;
a rough guide for noncreature spells; untested for 5+ drops and colourless
cards. They appear in the Lab numbers panel, on the card sheet (with the
measurement) and in the grid, Winston and booster advice (only cards that are
not a fair guide are named), for cards whose value rests on the lab.

For information only (not used): the same bands on Modern-Era, Synergy and
Pauper's shared cards, each against its own meta, pooled by Fisher z — all
0.27 [0.13, 0.41] (n 170), creatures 0.06 [−0.17, 0.29] (Modern-Era −0.21,
Synergy +0.55), noncreature 0.42 [0.23, 0.58], ≤ 2 0.37 [0.19, 0.53], 3–4
0.20 [−0.10, 0.46]; 5+ and colourless had 10 and 8 cards. These mix Forge's
error with the gap between environments, which is why they were not the
basis; they do not contradict the Vintage levels' direction except for
creatures, which is Modern-Era alone.

---

# Part 3: a per-colour correction of the lab's card numbers

Status: **pre-registered 2026-10-08, before any offset, value or correlation
below was computed.** Nothing in this part's sections up to "Results (part 3)"
changes after the run.

## Question

mtg-table's J111 (`pc-results:results/J111/blue.json`) found, in all seven
cubes, that Forge-piloted blue decks win 32–45% at equal deck quality (the
uncontested model's `b0`), that the other seat's blue takes do not explain it
(every contention coefficient's interval includes 0), and that the AI drafter
takes blue at 1.4–2.1× the cube's colour share. Its verdict for every cube is
"(b) Forge plays blue worse". 17Lands' Powered Cube players, by contrast, do
about average with blue cards. So a blue card's lab win rate, which is mostly
its deck's win rate, is likely held down by Forge's piloting, and other
colours may be pushed up or down the same way.

Does removing each colour's deck-level offset from the lab's win rates make
the lab-based card value rank cards more like human results?

## The correction (fixed in advance, Forge data only)

For a cube with a lab meta, per colour c in W, U, B, R, G:

    p_c  = the lab's deck win rate for decks whose colours include c
           (meta `colorBaselines` when the lab writes it, else summed over the
           meta's archetypes containing c, games-weighted: the rule of
           draft/labStats.ts `colourBaselines`, which the Lab numbers panel shows)
    m    = Σ wins / Σ games over all the meta's archetypes   (≈ 0.5)
    δ_c  = p_c − m

A card's offset is the mean of δ_c over its colours (Scryfall `colors`, as in
`CardFacts.colors`); a colourless card's is 0. The corrected lab rate is
`rawRate − offset`, and `labValue`'s formula is otherwise unchanged:
value = (K·prior + g·(50 + 250·(raw − offset − 0.5)))/(K + g), K = 80. No
offset is shrunk, scaled or chosen per card. It uses only the cube's own
meta; no human data enters it. J111's equal-quality effect itself is not
used: it exists only for blue, and only in mtg-table's results branch.

## The test

- **Cubes and targets.** Vintage: its nonland cards with a row in the shipped
  `vintage-cube-180.human.json` (500+ games in hand, 0 < p < 1; 131 cards in
  part 1). Synergy: its nonland cards with a row in the shipped
  `synergy-cube-180.human.json`. The file covers 79 Synergy cards, of which 20
  are lands (part 2), so the test set is the 59 nonland ones; lands are
  colourless here and would get no offset anyway. Target: the card's GIH win
  rate in that file.
- **Scores.** *uncorrected*: `labValue` as shipped (the cube document, the
  test Scryfall snapshot, the shipped meta, no human data); *corrected*: the
  same with the offset above.
- **Statistic.** Spearman rho with the target (average ranks),
  rho(corrected) − rho(uncorrected).
- **Interval.** Paired bootstrap over target cards, 10,000 resamples,
  mulberry32 seed 20261006, 2.5th–97.5th percentiles (blendTest.ts
  `pairedBootstrap`, as parts 1 and 2).
- **Passes when both hold:** in Vintage the interval's lower end is above 0;
  in Synergy the difference (the point estimate) is ≥ 0. Its interval is
  reported.

## Rule

**If it passes**, the deck assistant's card value uses the corrected lab value
only where no human number exists: every card of a cube with a meta and no
human file (Modern-Era, Pauper), and the cards of Vintage and Synergy without
a usable human row. A card with a human number keeps today's blend exactly,
including its lab term and Synergy's anchor (the mean of the uncorrected
`labValue`). `labValue` itself and `labOnly` stay as they are: the Draft vs
AI drafter's ratings, picks and decks do not change, and a test checks that.
Where a lab-based value is shown, a short note says it is colour-adjusted for
Forge's play. The Lab numbers panel's raw win rates stay raw.

**If it fails**, nothing ships: this part and its results are what merges.

## Reported, not used for the decision

- Spearman rho of the raw lab win rate (`wins / games`, cards with lab games)
  against the target, before and after the offset.
- The offsets δ_c per cube, for all four cubes with a meta.
- An alternative estimator: each colour's offset as the pooled card win rate
  of the meta's mono-coloured nonland cards minus the pooled rate of all its
  nonland cards.
- The mean GIH WR of each colour's mono-coloured cards in the human files, so
  the human side of the brief can be checked.
