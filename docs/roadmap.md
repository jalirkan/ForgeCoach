# ForgeCoach roadmap

<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

*Set 2026-10-03. Work happens in two repos: ForgeCoach (this site) and
jalirkan/mtg-table (the Forge bridge, the cube lab and the AI work).*

## The goal

**Draft a cube against a strong AI, build your deck with help, and play the
match against that AI with a coach beside the board, all from one page.**

Everything below either feeds that loop or makes one of its parts better: the
drafting AI, the deck help, the play AI, or the coach.

## Status (2026-10-03, end of day)

Done and merged: everything ticked below. Draft vs AI (Booster, Winston, Grid)
→ Build Your Deck → Begin the Duel → play works end to end against a real
engine (`npm run e2e:draft`). Also shipped beyond the plan: an endstep-style
play board (combat arrows, zone viewer, floating log, match score), the cube
metagame page, "Your record" history, and `forgecoach overnight`.

Open: the play-AI search step (in progress), the learned evaluator, per-cube
"how to draft" guides, and the coach benchmark. Waiting on Justin's PC: the
first overnight run (Omega evolve, fresh meta for four cubes, learned drafter).

## Milestones

### 1. Land what is in flight (tonight)

- [x] Thin-pool decks (mtg-table #10, D298): three colours or 18 lands when a
      Winston pool is too thin.
- [x] Draft and deck assistant: cube pages, pick advice and deck building from
      the cube lab's `meta.json`.
- [x] Forge AI baseline: profile benchmarks, an architecture write-up, and a
      fix for how the AI uses sacrifice outlets.
- [x] ML dataset: an encoder that turns recorded games into training positions,
      plus a first baseline model.

### 2. Cube draft mode, end to end (the headline)

- [x] **Match launcher** (mtg-table): a localhost endpoint that takes two
      decklists and restarts the engine on them.
- [x] **Draft in the browser:** pick a cube, run a Winston or Grid draft against
      the lab's drafting AI (ported from `tools/cubelab`), then see the pools.
- [x] **Build:** the deck assistant builds or advises on your deck, and the AI
      builds its own. The thin-pool rule applies.
- [x] **Play:** one click starts a best-of-three against the AI's deck, with the
      coach. Opponent decklists stay hidden during play, as at a real table.
- [x] **Review:** after the match, a review that knows the cube's meta: which
      archetypes win and which picks mattered.

### 3. Stronger AIs

- [x] **Learned draft ratings:** pick values and synergy learned from lab
      self-play. They must beat the hand ratings head-to-head before they
      replace them.
- [x] **Omega evolve:** the Greatest Hits cube evolved by lab data. Cards
      Forge's AI plays poorly are never cut on AI stats alone.
- [ ] **Play-AI search step:** look ahead on attacks, blocks and targets, on top
      of Forge's AI. It is measured head-to-head against stock Forge in the lab.
      The aim is for combo and sacrifice cards to earn their place.
- [ ] **Learned evaluator:** a value model trained on the ML dataset,
      eventually guiding the search.

### 4. Data from Justin's PC

- [x] One command for an overnight lab run on every cube, writing each cube's
      `meta.json`. It runs on his PC, using CPU rather than tokens.
- [ ] Ship each cube's `meta.json` and a "how to draft this cube" guide into
      `public/cubes/`.

### 5. Better coaching

- [ ] **Coach benchmark:** a fixed set of recorded decisions with known good
      answers. Each prompt change is scored against it before it ships.
- [x] **Cube meta in the coach and review prompts:** archetype win rates, key
      cards and land counts.

## Rules that hold throughout

- Seat rule: only **Play** takes `/ws`. Watching uses `/observe`.
- Never show hidden information: the opponent's hand, library or decklist.
- CI is green before every merge. `src/protocol.ts` is only ever re-copied from
  mtg-table, never edited.
- Cards the AI plays badly stay in a cube if they are good. Human notes
  override AI statistics.
