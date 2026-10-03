# ForgeCoach roadmap

<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

*Updated 2026-10-03 (evening). Work happens in two repos: ForgeCoach (this site)
and jalirkan/mtg-table (the Forge bridge, the cube lab and the AI work).*

## The goal

**Draft a cube against a strong AI, build your deck with help, and play the
match against that AI with a coach beside the board, all from one page.**

Everything below either feeds that loop or makes one of its parts better: the
drafting AI, the deck help, the play AI, the coach, or the cubes themselves.

## How the work is split

- **Cloud sessions** write the code, review it, and merge it once CI is green.
- **Justin's PC** runs the heavy jobs. A lab runner (a systemd service, not
  Claude) works through the job list on the `pc-jobs` branch of mtg-table and
  reports to `pc-results`. Live progress is at `#lab`, and AI ratings are at
  `#lab/ladder`.
- **Measurement before claims.** Every big run starts with a pilot whose checks
  are "is the data broken" bounds. Results come with intervals, and decision
  rules are written down before the run. Three independent methodology reviews
  set these rules: data, models, and the engine.

## Status

Done and merged:

- **Play.** Draft vs AI to build to match works end to end. You can choose the
  opponent AI: Forge, Forge with the sacrifice-play upgrade, or the search AI.
  A play.sh crash that hit busy machines is fixed.
- **Play AI.**
  - **Search AI:** beats Forge Default 60.3% [55.4, 64.9] over 400 deals, about
    +73 Elo.
  - **Position evaluator:** built, waiting on data.
  - **AI ladder:** Bradley–Terry ratings, SPRT, a tuner and a league.
  - **Engine analysis (the grader):** a live hidden-information guard, honest
    intervals, and a fitted scale (in review, PR #34).
- **Cube lab.**
  - Game recording.
  - The matchup model over all ~720 cards, with bridge drafts and a pooled
    overnight queue.
  - `evolve` with confirmed cuts: false cuts fell from 43% to under 0.3% per
    generation.
  - Seed ranges, version stamps, honest uncertainty, and a pre-registered
    test for proposed cubes.
- **Coach.**
  - The helper queues questions and has a thinking cap.
  - A "thinking…" indicator, plus confidence and rule chips.
  - A light benchmark. Sonnet stays the coach: Haiku with thinking off is no
    faster.
- **Lab operations.** The PC runner, with memory caps, mechanical pilots and
  published status. The `#lab` and `#lab/ladder` pages.

In flight:

- **Decision records:** every choice and the search's per-option scores go into
  recordings. The overnight queue waits for this.
- **Engine week-1 fixes:** PR #34.
- **Product QA pass:** the whole play flow, checked in a real browser against a
  real engine.

## Next

### Week 1: data and quick engine tests

- Runner install on the PC, then the shakedown (J010).
- **Overnight queue, night 1:** recorded normal and bridge drafts across all
  cubes. Its reads are decided in advance: the card-signal strength τ, the
  models against a coin flip, and the bridge link.
- Grader smoke and scale refit (J015).
- **Three SPRTs, each with its decision rule written down in advance:**
  - J016: one more turn of look-ahead on attacks.
  - J017: a search that sees hidden cards. This is test-only and measures how
    much better inference could ever be worth.
  - J018: a noise-aware override rule.

### Week 2: the evaluator

- The evaluator's three gates:
  1. a held-out fit;
  2. lower regret than the hand-written leaf on 300 decisions graded to game
     end;
  3. a ladder SPRT.
- **Build now:** the gate tooling, so it runs the day the data lands.

### Week 3: a better search

- A search that always finishes within its time budget, with fallback under 5%.
- A wider candidate list, ranked with a prior instead of cut by list order.
- The sacrifice-outlet policy used inside rollouts.
- One SPRT each.

### Week 4: the coach meets the engine

- **Post-game review:** a quick screen of every decision, then deep analysis of
  the moments that mattered. The coach explains only the biggest swings.
- **Live coach:** the engine's per-option table goes into the prompt, so the
  LLM explains the engine's numbers instead of working out the position.

### Week 5 and on: improvement loop and cube design

- **Expert iteration at one-PC scale:**
  1. distil the search's choices into a small, fast model;
  2. use that model in the rollouts;
  3. promote a new version only through the ladder.

  Stop after two rounds in a row with no promotion.
- **Matchup model:** the switch to a single card value, once night-1 data shows
  card signal.
- **Cube proposals from the model:** each one is verified by a pre-registered
  test, about one night per candidate.

## Rules that hold throughout

- Seat rule: only **Play** takes `/ws`. Watching uses `/observe`.
- Never show hidden information: the opponent's hand, library or decklist. This
  covers the coach and live engine analysis too. They sample from what the
  player could know, never the AI's list.
- CI is green before every merge. `src/protocol.ts` is only ever re-copied from
  mtg-table, never edited.
- Cards the AI plays badly stay in a cube if they are good. Human notes
  override AI statistics.
- Coach testing stays light. Cloud models change outside our control.
