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

## Results

_To be filled in after the run._
